"use client";
import { useActionState } from "react";
import { resendVerificationAction, requestPasswordResetAction, verifyEmailAction, resetPasswordAction } from "@/lib/account-actions";
import type { AccountActionState } from "@/lib/account-action-state";

export function AccountForm({ kind, token = "", disabled = false, returnTo = "" }: { kind: "resend" | "request-reset" | "verify" | "reset"; token?: string; disabled?: boolean; returnTo?: string }) {
  const action = { resend: resendVerificationAction, "request-reset": requestPasswordResetAction, verify: verifyEmailAction, reset: resetPasswordAction }[kind];
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(action, {});
  return <form action={formAction} className="auth-form">
    {token && <input type="hidden" name="token" value={token} />}
    <input type="hidden" name="returnTo" value={returnTo} />
    {kind === "request-reset" && <label className="field">E-postadress<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>}
    {(kind === "verify" || kind === "reset") && <label className="field">{kind === "reset" ? "Nytt lösenord" : "Ditt registrerade lösenord"}
      <input type="password" name="password" required minLength={kind === "reset" ? 12 : 1} maxLength={128} autoComplete={kind === "reset" ? "new-password" : "current-password"} />
      {kind === "reset" && <small>Använd minst 12 tecken och ett lösenord du inte använder någon annanstans.</small>}
    </label>}
    {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    {state.message && <p className="notice notice-success" role="status">{state.message}</p>}
    <button className="button button-primary full-width" disabled={pending || disabled} type="submit">{pending ? "Arbetar…" : { resend: "Begär nytt verifieringsmeddelande", "request-reset": "Begär återställningslänk", verify: "Verifiera e-postadressen", reset: "Spara nytt lösenord" }[kind]}</button>
  </form>;
}
