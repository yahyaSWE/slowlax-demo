import type Stripe from "stripe";

/** Shared strict verification for course and Rening one-time payments. */
export class OneTimePaymentVerificationError extends Error {}
export const ONE_TIME_STRIPE_OPTIONS = { timeout: 10000, maxNetworkRetries: 1 };
export type OneTimePaymentContract = {
  id: string; customerId: string; sessionId: string | null; taxRateId: string;
  amountOre: number; vatPercent: number; createdAt: string; metadata: Record<string, string>;
};
const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;

export function assertOneTimeMetadata(value: Stripe.Metadata | null | undefined, expected: Record<string, string>) {
  if (Object.entries(expected).some(([key, expectedValue]) => value?.[key] !== expectedValue))
    throw new OneTimePaymentVerificationError("Payment ownership metadata mismatch");
}
export function assertOneTimeTaxRate(rate: Stripe.TaxRate, contract: OneTimePaymentContract, newCheckout = false) {
  if (rate.id !== contract.taxRateId || rate.percentage !== contract.vatPercent || !rate.inclusive ||
      rate.country !== "SE" || rate.tax_type !== "vat" || (newCheckout && !rate.active))
    throw new OneTimePaymentVerificationError("Payment VAT rate mismatch");
  assertOneTimeMetadata(rate.metadata, contract.metadata);
}
export function assertOneTimeCheckout(session: Stripe.Checkout.Session, contract: OneTimePaymentContract) {
  assertOneTimeMetadata(session.metadata, contract.metadata);
  const line = session.line_items?.data[0];
  const taxAmount = Math.round(contract.amountOre * contract.vatPercent / (100 + contract.vatPercent));
  if (session.mode !== "payment" || session.client_reference_id !== contract.id || identifier(session.customer) !== contract.customerId ||
      (contract.sessionId && session.id !== contract.sessionId) || session.currency !== "sek" || session.amount_total !== contract.amountOre ||
      session.automatic_tax?.enabled || session.allow_promotion_codes || session.total_details?.amount_discount || session.total_details?.amount_shipping ||
      !line || session.line_items?.has_more || session.line_items?.data.length !== 1 || line.quantity !== 1 ||
      line.amount_total !== contract.amountOre || line.amount_discount !== 0 || !line.price || line.price.currency !== "sek" ||
      line.price.unit_amount !== contract.amountOre || line.price.tax_behavior !== "inclusive" || line.price.recurring ||
      line.amount_tax !== taxAmount || session.total_details?.amount_tax !== taxAmount ||
      (taxAmount > 0 && line.taxes?.length !== 1) || (line.taxes?.length ?? 0) > 1)
    throw new OneTimePaymentVerificationError("Payment checkout contract mismatch");
  for (const tax of line.taxes ?? []) {
    if (tax.amount !== taxAmount || tax.taxability_reason === "customer_exempt" || tax.taxability_reason === "reverse_charge")
      throw new OneTimePaymentVerificationError("Payment checkout VAT amount mismatch");
    assertOneTimeTaxRate(tax.rate, contract);
  }
}
export async function verifyOneTimePayment(session: Stripe.Checkout.Session, contract: OneTimePaymentContract, stripe: Stripe) {
  if (session.status !== "complete" || session.payment_status !== "paid") return null;
  const intentId = identifier(session.payment_intent);
  if (!intentId) throw new OneTimePaymentVerificationError("Paid checkout has no PaymentIntent");
  const intent = await stripe.paymentIntents.retrieve(intentId, {}, ONE_TIME_STRIPE_OPTIONS);
  assertOneTimeMetadata(intent.metadata, contract.metadata);
  if (intent.id !== intentId || intent.status !== "succeeded" || intent.currency !== "sek" || intent.amount !== contract.amountOre ||
      intent.amount_received !== contract.amountOre || identifier(intent.customer) !== contract.customerId)
    throw new OneTimePaymentVerificationError("PaymentIntent does not match accepted contract");
  const chargeId = identifier(intent.latest_charge);
  if (!chargeId) throw new OneTimePaymentVerificationError("PaymentIntent has no successful charge");
  const charge = await stripe.charges.retrieve(chargeId, {}, ONE_TIME_STRIPE_OPTIONS);
  assertOneTimeMetadata(charge.metadata, contract.metadata);
  if (charge.id !== chargeId || identifier(charge.payment_intent) !== intent.id || charge.status !== "succeeded" || !charge.paid || !charge.captured ||
      charge.currency !== "sek" || charge.amount !== contract.amountOre || charge.amount_captured !== contract.amountOre ||
      identifier(charge.customer) !== contract.customerId || !Number.isSafeInteger(charge.created) ||
      charge.created > Math.floor(Date.now() / 1000) + 300 || charge.created < Math.floor(Date.parse(contract.createdAt) / 1000) - 300)
    throw new OneTimePaymentVerificationError("Charge does not match accepted contract");
  return { intentId, chargeId, paidAt: new Date(charge.created * 1000).toISOString(),
    blocked: charge.refunded || charge.amount_refunded >= charge.amount || charge.disputed };
}
export function oneTimeCheckoutRedirect(value: string | null) {
  if (!value) throw new Error("Stripe redirect is missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || url.username || url.password)
    throw new Error("Stripe redirect is invalid");
  return value;
}
