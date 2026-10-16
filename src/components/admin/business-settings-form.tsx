"use client";
import { useActionState, useState } from "react";
import { saveBusinessSettingsForm } from "@/lib/business-actions";
import { withBusinessFormErrors } from "@/lib/business-form-errors";
import {
  INITIAL_BUSINESS_FORM_STATE,
  type BusinessFormState,
} from "@/lib/business-form-state";
import {
  missingPrivacyInformation,
  type BusinessSettings,
} from "@/lib/business-config";
import { Field, SectionHeading } from "./common";

const privacyFields = [
  [
    "legalBasis",
    "Ändamål och rättslig grund",
    "Ange er bedömning för elevkonton, kursuppgifter, säkerhet, medlemskap och betalningar.",
  ],
  [
    "studentRetention",
    "Hur länge sparas elevuppgifter?",
    "Beskriv konto, framsteg, quizsvar, utkast, inlämningar och återkoppling. Ta hänsyn till kursåtkomst utan tidsgräns.",
  ],
  [
    "internationalTransfers",
    "Leverantörer och överföringar",
    "Kontrollera era avtal och dataplacering hos Vercel, Turso, Resend och eventuell Stripe. Ange om och med vilket skydd uppgifter överförs utanför EU/EES.",
  ],
  [
    "additionalPrivacy",
    "Övrig integritetsinformation",
    "Valfri komplettering, till exempel kontakt för dataskydd eller en särskild rutin för begäran om rättigheter.",
  ],
] as const;

export function BusinessSettingsForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [values, setValues] = useState(settings);
  const [state, action, pending] = useActionState(
    withBusinessFormErrors(saveBusinessSettingsForm),
    INITIAL_BUSINESS_FORM_STATE,
  );
  const [dismissedResult, setDismissedResult] =
    useState<BusinessFormState | null>(null);
  const missing = missingPrivacyInformation(values);
  const text = (
    key: keyof BusinessSettings,
    label: string,
    help?: string,
    rows = 4,
  ) => (
    <Field key={key} name={`business-${key}`} label={label} help={help}>
      <textarea
        id={`business-${key}`}
        name={key}
        rows={rows}
        maxLength={
          key === "additionalPrivacy"
            ? 5000
            : key === "legalBasis"
              ? 4000
              : key === "cancellationDetails" ||
                  key === "internationalTransfers"
                ? 3000
                : 2000
        }
        value={String(values[key])}
        onChange={(event) =>
          setValues((current) => ({ ...current, [key]: event.target.value }))
        }
      />
    </Field>
  );
  return (
    <form
      action={action}
      className="panel form-panel stack"
      aria-busy={pending}
      onChange={() => setDismissedResult(state)}
      onSubmit={() => setDismissedResult(state)}
    >
      <fieldset
        disabled={pending}
        className="stack content-form-fields"
        aria-label="Verksamhetsuppgifter och villkor"
      >
        <SectionHeading
          title="Verksamhetsuppgifter och villkor"
          description="Uppgifterna visas på kontakt-, villkors- och integritetssidan."
        />
        <div className="form-grid">
          <Field label="Juridiskt namn" name="business-legalName">
            <input
              id="business-legalName"
              name="legalName"
              required
              maxLength={150}
              value={values.legalName}
              onChange={(e) =>
                setValues({ ...values, legalName: e.target.value })
              }
            />
          </Field>
          <Field label="Organisationsnummer" name="business-organizationNumber">
            <input
              id="business-organizationNumber"
              name="organizationNumber"
              required
              maxLength={30}
              pattern="[0-9]{6}-[0-9]{4}"
              value={values.organizationNumber}
              onChange={(e) =>
                setValues({ ...values, organizationNumber: e.target.value })
              }
            />
          </Field>
        </div>
        {text(
          "courseAccessDescription",
          "Kursåtkomst",
          "Du har angett tillgång utan tidsgräns. Ändringar av befintliga elevers avtalsvillkor måste hanteras enligt deras avtal.",
        )}
        <SectionHeading
          title="Integritetsinformation"
          description="Fyll i verksamhetens beslut och faktiska rutiner före kundlansering. De här fälten ändrar informationstexten; de inför inte automatisk datarensning."
        />
        {missing.length > 0 && (
          <p className="notice" role="status">
            Behöver kompletteras före lansering: {missing.join(", ")}.
          </p>
        )}
        {privacyFields.map(([key, label, help]) => text(key, label, help))}
      </fieldset>
      {pending && (
        <p className="notice" role="status">
          Sparar uppgifterna. Vänta tills sparningen är klar innan du ändrar
          dem.
        </p>
      )}
      {!pending && state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {!pending && state.success && dismissedResult !== state && (
        <p className="notice notice-success" role="status">
          {state.success}
        </p>
      )}
      <div>
        <button
          className="button button-primary"
          type="submit"
          disabled={pending}
        >
          {pending ? "Sparar…" : "Spara verksamhetsuppgifter och villkor"}
        </button>
      </div>
    </form>
  );
}
