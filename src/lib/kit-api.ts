import "server-only";
import { z } from "zod";

const BASE_URL = "https://api.kit.com/v4";
const subscriberSchema = z.object({
  id: z.number().int().positive().safe(),
  state: z.enum(["active", "inactive", "cancelled", "bounced", "complained"]),
  email_address: z.email(),
});
export type KitSubscriber = z.infer<typeof subscriberSchema>;

export class KitApiError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); }
}

// Keep errors deliberately independent of the remote response body: it may
// contain private subscriber data or echo credentials supplied by a proxy.
async function request(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}) {
  const key = process.env.KIT_API_KEY?.trim();
  if (!key) throw new KitApiError("KIT_API_KEY saknas i serverns miljövariabler.", false);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: { "X-Kit-Api-Key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      redirect: "error",
    });
  } catch { throw new KitApiError("Kit kunde inte nås. Ett nytt försök görs senare.", true); }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500 || response.status === 408;
    throw new KitApiError(`Kit svarade med HTTP ${response.status}. ${retryable ? "Ett nytt försök görs senare." : "Kontrollera nyckel, formulär och eventuell tagg i Kit."}`, retryable);
  }
  try { return await response.json() as unknown; }
  catch { throw new KitApiError("Kit returnerade ett oväntat svar. Ett nytt försök görs senare.", true); }
}

function parseSubscriber(body: unknown, email: string): KitSubscriber {
  const result = z.object({ subscriber: subscriberSchema }).safeParse(body);
  if (!result.success || result.data.subscriber.email_address.toLowerCase() !== email.toLowerCase())
    throw new KitApiError("Kit returnerade ett oväntat prenumerantsvar. Kontrollera integrationen.", false);
  return result.data.subscriber;
}

export async function findOrCreateKitSubscriber(email: string, name: string): Promise<KitSubscriber> {
  const query = new URLSearchParams({ email_address: email, status: "all", per_page: "1" });
  const found = z.object({ subscribers: z.array(subscriberSchema).max(1) }).safeParse(await request(`/subscribers?${query}`));
  if (!found.success) throw new KitApiError("Kit returnerade ett oväntat prenumerantsvar. Kontrollera integrationen.", false);
  if (found.data.subscribers.length) {
    const subscriber = found.data.subscribers[0];
    if (subscriber.email_address.toLowerCase() !== email.toLowerCase())
      throw new KitApiError("Kit returnerade en annan e-postadress. Kontrollera integrationen.", false);
    // Kit list/search results may lag by several minutes after cancellation.
    // The ID lookup is strongly consistent, so check that authoritative state
    // before making any form/tag change to an existing subscriber.
    return parseSubscriber(await request(`/subscribers/${subscriber.id}`), email);
  }
  // The API defaults to active. Always opt out of that default so the Kit
  // form's confirmation flow, rather than account creation, activates email.
  return parseSubscriber(await request("/subscribers", { method: "POST", body: {
    email_address: email, first_name: name.trim().split(/\s+/)[0]?.slice(0, 150) || null, state: "inactive",
  } }), email);
}

function identifier(value: string) {
  if (!/^[1-9]\d{0,14}$/.test(value)) throw new KitApiError("Ogiltigt ID för Kit.", false);
  return value;
}

export async function addKitSubscriberToForm(subscriber: KitSubscriber, formId: string) {
  return parseSubscriber(await request(`/forms/${identifier(formId)}/subscribers/${subscriber.id}`, {
    method: "POST", body: { referrer: "https://slowlax.se/registrera" },
  }), subscriber.email_address);
}

export async function tagKitSubscriber(subscriber: KitSubscriber, tagId: string) {
  return parseSubscriber(await request(`/tags/${identifier(tagId)}/subscribers/${subscriber.id}`, { method: "POST", body: {} }), subscriber.email_address);
}
