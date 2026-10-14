import { getCourse } from "./db";
import { safeAccountReturnTo } from "./account-return";

export const UNAVAILABLE_SELECTED_COURSE = "Kursen du valde är inte tillgänglig just nu. Ditt konto finns kvar. Välj en annan kurs eller kontakta oss för hjälp.";

export async function resolveAccountReturnTo(value: unknown, fallback = "/elevportal"): Promise<string> {
  const destination = safeAccountReturnTo(value, fallback);
  const path = new URL(destination, "https://account-return.invalid").pathname;
  const courseMatch = /^\/kurser\/([^/]+)\/?$/.exec(path);
  if (!courseMatch) return destination;
  const course = await getCourse(decodeURIComponent(courseMatch[1]), { publishedOnly: true });
  return course ? destination : `/kurser?message=${encodeURIComponent(UNAVAILABLE_SELECTED_COURSE)}`;
}
