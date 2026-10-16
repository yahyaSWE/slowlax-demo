"use client";
import { useActionState } from "react";
import { retryKitNewsletterAction, saveKitNewsletterSettingsAction } from "@/lib/kit-newsletter-actions";
import type { KitNewsletterFormState, KitNewsletterSettings } from "@/lib/kit-newsletter-types";
import { Field } from "./common";

const INITIAL_STATE: KitNewsletterFormState = {};

function Result({ state }: { state: KitNewsletterFormState }) {
  if (!state.error && !state.message) return null;
  return <p className={`notice ${state.error ? "notice-error" : "notice-success"}`} role={state.error ? "alert" : "status"}>{state.error || state.message}</p>;
}

export function KitNewsletterForm({ settings, keyConfigured }: { settings: KitNewsletterSettings; keyConfigured: boolean }) {
  const [state, action, pending] = useActionState(saveKitNewsletterSettingsAction, INITIAL_STATE);
  return <form action={action} className="stack" aria-busy={pending}>
    <Result state={state} />
    <label className="form-check"><input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!keyConfigured} /><span>Skicka automatiskt en nyhetsbrevsinbjudan till nya elever</span></label>
    <div className="form-grid">
      <Field name="kit-formId" label="Formulär-ID i Kit" help="Formuläret som skickar bekräftelsemejlet.">
        <input id="kit-formId" name="formId" inputMode="numeric" pattern="[1-9][0-9]{0,14}" required maxLength={15} defaultValue={settings.formId} />
      </Field>
      <Field name="kit-tagId" label="Tagg-ID (valfritt)" help="Taggen används för segmentering. Eventuella Kit-automationer på taggen kan starta.">
        <input id="kit-tagId" name="tagId" inputMode="numeric" pattern="[1-9][0-9]{0,14}" maxLength={15} defaultValue={settings.tagId ?? ""} />
      </Field>
    </div>
    <label className="form-check"><input type="checkbox" name="doubleOptInConfirmed" defaultChecked={settings.doubleOptInConfirmed} /><span>Jag har slagit på bekräftelsemejl och stängt av automatisk bekräftelse i detta Kit-formulär</span></label>
    <p className="muted">Eleven får inbjudan efter att elevkontots e-postadress har verifierats. Eleven behöver sedan bekräfta prenumerationen i Kit. Befintliga elever läggs inte till när du aktiverar anslutningen.</p>
    <div><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Sparar…" : "Spara inställningar"}</button></div>
  </form>;
}

export function KitNewsletterRetryButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(retryKitNewsletterAction, INITIAL_STATE);
  return <form action={action} aria-busy={pending} className="stack">
    <input type="hidden" name="jobId" value={jobId} />
    <button className="button button-secondary button-small" type="submit" disabled={pending}>{pending ? "Försöker…" : "Försök igen"}</button>
    <Result state={state} />
  </form>;
}
