"use server";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { DomainError } from "./db";
import { getBusinessSettings, saveBusinessSettings, saveCourseInformation } from "./business-settings";
import { revalidateMutation } from "./revalidation";
import { businessSettingsSchema, courseInformationSchema } from "./business-config";
import type { BusinessFormState } from "./business-form-state";

function errorMessage(error: unknown) {
  if (error instanceof DomainError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message || "Kontrollera uppgifterna.";
  return "Uppgifterna kunde inte sparas. Din text finns kvar; försök igen.";
}
export async function saveBusinessSettingsForm(_previous: BusinessFormState, form: FormData): Promise<BusinessFormState> {
  const user = await requireAdmin();
  try {
    // Preserve legacy booking metadata without exposing it in this site's form.
    const current = await getBusinessSettings();
    const legacyKeys = new Set(["cancellationHours", "cancellationDetails", "bookingRetention"]);
    const input = Object.fromEntries(Object.keys(businessSettingsSchema.shape).map((key) => [key,
      legacyKeys.has(key) ? current[key as keyof typeof current] : String(form.get(key) ?? ""),
    ]));
    await saveBusinessSettings(user.id, input);
  } catch (error) { return { error: errorMessage(error), success: null }; }
  revalidateMutation("/admin/installningar", "/admin/installningar");
  return { error: null, success: "Verksamhetsuppgifter och villkor har sparats." };
}
export async function saveCourseInformationForm(_previous: BusinessFormState, form: FormData): Promise<BusinessFormState> {
  const user = await requireAdmin();
  let id: number;
  try {
    id = z.coerce.number().int().positive().parse(form.get("courseId"));
    const input = Object.fromEntries(Object.keys(courseInformationSchema.shape).map((key) => [key, String(form.get(key) ?? "")]));
    await saveCourseInformation(user.id, id, input);
  } catch (error) { return { error: errorMessage(error), success: null }; }
  revalidateMutation("/admin/kurser", `/admin/kurser/${id}`);
  return { error: null, success: "Kursinformationen har sparats." };
}
