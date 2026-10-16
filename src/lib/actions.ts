"use server";
import { headers } from "next/headers";
import { after } from "next/server";
import { revalidateMutation } from "./revalidation";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  requireAdmin,
  requireUser,
} from "./auth";
import {
  DomainError,
  createFirstAdmin,
  getUserByEmail,
  hasAdmin,
  transaction,
} from "./db";
import { registerStudent } from "./accounts";
import * as admin from "./admin";
import {
  equalSecret,
  hashPassword,
  verifyPassword,
} from "./security";
import {
  emailSchema,
  field,
  idField,
  signupSchema,
} from "./validation";
import { enforceRequestLimit } from "./request-rate-limit";
import { sendVerificationEmail } from "./account-email";
import { accountAuthHref, safeAccountReturnTo } from "./account-return";
import { resolveAccountReturnTo } from "./account-return-destination";
import { SupabaseAuthConfigurationError, supabaseAuthRequested } from "./supabase-auth-config";
function path(value: string, fallback: string) {
  return /^\/(?!\/)/.test(value) &&
    !value.includes("\\") &&
    !/[\r\n]/.test(value)
    ? value
    : fallback;
}
function message(error: unknown) {
  if (error instanceof DomainError || error instanceof SupabaseAuthConfigurationError) return error.message;
  if (error instanceof z.ZodError)
    return error.issues[0]?.message || "Kontrollera fälten och försök igen.";
  if (error instanceof Error && error.message.includes("UNIQUE constraint"))
    return "E-postadressen eller webbadressen används redan.";
  console.error(
    "Slowlax action failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return "Åtgärden kunde inte slutföras. Försök igen.";
}
async function formAction(
  form: FormData,
  fallback: string,
  work: () => void | string | Promise<void | string>,
  authForm = false,
) {
  let destination = authForm
    ? accountAuthHref(fallback as "/logga-in" | "/registrera", field(form, "returnTo"))
    : path(field(form, "returnTo"), fallback);
  try {
    const result = await work();
    // Session cookie changes already refresh the auth UI through Next.js.
    if (!authForm) revalidateMutation(fallback, result || destination);
    destination =
      result ||
      destination +
        (destination.includes("?") ? "&" : "?") +
        "success=" +
        encodeURIComponent("Ändringarna har sparats.");
  } catch (error) {
    destination =
      destination +
      (destination.includes("?") ? "&" : "?") +
      "error=" +
      encodeURIComponent(message(error));
  }
  redirect(destination);
}
async function requestLimit(action: string, subject: string, count: number) {
  await enforceRequestLimit(action, subject, count, await headers());
}
export async function loginAction(form: FormData): Promise<void> {
  await formAction(
    form,
    "/logga-in",
    async () => {
      const email = emailSchema.parse(field(form, "email"));
      const password = z
        .string()
        .min(1)
        .max(128)
        .parse(field(form, "password"));
      await requestLimit("login", email, 10);
      if (supabaseAuthRequested()) {
        const { loginSupabaseUser } = await import("./supabase-auth");
        const user = await loginSupabaseUser(email, password);
        after(async () => { try { const { dispatchKitNewsletterOutbox } = await import("./kit-newsletter"); await dispatchKitNewsletterOutbox({ userId: user.id }); } catch { /* Durable outbox remains available for retry. */ } });
        return resolveAccountReturnTo(field(form, "returnTo"), user.role === "admin" ? "/admin" : "/elevportal");
      }
      const user = await transaction(async () => {
        const current = await getUserByEmail(email);
        const valid = verifyPassword(password, current?.passwordHash || "missing:" + "0".repeat(128));
        if (!current || !valid) throw new DomainError("E-postadress eller lösenord är fel.");
        // A reset cannot commit between validating the old password and
        // creating a fresh session with those now-revoked credentials.
        await createSession(current.id);
        return current;
      });
      return resolveAccountReturnTo(
        field(form, "returnTo"),
        user.role === "admin" ? "/admin" : "/elevportal",
      );
    },
    true,
  );
}
export async function signupAction(form: FormData): Promise<void> {
  await formAction(
    form,
    "/registrera",
    async () => {
      const input = signupSchema.parse({
        name: field(form, "name"),
        email: field(form, "email"),
        password: field(form, "password"),
      });
      await requestLimit("signup", input.email, 5);
      if (supabaseAuthRequested()) {
        const { registerSupabaseUser } = await import("./supabase-auth");
        await registerSupabaseUser(input, field(form, "returnTo"));
        const target = accountAuthHref("/verifiera-epost", field(form, "returnTo"));
        return target + (target.includes("?") ? "&" : "?") + "message=" + encodeURIComponent("Kontrollera inkorgen för att bekräfta adressen. Om du redan har ett konto kan du logga in eller begära återställning. Detta bekräftar inte att ett konto finns eller att ett mejl har levererats.");
      }
      const user = await registerStudent(input);
      await createSession(user.id);
      const returnTo = safeAccountReturnTo(field(form, "returnTo"), "");
      const verifyPath = accountAuthHref("/verifiera-epost", returnTo);
      try {
        await sendVerificationEmail(user.id, returnTo);
      } catch {
        return verifyPath + (verifyPath.includes("?") ? "&" : "?") + "message=" + encodeURIComponent("Ditt konto är skapat. E-postverifiering kunde inte skickas just nu. Ditt konto är inte verifierat ännu.");
      }
      return (
        verifyPath + (verifyPath.includes("?") ? "&" : "?") + "message=" +
        encodeURIComponent(
          "Ditt konto är skapat. E-posttjänsten har accepterat verifieringsmeddelandet. Öppna länken i din inkorg för att verifiera adressen.",
        )
      );
    },
    true,
  );
}
export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
export async function saveSettingsAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/installningar",
    async () =>
      await admin.saveSettings(user.id, {
        siteName: field(form, "siteName"),
        email: field(form, "email"),
        phone: field(form, "phone"),
        address: field(form, "address"),
        location: field(form, "location"),
      }),
  );
}
export async function saveArticleAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/artiklar",
    async () =>
      await admin.saveArticle(user.id, {
        id: field(form, "id") ? idField(form) : undefined,
        title: field(form, "title"),
        slug: field(form, "slug"),
        excerpt: field(form, "excerpt"),
        body: field(form, "body"),
        published: field(form, "published") === "on",
      }),
  );
}
export async function deleteArticleAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/artiklar",
    async () => await admin.deleteArticle(user.id, idField(form)),
  );
}
export async function saveCourseAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/kurser",
    async () =>
      await admin.saveCourse(user.id, {
        id: field(form, "id") ? idField(form) : undefined,
        title: field(form, "title"),
        slug: field(form, "slug"),
        description: field(form, "description"),
        price: field(form, "price"),
        published: field(form, "published") === "on",
      }),
  );
}
export async function deleteCourseAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/kurser",
    async () => await admin.deleteCourse(user.id, idField(form)),
  );
}
export async function saveLessonAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/kurser",
    async () =>
      await admin.saveLesson(user.id, {
        id: field(form, "id") ? idField(form) : undefined,
        courseId: idField(form, "courseId"),
        title: field(form, "title"),
        body: field(form, "body"),
        videoUrl: field(form, "videoUrl"),
        materialUrl: field(form, "materialUrl"),
        materialUploadIds: form.has("materialUploadIdsPresent")
          ? form.getAll("materialUploadIds").map(String)
          : undefined,
        position: Number(field(form, "position")),
      }),
  );
}
export async function deleteLessonAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/kurser",
    async () =>
      await admin.deleteLesson(
        user.id,
        idField(form),
        idField(form, "courseId"),
      ),
  );
}
export async function enrollStudentAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/elever",
    async () =>
      await admin.enrollStudent(
        user.id,
        idField(form, "courseId"),
        field(form, "email"),
      ),
  );
}
export async function removeEnrollmentAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await formAction(
    form,
    "/admin/elever",
    async () => await admin.removeEnrollment(user.id, idField(form)),
  );
}
export async function markLessonAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await formAction(
    form,
    "/elevportal",
    async () =>
      await admin.markLesson(
        user.id,
        idField(form, "lessonId"),
        field(form, "completed") === "on",
      ),
  );
}
export async function setupAction(form: FormData): Promise<void> {
  await formAction(form, "/setup", async () => {
    await requestLimit("setup", "first-admin", 5);
    if (await hasAdmin())
      throw new DomainError("Administrationen är redan konfigurerad.");
    const token = process.env.SETUP_TOKEN;
    if (
      !token ||
      token.length < 32 ||
      !equalSecret(field(form, "token"), token)
    )
      throw new DomainError("Konfigurationstoken är fel eller saknas.");
    const input = signupSchema.parse({
      name: field(form, "name"),
      email: field(form, "email"),
      password: field(form, "password"),
    });
    if (supabaseAuthRequested()) {
      const { registerSupabaseUser } = await import("./supabase-auth");
      const user = await registerSupabaseUser(input, "/admin", true);
      if (!user || user.role !== "admin") throw new DomainError("Administratören kunde inte skapas. Kontrollera om adressen redan används i Supabase.");
      return "/verifiera-epost?returnTo=%2Fadmin&message=" + encodeURIComponent("Administratören är förberedd. Bekräfta e-postadressen med Supabase-länken innan du loggar in.");
    }
    const user = await createFirstAdmin({
      name: input.name,
      email: input.email,
      passwordHash: hashPassword(input.password),
    });
    await createSession(user.id);
    return (
      "/admin?success=" + encodeURIComponent("Administratörskontot är skapat.")
    );
  });
}
