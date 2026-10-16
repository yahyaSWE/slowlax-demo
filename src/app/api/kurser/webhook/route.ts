import { getStripe } from "@/lib/stripe";
import { CoursePurchaseHttpError, readCoursePurchaseBody, reconcileCoursePurchaseEvent } from "@/lib/course-purchase-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature || signature.length > 4096)
    return Response.json({ error: "Webhook not configured or signature missing" }, { status: 400 });
  let event;
  try {
    event = getStripe().webhooks.constructEvent(await readCoursePurchaseBody(request, 1024 * 1024), signature, secret);
  } catch (error) {
    return Response.json({ error: error instanceof CoursePurchaseHttpError ? "Request too large" : "Invalid signature" },
      { status: error instanceof CoursePurchaseHttpError ? error.status : 400 });
  }
  try {
    await reconcileCoursePurchaseEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Course purchase webhook handling failed", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to process event" }, { status: 500 });
  }
}
