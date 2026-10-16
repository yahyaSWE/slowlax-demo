"use client";

import type { CourseBundle } from "@/lib/course-bundles";
import type { Course } from "@/lib/types";
import { saveCourseBundleAction, type BundleFields } from "@/lib/course-bundle-actions";
import { useContentForm } from "@/lib/use-content-form";
import { Field } from "./common";
import { SubmitButton } from "./submit-button";

export function CourseBundleForm({ bundle, courses }: { bundle?: CourseBundle; courses: Course[] }) {
  const form = useContentForm<BundleFields>(saveCourseBundleAction, { title: bundle?.title ?? "", slug: bundle?.slug ?? "", description: bundle?.description ?? "",
    price: bundle ? String(bundle.priceOre / 100) : "", courseIds: bundle?.courseIds.map(String) ?? [], published: bundle?.published ?? false,
    expectedUpdatedAt: bundle?.updatedAt ?? "" }, `bundle-${bundle?.id ?? "new"}`, true);
  const change = (key: keyof BundleFields, value: string | string[] | boolean) => form.setValues(current => ({ ...current, [key]: value }));
  return <form action={form.action} onSubmit={form.onSubmit} aria-busy={form.pending} className="stack">
    {bundle && <input type="hidden" name="id" value={bundle.id} />}<input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt} />
    {form.error && <div className="notice notice-error" role="alert" tabIndex={-1} ref={form.errorRef}>{form.error}</div>}
    <fieldset className="stack content-form-fields" disabled={form.pending}><legend className="sr-only">Paketets uppgifter</legend>
      <div className="form-grid"><Field label="Paketnamn" name="bundle-title"><input id="bundle-title" name="title" required minLength={2} maxLength={180} placeholder="Bas-kit" value={form.values.title} onChange={event => change("title", event.target.value)} /></Field>
      <Field label="Adressnamn" name="bundle-slug"><input id="bundle-slug" name="slug" maxLength={100} value={form.values.slug} onChange={event => change("slug", event.target.value)} /></Field></div>
      <Field label="Beskrivning" name="bundle-description"><textarea id="bundle-description" name="description" rows={5} maxLength={12000} value={form.values.description} onChange={event => change("description", event.target.value)} /></Field>
      <Field label="Paketpris inklusive moms (kr)" name="bundle-price"><input id="bundle-price" name="price" required inputMode="decimal" value={form.values.price} onChange={event => change("price", event.target.value)} /></Field>
      <div className="stack"><h3>Kurser som ingår</h3><p className="small muted">Välj minst två kurser. Eleven får tillgång utan tidsgräns efter bekräftad betalning.</p>
        {courses.map(course => <label className="form-check" key={course.id}><input type="checkbox" name="courseId" value={course.id} checked={form.values.courseIds.includes(String(course.id))} onChange={event => change("courseIds", event.target.checked ? [...form.values.courseIds, String(course.id)] : form.values.courseIds.filter(id => id !== String(course.id)))} /><span>{course.title}{!course.published && " (utkast)"}</span></label>)}
      </div>
      <label className="form-check"><input type="checkbox" name="published" checked={form.values.published} onChange={event => change("published", event.target.checked)} /><span>Publicera paketet</span></label>
      <p className="small muted">Spara paketet och välj sedan grupper, köpinställningar och villkor. Ändringar gäller nya köp. Tidigare köp behåller kurserna och grupperna som ingick när eleven betalade.</p>
    </fieldset><div><SubmitButton>{bundle ? "Spara paket" : "Skapa paket"}</SubmitButton></div>
  </form>;
}
