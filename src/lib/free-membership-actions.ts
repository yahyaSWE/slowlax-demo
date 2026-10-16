"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "./auth";
import { DomainError } from "./db";
import { field } from "./validation";
import { joinFreeMembership, saveFreeMembershipSettings } from "./free-membership-domain";
import { dispatchKitNewsletterOutbox } from "./kit-newsletter";
import type { ContentActionState } from "./content-action-state";

export type FreeMembershipFields = { description: string; groupIds: string[]; expectedUpdatedAt: string };
export type JoinFreeMembershipState = { error?: string };
function errorMessage(error: unknown) {
  return error instanceof DomainError ? error.message : error instanceof z.ZodError
    ? error.issues[0]?.message || "Kontrollera uppgifterna."
    : "Åtgärden kunde inte slutföras. Försök igen om en stund.";
}

export async function saveFreeMembershipAction(_state: ContentActionState<FreeMembershipFields>, form: FormData): Promise<ContentActionState<FreeMembershipFields>> {
  const actor = await requireAdmin();
  const values: FreeMembershipFields = { description: field(form, "description"), expectedUpdatedAt: field(form, "expectedUpdatedAt"),
    groupIds: form.getAll("groupId").filter((value): value is string => typeof value === "string") };
  try {
    await saveFreeMembershipSettings(actor.id, { description: values.description, groupIds: values.groupIds.map(Number), expectedUpdatedAt: values.expectedUpdatedAt });
  } catch (error) { return { values, error: errorMessage(error) }; }
  revalidatePath("/medlemskap", "layout");
  revalidatePath("/admin/medlemskap", "layout");
  revalidatePath("/elevportal", "layout");
  redirect(`/admin/medlemskap/bas?success=${encodeURIComponent("Bas medlemskap har sparats.")}&saved=${Date.now()}&savedForm=free-membership`);
}

export async function joinFreeMembershipAction(_state: JoinFreeMembershipState, form: FormData): Promise<JoinFreeMembershipState> {
  const user = await requireUser();
  try {
    const result = await joinFreeMembership(user.id);
    if (result.newsletterQueued) after(async () => {
      try { await dispatchKitNewsletterOutbox({ userId: user.id }); }
      catch { /* The durable invitation remains available for the newsletter worker. */ }
    });
  } catch (error) { return { error: errorMessage(error) }; }
  revalidatePath("/medlemskap/bas");
  revalidatePath("/elevportal", "layout");
  const destination = field(form, "returnTo") === "/elevportal/medlemskap" ? "/elevportal/medlemskap" : "/medlemskap/bas";
  redirect(`${destination}?success=${encodeURIComponent("Du är nu medlem i Bas. Medlemskapet är kostnadsfritt.")}`);
}
