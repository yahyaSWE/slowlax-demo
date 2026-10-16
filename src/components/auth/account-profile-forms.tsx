"use client";
import { useActionState } from "react";
import { changeAccountPasswordAction, updateAccountProfileAction } from "@/lib/account-actions";
import type { AccountActionState } from "@/lib/account-action-state";

function Result({ state }: { state: AccountActionState }) {
  return state.error || state.message ? <p className={`notice ${state.error ? "notice-error" : "notice-success"}`} role={state.error ? "alert" : "status"}>{state.error || state.message}</p> : null;
}

export function AccountProfileForms({ name }: { name: string }) {
  const [profile, saveProfile, savingProfile] = useActionState(updateAccountProfileAction, {});
  const [password, savePassword, savingPassword] = useActionState(changeAccountPasswordAction, {});
  return <div className="portal-account-grid">
    <section className="panel"><h2>Ändra namn</h2><form action={saveProfile} className="auth-form" aria-busy={savingProfile}>
      <label className="field">Ditt namn<input name="name" defaultValue={name} required minLength={2} maxLength={100} autoComplete="name" /></label>
      <Result state={profile} /><button className="button button-primary" disabled={savingProfile} type="submit">{savingProfile ? "Sparar…" : "Spara namn"}</button>
    </form></section>
    <section className="panel"><h2>Ändra lösenord</h2><form action={savePassword} className="auth-form" aria-busy={savingPassword}>
      <label className="field">Nuvarande lösenord<input type="password" name="currentPassword" required maxLength={128} autoComplete="current-password" /></label>
      <label className="field">Nytt lösenord<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      <p className="small muted">Använd minst 12 tecken. När lösenordet ändras behöver du logga in igen.</p>
      <Result state={password} /><button className="button button-primary" disabled={savingPassword} type="submit">{savingPassword ? "Ändrar…" : "Ändra lösenord"}</button>
    </form></section>
  </div>;
}
