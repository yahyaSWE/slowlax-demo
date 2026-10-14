import { NextResponse } from "next/server";
import {
  completeStripeBooking,
  expireStripeSession,
  refundStripeBooking,
  getBookingByReference,
  getDb,
} from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { dispatchBookingEmailOutbox } from "@/lib/email-outbox";
import { CoursePurchaseHttpError, readCoursePurchaseBody, reconcileCoursePurchaseEvent } from "@/lib/course-purchase-billing";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature || signature.length > 4096)
    return NextResponse.json(
      { error: "Webhook not configured or signature missing" },
      { status: 400 },
    );
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await readCoursePurchaseBody(request, 1024 * 1024),
      signature,
      secret,
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoursePurchaseHttpError ? "Request too large" : "Invalid signature" },
      { status: error instanceof CoursePurchaseHttpError ? error.status : 400 });
  }
  try {
    if (await reconcileCoursePurchaseEvent(event, stripe)) return NextResponse.json({ received: true });
    // Membership and shop sessions carry the same application label. Their
    // dedicated webhooks own them; they must not enter booking fulfillment.
    const objectMetadata = "metadata" in event.data.object ? event.data.object.metadata : null;
    if (objectMetadata?.integration && objectMetadata.integration !== "booking") return NextResponse.json({ received: true });
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;
      const reference = session.metadata?.booking_reference;
      // Sessions from other applications on the same Stripe account belong to
      // their own integration. Our missing DB attachment must still retry.
      const ownSession = await getDb().prepare("SELECT id FROM bookings WHERE checkout_session_id=?").get(session.id);
      const ownMetadata = session.metadata?.application === "tibb.nu" ||
        (reference && /^[a-f0-9]{32}$/.test(reference) && session.client_reference_id === reference);
      if (!ownSession && !ownMetadata) return NextResponse.json({ received: true });
      if (
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required"
      ) {
        const outcome = await completeStripeBooking(
          session.id,
          session.amount_total ?? -1,
          session.currency ?? "",
        );
        if (outcome === "confirmed" || outcome === "already-paid") {
          const booking = ownSession ? { id: Number(ownSession.id) } : reference ? await getBookingByReference(reference) : undefined;
          if (booking) await dispatchBookingEmailOutbox({ bookingId: booking.id, limit: 2 });
        }
        if (outcome === "needs-refund") {
          if (session.amount_total === 0) await refundStripeBooking(session.id);
          else {
            const intent =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id;
            if (!intent)
              throw new Error(
                "Expired paid session is missing its PaymentIntent",
              );
            const initial = await stripe.refunds.create(
              { payment_intent: intent },
              { idempotencyKey: `expired-booking-refund-${session.id}` },
            );
            const refund = await stripe.refunds.retrieve(initial.id);
            // Pending or failed refunds must never appear completed locally.
            // Stripe retries this webhook; charge.refunded also finalizes it.
            if (refund.status !== "succeeded")
              throw new Error("Expired booking refund is not yet complete");
            await refundStripeBooking(session.id);
          }
        }
      }
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await expireStripeSession(event.data.object.id);
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object;
      if (charge.refunded && charge.payment_intent) {
        const sessions = await stripe.checkout.sessions.list({
          payment_intent:
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : charge.payment_intent.id,
          limit: 1,
        });
        if (sessions.data[0]) await refundStripeBooking(sessions.data[0].id);
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(
      "Stripe webhook handling failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return NextResponse.json(
      { error: "Unable to process event" },
      { status: 500 },
    );
  }
}
