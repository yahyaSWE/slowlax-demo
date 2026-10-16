import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import type Stripe from "stripe";
import { createFirstAdmin, createUser, getDb, hasCourseAccess } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import { getStripe } from "../src/lib/stripe";
import { saveGroup, savePlan, getAdminPlan, getMembershipSettings, saveMembershipSettings, assignGroup, getAccessibleGroup, getPublicPlanCourses } from "../src/lib/memberships";
import { createMembershipCheckout, createMembershipPortal, getUserSubscriptions, getAdminSubscriptions,
  assertMembershipOrigin, readMembershipBody, membershipBillingReady, membershipPortalReady } from "../src/lib/membership-billing";
import { cancelMembershipCheckout, getMembershipCheckoutConfirmation, getUserPendingCheckouts } from "../src/lib/membership-billing";
import { POST as webhook } from "../src/app/api/medlemskap/webhook/route";
import { POST as checkoutRoute } from "../src/app/api/medlemskap/checkout/route";
import { POST as portalRoute } from "../src/app/api/medlemskap/portal/route";
import { savePurificationQuotaSettings,getPurificationBalance } from "../src/lib/purification-domain";

for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "RESEND_API_KEY", "EMAIL_FROM", "TRUST_PROXY"]) delete process.env[key];
const directory = mkdtempSync(join(tmpdir(), "tibb-membership-billing-"));
process.env.TIBB_DATABASE_PATH = join(directory, "billing.sqlite");
process.env.STRIPE_SECRET_KEY = "sk_test_membership_isolated";
process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET = "whsec_membership_isolated";
process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID = "bpc_fixture";
process.env.APP_URL = "https://membership.example.test";
let adminId: number, studentId: number, otherId: number, unverifiedId: number, groupId: number, planId: number, courseId: number;
let sequence = 0;
type Fixture = Record<string, any>;
let customers = new Map<string, Fixture>(), sessions = new Map<string, Fixture>(), subscriptions = new Map<string, Fixture>(),
  invoices = new Map<string, Fixture>(), intents = new Map<string, Fixture>(), charges = new Map<string, Fixture>(), disputes = new Map<string, Fixture>();
let taxRates = new Map<string, Fixture>();
let checkoutRequests: Fixture[] = [], customerRequests: Fixture[] = [], portalRequests: Fixture[] = [], taxRequests: Fixture[] = [];
let createFailure = false, unsafeUrl = false, slowCreate: (() => Promise<void>) | null = null, slowRetrieve: (() => Promise<void>) | null = null;
let configuration: Fixture;
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
  adminId = (await createFirstAdmin({ name: "Billing admin", email: "billing-admin@example.test", passwordHash: hashPassword("isolated fixture password") })).id;
  studentId = (await createUser({ name: "Billing student", email: "billing-student@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  otherId = (await createUser({ name: "Other student", email: "billing-other@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  unverifiedId = (await createUser({ name: "Unverified student", email: "billing-unverified@example.test", role: "student", passwordHash: hashPassword("isolated fixture password") })).id;
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(new Date().toISOString(), studentId, otherId);
  await getDb().prepare("UPDATE settings SET email='billing-contact@example.test' WHERE id=1").run();
  courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES('Billing course','billing-course','Fixture',0,1,?,?)").run(new Date().toISOString(), new Date().toISOString())).lastInsertRowid);
  const stripe = getStripe();
  patch(stripe.customers, "create", async (params) => {
    customerRequests.push(params); const value = { id: `cus_fixture_${params.metadata.user_id}`, metadata: params.metadata, email: params.email, name: params.name, tax_exempt: "none" };
    customers.set(value.id, value); return structuredClone(value);
  });
  patch(stripe.customers, "retrieve", async (key) => fixture(customers, key));
  patch(stripe.taxRates, "create", async (params, options) => {
    taxRequests.push({ params, options });
    const key = `txr_${params.metadata.membership_attempt_id}`;
    const existing = taxRates.get(key); if (existing) return structuredClone(existing);
    const value = { ...params, id: key, active: true }; taxRates.set(key, value); return structuredClone(value);
  });
  patch(stripe.taxRates, "retrieve", async (key) => fixture(taxRates, key));
  patch(stripe.checkout.sessions, "create", async (params, options) => {
    checkoutRequests.push({ params, options }); if (slowCreate) await slowCreate();
    const existing = [...sessions.values()].find((session) => session.client_reference_id === params.client_reference_id);
    if (existing) return structuredClone(existing);
    const price = { id: `price_${params.client_reference_id}`, ...params.line_items[0].price_data };
    const rate = fixture(taxRates, params.subscription_data.default_tax_rates[0]);
    const amountTax = Math.round(price.unit_amount * rate.percentage / (100 + rate.percentage));
    const value = { id: `cs_${params.client_reference_id}`, mode: "subscription", status: "open", currency: "sek", customer: params.customer,
      client_reference_id: params.client_reference_id, metadata: params.metadata, expires_at: params.expires_at, amount_total: price.unit_amount,
      subscription: null, payment_status: "unpaid", total_details: { amount_tax: amountTax }, taxRate: rate,
      url: unsafeUrl ? "https://checkout.stripe.com.evil.example/pay" : "https://checkout.stripe.com/pay/fixture",
      line_items: { has_more: false, data: [{ quantity: 1, amount_total: price.unit_amount, amount_tax: amountTax, price,
        taxes: [{ amount: amountTax, rate, taxability_reason: rate.percentage ? "standard_rated" : "zero_rated" }] }] } };
    sessions.set(value.id, value);
    if (createFailure) { createFailure = false; throw new Error("uncertain provider timeout after creation"); }
    return structuredClone(value);
  });
  patch(stripe.checkout.sessions, "retrieve", async (key) => fixture(sessions, key));
  patch(stripe.checkout.sessions, "list", async (params) => ({ has_more: false, data: [...sessions.values()].filter((session) => params.subscription ? session.subscription === params.subscription : session.customer === params.customer) }));
  patch(stripe.checkout.sessions, "expire", async (key) => {
    const value = sessions.get(key)!; if (value.status === "complete") throw new Error("cannot expire paid checkout"); value.status = "expired"; return structuredClone(value);
  });
  patch(stripe.subscriptions, "retrieve", async (key) => { const value = fixture(subscriptions, key); if (slowRetrieve) await slowRetrieve(); return value; });
  patch(stripe.invoices, "retrieve", async (key) => fixture(invoices, key));
  patch(stripe.invoicePayments, "list", async (params) => ({ has_more: false, data: [...invoices.values()].filter((invoice) => invoice.status === "paid" &&
    (params.invoice ? invoice.id === params.invoice : invoice.intentId === params.payment?.payment_intent)).map((invoice) => ({ id: `ip_${invoice.id}`, invoice: invoice.id,
      amount_paid: invoice.amount_paid, currency: invoice.currency, status: "paid", payment: { type: "payment_intent", payment_intent: invoice.intentId } })) }));
  patch(stripe.paymentIntents, "retrieve", async (key) => fixture(intents, key));
  patch(stripe.charges, "retrieve", async (key) => fixture(charges, key));
  patch(stripe.disputes, "retrieve", async (key) => fixture(disputes, key));
  patch(stripe.billingPortal.configurations, "retrieve", async () => structuredClone(configuration));
  patch(stripe.billingPortal.sessions, "create", async (params) => { portalRequests.push(params); return { url: "https://billing.stripe.com/p/session/fixture" }; });
});
beforeEach(async () => {
  await getDb().exec(`DELETE FROM membership_billing_revocations; DELETE FROM membership_paid_invoices; DELETE FROM membership_subscriptions;
    DELETE FROM membership_checkout_tax_rates; DELETE FROM membership_checkout_attempts; DELETE FROM membership_customers; DELETE FROM membership_billing_events; DELETE FROM membership_billing_locks;
    DELETE FROM membership_assignments; DELETE FROM membership_plans; DELETE FROM membership_group_courses; DELETE FROM membership_groups; DELETE FROM enrollments; DELETE FROM rate_limits;`);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(new Date().toISOString(), studentId, otherId);
  customers = new Map(); sessions = new Map(); subscriptions = new Map(); invoices = new Map(); intents = new Map(); charges = new Map(); disputes = new Map(); taxRates = new Map();
  checkoutRequests = []; customerRequests = []; portalRequests = []; taxRequests = []; createFailure = false; unsafeUrl = false; slowCreate = null; slowRetrieve = null;
  configuration = { id: "bpc_fixture", active: true, login_page: { enabled: false }, features: { payment_method_update: { enabled: true },
    customer_update: { enabled: false }, subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: "at_period_end" } } };
  groupId = await saveGroup(adminId, undefined, { name: "Billing group", slug: "billing-group", description: "Fixture", published: true, courseIds: [courseId] });
  planId = await savePlan(adminId, undefined, { name: "Monthly membership", slug: "billing-month", description: "Fixture", groupId, priceOre: 12000, vatPercent: 25, interval: "month", published: true });
  const settings = await getMembershipSettings();
  await saveMembershipSettings(adminId, { salesEnabled: true, terms: "Fixture membership terms for isolated tests only.", expectedUpdatedAt: settings.updatedAt });
});
after(async () => {
  for (const restore of restores.reverse()) restore();
  await getDb().close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("tibb-membership-billing-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 });
});
async function consent() {
  return { consent: true as const, planRevision: (await getAdminPlan(adminId, planId))!.updatedAt, termsRevision: (await getMembershipSettings()).updatedAt };
}
async function checkout(userId = studentId) { return createMembershipCheckout(userId, planId, await consent()); }
function activeFixture(session = [...sessions.values()][0], suffix = "first", days = 30): Fixture {
  const subscriptionId = session.subscription ?? `sub_${session.client_reference_id}`;
  const invoiceId = `in_${suffix}_${session.client_reference_id}`, intentId = `pi_${suffix}_${session.client_reference_id}`, chargeId = `ch_${suffix}_${session.client_reference_id}`;
  session.status = "complete"; session.subscription = subscriptionId; session.payment_status = "paid";
  const price = session.line_items.data[0].price;
  const rate = session.taxRate;
  const taxAmount = Math.round(price.unit_amount * rate.percentage / (100 + rate.percentage));
  const tax = { amount: taxAmount, tax_behavior: "inclusive", tax_rate_details: { tax_rate: rate.id }, type: "tax_rate_details",
    taxability_reason: rate.percentage ? "standard_rated" : "zero_rated", taxable_amount: price.unit_amount - taxAmount };
  const start = Math.floor(Date.now() / 1000) - 60, end = start + days * 86400;
  const subscription = { id: subscriptionId, metadata: session.metadata, customer: session.customer, currency: "sek", status: "active", cancel_at_period_end: false,
    automatic_tax: { enabled: false }, default_tax_rates: [rate], discounts: [], collection_method: "charge_automatically", trial_end: null, pause_collection: null, latest_invoice: invoiceId,
    items: { has_more: false, data: [{ id: `si_${session.client_reference_id}`, quantity: 1, price, tax_rates: [] }] } };
  subscriptions.set(subscriptionId, subscription);
  invoices.set(invoiceId, { id: invoiceId, customer: session.customer, currency: "sek", status: "paid", amount_paid: price.unit_amount, amount_remaining: 0,
    total: price.unit_amount, discounts: [], total_discount_amounts: [], intentId, default_tax_rates: [rate], automatic_tax: { enabled: false }, total_taxes: [tax],
    parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId, metadata: session.metadata } },
    lines: { has_more: false, data: [{ quantity: 1, amount: price.unit_amount, currency: "sek", period: { start, end },
      taxes: [structuredClone(tax)], pricing: { price_details: { price: price.id } }, parent: { type: "subscription_item_details", subscription_item_details: {
        subscription: subscriptionId, subscription_item: subscription.items.data[0].id, proration: false } } }] } });
  intents.set(intentId, { id: intentId, status: "succeeded", currency: "sek", amount_received: price.unit_amount, customer: session.customer, latest_charge: chargeId });
  charges.set(chargeId, { id: chargeId, status: "succeeded", paid: true, currency: "sek", amount: price.unit_amount, customer: session.customer,
    payment_intent: intentId, refunded: false, amount_refunded: 0, disputed: false, metadata: {} });
  return { subscription, invoice: invoices.get(invoiceId)!, intent: intents.get(intentId)!, charge: charges.get(chargeId)!, session };
}
async function signed(object: Fixture, type = "invoice.paid", eventId = `evt_fixture_${++sequence}`) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
  return webhook(new Request("https://membership.example.test/api/medlemskap/webhook", { method: "POST", body: payload,
    headers: { "stripe-signature": getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET! }) } }));
}
async function onlySub() { return (await getUserSubscriptions(studentId))[0]; }

test("Rening membership quotas snapshot new consent, refresh per paid invoice and revoke with the paid source",async()=>{
 const q=await savePurificationQuotaSettings(adminId,'membership_plan',planId,{credits:2,expectedUpdatedAt:null});
 await assert.rejects(checkout(),/reningar/);
 await createMembershipCheckout(studentId,planId,{...await consent(),purificationRevision:q.updatedAt});
 await savePurificationQuotaSettings(adminId,'membership_plan',planId,{credits:7,expectedUpdatedAt:q.updatedAt});
 const first=activeFixture();await signed(first.invoice);await signed(first.invoice);let balance=await getPurificationBalance(studentId);
 assert.equal(balance.availableCredits,2);assert.equal(balance.grants[0].expiresAt,new Date(first.invoice.lines.data[0].period.end*1000).toISOString());
 const next=activeFixture(first.session,'rening-renewal',31);await signed(next.invoice);balance=await getPurificationBalance(studentId);assert.equal(balance.grants.length,2);assert.ok(balance.grants.every(g=>g.totalCredits===2));
 next.charge.refunded=true;next.charge.amount_refunded=next.charge.amount;await signed(next.charge,'charge.refunded');assert.equal((await getPurificationBalance(studentId)).availableCredits,0);await signed(first.invoice);assert.equal((await getPurificationBalance(studentId)).availableCredits,0);
});

test("checkout uses verified user identity, immutable server price and terms; retry reuses one subscription session", async () => {
  await assert.rejects(checkout(unverifiedId), /verifierat/); await assert.rejects(checkout(adminId), /verifierat/);
  await assert.rejects(createMembershipCheckout(studentId, planId, { ...await consent(), planRevision: "stale" }), /ändrats/);
  assert.equal(await checkout(), "https://checkout.stripe.com/pay/fixture");
  assert.equal(await hasCourseAccess(studentId, courseId), false);
  const request = checkoutRequests[0]; assert.equal(request.params.mode, "subscription"); assert.equal(request.params.customer, `cus_fixture_${studentId}`);
  assert.equal(request.params.metadata.application, "slowlax.se");
  assert.equal(request.params.subscription_data.metadata.application, "slowlax.se");
  assert.equal(customerRequests[0].metadata.application, "slowlax.se");
  assert.equal(request.params.line_items[0].price_data.unit_amount, 12000); assert.equal(request.params.line_items[0].price_data.currency, "sek");
  assert.deepEqual(request.params.line_items[0].price_data.recurring, { interval: "month", interval_count: 1 });
  assert.equal(request.params.line_items[0].price_data.tax_behavior, "inclusive"); assert.ok(!request.params.customer_email);
  await checkout(); assert.equal(checkoutRequests.length, 1); assert.equal(customerRequests.length, 1); assert.equal(sessions.size, 1);
  assert.equal(taxRequests.length, 1); assert.deepEqual(request.params.subscription_data.default_tax_rates, [`txr_${request.params.client_reference_id}`]);
  const attempt = (await getDb().prepare("SELECT * FROM membership_checkout_attempts").get())!;
  assert.match(String(attempt.terms), /Fixture membership terms/); assert.equal(attempt.user_id, studentId); assert.equal(attempt.price_ore, 12000);
  await assert.rejects(getDb().prepare("UPDATE membership_checkout_attempts SET price_ore=1 WHERE id=?").run(String(attempt.id)), /immutable/);
});

test("sales disable prevents new checkout while existing paid access remains available", async () => {
  await checkout(); const value = activeFixture(); assert.equal((await signed(value.invoice)).status, 200);
  const settings = await getMembershipSettings(); await saveMembershipSettings(adminId, { ...settings, salesEnabled: false, expectedUpdatedAt: settings.updatedAt });
  await assert.rejects(checkout(otherId), /just nu/); assert.equal(await hasCourseAccess(studentId, courseId), true);
  assert.equal(membershipBillingReady(), true); assert.equal(membershipPortalReady(), true);
});

test("uncertain provider creation preserves idempotency; concurrent checkout blocks the second reservation", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/); assert.equal(sessions.size, 1);
  await checkout(); assert.equal(sessions.size, 1); assert.equal(checkoutRequests.length, 2);
  assert.equal(checkoutRequests[0].options.idempotencyKey, checkoutRequests[1].options.idempotencyKey);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_checkout_attempts").get())!.count, 1);
  await getDb().exec("DELETE FROM membership_checkout_tax_rates; DELETE FROM membership_checkout_attempts; DELETE FROM membership_customers;"); sessions.clear(); customers.clear();
  let release!: () => void; slowCreate = () => new Promise<void>((resolve) => { release = resolve; });
  const first = checkout(); while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(checkout(), /öppnas redan/); release(); await first; assert.equal(sessions.size, 1);
});

test("HTTPS Stripe hostname is required, signed checkout success alone gives no access", async () => {
  unsafeUrl = true; await assert.rejects(checkout(), /redirect/); assert.equal(await hasCourseAccess(studentId, courseId), false);
  unsafeUrl = false; await checkout(); const value = activeFixture();
  assert.equal((await signed(value.session, "checkout.session.completed")).status, 200); assert.equal((await getUserSubscriptions(studentId)).length, 0);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
  assert.equal((await signed(value.invoice)).status, 200); assert.equal(await hasCourseAccess(studentId, courseId), true);
  await assert.rejects(checkout(), /redan ett medlemskap/);
});

test("paid invoices grant exactly their verified service period and duplicate deliveries are durable", async () => {
  await checkout(); const value = activeFixture(); const eventId = "evt_duplicate";
  assert.equal((await signed(value.invoice, "invoice.paid", eventId)).status, 200); assert.equal((await signed(value.invoice, "invoice.paid", eventId)).status, 200);
  assert.equal((await getUserSubscriptions(studentId)).length, 1); assert.equal((await onlySub()).paidUntil, new Date(value.invoice.lines.data[0].period.end * 1000).toISOString());
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_paid_invoices").get())!.count, 1);
  assert.equal((await getAdminSubscriptions(adminId, groupId))[0].studentName, "Billing student");
  await assert.rejects(getAdminSubscriptions(otherId), /administrationen/);
  const renewal = activeFixture(value.session, "renewal", 31); assert.equal((await signed(renewal.invoice)).status, 200);
  assert.equal((await onlySub()).paidUntil, new Date(renewal.invoice.lines.data[0].period.end * 1000).toISOString());
});

test("failed renewals preserve only the original paid period; unpaid, pause and expiry close access", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice); const original = (await onlySub()).paidUntil;
  const renewal = activeFixture(value.session, "failed", 31); renewal.subscription.status = "past_due"; renewal.invoice.status = "open"; renewal.invoice.amount_paid = 0; renewal.invoice.amount_remaining = 12000;
  assert.equal((await signed(renewal.invoice, "invoice.payment_failed")).status, 200); assert.equal((await onlySub()).paidUntil, original);
  assert.equal(await hasCourseAccess(studentId, courseId), true);
  await getDb().prepare("UPDATE membership_subscriptions SET paid_until='2000-01-01T00:00:00.000Z'").run(); assert.equal(await hasCourseAccess(studentId, courseId), false);
  renewal.subscription.status = "unpaid"; await signed(renewal.subscription, "customer.subscription.updated"); assert.equal((await onlySub()).status, "unpaid");
  renewal.subscription.status = "active"; renewal.subscription.pause_collection = { behavior: "void" }; await signed(renewal.subscription, "customer.subscription.updated");
  assert.equal((await onlySub()).status, "paused"); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("cancel at period end keeps paid access; reordered old invoice cannot restore canceled status", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  value.subscription.cancel_at_period_end = true; assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 200);
  assert.equal((await onlySub()).cancelAtPeriodEnd, true); assert.equal(await hasCourseAccess(studentId, courseId), true);
  value.subscription.status = "canceled"; await signed(value.subscription, "customer.subscription.deleted");
  assert.equal((await signed({ ...value.invoice, parent: value.invoice.parent })).status, 200);
  assert.equal((await onlySub()).status, "canceled"); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("wrong customer, amount, interval, multiple lines and unconfirmed payment fail closed and retry", async () => {
  for (const mutate of [
    (value: Fixture) => { value.subscription.customer = `cus_fixture_${otherId}`; },
    (value: Fixture) => { value.invoice.total = 1; },
    (value: Fixture) => { value.subscription.items.data[0].price.recurring.interval = "year"; },
    (value: Fixture) => { value.invoice.lines.data.push(structuredClone(value.invoice.lines.data[0])); },
    (value: Fixture) => { value.intent.status = "processing"; },
  ]) {
    await getDb().exec("DELETE FROM membership_paid_invoices; DELETE FROM membership_subscriptions; DELETE FROM membership_checkout_tax_rates; DELETE FROM membership_checkout_attempts; DELETE FROM membership_customers;");
    sessions.clear(); customers.clear(); await checkout(); const value = activeFixture(); mutate(value);
    assert.equal((await signed(value.invoice)).status, 500); assert.equal((await getUserSubscriptions(studentId)).length, 0);
    assert.equal(await hasCourseAccess(studentId, courseId), false);
  }
});

test("new plan price never mutates old subscription snapshot; an externally changed recurring price blocks access", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  const plan = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...plan, priceOre: 18000, expectedUpdatedAt: plan.updatedAt });
  assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 200);
  assert.equal((await onlySub()).priceOre, 12000); assert.equal(await hasCourseAccess(studentId, courseId), true);
  value.subscription.items.data[0].price.unit_amount = 18000;
  assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 500);
  assert.equal((await onlySub()).blocked, true); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("full refunds and disputes revoke memberships and never erase manual or lifetime access", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  value.charge.refunded = true; value.charge.amount_refunded = value.charge.amount;
  assert.equal((await signed(value.charge, "charge.refunded")).status, 200); assert.equal((await onlySub()).blocked, true);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
  value.charge.refunded = false; value.charge.amount_refunded = 0; await signed(value.invoice); assert.equal((await onlySub()).blocked, true);
  await assignGroup(adminId, { email: "billing-student@example.test", groupId, expiresAt: null }); assert.equal(await hasCourseAccess(studentId, courseId), true);
  await getDb().exec("DELETE FROM membership_assignments;");
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(studentId, courseId, new Date().toISOString());
  value.charge.disputed = true; const dispute = { id: "dp_fixture", charge: value.charge.id, status: "needs_response" }; disputes.set(dispute.id, dispute);
  assert.equal((await signed(dispute, "charge.dispute.created")).status, 200); assert.equal(await hasCourseAccess(studentId, courseId), true);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM enrollments WHERE user_id=?").get(studentId))!.count, 1);
});

test("a concurrent older event cannot commit stale state over the current canceled subscription", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  let release!: () => void; slowRetrieve = () => new Promise<void>((resolve) => { release = resolve; });
  const older = signed(value.invoice); while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  value.subscription.status = "canceled";
  assert.equal((await signed(value.subscription, "customer.subscription.deleted")).status, 500);
  slowRetrieve = null; release(); assert.equal((await older).status, 200);
  assert.equal((await onlySub()).status, "canceled"); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("portal is bound to current verified customer and safe cancellation configuration", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  await assert.rejects(createMembershipPortal(otherId), /inget medlemskap/);
  assert.equal(await createMembershipPortal(studentId), "https://billing.stripe.com/p/session/fixture");
  assert.equal(portalRequests[0].customer, `cus_fixture_${studentId}`); assert.equal(portalRequests[0].configuration, "bpc_fixture");
  configuration.features.subscription_update.enabled = true; await assert.rejects(createMembershipPortal(studentId), /konfigureras/);
  configuration.features.subscription_update.enabled = false; configuration.features.subscription_cancel.mode = "immediately";
  await assert.rejects(createMembershipPortal(studentId), /periodens slut/);
  customers.get(`cus_fixture_${studentId}`)!.metadata.user_id = String(otherId); await assert.rejects(createMembershipPortal(studentId), /ownership/);
});

test("HTTP origin and bounded request bodies reject abuse; unsigned and foreign events never grant access", async () => {
  assert.throws(() => assertMembershipOrigin(new Request("https://evil.example/api/medlemskap/checkout", { headers: { origin: "https://evil.example" } })), /hemsidan/);
  assert.doesNotThrow(() => assertMembershipOrigin(new Request("https://membership.example.test/api/medlemskap/checkout", { headers: { origin: process.env.APP_URL! } })));
  await assert.rejects(readMembershipBody(new Request("https://membership.example.test", { method: "POST", body: "x".repeat(4097) })), /stor/);
  const forbidden = new Request("https://membership.example.test/api/medlemskap/checkout", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
  assert.equal((await checkoutRoute(forbidden)).status, 403);
  assert.equal((await portalRoute(new Request("https://membership.example.test/api/medlemskap/portal", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }))).status, 403);
  assert.equal((await webhook(new Request("https://membership.example.test/api/medlemskap/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=forged" }, body: "{}" }))).status, 400);
  assert.equal((await signed({ id: "cs_foreign", metadata: { application: "elsewhere" } }, "checkout.session.completed")).status, 200);
  assert.equal((await signed({ id: "sub_foreign", metadata: { application: "elsewhere" } }, "customer.subscription.updated")).status, 200);
  assert.equal((await signed({ id: "cs_own_missing", metadata: { application: "slowlax.se", integration: "membership", membership_attempt_id: "0".repeat(32) } }, "checkout.session.completed")).status, 500);
  assert.equal((await getUserSubscriptions(studentId)).length, 0);
});

test("signed Tibb membership events on a shared Stripe account are acknowledged without Slowlax access or retries", async () => {
  const metadata = { application: "tibb.nu", integration: "membership", membership_attempt_id: "0".repeat(32) };
  const session = { id: "cs_tibb_membership", mode: "subscription", metadata, payment_status: "paid" };
  for (const type of ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"]) {
    assert.equal((await signed(session, type)).status, 200);
  }
  const subscription = { id: "sub_tibb_membership", metadata, status: "active" };
  subscriptions.set(subscription.id, subscription);
  for (const type of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"]) {
    assert.equal((await signed(subscription, type)).status, 200);
  }
  const invoice = { id: "in_tibb_membership", status: "paid", parent: {
    type: "subscription_details", subscription_details: { subscription: subscription.id, metadata },
  } };
  invoices.set(invoice.id, invoice);
  for (const type of ["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.marked_uncollectible", "invoice.voided", "invoice.finalization_failed"]) {
    assert.equal((await signed(invoice, type)).status, 200);
  }
  const charge = { id: "ch_tibb_membership", metadata, refunded: true };
  charges.set(charge.id, charge);
  assert.equal((await signed(charge, "charge.refunded")).status, 200);
  for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
    assert.equal((await signed({ id: "dp_tibb_membership", charge: charge.id }, type)).status, 200);
  }
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_billing_events").get())!.count, 0);
  assert.equal((await getUserSubscriptions(studentId)).length, 0);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("a price edit during Stripe creation expires that session and releases the changed offer for retry", async () => {
  let release!: () => void; slowCreate = () => new Promise<void>((resolve) => { release = resolve; });
  const result = checkout(); while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...plan, priceOre: 15000, expectedUpdatedAt: plan.updatedAt });
  slowCreate = null; release(); await assert.rejects(result, /ändrats/);
  assert.equal([...sessions.values()][0].status, "expired");
  assert.equal((await getDb().prepare("SELECT status FROM membership_checkout_attempts").get())!.status, "expired");
  await checkout(); assert.equal(sessions.size, 2); assert.equal(checkoutRequests.at(-1)!.params.line_items[0].price_data.unit_amount, 15000);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("changed terms during Stripe creation expire checkout; missing or unsafe portal config prevents selling", async () => {
  let release!: () => void; slowCreate = () => new Promise<void>((resolve) => { release = resolve; });
  const result = checkout(); while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  const settings = await getMembershipSettings();
  await saveMembershipSettings(adminId, { ...settings, terms: "Updated isolated membership terms for this test.", expectedUpdatedAt: settings.updatedAt });
  slowCreate = null; release(); await assert.rejects(result, /ändrats/); assert.equal([...sessions.values()][0].status, "expired");
  const configurationId = process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID!;
  delete process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID;
  try { await assert.rejects(checkout(), /just nu/); assert.equal(membershipPortalReady(), false); }
  finally { process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID = configurationId; }
  configuration.features.subscription_cancel.mode = "immediately";
  await assert.rejects(checkout(), /periodens slut/); assert.equal(sessions.size, 1);
});

test("signed owned invoices whose current subscription lost ownership retry rather than silently acknowledging", async () => {
  await checkout(); const value = activeFixture(); value.subscription.metadata = {};
  assert.equal((await signed(value.invoice, "invoice.paid", "evt_recover_ownership")).status, 500);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
  value.subscription.metadata = value.session.metadata;
  assert.equal((await signed(value.invoice, "invoice.paid", "evt_recover_ownership")).status, 200);
  assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("subscription DTO access follows publication and email verification as well as paid expiry", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice); assert.equal((await onlySub()).hasAccess, true);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal((await onlySub()).hasAccess, false); assert.equal(await hasCourseAccess(studentId, courseId), false);
  await getDb().prepare("UPDATE membership_groups SET published=1 WHERE id=?").run(groupId);
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(studentId);
  assert.equal((await onlySub()).hasAccess, false); assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("an expired reconciliation lease fences a delayed event after a newer cancellation committed", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  let release!: () => void; slowRetrieve = () => new Promise<void>((resolve) => { release = resolve; });
  const older = signed(value.invoice); while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  await getDb().prepare("UPDATE membership_billing_locks SET expires_at='2000-01-01T00:00:00.000Z'").run();
  value.subscription.status = "canceled"; slowRetrieve = null;
  assert.equal((await signed(value.subscription, "customer.subscription.deleted")).status, 200);
  release(); assert.equal((await older).status, 500); assert.equal((await onlySub()).status, "canceled");
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("yearly plans use automatic recurring prices and paid invoice service periods", async () => {
  const plan = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...plan, interval: "year", priceOre: 120000, expectedUpdatedAt: plan.updatedAt });
  await checkout(); assert.equal(checkoutRequests[0].params.line_items[0].price_data.recurring.interval, "year");
  const value = activeFixture([...sessions.values()][0], "year", 365); assert.equal((await signed(value.invoice)).status, 200);
  assert.equal((await onlySub()).priceOre, 120000); assert.equal((await onlySub()).interval, "year");
  assert.equal((await onlySub()).paidUntil, new Date(value.invoice.lines.data[0].period.end * 1000).toISOString());
});

test("pending checkout cancellation is owned, releases a monthly reservation for an annual plan and preserves paid membership", async () => {
  await checkout(); const session = [...sessions.values()][0];
  await cancelMembershipCheckout(otherId, planId); assert.equal(session.status, "open");
  await cancelMembershipCheckout(studentId, planId); assert.equal(session.status, "expired");
  assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.status, "cancelled");
  const annual = await savePlan(adminId, undefined, { name: "Annual membership", slug: "billing-annual", description: "Fixture", groupId, priceOre: 120000, vatPercent: 25, interval: "year", published: true });
  const annualPlan = (await getAdminPlan(adminId, annual))!;
  await createMembershipCheckout(studentId, annual, { consent: true, planRevision: annualPlan.updatedAt, termsRevision: (await getMembershipSettings()).updatedAt });
  const value = activeFixture([...sessions.values()].at(-1), "annual-cancel", 365); await signed(value.invoice);
  await cancelMembershipCheckout(studentId, annual); assert.equal(value.subscription.status, "active"); assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("pending checkouts stay private and can be canceled when sales or the offer are closed", async () => {
  await checkout();
  const original = await getUserPendingCheckouts(studentId);
  assert.equal(original.length, 1);
  assert.equal(original[0].planName, "Monthly membership");
  assert.equal(original[0].priceOre, 12000);
  assert.equal(original[0].canCancel, true);
  assert.deepEqual(Object.keys(original[0]).sort(), ["canCancel", "expiresAt", "groupName", "interval", "planId", "planName", "priceOre"].sort());
  assert.deepEqual(await getUserPendingCheckouts(otherId), []);
  assert.equal(checkoutRequests[0].params.cancel_url, "https://membership.example.test/elevportal/medlemskap?cancelled=1");
  await getDb().prepare("UPDATE membership_settings SET sales_enabled=0 WHERE id=1").run();
  await getDb().prepare("UPDATE membership_plans SET published=0,price_ore=99999 WHERE id=?").run(planId);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.deepEqual(await getUserPendingCheckouts(studentId), original);
  await cancelMembershipCheckout(studentId, planId);
  assert.deepEqual(await getUserPendingCheckouts(studentId), []);
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("pending checkout reads preserve completed payments awaiting reconciliation and hide expired attempts", async () => {
  await checkout();
  await getDb().prepare("UPDATE membership_checkout_attempts SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await getUserPendingCheckouts(studentId), []);
  await getDb().prepare("UPDATE membership_checkout_attempts SET status='completed'").run();
  const waiting = await getUserPendingCheckouts(studentId);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].canCancel, false);
  assert.equal((await getDb().prepare("SELECT status FROM membership_checkout_attempts").get())!.status, "completed");
  assert.equal(await hasCourseAccess(studentId, courseId), false);
});

test("pending checkout access requires current verification and reconciled subscriptions leave the list", async () => {
  await checkout();
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(studentId);
  await assert.rejects(getUserPendingCheckouts(studentId), /verifierat elevkonto/);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), studentId);
  const value = activeFixture();
  assert.equal((await signed(value.invoice)).status, 200);
  assert.deepEqual(await getUserPendingCheckouts(studentId), []);
});

test("uncertain Checkout creation can be recovered and explicitly canceled without opening another session", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/); const session = [...sessions.values()][0];
  await cancelMembershipCheckout(studentId, planId); assert.equal(session.status, "expired");
  assert.equal(checkoutRequests.length, 1); assert.equal(sessions.size, 1);
});

test("checkout confirmation binds session and user, and another paid plan cannot confirm this pending purchase", async () => {
  await checkout(); const session = [...sessions.values()][0];
  assert.equal(await getMembershipCheckoutConfirmation(otherId, session.id), null);
  assert.equal(await getMembershipCheckoutConfirmation(studentId, "cs_missing"), null);
  assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.status, "pending");
  assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.confirmed, false);
  const value = activeFixture(); await signed(value.session, "checkout.session.completed");
  assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.confirmed, false);
  await signed(value.invoice); assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.confirmed, true);
  const secondGroup = await saveGroup(adminId, undefined, { name: "Another group", slug: "another-group", description: "Fixture", published: true, courseIds: [] });
  const secondPlan = await savePlan(adminId, undefined, { name: "Another plan", slug: "another-plan", description: "Fixture", groupId: secondGroup, priceOre: 6000, vatPercent: 25, interval: "month", published: true });
  await createMembershipCheckout(studentId, secondPlan, { consent: true, planRevision: (await getAdminPlan(adminId, secondPlan))!.updatedAt, termsRevision: (await getMembershipSettings()).updatedAt });
  const pending = [...sessions.values()].at(-1)!;
  assert.equal((await getMembershipCheckoutConfirmation(studentId, pending.id))!.confirmed, false);
  assert.match(checkoutRequests[0].params.success_url, /session_id=\{CHECKOUT_SESSION_ID\}/);
});

test("selected VAT creates one immutable inclusive Swedish rate and itemizes invoice taxes without changing gross price", async () => {
  for (const percent of [0, 6, 12, 25] as const) {
    await getDb().exec("DELETE FROM membership_paid_invoices; DELETE FROM membership_subscriptions; DELETE FROM membership_checkout_tax_rates; DELETE FROM membership_checkout_attempts; DELETE FROM membership_customers;");
    sessions.clear(); customers.clear();
    const plan = (await getAdminPlan(adminId, planId))!;
    await savePlan(adminId, planId, { ...plan, vatPercent: percent, priceOre: 10001, expectedUpdatedAt: plan.updatedAt });
    await checkout(); const session = [...sessions.values()][0]; const request = taxRequests.at(-1)!;
    assert.equal(request.params.percentage, percent); assert.equal(request.params.inclusive, true); assert.equal(request.params.country, "SE");
    assert.equal(request.params.tax_type, "vat"); assert.equal(checkoutRequests.at(-1)!.params.billing_address_collection, "required");
    assert.equal(checkoutRequests.at(-1)!.params.line_items[0].price_data.unit_amount, 10001);
    const binding = (await getDb().prepare("SELECT * FROM membership_checkout_tax_rates WHERE attempt_id=?").get(session.client_reference_id))!;
    assert.equal(binding.vat_percent, percent); assert.equal(binding.stripe_id, session.taxRate.id);
    await assert.rejects(getDb().prepare("UPDATE membership_checkout_tax_rates SET stripe_id='txr_foreign' WHERE attempt_id=?").run(session.client_reference_id), /immutable/);
    const value = activeFixture(session, `vat-${percent}`);
    assert.equal(value.invoice.total_taxes[0].amount, Math.round(10001 * percent / (100 + percent)));
    if (!percent) { value.invoice.total_taxes = []; value.invoice.lines.data[0].taxes = []; }
    assert.equal((await signed(value.invoice)).status, 200); assert.equal((await onlySub()).priceOre, 10001); assert.equal((await onlySub()).vatPercent, percent);
    assert.equal(await hasCourseAccess(studentId, courseId), true);
  }
});

test("wrong, missing, overridden, exclusive or misrounded VAT fails payment reconciliation closed", async () => {
  for (const mutate of [
    (value: Fixture) => { value.subscription.default_tax_rates = []; },
    (value: Fixture) => { value.subscription.items.data[0].tax_rates = [value.session.taxRate]; },
    (value: Fixture) => { value.invoice.default_tax_rates[0] = { ...value.session.taxRate, id: "txr_foreign" }; },
    (value: Fixture) => { value.invoice.lines.data[0].taxes = []; },
    (value: Fixture) => { value.invoice.total_taxes[0].amount++; },
    (value: Fixture) => { value.invoice.total_taxes[0].tax_behavior = "exclusive"; },
    (value: Fixture) => { taxRates.get(value.session.taxRate.id)!.percentage = 12; },
  ]) {
    await getDb().exec("DELETE FROM membership_paid_invoices; DELETE FROM membership_subscriptions; DELETE FROM membership_checkout_tax_rates; DELETE FROM membership_checkout_attempts; DELETE FROM membership_customers;");
    sessions.clear(); customers.clear(); await checkout(); const value = activeFixture(); mutate(value);
    assert.equal((await signed(value.invoice)).status, 500); assert.equal((await getUserSubscriptions(studentId)).length, 0);
    assert.equal(await hasCourseAccess(studentId, courseId), false);
  }
});

test("plan VAT edits preserve existing tax rate and old recurring contract; archived rates continue verifying paid invoices", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  const plan = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...plan, vatPercent: 6, expectedUpdatedAt: plan.updatedAt });
  taxRates.get(value.session.taxRate.id)!.active = false;
  assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 200);
  assert.equal((await onlySub()).vatPercent, 25); assert.equal((await onlySub()).priceOre, 12000);
  assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("blocked subscriptions with a changed external price can be terminally closed then replaced by fresh consent", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  value.subscription.items.data[0].price.unit_amount = 15000;
  assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 500); assert.equal((await onlySub()).blocked, true);
  value.subscription.status = "canceled";
  assert.equal((await signed(value.subscription, "customer.subscription.deleted")).status, 200);
  assert.equal((await onlySub()).status, "canceled"); assert.equal((await onlySub()).blocked, true);
  assert.equal((await onlySub()).priceOre, 12000); await checkout(); assert.equal(sessions.size, 2);
});

test("pre-release subscriptions without a VAT binding stay auditable and can close without retrofitting their contract", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice);
  await getDb().prepare("DELETE FROM membership_checkout_tax_rates WHERE attempt_id=?").run(value.session.client_reference_id);
  assert.equal((await signed(value.subscription, "customer.subscription.updated")).status, 500); assert.equal((await onlySub()).blocked, true);
  value.subscription.status = "canceled"; value.subscription.default_tax_rates = [];
  assert.equal((await signed(value.subscription, "customer.subscription.deleted")).status, 200);
  assert.equal((await onlySub()).status, "canceled"); assert.equal((await onlySub()).priceOre, 12000);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM membership_checkout_tax_rates").get())!.count, 0);
});

test("a setup failure on retry never releases a previous uncertain remote Checkout session", async () => {
  createFailure = true; await assert.rejects(checkout(), /timeout/); const session = [...sessions.values()][0];
  configuration.features.subscription_update.enabled = true;
  await assert.rejects(checkout(), /konfigureras/);
  assert.equal(session.status, "open");
  assert.equal((await getDb().prepare("SELECT status FROM membership_checkout_attempts WHERE id=?").get(session.client_reference_id))!.status, "creating");
  const annual = await savePlan(adminId, undefined, { name: "Another interval", slug: "uncertain-year", description: "Fixture", groupId, priceOre: 120000, vatPercent: 25, interval: "year", published: true });
  await assert.rejects(createMembershipCheckout(studentId, annual, { consent: true, planRevision: (await getAdminPlan(adminId, annual))!.updatedAt, termsRevision: (await getMembershipSettings()).updatedAt }), /pågår redan/);
  assert.equal(sessions.size, 1);
});

test("a draft renewal without calculated VAT totals preserves only the previously verified paid access period", async () => {
  await checkout(); const value = activeFixture(); await signed(value.invoice); const paidUntil = (await onlySub()).paidUntil;
  const renewal = activeFixture(value.session, "draft-vat", 31);
  renewal.invoice.status = "draft"; renewal.invoice.amount_paid = 0; renewal.invoice.amount_remaining = 12000;
  renewal.invoice.total_taxes = []; renewal.invoice.lines.data[0].taxes = [];
  assert.equal((await signed(renewal.invoice, "invoice.finalization_failed")).status, 200);
  assert.equal((await onlySub()).paidUntil, paidUntil); assert.equal((await onlySub()).blocked, false);
  assert.equal(await hasCourseAccess(studentId, courseId), true);
});

test("membership snapshots all groups, blocks overlapping secondary purchases and keeps paid confirmation when the primary group is hidden", async () => {
  const timestamp = new Date().toISOString();
  const secondaryCourse = Number((await getDb().prepare("INSERT INTO courses(title,slug,price_ore,published,created_at,updated_at) VALUES(?,?,10000,1,?,?)")
    .run("Secondary member course", `secondary-member-course-${++sequence}`, timestamp, timestamp)).lastInsertRowid);
  const second = await saveGroup(adminId, undefined, { name: "Second paid group", slug: `second-paid-${++sequence}`, description: "Private", published: true, courseIds: [secondaryCourse] });
  const third = await saveGroup(adminId, undefined, { name: "Future paid group", slug: `future-paid-${++sequence}`, description: "Private", published: true, courseIds: [] });
  const original = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...original, groupIds: [groupId, second], expectedUpdatedAt: original.updatedAt });
  assert.deepEqual((await getPublicPlanCourses(planId)).map(course => course.id).sort(), [courseId, secondaryCourse].sort());
  await checkout(); const session = [...sessions.values()][0];
  assert.equal(await getAccessibleGroup(studentId, second), undefined);
  const overlappingPlanId = await savePlan(adminId, undefined, { name: "Secondary group only", slug: `secondary-only-${++sequence}`, description: "Fixture", groupId: second, groupIds: [second], priceOre: 8000, vatPercent: 25, interval: "month", published: true });
  const overlapConsent = { consent: true as const, planRevision: (await getAdminPlan(adminId, overlappingPlanId))!.updatedAt, termsRevision: (await getMembershipSettings()).updatedAt };
  await assert.rejects(createMembershipCheckout(studentId, overlappingPlanId, overlapConsent), /pågår redan/);
  const edited = (await getAdminPlan(adminId, planId))!;
  await savePlan(adminId, planId, { ...edited, groupIds: [groupId, third], expectedUpdatedAt: edited.updatedAt });
  const value = activeFixture(session); assert.equal((await signed(value.invoice)).status, 200);
  assert.ok(await getAccessibleGroup(studentId, second)); assert.equal(await getAccessibleGroup(studentId, third), undefined);
  assert.equal(await hasCourseAccess(studentId, secondaryCourse), true);
  assert.equal((await getAdminSubscriptions(adminId, second))[0].stripeId, value.subscription.id);
  assert.deepEqual((await onlySub()).groups.map(group => group.id).sort(), [groupId, second].sort());
  await assert.rejects(createMembershipCheckout(studentId, overlappingPlanId, overlapConsent), /redan ett medlemskap/);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal((await onlySub()).hasAccess, true); assert.equal((await getMembershipCheckoutConfirmation(studentId, session.id))!.confirmed, true);
  assert.equal((await onlySub()).groups.find(group => group.id === groupId)!.available, false);
  assert.equal((await onlySub()).groups.find(group => group.id === second)!.available, true);
  await assert.rejects(getDb().prepare("UPDATE membership_attempt_groups SET group_name='Changed' WHERE attempt_id=?").run(session.client_reference_id), /immutable/);
  await assert.rejects(getDb().prepare("INSERT INTO membership_attempt_groups(attempt_id,group_id,group_name) VALUES(?,?,?)").run(session.client_reference_id, third, "Future paid group"), /reference/);
  await getDb().prepare("UPDATE membership_groups SET published=1 WHERE id=?").run(groupId);
  await assignGroup(adminId, { email: "billing-student@example.test", groupId: second, expiresAt: null });
  value.charge.refunded = true; value.charge.amount_refunded = value.charge.amount;
  assert.equal((await signed(value.charge, "charge.refunded")).status, 200);
  assert.equal(await getAccessibleGroup(studentId, groupId), undefined); assert.ok(await getAccessibleGroup(studentId, second));
  assert.equal(await hasCourseAccess(studentId, courseId), false); assert.equal(await hasCourseAccess(studentId, secondaryCourse), true);
});
