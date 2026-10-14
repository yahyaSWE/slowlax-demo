import type { Metadata } from "next";
import { databaseConfigured } from "./database-config";

export const SITE_NAME = "Tibb.nu";
export const PRACTITIONER_NAME = "Johan Yahya Blomdahl";
export const CITY = "Jönköping";
const FALLBACK_URL = "https://tibbnu.vercel.app";

function publicOrigin(value: string | undefined): URL | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const ipv4 = host.split(".").map(Number);
    const privateIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      (ipv4[0] === 10 || ipv4[0] === 127 || (ipv4[0] === 192 && ipv4[1] === 168) ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 169 && ipv4[1] === 254));
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/" ||
      host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host === "[::1]" ||
      host === "0.0.0.0" || privateIpv4 || /^\[(?:fc|fd|fe[89ab])/.test(host)
    ) return;
    return url;
  } catch { return; }
}

// SITE_URL is independent of APP_URL, which is also used by payment callbacks.
// Never use VERCEL_URL: a preview deployment must not become a canonical URL.
export function getSiteUrl(): URL {
  const preview = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development";
  return publicOrigin(process.env.SITE_URL) ||
    (!preview ? publicOrigin(process.env.APP_URL) : undefined) ||
    publicOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) ||
    new URL(FALLBACK_URL);
}

export function absoluteUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\?#]/.test(path)) {
    throw new Error("SEO URLs must be a local path without a query or fragment.");
  }
  return new URL(path, getSiteUrl()).href;
}

export function isIndexableDeployment(): boolean {
  if (!databaseConfigured() || process.env.NODE_ENV !== "production") return false;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  if (process.env.VERCEL) return false;
  // A local next start remains private, even if it uses the public canonical.
  if (process.env.APP_URL && !publicOrigin(process.env.APP_URL)) return false;
  return !!(publicOrigin(process.env.SITE_URL) || publicOrigin(process.env.APP_URL));
}

export const PRIVATE_METADATA: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export function seoDescription(text: string, fallback = SITE_NAME): string {
  const clean = (text || fallback).replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  const shortened = clean.slice(0, 177).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

export function createPageMetadata({ title, description, path, type = "website", publishedTime, modifiedTime }: {
  title: string; description: string; path: string;
  type?: "website" | "article"; publishedTime?: string; modifiedTime?: string;
}): Metadata {
  const url = absoluteUrl(path);
  const image = { url: absoluteUrl("/opengraph-image"), width: 1200, height: 630,
    alt: "Tibb.nu – traditionell kinesisk medicin i Jönköping" };
  const cleanDescription = description.replace(/\s+/g, " ").trim();
  return {
    title, description: cleanDescription,
    alternates: { canonical: url },
    robots: isIndexableDeployment()
      ? { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 }
      : PRIVATE_METADATA.robots,
    openGraph: {
      title, description: cleanDescription, url, siteName: SITE_NAME, locale: "sv_SE", type,
      images: [image],
      ...(type === "article" && publishedTime ? { publishedTime } : {}),
      ...(type === "article" && modifiedTime ? { modifiedTime } : {}),
    },
    twitter: { card: "summary_large_image", title, description: cleanDescription, images: [image] },
  };
}

export function toIsoDate(value: string): string | undefined {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value || "")?.[0];
  if (!day) return;
  const calendarDay = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(calendarDay.getTime()) || !calendarDay.toISOString().startsWith(day)) return;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function organizationId() { return `${absoluteUrl("/")}#organization`; }
export function websiteId() { return `${absoluteUrl("/")}#website`; }
export function practitionerId() { return `${absoluteUrl("/om")}#johan-yahya-blomdahl`; }

export function buildBreadcrumbSchema(items: { name: string; path: string }[]) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem",
      position: index + 1, name: item.name, item: absoluteUrl(item.path) })) };
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildOrganizationSchema(contact?: { email?: string; phone?: string; address?: string }) {
  return { "@context": "https://schema.org", "@type": "Organization",
    "@id": organizationId(), name: SITE_NAME, url: absoluteUrl("/"),
    description: "Klassisk kinesisk medicin i ljuset av den Profetiska vägledningen. Behandlingar i Jönköping, kurser och artiklar.",
    logo: absoluteUrl("/images/tibb-mark.svg"),
    location: { "@type": "Place", name: CITY,
      address: { "@type": "PostalAddress", addressLocality: CITY, addressCountry: "SE",
        ...(contact?.address ? { streetAddress: contact.address } : {}) } },
    ...(contact?.email ? { email: contact.email } : {}),
    ...(contact?.phone ? { telephone: contact.phone } : {}),
  };
}

export const PUBLIC_PAGES = [
  { path: "/", title: "Tibb.nu", description: "Traditionell kinesisk medicin i Jönköping, behandlingar, kurser och artiklar." },
  { path: "/boka", title: "Boka en behandling", description: "Välj behandling, behandlare, tillgängligt datum och tid. Se pris och längd innan du bokar." },
  { path: "/kurser", title: "Kurser", description: "Publicerade kurser inom traditionell medicin. Köp online när det erbjuds eller kontakta oss för anmälan och kursåtkomst." },
  { path: "/artiklar", title: "Artiklar", description: "Kunskap och reflektion om klassisk kinesisk medicin och profetisk vägledning." },
  { path: "/sjalvtest", title: "Självtest med fem faser", description: "Ett självtest för utbildning och självreflektion. Testet är inte en medicinsk diagnos." },
  { path: "/om", title: "Om Tibb.nu och Johan Yahya Blomdahl", description: "Behandlarens bakgrund, utbildningar och förhållningssätt i Jönköping." },
  { path: "/kontakt", title: "Kontakt", description: "Kontakta Tibb.nu om behandlingar i Jönköping och kursåtkomst." },
  { path: "/vanliga-fragor", title: "Vanliga frågor", description: "Svar om bokning, behandlare, priser, kursåtkomst och självtestet." },
  { path: "/integritet", title: "Integritet", description: "Information om hur personuppgifter hanteras på Tibb.nu." },
  { path: "/villkor", title: "Boknings- och kursvillkor", description: "Villkor för bokning, återbud, kursköp och kursåtkomst hos Tibb.nu." },
] as const;
