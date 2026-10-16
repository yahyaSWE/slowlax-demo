import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError, getDb, transaction } from "./db";
import { addKitSubscriberToForm, findOrCreateKitSubscriber, KitApiError, tagKitSubscriber } from "./kit-api";
import { assertKitNewsletterAdmin as assertAdmin, getKitNewsletterSettings, isKitNewsletterActive as active, kitNewsletterKeyConfigured } from "./kit-newsletter-domain";
import type { KitNewsletterJob } from "./kit-newsletter-types";
export { getKitNewsletterSettings, getKitSignupNotice, kitNewsletterKeyConfigured, recordFreeMembershipNewsletter, recordNewStudentNewsletter, saveKitNewsletterSettings } from "./kit-newsletter-domain";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 90000;

type ClaimedJob = { id: string; lease: string; recipient: string; name: string; formId: string; tagId: string | null; attempts: number };

async function claim(id: string): Promise<ClaimedJob | null> {
  return transaction(async () => {
    if (!active(await getKitNewsletterSettings())) return null;
    const now = new Date().toISOString();
    const row = await getDb().prepare(
      "SELECT o.*,u.role,u.email,u.email_verified_at FROM kit_newsletter_outbox o JOIN users u ON u.id=o.user_id WHERE o.id=? AND ((o.status IN ('waiting_verification','pending') AND o.next_attempt_at<=?) OR (o.status='sending' AND o.lease_until<=?))",
    ).get(id, now, now);
    if (!row) return null;
    if (row.role !== "student" || String(row.email).trim().toLowerCase() !== row.recipient) {
      await getDb().prepare("UPDATE kit_newsletter_outbox SET status='skipped',last_error=?,lease_until=NULL,lease_token=NULL WHERE id=?")
        .run("Elevkontot eller e-postadressen har ändrats. Ingen inbjudan skickades.", id);
      return null;
    }
    if (!row.email_verified_at) return null;
    if (Number(row.attempts) >= MAX_ATTEMPTS) {
      await getDb().prepare("UPDATE kit_newsletter_outbox SET status='failed',last_error=?,lease_until=NULL,lease_token=NULL WHERE id=?")
        .run("Fem försök har gjorts. Kontrollera anslutningen och välj Försök igen.", id);
      return null;
    }
    const lease = randomUUID();
    await getDb().prepare("UPDATE kit_newsletter_outbox SET status='sending',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?")
      .run(new Date(Date.now() + LEASE_MS).toISOString(), lease, id);
    return { id, lease, recipient: String(row.recipient), name: String(row.name), formId: String(row.form_id),
      tagId: row.tag_id ? String(row.tag_id) : null, attempts: Number(row.attempts) + 1 };
  });
}

async function finish(job: ClaimedJob, status: "sent" | "skipped", subscriberId: number, message: string | null) {
  await getDb().prepare("UPDATE kit_newsletter_outbox SET status=?,subscriber_id=?,sent_at=?,last_error=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?")
    .run(status, String(subscriberId), status === "sent" ? new Date().toISOString() : null, message, job.id, job.lease);
}

/** Worker safe to call concurrently. External failures only update the outbox. */
export async function dispatchKitNewsletterOutbox(options: { userId?: number; limit?: number } = {}) {
  const result = { configured: active(await getKitNewsletterSettings()), processed: 0, sent: 0, failed: 0, skipped: 0 };
  if (!result.configured) return result;
  const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 10)));
  if (options.userId !== undefined) z.number().int().positive().parse(options.userId);
  const now = new Date().toISOString();
  const jobs = await getDb().prepare(
    `SELECT o.id FROM kit_newsletter_outbox o JOIN users u ON u.id=o.user_id WHERE ((o.status IN ('waiting_verification','pending') AND o.next_attempt_at<=?) OR (o.status='sending' AND o.lease_until<=?)) AND u.email_verified_at IS NOT NULL${options.userId === undefined ? "" : " AND o.user_id=?"} ORDER BY o.created_at,o.id LIMIT ?`,
  ).all(now, now, ...(options.userId === undefined ? [] : [options.userId]), limit);
  // Sequential requests keep pressure below Kit's API-key limit. No network
  // call holds a database transaction or account-registration lock.
  for (const row of jobs) {
    const job = await claim(String(row.id));
    if (!job) continue;
    result.processed++;
    try {
      let subscriber = await findOrCreateKitSubscriber(job.recipient, job.name);
      if (!["active", "inactive"].includes(subscriber.state)) {
        await finish(job, "skipped", subscriber.id, "Kit-adressen är avregistrerad, har studsat eller markerats som skräppost. Återaktivering kräver elevens eget val i Kit.");
        result.skipped++;
        continue;
      }
      // Form membership and tag membership are set operations in Kit. Replaying
      // after an uncertain response does not create duplicate subscribers/forms.
      subscriber = await addKitSubscriberToForm(subscriber, job.formId);
      if (!["active", "inactive"].includes(subscriber.state)) {
        await finish(job, "skipped", subscriber.id, "Kit-adressen är inte längre aktiv eller obekräftad. Ingen tagg tilldelades.");
        result.skipped++;
        continue;
      }
      if (job.tagId) await tagKitSubscriber(subscriber, job.tagId);
      await finish(job, "sent", subscriber.id, null);
      result.sent++;
    } catch (error) {
      const retryable = !(error instanceof KitApiError) || error.retryable;
      const status = retryable && job.attempts < MAX_ATTEMPTS ? "pending" : "failed";
      const message = error instanceof KitApiError ? error.message : "Integrationen kunde inte slutföras. Kontrollera anslutningen och försök igen.";
      await getDb().prepare("UPDATE kit_newsletter_outbox SET status=?,next_attempt_at=?,last_error=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?")
        .run(status, new Date(Date.now() + 60000 * 2 ** (job.attempts - 1)).toISOString(), message, job.id, job.lease);
      result.failed++;
    }
  }
  return result;
}

export async function getKitNewsletterAdminOverview(actorId: number) {
  await assertAdmin(actorId);
  const [settings, rows, totals] = await Promise.all([
    getKitNewsletterSettings(),
    getDb().prepare("SELECT id,user_id,recipient,status,attempts,created_at,next_attempt_at,sent_at,last_error FROM kit_newsletter_outbox ORDER BY created_at DESC,id DESC LIMIT 50").all(),
    getDb().prepare("SELECT status,COUNT(*) AS count FROM kit_newsletter_outbox GROUP BY status").all(),
  ]);
  const jobs: KitNewsletterJob[] = rows.map((row) => ({
    id: String(row.id), userId: Number(row.user_id), recipient: String(row.recipient), status: row.status as KitNewsletterJob["status"],
    attempts: Number(row.attempts), createdAt: String(row.created_at), nextAttemptAt: String(row.next_attempt_at),
    sentAt: row.sent_at ? String(row.sent_at) : null, lastError: row.last_error ? String(row.last_error) : null,
  }));
  return { settings, keyConfigured: kitNewsletterKeyConfigured(), cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    active: active(settings), jobs, totals: Object.fromEntries(totals.map((row) => [String(row.status), Number(row.count)])) };
}

export async function retryKitNewsletterJob(actorId: number, id: string) {
  return transaction(async () => {
    await assertAdmin(actorId);
    z.uuid().parse(id);
    if (!active(await getKitNewsletterSettings())) throw new DomainError("Aktivera Kit-anslutningen innan du försöker igen.");
    const now = new Date().toISOString();
    const result = await getDb().prepare(
      "UPDATE kit_newsletter_outbox SET status='pending',attempts=CASE WHEN status='failed' THEN 0 ELSE attempts END,next_attempt_at=?,last_error=NULL,lease_until=NULL,lease_token=NULL WHERE id=? AND (status IN ('failed','pending') OR (status='sending' AND lease_until<=?))",
    ).run(now, id, now);
    if (!result.changes) throw new DomainError("Bara väntande eller misslyckade försök kan startas om. Avregistrerade adresser återaktiveras inte.");
    const row = await getDb().prepare("SELECT user_id FROM kit_newsletter_outbox WHERE id=?").get(id);
    return Number(row!.user_id);
  });
}
