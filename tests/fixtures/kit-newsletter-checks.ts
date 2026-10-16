import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFirstAdmin, createUser, getDb, getUser, getUserByEmail, type User } from "../../src/lib/db";
import { registerStudent } from "../../src/lib/accounts";
import { getKitNewsletterSettings, getKitSignupNotice, recordFreeMembershipNewsletter, recordNewStudentNewsletter, saveKitNewsletterSettings } from "../../src/lib/kit-newsletter-domain";
import { getStudentFreeMembership, joinFreeMembership } from "../../src/lib/free-membership-domain";
import { dispatchKitNewsletterOutbox, getKitNewsletterAdminOverview, retryKitNewsletterJob } from "../../src/lib/kit-newsletter";
import { GET as runCron } from "../../src/app/api/cron/kit-newsletter/route";

// This file runs in a child process with the React server condition. All data
// is held in isolated in-memory SQLite; every fetch is mocked before any call.
type RemoteSubscriber = { id: number; email_address: string; state: "active" | "inactive" | "cancelled" | "bounced" | "complained" };
type Call = { url: URL; method: string; body: Record<string, unknown> | null };
const originalFetch = globalThis.fetch;
const subscribers = new Map<string, RemoteSubscriber>();
const formMemberships = new Set<string>();
const tagMemberships = new Set<string>();
let calls: Call[] = [];
let confirmations = 0;
let sequence = 0;
let remoteId = 100;
let actor: User;
let fault: ((call: Call) => Response | null) | null = null;
const fixtureKey = "kit-fixture-key-never-sent-to-the-network";
const enabledSettings = { enabled: true, formId: "9288768", tagId: null, doubleOptInConfirmed: true };

before(async () => {
  process.env.TIBB_DATABASE_PATH = ":memory:";
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL"]) delete process.env[key];
  actor = await createFirstAdmin({ name: "Kit test admin", email: "kit-admin@example.test", passwordHash: "fixture-password-hash" });
});

beforeEach(async () => {
  process.env.KIT_API_KEY = fixtureKey;
  delete process.env.CRON_SECRET;
  subscribers.clear(); formMemberships.clear(); tagMemberships.clear(); calls = []; confirmations = 0; fault = null;
  await getDb().prepare("DELETE FROM kit_newsletter_outbox").run();
  await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(actor.id);
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, enabled: false, doubleOptInConfirmed: false });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.kit.com");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("X-Kit-Api-Key"), fixtureKey);
    const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const failed = fault?.(call);
    if (failed) return failed;
    if (call.method === "GET" && url.pathname === "/v4/subscribers") {
      assert.equal(url.searchParams.get("status"), "all");
      const subscriber = subscribers.get(url.searchParams.get("email_address")!);
      return Response.json({ subscribers: subscriber ? [subscriber] : [] });
    }
    if (call.method === "GET" && /^\/v4\/subscribers\/\d+$/.test(url.pathname)) {
      const subscriber = [...subscribers.values()].find((item) => item.id === Number(url.pathname.split("/").at(-1)));
      assert.ok(subscriber);
      return Response.json({ subscriber });
    }
    if (call.method === "POST" && url.pathname === "/v4/subscribers") {
      assert.equal(call.body?.state, "inactive");
      const email = String(call.body?.email_address);
      const subscriber: RemoteSubscriber = subscribers.get(email) ?? { id: ++remoteId, email_address: email, state: "inactive" };
      subscribers.set(email, subscriber);
      return Response.json({ subscriber }, { status: 201 });
    }
    const association = url.pathname.match(/^\/v4\/(forms|tags)\/(\d+)\/subscribers\/(\d+)$/);
    assert.ok(association, "Unexpected outbound URL is never passed to the network");
    assert.equal(call.method, "POST");
    const subscriber = [...subscribers.values()].find((item) => item.id === Number(association[3]));
    assert.ok(subscriber);
    const key = `${association[2]}:${association[3]}`;
    if (association[1] === "forms") {
      assert.equal(call.body?.referrer, "https://slowlax.se/registrera");
      if (!formMemberships.has(key)) confirmations++;
      formMemberships.add(key);
    } else tagMemberships.add(key);
    return Response.json({ subscriber });
  };
});

after(async () => { globalThis.fetch = originalFetch; await getDb().close(); });

async function student(verified = false) {
  const user = await registerStudent({ name: "Kit student Test", email: `kit-student-${++sequence}@example.test`, password: "Kit fixture password only" });
  if (verified) await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), user.id);
  return (await getUser(user.id))!;
}
async function job(userId: number) { return (await getDb().prepare("SELECT * FROM kit_newsletter_outbox WHERE user_id=?").get(userId))!; }
async function enable() { return saveKitNewsletterSettings(actor.id, enabledSettings); }
async function legacyStudent(verified = true) {
  const user = await createUser({ name: "Existing Bas student", email: `kit-legacy-${++sequence}@example.test`, passwordHash: "fixture-hash", role: "student" });
  if (verified) await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), user.id);
  return (await getUser(user.id))!;
}

test("configuration defaults off, needs a secret and a double opt-in acknowledgment", async () => {
  assert.equal((await getKitNewsletterSettings()).enabled, false);
  assert.equal((await getKitSignupNotice()).enabled, false);
  delete process.env.KIT_API_KEY;
  await assert.rejects(enable(), /KIT_API_KEY/);
  process.env.KIT_API_KEY = fixtureKey;
  await assert.rejects(saveKitNewsletterSettings(actor.id, { ...enabledSettings, doubleOptInConfirmed: false }), /bekräftelsemejl/);
  await enable();
  const notice = await getKitSignupNotice();
  assert.equal(notice.enabled, true);
  assert.match(notice.message!, /separat inbjudan/);
  assert.match(notice.message!, /Bekräfta/);
  const overview = await getKitNewsletterAdminOverview(actor.id);
  assert.equal(overview.keyConfigured, true);
  assert.ok(!JSON.stringify(overview).includes(fixtureKey));
  assert.equal(calls.length, 0);
});

test("admin mutations enforce the current role and only accept allowlisted settings", async () => {
  const user = await student();
  await assert.rejects(saveKitNewsletterSettings(user.id, enabledSettings), /administrationen/);
  await assert.rejects(getKitNewsletterAdminOverview(user.id), /administrationen/);
  await assert.rejects(saveKitNewsletterSettings(actor.id, { ...enabledSettings, formId: "../../../evil" }));
  await assert.rejects(saveKitNewsletterSettings(actor.id, { ...enabledSettings, apiKey: "must-not-persist" }));
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(actor.id);
  await assert.rejects(enable(), /administrationen/);
  assert.equal((await getKitNewsletterSettings()).enabled, false);
});

test("new students join Bas and the durable outbox once without automatically backfilling existing students", async () => {
  const old = await student(true);
  await enable();
  assert.equal(await job(old.id), undefined);
  const user = await student();
  const bas = await getStudentFreeMembership(user.id);
  assert.equal(bas.isMember, true);
  assert.equal(bas.verified, false);
  assert.equal((await job(user.id)).status, "waiting_verification");
  assert.deepEqual(await recordNewStudentNewsletter(user.id), { queued: false });
  assert.deepEqual(await recordNewStudentNewsletter(actor.id), { queued: false });
  await assert.rejects(registerStudent({ name: "Duplicate", email: user.email, password: "Kit fixture password only" }), /används redan/);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM kit_newsletter_outbox").get())!.count, 1);
  assert.equal(calls.length, 0);
});

test("an explicit existing-student Bas join queues one missing invitation and preserves a sent intent", async () => {
  const user = await legacyStudent();
  await enable();
  assert.equal((await getStudentFreeMembership(user.id)).isMember, false);
  assert.equal(await job(user.id), undefined);
  await joinFreeMembership(user.id);
  const first = await job(user.id);
  assert.equal(first.status, "pending");
  await joinFreeMembership(user.id);
  assert.equal((await job(user.id)).id, first.id);
  assert.equal((await getStudentFreeMembership(user.id)).isMember, true);
  assert.equal(calls.length, 0);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).sent, 1);
  const sent = await job(user.id);
  const count = calls.length;
  await joinFreeMembership(user.id);
  assert.deepEqual(await job(user.id), sent);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
  assert.equal(calls.length, count);
  assert.equal(confirmations, 1);
});

test("explicit Bas joins require a verified student and can queue after Kit is enabled later", async () => {
  const pending = await legacyStudent(false);
  await enable();
  await assert.rejects(joinFreeMembership(pending.id));
  await assert.rejects(joinFreeMembership(actor.id));
  assert.equal((await getStudentFreeMembership(pending.id)).isMember, false);
  assert.equal(await job(pending.id), undefined);
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, enabled: false });
  const user = await legacyStudent();
  await joinFreeMembership(user.id);
  assert.equal(await job(user.id), undefined);
  await enable();
  await joinFreeMembership(user.id);
  assert.equal((await job(user.id)).status, "pending");
  assert.deepEqual(await recordFreeMembershipNewsletter(actor.id), { queued: false });
  assert.equal(calls.length, 0);
});

test("a Bas join never resets an unsubscribed or failed newsletter intent", async () => {
  const user = await legacyStudent();
  await enable();
  subscribers.set(user.email, { id: ++remoteId, email_address: user.email, state: "cancelled" });
  await joinFreeMembership(user.id);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).skipped, 1);
  const skipped = await job(user.id);
  const count = calls.length;
  await joinFreeMembership(user.id);
  assert.deepEqual(await job(user.id), skipped);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
  assert.equal(calls.length, count);
  assert.equal(calls.filter(call => call.method === "POST").length, 0);
  const failedUser = await legacyStudent();
  await joinFreeMembership(failedUser.id);
  await getDb().prepare("UPDATE kit_newsletter_outbox SET status='failed',attempts=5,last_error='fixture terminal failure' WHERE user_id=?").run(failedUser.id);
  const failed = await job(failedUser.id);
  await joinFreeMembership(failedUser.id);
  assert.deepEqual(await job(failedUser.id), failed);
});

test("local signup rolls back the account and Bas membership if its newsletter intent cannot persist", async () => {
  await enable();
  const before = (await getDb().prepare("SELECT COUNT(*) AS count FROM free_membership_members").get())!.count;
  await getDb().exec("CREATE TEMP TRIGGER fixture_reject_newsletter_intent BEFORE INSERT ON kit_newsletter_outbox BEGIN SELECT RAISE(ABORT,'fixture rejects newsletter intent'); END");
  try {
    await assert.rejects(registerStudent({ name: "Atomic Bas student", email: "kit-atomic-bas@example.test", password: "Kit fixture password only" }), /fixture rejects newsletter intent/);
    assert.equal(await getUserByEmail("kit-atomic-bas@example.test"), undefined);
    assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM free_membership_members").get())!.count, before);
    assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM kit_newsletter_outbox").get())!.count, 0);
    assert.equal(calls.length, 0);
  } finally {
    await getDb().exec("DROP TRIGGER fixture_reject_newsletter_intent");
  }
});

test("verification gates dispatch and new subscribers start inactive before joining the form", async () => {
  await enable();
  const user = await student();
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
  assert.equal(calls.length, 0);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), user.id);
  const result = await dispatchKitNewsletterOutbox({ userId: user.id });
  assert.equal(result.sent, 1);
  assert.equal((await job(user.id)).status, "sent");
  assert.equal(subscribers.get(user.email)!.state, "inactive");
  assert.equal(calls[1].body?.first_name, "Kit");
  assert.equal(confirmations, 1);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
  assert.equal(confirmations, 1);
});

test("each cancelled, bounced or complained address is skipped without any API write", async () => {
  await enable();
  for (const state of ["cancelled", "bounced", "complained"] as const) {
    const user = await student(true);
    subscribers.set(user.email, { id: ++remoteId, email_address: user.email, state });
    // The list API may still report the old active status. The strong ID read
    // must prevent a stale lookup from reactivating an unsubscribed address.
    fault = (call) => call.method === "GET" && call.url.pathname === "/v4/subscribers"
      ? Response.json({ subscribers: [{ ...subscribers.get(user.email), state: "active" }] }) : null;
    const result = await dispatchKitNewsletterOutbox({ userId: user.id });
    assert.equal(result.skipped, 1);
    const stored = await job(user.id);
    assert.equal(stored.status, "skipped");
    await assert.rejects(retryKitNewsletterJob(actor.id, String(stored.id)), /återaktiveras inte/);
  }
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("existing active subscribers retain their state and get the optional student tag", async () => {
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, tagId: "12345" });
  const user = await student(true);
  const subscriber = { id: ++remoteId, email_address: user.email, state: "active" as const };
  subscribers.set(user.email, subscriber);
  await dispatchKitNewsletterOutbox({ userId: user.id });
  assert.equal(subscribers.get(user.email)!.state, "active");
  assert.equal(calls.some((call) => call.url.pathname === "/v4/subscribers" && call.method === "POST"), false);
  assert.ok(tagMemberships.has(`12345:${subscriber.id}`));
});

test("temporary provider failures leave the account intact and retry only when due", async () => {
  await enable();
  const user = await student(true);
  fault = () => { throw new TypeError("mock secret must never leak"); };
  const first = await dispatchKitNewsletterOutbox({ userId: user.id });
  assert.equal(first.failed, 1);
  assert.equal((await getUser(user.id))!.role, "student");
  let stored = await job(user.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.attempts, 1);
  assert.ok(Date.parse(String(stored.next_attempt_at)) > Date.now());
  assert.doesNotMatch(String(stored.last_error), /mock secret/);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
  await getDb().prepare("UPDATE kit_newsletter_outbox SET next_attempt_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", String(stored.id));
  fault = null;
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).sent, 1);
  stored = await job(user.id);
  assert.equal(stored.attempts, 2);
  assert.equal(stored.last_error, null);
});

test("401/422 errors stop automatic retry and expose only a safe actionable error", async () => {
  await enable();
  for (const status of [401, 422]) {
    const user = await student(true);
    fault = () => Response.json({ errors: [`private ${fixtureKey}`] }, { status });
    await dispatchKitNewsletterOutbox({ userId: user.id });
    const stored = await job(user.id);
    assert.equal(stored.status, "failed");
    assert.ok(String(stored.last_error).includes(`HTTP ${status}`));
    assert.ok(!String(stored.last_error).includes(fixtureKey));
    assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).processed, 0);
    fault = null;
    assert.equal(await retryKitNewsletterJob(actor.id, String(stored.id)), user.id);
    assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).sent, 1);
  }
});

test("a lost tag response is retried idempotently without duplicate subscriber or confirmation", async () => {
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, tagId: "12345" });
  const user = await student(true);
  fault = (call) => {
    const tag = call.url.pathname.match(/\/tags\/(\d+)\/subscribers\/(\d+)$/);
    if (!tag) return null;
    // Kit accepted the relationship, but the connection broke before its reply.
    tagMemberships.add(`${tag[1]}:${tag[2]}`);
    throw new TypeError("mock lost response after an accepted tag");
  };
  await dispatchKitNewsletterOutbox({ userId: user.id });
  const stored = await job(user.id);
  assert.equal(stored.status, "pending");
  assert.equal(confirmations, 1);
  fault = null;
  await getDb().prepare("UPDATE kit_newsletter_outbox SET next_attempt_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", String(stored.id));
  await dispatchKitNewsletterOutbox({ userId: user.id });
  assert.equal(subscribers.size, 1);
  assert.equal(confirmations, 1);
  assert.equal((await job(user.id)).status, "sent");
  assert.equal(tagMemberships.size, 1);
});

test("a subscriber who cancels between attempts is not reactivated on retry", async () => {
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, tagId: "12345" });
  const user = await student(true);
  fault = (call) => call.url.pathname.includes("/tags/") ? Response.json({}, { status: 503 }) : null;
  await dispatchKitNewsletterOutbox({ userId: user.id });
  const subscriber = subscribers.get(user.email)!;
  subscribers.set(user.email, { ...subscriber, state: "cancelled" });
  const count = calls.filter((call) => call.method === "POST").length;
  fault = null;
  await getDb().prepare("UPDATE kit_newsletter_outbox SET next_attempt_at=? WHERE user_id=?").run("2000-01-01T00:00:00.000Z", user.id);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: user.id })).skipped, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, count);
  assert.equal(subscribers.get(user.email)!.state, "cancelled");
});

test("concurrent workers claim a single lease and expired leases resume with a bounded attempt budget", async () => {
  await enable();
  const user = await student(true);
  const results = await Promise.all([dispatchKitNewsletterOutbox({ userId: user.id }), dispatchKitNewsletterOutbox({ userId: user.id })]);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(confirmations, 1);
  const other = await student(true);
  const stored = await job(other.id);
  await getDb().prepare("UPDATE kit_newsletter_outbox SET status='sending',attempts=4,lease_until=?,lease_token=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", randomUUID(), String(stored.id));
  fault = () => Response.json({}, { status: 429 });
  await dispatchKitNewsletterOutbox({ userId: other.id });
  assert.equal((await job(other.id)).status, "failed");
  assert.equal((await job(other.id)).attempts, 5);
  assert.equal((await dispatchKitNewsletterOutbox({ userId: other.id })).processed, 0);
});

test("disabling or removing credentials pauses jobs and does not queue subsequent students", async () => {
  await enable();
  const user = await student(true);
  delete process.env.KIT_API_KEY;
  assert.equal((await getKitSignupNotice()).enabled, false);
  assert.equal((await dispatchKitNewsletterOutbox()).configured, false);
  await student(true);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM kit_newsletter_outbox").get())!.count, 1);
  process.env.KIT_API_KEY = fixtureKey;
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, enabled: false });
  assert.equal((await dispatchKitNewsletterOutbox()).processed, 0);
  assert.equal((await job(user.id)).status, "waiting_verification");
  assert.equal(calls.length, 0);
});

test("configuration snapshots are stable and altered email or role cannot receive an invitation", async () => {
  await enable();
  const user = await student(true);
  await saveKitNewsletterSettings(actor.id, { ...enabledSettings, formId: "22222" });
  await dispatchKitNewsletterOutbox({ userId: user.id });
  assert.ok(calls.some((call) => call.url.pathname.includes("/forms/9288768/")));
  for (const change of ["email", "role"] as const) {
    const other = await student(true);
    if (change === "email") await getDb().prepare("UPDATE users SET email=? WHERE id=?").run(`changed-${++sequence}@example.test`, other.id);
    else await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(other.id);
    const count = calls.length;
    await dispatchKitNewsletterOutbox({ userId: other.id });
    assert.equal((await job(other.id)).status, "skipped");
    assert.equal(calls.length, count);
  }
});

test("cron rejects missing, absent and incorrect bearer secrets before accessing Kit", async () => {
  await enable();
  const user = await student(true);
  const request = (token?: string) => new Request("https://example.test/api/cron/kit-newsletter", { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await runCron(request())).status, 401);
  process.env.CRON_SECRET = "cron-fixture-only";
  assert.equal((await runCron(request())).status, 401);
  assert.equal((await runCron(request("incorrect"))).status, 401);
  assert.equal(calls.length, 0);
  const response = await runCron(request("cron-fixture-only"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await job(user.id)).status, "sent");
});

test("deleting a student deletes their newsletter intent and private delivery details", async () => {
  await enable();
  const user = await student();
  assert.ok(await job(user.id));
  await getDb().prepare("DELETE FROM users WHERE id=?").run(user.id);
  assert.equal(await job(user.id), undefined);
});
