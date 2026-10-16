import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enforceRequestLimit } from "@/lib/request-rate-limit";
import { assertCoursePurchaseOrigin, createCoursePurchaseCheckout, CoursePurchaseHttpError, coursePurchaseRequestJson, coursePurchaseResponseError } from "@/lib/course-purchase-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ courseId: z.number().int().positive(), consent: z.literal(true),
  courseRevision: z.string().min(1).max(100), settingsRevision: z.string().min(1).max(100), termsRevision: z.string().min(1).max(100), purificationRevision:z.iso.datetime().nullable().optional() }).strict();
export async function POST(request: Request) {
  try {
    assertCoursePurchaseOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new CoursePurchaseHttpError("Logga in för att köpa kursen.", 401);
    await enforceRequestLimit("course-purchase-checkout", String(user.id), 10, request.headers);
    const input = inputSchema.safeParse(await coursePurchaseRequestJson(request));
    if (!input.success) throw new CoursePurchaseHttpError("Kontrollera kursen och godkänn villkoren.", 400);
    const url = await createCoursePurchaseCheckout(user.id, input.data.courseId, input.data);
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return coursePurchaseResponseError(error); }
}
