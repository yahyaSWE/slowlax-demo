import Stripe from "stripe";
import { DomainError } from "./db";
export function stripeReady() {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.APP_URL
  );
}
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new DomainError("Stripe är inte konfigurerat.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
export function appUrl() {
  const value = process.env.APP_URL;
  if (!value) throw new DomainError("APP_URL saknas på servern.");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new DomainError("APP_URL måste vara en giltig https-adress.");
  return url.origin;
}
