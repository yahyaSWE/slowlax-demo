"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import { DomainError } from "./db";
import { dispatchKitNewsletterOutbox, retryKitNewsletterJob, saveKitNewsletterSettings } from "./kit-newsletter";
import type { KitNewsletterFormState } from "./kit-newsletter-types";

function failure(error: unknown): KitNewsletterFormState {
  if (error instanceof DomainError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "Kontrollera uppgifterna." };
  return { error: "Ändringen kunde inte slutföras. Försök igen om en stund." };
}

export async function saveKitNewsletterSettingsAction(_previous: KitNewsletterFormState, form: FormData): Promise<KitNewsletterFormState> {
  const actor = await requireAdmin();
  try {
    // Explicit allowlist. Ignore all other submitted fields, including secrets.
    await saveKitNewsletterSettings(actor.id, {
      enabled: form.get("enabled") === "on", formId: String(form.get("formId") ?? ""),
      tagId: String(form.get("tagId") ?? ""), doubleOptInConfirmed: form.get("doubleOptInConfirmed") === "on",
    });
  } catch (error) { return failure(error); }
  revalidatePath("/admin/nyhetsbrev");
  revalidatePath("/registrera");
  return { message: "Inställningarna för nyhetsbrevet har sparats." };
}

export async function retryKitNewsletterAction(_previous: KitNewsletterFormState, form: FormData): Promise<KitNewsletterFormState> {
  const actor = await requireAdmin();
  try {
    const userId = await retryKitNewsletterJob(actor.id, String(form.get("jobId") ?? ""));
    const result = await dispatchKitNewsletterOutbox({ userId, limit: 1 });
    revalidatePath("/admin/nyhetsbrev");
    return { message: result.failed ? "Försöket gjordes. Läs senaste felet i listan." : result.skipped ? "Adressen hoppades över enligt Kits prenumerationsstatus." : result.sent ? "Inbjudan har överlämnats till Kit." : "Försöket ligger i kön och inväntar verifiering eller tillgänglig anslutning." };
  } catch (error) { return failure(error); }
}
