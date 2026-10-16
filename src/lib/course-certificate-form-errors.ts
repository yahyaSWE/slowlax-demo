import { unstable_rethrow } from "next/navigation";
import type { CourseCertificateFormState } from "./course-certificate-form-state";

export function withCourseCertificateFormErrors(action: (previous: CourseCertificateFormState, form: FormData) => Promise<CourseCertificateFormState>) {
  return async (previous: CourseCertificateFormState, form: FormData): Promise<CourseCertificateFormState> => {
    try { return await action(previous, form); }
    catch (error) {
      unstable_rethrow(error);
      return { ...previous, error: "Anslutningen avbröts. Din inmatning finns kvar; försök igen.", message: undefined };
    }
  };
}
