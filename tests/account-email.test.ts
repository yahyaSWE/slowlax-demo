import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { createFirstAdmin, getDb, getSessionUser, getUser, getUserByEmail, hasCourseAccess } from "../src/lib/db";
import { enrollStudent } from "../src/lib/admin";
import { registerStudent } from "../src/lib/accounts";
import { sendVerificationEmail, verifyEmail, requestPasswordReset, resetPassword, RESET_REQUEST_MESSAGE } from "../src/lib/account-email";
import { EmailConfigurationError, emailConfigurationStatus, sendEmail } from "../src/lib/email-provider";
import { enforceRequestLimit, trustedClientIp } from "../src/lib/request-rate-limit";
import { hashPassword, tokenHash, verifyPassword } from "../src/lib/security";
import { resolveAccountReturnTo, UNAVAILABLE_SELECTED_COURSE } from "../src/lib/account-return-destination";

// Independent real SQLite; no deployment credentials, disk or email network.
for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "TRUST_PROXY", "RESEND_API_KEY", "EMAIL_FROM", "APP_URL"]) delete process.env[key];
process.env.TIBB_DATABASE_PATH = ":memory:";
const originalFetch = globalThis.fetch;
type Sent = { from: string; to: string[]; subject: string; text: string };
let sent: Sent[] = [];
let adminId: number;
let sequence = 0;
const originalPassword = "fixture original password only";
before(async () => {
  adminId = (await createFirstAdmin({ name: "Account test admin", email: "account-admin@example.test", passwordHash: hashPassword(originalPassword) })).id;
});
beforeEach(() => {
  sent = [];
  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY;
  process.env.RESEND_API_KEY = "fixture-key-never-sent";
  process.env.EMAIL_FROM = "Tibb <sender@example.test>";
  process.env.APP_URL = "https://website.example.test";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-key-never-sent");
    assert.ok(headers.get("idempotency-key"));
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return Response.json({ id: `test-accepted-${sent.length}` });
  };
});
after(async () => { globalThis.fetch = originalFetch; await getDb().close(); });
async function student() {
  return registerStudent({ name: "Account test student", email: `account-${++sequence}@example.test`, password: originalPassword });
}
function mailedToken() {
  const url = sent.at(-1)?.text.match(/https:\/\/website\.example\.test\/[^\s]+/);
  assert.ok(url, "mocked message must contain the configured origin");
  const token = new URL(url[0]).searchParams.get("token");
  assert.match(token!, /^[a-f0-9]{64}$/);
  return token!;
}
function mailedUrl() {
  const match = sent.at(-1)?.text.match(/https:\/\/website\.example\.test\/[^\s]+/);
  assert.ok(match);
  return new URL(match[0]);
}
async function addSession(userId: number, raw: string) {
  await getDb().prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(tokenHash(raw), userId, new Date(Date.now() + 60_000).toISOString());
}
async function course() {
  const now = new Date().toISOString();
  const created = await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,0,1,?,?)")
    .run("Ownership course", `ownership-${++sequence}`, "", now, now);
  return Number(created.lastInsertRowid);
}

test("missing email configuration fails closed without verifying accounts or claiming delivery", async () => {
  const user = await student();
  delete process.env.RESEND_API_KEY;
  assert.equal(emailConfigurationStatus().configured, false);
  await assert.rejects(sendVerificationEmail(user.id), EmailConfigurationError);
  await assert.rejects(requestPasswordReset(user.email), EmailConfigurationError);
  await assert.rejects(requestPasswordReset("unknown@example.test"), EmailConfigurationError);
  assert.equal((await getUser(user.id))!.emailVerifiedAt, null);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM auth_tokens").get())!.total, 0);
  assert.equal(sent.length, 0);
  assert.equal((await getUser(adminId))!.role, "admin");
});

test("verification stores only a token hash, requires the registered password and consumes once", async () => {
  const user = await student();
  await addSession(user.id, "old-verification-session");
  await sendVerificationEmail(user.id);
  const token = mailedToken();
  const row = (await getDb().prepare("SELECT * FROM auth_tokens WHERE user_id=?").get(user.id))!;
  assert.equal(row.token_hash, tokenHash(token));
  assert.ok(!JSON.stringify(row).includes(token));
  assert.equal(row.kind, "verify-email");
  assert.ok(Date.parse(String(row.expires_at)) - Date.now() > 23 * 60 * 60 * 1000);
  await assert.rejects(verifyEmail({ token, password: "mail owner did not set this" }), /lösenord/);
  assert.equal((await getUser(user.id))!.emailVerifiedAt, null);
  assert.ok(await getSessionUser(tokenHash("old-verification-session")));
  const verified = await verifyEmail({ token, password: originalPassword });
  assert.ok(verified.emailVerifiedAt);
  assert.equal(await getSessionUser(tokenHash("old-verification-session")), undefined);
  await assert.rejects(verifyEmail({ token, password: originalPassword }), /Länken/);
});

test("expired links fail while recent resend links stay valid until successful consumption", async () => {
  const user = await student();
  await sendVerificationEmail(user.id);
  const expired = mailedToken();
  await getDb().prepare("UPDATE auth_tokens SET expires_at=? WHERE user_id=?").run("2000-01-01T00:00:00.000Z", user.id);
  await assert.rejects(verifyEmail({ token: expired, password: originalPassword }), /Länken/);
  await sendVerificationEmail(user.id);
  const old = mailedToken();
  await sendVerificationEmail(user.id);
  const current = mailedToken();
  assert.notEqual(old, current);
  assert.ok((await verifyEmail({ token: old, password: originalPassword })).emailVerifiedAt);
  await assert.rejects(verifyEmail({ token: current, password: originalPassword }), /Länken/);
});

test("selected course is carried by verification email and resend links across browsers without bypassing the password", async () => {
  const user = await student();
  const id = await course();
  const slug = String((await getDb().prepare("SELECT slug FROM courses WHERE id=?").get(id))!.slug);
  const destination = `/kurser/${slug}`;
  await sendVerificationEmail(user.id, destination);
  const initial = mailedUrl();
  assert.equal(initial.searchParams.get("returnTo"), destination);
  await assert.rejects(verifyEmail({ token: initial.searchParams.get("token")!, password: "wrong fixture password" }), /lösenord/);
  assert.equal((await getUser(user.id))!.emailVerifiedAt, null);
  assert.equal(await resolveAccountReturnTo(initial.searchParams.get("returnTo")), destination);
  await sendVerificationEmail(user.id, destination);
  const resent = mailedUrl();
  assert.equal(resent.searchParams.get("returnTo"), destination);
  assert.notEqual(resent.searchParams.get("token"), initial.searchParams.get("token"));
  assert.ok((await verifyEmail({ token: resent.searchParams.get("token")!, password: originalPassword })).emailVerifiedAt);
  assert.equal(await resolveAccountReturnTo(resent.searchParams.get("returnTo")), destination);
});

test("unavailable selected courses return to the catalog and unsafe email destinations are omitted", async () => {
  const user = await student();
  const id = await course();
  const slug = String((await getDb().prepare("SELECT slug FROM courses WHERE id=?").get(id))!.slug);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(id);
  for (const destination of [`/kurser/${slug}`, "/kurser/course-no-longer-exists"]) {
    const redirect = new URL(await resolveAccountReturnTo(destination), "https://website.example.test");
    assert.equal(redirect.pathname, "/kurser");
    assert.equal(redirect.searchParams.get("message"), UNAVAILABLE_SELECTED_COURSE);
  }
  await sendVerificationEmail(user.id, "//evil.example/steal");
  assert.equal(mailedUrl().searchParams.has("returnTo"), false);
  assert.equal(await resolveAccountReturnTo("/%252f%252fevil.example"), "/elevportal");
});

test("password reset emails retain selected course context while legacy links still omit a return destination", async () => {
  const user = await student();
  assert.equal(await requestPasswordReset(user.email, "/kurser/avancerad-hijama"), RESET_REQUEST_MESSAGE);
  assert.equal(mailedUrl().pathname, "/aterstall-losenord");
  assert.equal(mailedUrl().searchParams.get("returnTo"), "/kurser/avancerad-hijama");
  await sendVerificationEmail(user.id);
  assert.equal(mailedUrl().searchParams.has("returnTo"), false);
  assert.ok((await verifyEmail({ token: mailedToken(), password: originalPassword })).emailVerifiedAt);
});

test("reset reclaims a squatted email, changes credentials and revokes every session and token", async () => {
  const user = await student();
  await addSession(user.id, "squatter-session-1");
  await addSession(user.id, "squatter-session-2");
  await sendVerificationEmail(user.id);
  const previousVerification = mailedToken();
  assert.equal(await requestPasswordReset(user.email), RESET_REQUEST_MESSAGE);
  const token = mailedToken();
  const nextPassword = "mail owner's private new password";
  await resetPassword({ token, password: nextPassword });
  const reclaimed = (await getUserByEmail(user.email))!;
  assert.ok(reclaimed.emailVerifiedAt);
  assert.equal(reclaimed.role, "student");
  assert.equal(verifyPassword(originalPassword, reclaimed.passwordHash), false);
  assert.equal(verifyPassword(nextPassword, reclaimed.passwordHash), true);
  assert.equal(await getSessionUser(tokenHash("squatter-session-1")), undefined);
  assert.equal(await getSessionUser(tokenHash("squatter-session-2")), undefined);
  await assert.rejects(verifyEmail({ token: previousVerification, password: originalPassword }), /Länken/);
  await assert.rejects(resetPassword({ token, password: nextPassword }), /redan använts/);
});

test("reset expiration, weak passwords and simultaneous consumption cannot bypass token ownership", async () => {
  const user = await student();
  await requestPasswordReset(user.email);
  const expired = mailedToken();
  await getDb().prepare("UPDATE auth_tokens SET expires_at=? WHERE user_id=?").run("2000-01-01T00:00:00.000Z", user.id);
  await assert.rejects(resetPassword({ token: expired, password: "new valid fixture password" }), /löpt ut/);
  await requestPasswordReset(user.email);
  const token = mailedToken();
  await assert.rejects(resetPassword({ token, password: "short" }), /12 tecken/);
  const results = await Promise.allSettled([
    resetPassword({ token, password: "winning fixture password one" }),
    resetPassword({ token, password: "winning fixture password two" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("reset preserves admin privileges and never exposes account existence or provider failures in its response", async () => {
  const admin = (await getUser(adminId))!;
  const unknown = await requestPasswordReset("unknown-reset@example.test");
  assert.equal(sent.length, 0);
  const known = await requestPasswordReset(admin.email);
  assert.equal(known, unknown);
  await resetPassword({ token: mailedToken(), password: "recovered administrator password" });
  assert.equal((await getUser(admin.id))!.role, "admin");
  globalThis.fetch = async () => Response.json({ error: "provider failure containing private details" }, { status: 503 });
  assert.equal(await requestPasswordReset(admin.email), unknown);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM auth_tokens WHERE user_id=?").get(admin.id))!.total, 1);
});

test("an accepted message followed by a network timeout keeps both old and new links valid and bounds stored tokens", async () => {
  const user = await student();
  await sendVerificationEmail(user.id);
  const original = mailedToken();
  const acceptingFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { await acceptingFetch(url, init); throw new Error("uncertain timeout after acceptance"); };
  await assert.rejects(sendVerificationEmail(user.id), /svarar inte/);
  const uncertain = mailedToken();
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM auth_tokens WHERE user_id=?").get(user.id))!.total, 2);
  assert.ok(await getDb().prepare("SELECT token_hash FROM auth_tokens WHERE token_hash=?").get(tokenHash(original)));
  assert.ok((await verifyEmail({ token: uncertain, password: originalPassword })).emailVerifiedAt);
  const another = await student();
  globalThis.fetch = acceptingFetch;
  for (let index = 0; index < 5; index++) await sendVerificationEmail(another.id);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM auth_tokens WHERE user_id=?").get(another.id))!.total, 3);
});

test("new grants require verified ownership while legacy access and idempotent existing grants remain usable", async () => {
  const user = await student();
  const existing = await course();
  const fresh = await course();
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(user.id, existing, new Date().toISOString());
  assert.equal(await hasCourseAccess(user.id, existing), true);
  await enrollStudent(adminId, existing, user.email);
  await assert.rejects(enrollStudent(adminId, fresh, user.email), /verifiera/);
  assert.equal(await hasCourseAccess(user.id, fresh), false);
  await sendVerificationEmail(user.id);
  await verifyEmail({ token: mailedToken(), password: originalPassword });
  await enrollStudent(adminId, fresh, user.email);
  assert.equal(await hasCourseAccess(user.id, fresh), true);
});

test("trusted IP detection rejects spoofed local/invalid values and explicitly supports Vercel or configured proxies", () => {
  const h = new Headers({ "x-forwarded-for": "203.0.113.10", "x-vercel-forwarded-for": "2001:db8::2" });
  assert.equal(trustedClientIp(h), null);
  process.env.TRUST_PROXY = "1";
  assert.equal(trustedClientIp(h), "203.0.113.10");
  process.env.VERCEL = "1";
  assert.equal(trustedClientIp(h), "2001:db8::2");
  assert.equal(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "not-an-ip", "x-forwarded-for": "203.0.113.10" })), null);
  assert.equal(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.1, 198.51.100.1" })), "203.0.113.1");
});

test("untrusted local requests limit each subject without a shared global-site lock; trusted IPs add a separate limit", async () => {
  const headers = new Headers({ "x-forwarded-for": "untrusted-spoof" });
  for (let index = 0; index < 105; index++) await enforceRequestLimit("local-fixture", `person-${index}`, 1, headers);
  await assert.rejects(enforceRequestLimit("local-fixture", "person-0", 1, headers), /För många/);
  await enforceRequestLimit("local-fixture", "new-person", 1, headers);
  process.env.TRUST_PROXY = "1";
  const proxy = new Headers({ "x-forwarded-for": "198.51.100.55" });
  for (let index = 0; index < 100; index++) await enforceRequestLimit("proxy-fixture", `person-${index}`, 2, proxy);
  await assert.rejects(enforceRequestLimit("proxy-fixture", "new-person", 2, proxy), /För många/);
  assert.ok(!(await getDb().prepare("SELECT key FROM rate_limits").all()).some((row) => String(row.key).includes("global")));
});

test("provider validates trusted origins and sender syntax without trusting a request host", async () => {
  process.env.EMAIL_FROM = "sender@example.test>";
  assert.equal(emailConfigurationStatus().configured, false);
  process.env.EMAIL_FROM = "Tibb <sender@example.test>";
  for (const url of ["https://user:password@example.test", "https://example.test/wrong-path", "https://example.test/?next=evil", "javascript:bad"]) {
    process.env.APP_URL = url;
    assert.equal(emailConfigurationStatus().configured, false);
  }
  process.env.APP_URL = "https://website.example.test";
  await sendEmail({ to: "recipient@example.test", subject: "Neutral message", text: "No patient details", idempotencyKey: "provider-fixture" });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { from: "Tibb <sender@example.test>", to: ["recipient@example.test"], subject: "Neutral message", text: "No patient details" });
});
