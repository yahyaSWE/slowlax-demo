"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "./auth";
import { DomainError } from "./db";
import { issueCourseCertificate, saveCourseCertificateSettings } from "./course-certificates";
import { field } from "./validation";
import type { CourseCertificateFormState } from "./course-certificate-form-state";

function failure(error: unknown): CourseCertificateFormState {
  if (error instanceof DomainError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "Kontrollera uppgifterna." };
  return { error: "Åtgärden kunde inte slutföras. Försök igen om en stund." };
}

export async function saveCourseCertificateSettingsAction(_previous: CourseCertificateFormState, form: FormData): Promise<CourseCertificateFormState> {
  const actor = await requireAdmin();
  try {
    const courseId = z.coerce.number().int().positive().safe().parse(field(form, "courseId"));
    const expectedUpdatedAt = field(form, "expectedUpdatedAt") || null;
    const settings = await saveCourseCertificateSettings(actor.id, courseId, {
      enabled: field(form, "enabled") === "on", expectedUpdatedAt,
    });
    revalidatePath(`/admin/kurser/${courseId}`);
    revalidatePath(`/elevportal/kurser/${courseId}`);
    return { settings, message: settings.enabled ? "Diplom har aktiverats för kursen." : "Nya diplom har stängts av för kursen. Utfärdade diplom finns kvar." };
  } catch (error) { return failure(error); }
}

export async function issueCourseCertificateAction(_previous: CourseCertificateFormState, form: FormData): Promise<CourseCertificateFormState> {
  const user = await requireUser();
  try {
    // Identity, completion, name, title, issuer and dates are resolved by the
    // transaction on the server. Only the requested course comes from the form.
    const courseId = z.coerce.number().int().positive().safe().parse(field(form, "courseId"));
    const certificate = await issueCourseCertificate(user.id, courseId);
    revalidatePath(`/elevportal/kurser/${courseId}`);
    revalidatePath("/elevportal/diplom");
    return { certificateId: certificate.id, message: "Ditt diplom är klart och finns under Mina diplom." };
  } catch (error) { return failure(error); }
}
