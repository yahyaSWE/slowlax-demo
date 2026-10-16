import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { assertSupabaseEmailConfirmation, consumeSupabaseAuthToken, pendingSupabaseSignupIdentity, reauthenticateSupabaseIdentity, supabaseEmailRedirect, verifiedSupabaseIdentity } from "../../src/lib/supabase-auth";
import { refreshSupabaseSession } from "../../src/lib/supabase-proxy";

// No real client credentials, accounts, emails or HTTP requests are used.
const originalFetch = globalThis.fetch;
const id = "7ff5c7a1-51b4-49e0-9c40-cd2b567e2f60";
const identity = { id, email: "provider-test@example.test", email_confirmed_at: "2026-10-15T12:00:00.000Z", is_anonymous: false, user_metadata: { name: "Fixture", role: "admin" } };
const otpSuccess = { user: identity, session: { access_token: "fixture-token-only", user: identity } };
let reads: string[] = [];
let settings: unknown = { external: { email: true }, mailer_autoconfirm: false };
let authCalls: string[] = [];
function client(options: { claims?: unknown; claimError?: unknown; user?: unknown; userError?: unknown } = {}) {
  return { auth: {
    getClaims: async () => { authCalls.push("claims"); return { data: { claims: options.claims ?? { sub: id, role: "authenticated" } }, error: options.claimError ?? null }; },
    getUser: async () => { authCalls.push("user"); return { data: { user: Object.hasOwn(options, "user") ? options.user : identity }, error: options.userError ?? null }; },
    getSession: async () => { throw new Error("getSession must not authorize app access"); },
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  process.env.SUPABASE_AUTH_ENABLED = "true";
  process.env.SUPABASE_DATABASE_ENABLED = "true";
  process.env.DATABASE_URL = "postgresql://fixture:fixture-password@db.project-fixture.supabase.co/postgres";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_public_key_only";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture_private_key_only";
  process.env.APP_URL = "https://slowlax.example.test";
  reads = []; authCalls = [];
  settings = { external: { email: true }, mailer_autoconfirm: false };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://project-fixture.supabase.co/auth/v1/settings");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("apikey"), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    assert.ok(!JSON.stringify(init).includes(process.env.SUPABASE_SECRET_KEY!));
    reads.push(String(input));
    return Response.json(settings);
  };
});
after(() => { globalThis.fetch = originalFetch; });

test("cryptographically verified claims precede a fresh provider user lookup", async () => {
  assert.deepEqual(await verifiedSupabaseIdentity(client()), identity);
  assert.deepEqual(authCalls, ["claims", "user"]);
  assert.equal(reads.length, 1);
});

test("invalid claims, anonymous roles and provider user failures do not authorize", async () => {
  assert.equal(await verifiedSupabaseIdentity(client({ claimError: new Error("invalid signature") })), null);
  assert.deepEqual(authCalls, ["claims"]);
  authCalls = [];
  assert.equal(await verifiedSupabaseIdentity(client({ claims: { sub: id, role: "anon" } })), null);
  assert.deepEqual(authCalls, ["claims"]);
  assert.equal(await verifiedSupabaseIdentity(client({ userError: new Error("invalid user") })), null);
  assert.equal(reads.length, 0);
});

test("claims cannot impersonate another user and metadata cannot assert verified email", async () => {
  for (const user of [null, { ...identity, id: "7ff5c7a1-51b4-49e0-9c40-cd2b567e2f61" },
    { ...identity, email_confirmed_at: null, user_metadata: { email_verified: true, role: "admin" } },
    { ...identity, is_anonymous: true }, { ...identity, email: "" }]) {
    assert.equal(await verifiedSupabaseIdentity(client({ user })), null);
  }
  assert.equal(reads.length, 0);
});

test("disabled email confirmation fails closed even when the provider user says confirmed", async () => {
  for (const bad of [{ external: { email: true }, mailer_autoconfirm: true },
    { external: { email: false }, mailer_autoconfirm: false }, {}, null]) {
    settings = bad;
    await assert.rejects(verifiedSupabaseIdentity(client()), /obligatorisk e-postbekräftelse/);
  }
});

test("provider settings network failures never produce a verified identity", async () => {
  globalThis.fetch = async () => { throw new Error("private provider detail must not be returned"); };
  await assert.rejects(assertSupabaseEmailConfirmation(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /kunde inte kontrolleras/);
    assert.doesNotMatch(error.message, /private provider/);
    return true;
  });
});

test("verification and recovery redirects use only APP_URL and allowlisted local destinations", () => {
  const safe = new URL(supabaseEmailRedirect("verify", "/kurser/testkurs"));
  assert.equal(safe.origin, "https://slowlax.example.test");
  assert.equal(safe.pathname, "/verifiera-epost");
  assert.equal(safe.searchParams.get("returnTo"), "/kurser/testkurs");
  const unsafe = new URL(supabaseEmailRedirect("reset", "//evil.invalid/steal"));
  assert.equal(unsafe.pathname, "/aterstall-losenord");
  assert.equal(unsafe.searchParams.get("returnTo"), "/elevportal");
});

test("SSR proxy does not cache session responses or authorize a session from absent cookies", async () => {
  const response = await refreshSupabaseSession(new NextRequest("https://slowlax.example.test/elevportal"));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(reads.length, 0);
});

test("confirmation uses email purpose, while recovery verifies before changing a password", async () => {
  const token = "f".repeat(64);
  for (const type of ["email", "recovery"] as const) {
    const provider = client();
    const events: string[] = [];
    provider.auth.verifyOtp = (async (params: unknown) => {
      events.push("otp");
      assert.deepEqual(params, { token_hash: token, type });
      return { data: otpSuccess, error: null };
    }) as never;
    provider.auth.updateUser = (async (params: unknown) => { events.push("password"); assert.deepEqual(params, { password: "new fixture password only" }); return { data: { user: identity }, error: null }; }) as never;
    const verified = await consumeSupabaseAuthToken(provider, { token, type, password: "new fixture password only" });
    assert.deepEqual(verified, identity);
    assert.deepEqual(events, type === "email" ? ["otp"] : ["otp", "password"]);
  }
});

test("weak passwords, malformed tokens and OTP replay cannot change provider credentials", async () => {
  const provider = client();
  let otpCalls = 0;
  let passwordCalls = 0;
  provider.auth.verifyOtp = (async () => { otpCalls++; return { data: { user: null }, error: new Error("expired or consumed") }; }) as never;
  provider.auth.updateUser = (async () => { passwordCalls++; return { data: { user: identity }, error: null }; }) as never;
  await assert.rejects(consumeSupabaseAuthToken(provider, { token: "f".repeat(64), type: "recovery", password: "short" }));
  await assert.rejects(consumeSupabaseAuthToken(provider, { token: "malformed", type: "email" }));
  assert.equal(otpCalls, 0);
  await assert.rejects(consumeSupabaseAuthToken(provider, { token: "f".repeat(64), type: "recovery", password: "new fixture password only" }), /har redan använts/);
  assert.equal(otpCalls, 1);
  assert.equal(passwordCalls, 0);
});

test("recovery clears a session when a verified provider identity or password update fails", async () => {
  for (const rejectIdentity of [true, false]) {
    const provider = client({ userError: rejectIdentity ? new Error("revoked user") : undefined });
    let signedOut = false;
    provider.auth.verifyOtp = (async () => ({ data: otpSuccess, error: null })) as never;
    provider.auth.updateUser = (async () => ({ data: { user: null }, error: new Error("provider rejected password") })) as never;
    provider.auth.signOut = (async (options: unknown) => { assert.deepEqual(options, { scope: "local" }); signedOut = true; return { error: null }; }) as never;
    await assert.rejects(consumeSupabaseAuthToken(provider, { token: "f".repeat(64), type: "recovery", password: "new fixture password only" }));
    assert.equal(signedOut, true);
  }
});

test("signup requires a matching positive email identity and ignores obfuscated or mismatched users", () => {
  const full = { ...identity, identities: [{ provider: "email", user_id: id }] } as never;
  assert.equal(pendingSupabaseSignupIdentity(full, identity.email), full);
  for (const invalid of [identity, { ...identity, identities: [] }, { ...identity, identities: [{ provider: "email", user_id: "someone-else" }] },
    { ...identity, email: "other@example.test", identities: [{ provider: "email", user_id: id }] }])
    assert.equal(pendingSupabaseSignupIdentity(invalid as never, identity.email), null);
});

test("OTP success cannot reuse an old cookie identity when its user or session is missing or different", async () => {
  for (const data of [{ user: identity, session: null }, { user: null, session: otpSuccess.session },
    { user: { ...identity, id: "different-user" }, session: { access_token: "fixture", user: { ...identity, id: "different-user" } } },
    { user: identity, session: { access_token: "fixture", user: { ...identity, id: "different-user" } } }]) {
    const provider = client();
    let writes = 0;
    provider.auth.verifyOtp = (async () => ({ data, error: null })) as never;
    provider.auth.updateUser = (async () => { writes++; return { data: { user: identity }, error: null }; }) as never;
    provider.auth.signOut = (async () => ({ error: null })) as never;
    await assert.rejects(consumeSupabaseAuthToken(provider, { token: "f".repeat(64), type: "recovery", password: "new fixture password only" }));
    assert.equal(writes, 0);
  }
});

test("password reauthentication remains bound to the original provider identity", async () => {
  for (const mismatch of [false, true]) {
    const provider = client();
    let cleared = false;
    provider.auth.signInWithPassword = (async () => ({ data: { user: { ...identity, id: mismatch ? "another-provider-user" : id } }, error: null })) as never;
    provider.auth.signOut = (async () => { cleared = true; return { error: null }; }) as never;
    const promise = reauthenticateSupabaseIdentity(provider, { id, email: identity.email, password: "current fixture password" });
    if (mismatch) { await assert.rejects(promise, /Kontot ändrades/); assert.equal(cleared, true); }
    else assert.equal((await promise).id, id);
  }
});
