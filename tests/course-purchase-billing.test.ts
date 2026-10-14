import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createFirstAdmin, createUser, getDb, hasCourseAccess } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import { getStripe } from "../src/lib/stripe";
import { saveGroup, getAccessibleGroup, assignGroup } from "../src/lib/memberships";
import { getCoursePurchaseOffer, getCourseSalesSettings, saveCourseSalesSettings } from "../src/lib/course-sales";
import { createCoursePurchaseCheckout, cancelCoursePurchaseCheckout, getCoursePurchaseConfirmation, getUserCoursePurchases,
  getUserPendingCoursePurchases, getAdminCoursePurchases, assertCoursePurchaseOrigin, readCoursePurchaseBody,
  coursePurchaseReady, reconcileCoursePurchaseEvent } from "../src/lib/course-purchase-billing";
import { POST as webhook } from "../src/app/api/stripe/webhook/route";
import { POST as checkoutRoute } from "../src/app/api/kurser/checkout/route";
import { POST as cancelRoute } from "../src/app/api/kurser/cancel/route";

for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "RESEND_API_KEY", "EMAIL_FROM", "TRUST_PROXY"]) delete process.env[key];
const directory = mkdtempSync(join(tmpdir(), "tibb-course-purchase-billing-"));
process.env.TIBB_DATABASE_PATH = join(directory, "billing.sqlite");
process.env.STRIPE_SECRET_KEY = "sk_test_course_purchase_isolated";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_course_purchase_isolated";
process.env.APP_URL = "https://courses.example.test";
let adminId: number, studentId: number, otherId: number, unverifiedId: number, groupId: number, courseId: number, extraCourseId: number;
let sequence = 0;
type Fixture = Record<string, any>;
let customers = new Map<string, Fixture>(), sessions = new Map<string, Fixture>(), intents = new Map<string, Fixture>(),
  charges = new Map<string, Fixture>(), disputes = new Map<string, Fixture>(), taxRates = new Map<string, Fixture>();
let checkoutRequests: Fixture[] = [], customerRequests: Fixture[] = [], taxRequests: Fixture[] = [];
let createFailure = false, unsafeUrl = false, slowCreate: (() => Promise<void>) | null = null;
let chargeReads = 0, afterChargeRead: (() => void | Promise<void>) | null = null;
const restores: (() => void)[] = [];
function patch(resource: unknown, method: string, handler: (...args: any[]) => Promise<any>) {
  const prototype = Object.getPrototypeOf(resource) as Fixture;
  const previous = prototype[method]; prototype[method] = handler;
  restores.push(() => { prototype[method] = previous; });
}
function fixture(map: Map<string, Fixture>, key: string) {
  const value = map.get(key); if (!value) throw new Error(`Unmocked provider object ${key}`); return structuredClone(value);
}
before(async () => {
  adminId = (await createFirstAdmin({ name: "Course payment admin", email: "course-payment-admin@example.test", passwordHash: hashPassword("isolated fixture password") })).id;
  studentId = (await createUser({ name: "Course payment student", email: "course-payment-student@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  otherId = (await createUser({ name: "Other course student", email: "course-payment-other@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  unverifiedId = (await createUser({ name: "Unverified course student", email: "course-payment-unverified@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(new Date().toISOString(), studentId, otherId);
  await getDb().prepare("UPDATE settings SET email='courses-contact@example.test' WHERE id=1").run();
  courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES('Advanced course','advanced-course','Fixture',499000,1,?,?)").run(new Date().toISOString(), new Date().toISOString())).lastInsertRowid);
  extraCourseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES('Group bonus course','group-bonus-course','Fixture',0,1,?,?)").run(new Date().toISOString(), new Date().toISOString())).lastInsertRowid);
  const stripe = getStripe();
  patch(stripe.customers, "create", async params => {
    customerRequests.push(params);
    const value = { id: `cus_course_${params.metadata.user_id}`, metadata: params.metadata, email: params.email, name: params.name, tax_exempt: "none" };
    customers.set(value.id, value); return structuredClone(value);
  });
  patch(stripe.customers, "retrieve", async key => fixture(customers, key));
  patch(stripe.taxRates, "create", async (params, options) => {
    taxRequests.push({ params, options }); const key = `txr_${params.metadata.course_purchase_attempt_id}`;
    if (taxRates.has(key)) return fixture(taxRates, key);
    const value = { ...params, id: key, active: true }; taxRates.set(key, value); return structuredClone(value);
  });
  patch(stripe.taxRates, "retrieve", async key => fixture(taxRates, key));
  patch(stripe.checkout.sessions, "create", async (params, options) => {
    checkoutRequests.push({ params, options }); if (slowCreate) await slowCreate();
    const existing = [...sessions.values()].find(session => session.client_reference_id === params.client_reference_id);
    if (existing) return structuredClone(existing);
    const price = { id: `price_${params.client_reference_id}`, ...params.line_items[0].price_data, recurring: null };
    const rate = fixture(taxRates, params.line_items[0].tax_rates[0]);
    const amountTax = Math.round(price.unit_amount * rate.percentage / (100 + rate.percentage));
    const value = { id: `cs_${params.client_reference_id}`, mode: "payment", status: "open", currency: "sek", customer: params.customer,
      client_reference_id: params.client_reference_id, metadata: params.metadata, expires_at: params.expires_at, amount_total: price.unit_amount,
      automatic_tax: { enabled: false }, allow_promotion_codes: false, payment_intent: null, payment_status: "unpaid",
      total_details: { amount_tax: amountTax, amount_discount: 0, amount_shipping: 0 },
      url: unsafeUrl ? "https://checkout.stripe.com.evil.example/pay" : "https://checkout.stripe.com/pay/isolated-course",
      line_items: { has_more: false, data: [{ quantity: 1, amount_total: price.unit_amount, amount_discount: 0, amount_tax: amountTax, price,
        taxes: [{ amount: amountTax, rate, taxability_reason: rate.percentage ? "standard_rated" : "zero_rated" }] }] } };
    sessions.set(value.id, value);
    if (createFailure) { createFailure = false; throw new Error("uncertain provider timeout after creation"); }
    return structuredClone(value);
  });
  patch(stripe.checkout.sessions, "retrieve", async key => fixture(sessions, key));
  patch(stripe.checkout.sessions, "list", async params => ({ has_more: false, data: [...sessions.values()].filter(session => params.payment_intent
    ? session.payment_intent === params.payment_intent : session.customer === params.customer) }));
  patch(stripe.checkout.sessions, "expire", async key => {
    const value = sessions.get(key)!; if (value.status === "complete") throw new Error("cannot expire paid checkout"); value.status = "expired"; return structuredClone(value);
  });
  patch(stripe.paymentIntents, "retrieve", async key => fixture(intents, key));
  patch(stripe.charges, "retrieve", async key => {
    const value = fixture(charges, key); chargeReads++; await afterChargeRead?.(); return value;
  });
  patch(stripe.disputes, "retrieve", async key => fixture(disputes, key));
});
beforeEach(async () => {
  await getDb().exec(`DELETE FROM course_purchase_events; DELETE FROM course_purchase_locks; DELETE FROM course_purchases;
    DELETE FROM course_purchase_attempts; DELETE FROM course_purchase_customers; DELETE FROM course_sales_settings;
    DELETE FROM membership_assignments; DELETE FROM membership_group_courses; DELETE FROM membership_groups; DELETE FROM enrollments; DELETE FROM rate_limits;`);
  await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(adminId);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(new Date().toISOString(), studentId, otherId);
  await getDb().prepare("UPDATE courses SET slug='advanced-course',published=1,price_ore=499000,updated_at=? WHERE id=?").run(new Date().toISOString(), courseId);
  await getDb().prepare("UPDATE settings SET email='courses-contact@example.test' WHERE id=1").run();
  customers = new Map(); sessions = new Map(); intents = new Map(); charges = new Map(); disputes = new Map(); taxRates = new Map();
  checkoutRequests = []; customerRequests = []; taxRequests = []; createFailure = false; unsafeUrl = false; slowCreate = null; chargeReads = 0; afterChargeRead = null;
  groupId = await saveGroup(adminId, undefined, { name: "Course alumni", slug: "course-alumni", description: "Private group fixture", published: true, courseIds: [extraCourseId] });
  await saveCourseSalesSettings(adminId, courseId, { enabled: true, groupId, groupAccessDays: 30, vatPercent: 25,
    terms: "Isolated course purchase terms. Permanent course access and 30 days in the alumni group.", expectedUpdatedAt: null });
});
after(async () => {
  for (const restore of restores.reverse()) restore();
  await getDb().close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("tibb-course-purchase-billing-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 });
});
async function consent() {
  const offer = (await getCoursePurchaseOffer(courseId))!;
  return { consent: true as const, courseRevision: offer.courseRevision, settingsRevision: offer.settingsRevision, termsRevision: offer.termsRevision };
}
async function checkout(userId = studentId) { return createCoursePurchaseCheckout(userId, courseId, await consent()); }
function paidFixture(session = [...sessions.values()][0]): Fixture {
  const intentId = `pi_${session.client_reference_id}`, chargeId = `ch_${session.client_reference_id}`;
  session.status = "complete"; session.payment_status = "paid"; session.payment_intent = intentId;
  intents.set(intentId, { id: intentId, status: "succeeded", currency: "sek", amount: session.amount_total, amount_received: session.amount_total,
    customer: session.customer, metadata: structuredClone(session.metadata), latest_charge: chargeId });
  charges.set(chargeId, { id: chargeId, status: "succeeded", paid: true, captured: true, currency: "sek", amount: session.amount_total,
    amount_captured: session.amount_total, customer: session.customer, payment_intent: intentId, metadata: structuredClone(session.metadata),
    created: Math.floor(Date.now() / 1000) - 5, refunded: false, amount_refunded: 0, disputed: false });
  return { session, intent: intents.get(intentId)!, charge: charges.get(chargeId)! };
}
async function signed(object: Fixture, type = "checkout.session.completed", eventId = `evt_course_${++sequence}`) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
  return webhook(new Request("https://courses.example.test/api/stripe/webhook", { method: "POST", body: payload,
    headers: { "stripe-signature": getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) } }));
}
async function settings(update: Record<string, unknown>) {
  const previous = await getCourseSalesSettings(courseId);
  return saveCourseSalesSettings(adminId, courseId, { enabled: previous.enabled, groupId: previous.groupId, groupAccessDays: previous.groupAccessDays,
    vatPercent: previous.vatPercent, terms: previous.terms, ...update, expectedUpdatedAt: previous.updatedAt });
}

test("one-time checkout snapshots trusted price, group, VAT and terms for a verified account; retry is idempotent", async () => {
  await assert.rejects(checkout(adminId), /verifierat/); await assert.rejects(checkout(unverifiedId), /verifierat/);
  await assert.rejects(createCoursePurchaseCheckout(studentId, courseId, { ...await consent(), courseRevision: "stale" }), /ändrats/);
  assert.equal(await checkout(), "https://checkout.stripe.com/pay/isolated-course"); await checkout();
  assert.equal(sessions.size, 1); assert.equal(checkoutRequests.length, 1); assert.equal(customerRequests.length, 1); assert.equal(taxRequests.length, 1);
  const request = checkoutRequests[0].params;
  assert.equal(request.mode, "payment"); assert.equal(request.customer, `cus_course_${studentId}`); assert.ok(!request.customer_email);
  assert.equal(request.line_items[0].price_data.unit_amount, 499000); assert.equal(request.line_items[0].price_data.currency, "sek");
  assert.equal(request.line_items[0].price_data.tax_behavior, "inclusive"); assert.ok(!request.line_items[0].price_data.recurring);
  assert.deepEqual(request.payment_intent_data.metadata, request.metadata); assert.match(request.success_url, /kurskop\/bekraftelse/);
  const attempt = (await getDb().prepare("SELECT * FROM course_purchase_attempts").get())!;
  assert.equal(attempt.group_id, groupId); assert.equal(attempt.group_access_days, 30); assert.match(String(attempt.terms), /Permanent course access/);
  await assert.rejects(getDb().prepare("UPDATE course_purchase_attempts SET price_ore=1 WHERE id=?").run(String(attempt.id)), /immutable/);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await getAccessibleGroup(studentId, groupId), undefined);
});

test("a success-page read or unpaid completed event grants nothing", async () => {
  await checkout(); const session = [...sessions.values()][0];
  assert.equal((await getCoursePurchaseConfirmation(studentId, session.id))?.status, "pending");
  session.status = "complete";
  assert.equal((await signed(session)).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal((await getUserCoursePurchases(studentId)).length, 0);
  assert.equal((await getCoursePurchaseConfirmation(otherId, session.id)), null);
  assert.equal((await getUserPendingCoursePurchases(studentId))[0].canCancel, false);
});

test("current verified payment gives permanent course and exact paid-date group expiry; duplicates never extend it", async () => {
  await checkout(); const value = paidFixture(), eventId = "evt_course_duplicate";
  assert.equal((await signed(value.session, "checkout.session.completed", eventId)).status, 200);
  assert.equal((await signed(value.session, "checkout.session.completed", eventId)).status, 200);
  assert.equal((await signed(value.session, "checkout.session.async_payment_succeeded")).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), true); assert.equal(await hasCourseAccess(studentId, extraCourseId), true);
  assert.ok(await getAccessibleGroup(studentId, groupId));
  const purchases = await getUserCoursePurchases(studentId); assert.equal(purchases.length, 1);
  assert.equal(purchases[0].groupExpiresAt, new Date((value.charge.created + 30 * 86400) * 1000).toISOString());
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM enrollments").get())!.count, 0);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_assignments").get())!.count, 0);
  assert.equal((await getCoursePurchaseConfirmation(studentId, value.session.id))?.confirmed, true);
  await assert.rejects(checkout(), /redan köpt/);
  assert.equal((await getAdminCoursePurchases(adminId, courseId))[0].name, "Course payment student");
  await assert.rejects(getAdminCoursePurchases(otherId), /administrationen/);
});

test("accepted snapshot survives later sales, price, group and terms edits; existing access ignores sales toggle", async () => {
  await checkout(); const value = paidFixture();
  await settings({ enabled: false, groupId: null, groupAccessDays: null, terms: "New terms must not replace the accepted contract." });
  await getDb().prepare("UPDATE courses SET price_ore=123000,updated_at=? WHERE id=?").run(new Date(Date.now() + 1000).toISOString(), courseId);
  assert.equal((await signed(value.session)).status, 200);
  const purchase = (await getUserCoursePurchases(studentId))[0]; assert.equal(purchase.priceOre, 499000); assert.equal(purchase.groupId, groupId);
  assert.match(purchase.terms, /30 days/); assert.equal(await hasCourseAccess(studentId, courseId), true);
  await assert.rejects(createCoursePurchaseCheckout(otherId, courseId, { consent: true, courseRevision: "old", settingsRevision: "old", termsRevision: "old" }), /just nu/);
});

test("unpublishing after payment keeps truthful paid confirmation but hides the course and group", async () => {
  await checkout(); const value = paidFixture();
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal((await signed(value.session)).status, 200);
  const confirmation = (await getCoursePurchaseConfirmation(studentId, value.session.id))!;
  assert.equal(confirmation.status, "paid"); assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.courseAvailable, false); assert.equal(confirmation.groupAvailable, false);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await getAccessibleGroup(studentId, groupId), undefined);
});

test("course-only purchase and unlimited group purchase both use the selected offer", async () => {
  await settings({ groupId: null, groupAccessDays: null, vatPercent: 0 });
  await checkout(); let value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  assert.equal(value.session.metadata.group_id, "none");
  assert.equal((await getUserCoursePurchases(studentId))[0].groupId, null); assert.equal(await hasCourseAccess(studentId, extraCourseId), false);
  await settings({ groupId, groupAccessDays: null, vatPercent: 6 });
  await checkout(otherId); value = paidFixture([...sessions.values()].at(-1)); assert.equal((await signed(value.session)).status, 200);
  assert.equal((await getUserCoursePurchases(otherId))[0].groupExpiresAt, null); assert.ok(await getAccessibleGroup(otherId, groupId));
});

test("uncertain checkout creation recovers same session and concurrent requests cannot charge twice", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/); assert.equal(sessions.size, 1);
  await checkout(); assert.equal(sessions.size, 1); assert.equal(checkoutRequests.length, 2);
  assert.equal(checkoutRequests[0].options.idempotencyKey, checkoutRequests[1].options.idempotencyKey);
  await cancelCoursePurchaseCheckout(studentId, courseId); sessions.clear();
  let release!: () => void; slowCreate = () => new Promise<void>(resolve => { release = resolve; });
  const first = checkout(); while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(checkout(), /öppnas redan/); release(); await first;
  assert.equal(sessions.size, 1);
});

test("explicit cancellation verifies own remote session and uncertain creation; other users cannot cancel it", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/);
  const session = [...sessions.values()][0]; assert.equal((await getDb().prepare("SELECT session_id FROM course_purchase_attempts").get())!.session_id, null);
  await cancelCoursePurchaseCheckout(otherId, courseId); assert.equal(session.status, "open");
  await cancelCoursePurchaseCheckout(studentId, courseId); assert.equal(session.status, "expired");
  assert.equal((await getCoursePurchaseConfirmation(studentId, session.id))?.status, "cancelled");
  assert.equal((await getUserPendingCoursePurchases(studentId)).length, 0);
  await checkout(); assert.equal(sessions.size, 2);
});

test("cancelled return URLs and local expiry never grant or silently release an uncertain remote attempt", async () => {
  await checkout(); const session = [...sessions.values()][0];
  await getDb().prepare("UPDATE course_purchase_attempts SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await getUserPendingCoursePurchases(studentId)).length, 1);
  await assert.rejects(checkout(), /tid har gått ut/);
  await cancelCoursePurchaseCheckout(studentId, courseId); assert.equal(session.status, "expired"); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("full refunds revoke only the paid source; partial refunds and independently granted access remain", async () => {
  await checkout(); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  value.charge.amount_refunded = 1000; assert.equal((await signed(value.charge, "charge.refunded")).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), true);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(studentId, courseId, new Date().toISOString());
  await assignGroup(adminId, { email: "course-payment-student@example.test", groupId, expiresAt: null });
  value.charge.amount_refunded = value.charge.amount; value.charge.refunded = true;
  assert.equal((await signed(value.charge, "charge.refunded")).status, 200);
  assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true);
  assert.equal(await hasCourseAccess(studentId, courseId), true); assert.ok(await getAccessibleGroup(studentId, groupId));
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM enrollments").get())!.count, 1);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_assignments").get())!.count, 1);
  assert.equal((await getCoursePurchaseConfirmation(studentId, value.session.id))?.status, "blocked");
});

test("a refund before checkout fulfillment is stored blocked and older paid deliveries cannot reopen it", async () => {
  await checkout(); const value = paidFixture(); value.charge.refunded = true; value.charge.amount_refunded = value.charge.amount;
  assert.equal((await signed(value.charge, "charge.refunded")).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await getAccessibleGroup(studentId, groupId), undefined);
  value.charge.refunded = false; value.charge.amount_refunded = 0;
  assert.equal((await signed(value.session)).status, 200);
  assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("verified disputes revoke only their bound course purchase and stay blocked after a won dispute", async () => {
  await checkout(); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  const dispute = { id: "dp_course_fixture", charge: value.charge.id, payment_intent: value.intent.id, amount: value.charge.amount, currency: "sek", status: "needs_response" };
  disputes.set(dispute.id, dispute); value.charge.disputed = true;
  assert.equal((await signed(dispute, "charge.dispute.created")).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await getAccessibleGroup(studentId, groupId), undefined);
  dispute.status = "won"; value.charge.disputed = false;
  assert.equal((await signed(dispute, "charge.dispute.closed")).status, 200); assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true);
});

test("refresh before commit catches a refund that appears during provider verification", async () => {
  await checkout(); const value = paidFixture();
  afterChargeRead = () => { if (chargeReads === 1) { value.charge.refunded = true; value.charge.amount_refunded = value.charge.amount; } };
  assert.equal((await signed(value.session)).status, 200); assert.equal(await hasCourseAccess(studentId, courseId), false);
  assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true);
});

test("amount, currency, identity, tax and line item mismatches reject fulfillment", async () => {
  await checkout(); const value = paidFixture();
  const cases: [Fixture, string, unknown][] = [[value.intent, "amount_received", 1], [value.intent, "currency", "eur"],
    [value.intent, "customer", "cus_wrong"], [value.charge, "amount_captured", 1], [value.charge.metadata, "user_id", String(otherId)],
    [value.session.line_items.data[0], "quantity", 2], [value.session.total_details, "amount_tax", 0], [value.session, "currency", "usd"]];
  for (const [target, key, changed] of cases) {
    const original = target[key]; target[key] = changed;
    assert.equal((await signed(value.session)).status, 500, `mismatch ${key}`);
    assert.equal(await hasCourseAccess(studentId, courseId), false); target[key] = original;
  }
  assert.equal((await signed(value.session)).status, 200); assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("tampering a previously verified checkout revokes that purchase and never a manual grant", async () => {
  await checkout(); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  value.session.metadata.course_id = String(extraCourseId);
  assert.equal((await signed(value.session)).status, 500); assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("an unsafe Stripe redirect cannot leak payment URLs or grant access", async () => {
  unsafeUrl = true; await assert.rejects(checkout(), /redirect/);
  assert.equal([...sessions.values()][0].status, "expired"); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("fresh verification and role checks protect purchase history and admin rows", async () => {
  await checkout(); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(studentId);
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await getAccessibleGroup(studentId, groupId), undefined);
  await assert.rejects(getUserCoursePurchases(studentId), /verifierat/);
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(adminId); await assert.rejects(getAdminCoursePurchases(adminId), /administrationen/);
});

test("manual permanent ownership prevents a duplicate charge while temporary group access allows a lifetime upgrade", async () => {
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(studentId, courseId, new Date().toISOString());
  await assert.rejects(checkout(), /redan köpt/); assert.equal(checkoutRequests.length, 0);
  await getDb().prepare("INSERT INTO membership_group_courses(group_id,course_id) VALUES(?,?)").run(groupId, courseId);
  await assignGroup(adminId, { email: "course-payment-other@example.test", groupId, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(await hasCourseAccess(otherId, courseId), true);
  await checkout(otherId); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  assert.equal((await getUserCoursePurchases(otherId)).length, 1);
});

test("remote checkout lease fencing rejects an obsolete worker and allows a later retry", async () => {
  await checkout(); const value = paidFixture();
  afterChargeRead = async () => {
    if (chargeReads === 1) await getDb().prepare("UPDATE course_purchase_locks SET token='new-worker-token'").run();
  };
  assert.equal((await signed(value.session)).status, 500); assert.equal(await hasCourseAccess(studentId, courseId), false);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM course_purchase_events").get())!.count, 0);
  afterChargeRead = null;
  await getDb().prepare("UPDATE course_purchase_locks SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await signed(value.session)).status, 200); assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("a bound charge losing its metadata fails closed for that purchase", async () => {
  await checkout(); const value = paidFixture(); assert.equal((await signed(value.session)).status, 200);
  value.charge.metadata = {};
  assert.equal((await signed(value.charge, "charge.refunded")).status, 500);
  assert.equal((await getUserCoursePurchases(studentId))[0].revoked, true); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("an uncertain missing session stays reserved until fixed remote expiry has safely passed", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/); sessions.clear();
  await assert.rejects(cancelCoursePurchaseCheckout(studentId, courseId), /behandlas fortfarande/);
  assert.equal((await getUserPendingCoursePurchases(studentId)).length, 1);
  await getDb().prepare("UPDATE course_purchase_attempts SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await cancelCoursePurchaseCheckout(studentId, courseId); assert.equal((await getUserPendingCoursePurchases(studentId)).length, 0);
  await checkout(); assert.equal(sessions.size, 1);
});

test("a paid checkout cannot be cancelled before its webhook arrives", async () => {
  await checkout(); const value = paidFixture();
  await assert.rejects(cancelCoursePurchaseCheckout(studentId, courseId), /avslutad och behandlas/);
  assert.equal((await getCoursePurchaseConfirmation(studentId, value.session.id))?.status, "pending");
  assert.equal((await signed(value.session)).status, 200); assert.equal((await getCoursePurchaseConfirmation(studentId, value.session.id))?.status, "paid");
});

test("renaming a course keeps accepted snapshot history but current navigation URLs stay valid", async () => {
  await checkout(); const value = paidFixture();
  await getDb().prepare("UPDATE courses SET slug='new-course-address',updated_at=? WHERE id=?").run(new Date(Date.now() + 1000).toISOString(), courseId);
  assert.equal((await getUserPendingCoursePurchases(studentId))[0].slug, "new-course-address");
  assert.equal((await getCoursePurchaseConfirmation(studentId, value.session.id))?.slug, "new-course-address");
  assert.equal((await getDb().prepare("SELECT course_slug FROM course_purchase_attempts").get())!.course_slug, "advanced-course");
  assert.equal((await signed(value.session)).status, 200); assert.equal((await getUserCoursePurchases(studentId))[0].slug, "new-course-address");
});

test("shared booking webhook acknowledges foreign membership and shop sessions without booking retries", async () => {
  for (const integration of ["membership", "shop"]) {
    const object = { id: `cs_foreign_${integration}`, mode: "subscription", metadata: { application: "tibb.nu", integration }, payment_status: "paid" };
    assert.equal((await signed(object)).status, 200);
    assert.equal(await reconcileCoursePurchaseEvent({ id: `evt_foreign_${integration}`, type: "checkout.session.completed", data: { object } } as any), false);
  }
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM course_purchases").get())!.count, 0);
});

test("signature, JSON size, same-origin and cross-site protections fail before mutations", async () => {
  assert.equal(coursePurchaseReady(), true);
  assert.throws(() => assertCoursePurchaseOrigin(new Request("https://courses.example.test/api/kurser/checkout", { headers: { origin: "https://evil.example.test" } })), /hemsidan/);
  assert.throws(() => assertCoursePurchaseOrigin(new Request("https://courses.example.test/api/kurser/checkout", { headers: { origin: process.env.APP_URL!, "sec-fetch-site": "cross-site" } })), /hemsidan/);
  await assert.rejects(readCoursePurchaseBody(new Request("https://courses.example.test", { method: "POST", body: "x".repeat(5000) })), /stor/);
  for (const route of [checkoutRoute, cancelRoute]) {
    const response = await route(new Request("https://courses.example.test/api/kurser", { method: "POST", headers: { origin: "https://evil.example.test", "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 403);
  }
  assert.equal((await webhook(new Request("https://courses.example.test/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "invalid" } }))).status, 400);
  assert.equal((await webhook(new Request("https://courses.example.test/api/stripe/webhook", { method: "POST", body: "x".repeat(1024 * 1024 + 1), headers: { "stripe-signature": "invalid" } }))).status, 413);
});
