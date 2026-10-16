import { randomBytes, createHash } from "node:crypto";
import { getMembershipPlanGroups } from "./memberships";
import { checkPurificationRevision,applyMembershipPurification,type PurificationInvoice } from "./purification-payment-hooks";
import { snapshotPurificationQuotaForAttempt } from "./purification-domain";
import type Stripe from "stripe";
import { DomainError, getUser } from "./db";
import { getDb, transaction } from "./database";
import { appUrl, getStripe } from "./stripe";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const num = (value: unknown) => Number(value);
const now = () => new Date().toISOString();
const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const API_OPTIONS = { timeout: 10000, maxNetworkRetries: 1 };
const APPLICATION = "slowlax.se";
const INTEGRATION = "membership";
const CHECKOUT_MINUTES = 60;
const LEASE_SECONDS = 90;
class MembershipVerificationError extends Error {}

export class MembershipHttpError extends DomainError {
  constructor(message: string, readonly status: number) { super(message); }
}
export function membershipBillingReady() {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET || !process.env.APP_URL) return false;
  try { appUrl(); return true; } catch { return false; }
}
export function membershipPortalReady() {
  return membershipBillingReady() && !!process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID;
}
export function assertMembershipOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl() || request.headers.get("sec-fetch-site") === "cross-site")
    throw new MembershipHttpError("Medlemskapet måste hanteras från hemsidan.", 403);
}
export async function readMembershipBody(request: Request, maximum = 4096) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new MembershipHttpError("Begäran är för stor.", 413);
  if (!request.body) throw new MembershipHttpError("Uppgifterna saknas.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new MembershipHttpError("Begäran är för stor.", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function membershipRequestJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new MembershipHttpError("Skicka uppgifterna som JSON.", 400);
  try { return JSON.parse(await readMembershipBody(request)); }
  catch (error) {
    if (error instanceof MembershipHttpError) throw error;
    throw new MembershipHttpError("Uppgifterna kunde inte läsas.", 400);
  }
}
export function membershipResponseError(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof MembershipHttpError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 409, headers });
  return Response.json({ error: "Medlemskapet kunde inte hanteras. Försök igen om en stund." }, { status: 503, headers });
}
function stripeRedirect(value: string | null, kind: "checkout" | "portal") {
  if (!value) throw new Error("Stripe redirect is missing");
  const url = new URL(value);
  const hostname = kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com";
  if (url.protocol !== "https:" || url.hostname !== hostname || url.port || url.username || url.password)
    throw new Error("Stripe redirect is invalid");
  return value;
}
async function verifiedStudent(userId: number) {
  const user = await getUser(userId);
  if (!user || user.role !== "student" || !user.emailVerifiedAt)
    throw new MembershipHttpError("Logga in med ett verifierat elevkonto för att hantera medlemskap.", 403);
  return user;
}
async function purchasablePlan(planId: number) {
  const plan = await getDb().prepare(`SELECT p.*,g.published AS group_published FROM membership_plans p
    JOIN membership_groups g ON g.id=p.group_id WHERE p.id=?`).get(planId);
  const settings = await getDb().prepare("SELECT * FROM membership_settings WHERE id=1").get();
  const contact = await getDb().prepare("SELECT email FROM settings WHERE id=1").get();
  if (!membershipPortalReady() || !settings?.sales_enabled || !str(settings.terms).trim() || !str(contact?.email).trim())
    throw new DomainError("Nya medlemskap kan inte köpas just nu.");
  if (!plan || !plan.published || !plan.group_published || !Number.isSafeInteger(num(plan.price_ore)) || num(plan.price_ore) < 1 || !["month", "year"].includes(str(plan.interval)))
    throw new DomainError("Medlemskapet är inte tillgängligt.");
  // Course publication is part of the public offer as well as the access gate.
  if (await getDb().prepare(`SELECT 1 FROM membership_group_courses gc JOIN courses c ON c.id=gc.course_id
    WHERE gc.group_id=? AND c.published=0 LIMIT 1`).get(num(plan.group_id)))
    throw new DomainError("Medlemskapet är inte tillgängligt.");
  const groups = await getMembershipPlanGroups(planId, num(plan.group_id));
  for (const group of groups) {
    if (!await getDb().prepare("SELECT id FROM membership_groups WHERE id=? AND published=1").get(group.id) ||
      await getDb().prepare(`SELECT 1 FROM membership_group_courses gc JOIN courses c ON c.id=gc.course_id WHERE gc.group_id=? AND c.published<>1 LIMIT 1`).get(group.id))
      throw new DomainError("Medlemskapet är inte tillgängligt.");
  }
  return { plan, settings: settings!, groups };
}
export type MembershipCheckoutConsent = { consent: true; planRevision: string; termsRevision: string; purificationRevision?:string|null };
function matchesRevision(plan: Row, settings: Row, consent: MembershipCheckoutConsent) {
  if (consent.consent !== true || consent.planRevision !== str(plan.updated_at) || consent.termsRevision !== str(settings.updated_at))
    throw new DomainError("Priset eller villkoren har ändrats. Ladda om sidan och godkänn de aktuella villkoren.");
}
function metadata(attempt: Row) {
  return { application: APPLICATION, integration: INTEGRATION, membership_attempt_id: str(attempt.id),
    user_id: str(attempt.user_id), plan_id: str(attempt.plan_id), group_id: str(attempt.group_id) };
}
function ownMetadata(value: Stripe.Metadata | null | undefined) {
  return value?.application === APPLICATION && value.integration === INTEGRATION;
}
async function reserveAttempt(userId: number, planId: number, consent: MembershipCheckoutConsent) {
  return transaction(async () => {
    await verifiedStudent(userId);
    const { plan, settings, groups } = await purchasablePlan(planId);
    matchesRevision(plan, settings, consent);
    await checkPurificationRevision('membership',planId,consent.purificationRevision);
    const timestamp = now();
    await getDb().prepare("UPDATE membership_checkout_attempts SET status='expired',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status IN ('creating','open') AND expires_at<=?").run(timestamp, timestamp);
    // An overdue subscription can still bill again. Require its cancellation
    // before creating another subscription for the same access group.
    const groupSlots = groups.map(() => "?").join(","), groupIds = groups.map(group => group.id);
    const overlap = `(s.group_id IN (${groupSlots}) OR EXISTS(SELECT 1 FROM membership_attempt_groups overlapping_groups WHERE overlapping_groups.attempt_id=s.attempt_id AND overlapping_groups.group_id IN (${groupSlots})))`;
    if (await getDb().prepare(`SELECT s.stripe_id FROM membership_subscriptions s WHERE s.user_id=? AND ${overlap} AND s.status NOT IN ('canceled','incomplete_expired') LIMIT 1`).get(userId, ...groupIds, ...groupIds))
      throw new DomainError("Du har redan ett medlemskap i den här gruppen. Hantera det i betalningsportalen.");
    const attemptOverlap = `(group_id IN (${groupSlots}) OR EXISTS(SELECT 1 FROM membership_attempt_groups overlapping_groups WHERE overlapping_groups.attempt_id=membership_checkout_attempts.id AND overlapping_groups.group_id IN (${groupSlots})))`;
    let attempt = await getDb().prepare(`SELECT * FROM membership_checkout_attempts WHERE user_id=? AND ${attemptOverlap} AND (status='completed' OR (status IN ('creating','open') AND expires_at>?)) ORDER BY created_at DESC LIMIT 1`).get(userId, ...groupIds, ...groupIds, timestamp);
    const fresh = !attempt;
    if (attempt) {
      if (num(attempt.plan_id) !== planId || str(attempt.plan_revision) !== consent.planRevision || str(attempt.settings_revision) !== consent.termsRevision)
        throw new DomainError("En betalning för gruppen pågår redan. Slutför den eller avbryt den under Mina abonnemang innan du väljer ett annat erbjudande.");
      if (attempt.status === "completed") throw new DomainError("Betalningen behandlas. Medlemskapet visas när Stripe har bekräftat det.");
      if (str(attempt.lease_until) > timestamp) throw new DomainError("Betalningen öppnas redan. Försök igen om en stund.");
    } else {
      const attemptId = randomBytes(16).toString("hex");
      await getDb().prepare(`INSERT INTO membership_checkout_attempts
        (id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?)`).run(attemptId, userId, planId, num(plan.group_id), str(settings.terms), num(plan.price_ore), num(plan.vat_percent), str(plan.interval), str(plan.name), str(plan.slug), str(plan.updated_at), str(settings.updated_at), new Date(Date.now() + CHECKOUT_MINUTES * 60000).toISOString(), timestamp, timestamp);
      for (const group of groups) await getDb().prepare("INSERT INTO membership_attempt_groups(attempt_id,group_id,group_name) VALUES(?,?,?)").run(attemptId, group.id, group.name);
      attempt = (await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE id=?").get(attemptId))!;
      await snapshotPurificationQuotaForAttempt('membership',attemptId,planId);
    }
    const token = randomBytes(16).toString("hex");
    await getDb().prepare("UPDATE membership_checkout_attempts SET lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), timestamp, str(attempt.id));
    return { attempt, token, fresh };
  });
}
async function ensureCustomer(userId: number, stripe: Stripe) {
  const user = await verifiedStudent(userId);
  const existing = await getDb().prepare("SELECT stripe_id FROM membership_customers WHERE user_id=?").get(userId);
  const userMetadata = { application: APPLICATION, integration: INTEGRATION, user_id: String(userId) };
  const customer = existing
    ? await stripe.customers.retrieve(str(existing.stripe_id), {}, API_OPTIONS)
    : await stripe.customers.create({ email: user.email, name: user.name, metadata: userMetadata }, {
      ...API_OPTIONS, idempotencyKey: `membership-customer-${userId}-${createHash("sha256").update(user.createdAt).digest("hex").slice(0, 20)}`,
    });
  if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== String(userId) ||
    (customer.tax_exempt && customer.tax_exempt !== "none"))
    throw new Error("Membership customer ownership mismatch");
  await transaction(async () => {
    await verifiedStudent(userId);
    await getDb().prepare("INSERT INTO membership_customers(user_id,stripe_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING").run(userId, customer.id, now());
    const bound = await getDb().prepare("SELECT stripe_id FROM membership_customers WHERE user_id=?").get(userId);
    if (str(bound?.stripe_id) !== customer.id) throw new Error("Membership customer binding mismatch");
  });
  return customer.id;
}
function assertTaxRate(rate: Stripe.TaxRate, attempt: Row, newCheckout = false) {
  if (!rate.id || rate.id !== str(attempt.tax_rate_id) || rate.percentage !== num(attempt.vat_percent) || !rate.inclusive ||
    rate.country !== "SE" || rate.tax_type !== "vat" || (newCheckout && !rate.active) ||
    Object.entries(metadata(attempt)).some(([key, value]) => rate.metadata?.[key] !== value))
    throw new MembershipVerificationError("Membership VAT rate does not match accepted contract");
}
async function loadTaxBinding(attempt: Row) {
  const binding = await getDb().prepare("SELECT stripe_id,vat_percent FROM membership_checkout_tax_rates WHERE attempt_id=?").get(str(attempt.id));
  if (!binding || num(binding.vat_percent) !== num(attempt.vat_percent))
    throw new MembershipVerificationError("Membership VAT binding is missing");
  attempt.tax_rate_id = str(binding.stripe_id);
  return str(binding.stripe_id);
}
async function ensureTaxRate(attempt: Row, token: string, stripe: Stripe) {
  const existing = await getDb().prepare("SELECT stripe_id,vat_percent FROM membership_checkout_tax_rates WHERE attempt_id=?").get(str(attempt.id));
  if (attempt.session_id && !existing) throw new MembershipVerificationError("Legacy membership checkout has no VAT binding");
  const rate = existing
    ? await stripe.taxRates.retrieve(str(existing.stripe_id), {}, API_OPTIONS)
    : await stripe.taxRates.create({ display_name: "Moms", inclusive: true, percentage: num(attempt.vat_percent),
      country: "SE", jurisdiction: "Sverige", tax_type: "vat", metadata: metadata(attempt) },
      { ...API_OPTIONS, idempotencyKey: `membership-vat-${attempt.id}` });
  attempt.tax_rate_id = rate.id;
  assertTaxRate(rate, attempt, !attempt.session_id);
  if (existing && num(existing.vat_percent) !== num(attempt.vat_percent)) throw new MembershipVerificationError("Membership VAT snapshot mismatch");
  await transaction(async () => {
    if (!(await getDb().prepare("SELECT id FROM membership_checkout_attempts WHERE id=? AND lease_token=? AND lease_until>?").get(str(attempt.id), token, now())))
      throw new Error("Membership VAT checkout lease expired");
    await getDb().prepare("INSERT INTO membership_checkout_tax_rates(attempt_id,stripe_id,vat_percent,created_at) VALUES(?,?,?,?) ON CONFLICT(attempt_id) DO NOTHING")
      .run(str(attempt.id), rate.id, num(attempt.vat_percent), now());
    const bound = await loadTaxBinding(attempt);
    if (bound !== rate.id) throw new MembershipVerificationError("Membership VAT binding mismatch");
  });
  return rate.id;
}
function inclusiveVat(attempt: Row) {
  return Math.round(num(attempt.price_ore) * num(attempt.vat_percent) / (100 + num(attempt.vat_percent)));
}
function assertCheckoutTax(session: Stripe.Checkout.Session, attempt: Row) {
  const line = session.line_items!.data[0];
  const taxes = line.taxes ?? [];
  const amount = inclusiveVat(attempt);
  if (line.amount_tax !== amount || (session.total_details?.amount_tax ?? -1) !== amount ||
    (amount > 0 && taxes.length !== 1) || taxes.length > 1 ||
    taxes.some((tax) => tax.amount !== amount || tax.rate.id !== str(attempt.tax_rate_id) ||
      tax.taxability_reason === "customer_exempt" || tax.taxability_reason === "reverse_charge"))
    throw new MembershipVerificationError("Membership checkout VAT does not match accepted contract");
  for (const tax of taxes) assertTaxRate(tax.rate, attempt);
}
function assertSession(session: Stripe.Checkout.Session, attempt: Row) {
  const expected = metadata(attempt);
  const line = session.line_items?.data[0];
  if (session.mode !== "subscription" || session.client_reference_id !== str(attempt.id) || id(session.customer) !== str(attempt.customer_id) ||
    Object.entries(expected).some(([key, value]) => session.metadata?.[key] !== value) ||
    (attempt.session_id && session.id !== str(attempt.session_id)) || session.currency !== "sek" ||
    (session.amount_total !== null && session.amount_total !== num(attempt.price_ore)) || !line || session.line_items?.has_more ||
    session.line_items?.data.length !== 1 || line.quantity !== 1 || line.amount_total !== num(attempt.price_ore) ||
    !line.price || line.price.currency !== "sek" || line.price.unit_amount !== num(attempt.price_ore) || line.price.tax_behavior !== "inclusive" ||
    line.price.recurring?.interval !== str(attempt.interval) || line.price.recurring.interval_count !== 1)
    throw new MembershipVerificationError("Membership checkout binding mismatch");
  assertCheckoutTax(session, attempt);
}
export async function createMembershipCheckout(userId: number, planId: number, consent: MembershipCheckoutConsent) {
  const stripe = getStripe();
  const { attempt, token, fresh } = await reserveAttempt(userId, planId, consent);
  let sessionId: string | undefined;
  let checkoutRequested = false;
  try {
    await safePortalConfiguration(stripe);
    const customer = await ensureCustomer(userId, stripe);
    await transaction(async () => {
      const { plan, settings } = await purchasablePlan(planId);
      matchesRevision(plan, settings, consent);
      await checkPurificationRevision('membership',planId,consent.purificationRevision);
      const result = await getDb().prepare("UPDATE membership_checkout_attempts SET customer_id=? WHERE id=? AND lease_token=? AND lease_until>?").run(customer, str(attempt.id), token, now());
      if (!result.changes) throw new Error("Membership checkout lease expired");
    });
    attempt.customer_id = customer;
    const taxRateId = await ensureTaxRate(attempt, token, stripe);
    await transaction(async () => {
      const { plan, settings } = await purchasablePlan(planId);
      matchesRevision(plan, settings, consent);
      await checkPurificationRevision('membership',planId,consent.purificationRevision);
      if (!(await getDb().prepare("SELECT id FROM membership_checkout_attempts WHERE id=? AND lease_token=? AND lease_until>?").get(str(attempt.id), token, now())))
        throw new Error("Membership checkout lease expired");
    });
    checkoutRequested = true;
    const session = attempt.session_id
      ? await stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS)
      : await stripe.checkout.sessions.create({
        mode: "subscription", allowed_payment_method_types: ["card"], customer, expand: ["line_items"],
        client_reference_id: str(attempt.id), metadata: metadata(attempt),
        subscription_data: { metadata: metadata(attempt), default_tax_rates: [taxRateId] },
        billing_address_collection: "required", customer_update: { address: "auto" },
        line_items: [{ quantity: 1, price_data: { currency: "sek", unit_amount: num(attempt.price_ore),
          tax_behavior: "inclusive", recurring: { interval: str(attempt.interval) as "month" | "year", interval_count: 1 },
          product_data: { name: str(attempt.plan_name), metadata: metadata(attempt) } } }],
        expires_at: Math.floor(Date.parse(str(attempt.expires_at)) / 1000),
        success_url: `${appUrl()}/medlemskap/bekraftelse?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/elevportal/medlemskap?cancelled=1`,
      }, { ...API_OPTIONS, idempotencyKey: `membership-checkout-${attempt.id}` });
    sessionId = session.id;
    assertSession(session, attempt);
    if (session.status !== "open") throw new DomainError("Betalningen är avslutad eller behandlas. Kontrollera ditt medlemskap i elevportalen.");
    const url = stripeRedirect(session.url, "checkout");
    await transaction(async () => {
      const { plan, settings } = await purchasablePlan(planId);
      matchesRevision(plan, settings, consent);
      await checkPurificationRevision('membership',planId,consent.purificationRevision);
      const attached = await getDb().prepare("UPDATE membership_checkout_attempts SET session_id=?,status='open',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND lease_until>? AND status IN ('creating','open')").run(session.id, now(), str(attempt.id), token, now());
      if (!attached.changes) throw new Error("Membership checkout lease expired");
    });
    return url;
  } catch (error) {
    // A network timeout is uncertain. Preserve the attempt and idempotency key;
    // retrying it recovers the same Stripe session instead of charging twice.
    if (sessionId && !attempt.session_id) {
      try {
        const expired = await stripe.checkout.sessions.expire(sessionId, {}, API_OPTIONS);
        if (expired.status === "expired") await getDb().prepare("UPDATE membership_checkout_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status IN ('creating','open')").run(now(), str(attempt.id), token);
      } catch { /* The durable attempt still binds any signed late payment. */ }
    }
    if (fresh && !attempt.session_id && !checkoutRequested)
      await getDb().prepare("UPDATE membership_checkout_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status='creating'").run(now(), str(attempt.id), token);
    await getDb().prepare("UPDATE membership_checkout_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
    throw error;
  }
}

export type MembershipSubscription = {
  stripeId: string; userId: number; planId: number; groupId: number; planName: string; groupName: string;
  name: string; studentName: string; email: string; status: string; paidUntil: string | null; blocked: boolean;
  cancelAtPeriodEnd: boolean; priceOre: number; vatPercent: number; interval: "month" | "year";
  hasAccess: boolean; createdAt: string; updatedAt: string;
  groups: { id: number; name: string; available: boolean }[];
};
function subscriptionView(row: Row): MembershipSubscription {
  return { stripeId: str(row.stripe_id), userId: num(row.user_id), planId: num(row.plan_id), groupId: num(row.group_id),
    groups: [],
    planName: str(row.plan_name), groupName: str(row.group_name), name: str(row.name), studentName: str(row.name), email: str(row.email),
    status: str(row.status), paidUntil: row.paid_until ? str(row.paid_until) : null, blocked: !!row.blocked,
    cancelAtPeriodEnd: !!row.cancel_at_period_end, priceOre: num(row.price_ore), vatPercent: num(row.vat_percent),
    interval: row.interval as "month" | "year", hasAccess: !!row.group_published && row.role === "student" && !!row.email_verified_at &&
      !row.blocked && ["active", "past_due"].includes(str(row.status)) && Date.parse(str(row.paid_until)) > Date.now(),
    createdAt: str(row.created_at), updatedAt: str(row.updated_at) };
}
const SUBSCRIPTIONS = `SELECT s.*,a.plan_name,g.name AS group_name,g.published AS group_published,u.name,u.email,u.role,u.email_verified_at FROM membership_subscriptions s
  JOIN membership_checkout_attempts a ON a.id=s.attempt_id JOIN membership_groups g ON g.id=s.group_id JOIN users u ON u.id=s.user_id`;
async function subscriptionViews(rows: Row[]) {
  return Promise.all(rows.map(async row => {
    const view = subscriptionView(row);
    let groups = await getDb().prepare(`SELECT ag.group_id AS id,ag.group_name AS name,g.published FROM membership_attempt_groups ag JOIN membership_groups g ON g.id=ag.group_id WHERE ag.attempt_id=? ORDER BY ag.group_name,ag.group_id`).all(str(row.attempt_id));
    if (!groups.length) groups = [{ id: row.group_id, name: row.group_name, published: row.group_published }];
    const paid = row.role === "student" && !!row.email_verified_at && !row.blocked && ["active", "past_due"].includes(str(row.status)) && Date.parse(str(row.paid_until)) > Date.now();
    const mapped = groups.map(group => ({ id: num(group.id), name: str(group.name), available: paid && !!group.published }));
    return { ...view, groups: mapped, groupName: mapped.map(group => group.name).join(" · "), hasAccess: mapped.some(group => group.available) };
  }));
}
export async function getUserSubscriptions(userId: number) {
  return subscriptionViews(await getDb().prepare(`${SUBSCRIPTIONS} WHERE s.user_id=? ORDER BY s.created_at DESC`).all(userId));
}
export type MembershipPendingCheckout = {
  planId: number; planName: string; groupName: string; priceOre: number;
  interval: "month" | "year"; expiresAt: string; canCancel: boolean;
};
export async function getUserPendingCheckouts(userId: number): Promise<MembershipPendingCheckout[]> {
  await verifiedStudent(userId);
  // A student must be able to cancel an abandoned checkout even after the
  // offer is unpublished or sales close. Reading this list never contacts
  // Stripe, grants access, or changes the checkout's durable state.
  const rows = await getDb().prepare(`SELECT a.plan_id,a.plan_name,g.name AS group_name,
    a.price_ore,a.interval,a.expires_at,a.status FROM membership_checkout_attempts a
    JOIN membership_groups g ON g.id=a.group_id
    WHERE a.user_id=? AND (a.status='completed' OR
      (a.status IN ('creating','open') AND a.expires_at>?))
      AND NOT EXISTS(SELECT 1 FROM membership_subscriptions s WHERE s.attempt_id=a.id)
    ORDER BY a.created_at DESC`).all(userId, now());
  return rows.map(row => ({
    planId: num(row.plan_id), planName: str(row.plan_name), groupName: str(row.group_name),
    priceOre: num(row.price_ore), interval: row.interval as "month" | "year",
    expiresAt: str(row.expires_at), canCancel: row.status !== "completed",
  }));
}
export async function getAdminSubscriptions(actorId: number, groupId?: number) {
  if ((await getUser(actorId))?.role !== "admin") throw new DomainError("Du har inte tillgång till administrationen.");
  return subscriptionViews(await getDb().prepare(`${SUBSCRIPTIONS} ${groupId === undefined ? "" : "WHERE s.group_id=? OR EXISTS(SELECT 1 FROM membership_attempt_groups ag WHERE ag.attempt_id=s.attempt_id AND ag.group_id=?)"} ORDER BY s.created_at DESC`).all(...(groupId === undefined ? [] : [groupId, groupId])));
}
export async function getMembershipCheckoutConfirmation(userId: number, sessionId: string): Promise<{
  planName: string; groupId: number; confirmed: boolean; status: "pending" | "paid" | "cancelled";
} | null> {
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return null;
  const row = await getDb().prepare(`SELECT a.plan_name,a.group_id,a.status AS checkout_status,s.status,s.paid_until,s.blocked,
    g.published AS group_published,u.role,u.email_verified_at FROM membership_checkout_attempts a
    JOIN membership_groups g ON g.id=a.group_id JOIN users u ON u.id=a.user_id
    LEFT JOIN membership_subscriptions s ON s.attempt_id=a.id WHERE a.user_id=? AND a.session_id=?`).get(userId, sessionId);
  if (!row) return null;
  const confirmed = row.role === "student" && !!row.email_verified_at && !row.blocked &&
    ["active", "past_due"].includes(str(row.status)) && Date.parse(str(row.paid_until)) > Date.now();
  const cancelled = ["expired", "cancelled"].includes(str(row.checkout_status)) || !!row.blocked ||
    ["canceled", "incomplete_expired", "unpaid", "paused"].includes(str(row.status));
  return { planName: str(row.plan_name), groupId: num(row.group_id), confirmed, status: confirmed ? "paid" : cancelled ? "cancelled" : "pending" };
}
async function attemptSession(attempt: Row, stripe: Stripe) {
  if (attempt.session_id) return stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS);
  if (!attempt.customer_id) throw new DomainError("Betalningen behandlas fortfarande. Försök igen om en stund.");
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await stripe.checkout.sessions.list({ customer: str(attempt.customer_id), limit: 100,
      ...(cursor ? { starting_after: cursor } : {}) }, API_OPTIONS);
    const matches = result.data.filter((session) => session.client_reference_id === str(attempt.id) && session.metadata?.membership_attempt_id === str(attempt.id));
    if (matches.length > 1) throw new MembershipVerificationError("Membership attempt has multiple checkout sessions");
    if (matches.length) return stripe.checkout.sessions.retrieve(matches[0].id, { expand: ["line_items"] }, API_OPTIONS);
    if (!result.has_more) break;
    cursor = result.data.at(-1)?.id;
    if (!cursor) break;
  }
  // An uncertain timed-out creation may still complete remotely. Keep its
  // reservation until Stripe can confirm its session or the fixed expiry passes.
  throw new DomainError("Betalningen behandlas fortfarande. Försök igen om en stund.");
}
export async function cancelMembershipCheckout(userId: number, planId: number) {
  await verifiedStudent(userId);
  const { attempt, token } = await transaction(async () => {
    const attempt = await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE user_id=? AND plan_id=? AND status IN ('creating','open','completed') ORDER BY created_at DESC LIMIT 1").get(userId, planId);
    if (!attempt) return { attempt: null, token: "" };
    if (attempt.status === "completed") throw new DomainError("Betalningen är avslutad och behandlas. Hantera medlemskapet i elevportalen.");
    if (str(attempt.lease_until) > now()) throw new DomainError("Betalningen öppnas redan. Försök igen om en stund.");
    const token = randomBytes(16).toString("hex");
    await getDb().prepare("UPDATE membership_checkout_attempts SET lease_token=?,lease_until=? WHERE id=?").run(token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), str(attempt.id));
    return { attempt, token };
  });
  if (!attempt) return;
  try {
    const stripe = getStripe();
    await loadTaxBinding(attempt);
    let session = await attemptSession(attempt, stripe);
    assertSession(session, attempt);
    if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id, {}, API_OPTIONS);
    if (!["expired", "complete"].includes(str(session.status))) throw new Error("Membership checkout expiration is not confirmed");
    await transaction(async () => {
      const result = await getDb().prepare(`UPDATE membership_checkout_attempts SET session_id=?,status=CASE WHEN status='subscribed' THEN status ELSE ? END,
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND lease_until>?`)
        .run(session.id, session.status === "expired" ? "cancelled" : "completed", now(), str(attempt.id), token, now());
      if (!result.changes) throw new Error("Membership checkout cancellation lease expired");
    });
    if (session.status === "complete") throw new DomainError("Betalningen är avslutad och behandlas. Hantera medlemskapet i elevportalen.");
  } finally {
    await getDb().prepare("UPDATE membership_checkout_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
  }
}
export async function createMembershipPortal(userId: number) {
  await verifiedStudent(userId);
  if (!membershipPortalReady()) throw new DomainError("Betalningsportalen är inte tillgänglig ännu.");
  const bound = await getDb().prepare("SELECT stripe_id FROM membership_customers WHERE user_id=?").get(userId);
  if (!bound || !(await getDb().prepare("SELECT stripe_id FROM membership_subscriptions WHERE user_id=? LIMIT 1").get(userId)))
    throw new DomainError("Du har inget medlemskap att hantera.");
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(str(bound.stripe_id), {}, API_OPTIONS);
  if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== String(userId))
    throw new Error("Membership portal customer ownership mismatch");
  const configurationId = await safePortalConfiguration(stripe);
  const session = await stripe.billingPortal.sessions.create({ customer: customer.id, configuration: configurationId,
    return_url: `${appUrl()}/elevportal`, locale: "sv" }, API_OPTIONS);
  return stripeRedirect(session.url, "portal");
}
async function safePortalConfiguration(stripe: Stripe) {
  const configurationId = process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID;
  if (!configurationId) throw new DomainError("Betalningsportalen är inte tillgänglig ännu.");
  const configuration = await stripe.billingPortal.configurations.retrieve(configurationId, {}, API_OPTIONS);
  const features = configuration.features;
  if (!configuration.active || configuration.id !== configurationId || !features.payment_method_update.enabled ||
    !features.subscription_cancel.enabled || features.subscription_cancel.mode !== "at_period_end" ||
    features.subscription_update.enabled || features.customer_update.enabled || configuration.login_page.enabled)
    throw new DomainError("Betalningsportalen behöver konfigureras för uppsägning vid periodens slut.");
  return configurationId;
}

async function takeLock(key: string) {
  return transaction(async () => {
    const token = randomBytes(16).toString("hex");
    const result = await getDb().prepare(`INSERT INTO membership_billing_locks(key,token,expires_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE membership_billing_locks.expires_at<=?`)
      .run(key, token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), now());
    if (!result.changes) throw new Error("Membership reconciliation already running");
    return token;
  });
}
async function assertLock(key: string, token: string) {
  if (!(await getDb().prepare("SELECT key FROM membership_billing_locks WHERE key=? AND token=? AND expires_at>?").get(key, token, now())))
    throw new Error("Membership reconciliation lease expired");
}
async function boundSubscription(subscription: Stripe.Subscription) {
  const existing = await getDb().prepare("SELECT * FROM membership_subscriptions WHERE stripe_id=?").get(subscription.id);
  if (!existing && !ownMetadata(subscription.metadata)) return null;
  const attemptId = existing ? str(existing.attempt_id) : subscription.metadata.membership_attempt_id;
  if (!attemptId || !/^[a-f0-9]{32}$/.test(attemptId)) throw new MembershipVerificationError("Membership attempt is missing");
  const attempt = await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE id=?").get(attemptId);
  const customer = attempt && await getDb().prepare("SELECT stripe_id FROM membership_customers WHERE user_id=?").get(num(attempt.user_id));
  if (!attempt || !customer || !attempt.customer_id || str(customer.stripe_id) !== id(subscription.customer) || str(attempt.customer_id) !== id(subscription.customer) ||
    Object.entries(metadata(attempt)).some(([key, value]) => subscription.metadata[key] !== value) ||
    (existing && (num(existing.user_id) !== num(attempt.user_id) || num(existing.group_id) !== num(attempt.group_id) || num(existing.plan_id) !== num(attempt.plan_id))))
    throw new MembershipVerificationError("Membership subscription ownership mismatch");
  const taxRateId = await loadTaxBinding(attempt);
  const item = subscription.items.data[0];
  const price = item?.price;
  if (subscription.currency !== "sek" || subscription.items.has_more || subscription.items.data.length !== 1 || item.quantity !== 1 ||
    !price || price.currency !== "sek" || price.unit_amount !== num(attempt.price_ore) || price.tax_behavior !== "inclusive" ||
    price.recurring?.interval !== str(attempt.interval) || price.recurring.interval_count !== 1 ||
    (existing && str(existing.price_id) !== price.id) || subscription.discounts.length || subscription.collection_method !== "charge_automatically" ||
    subscription.automatic_tax.enabled || subscription.default_tax_rates?.length !== 1 ||
    subscription.default_tax_rates[0].id !== taxRateId || item.tax_rates?.length || subscription.trial_end)
    throw new MembershipVerificationError("Membership recurring price mismatch");
  return { attempt, existing, priceId: price.id };
}
async function subscriptionCheckout(subscription: Stripe.Subscription, attempt: Row, priceId: string, stripe: Stripe) {
  let session: Stripe.Checkout.Session;
  if (attempt.session_id) session = await stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS);
  else {
    const sessions = await stripe.checkout.sessions.list({ subscription: subscription.id, limit: 2 }, API_OPTIONS);
    if (sessions.has_more || sessions.data.length !== 1) throw new MembershipVerificationError("Membership subscription checkout is missing");
    session = await stripe.checkout.sessions.retrieve(sessions.data[0].id, { expand: ["line_items"] }, API_OPTIONS);
  }
  assertSession(session, attempt);
  if (id(session.subscription) !== subscription.id || session.status !== "complete" || session.line_items?.data[0].price?.id !== priceId)
    throw new MembershipVerificationError("Membership subscription does not belong to its checkout");
  return session.id;
}
function invoiceSubscription(invoice: Stripe.Invoice) {
  return invoice.parent?.type === "subscription_details" ? id(invoice.parent.subscription_details?.subscription) : undefined;
}
async function confirmedInvoice(invoice: Stripe.Invoice, subscription: Stripe.Subscription, attempt: Row, priceId: string, stripe: Stripe) {
  const line = invoice.lines.data[0];
  const durationDays = line ? (line.period.end - line.period.start) / 86400 : 0;
  if (invoiceSubscription(invoice) !== subscription.id ||
    Object.entries(metadata(attempt)).some(([key, value]) => invoice.parent?.subscription_details?.metadata?.[key] !== value) ||
    id(invoice.customer) !== str(attempt.customer_id) || invoice.currency !== "sek" ||
    invoice.lines.has_more || invoice.lines.data.length !== 1 || invoice.total !== num(attempt.price_ore) ||
    !line || line.currency !== "sek" || line.amount !== num(attempt.price_ore) || line.quantity !== 1 ||
    id(line.pricing?.price_details?.price) !== priceId || line.parent?.type !== "subscription_item_details" ||
    line.parent.subscription_item_details?.subscription !== subscription.id || line.parent.subscription_item_details.proration ||
    line.parent.subscription_item_details.subscription_item !== subscription.items.data[0].id ||
    !Number.isSafeInteger(line.period.start) || !Number.isSafeInteger(line.period.end) || line.period.end <= line.period.start ||
    line.period.start > Math.floor(Date.now() / 1000) + 300 || line.period.end > Math.floor(Date.now() / 1000) + 370 * 86400 ||
    (str(attempt.interval) === "month" ? durationDays < 27 || durationDays > 32 : durationDays < 364 || durationDays > 367) ||
    invoice.discounts.length || (invoice.total_discount_amounts?.some((value) => value.amount !== 0) ?? false))
    throw new MembershipVerificationError("Membership invoice does not match accepted contract");
  const rateId = str(attempt.tax_rate_id);
  const rate = await stripe.taxRates.retrieve(rateId, {}, API_OPTIONS);
  assertTaxRate(rate, attempt);
  if (invoice.default_tax_rates.length !== 1 || invoice.default_tax_rates[0].id !== rateId || invoice.automatic_tax.enabled)
    throw new MembershipVerificationError("Membership invoice VAT configuration mismatch");
  // Draft/failing renewals can lack calculated tax totals. They never extend
  // access; the previous verified paid period remains the only grant.
  if (invoice.status !== "paid" || invoice.amount_paid !== num(attempt.price_ore) || invoice.amount_remaining !== 0) return null;
  const amount = inclusiveVat(attempt);
  for (const taxes of [line.taxes ?? [], invoice.total_taxes ?? []]) {
    if ((amount > 0 && taxes.length !== 1) || taxes.length > 1 || taxes.some((tax) =>
      tax.type !== "tax_rate_details" || tax.tax_rate_details?.tax_rate !== rateId || tax.tax_behavior !== "inclusive" || tax.amount !== amount ||
      tax.taxability_reason === "customer_exempt" || tax.taxability_reason === "reverse_charge"))
      throw new MembershipVerificationError("Membership invoice VAT amount mismatch");
  }
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 }, API_OPTIONS);
  const payment = payments.data[0];
  if (payments.has_more || payments.data.length !== 1 || payment.payment.type !== "payment_intent" || payment.currency !== "sek" ||
    payment.amount_paid !== num(attempt.price_ore) || id(payment.invoice) !== invoice.id || !id(payment.payment.payment_intent))
    throw new MembershipVerificationError("Membership invoice payment is not confirmed");
  const intent = await stripe.paymentIntents.retrieve(id(payment.payment.payment_intent)!, {}, API_OPTIONS);
  if (intent.status !== "succeeded" || intent.currency !== "sek" || intent.amount_received !== num(attempt.price_ore) || id(intent.customer) !== str(attempt.customer_id) || !id(intent.latest_charge))
    throw new MembershipVerificationError("Membership payment intent does not match invoice");
  const charge = await stripe.charges.retrieve(id(intent.latest_charge)!, {}, API_OPTIONS);
  if (!charge.paid || charge.status !== "succeeded" || charge.currency !== "sek" || charge.amount !== num(attempt.price_ore) ||
    id(charge.customer) !== str(attempt.customer_id) || id(charge.payment_intent) !== intent.id)
    throw new MembershipVerificationError("Membership charge does not match payment");
  return { invoiceId: invoice.id, paymentIntentId: intent.id, chargeId: charge.id,
    periodStart: new Date(line.period.start * 1000).toISOString(), periodEnd: new Date(line.period.end * 1000).toISOString(),
    blocked: charge.refunded || charge.amount_refunded >= charge.amount || charge.disputed };
}
type ChargeFlag = { chargeId: string; disputeId?: string };
async function currentChargeBlocked(flag: ChargeFlag, stripe: Stripe) {
  const charge = await stripe.charges.retrieve(flag.chargeId, {}, API_OPTIONS);
  let disputed = charge.disputed;
  if (flag.disputeId) {
    const dispute = await stripe.disputes.retrieve(flag.disputeId, {}, API_OPTIONS);
    if (id(dispute.charge) !== charge.id) throw new MembershipVerificationError("Membership dispute charge mismatch");
    disputed ||= dispute.status !== "won" && dispute.status !== "warning_closed";
  }
  return charge.refunded || charge.amount_refunded >= charge.amount || disputed;
}
async function closeUnverifiableSubscription(subscription: Stripe.Subscription, event: Stripe.Event, stripe: Stripe, lockKey: string, token: string) {
  if (!["customer.subscription.deleted", "customer.subscription.updated"].includes(event.type) ||
    !["canceled", "incomplete_expired"].includes(subscription.status)) return false;
  const existing = await getDb().prepare(`SELECT s.*,t.stripe_id AS tax_rate_id FROM membership_subscriptions s
    LEFT JOIN membership_checkout_tax_rates t ON t.attempt_id=s.attempt_id WHERE s.stripe_id=?`).get(subscription.id);
  if (!existing || (!existing.blocked && existing.tax_rate_id)) return false;
  if (id(subscription.customer) !== str(existing.customer_id)) throw new MembershipVerificationError("Canceled membership customer mismatch");
  const customer = await stripe.customers.retrieve(str(existing.customer_id), {}, API_OPTIONS);
  if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== str(existing.user_id))
    throw new MembershipVerificationError("Canceled membership customer ownership mismatch");
  // A blocked or pre-release tax-less subscription must still be closable by
  // the operator. Recording a verified terminal status grants nothing and does
  // not retrofit the accepted price, tax rate, or historical paid period.
  await transaction(async () => {
    await assertLock(lockKey, token);
    await getDb().prepare("UPDATE membership_subscriptions SET status=?,blocked=1,cancel_at_period_end=?,updated_at=? WHERE stripe_id=?")
      .run(subscription.status, Number(subscription.cancel_at_period_end), now(), subscription.id);
    const attempt = await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE id=?").get(str(existing.attempt_id));
    if (attempt) await applyMembershipPurification(attempt,subscription.id,[],true);
    await getDb().prepare("INSERT INTO membership_billing_events(id,type,processed_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").run(event.id, event.type, now());
  });
  return true;
}
async function reconcileSubscription(subscriptionId: string, event: Stripe.Event, stripe: Stripe, invoiceId?: string, flag?: ChargeFlag, requireOwned = false) {
  const lockKey = `subscription:${subscriptionId}`;
  const token = await takeLock(lockKey);
  try {
    if (await getDb().prepare("SELECT id FROM membership_billing_events WHERE id=?").get(event.id)) return;
    // Fetch only after taking the durable lock. An old webhook therefore reads
    // current Stripe state and cannot restore a canceled or refunded membership.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {}, API_OPTIONS);
    if (subscription.id !== subscriptionId) throw new MembershipVerificationError("Membership subscription retrieval mismatch");
    if (await closeUnverifiableSubscription(subscription, event, stripe, lockKey, token)) return;
    const bound = await boundSubscription(subscription);
    if (!bound) {
      if (requireOwned) throw new MembershipVerificationError("Owned membership subscription lost its metadata");
      return;
    }
    const { attempt, existing, priceId } = bound;
    const sessionId = await subscriptionCheckout(subscription, attempt, priceId, stripe);
    const customer = await stripe.customers.retrieve(str(attempt.customer_id), {}, API_OPTIONS);
    if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== str(attempt.user_id))
      throw new MembershipVerificationError("Membership customer metadata mismatch");
    // Validate the event's invoice even when a newer invoice is present.
    let eventInvoice: Stripe.Invoice | undefined;
    if (invoiceId) {
      eventInvoice = await stripe.invoices.retrieve(invoiceId, {}, API_OPTIONS);
      if (invoiceSubscription(eventInvoice) !== subscriptionId) throw new MembershipVerificationError("Membership event invoice binding mismatch");
    }
    const latestInvoiceId = id(subscription.latest_invoice);
    const historicalPayment = eventInvoice && eventInvoice.id !== latestInvoiceId
      ? await confirmedInvoice(eventInvoice, subscription, attempt, priceId, stripe) : null;
    const invoice = latestInvoiceId
      ? (eventInvoice?.id === latestInvoiceId ? eventInvoice : await stripe.invoices.retrieve(latestInvoiceId, {}, API_OPTIONS))
      : eventInvoice;
    const payment = invoice ? await confirmedInvoice(invoice, subscription, attempt, priceId, stripe) : null;
    const flagged = flag ? await currentChargeBlocked(flag, stripe) : false;
    // Invoice/payment lookups can take several requests. Refresh status before
    // commit so a cancellation during that work is reflected in this delivery.
    const current = await stripe.subscriptions.retrieve(subscriptionId, {}, API_OPTIONS);
    const currentBound = await boundSubscription(current);
    if (current.id !== subscriptionId || !currentBound || str(currentBound.attempt.id) !== str(attempt.id) || currentBound.priceId !== priceId)
      throw new MembershipVerificationError("Membership subscription changed its binding");
    if (id(current.latest_invoice) !== latestInvoiceId)
      throw new Error("Membership latest invoice changed during reconciliation");
    // Status changes preserve the previously verified paid period. Only an
    // actually paid invoice can extend it; failed renewals never manufacture it.
    const paidUntil = current.status === "active" && !current.pause_collection && payment && !payment.blocked
      ? [str(existing?.paid_until), payment.periodEnd].sort().at(-1)!
      : existing?.paid_until ? str(existing.paid_until) : null;
    const status = current.pause_collection ? "paused" : current.status;
    const revoked = !!(await getDb().prepare("SELECT subscription_id FROM membership_billing_revocations WHERE subscription_id=?").get(subscriptionId));
    const blocked = revoked || flagged || !!payment?.blocked;
    await transaction(async () => {
      await assertLock(lockKey, token);
      if (await getDb().prepare("SELECT id FROM membership_billing_events WHERE id=?").get(event.id)) return;
      const duplicate = await getDb().prepare("SELECT stripe_id FROM membership_subscriptions WHERE attempt_id=? AND stripe_id<>?").get(str(attempt.id), subscription.id);
      if (duplicate) throw new Error("Membership attempt has a different subscription");
      await getDb().prepare(`INSERT INTO membership_subscriptions
        (stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,blocked,cancel_at_period_end,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stripe_id) DO UPDATE SET
        status=excluded.status,paid_until=excluded.paid_until,blocked=excluded.blocked,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at`)
        .run(subscription.id, num(attempt.user_id), num(attempt.plan_id), num(attempt.group_id), str(attempt.id), status, paidUntil, Number(blocked), Number(current.cancel_at_period_end), str(attempt.customer_id), priceId, num(attempt.price_ore), num(attempt.vat_percent), str(attempt.interval), str(attempt.created_at), now());
      if (flagged || payment?.blocked) await getDb().prepare("INSERT INTO membership_billing_revocations(subscription_id,reason,created_at) VALUES(?,'refund-or-dispute',?) ON CONFLICT(subscription_id) DO NOTHING").run(subscription.id, now());
      if (payment) await getDb().prepare(`INSERT INTO membership_paid_invoices(invoice_id,subscription_id,payment_intent_id,charge_id,period_start,period_end,amount_ore,created_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(invoice_id) DO NOTHING`).run(payment.invoiceId, subscription.id, payment.paymentIntentId, payment.chargeId, payment.periodStart, payment.periodEnd, num(attempt.price_ore), now());
      await applyMembershipPurification(attempt,subscription.id,[payment,historicalPayment].filter((p):p is NonNullable<typeof p>=>!!p),blocked);
      await getDb().prepare("UPDATE membership_checkout_attempts SET session_id=?,status='subscribed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(sessionId, now(), str(attempt.id));
      await getDb().prepare("INSERT INTO membership_billing_events(id,type,processed_at) VALUES(?,?,?)").run(event.id, event.type, now());
    });
  } catch (error) {
    // An externally changed price/owner or unverifiable payment must not keep
    // an existing paid membership open while retries investigate the mismatch.
    if (error instanceof MembershipVerificationError) await transaction(async () => {
      await assertLock(lockKey, token);
      await getDb().prepare("UPDATE membership_subscriptions SET blocked=1,updated_at=? WHERE stripe_id=?").run(now(), subscriptionId);
      const source=await getDb().prepare("SELECT a.* FROM membership_checkout_attempts a JOIN membership_subscriptions s ON s.attempt_id=a.id WHERE s.stripe_id=?").get(subscriptionId);
      if(source)await applyMembershipPurification(source,subscriptionId,[],true);
    });
    throw error;
  } finally {
    await getDb().prepare("DELETE FROM membership_billing_locks WHERE key=? AND token=?").run(lockKey, token);
  }
}
async function checkoutEvent(event: Stripe.Event, stripe: Stripe) {
  const object = event.data.object as Stripe.Checkout.Session;
  const known = await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE session_id=?").get(object.id);
  if (!known && !ownMetadata(object.metadata)) return;
  const session = await stripe.checkout.sessions.retrieve(object.id, { expand: ["line_items"] }, API_OPTIONS);
  const attempt = known ?? await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE id=?").get(str(session.metadata?.membership_attempt_id));
  if (!attempt) throw new Error("Membership checkout attempt was not found");
  await loadTaxBinding(attempt);
  assertSession(session, attempt);
  const status = session.status === "expired" ? "expired" : session.status === "complete" ? "completed" : "open";
  await transaction(async () => {
    await getDb().prepare("UPDATE membership_checkout_attempts SET session_id=?,status=CASE WHEN status='subscribed' THEN status ELSE ? END,updated_at=? WHERE id=?").run(session.id, status, now(), str(attempt.id));
    // Checkout success records its ownership only. Paid invoice reconciliation
    // is the only path that can create or extend membership access.
    await getDb().prepare("INSERT INTO membership_billing_events(id,type,processed_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").run(event.id, event.type, now());
  });
}
async function chargeEvents(event: Stripe.Event, stripe: Stripe) {
  const disputed = event.type.startsWith("charge.dispute.");
  const object = event.data.object as Stripe.Charge | Stripe.Dispute;
  const chargeId = disputed ? id((object as Stripe.Dispute).charge) : object.id;
  if (!chargeId) throw new Error("Dispute has no charge");
  const charge = await stripe.charges.retrieve(chargeId, {}, API_OPTIONS);
  const known = await getDb().prepare("SELECT invoice_id,subscription_id FROM membership_paid_invoices WHERE charge_id=? OR payment_intent_id=?").all(charge.id, id(charge.payment_intent) ?? "");
  const invoiceIds = new Set(known.map((row) => str(row.invoice_id)));
  const intent = id(charge.payment_intent);
  if (intent) {
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, status: "paid", limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, API_OPTIONS);
      for (const payment of payments.data) { const invoiceId = id(payment.invoice); if (invoiceId) invoiceIds.add(invoiceId); }
      if (!payments.has_more) break;
      cursor = payments.data.at(-1)?.id;
      if (!cursor || page === 9) throw new Error("Invoice payment linkage exceeded limit");
    }
  }
  if (!invoiceIds.size) {
    if (known.length || ownMetadata(charge.metadata)) throw new Error("Membership charge invoice linkage is missing");
    return;
  }
  // Each subscription is committed independently. Do not deduplicate the event
  // until every linked invoice has been handled (one PaymentIntent can pay many).
  for (const invoiceId of invoiceIds) {
    const invoice = await stripe.invoices.retrieve(invoiceId, {}, API_OPTIONS);
    const subscriptionId = invoiceSubscription(invoice);
    if (!subscriptionId) { if (known.some((row) => str(row.invoice_id) === invoiceId)) throw new Error("Membership invoice lost its subscription"); continue; }
    const synthetic = { ...event, id: `${event.id}:${invoiceId}` };
    await reconcileSubscription(subscriptionId, synthetic, stripe, invoiceId, { chargeId, ...(disputed ? { disputeId: object.id } : {}) },
      known.some((row) => str(row.invoice_id) === invoiceId) || ownMetadata(invoice.parent?.subscription_details?.metadata));
  }
  await getDb().prepare("INSERT INTO membership_billing_events(id,type,processed_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").run(event.id, event.type, now());
}
export async function reconcileMembershipEvent(event: Stripe.Event, stripe = getStripe()) {
  if (!event.id || !event.type || !event.data?.object) throw new Error("Membership event is malformed");
  if (await getDb().prepare("SELECT id FROM membership_billing_events WHERE id=?").get(event.id)) return;
  if (["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_failed", "checkout.session.async_payment_succeeded"].includes(event.type))
    return checkoutEvent(event, stripe);
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"].includes(event.type)) {
    const object = event.data.object as Stripe.Subscription;
    if (!ownMetadata(object.metadata) && !(await getDb().prepare("SELECT stripe_id FROM membership_subscriptions WHERE stripe_id=?").get(object.id))) return;
    return reconcileSubscription(object.id, event, stripe, undefined, undefined, true);
  }
  if (["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.marked_uncollectible", "invoice.voided", "invoice.finalization_failed"].includes(event.type)) {
    const object = event.data.object as Stripe.Invoice;
    const invoice = await stripe.invoices.retrieve(object.id, {}, API_OPTIONS);
    if (invoice.id !== object.id) throw new MembershipVerificationError("Membership invoice retrieval mismatch");
    const requireOwned = ownMetadata(object.parent?.subscription_details?.metadata) || ownMetadata(invoice.parent?.subscription_details?.metadata) ||
      !!(await getDb().prepare("SELECT invoice_id FROM membership_paid_invoices WHERE invoice_id=?").get(invoice.id));
    const subscriptionId = invoiceSubscription(invoice);
    if (!subscriptionId) {
      if (requireOwned)
        throw new Error("Membership invoice has no subscription");
      return;
    }
    return reconcileSubscription(subscriptionId, event, stripe, invoice.id, undefined, requireOwned);
  }
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type))
    return chargeEvents(event, stripe);
}
