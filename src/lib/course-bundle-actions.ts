"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { DomainError } from "./db";
import { field, idField, money } from "./validation";
import { saveCourseBundle } from "./course-bundles";
import type { ContentActionState } from "./content-action-state";

export type BundleFields = { title: string; slug: string; description: string; price: string; courseIds: string[]; published: boolean; expectedUpdatedAt: string };
export async function saveCourseBundleAction(_state: ContentActionState<BundleFields>, form: FormData): Promise<ContentActionState<BundleFields>> {
  const actor = await requireAdmin(), id = field(form, "id") ? idField(form) : undefined;
  const values: BundleFields = { title: field(form, "title"), slug: field(form, "slug"), description: field(form, "description"),
    price: field(form, "price"), courseIds: form.getAll("courseId").filter((value): value is string => typeof value === "string"),
    published: field(form, "published") === "on", expectedUpdatedAt: field(form, "expectedUpdatedAt") };
  let savedId: number;
  try {
    savedId = await saveCourseBundle(actor.id, id, { title: values.title, slug: values.slug, description: values.description,
      priceOre: money(values.price), courseIds: values.courseIds.map(Number), published: values.published, expectedUpdatedAt: id ? values.expectedUpdatedAt : undefined });
  } catch (error) {
    return { values, error: error instanceof DomainError ? error.message : error instanceof z.ZodError ? error.issues[0]?.message : "Paketet kunde inte sparas. Försök igen." };
  }
  revalidatePath("/", "layout");
  redirect(`/admin/paket/${savedId}?success=${encodeURIComponent("Paketet har sparats.")}&saved=${Date.now()}&savedForm=bundle-${id ?? "new"}`);
}
