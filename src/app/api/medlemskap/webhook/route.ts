import { getStripe } from "@/lib/stripe";
import { MembershipHttpError, readMembershipBody, reconcileMembershipEvent } from "@/lib/membership-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature || signature.length > 4096)
    return Response.json({ error: "Webhook not configured or signature missing" }, { status: 400 });
  let event;
  try {
    const raw = await readMembershipBody(request, 1024 * 1024);
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (error) {
    return Response.json({ error: error instanceof MembershipHttpError ? "Request too large" : "Invalid signature" },
      { status: error instanceof MembershipHttpError ? error.status : 400 });
  }
  try {
    await reconcileMembershipEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Membership webhook handling failed", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to process event" }, { status: 500 });
  }
}
