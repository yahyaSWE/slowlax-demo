"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { createSession, destroySession, getCurrentUser, requireAdmin } from "./auth";
import { DomainError, transaction } from "./db";
import { sendVerificationEmail, requestPasswordReset, resetPassword, verifyEmail, RESET_REQUEST_MESSAGE } from "./account-email";
import { EmailConfigurationError, EmailDeliveryError, requireEmailConfiguration } from "./email-provider";
import { enforceRequestLimit } from "./request-rate-limit";
import { field, idField } from "./validation";
import { dispatchBookingEmailOutbox, queueBookingEmails } from "./email-outbox";
import { revalidatePath } from "next/cache";
import type { AccountActionState } from "./account-action-state";
import { accountAuthHref, accountReturnWithMessage, safeAccountReturnTo } from "./account-return";
import { resolveAccountReturnTo } from "./account-return-destination";

function failure(error: unknown): AccountActionState {
  if (error instanceof DomainError || error instanceof EmailConfigurationError || error instanceof EmailDeliveryError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "Kontrollera uppgifterna." };
  return { error: "Åtgärden kunde inte slutföras. Försök igen om en stund." };
}
export async function resendVerificationAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
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
    requireEmailConfiguration();
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
    user = await transaction(async () => {
      const verified = await verifyEmail({ token, password: field(form, "password") });
      await createSession(verified.id);
      return verified;
    });
  } catch (error) { return failure(error); }
  const destination = await resolveAccountReturnTo(field(form, "returnTo"), user.role === "admin" ? "/admin" : "/elevportal");
  redirect(accountReturnWithMessage(destination, "Din e-postadress är verifierad. Du kan nu köpa kursen eller använda kurser och grupper som du fått tillgång till."));
}
export async function resetPasswordAction(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const token = z.string().regex(/^[a-f0-9]{64}$/).parse(field(form, "token"));
    await enforceRequestLimit("consume-reset", token, 5, await headers());
    await resetPassword({ token, password: field(form, "password") });
    await destroySession();
  } catch (error) { return failure(error); }
  const login = accountAuthHref("/logga-in", field(form, "returnTo"));
  redirect(login + (login.includes("?") ? "&" : "?") + "message=" + encodeURIComponent("Lösenordet är ändrat och tidigare sessioner är avslutade. Logga in med ditt nya lösenord."));
}
export async function retryBookingEmailsAction(form: FormData): Promise<void> {
  await requireAdmin();
  const bookingId = idField(form, "bookingId");
  await queueBookingEmails(bookingId);
  const result = await dispatchBookingEmailOutbox({ bookingId, limit: 2 });
  revalidatePath(`/admin/bokningar/${bookingId}`);
  redirect(`/admin/bokningar/${bookingId}?${result.configured ? "success" : "error"}=` + encodeURIComponent(
    !result.configured ? "E-post är inte ansluten. Bokningen finns kvar; inga meddelanden har skickats." :
      result.sent ? "E-posttjänsten har accepterat utskicket. Leverans kontrolleras i Resend." : "Inga nya meddelanden accepterades. Kontrollera utskicksstatus och Resend innan du försöker igen.",
  ));
}
