"use client";

import type { CourseSalesSettings } from "@/lib/course-sales";
import type { MembershipGroup } from "@/lib/membership-types";
import { saveCourseSalesAction, type CourseSalesFields } from "@/lib/course-sales-actions";
import { useContentForm } from "@/lib/use-content-form";
import { Field } from "./common";
import { SubmitButton } from "./submit-button";

export function CourseSalesForm({ settings, groups, stripeReady, returnTo }: {
  settings: CourseSalesSettings;
  groups: MembershipGroup[];
  stripeReady: boolean;
  returnTo?: string;
}) {
  const form = useContentForm<CourseSalesFields>(saveCourseSalesAction, {
    enabled: settings.enabled,
    groupId: settings.groupId === null ? "" : String(settings.groupId),
    groupIds: settings.groupIds.map(String),
    groupAccessDays: settings.groupAccessDays === null ? "" : String(settings.groupAccessDays),
    vatPercent: String(settings.vatPercent),
    terms: settings.terms,
    expectedUpdatedAt: settings.updatedAt ?? "",
  }, `course-sales-${settings.courseId}`, true);
  const change = (key: keyof CourseSalesFields, value: string | boolean) => form.setValues(current => ({ ...current, [key]: value }));
  const offerName = returnTo?.startsWith("/admin/paket/") ? "paketet" : "kursen";
  return (
    <form action={form.action} onSubmit={form.onSubmit} aria-busy={form.pending} className="stack">
      <input type="hidden" name="courseId" value={settings.courseId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt} />
      {form.error && <div className="notice notice-error" role="alert" tabIndex={-1} ref={form.errorRef}>{form.error}</div>}
      <p className="muted">
        Eleven köper {offerName} med en engångsbetalning och får kursåtkomst utan tidsgräns.
        Du kan dessutom ge tillgång till flera grupper med extra material och kurser.
      </p>
      {!stripeReady && <p className="notice">Stripe-anslutningen behöver konfigureras innan kunder kan betala. Du kan förbereda inställningarna här.</p>}
      <fieldset className="stack content-form-fields" disabled={form.pending}>
        <legend className="sr-only">Försäljning och grupp efter köp</legend>
        <div className="stack"><h3>Grupper efter köp</h3><p className="small muted">Välj alla grupper som eleven ska få efter bekräftad betalning. Inga val ger endast kursåtkomst.</p>
          {groups.map(group => <label className="form-check" key={group.id}><input type="checkbox" name="groupId" value={group.id} checked={form.values.groupIds.includes(String(group.id))} onChange={event => form.setValues(current => ({ ...current, groupIds: event.target.checked ? [...current.groupIds, String(group.id)] : current.groupIds.filter(id => id !== String(group.id)) }))} /><span>{group.name}{group.published ? "" : " (utkast)"}</span></label>)}
        </div>
        <div className="form-grid">
          <Field label="Gruppåtkomst i dagar (valfritt)" name="course-sales-days" help="Tomt ger obegränsad gruppåtkomst. Antalet dagar räknas från betalningen; den köpta kursåtkomsten påverkas inte.">
            <input id="course-sales-days" name="groupAccessDays" type="number" min={1} max={3650} step={1} disabled={!form.values.groupIds.length} value={form.values.groupAccessDays} onChange={event => change("groupAccessDays", event.target.value)} />
          </Field>
          <Field label="Moms på kursköpet (%)" name="course-sales-vat" help="Priset i kursens grunduppgifter är inklusive den momssats du väljer.">
            <select id="course-sales-vat" name="vatPercent" value={form.values.vatPercent} onChange={event => change("vatPercent", event.target.value)}>
              {[25, 12, 6, 0].map(vat => <option value={vat} key={vat}>{vat} %</option>)}
            </select>
          </Field>
        </div>
        <Field label={`Köpvillkor för ${offerName}`} name="course-sales-terms" help="Beskriv vad som ingår, kurs- och gruppåtkomst, kontaktväg, ångerrätt och återbetalning. Villkoren visas före betalningen och sparas med köpet.">
          <textarea id="course-sales-terms" name="terms" maxLength={20000} rows={7} value={form.values.terms} onChange={event => change("terms", event.target.value)} />
        </Field>
        <label className="form-check">
          <input type="checkbox" name="enabled" checked={form.values.enabled} onChange={event => change("enabled", event.target.checked)} />
          <span>Aktivera köp av {offerName} via Stripe</span>
        </label>
        <p className="small muted">Kursen behöver ett pris och vara publicerad. En grupp som ingår behöver också vara publicerad. Ange verksamhetens kontakt-e-post under Admin → Inställningar. Ändringar gäller nya köp; tidigare köp behåller sina avtalade uppgifter.</p>
      </fieldset>
      <div><SubmitButton>Spara köpinställningar</SubmitButton></div>
    </form>
  );
}
