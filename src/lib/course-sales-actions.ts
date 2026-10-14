"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { DomainError } from "./db";
import { field, idField } from "./validation";
import { saveCourseSalesSettings } from "./course-sales";
import type { ContentActionState } from "./content-action-state";

export type CourseSalesFields = {
  enabled: boolean;
  groupId: string;
  groupAccessDays: string;
  vatPercent: string;
  terms: string;
  expectedUpdatedAt: string;
};

export async function saveCourseSalesAction(
  _state: ContentActionState<CourseSalesFields>, form: FormData,
): Promise<ContentActionState<CourseSalesFields>> {
  const user = await requireAdmin();
  const courseId = idField(form, "courseId");
  const values: CourseSalesFields = {
    enabled: field(form, "enabled") === "on",
    groupId: field(form, "groupId"),
    groupAccessDays: field(form, "groupAccessDays"),
    vatPercent: field(form, "vatPercent"),
    terms: field(form, "terms"),
    expectedUpdatedAt: field(form, "expectedUpdatedAt"),
  };
  try {
    await saveCourseSalesSettings(user.id, courseId, {
      enabled: values.enabled,
      groupId: values.groupId ? Number(values.groupId) : null,
      groupAccessDays: values.groupId && values.groupAccessDays ? Number(values.groupAccessDays) : null,
      vatPercent: Number(values.vatPercent) as 0 | 6 | 12 | 25,
      terms: values.terms,
      expectedUpdatedAt: values.expectedUpdatedAt || null,
    });
  } catch (error) {
    return {
      values,
      error: error instanceof DomainError ? error.message : error instanceof z.ZodError
        ? error.issues[0]?.message || "Kontrollera uppgifterna."
        : "Inställningarna kunde inte sparas. Din inmatning finns kvar.",
    };
  }
  revalidatePath("/kurser", "layout");
  revalidatePath(`/admin/kurser/${courseId}`);
  revalidatePath("/elevportal", "layout");
  redirect(`/admin/kurser/${courseId}?success=${encodeURIComponent("Köpinställningarna har sparats.")}&saved=${Date.now()}&savedForm=course-sales-${courseId}`);
}
