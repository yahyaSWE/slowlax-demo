"use client";

import type { CourseSalesSettings } from "@/lib/course-sales";
import type { MembershipGroup } from "@/lib/membership-types";
import { saveCourseSalesAction, type CourseSalesFields } from "@/lib/course-sales-actions";
import { useContentForm } from "@/lib/use-content-form";
import { Field } from "./common";
import { SubmitButton } from "./submit-button";

export function CourseSalesForm({ settings, groups, stripeReady }: {
  settings: CourseSalesSettings;
  groups: MembershipGroup[];
  stripeReady: boolean;
}) {
  const form = useContentForm<CourseSalesFields>(saveCourseSalesAction, {
    enabled: settings.enabled,
    groupId: settings.groupId === null ? "" : String(settings.groupId),
    groupAccessDays: settings.groupAccessDays === null ? "" : String(settings.groupAccessDays),
    vatPercent: String(settings.vatPercent),
    terms: settings.terms,
    expectedUpdatedAt: settings.updatedAt ?? "",
  }, `course-sales-${settings.courseId}`, true);
  const change = (key: keyof CourseSalesFields, value: string | boolean) => form.setValues(current => ({ ...current, [key]: value }));
  return (
    <form action={form.action} onSubmit={form.onSubmit} aria-busy={form.pending} className="stack">
      <input type="hidden" name="courseId" value={settings.courseId} />
      <input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt} />
      {form.error && <div className="notice notice-error" role="alert" tabIndex={-1} ref={form.errorRef}>{form.error}</div>}
      <p className="muted">
        Eleven köper kursen med en engångsbetalning och får kursåtkomst utan tidsgräns.
        Du kan dessutom ge tillgång till en grupp med extra material och kurser.
      </p>
      {!stripeReady && <p className="notice">Stripe-anslutningen behöver konfigureras innan kunder kan betala. Du kan förbereda inställningarna här.</p>}
      <fieldset className="stack content-form-fields" disabled={form.pending}>
        <legend className="sr-only">Försäljning och grupp efter köp</legend>
        <Field label="Grupp efter köp" name="course-sales-group" help="Valfritt. Eleven läggs automatiskt i den valda gruppen efter bekräftad betalning.">
          <select id="course-sales-group" name="groupId" value={form.values.groupId} onChange={event => change("groupId", event.target.value)}>
            <option value="">Ingen grupp – endast kursen</option>
            {groups.map(group => <option value={group.id} key={group.id}>{group.name}{group.published ? "" : " (utkast)"}</option>)}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Gruppåtkomst i dagar (valfritt)" name="course-sales-days" help="Tomt ger obegränsad gruppåtkomst. Antalet dagar räknas från betalningen; den köpta kursåtkomsten påverkas inte.">
            <input id="course-sales-days" name="groupAccessDays" type="number" min={1} max={3650} step={1} disabled={!form.values.groupId} value={form.values.groupAccessDays} onChange={event => change("groupAccessDays", event.target.value)} />
          </Field>
          <Field label="Moms på kursköpet (%)" name="course-sales-vat" help="Priset i kursens grunduppgifter är inklusive den momssats du väljer.">
            <select id="course-sales-vat" name="vatPercent" value={form.values.vatPercent} onChange={event => change("vatPercent", event.target.value)}>
              {[25, 12, 6, 0].map(vat => <option value={vat} key={vat}>{vat} %</option>)}
            </select>
          </Field>
        </div>
        <Field label="Köpvillkor för kursen" name="course-sales-terms" help="Beskriv vad som ingår, kurs- och gruppåtkomst, kontaktväg, ångerrätt och återbetalning. Villkoren visas före betalningen och sparas med köpet.">
          <textarea id="course-sales-terms" name="terms" maxLength={20000} rows={7} value={form.values.terms} onChange={event => change("terms", event.target.value)} />
        </Field>
        <label className="form-check">
          <input type="checkbox" name="enabled" checked={form.values.enabled} onChange={event => change("enabled", event.target.checked)} />
          <span>Aktivera köp av kursen via Stripe</span>
        </label>
        <p className="small muted">Kursen behöver ett pris och vara publicerad. En grupp som ingår behöver också vara publicerad. Ange verksamhetens kontakt-e-post under Admin → Inställningar. Ändringar gäller nya köp; tidigare köp behåller sina avtalade uppgifter.</p>
      </fieldset>
      <div><SubmitButton>Spara köpinställningar</SubmitButton></div>
    </form>
  );
}
