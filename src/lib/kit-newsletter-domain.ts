import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError, getDb, getUser, transaction } from "./db";
import type { KitNewsletterSettings } from "./kit-newsletter-types";
import { DEMO_MODE } from "./demo-mode";

const kitId = z.string().trim().regex(/^[1-9]\d{0,14}$/, "Ange ett numeriskt ID från Kit.");
const settingsSchema = z.object({
  enabled: z.boolean(),
  formId: kitId,
  tagId: z.union([kitId, z.literal(""), z.null()]).transform((value) => value || null),
  doubleOptInConfirmed: z.boolean(),
}).strict();
const DEFAULT_SETTINGS: KitNewsletterSettings = {
  enabled: false, formId: "9288768", tagId: null, doubleOptInConfirmed: false,
};

export async function assertKitNewsletterAdmin(actorId: number) {
  if ((await getUser(actorId))?.role !== "admin") throw new DomainError("Du har inte tillgång till administrationen.");
}

// Only these non-secret settings can be sent to a Client Component. The API
// key is read solely by kit-api.ts at request time and is never persisted.
export async function getKitNewsletterSettings(): Promise<KitNewsletterSettings> {
  if (DEMO_MODE) return { ...DEFAULT_SETTINGS, formId: "", enabled: false };
  const row = await getDb().prepare("SELECT enabled,form_id,tag_id,double_opt_in_confirmed FROM kit_newsletter_settings WHERE id=1").get();
  if (!row) return { ...DEFAULT_SETTINGS };
  const parsed = settingsSchema.safeParse({
    enabled: Number(row.enabled) === 1, formId: String(row.form_id),
    tagId: row.tag_id ? String(row.tag_id) : null, doubleOptInConfirmed: Number(row.double_opt_in_confirmed) === 1,
  });
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export function kitNewsletterKeyConfigured() { return Boolean(process.env.KIT_API_KEY?.trim()); }

export function isKitNewsletterActive(settings: KitNewsletterSettings) {
  return settings.enabled && settings.doubleOptInConfirmed && kitNewsletterKeyConfigured();
}

export async function getKitSignupNotice(): Promise<{ enabled: boolean; message: string | null }> {
  // Public registration remains available if newsletter configuration cannot
  // be loaded. Its account transaction will still persist an enabled intent.
  try {
    const enabled = isKitNewsletterActive(await getKitNewsletterSettings());
    return { enabled, message: enabled ? "När du har verifierat elevkontot skickar Kit en separat inbjudan till Slowlax nyhetsbrev. Bekräfta i det mejlet om du vill få nyhetsbrevet. Du kan avregistrera dig när som helst." : null };
  } catch { return { enabled: false, message: null }; }
}

export async function saveKitNewsletterSettings(actorId: number, input: unknown) {
  return transaction(async () => {
    await assertKitNewsletterAdmin(actorId);
    const value = settingsSchema.parse(input);
    if (value.enabled && !kitNewsletterKeyConfigured())
      throw new DomainError("Lägg först till KIT_API_KEY i serverns miljövariabler och starta om applikationen.");
    if (value.enabled && !value.doubleOptInConfirmed)
      throw new DomainError("Aktivera bekräftelsemejl och stäng av automatisk bekräftelse i Kit-formuläret först.");
    await getDb().prepare(
      "UPDATE kit_newsletter_settings SET enabled=?,form_id=?,tag_id=?,double_opt_in_confirmed=?,updated_at=? WHERE id=1",
    ).run(value.enabled ? 1 : 0, value.formId, value.tagId, value.doubleOptInConfirmed ? 1 : 0, new Date().toISOString());
    return value;
  });
}

/**
 * Call exactly once for a newly registered student, in the account creation
 * transaction. Do not call this on login or for historical students. No Kit
 * request is made; dispatch separately after local/Supabase email verification.
 */
export async function recordNewStudentNewsletter(userId: number): Promise<{ queued: boolean }> {
  return recordStudentNewsletterIntent(userId);
}

/**
 * Called by the Bas membership domain in its enrollment transaction: for a
 * newly created student, or after an existing student explicitly joins Bas.
 * The caller checks membership authorization; unverified new accounts stay in
 * waiting_verification. Existing intents are never reset or reactivated.
 */
export async function recordFreeMembershipNewsletter(userId: number): Promise<{ queued: boolean }> {
  return recordStudentNewsletterIntent(userId);
}

async function recordStudentNewsletterIntent(userId: number): Promise<{ queued: boolean }> {
  return transaction(async () => {
    const settings = await getKitNewsletterSettings();
    if (!isKitNewsletterActive(settings)) return { queued: false };
    const user = await getUser(userId);
    if (!user || user.role !== "student") return { queued: false };
    const now = new Date().toISOString();
    const result = await getDb().prepare(
      "INSERT INTO kit_newsletter_outbox(id,user_id,recipient,name,form_id,tag_id,status,created_at,next_attempt_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING",
    ).run(randomUUID(), user.id, user.email.trim().toLowerCase(), user.name, settings.formId, settings.tagId,
      user.emailVerifiedAt ? "pending" : "waiting_verification", now, now);
    return { queued: result.changes > 0 };
  });
}

