import { getStripe } from '@/lib/stripe';
import { PurificationPurchaseHttpError, readPurificationPurchaseBody, reconcilePurificationPurchaseEvent } from '@/lib/purification-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.RENING_STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get('stripe-signature');
  if (!secret || !signature || signature.length > 4096)
    return Response.json({ error: 'Webhook not configured or signature missing' }, { status: 400 });
  let event;
  try {
    event = getStripe().webhooks.constructEvent(await readPurificationPurchaseBody(request, 1024 * 1024), signature, secret);
  } catch (error) {
    return Response.json({ error: 'Invalid signature or body' }, { status: error instanceof PurificationPurchaseHttpError ? error.status : 400 });
  }
  try {
    await reconcilePurificationPurchaseEvent(event);
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: 'Unable to verify payment' }, { status: 500 });
  }
}
