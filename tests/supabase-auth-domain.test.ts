import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFirstAdmin, createUser, getDb, getUser, getUserByEmail, type User } from "../src/lib/db";
import { synchronizeSupabaseUser } from "../src/lib/supabase-auth-domain";
import { requireSupabaseAuthConfiguration, supabaseAuthConfigurationStatus, supabaseAuthRequested } from "../src/lib/supabase-auth-config";
import { saveKitNewsletterSettings } from "../src/lib/kit-newsletter-domain";
import { getStudentFreeMembership } from "../src/lib/free-membership-domain";

const authVariables = ["SUPABASE_AUTH_ENABLED", "SUPABASE_DATABASE_ENABLED", "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ADMIN_USER_ID", "APP_URL"];
const previous = Object.fromEntries(authVariables.map((key) => [key, process.env[key]]));
for (const key of [...authVariables, "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL"]) delete process.env[key];
process.env.TIBB_DATABASE_PATH = ":memory:";
let admin: User;
let sequence = 0;
const now = () => new Date().toISOString();
function provider(email = `supabase-${++sequence}@example.test`, verified = true) {
  return { id: randomUUID(), email, email_confirmed_at: verified ? now() : null,
    user_metadata: { name: "Supabase student", role: "admin", email_verified: true } };
}
async function local(role: "admin" | "student" = "student") {
  return createUser({ name: "Existing name", email: `local-supabase-${++sequence}@example.test`, role, passwordHash: "legacy-hash" });
}
function configure() {
  process.env.SUPABASE_AUTH_ENABLED = "true";
  process.env.SUPABASE_DATABASE_ENABLED = "true";
  process.env.DATABASE_URL = "postgresql://fixture:fixture-password@db.project-fixture.supabase.co:5432/postgres";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_public_key_only";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture_private_key_only";
  process.env.APP_URL = "https://slowlax.example.test";
}
before(async () => {
  admin = await createFirstAdmin({ name: "Supabase bridge admin", email: "supabase-bridge-admin@example.test", passwordHash: "fixture-admin-hash" });
});
beforeEach(async () => {
  for (const key of authVariables) delete process.env[key];
  process.env.KIT_API_KEY = "kit-fixture-no-network";
  await saveKitNewsletterSettings(admin.id, { enabled: false, formId: "9288768", tagId: null, doubleOptInConfirmed: false });
});
after(async () => {
  await getDb().close();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("public Supabase keys never switch local authentication or the database implicitly", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_public_key_only";
  assert.equal(supabaseAuthRequested(), false);
  assert.deepEqual(supabaseAuthConfigurationStatus(), { enabled: false, configured: false, reason: null });
});

test("explicit Supabase Auth fails closed without a completed database switch and server configuration", () => {
  configure();
  delete process.env.SUPABASE_DATABASE_ENABLED;
  assert.throws(requireSupabaseAuthConfiguration, /databasflytt/);
  process.env.SUPABASE_DATABASE_ENABLED = "true";
  process.env.DATABASE_URL = "postgresql://fixture:YOUR-PASSWORD@database.invalid/postgres";
  assert.equal(supabaseAuthConfigurationStatus().configured, false);
  assert.throws(requireSupabaseAuthConfiguration, /databasflytt/);
  configure();
  const result = requireSupabaseAuthConfiguration();
  assert.equal(result.url, "https://project-fixture.supabase.co");
  assert.ok(!JSON.stringify(result).includes(process.env.SUPABASE_SECRET_KEY!));
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_SECRET_KEY;
  assert.throws(requireSupabaseAuthConfiguration, /publishable/);
  configure();
  process.env.APP_URL = "https://slowlax.example.test/unsafe?redirect=https://evil.invalid";
  assert.throws(requireSupabaseAuthConfiguration, /APP_URL/);
});

test("standard Supabase URLs must identify the same project as the database host or pooler username", () => {
  configure();
  process.env.DATABASE_URL = "postgresql://postgres:fixture-password@db.different-project.supabase.co/postgres";
  assert.throws(requireSupabaseAuthConfiguration, /samma projekt/);
  process.env.DATABASE_URL = "postgresql://postgres.different-project:fixture-password@aws-0-eu-north-1.pooler.supabase.com:6543/postgres";
  assert.throws(requireSupabaseAuthConfiguration, /samma projekt/);
  process.env.DATABASE_URL = "postgresql://postgres.project-fixture:fixture-password@aws-0-eu-north-1.pooler.supabase.com:6543/postgres";
  assert.equal(requireSupabaseAuthConfiguration().url, "https://project-fixture.supabase.co");
});

test("metadata cannot confirm an email, create an administrator or access historical students", async () => {
  const user = await local();
  const unverified = provider(user.email, false);
  assert.equal(await synchronizeSupabaseUser(unverified), null);
  const original = await getDb().prepare("SELECT supabase_id,password_hash FROM users WHERE id=?").get(user.id);
  assert.equal(original!.supabase_id, null);
  assert.equal(original!.password_hash, "legacy-hash");
  const identity = provider();
  const created = await synchronizeSupabaseUser(identity);
  assert.equal(created!.role, "student");
  assert.equal(created!.emailVerifiedAt, identity.email_confirmed_at);
});

test("new signup enrolls Bas while its Kit invitation waits for verified Supabase identity", async () => {
  await saveKitNewsletterSettings(admin.id, { enabled: true, formId: "9288768", tagId: null, doubleOptInConfirmed: true });
  const identity = provider(undefined, false);
  const user = await synchronizeSupabaseUser(identity, { newRegistration: true });
  assert.ok(user);
  assert.equal(user.role, "student");
  assert.equal(user.emailVerifiedAt, null);
  assert.equal((await getStudentFreeMembership(user.id)).isMember, true);
  assert.equal((await getStudentFreeMembership(user.id)).verified, false);
  const joinedAt = (await getStudentFreeMembership(user.id)).joinedAt;
  assert.equal((await getDb().prepare("SELECT supabase_id FROM users WHERE id=?").get(user.id))!.supabase_id, identity.id);
  assert.equal((await getDb().prepare("SELECT status FROM kit_newsletter_outbox WHERE user_id=?").get(user.id))!.status, "waiting_verification");
  assert.equal(await synchronizeSupabaseUser(identity), null);
  const verified = await synchronizeSupabaseUser({ ...identity, email_confirmed_at: now() });
  assert.equal(verified!.id, user.id);
  assert.equal((await getStudentFreeMembership(user.id)).verified, true);
  assert.equal((await getStudentFreeMembership(user.id)).joinedAt, joinedAt);
  await synchronizeSupabaseUser({ ...identity, email_confirmed_at: now() });
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM kit_newsletter_outbox WHERE user_id=?").get(user.id))!.count, 1);
});

test("verified students retain integer relationships and invalidate their obsolete local credentials", async () => {
  const user = await local();
  const identity = provider(user.email);
  await getDb().prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run("fixture-old-session", user.id, "2099-01-01T00:00:00.000Z");
  await getDb().prepare("INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at,created_at) VALUES(?,?,'reset-password',?,?)").run("fixture-old-token", user.id, "2099-01-01T00:00:00.000Z", now());
  const linked = await synchronizeSupabaseUser(identity);
  assert.equal(linked!.id, user.id);
  assert.equal(linked!.name, "Existing name");
  assert.equal(linked!.role, "student");
  assert.equal((await getUserByEmail(user.email))!.passwordHash, "supabase-managed");
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=?").get(user.id))!.count, 0);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id=?").get(user.id))!.count, 0);
  assert.equal(await getDb().prepare("SELECT id FROM kit_newsletter_outbox WHERE user_id=?").get(user.id), undefined);
  assert.equal((await getStudentFreeMembership(user.id)).isMember, false);
  await synchronizeSupabaseUser(identity);
  assert.equal((await getStudentFreeMembership(user.id)).isMember, false);
});

test("trusted login after an interrupted signup creates a new app student and one durable Kit intent", async () => {
  await saveKitNewsletterSettings(admin.id, { enabled: true, formId: "9288768", tagId: null, doubleOptInConfirmed: true });
  const identity = provider();
  // Supabase already owns the confirmed identity, but the first app write was
  // interrupted. This is intentionally not the signup-specific call path.
  const recovered = await synchronizeSupabaseUser(identity);
  assert.ok(recovered);
  assert.equal((await getStudentFreeMembership(recovered.id)).isMember, true);
  assert.equal((await getStudentFreeMembership(recovered.id)).verified, true);
  assert.equal((await getDb().prepare("SELECT status FROM kit_newsletter_outbox WHERE user_id=?").get(recovered.id))!.status, "pending");
  await synchronizeSupabaseUser(identity);
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM kit_newsletter_outbox WHERE user_id=?").get(recovered.id))!.count, 1);
  const legacy = await local();
  await synchronizeSupabaseUser(provider(legacy.email));
  assert.equal(await getDb().prepare("SELECT id FROM kit_newsletter_outbox WHERE user_id=?").get(legacy.id), undefined);
  assert.equal((await getStudentFreeMembership(legacy.id)).isMember, false);
});

test("Supabase app-user creation rolls back Bas and identity binding when the local newsletter intent fails", async () => {
  await saveKitNewsletterSettings(admin.id, { enabled: true, formId: "9288768", tagId: null, doubleOptInConfirmed: true });
  const identity = provider();
  const before = (await getDb().prepare("SELECT COUNT(*) AS count FROM free_membership_members").get())!.count;
  await getDb().exec("CREATE TEMP TRIGGER fixture_reject_supabase_newsletter BEFORE INSERT ON kit_newsletter_outbox BEGIN SELECT RAISE(ABORT,'fixture rejects Supabase newsletter intent'); END");
  try {
    await assert.rejects(synchronizeSupabaseUser(identity), /fixture rejects Supabase newsletter intent/);
    assert.equal(await getUserByEmail(identity.email), undefined);
    assert.equal(await getDb().prepare("SELECT id FROM users WHERE supabase_id=?").get(identity.id), undefined);
    assert.equal((await getDb().prepare("SELECT COUNT(*) AS count FROM free_membership_members").get())!.count, before);
  } finally {
    await getDb().exec("DROP TRIGGER fixture_reject_supabase_newsletter");
  }
  // The already confirmed provider can recover on its next trusted login.
  const recovered = await synchronizeSupabaseUser(identity);
  assert.equal((await getStudentFreeMembership(recovered!.id)).isMember, true);
  assert.equal((await getDb().prepare("SELECT status FROM kit_newsletter_outbox WHERE user_id=?").get(recovered!.id))!.status, "pending");
});

test("legacy administrators require an exact operator-provided UUID and cannot be claimed by email alone", async () => {
  const user = await local("admin");
  const identity = provider(user.email);
  await assert.rejects(synchronizeSupabaseUser(identity), /Administratörskontot behöver kopplas/);
  process.env.SUPABASE_ADMIN_USER_ID = randomUUID();
  await assert.rejects(synchronizeSupabaseUser(identity), /Administratörskontot behöver kopplas/);
  process.env.SUPABASE_ADMIN_USER_ID = identity.id;
  assert.equal((await synchronizeSupabaseUser(identity))!.role, "admin");
  assert.equal((await getStudentFreeMembership(user.id)).isMember, false);
  delete process.env.SUPABASE_ADMIN_USER_ID;
  // After explicit binding the immutable provider ID identifies this admin.
  assert.equal((await synchronizeSupabaseUser({ ...identity, user_metadata: { role: "student" } }))!.id, user.id);
});

test("an existing provider binding cannot be replaced by another verified UUID", async () => {
  const identity = provider();
  const user = await synchronizeSupabaseUser(identity);
  await assert.rejects(synchronizeSupabaseUser({ ...identity, id: randomUUID() }), /annan identitet/);
  assert.equal((await getDb().prepare("SELECT supabase_id FROM users WHERE id=?").get(user!.id))!.supabase_id, identity.id);
});

test("verified email changes preserve role and deny collisions with another application account", async () => {
  const identity = provider();
  const user = await synchronizeSupabaseUser(identity);
  const other = await local();
  await assert.rejects(synchronizeSupabaseUser({ ...identity, email: other.email }), /annat elevkonto/);
  const changed = `changed-supabase-${++sequence}@example.test`;
  const updated = await synchronizeSupabaseUser({ ...identity, email: changed, user_metadata: { role: "admin" } });
  assert.equal(updated!.id, user!.id);
  assert.equal(updated!.email, changed);
  assert.equal(updated!.role, "student");
});

test("a forged bootstrap cannot create a second app administrator and rolls back cleanly", async () => {
  const identity = provider(undefined, false);
  await assert.rejects(synchronizeSupabaseUser(identity, { firstAdmin: true }), /administratörskonto finns redan/);
  assert.equal(await getUserByEmail(identity.email), undefined);
  assert.equal((await getUser(admin.id))!.role, "admin");
});
