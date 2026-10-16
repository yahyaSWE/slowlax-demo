"use client";
import { useActionState, useState } from "react";
import { Award } from "lucide-react";
import { saveCourseCertificateSettingsAction } from "@/lib/course-certificate-actions";
import { withCourseCertificateFormErrors } from "@/lib/course-certificate-form-errors";
import type { CourseCertificateFormState } from "@/lib/course-certificate-form-state";
import type { CourseCertificateSettings } from "@/lib/course-certificates";
import { SectionHeading } from "./common";

const INITIAL_STATE: CourseCertificateFormState = {};

export function CourseCertificateForm({ settings }: { settings: CourseCertificateSettings }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [state, action, pending] = useActionState(withCourseCertificateFormErrors(saveCourseCertificateSettingsAction), INITIAL_STATE);
  const version = state.settings?.updatedAt ?? settings.updatedAt;
  const dirty = enabled !== (state.settings?.enabled ?? settings.enabled);
  return <section className="panel form-panel stack" aria-labelledby="course-certificate-settings-title">
    <SectionHeading title="Diplom efter genomförd kurs" description="Valfritt för varje kurs. Nya kurser har diplom avstängt." />
    <form action={action} className="stack" aria-busy={pending}>
      <input type="hidden" name="courseId" value={settings.courseId} />
      <input type="hidden" name="expectedUpdatedAt" value={version ?? ""} />
      <fieldset className="stack content-form-fields" disabled={pending}>
        <legend className="sr-only" id="course-certificate-settings-title">Kursens diplom</legend>
        <label className="form-check"><input type="checkbox" name="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Erbjud ett nedladdningsbart diplom för den här kursen</span></label>
        <p className="muted">Eleven behöver ha verifierat sitt konto, ha tillgång till kursen, markera samtliga lektioner som genomförda och få godkänt på alla aktiva quiz och skrivuppgifter i deras aktuella versioner.</p>
        <p className="small muted">Diplomet sparar elevens namn, kursens titel och datum när det utfärdas. Redan utfärdade diplom finns kvar om du stänger av funktionen eller elevens kursåtkomst upphör.</p>
      </fieldset>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {state.message && !state.error && !dirty && <p className="notice notice-success" role="status">{state.message}</p>}
      <div><button type="submit" className="button button-primary" disabled={pending}><Award size={17} aria-hidden="true" />{pending ? "Sparar…" : "Spara diplominställning"}</button></div>
    </form>
  </section>;
}
