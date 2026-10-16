import { createHash, randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { getReningOffer, getReningSettings, reningBillingReady } from "./rening-offers";
import { grantPurificationCredits, revokePurificationCreditSource } from "./purification-domain";
import type Stripe from "stripe";
import { DomainError, getUser } from "./db";
import { getDb, transaction } from "./database";
import { appUrl, getStripe } from "./stripe";
import { OneTimePaymentVerificationError as PurificationPurchaseVerificationError, assertOneTimeMetadata, assertOneTimeTaxRate, assertOneTimeCheckout, verifyOneTimePayment, oneTimeCheckoutRedirect, type OneTimePaymentContract } from "./one-time-stripe-payment";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const num = (value: unknown) => Number(value);
const now = () => new Date().toISOString();
const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const APPLICATION = "slowlax.se";
const INTEGRATION = "rening-purchase";
const LEASE_SECONDS = 180;
const CHECKOUT_MINUTES = 60;
const API_OPTIONS = { timeout: 10000, maxNetworkRetries: 1 };


export class PurificationPurchaseHttpError extends DomainError {
  constructor(message: string, readonly status: number) { super(message); }
}
export function purificationPurchaseReady(){ return reningBillingReady(); }
export function assertPurificationPurchaseOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl() || request.headers.get("sec-fetch-site") === "cross-site")
    throw new PurificationPurchaseHttpError("Rening-köpet måste hanteras från hemsidan.", 403);
}
export async function readPurificationPurchaseBody(request: Request, maximum = 4096) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new PurificationPurchaseHttpError("Begäran är för stor.", 413);
  if (!request.body) throw new PurificationPurchaseHttpError("Uppgifterna saknas.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new PurificationPurchaseHttpError("Begäran är för stor.", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function purificationPurchaseRequestJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new PurificationPurchaseHttpError("Skicka uppgifterna som JSON.", 400);
  try { return JSON.parse(await readPurificationPurchaseBody(request)); }
  catch (error) {
    if (error instanceof PurificationPurchaseHttpError) throw error;
    throw new PurificationPurchaseHttpError("Uppgifterna kunde inte läsas.", 400);
  }
}
export function purificationPurchaseResponseError(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof PurificationPurchaseHttpError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError) return Response.json({ error: "Kontrollera uppgifterna och ladda om erbjudandet." }, { status: 400, headers });
  if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 409, headers });
  return Response.json({ error: "Rening-köpet kunde inte hanteras. Försök igen om en stund." }, { status: 503, headers });
}
async function verifiedStudent(userId: number) {
  const user = await getUser(userId);
  if (!user || user.role !== "student" || !user.emailVerifiedAt)
    throw new PurificationPurchaseHttpError("Logga in med ett verifierat elevkonto för att köpa reningar.", 403);
  return user;
}
export type PurificationPurchaseConsent={consent:true;offerRevision:string;settingsRevision:string};
async function purchasableRening(offerId:number,consent:PurificationPurchaseConsent){
 const offer=await getReningOffer(offerId),settings=await getReningSettings();
 if(!offer?.published||!settings.salesEnabled||!reningBillingReady())throw new DomainError('Rening kan inte köpas just nu.');
 if(consent.consent!==true||consent.offerRevision!==offer.updatedAt||consent.settingsRevision!==settings.updatedAt)throw new DomainError('Priset eller villkoren har ändrats. Ladda om sidan.');
 return {offer,settings};
}
function metadata(a:Row){return {application:APPLICATION,integration:INTEGRATION,rening_purchase_attempt_id:str(a.id),user_id:str(a.user_id),offer_id:str(a.offer_id),credits:str(a.credits)};}
function ownMetadata(v:Stripe.Metadata|null|undefined){return v?.application===APPLICATION&&v.integration===INTEGRATION;}
function paymentContract(a:Row):OneTimePaymentContract{return {id:str(a.id),customerId:str(a.customer_id),sessionId:a.session_id?str(a.session_id):null,taxRateId:str(a.tax_rate_id),amountOre:num(a.price_ore),vatPercent:num(a.vat_percent),createdAt:str(a.created_at),metadata:metadata(a)};}
function assertMetadata(v:Stripe.Metadata|null|undefined,a:Row){assertOneTimeMetadata(v,metadata(a));}
async function reserveAttempt(userId:number,offerId:number,consent:PurificationPurchaseConsent){return transaction(async()=>{
 await verifiedStudent(userId);const {offer,settings}=await purchasableRening(offerId,consent);
 let attempt=await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE user_id=? AND offer_id=? AND status IN ('creating','open','completed') ORDER BY created_at DESC LIMIT 1").get(userId,offerId);const fresh=!attempt;
 if(attempt){if(attempt.offer_revision!==consent.offerRevision||attempt.settings_revision!==consent.settingsRevision)throw new DomainError('En betalning pågår redan. Avbryt den i Rening innan du väljer ett ändrat erbjudande.');if(attempt.status==='completed')throw new DomainError('Betalningen behandlas.');if(str(attempt.lease_until)>now())throw new DomainError('Betalningen öppnas redan. Försök igen.');if(str(attempt.expires_at)<=now())throw new DomainError('Avbryt den utgångna betalningen i Rening innan du försöker igen.');}
 else{const stamp=now(),id=randomBytes(16).toString('hex');await getDb().prepare("INSERT INTO rening_purchase_attempts(id,user_id,offer_id,offer_title,credits,offer_revision,settings_revision,terms,price_ore,vat_percent,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'creating',?,?,?)").run(id,userId,offerId,offer.title,offer.credits,offer.updatedAt,settings.updatedAt,settings.terms,offer.priceOre,offer.vatPercent,new Date(Date.now()+CHECKOUT_MINUTES*60000).toISOString(),stamp,stamp);attempt=(await getDb().prepare('SELECT * FROM rening_purchase_attempts WHERE id=?').get(id))!;}
 const token=randomBytes(16).toString('hex');await getDb().prepare('UPDATE rening_purchase_attempts SET lease_token=?,lease_until=?,updated_at=? WHERE id=?').run(token,new Date(Date.now()+LEASE_SECONDS*1000).toISOString(),now(),str(attempt.id));return {attempt,token,fresh};});}

async function assertAttemptLease(attempt: Row, token: string) {
  if (!(await getDb().prepare("SELECT id FROM rening_purchase_attempts WHERE id=? AND lease_token=? AND lease_until>?").get(str(attempt.id), token, now())))
    throw new Error("Rening checkout lease expired");
}
async function ensureCustomer(userId: number, stripe: Stripe) {
  const user = await verifiedStudent(userId);
  const existing = await getDb().prepare("SELECT stripe_id FROM rening_purchase_customers WHERE user_id=?").get(userId);
  const userMetadata = { application: APPLICATION, integration: INTEGRATION, user_id: String(userId) };
  const customer = existing
    ? await stripe.customers.retrieve(str(existing.stripe_id), {}, API_OPTIONS)
    : await stripe.customers.create({ email: user.email, name: user.name, metadata: userMetadata },
      { ...API_OPTIONS, idempotencyKey: `rening-customer-${userId}-${createHash("sha256").update(user.createdAt).digest("hex").slice(0, 20)}` });
  if (customer.deleted || !ownMetadata(customer.metadata) || customer.metadata.user_id !== String(userId) ||
    (customer.tax_exempt && customer.tax_exempt !== "none")) throw new PurificationPurchaseVerificationError("Rening customer ownership mismatch");
  await transaction(async () => {
    await verifiedStudent(userId);
    await getDb().prepare("INSERT INTO rening_purchase_customers(user_id,stripe_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING").run(userId, customer.id, now());
    const bound = await getDb().prepare("SELECT stripe_id FROM rening_purchase_customers WHERE user_id=?").get(userId);
    if (str(bound?.stripe_id) !== customer.id) throw new PurificationPurchaseVerificationError("Rening customer binding mismatch");
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
      jurisdiction: "Sverige", tax_type: "vat", metadata: metadata(attempt) }, { ...API_OPTIONS, idempotencyKey: `rening-vat-${attempt.id}` });
  attempt.tax_rate_id = rate.id;
  assertTaxRate(rate, attempt, !attempt.session_id);
  await transaction(async () => {
    await assertAttemptLease(attempt, token);
    const bound = await getDb().prepare("SELECT tax_rate_id FROM rening_purchase_attempts WHERE id=?").get(str(attempt.id));
    if (bound?.tax_rate_id && str(bound.tax_rate_id) !== rate.id) throw new PurificationPurchaseVerificationError("Rening VAT binding changed");
    await getDb().prepare("UPDATE rening_purchase_attempts SET tax_rate_id=? WHERE id=? AND tax_rate_id IS NULL").run(rate.id, str(attempt.id));
  });
  return rate.id;
}
function assertSession(session: Stripe.Checkout.Session, attempt: Row) {
  assertOneTimeCheckout(session, paymentContract(attempt));
}
const checkoutRedirect = oneTimeCheckoutRedirect;
export async function createPurificationPurchaseCheckout(userId: number, offerId: number, consent: PurificationPurchaseConsent) {
  const stripe = getStripe();
  const { attempt, token, fresh } = await reserveAttempt(userId, offerId, consent);
  let sessionId: string | undefined, checkoutRequested = false;
  try {
    const customer = await ensureCustomer(userId, stripe);
    await transaction(async () => {
      await verifiedStudent(userId); await purchasableRening(offerId, consent); await assertAttemptLease(attempt, token);
      await getDb().prepare("UPDATE rening_purchase_attempts SET customer_id=? WHERE id=? AND (customer_id IS NULL OR customer_id=?)").run(customer, str(attempt.id), customer);
    });
    attempt.customer_id = customer;
    const taxRate = await ensureTaxRate(attempt, token, stripe);
    await transaction(async () => { await verifiedStudent(userId); await purchasableRening(offerId, consent); await assertAttemptLease(attempt, token); });
    checkoutRequested = true;
    const session = attempt.session_id
      ? await stripe.checkout.sessions.retrieve(str(attempt.session_id), { expand: ["line_items"] }, API_OPTIONS)
      : await stripe.checkout.sessions.create({
        mode: "payment", allowed_payment_method_types: ["card"], customer, expand: ["line_items"],
        client_reference_id: str(attempt.id), metadata: metadata(attempt), payment_intent_data: { metadata: metadata(attempt) },
        billing_address_collection: "required", customer_update: { address: "auto" },
        line_items: [{ quantity: 1, tax_rates: [taxRate], price_data: { currency: "sek", unit_amount: num(attempt.price_ore),
          tax_behavior: "inclusive", product_data: { name: str(attempt.offer_title), metadata: metadata(attempt) } } }],
        expires_at: Math.floor(Date.parse(str(attempt.expires_at)) / 1000),
        success_url: `${appUrl()}/elevportal/rening?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/elevportal/rening?cancelled=1`,
      }, { ...API_OPTIONS, idempotencyKey: `rening-checkout-${attempt.id}` });
    sessionId = session.id;
    assertSession(session, attempt);
    if (session.status !== "open") throw new DomainError("Betalningen är avslutad eller behandlas. Kontrollera ditt köp i elevportalen.");
    const url = checkoutRedirect(session.url);
    await transaction(async () => {
      await verifiedStudent(userId); await purchasableRening(offerId, consent); await assertAttemptLease(attempt, token);
      const changed = await getDb().prepare("UPDATE rening_purchase_attempts SET session_id=?,status='open',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status IN ('creating','open')")
        .run(session.id, now(), str(attempt.id), token);
      if (!changed.changes) throw new Error("Rening checkout reservation changed");
    });
    return url;
  } catch (error) {
    // A failed response may have created a session remotely. Keep that durable
    // reservation and its idempotency key so retries cannot create a second bill.
    if (sessionId && !attempt.session_id) {
      try {
        const expired = await stripe.checkout.sessions.expire(sessionId, {}, API_OPTIONS);
        if (expired.status === "expired") await getDb().prepare("UPDATE rening_purchase_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status IN ('creating','open')").run(now(), str(attempt.id), token);
      } catch { /* Signed late payments remain bound to the original contract. */ }
    }
    if (fresh && !checkoutRequested) await getDb().prepare("UPDATE rening_purchase_attempts SET status='expired',updated_at=? WHERE id=? AND lease_token=? AND status='creating'").run(now(), str(attempt.id), token);
    throw error;
  } finally {
    await getDb().prepare("UPDATE rening_purchase_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
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
    const matches = result.data.filter(session => session.client_reference_id === str(attempt.id) && session.metadata?.rening_purchase_attempt_id === str(attempt.id));
    if (matches.length > 1) throw new PurificationPurchaseVerificationError("Rening attempt has multiple sessions");
    if (matches.length) return stripe.checkout.sessions.retrieve(matches[0].id, { expand: ["line_items"] }, API_OPTIONS);
    if (!result.has_more) {
      if (allowMissingAfterExpiry && Date.parse(str(attempt.expires_at)) + LEASE_SECONDS * 1000 < Date.now()) return null;
      break;
    }
    cursor = result.data.at(-1)?.id;
    if (!cursor || page === 9) throw new Error("Rening customer checkout lookup exceeded limit");
  }
  throw new DomainError("Betalningen behandlas fortfarande. Försök igen om en stund.");
}
export async function cancelPurificationPurchaseCheckout(userId: number, offerId: number) {
  await verifiedStudent(userId);
  const { attempt, token } = await transaction(async () => {
    await verifiedStudent(userId);
    const attempt = await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE user_id=? AND offer_id=? AND status IN ('creating','open','completed') ORDER BY created_at DESC LIMIT 1").get(userId, offerId);
    if (!attempt) return { attempt: null, token: "" };
    if (attempt.status === "completed") throw new DomainError("Betalningen är avslutad och behandlas. Kontrollera ditt köp i elevportalen.");
    if (str(attempt.lease_until) > now()) throw new DomainError("Betalningen öppnas redan. Försök igen om en stund.");
    const token = randomBytes(16).toString("hex");
    await getDb().prepare("UPDATE rening_purchase_attempts SET lease_token=?,lease_until=? WHERE id=?").run(token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), str(attempt.id));
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
      if (!["expired", "complete"].includes(str(session.status))) throw new Error("Rening checkout cancellation not confirmed");
    }
    await transaction(async () => {
      await verifiedStudent(userId); await assertAttemptLease(attempt, token);
      await getDb().prepare("UPDATE rening_purchase_attempts SET session_id=COALESCE(?,session_id),status=CASE WHEN status='paid' THEN status ELSE ? END,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?")
        .run(session?.id ?? null, session?.status === "complete" ? "completed" : "cancelled", now(), str(attempt.id), token);
    });
    if (session?.status === "complete") throw new DomainError("Betalningen är avslutad och behandlas. Kontrollera ditt köp i elevportalen.");
  } finally {
    await getDb().prepare("UPDATE rening_purchase_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(str(attempt.id), token);
  }
}

export async function getUserReningPayments(userId:number){await verifiedStudent(userId);return getDb().prepare("SELECT a.id,a.offer_id,a.offer_title,a.credits,a.price_ore,a.status,a.created_at,COALESCE(p.revoked,0) AS revoked FROM rening_purchase_attempts a LEFT JOIN rening_purchases p ON p.attempt_id=a.id WHERE a.user_id=? ORDER BY a.created_at DESC").all(userId);}
async function takeLock(key: string) {
  return transaction(async () => {
    const token = randomBytes(16).toString("hex");
    const result = await getDb().prepare(`INSERT INTO rening_purchase_locks(key,token,expires_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE rening_purchase_locks.expires_at<=?`)
      .run(key, token, new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), now());
    if (!result.changes) throw new Error("Rening payment reconciliation already running");
    return token;
  });
}
async function assertLock(key: string, token: string) {
  if (!(await getDb().prepare("SELECT key FROM rening_purchase_locks WHERE key=? AND token=? AND expires_at>?").get(key, token, now())))
    throw new Error("Rening payment reconciliation lease expired");
}
async function boundAttempt(session: Stripe.Checkout.Session) {
  const known = await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE session_id=?").get(session.id);
  if (!known && !ownMetadata(session.metadata)) return null;
  const attemptId = known ? str(known.id) : session.metadata?.rening_purchase_attempt_id;
  if (!attemptId || !/^[a-f0-9]{32}$/.test(attemptId)) throw new PurificationPurchaseVerificationError("Rening purchase attempt is missing");
  const attempt = known ?? await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE id=?").get(attemptId);
  if (!attempt || !attempt.customer_id || !attempt.tax_rate_id) throw new PurificationPurchaseVerificationError("Rening purchase contract is missing");
  const customer = await getDb().prepare("SELECT stripe_id FROM rening_purchase_customers WHERE user_id=?").get(num(attempt.user_id));
  if (!customer || str(customer.stripe_id) !== str(attempt.customer_id)) throw new PurificationPurchaseVerificationError("Rening customer binding is missing");
  assertSession(session, attempt);
  return attempt;
}
async function verifiedPayment(session: Stripe.Checkout.Session, attempt: Row, stripe: Stripe) {
  return verifyOneTimePayment(session, paymentContract(attempt), stripe);
}
async function reconcileSession(sessionId: string, event: Stripe.Event, stripe: Stripe, dispute?: Stripe.Dispute) {
  let session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }, API_OPTIONS);
  const known = await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE session_id=?").get(sessionId);
  if (!known && !ownMetadata(session.metadata)) return false;
  const attempt = known ?? await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE id=?").get(str(session.metadata?.rening_purchase_attempt_id));
  if (!attempt) throw new PurificationPurchaseVerificationError("Rening checkout contract missing");
  const key = `attempt:${attempt.id}`, token = await takeLock(key);
  try {
    if (await getDb().prepare("SELECT id FROM rening_purchase_events WHERE id=?").get(event.id)) return true;
    const initialAttempt = await boundAttempt(session);
    if (!initialAttempt || str(initialAttempt.id) !== str(attempt.id)) throw new PurificationPurchaseVerificationError("Rening checkout binding changed");
    const tax = await stripe.taxRates.retrieve(str(attempt.tax_rate_id), {}, API_OPTIONS);
    assertTaxRate(tax, attempt);
    const payment = await verifiedPayment(session, attempt, stripe);
    if (dispute) {
      if (!payment || identifier(dispute.charge) !== payment.chargeId || identifier(dispute.payment_intent) !== payment.intentId || dispute.currency !== "sek" ||
        !Number.isSafeInteger(dispute.amount) || dispute.amount < 1 || dispute.amount > num(attempt.price_ore))
        throw new PurificationPurchaseVerificationError("Rening dispute binding mismatch");
      payment.blocked = true;
    }
    // Refunds and disputes can arrive while these requests are in flight.
    // Refresh both session and payment immediately before the fenced commit.
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }, API_OPTIONS);
    const currentAttempt = await boundAttempt(session);
    if (!currentAttempt || str(currentAttempt.id) !== str(attempt.id)) throw new PurificationPurchaseVerificationError("Rening checkout binding changed");
    const current = await verifiedPayment(session, attempt, stripe);
    if (payment && (!current || current.intentId !== payment.intentId || current.chargeId !== payment.chargeId || current.paidAt !== payment.paidAt))
      throw new PurificationPurchaseVerificationError("Rening payment changed during reconciliation");
    const paid = current;
    if (!paid && await getDb().prepare("SELECT id FROM rening_purchases WHERE attempt_id=?").get(str(attempt.id)))
      throw new PurificationPurchaseVerificationError("Verified course purchase lost its paid checkout");
    if (paid && payment?.blocked) paid.blocked = true;
    await transaction(async () => {
      await assertLock(key, token);
      if (await getDb().prepare("SELECT id FROM rening_purchase_events WHERE id=?").get(event.id)) return;
      const timestamp = now();
      if (paid) {
        // These source records never overwrite manual grants or lifetime
        // enrollments. Revocation is permanent for this specific paid source.
        await getDb().prepare("UPDATE rening_purchase_attempts SET session_id=?,status='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(session.id,timestamp,str(attempt.id));
        await getDb().prepare(`INSERT INTO rening_purchases(id,attempt_id,user_id,offer_id,session_id,payment_intent_id,charge_id,credits,price_ore,vat_percent,paid_at,revoked,revocation_reason,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET revoked=CASE WHEN rening_purchases.revoked=1 OR excluded.revoked=1 THEN 1 ELSE 0 END,revocation_reason=COALESCE(rening_purchases.revocation_reason,excluded.revocation_reason),updated_at=excluded.updated_at`).run(str(attempt.id),str(attempt.id),num(attempt.user_id),num(attempt.offer_id),session.id,paid.intentId,paid.chargeId,num(attempt.credits),num(attempt.price_ore),num(attempt.vat_percent),paid.paidAt,Number(paid.blocked),paid.blocked?'refund-or-dispute':null,timestamp);
        const stored=await getDb().prepare('SELECT * FROM rening_purchases WHERE attempt_id=?').get(str(attempt.id));
        if(!stored||stored.session_id!==session.id||stored.payment_intent_id!==paid.intentId||stored.charge_id!==paid.chargeId)throw new PurificationPurchaseVerificationError('Rening source changed');
        const sourceKey='purchase:'+str(attempt.id);
        if(stored.revoked)await revokePurificationCreditSource(sourceKey,'refund-or-dispute');
        else await grantPurificationCredits({userId:num(attempt.user_id),sourceKey,sourceType:'purchase',sourceName:str(attempt.offer_title),credits:num(attempt.credits),startsAt:paid.paidAt,expiresAt:null});
      } else {
        const status = session.status === "expired" ? "expired" : session.status === "complete" ? "completed" : "open";
        await getDb().prepare("UPDATE rening_purchase_attempts SET session_id=?,status=CASE WHEN status='paid' THEN status ELSE ? END,updated_at=? WHERE id=?")
          .run(session.id, status, timestamp, str(attempt.id));
      }
      await getDb().prepare("INSERT INTO rening_purchase_events(id,type,processed_at) VALUES(?,?,?)").run(event.id, event.type, timestamp);
    });
    return true;
  } catch (error) {
    if (error instanceof PurificationPurchaseVerificationError) await transaction(async () => {
      await assertLock(key, token);
      await getDb().prepare("UPDATE rening_purchases SET revoked=1,revocation_reason=COALESCE(revocation_reason,'payment-verification-failed'),updated_at=? WHERE attempt_id=?").run(now(), str(attempt.id));
      await revokePurificationCreditSource("purchase:"+str(attempt.id),"payment-verification-failed");
    });
    throw error;
  } finally {
    await getDb().prepare("DELETE FROM rening_purchase_locks WHERE key=? AND token=?").run(key, token);
  }
}
async function reconcileCharge(event: Stripe.Event, stripe: Stripe) {
  const disputed = event.type.startsWith("charge.dispute.");
  const object = event.data.object as Stripe.Charge | Stripe.Dispute;
  const chargeId = disputed ? identifier((object as Stripe.Dispute).charge) : object.id;
  if (!chargeId) return false;
  let known = await getDb().prepare("SELECT a.* FROM rening_purchase_attempts a JOIN rening_purchases p ON p.attempt_id=a.id WHERE p.charge_id=?").get(chargeId);
  // Foreign events have their own webhook and should not retry this handler.
  if (!known && !disputed && !ownMetadata((object as Stripe.Charge).metadata)) return false;
  try {
    const charge = await stripe.charges.retrieve(chargeId, {}, API_OPTIONS);
    if (charge.id !== chargeId) throw new PurificationPurchaseVerificationError("Rening charge retrieval mismatch");
    if (!known && !ownMetadata(charge.metadata)) return false;
    if (!known) known = await getDb().prepare("SELECT * FROM rening_purchase_attempts WHERE id=?").get(str(charge.metadata.rening_purchase_attempt_id));
    if (!known) throw new PurificationPurchaseVerificationError("Rening charge contract missing");
    assertMetadata(charge.metadata, known);
    const session = await attemptSession(known, stripe);
    if (!session) throw new Error("Rening charge checkout missing");
    let dispute: Stripe.Dispute | undefined;
    if (disputed) {
      dispute = await stripe.disputes.retrieve(object.id, {}, API_OPTIONS);
      if (dispute.id !== object.id || identifier(dispute.charge) !== chargeId) throw new PurificationPurchaseVerificationError("Rening dispute retrieval mismatch");
    }
    return reconcileSession(session.id, event, stripe, dispute);
  } catch (error) {
    // A locally bound successful charge remains identifiable even when an
    // external edit removes its metadata. Fail closed for that paid source.
    if (known && error instanceof PurificationPurchaseVerificationError) await transaction(async () => {
      await getDb().prepare("UPDATE rening_purchases SET revoked=1,revocation_reason=COALESCE(revocation_reason,'payment-verification-failed'),updated_at=? WHERE attempt_id=?")
        .run(now(), str(known!.id));
      await revokePurificationCreditSource("purchase:"+str(known!.id),"payment-verification-failed");
    });
    throw error;
  }
}
/** Returns true for Slowlax Rening payments and false for unrelated events. */
export async function reconcilePurificationPurchaseEvent(event: Stripe.Event, stripe = getStripe()): Promise<boolean> {
  if (!event.id || !event.type || !event.data?.object) throw new Error("Rening purchase event is malformed");
  if (await getDb().prepare("SELECT id FROM rening_purchase_events WHERE id=?").get(event.id)) return true;
  if (["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_failed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    const object = event.data.object as Stripe.Checkout.Session;
    const known = await getDb().prepare("SELECT id FROM rening_purchase_attempts WHERE session_id=?").get(object.id);
    if (!known && !ownMetadata(object.metadata)) return false;
    return reconcileSession(object.id, event, stripe);
  }
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) return reconcileCharge(event, stripe);
  return false;
}
