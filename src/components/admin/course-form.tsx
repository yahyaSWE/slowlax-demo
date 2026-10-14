"use client";

import { saveCourseContentAction } from "@/lib/content-actions";
import { useContentForm } from "@/lib/use-content-form";
import type { CourseFields } from "@/lib/content-action-state";
import { Field, ReturnTo } from "./common";
import { SubmitButton } from "./submit-button";

type CourseFormValue = {
  id: number;
  title: string;
  slug: string;
  description: string;
  priceOre: number;
  published: boolean;
};

export function CourseForm({
  course,
  returnTo,
}: {
  course?: CourseFormValue;
  returnTo: string;
}) {
  const form = useContentForm<CourseFields>(
    saveCourseContentAction,
    {
      title: course?.title ?? "",
      slug: course?.slug ?? "",
      description: course?.description ?? "",
      price: String(course ? course.priceOre / 100 : 0),
      published: course?.published ?? false,
    },
    `course-${course?.id ?? "new"}`,
  );
  return (
    <form
      action={form.action}
      onSubmit={form.onSubmit}
      aria-busy={form.pending}
      className="stack"
    >
      <ReturnTo path={returnTo} />
      {course ? <input type="hidden" name="id" value={course.id} /> : null}
      {form.error && (
        <div
          className="notice notice-error"
          role="alert"
          tabIndex={-1}
          ref={form.errorRef}
        >
          {form.error}
        </div>
      )}
      <fieldset disabled={form.pending} className="stack content-form-fields">
        <legend className="sr-only">Kursens grunduppgifter</legend>
        <Field label="Kursens namn" name="title">
          <input
            id="title"
            name="title"
            required
            maxLength={180}
            value={form.values.title}
            onChange={(event) =>
              form.setValues({ ...form.values, title: event.target.value })
            }
            placeholder="Ge kursen ett tydligt namn"
          />
        </Field>
        <Field
          label="Adressnamn"
          name="slug"
          help="Lämna tomt för att skapa ett adressnamn från kursens namn."
        >
          <input
            id="slug"
            name="slug"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={100}
            value={form.values.slug}
            onChange={(event) =>
              form.setValues({ ...form.values, slug: event.target.value })
            }
            placeholder="kursens-namn"
          />
        </Field>
        <Field label="Kursbeskrivning" name="description">
          <textarea
            id="description"
            name="description"
            required
            rows={6}
            maxLength={10000}
            value={form.values.description}
            onChange={(event) =>
              form.setValues({
                ...form.values,
                description: event.target.value,
              })
            }
            placeholder="Beskriv vad eleven får lära sig och vem kursen passar."
          />
        </Field>
        <Field
          label="Pris (kr)"
          name="price"
          help="Priset visas i kurskatalogen och används vid engångsköp när du aktiverar Stripe-försäljning längre ned i kursbyggaren."
        >
          <input
            id="price"
            name="price"
            type="number"
            required
            min={0}
            step="0.01"
            max={100000}
            value={form.values.price}
            onChange={(event) =>
              form.setValues({ ...form.values, price: event.target.value })
            }
          />
        </Field>
        {course ? (
          <label className="form-check">
            <input
              type="checkbox"
              name="published"
              checked={form.values.published}
              onChange={(event) =>
                form.setValues({
                  ...form.values,
                  published: event.target.checked,
                })
              }
            />
            <span>Visa kursen i kurskatalogen</span>
          </label>
        ) : (
          <p className="muted">
            Kursen skapas som ett utkast. Lägg till lektioner i kursbyggaren och
            publicera sedan.
          </p>
        )}
      </fieldset>
      <div>
        <SubmitButton>
          {course ? "Spara kurs" : "Skapa kursutkast"}
        </SubmitButton>
      </div>
    </form>
  );
}
