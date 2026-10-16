import type { CourseCertificateSettings } from "./course-certificates";

export type CourseCertificateFormState = {
  error?: string;
  message?: string;
  settings?: CourseCertificateSettings;
  certificateId?: string;
};
