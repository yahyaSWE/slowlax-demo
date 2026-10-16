"use client";

import type { FreeMembershipSettings } from "@/lib/free-membership-domain";
import type { MembershipGroup } from "@/lib/membership-types";
import { saveFreeMembershipAction, type FreeMembershipFields } from "@/lib/free-membership-actions";
import { useContentForm } from "@/lib/use-content-form";
import { Field } from "./common";
import { SubmitButton } from "./submit-button";

export function FreeMembershipForm({ settings, groups }: { settings: FreeMembershipSettings; groups: MembershipGroup[] }) {
  const form = useContentForm<FreeMembershipFields>(saveFreeMembershipAction, {
    description: settings.description, groupIds: settings.groupIds.map(String), expectedUpdatedAt: settings.updatedAt,
  }, "free-membership", true);
  return <form action={form.action} onSubmit={form.onSubmit} aria-busy={form.pending} className="stack">
    <input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt} />
    {form.error && <div className="notice notice-error" role="alert" ref={form.errorRef} tabIndex={-1}>{form.error}</div>}
    <p><strong>Bas medlemskap · Gratis</strong></p>
    <p className="muted">Bas finns alltid på webbplatsen. Nya elever blir automatiskt medlemmar när de skapar konto. Äldre elevkonton kan gå med kostnadsfritt.</p>
    <fieldset className="stack content-form-fields" disabled={form.pending}><legend className="sr-only">Bas medlemskap</legend>
      <Field label="Beskrivning av Bas" name="free-membership-description" help="Beskriv vad som ingår. Texten visas på medlemskapssidan och Bas egen sida.">
        <textarea id="free-membership-description" name="description" required minLength={1} maxLength={12000} rows={6} value={form.values.description} onChange={event => form.setValues(current => ({ ...current, description: event.target.value }))} />
      </Field>
      <div className="stack"><h3>Grupper som ingår</h3><p className="small muted">Du kan börja utan grupper och lägga till publicerade grupper senare. Ändringar gäller alla Bas-medlemmar. Innehållet blir tillgängligt efter att eleven verifierat sin e-postadress.</p>
        {groups.length ? <div className="membership-course-options">{groups.map(group => <label className="form-check" key={group.id}>
          <input type="checkbox" name="groupId" value={group.id} checked={form.values.groupIds.includes(String(group.id))} disabled={!group.published && !form.values.groupIds.includes(String(group.id))}
            onChange={event => form.setValues(current => ({ ...current, groupIds: event.target.checked ? [...current.groupIds, String(group.id)] : current.groupIds.filter(id => id !== String(group.id)) }))} />
          <span>{group.name}{!group.published && " (utkast)"}</span>
        </label>)}</div> : <p className="muted">Inga grupper finns ännu. Du kan spara Bas utan grupper.</p>}
      </div>
      <p className="small muted">Att ta bort en grupp från Bas påverkar inte åtkomst från separata kursköp, betalda medlemskap eller manuella tilldelningar.</p>
    </fieldset><div><SubmitButton>Spara Bas medlemskap</SubmitButton></div>
  </form>;
}
