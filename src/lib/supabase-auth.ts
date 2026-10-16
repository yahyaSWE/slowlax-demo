import "server-only";
import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import { z } from "zod";
import { DomainError, getDb, getUser, type User } from "./db";
import { passwordSchema, signupSchema } from "./validation";
import { safeAccountReturnTo } from "./account-return";
import { createSupabaseServerClient } from "./supabase-server";
import { requireSupabaseAuthConfiguration } from "./supabase-auth-config";
import { synchronizeSupabaseUser } from "./supabase-auth-domain";

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "Länken är ogiltig eller har löpt ut.");

export function supabaseEmailRedirect(kind: "verify" | "reset", returnTo?: string) {
  const config = requireSupabaseAuthConfiguration();
  const target = new URL(kind === "verify" ? "/verifiera-epost" : "/aterstall-losenord", config.origin);
  target.searchParams.set("returnTo", safeAccountReturnTo(returnTo, "/elevportal"));
  return target.href;
}

export async function assertSupabaseEmailConfirmation() {
  const config = requireSupabaseAuthConfiguration();
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
  } catch { throw new DomainError("Supabase-inloggningen kunde inte kontrolleras. Försök igen senare."); }
  const body = await response.json().catch(() => null) as { external?: { email?: boolean }; mailer_autoconfirm?: boolean } | null;
  if (!response.ok || body?.external?.email !== true || body.mailer_autoconfirm !== false)
    throw new DomainError("Supabase behöver e-postinloggning med obligatorisk e-postbekräftelse. Kontakta den som ansvarar för driften.");
}

export async function verifiedSupabaseIdentity(client: SupabaseClient) {
  // Never authorize from getSession(): it merely reads a client-controlled
  // cookie. Claims verification plus a current server user protects the bridge.
  const claims = await client.auth.getClaims();
  if (claims.error || !claims.data?.claims?.sub || claims.data.claims.role !== "authenticated") return null;
  const current = await client.auth.getUser();
  if (current.error || !current.data.user || current.data.user.id !== claims.data.claims.sub ||
      current.data.user.is_anonymous || !current.data.user.email_confirmed_at || !current.data.user.email) return null;
  await assertSupabaseEmailConfirmation();
  return current.data.user;
}

export async function authenticatedSupabaseUser(client: SupabaseClient): Promise<User | null> {
  const identity = await verifiedSupabaseIdentity(client);
  return identity ? synchronizeSupabaseUser(identity) : null;
}

export async function currentSupabaseUser() {
  return authenticatedSupabaseUser(await createSupabaseServerClient());
}

export async function loginSupabaseUser(email: string, password: string) {
  await assertSupabaseEmailConfirmation();
  const client = await createSupabaseServerClient(true);
  const response = await client.auth.signInWithPassword({ email, password });
  if (response.error) throw new DomainError("E-postadress eller lösenord är fel, eller adressen behöver verifieras.");
  try {
    const user = await authenticatedSupabaseUser(client);
    if (!user) throw new DomainError("Kontot behöver verifieras innan du kan logga in.");
    return user;
  } catch (error) {
    await client.auth.signOut({ scope: "local" });
    throw error;
  }
}

export function pendingSupabaseSignupIdentity(provider: SupabaseUser | null, email: string): SupabaseUser | null {
  if (!provider || provider.email?.toLowerCase() !== email.toLowerCase() || !Array.isArray(provider.identities) ||
      !provider.identities.some((identity) => identity.provider === "email" && identity.user_id === provider.id)) return null;
  return provider;
}

export async function registerSupabaseUser(input: unknown, returnTo?: string, firstAdmin = false): Promise<User | null> {
  const value = signupSchema.parse(input);
  await assertSupabaseEmailConfirmation();
  const client = await createSupabaseServerClient(true);
  const response = await client.auth.signUp({ email: value.email, password: value.password,
    options: { data: { name: value.name }, emailRedirectTo: supabaseEmailRedirect("verify", returnTo) } });
  if (response.error) throw new DomainError("Registreringen kunde inte slutföras. Försök igen eller använd Glömt lösenord om du redan har ett konto.");
  if (response.data.session) {
    await client.auth.signOut({ scope: "local" });
    throw new DomainError("E-postbekräftelse behöver vara obligatorisk i Supabase innan registrering kan användas.");
  }
  const provider = pendingSupabaseSignupIdentity(response.data.user, value.email);
  // With confirmation enabled, duplicate confirmed addresses may produce an
  // obfuscated user. Such responses must not create app accounts or Kit jobs.
  if (!provider) return null;
  if (provider.email_confirmed_at) {
    await client.auth.signOut({ scope: "local" });
    throw new DomainError("E-postbekräftelse behöver vara obligatorisk i Supabase innan registrering kan användas.");
  }
  return synchronizeSupabaseUser(provider, { newRegistration: !firstAdmin, firstAdmin });
}

export async function resendSupabaseVerification(email: string, returnTo?: string) {
  await assertSupabaseEmailConfirmation();
  const client = await createSupabaseServerClient(true);
  // Return the same user-facing result for unknown, verified and pending mail.
  await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: supabaseEmailRedirect("verify", returnTo) } });
}

export async function requestSupabasePasswordReset(email: string, returnTo?: string) {
  await assertSupabaseEmailConfirmation();
  const client = await createSupabaseServerClient(true);
  await client.auth.resetPasswordForEmail(email, { redirectTo: supabaseEmailRedirect("reset", returnTo) });
}

export async function consumeSupabaseAuthToken(client: SupabaseClient, input: { token: string; type: "email" | "recovery"; password?: string }) {
  const token = tokenSchema.parse(input.token);
  const type = z.enum(["email", "recovery"]).parse(input.type);
  // Reject weak passwords before consuming a one-time recovery token.
  const password = type === "recovery" ? passwordSchema.parse(input.password) : undefined;
  await assertSupabaseEmailConfirmation();
  const result = await client.auth.verifyOtp({ token_hash: token, type });
  if (result.error) throw new DomainError(type === "email" ? "Verifieringslänken är ogiltig, har redan använts eller har löpt ut." : "Återställningslänken är ogiltig, har redan använts eller har löpt ut.");
  try {
    const tokenUser = result.data.user;
    const tokenSession = result.data.session;
    if (!tokenUser?.id || !tokenSession?.access_token || tokenSession.user?.id !== tokenUser.id)
      throw new DomainError("Länkens session kunde inte verifieras. Begär en ny länk.");
    const identity = await verifiedSupabaseIdentity(client);
    if (!identity || identity.id !== tokenUser.id) throw new DomainError("Kontots identitet kunde inte verifieras.");
    if (password) {
      const updated = await client.auth.updateUser({ password });
      if (updated.error) throw new DomainError("Lösenordet kunde inte ändras. Begär en ny länk och försök igen.");
    }
    return identity;
  } catch (error) { await client.auth.signOut({ scope: "local" }); throw error; }
}

export async function verifySupabaseEmail(token: string): Promise<User> {
  const client = await createSupabaseServerClient(true);
  const identity = await consumeSupabaseAuthToken(client, { token, type: "email" });
  try {
    const user = await synchronizeSupabaseUser(identity);
    if (!user) throw new DomainError("E-postadressen kunde inte verifieras.");
    return user;
  } catch (error) { await client.auth.signOut({ scope: "local" }); throw error; }
}

export async function resetSupabasePassword(input: { token: string; password: string }): Promise<number> {
  const client = await createSupabaseServerClient(true);
  const identity = await consumeSupabaseAuthToken(client, { ...input, type: "recovery" });
  try {
    const user = await synchronizeSupabaseUser(identity);
    if (!user) throw new DomainError("Återställningen kunde inte verifieras.");
    await getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=?").run(user.id);
    const logout = await client.auth.signOut({ scope: "global" });
    if (logout.error) throw new DomainError("Lösenordet har ändrats men tidigare sessioner kunde inte avslutas. Försök logga ut igen.");
    return user.id;
  } catch (error) { await client.auth.signOut({ scope: "local" }); throw error; }
}

export async function logoutSupabaseUser() {
  const client = await createSupabaseServerClient(true);
  const result = await client.auth.signOut({ scope: "local" });
  if (result.error) throw new DomainError("Utloggningen kunde inte slutföras. Försök igen.");
}

export async function updateSupabaseProfile(userId: number, name: string) {
  const client = await createSupabaseServerClient(true);
  const user = await authenticatedSupabaseUser(client);
  if (!user || user.id !== userId) throw new DomainError("Logga in igen för att ändra ditt konto.");
  const result = await client.auth.updateUser({ data: { name } });
  if (result.error) throw new DomainError("Namnet kunde inte uppdateras. Försök igen.");
  await getDb().prepare("UPDATE users SET name=? WHERE id=?").run(name, user.id);
}

export async function reauthenticateSupabaseIdentity(client: SupabaseClient, input: { id: string; email: string; password: string }) {
  const reauth = await client.auth.signInWithPassword({ email: input.email, password: input.password });
  if (reauth.error) throw new DomainError("Ditt nuvarande lösenord är fel.");
  try {
    if (reauth.data.user?.id !== input.id) throw new DomainError("Kontot ändrades under inloggningen. Logga in igen.");
    const current = await verifiedSupabaseIdentity(client);
    if (!current || current.id !== input.id) throw new DomainError("Kontot ändrades under inloggningen. Logga in igen.");
    return current;
  } catch (error) { await client.auth.signOut({ scope: "local" }); throw error; }
}

export async function changeSupabasePassword(userId: number, currentPassword: string, password: string) {
  const user = await getUser(userId);
  if (!user) throw new DomainError("Logga in igen för att ändra lösenord.");
  const client = await createSupabaseServerClient(true);
  const provider = await verifiedSupabaseIdentity(client);
  const identity = provider ? await synchronizeSupabaseUser(provider) : null;
  if (!identity || identity.id !== userId) throw new DomainError("Logga in igen för att ändra lösenord.");
  await reauthenticateSupabaseIdentity(client, { id: provider!.id, email: identity.email, password: currentPassword });
  const updated = await client.auth.updateUser({ password: passwordSchema.parse(password) });
  if (updated.error) throw new DomainError("Lösenordet kunde inte ändras. Försök igen.");
  const logout = await client.auth.signOut({ scope: "global" });
  if (logout.error) throw new DomainError("Lösenordet ändrades. Försök logga ut igen för att avsluta tidigare sessioner.");
}
