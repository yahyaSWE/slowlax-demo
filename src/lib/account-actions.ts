"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { createSession, destroySession, getCurrentUser } from "./auth";
import { DomainError, getDb, getUserByEmail, transaction } from "./db";
import { sendVerificationEmail, requestPasswordReset, resetPassword, verifyEmail, RESET_REQUEST_MESSAGE } from "./account-email";
import { EmailConfigurationError, EmailDeliveryError, requireEmailConfiguration } from "./email-provider";
import { enforceRequestLimit } from "./request-rate-limit";
import { field, passwordSchema, text } from "./validation";
import type { AccountActionState } from "./account-action-state";
import { accountAuthHref, accountReturnWithMessage, safeAccountReturnTo } from "./account-return";
import { resolveAccountReturnTo } from "./account-return-destination";
import { dispatchKitNewsletterOutbox } from "./kit-newsletter";
import { requireSupabaseAuthConfiguration, SupabaseAuthConfigurationError, supabaseAuthRequested } from "./supabase-auth-config";
import { hashPassword, verifyPassword } from "./security";
import { revalidatePath } from "next/cache";

function dispatchNewsletterAfterVerification(userId: number) {
  after(async () => {
    try {
      await dispatchKitNewsletterOutbox({ userId });
    } catch { /* The durable outbox is retried by the worker or administrator. */ }
  });
}

function failure(error: unknown): AccountActionState {
  if (error instanceof DomainError || error instanceof EmailConfigurationError || error instanceof EmailDeliveryError || error instanceof SupabaseAuthConfigurationError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "Kontrollera uppgifterna." };
  return { error: "Åtgärden kunde inte slutföras. Försök igen om en stund." };
}
export async function resendVerificationAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  if (supabaseAuthRequested()) {
    try {
      requireSupabaseAuthConfiguration();
      const email = z.email().max(254).parse(field(form, "email").trim().toLowerCase());
      await enforceRequestLimit("verify-email", email, 3, await headers());
      const returnTo = safeAccountReturnTo(field(form, "returnTo"), "");
      after(async () => { try { const { resendSupabaseVerification } = await import("./supabase-auth"); await resendSupabaseVerification(email, returnTo); } catch { /* Generic response prevents account enumeration. */ } });
      return { message: "Om adressen väntar på bekräftelse kan du få en ny länk. Kontrollera inkorg och skräppost. Detta bekräftar inte att ett konto finns eller att ett mejl har levererats." };
    } catch (error) { return failure(error); }
  }
  const user = await getCurrentUser();
  if (!user) redirect(accountAuthHref("/logga-in", field(form, "returnTo")));
  try {
    await enforceRequestLimit("verify-email", String(user.id), 3, await headers());
    await sendVerificationEmail(user.id, safeAccountReturnTo(field(form, "returnTo"), ""));
    return { message: user.emailVerifiedAt ? "Din adress är redan verifierad." : "E-posttjänsten har accepterat verifieringsmeddelandet. Kontrollera inkorg och skräppost." };
  } catch (error) { return failure(error); }
}
export async function requestPasswordResetAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const email = z.email().max(254).parse(field(form, "email").trim().toLowerCase());
    await enforceRequestLimit("request-reset", email, 5, await headers());
    if (supabaseAuthRequested()) requireSupabaseAuthConfiguration();
    else requireEmailConfiguration();
    // Both existing and unknown addresses receive the same response before
    // account lookup/provider latency can disclose whether an account exists.
    const returnTo = safeAccountReturnTo(field(form, "returnTo"), "");
    after(async () => { try { await requestPasswordReset(email, returnTo); } catch { /* Generic response; no credentials or delivery details are logged. */ } });
    return { message: RESET_REQUEST_MESSAGE };
  } catch (error) { return failure(error); }
}
export async function verifyEmailAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  let user;
  try {
    const token = z.string().regex(/^[a-f0-9]{64}$/).parse(field(form, "token"));
    await enforceRequestLimit("consume-verification", token, 5, await headers());
    user = supabaseAuthRequested() ? await verifyEmail({ token, password: "" }) : await transaction(async () => {
      const verified = await verifyEmail({ token, password: field(form, "password") });
      await createSession(verified.id);
      return verified;
    });
  } catch (error) { return failure(error); }
  dispatchNewsletterAfterVerification(user.id);
  const destination = await resolveAccountReturnTo(field(form, "returnTo"), user.role === "admin" ? "/admin" : "/elevportal");
  redirect(accountReturnWithMessage(destination, "Din e-postadress är verifierad. Du kan nu köpa kursen eller använda kurser och grupper som du fått tillgång till."));
}
export async function resetPasswordAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  let verifiedUserId: number;
  try {
    const token = z.string().regex(/^[a-f0-9]{64}$/).parse(field(form, "token"));
    await enforceRequestLimit("consume-reset", token, 5, await headers());
    verifiedUserId = await resetPassword({ token, password: field(form, "password") });
    if (!supabaseAuthRequested()) await destroySession();
  } catch (error) { return failure(error); }
  dispatchNewsletterAfterVerification(verifiedUserId);
  const login = accountAuthHref("/logga-in", field(form, "returnTo"));
  redirect(login + (login.includes("?") ? "&" : "?") + "message=" + encodeURIComponent("Lösenordet är ändrat och tidigare sessioner är avslutade. Logga in med ditt nya lösenord."));
}

export async function updateAccountProfileAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");
  try {
    const name = text(100, 2).parse(field(form, "name"));
    if (supabaseAuthRequested()) {
      const { updateSupabaseProfile } = await import("./supabase-auth");
      await updateSupabaseProfile(user.id, name);
    } else await getDb().prepare("UPDATE users SET name=? WHERE id=?").run(name, user.id);
    revalidatePath("/elevportal/konto");
    return { message: "Ditt namn har sparats." };
  } catch (error) { return failure(error); }
}

export async function changeAccountPasswordAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");
  try {
    const password = passwordSchema.parse(field(form, "password"));
    const currentPassword = z.string().min(1).max(128).parse(field(form, "currentPassword"));
    await enforceRequestLimit("change-password", String(user.id), 5, await headers());
    if (supabaseAuthRequested()) {
      const { changeSupabasePassword } = await import("./supabase-auth");
      await changeSupabasePassword(user.id, currentPassword, password);
    } else {
      const encoded = hashPassword(password);
      await transaction(async () => {
        const current = await getUserByEmail(user.email);
        if (!current || !verifyPassword(currentPassword, current.passwordHash)) throw new DomainError("Ditt nuvarande lösenord är fel.");
        await getDb().prepare("UPDATE users SET password_hash=? WHERE id=?").run(encoded, user.id);
        await getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=?").run(user.id);
      });
      await destroySession();
    }
  } catch (error) { return failure(error); }
  redirect("/logga-in?message=" + encodeURIComponent("Lösenordet har ändrats. Logga in med ditt nya lösenord."));
}
