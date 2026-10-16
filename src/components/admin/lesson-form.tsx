"use client";

import { saveLessonContentAction } from "@/lib/content-actions";
import { useContentForm } from "@/lib/use-content-form";
import type { LessonFields } from "@/lib/content-action-state";
import type { Lesson } from "@/lib/types";
import { Field, ReturnTo } from "./common";
import { SubmitButton } from "./submit-button";
import { FileUpload } from "./file-upload";

export function LessonForm({
  lesson,
  courseId,
  returnTo,
  position,
}: {
  lesson?: Lesson;
  courseId: number;
  returnTo: string;
  position: number;
}) {
  const prefix = lesson ? `lesson-${lesson.id}` : "new-lesson";
  const form = useContentForm<LessonFields>(
    saveLessonContentAction,
    {
      title: lesson?.title ?? "",
      position: String(lesson?.position ?? position),
      body: lesson?.body ?? "",
      videoUrl: lesson?.videoUrl ?? "",
      materialUrl: lesson?.materialUrl ?? "",
    },
    `lesson-${lesson?.id ?? "new"}`,
    !lesson,
  );
  return (
    <form
      action={form.action}
      onSubmit={form.onSubmit}
      aria-busy={form.pending}
      className="stack"
    >
      <ReturnTo path={returnTo} />
      <input type="hidden" name="courseId" value={courseId} />
      {lesson ? <input type="hidden" name="id" value={lesson.id} /> : null}
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
        <legend className="sr-only">Lektionens innehåll</legend>
        <div className="form-grid">
          <Field label="Lektionens namn" name={`${prefix}-title`}>
            <input
              id={`${prefix}-title`}
              name="title"
              required
              maxLength={180}
              value={form.values.title}
              onChange={(event) =>
                form.setValues({ ...form.values, title: event.target.value })
              }
              placeholder="Lektionens namn"
            />
          </Field>
          <Field
            label="Ordning"
            name={`${prefix}-position`}
            help="Lägre tal visas först."
          >
            <input
              id={`${prefix}-position`}
              name="position"
              type="number"
              min={1}
              max={10000}
              required
              value={form.values.position}
              onChange={(event) =>
                form.setValues({ ...form.values, position: event.target.value })
              }
            />
          </Field>
        </div>
        <Field
          label="Lektionstext"
          name={`${prefix}-body`}
          help="Du kan kombinera text, video och material. En lektion kan också bestå enbart av uppladdade filer."
        >
          <textarea
            id={`${prefix}-body`}
            name="body"
            rows={8}
            maxLength={100000}
            value={form.values.body}
            onChange={(event) =>
              form.setValues({ ...form.values, body: event.target.value })
            }
            placeholder="Skriv lektionens innehåll…"
          />
        </Field>
        <Field
          label="Videolänk"
          name={`${prefix}-videoUrl`}
          help="En länk till YouTube, Vimeo eller en videofil. YouTube kan visa kanalnamn och länkar i spelaren. Använd en direkt MP4- eller WebM-länk för Slowlax egen spelare."
        >
          <input
            id={`${prefix}-videoUrl`}
            name="videoUrl"
            type="url"
            maxLength={2000}
            value={form.values.videoUrl}
            onChange={(event) =>
              form.setValues({ ...form.values, videoUrl: event.target.value })
            }
            placeholder="https://…"
          />
        </Field>
        <FileUpload
          key={
            lesson
              ? `lesson-${lesson.id}`
              : `new-lesson-${form.savedToken ?? "initial"}`
          }
          kind="lesson-material"
          inputName="materialUploadIds"
          courseId={courseId}
          currentFiles={lesson?.materials || []}
          multiple
        />
        <Field
          label="Länk till kursmaterial"
          name={`${prefix}-materialUrl`}
          help="Valfritt alternativ eller komplement till uppladdade filer: ett arbetsblad eller annat material på en säker webbadress."
        >
          <input
            id={`${prefix}-materialUrl`}
            name="materialUrl"
            type="url"
            maxLength={2000}
            value={form.values.materialUrl}
            onChange={(event) =>
              form.setValues({
                ...form.values,
                materialUrl: event.target.value,
              })
            }
            placeholder="https://…"
          />
        </Field>
      </fieldset>
      <div>
        <SubmitButton>
          {lesson ? "Spara lektion" : "Lägg till lektion"}
        </SubmitButton>
      </div>
    </form>
  );
}
