import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { DomainError, getUser, hasCourseAccess } from "./db";
import { getDb, transaction } from "./database";
import { getCoursePurchaseOffer, hasPermanentCourseAccess, type CoursePurchaseOffer } from "./course-sales";
import { appUrl, getStripe, stripeReady } from "./stripe";
import { getStudentGroupAccessState } from "./student-access";
import { checkPurificationRevision,snapshotBundlePurification,applyBundlePurification } from "./purification-payment-hooks";
import { OneTimePaymentVerificationError as CoursePurchaseVerificationError, assertOneTimeMetadata, assertOneTimeTaxRate, assertOneTimeCheckout, verifyOneTimePayment, oneTimeCheckoutRedirect, type OneTimePaymentContract } from "./one-time-stripe-payment";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const num = (value: unknown) => Number(value);
const now = () => new Date().toISOString();
const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const APPLICATION = "slowlax.se";
const INTEGRATION = "course-purchase";
const LEASE_SECONDS = 180;
const CHECKOUT_MINUTES = 60;
const API_OPTIONS = { timeout: 10000, maxNetworkRetries: 1 };


export class CoursePurchaseHttpError extends DomainError {
  constructor(message: string, readonly status: number) { super(message); }
}
export function coursePurchaseReady() {
  if (!stripeReady()) return false;
  try { appUrl(); return true; } catch { return false; }
}
export function assertCoursePurchaseOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl() || request.headers.get("sec-fetch-site") === "cross-site")
    throw new CoursePurchaseHttpError("Kursköpet måste hanteras från hemsidan.", 403);
}
export async function readCoursePurchaseBody(request: Request, maximum = 4096) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new CoursePurchaseHttpError("Begäran är för stor.", 413);
  if (!request.body) throw new CoursePurchaseHttpError("Uppgifterna saknas.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new CoursePurchaseHttpError("Begäran är för stor.", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function coursePurchaseRequestJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new CoursePurchaseHttpError("Skicka uppgifterna som JSON.", 400);
  try { return JSON.parse(await readCoursePurchaseBody(request)); }
  catch (error) {
    if (error instanceof CoursePurchaseHttpError) throw error;
    throw new CoursePurchaseHttpError("Uppgifterna kunde inte läsas.", 400);
  }
}
export function coursePurchaseResponseError(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof CoursePurchaseHttpError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 409, headers });
  return Response.json({ error: "Kursköpet kunde inte hanteras. Försök igen om en stund." }, { status: 503, headers });
}
async function verifiedStudent(userId: number) {
  const user = await getUser(userId);
  if (!user || user.role !== "student" || !user.emailVerifiedAt)
    throw new CoursePurchaseHttpError("Logga in med ett verifierat elevkonto för att köpa en kurs.", 403);
  return user;
}
export type CoursePurchaseConsent = { consent: true; courseRevision: string; settingsRevision: string; termsRevision: string; purificationRevision?:string|null };
function matchesRevision(offer: CoursePurchaseOffer, consent: CoursePurchaseConsent) {
  if (consent.consent !== true || consent.courseRevision !== offer.courseRevision ||
    consent.settingsRevision !== offer.settingsRevision || consent.termsRevision !== offer.termsRevision)
    throw new DomainError("Priset eller villkoren har ändrats. Ladda om sidan och godkänn de aktuella villkoren.");
}
async function purchasableCourse(courseId: number, consent: CoursePurchaseConsent) {
  const offer = await getCoursePurchaseOffer(courseId);
  if (!offer || !offer.buyEnabled || !coursePurchaseReady()) throw new DomainError("Kursen kan inte köpas just nu.");
  matchesRevision(offer, consent);
  await checkPurificationRevision('bundle',courseId,consent.purificationRevision);
  return offer;
}
function metadata(attempt: Row) {
  return { application: APPLICATION, integration: INTEGRATION, course_purchase_attempt_id: str(attempt.id),
    user_id: str(attempt.user_id), course_id: str(attempt.course_id), group_id: attempt.group_id === null ? "none" : str(attempt.group_id) };
}
function ownMetadata(value: Stripe.Metadata | null | undefined) {
  return value?.application === APPLICATION && value.integration === INTEGRATION;
}
function paymentContract(attempt: Row): OneTimePaymentContract {
  return { id: str(attempt.id), customerId: str(attempt.customer_id), sessionId: attempt.session_id ? str(attempt.session_id) : null,
    taxRateId: str(attempt.tax_rate_id), amountOre: num(attempt.price_ore), vatPercent: num(attempt.vat_percent),
    createdAt: str(attempt.created_at), metadata: metadata(attempt) };
}
function assertMetadata(value: Stripe.Metadata | null | undefined, attempt: Row) {
  assertOneTimeMetadata(value, metadata(attempt));
}
async function reserveAttempt(userId: number, courseId: number, consent: CoursePurchaseConsent) {
  return transaction(async () => {
    await verifiedStudent(userId);
    const offer = await purchasableCourse(courseId, consent);
    if (await hasPermanentCourseAccess(userId, courseId))
      throw new DomainError("Du har redan köpt den här kursen. Öppna den i elevportalen.");
    // Local time alone cannot prove an uncertain Stripe request failed. An
    // abandoned attempt is released only after its remote session is checked.
    let attempt = await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE user_id=? AND course_id=? AND status IN ('creating','open','completed') ORDER BY created_at DESC LIMIT 1").get(userId, courseId);
    const fresh = !attempt;
    if (attempt) {
      if (str(attempt.course_revision) !== consent.courseRevision || str(attempt.settings_revision) !== consent.settingsRevision)
        throw new DomainError("En betalning för kursen pågår redan. Slutför den eller avbryt den under Mina köp innan du väljer det nya erbjudandet.");
      if (attempt.status === "completed") throw new DomainError("Betalningen behandlas. Kursen visas när Stripe har bekräftat den.");
      if (str(attempt.lease_until) > now()) throw new DomainError("Betalningen öppnas redan. Försök igen om en stund.");
      if (str(attempt.expires_at) <= now()) throw new DomainError("Betalningens tid har gått ut. Avbryt den under Mina köp innan du försöker igen.");
    } else {
      const timestamp = now(), attemptId = randomBytes(16).toString("hex");
      await getDb().prepare(`INSERT INTO course_purchase_attempts
        (id,user_id,course_id,course_title,course_slug,course_revision,settings_revision,terms,price_ore,vat_percent,group_id,group_name,group_access_days,status,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?)`)
        .run(attemptId, userId, courseId, offer.title, offer.slug, offer.courseRevision, offer.settingsRevision, offer.terms, offer.priceOre,
          offer.vatPercent, offer.groupId, offer.groupName, offer.groupAccessDays, new Date(Date.now() + CHECKOUT_MINUTES * 60000).toISOString(), timestamp, timestamp);
      for (const course of offer.courses) await getDb().prepare("INSERT INTO course_purchase_attempt_courses(attempt_id,course_id,title,slug) VALUES(?,?,?,?)")
        .run(attemptId, course.id, course.title, course.slug);
      for (const group of offer.groups) await getDb().prepare("INSERT INTO course_purchase_attempt_groups(attempt_id,group_id,group_name,access_days) VALUES(?,?,?,?)")
        .run(attemptId, group.id, group.name, group.accessDays);
      attempt = (await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE id=?").get(attemptId))!;
      await snapshotBundlePurification(attemptId,courseId);
    }
    const token = randomBytes(16).toString("hex");
    await getDb().prepare("UPDATE course_purchase_attempts SET lease_token=?,lease_until=?,updated_at=? WHERE id=?")
      .run(token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), now(), str(attempt.id));
    return { attempt, token, fresh };
  });
}
async function assertAttemptLease(attempt: Row, token: string) {
  if (!(await getDb().prepare("SELECT id FROM course_purchase_attempts WHERE id=? AND lease_token=? AND lease_until>?").get(str(attempt.id), token, now())))
    throw new Error("Course checkout lease expired");
}
async function ensureCustomer(userId: number, stripe: Stripe) {
  const user = await verifiedStudent(userId);
  const existing = await getDb().prepare("SELECT stripe_id FROM course_purchase_customers WHERE user_id=?").get(userId);
  const userMetadata = { application: APPLICATION, integration: INTEGRATION, user_id: String(userId) };
  const customer = existing
    ? await stripe.customers.retrieve(str(existing.stripe_id), {}, API_OPTIONS)
    : await stripe.customers.create({ email: user.email, name: user.name, metadata: userMetadata },
      { ...API_OPTIONS, idempotencyKey: `course-customer-${userId}-${createHash("sha256").update(user.createdAt).digest("hex").slice(0, 20)}` });
  if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== String(userId) ||
    (customer.tax_exempt && customer.tax_exempt !== "none")) throw new CoursePurchaseVerificationError("Course customer ownership mismatch");
  await transaction(async () => {
    await verifiedStudent(userId);
    await getDb().prepare("INSERT INTO course_purchase_customers(user_id,stripe_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING").run(userId, customer.id, now());
    const bound = await getDb().prepare("SELECT stripe_id FROM course_purchase_customers WHERE user_id=?").get(userId);
    if (str(bound?.stripe_id) !== customer.id) throw new CoursePurchaseVerificationError("Course customer binding mismatch");
  });
  return customer.id;
}
function assertTaxRate(rate: Stripe.TaxRate, attempt: Row, newCheckout = false) {
  assertOneTimeTaxRate(rate, paymentContract(attempt), newCheckout);
}
async function ensureTaxRate(attempt: Row, token: string, stripe: Stripe) {
  const rate = attempt.tax_rate_id
    ? await stripe.taxRates.retrieve(str(attempt.tax_rate_id), {}, API_OPTIONS)
    : await stripe.taxRates.create({ display_name: "Moms", inclusive: true, percentage: num(attempt.vat_percent), country: "SE",
      jurisdiction: "Sverige", tax_type: "vat", metadata: metadata(attempt) }, { ...API_OPTIONS, idempotencyKey: `course-vat-${attempt.id}` });
  attempt.tax_rate_id = rate.id;
  assertTaxRate(rate, attempt, !attempt.session_id);
  await transaction(async () => {
    await assertAttemptLease(attempt, token);
    const bound = await getDb().prepare("SELECT tax_rate_id FROM course_purchase_attempts WHERE id=?").get(str(attempt.id));
    if (bound?.tax_rate_id && str(bound.tax_rate_id) !== rate.id) throw new CoursePurchaseVerificationError("Course VAT binding changed");
    await getDb().prepare("UPDATE course_purchase_attempts SET tax_rate_id=? WHERE id=? AND tax_rate_id IS NULL").run(rate.id, str(attempt.id));
  });
  return rate.id;
}
function assertSession(session: Stripe.Checkout.Session, attempt: Row) {
  assertOneTimeCheckout(session, paymentContract(attempt));
}
const checkoutRedirect = oneTimeCheckoutRedirect;
export async function createCoursePurchaseCheckout(userId: number, courseId: number, consent: CoursePurchaseConsent) {
  const stripe = getStripe();
  const { attempt, token, fresh } = await reserveAttempt(userId, courseId, consent);
  let sessionId: string | undefined, checkoutRequested = false;
  try {
    const customer = await ensureCustomer(userId, stripe);
    await transaction(async () => {
      await verifiedStudent(userId); await purchasableCourse(courseId, consent); await assertAttemptLease(attempt, token);
      await getDb().prepare("UPDATE course_purchase_attempts SET customer_id=? WHERE id=? AND (customer_id IS NULL OR customer_id=?)").run(customer, str(attempt.id), customer);
    });
    attempt.customer_id = customer;
    const taxRate = await ensureTaxRate(attempt, token, stripe);
    await transaction(async () => { await verifiedStudent(userId); await purchasableCourse(courseId, consent); await assertAttemptLease(attempt, token); });
    checkoutRequested = true;
    const session = attempt.session_id
      ? await stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS)
      : await stripe.checkout.sessions.create({
        mode: "payment", allowed_payment_method_types: ["card"], customer, expand: ["line_items"],
        client_reference_id: str(attempt.id), metadata: metadata(attempt), payment_intent_data: { metadata: metadata(attempt) },
        billing_address_collection: "required", customer_update: { address: "auto" },
        line_items: [{ quantity: 1, tax_rates: [taxRate], price_data: { currency: "sek", unit_amount: num(attempt.price_ore),
          tax_behavior: "inclusive", product_data: { name: str(attempt.course_title), metadata: metadata(attempt) } } }],
        expires_at: Math.floor(Date.parse(str(attempt.expires_at)) / 1000),
        success_url: `${appUrl()}/kurskop/bekraftelse?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/elevportal/kop?cancelled=1`,
      }, { ...API_OPTIONS, idempotencyKey: `course-checkout-${attempt.id}` });
    sessionId = session.id;
    assertSession(session, attempt);
    if (session.status !== "open") throw new DomainError("Betalningen är avslutad eller behandlas. Kontrollera ditt köp i elevportalen.");
    const url = checkoutRedirect(session.url);
    await transaction(async () => {
      await verifiedStudent(userId); await purchasableCourse(courseId, consent); await assertAttemptLease(attempt, token);
      const changed = await getDb().prepare("UPDATE course_purchase_attempts SET session_id=?,status='open',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status IN ('creating','open')")
        .run(session.id, now(), str(attempt.id), token);
      if (!changed.changes) throw new Error("Course checkout reservation changed");
    });
    return url;
  } catch (error) {
    // A failed response may have created a session remotely. Keep that durable
    // reservation and its idempotency key so retries cannot create a second bill.
    if (sessionId && !attempt.session_id) {
      try {
        const expired = await stripe.checkout.sessions.expire(sessionId, {}, API_OPTIONS);
        if (expired.status === "expired") await getDb().prepare("UPDATE course_purchase_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status IN ('creating','open')").run(now(), str(attempt.id), token);
      } catch { /* Signed late payments remain bound to the original contract. */ }
    }
    if (fresh && !checkoutRequested) await getDb().prepare("UPDATE course_purchase_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status='creating'").run(now(), str(attempt.id), token);
    throw error;
  } finally {
    await getDb().prepare("UPDATE course_purchase_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
  }
}

async function attemptSession(attempt: Row, stripe: Stripe, allowMissingAfterExpiry = false): Promise<Stripe.Checkout.Session | null> {
  if (attempt.session_id) return stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS);
  if (!attempt.customer_id) {
    if (allowMissingAfterExpiry && Date.parse(str(attempt.expires_at)) + LEASE_SECONDS * 1000 < Date.now()) return null;
    throw new DomainError("Betalningen behandlas fortfarande. Försök igen om en stund.");
  }
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.checkout.sessions.list({ customer: str(attempt.customer_id), limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, API_OPTIONS);
    const matches = result.data.filter(session => session.client_reference_id === str(attempt.id) && session.metadata?.course_purchase_attempt_id === str(attempt.id));
    if (matches.length > 1) throw new CoursePurchaseVerificationError("Course attempt has multiple sessions");
    if (matches.length) return stripe.checkout.sessions.retrieve(matches[0].id, { expand: ["line_items"] }, API_OPTIONS);
    if (!result.has_more) {
      if (allowMissingAfterExpiry && Date.parse(str(attempt.expires_at)) + LEASE_SECONDS * 1000 < Date.now()) return null;
      break;
    }
    cursor = result.data.at(-1)?.id;
    if (!cursor || page === 9) throw new Error("Course customer checkout lookup exceeded limit");
  }
  throw new DomainError("Betalningen behandlas fortfarande. Försök igen om en stund.");
}
export async function cancelCoursePurchaseCheckout(userId: number, courseId: number) {
  await verifiedStudent(userId);
  const { attempt, token } = await transaction(async () => {
    await verifiedStudent(userId);
    const attempt = await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE user_id=? AND course_id=? AND status IN ('creating','open','completed') ORDER BY created_at DESC LIMIT 1").get(userId, courseId);
    if (!attempt) return { attempt: null, token: "" };
    if (attempt.status === "completed") throw new DomainError("Betalningen är avslutad och behandlas. Kontrollera ditt köp i elevportalen.");
    if (str(attempt.lease_until) > now()) throw new DomainError("Betalningen öppnas redan. Försök igen om en stund.");
    const token = randomBytes(16).toString("hex");
    await getDb().prepare("UPDATE course_purchase_attempts SET lease_token=?,lease_until=? WHERE id=?").run(token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), str(attempt.id));
    return { attempt, token };
  });
  if (!attempt) return;
  try {
    const stripe = getStripe();
    let session = await attemptSession(attempt, stripe, true);
    if (session) {
      assertSession(session, attempt);
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(session.id, {}, API_OPTIONS);
        session = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items"] }, API_OPTIONS);
        assertSession(session, attempt);
      }
      if (!["expired", "complete"].includes(str(session.status))) throw new Error("Course checkout cancellation not confirmed");
    }
    await transaction(async () => {
      await verifiedStudent(userId); await assertAttemptLease(attempt, token);
      await getDb().prepare("UPDATE course_purchase_attempts SET session_id=COALESCE(?,session_id),status=CASE WHEN status='paid' THEN status ELSE ? END,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?")
        .run(session?.id ?? null, session?.status === "complete" ? "completed" : "cancelled", now(), str(attempt.id), token);
    });
    if (session?.status === "complete") throw new DomainError("Betalningen är avslutad och behandlas. Kontrollera ditt köp i elevportalen.");
  } finally {
    await getDb().prepare("UPDATE course_purchase_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
  }
}

export type PendingCoursePurchase = { courseId: number; title: string; slug: string; priceOre: number; expiresAt: string; canCancel: boolean; isBundle: boolean };
export async function getUserPendingCoursePurchases(userId: number): Promise<PendingCoursePurchase[]> {
  await verifiedStudent(userId);
  return (await getDb().prepare(`SELECT a.*,c.slug AS current_slug,EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=a.course_id) AS is_bundle FROM course_purchase_attempts a JOIN courses c ON c.id=a.course_id
    WHERE a.user_id=? AND a.status IN ('creating','open','completed') ORDER BY a.created_at DESC`).all(userId))
    .map(row => ({ courseId: num(row.course_id), title: str(row.course_title), slug: str(row.current_slug), priceOre: num(row.price_ore),
      expiresAt: str(row.expires_at), canCancel: row.status !== "completed", isBundle: !!row.is_bundle }));
}
export type PurchaseCourse = { id: number; title: string; slug: string; available: boolean };
export type PurchaseGroup = { id: number; name: string; expiresAt: string | null; available: boolean };
async function purchaseContents(attemptId: string, courseId: number, userId?: number) {
  const isBundle = !!await getDb().prepare("SELECT course_id FROM course_bundles WHERE course_id=?").get(courseId);
  let courseRows = await getDb().prepare(`SELECT s.course_id AS id,s.title,c.slug FROM course_purchase_attempt_courses s JOIN courses c ON c.id=s.course_id WHERE s.attempt_id=? ORDER BY s.title,s.course_id`).all(attemptId);
  if (!courseRows.length) courseRows = await getDb().prepare("SELECT id,title,slug FROM courses WHERE id=?").all(courseId);
  if (isBundle) courseRows = courseRows.filter(row => num(row.id) !== courseId);
  let groupRows = await getDb().prepare(`SELECT s.group_id AS id,s.group_name AS name,s.access_days,p.paid_at,NULL AS expires_at FROM course_purchase_attempt_groups s
    LEFT JOIN course_purchases p ON p.attempt_id=s.attempt_id WHERE s.attempt_id=? ORDER BY s.group_name,s.group_id`).all(attemptId);
  if (!groupRows.length) groupRows = await getDb().prepare(`SELECT a.group_id AS id,a.group_name AS name,NULL AS access_days,p.paid_at,p.group_expires_at AS expires_at FROM course_purchase_attempts a
    LEFT JOIN course_purchases p ON p.attempt_id=a.id WHERE a.id=? AND a.group_id IS NOT NULL`).all(attemptId);
  const courses: PurchaseCourse[] = await Promise.all(courseRows.map(async row => ({ id: num(row.id), title: str(row.title), slug: str(row.slug), available: userId ? await hasCourseAccess(userId, num(row.id)) : false })));
  const groups: PurchaseGroup[] = await Promise.all(groupRows.map(async row => ({ id: num(row.id), name: str(row.name),
    expiresAt: row.access_days != null && row.paid_at ? new Date(Date.parse(str(row.paid_at)) + num(row.access_days) * 86400000).toISOString() : row.expires_at ? str(row.expires_at) : null,
    available: userId ? !!(await getStudentGroupAccessState(userId, num(row.id)))?.available : false })));
  return { isBundle, courses, groups };
}
export type CoursePurchaseConfirmation = { courseId: number; title: string; slug: string; groupId: number | null; groupName: string | null;
  groupExpiresAt: string | null; priceOre: number; status: "paid" | "pending" | "cancelled" | "blocked"; confirmed: boolean;
  courseAvailable: boolean; groupAvailable: boolean; isBundle: boolean; courses: PurchaseCourse[]; groups: PurchaseGroup[] };
export async function getCoursePurchaseConfirmation(userId: number, sessionId: string): Promise<CoursePurchaseConfirmation | null> {
  await verifiedStudent(userId);
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return null;
  const row = await getDb().prepare(`SELECT a.*,c.slug AS current_slug,p.id AS purchase_id,p.revoked,p.group_expires_at,g.published AS group_published FROM course_purchase_attempts a
    JOIN courses c ON c.id=a.course_id LEFT JOIN course_purchases p ON p.attempt_id=a.id LEFT JOIN membership_groups g ON g.id=a.group_id
    WHERE a.user_id=? AND a.session_id=?`).get(userId, sessionId);
  if (!row) return null;
  const status = row.revoked ? "blocked" : row.purchase_id && row.status === "paid" ? "paid" : ["expired", "cancelled"].includes(str(row.status)) ? "cancelled" : "pending";
  const contents = await purchaseContents(str(row.id), num(row.course_id), userId);
  return { ...contents, courseId: num(row.course_id), title: str(row.course_title), slug: str(row.current_slug), groupId: row.group_id === null ? null : num(row.group_id),
    groupName: row.group_name === null ? null : str(row.group_name), groupExpiresAt: row.group_expires_at ? str(row.group_expires_at) : null,
    priceOre: num(row.price_ore), status, confirmed: status === "paid", courseAvailable: contents.courses.some(course => course.available),
    groupAvailable: contents.groups.some(group => group.available) };
}
export type CoursePurchaseView = { id: string; courseId: number; title: string; slug: string; name: string; email: string;
  groupId: number | null; groupName: string | null; groupExpiresAt: string | null; priceOre: number; vatPercent: number;
  paidAt: string; revoked: boolean; revocationReason: string | null; terms: string; courseAvailable?: boolean; groupAvailable?: boolean;
  isBundle: boolean; courses: PurchaseCourse[]; groups: PurchaseGroup[] };
const PURCHASE_VIEW = `SELECT p.*,a.course_title,c.slug AS current_slug,a.group_name,a.terms,u.name,u.email FROM course_purchases p
  JOIN course_purchase_attempts a ON a.id=p.attempt_id JOIN courses c ON c.id=p.course_id JOIN users u ON u.id=p.user_id`;
async function purchaseView(row: Row, userId?: number): Promise<CoursePurchaseView> {
  return { ...await purchaseContents(str(row.attempt_id), num(row.course_id), userId), id: str(row.id), courseId: num(row.course_id), title: str(row.course_title), slug: str(row.current_slug), name: str(row.name), email: str(row.email),
    groupId: row.group_id === null ? null : num(row.group_id), groupName: row.group_name === null ? null : str(row.group_name),
    groupExpiresAt: row.group_expires_at ? str(row.group_expires_at) : null, priceOre: num(row.price_ore), vatPercent: num(row.vat_percent),
    paidAt: str(row.paid_at), revoked: !!row.revoked, revocationReason: row.revocation_reason ? str(row.revocation_reason) : null, terms: str(row.terms) };
}
export async function getAdminCoursePurchases(actorId: number, courseId?: number): Promise<CoursePurchaseView[]> {
  if ((await getUser(actorId))?.role !== "admin") throw new DomainError("Du har inte tillgång till administrationen.");
  return Promise.all((await getDb().prepare(`${PURCHASE_VIEW} ${courseId === undefined ? "" : "WHERE p.course_id=? OR EXISTS(SELECT 1 FROM course_purchase_attempt_courses sc WHERE sc.attempt_id=p.attempt_id AND sc.course_id=?)"} ORDER BY p.paid_at DESC`).all(...courseId === undefined ? [] : [courseId, courseId])).map(row => purchaseView(row)));
}
export async function getUserCoursePurchases(userId: number): Promise<CoursePurchaseView[]> {
  await verifiedStudent(userId);
  const purchases = await Promise.all((await getDb().prepare(`${PURCHASE_VIEW} WHERE p.user_id=? ORDER BY p.paid_at DESC`).all(userId)).map(row => purchaseView(row, userId)));
  return Promise.all(purchases.map(async purchase => ({ ...purchase,
    courseAvailable: purchase.courses.some(course => course.available),
    groupAvailable: purchase.groups.some(group => group.available),
  })));
}

async function takeLock(key: string) {
  return transaction(async () => {
    const token = randomBytes(16).toString("hex");
    const result = await getDb().prepare(`INSERT INTO course_purchase_locks(key,token,expires_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE course_purchase_locks.expires_at<=?`)
      .run(key, token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), now());
    if (!result.changes) throw new Error("Course payment reconciliation already running");
    return token;
  });
}
async function assertLock(key: string, token: string) {
  if (!(await getDb().prepare("SELECT key FROM course_purchase_locks WHERE key=? AND token=? AND expires_at>?").get(key, token, now())))
    throw new Error("Course payment reconciliation lease expired");
}
async function boundAttempt(session: Stripe.Checkout.Session) {
  const known = await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE session_id=?").get(session.id);
  if (!known && !ownMetadata(session.metadata)) return null;
  const attemptId = known ? str(known.id) : session.metadata?.course_purchase_attempt_id;
  if (!attemptId || !/^[a-f0-9]{32}$/.test(attemptId)) throw new CoursePurchaseVerificationError("Course purchase attempt is missing");
  const attempt = known ?? await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE id=?").get(attemptId);
  if (!attempt || !attempt.customer_id || !attempt.tax_rate_id) throw new CoursePurchaseVerificationError("Course purchase contract is missing");
  const customer = await getDb().prepare("SELECT stripe_id FROM course_purchase_customers WHERE user_id=?").get(num(attempt.user_id));
  if (!customer || str(customer.stripe_id) !== str(attempt.customer_id)) throw new CoursePurchaseVerificationError("Course customer binding is missing");
  assertSession(session, attempt);
  return attempt;
}
async function verifiedPayment(session: Stripe.Checkout.Session, attempt: Row, stripe: Stripe) {
  return verifyOneTimePayment(session, paymentContract(attempt), stripe);
}
async function reconcileSession(sessionId: string, event: Stripe.Event, stripe: Stripe, dispute?: Stripe.Dispute) {
  let session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }, API_OPTIONS);
  const known = await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE session_id=?").get(sessionId);
  if (!known && !ownMetadata(session.metadata)) return false;
  const attempt = known ?? await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE id=?").get(str(session.metadata?.course_purchase_attempt_id));
  if (!attempt) throw new CoursePurchaseVerificationError("Course checkout contract missing");
  const key = `attempt:${attempt.id}`, token = await takeLock(key);
  try {
    if (await getDb().prepare("SELECT id FROM course_purchase_events WHERE id=?").get(event.id)) return true;
    const initialAttempt = await boundAttempt(session);
    if (!initialAttempt || str(initialAttempt.id) !== str(attempt.id)) throw new CoursePurchaseVerificationError("Course checkout binding changed");
    const tax = await stripe.taxRates.retrieve(str(attempt.tax_rate_id), {}, API_OPTIONS);
    assertTaxRate(tax, attempt);
    const payment = await verifiedPayment(session, attempt, stripe);
    if (dispute) {
      if (!payment || identifier(dispute.charge) !== payment.chargeId || identifier(dispute.payment_intent) !== payment.intentId || dispute.currency !== "sek" ||
        !Number.isSafeInteger(dispute.amount) || dispute.amount < 1 || dispute.amount > num(attempt.price_ore))
        throw new CoursePurchaseVerificationError("Course dispute binding mismatch");
      payment.blocked = true;
    }
    // Refunds and disputes can arrive while these requests are in flight.
    // Refresh both session and payment immediately before the fenced commit.
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }, API_OPTIONS);
    const currentAttempt = await boundAttempt(session);
    if (!currentAttempt || str(currentAttempt.id) !== str(attempt.id)) throw new CoursePurchaseVerificationError("Course checkout binding changed");
    const current = await verifiedPayment(session, attempt, stripe);
    if (payment && (!current || current.intentId !== payment.intentId || current.chargeId !== payment.chargeId || current.paidAt !== payment.paidAt))
      throw new CoursePurchaseVerificationError("Course payment changed during reconciliation");
    const paid = current;
    if (!paid && await getDb().prepare("SELECT id FROM course_purchases WHERE attempt_id=?").get(str(attempt.id)))
      throw new CoursePurchaseVerificationError("Verified course purchase lost its paid checkout");
    if (paid && payment?.blocked) paid.blocked = true;
    await transaction(async () => {
      await assertLock(key, token);
      if (await getDb().prepare("SELECT id FROM course_purchase_events WHERE id=?").get(event.id)) return;
      const timestamp = now();
      if (paid) {
        // These source records never overwrite manual grants or lifetime
        // enrollments. Revocation is permanent for this specific paid source.
        const groupExpires = attempt.group_id !== null && attempt.group_access_days !== null
          ? new Date(Date.parse(paid.paidAt) + num(attempt.group_access_days) * 86400000).toISOString() : null;
        await getDb().prepare("UPDATE course_purchase_attempts SET session_id=?,status='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(session.id, timestamp, str(attempt.id));
        await getDb().prepare(`INSERT INTO course_purchases
          (id,attempt_id,user_id,course_id,group_id,group_expires_at,session_id,payment_intent_id,charge_id,price_ore,vat_percent,paid_at,revoked,revocation_reason,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET
          revoked=MAX(course_purchases.revoked,excluded.revoked),revocation_reason=COALESCE(course_purchases.revocation_reason,excluded.revocation_reason),updated_at=excluded.updated_at`)
          .run(str(attempt.id), str(attempt.id), num(attempt.user_id), num(attempt.course_id), attempt.group_id === null ? null : num(attempt.group_id), groupExpires,
            session.id, paid.intentId, paid.chargeId, num(attempt.price_ore), num(attempt.vat_percent), paid.paidAt, Number(paid.blocked), paid.blocked ? "refund-or-dispute" : null, timestamp);
        const stored = await getDb().prepare("SELECT * FROM course_purchases WHERE attempt_id=?").get(str(attempt.id));
        if (!stored || str(stored.session_id) !== session.id || str(stored.payment_intent_id) !== paid.intentId || str(stored.charge_id) !== paid.chargeId)
          throw new CoursePurchaseVerificationError("Course purchase source changed");
        await applyBundlePurification(attempt,paid.paidAt,!!stored.revoked);
      } else {
        const status = session.status === "expired" ? "expired" : session.status === "complete" ? "completed" : "open";
        await getDb().prepare("UPDATE course_purchase_attempts SET session_id=?,status=CASE WHEN status='paid' THEN status ELSE ? END,updated_at=? WHERE id=?")
          .run(session.id, status, timestamp, str(attempt.id));
      }
      await getDb().prepare("INSERT INTO course_purchase_events(id,type,processed_at) VALUES(?,?,?)").run(event.id, event.type, timestamp);
    });
    return true;
  } catch (error) {
    if (error instanceof CoursePurchaseVerificationError) await transaction(async () => {
      await assertLock(key, token);
      await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason=COALESCE(revocation_reason,'payment-verification-failed'),updated_at=? WHERE attempt_id=?").run(now(), str(attempt.id));
      await applyBundlePurification(attempt,now(),true);
    });
    throw error;
  } finally {
    await getDb().prepare("DELETE FROM course_purchase_locks WHERE key=? AND token=?").run(key, token);
  }
}
async function reconcileCharge(event: Stripe.Event, stripe: Stripe) {
  const disputed = event.type.startsWith("charge.dispute.");
  const object = event.data.object as Stripe.Charge | Stripe.Dispute;
  const chargeId = disputed ? identifier((object as Stripe.Dispute).charge) : object.id;
  if (!chargeId) return false;
  let known = await getDb().prepare("SELECT a.* FROM course_purchase_attempts a JOIN course_purchases p ON p.attempt_id=a.id WHERE p.charge_id=?").get(chargeId);
  // Foreign events have their own webhook and should not retry this handler.
  if (!known && !disputed && !ownMetadata((object as Stripe.Charge).metadata)) return false;
  try {
    const charge = await stripe.charges.retrieve(chargeId, {}, API_OPTIONS);
    if (charge.id !== chargeId) throw new CoursePurchaseVerificationError("Course charge retrieval mismatch");
    if (!known && !ownMetadata(charge.metadata)) return false;
    if (!known) known = await getDb().prepare("SELECT * FROM course_purchase_attempts WHERE id=?").get(str(charge.metadata.course_purchase_attempt_id));
    if (!known) throw new CoursePurchaseVerificationError("Course charge contract missing");
    assertMetadata(charge.metadata, known);
    const session = await attemptSession(known, stripe);
    if (!session) throw new Error("Course charge checkout missing");
    let dispute: Stripe.Dispute | undefined;
    if (disputed) {
      dispute = await stripe.disputes.retrieve(object.id, {}, API_OPTIONS);
      if (dispute.id !== object.id || identifier(dispute.charge) !== chargeId) throw new CoursePurchaseVerificationError("Course dispute retrieval mismatch");
    }
    return reconcileSession(session.id, event, stripe, dispute);
  } catch (error) {
    // A locally bound successful charge remains identifiable even when an
    // external edit removes its metadata. Fail closed for that paid source.
    if (known && error instanceof CoursePurchaseVerificationError) await transaction(async () => {
      await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason=COALESCE(revocation_reason,'payment-verification-failed'),updated_at=? WHERE attempt_id=?")
        .run(now(), str(known!.id));
      await applyBundlePurification(known!,now(),true);
    });
    throw error;
  }
}
/** Returns true for Slowlax course payments and false for unrelated events. */
export async function reconcileCoursePurchaseEvent(event: Stripe.Event, stripe = getStripe()): Promise<boolean> {
  if (!event.id || !event.type || !event.data?.object) throw new Error("Course purchase event is malformed");
  if (await getDb().prepare("SELECT id FROM course_purchase_events WHERE id=?").get(event.id)) return true;
  if (["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_failed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    const object = event.data.object as Stripe.Checkout.Session;
    const known = await getDb().prepare("SELECT id FROM course_purchase_attempts WHERE session_id=?").get(object.id);
    if (!known && !ownMetadata(object.metadata)) return false;
    return reconcileSession(object.id, event, stripe);
  }
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) return reconcileCharge(event, stripe);
  return false;
}
