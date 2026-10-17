import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, getSessionUser, transaction, type User } from "./db";
import { randomToken, tokenHash } from "./security";
import { cache } from "react";
import { requireSupabaseAuthConfiguration, supabaseAuthRequested } from "./supabase-auth-config";
import { DEMO_MODE } from "./demo-mode";
const COOKIE = "tibb_session";
// Share this lookup within one server render, never between visitors or requests.
// Read the cookie each time so login/logout use the new session immediately.
const sessionUserForRender = cache(getSessionUser);
const supabaseUserForRender = cache(async () => {
  const { currentSupabaseUser } = await import("./supabase-auth");
  return currentSupabaseUser();
});
export async function getCurrentUser(): Promise<User | null> {
  if (DEMO_MODE) return null;
  if (supabaseAuthRequested()) {
    requireSupabaseAuthConfiguration();
    return supabaseUserForRender();
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (await sessionUserForRender(tokenHash(token))) ?? null;
}
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin")
    redirect(
      "/elevportal?error=" +
        encodeURIComponent("Du har inte tillgång till administrationen."),
    );
  return user;
}
export async function createSession(userId: number) {
  if (supabaseAuthRequested()) throw new Error("Supabase sessions must be issued by Supabase Auth.");
  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 86400000);
  const jar = await cookies();
  const old = jar.get(COOKIE)?.value;
  await transaction(async () => {
    if (old)
      await getDb()
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(tokenHash(old));
    await getDb()
      .prepare("DELETE FROM sessions WHERE expires_at<=?")
      .run(new Date().toISOString());
    await getDb()
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      )
      .run(tokenHash(token), userId, expires.toISOString());
  });
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function destroySession() {
  if (supabaseAuthRequested()) {
    const { logoutSupabaseUser } = await import("./supabase-auth");
    await logoutSupabaseUser();
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token)
    await getDb()
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(tokenHash(token));
  jar.delete(COOKIE);
}
