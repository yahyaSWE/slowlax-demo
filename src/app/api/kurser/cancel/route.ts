import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enforceRequestLimit } from "@/lib/request-rate-limit";
import { assertCoursePurchaseOrigin, cancelCoursePurchaseCheckout, CoursePurchaseHttpError, coursePurchaseRequestJson, coursePurchaseResponseError } from "@/lib/course-purchase-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertCoursePurchaseOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new CoursePurchaseHttpError("Logga in för att avbryta betalningen.", 401);
    await enforceRequestLimit("course-purchase-cancel", String(user.id), 10, request.headers);
    const input = z.object({ courseId: z.number().int().positive() }).strict().safeParse(await coursePurchaseRequestJson(request));
    if (!input.success) throw new CoursePurchaseHttpError("Välj betalningen som ska avbrytas.", 400);
    await cancelCoursePurchaseCheckout(user.id, input.data.courseId);
    return Response.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return coursePurchaseResponseError(error); }
}
