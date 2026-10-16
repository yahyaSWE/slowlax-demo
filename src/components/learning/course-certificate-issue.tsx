"use client";
import { useActionState } from "react";
import { Award, Download } from "lucide-react";
import { issueCourseCertificateAction } from "@/lib/course-certificate-actions";
import { withCourseCertificateFormErrors } from "@/lib/course-certificate-form-errors";
import type { CourseCertificateFormState } from "@/lib/course-certificate-form-state";

const INITIAL_STATE: CourseCertificateFormState = {};

export function CourseCertificateIssue({ courseId }: { courseId: number }) {
  const [state, action, pending] = useActionState(withCourseCertificateFormErrors(issueCourseCertificateAction), INITIAL_STATE);
  return <form action={action} className="stack" aria-busy={pending}>
    <input type="hidden" name="courseId" value={courseId} />
    {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    {state.message && <p className="notice notice-success" role="status">{state.message}</p>}
    <div>{state.certificateId
      ? <a href={`/api/diplom/${state.certificateId}`} className="button button-primary" download><Download size={17} aria-hidden="true" /> Ladda ner diplom (PDF)</a>
      : <button type="submit" className="button button-primary" disabled={pending}><Award size={17} aria-hidden="true" />{pending ? "Förbereder diplomet…" : "Skapa mitt diplom"}</button>}</div>
  </form>;
}
