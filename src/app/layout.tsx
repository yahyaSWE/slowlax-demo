import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { SiteChrome } from "@/components/site-chrome";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/business-config";
import { getShopSettings } from "@/lib/shop";
import { getMembershipSettings } from "@/lib/memberships";
import { getCurrentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/database-config";
import { createPageMetadata, getSiteUrl } from "@/lib/seo";
import "./globals.css";
import "@/components/learning/learning.css";
import "./public-theme.css";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  ...createPageMetadata({
    title: "Tibb.nu", path: "/",
    description: "Klassisk kinesisk medicin i ljuset av den Profetiska vägledningen. Behandlingar i Jönköping, kurser och artiklar hos Tibb.nu.",
  }),
  metadataBase: getSiteUrl(),
  // Canonicals belong to individual pages; private routes must not inherit '/'.
  alternates: { canonical: null },
  title: {
    default: "Tibb.nu | Traditionell kinesisk medicin i Jönköping",
    template: "%s | Tibb.nu",
  },
  icons: { icon: "/favicon.svg" },
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = { themeColor: "#35584c", width: "device-width", initialScale: 1 };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const needsDatabase = !!process.env.VERCEL && !databaseConfigured();
  const [settings, user, business, shop, membership] = needsDatabase
    ? [{ siteName: "Tibb.nu", email: "" }, null, DEFAULT_BUSINESS_SETTINGS, { enabled: false }, { salesEnabled: false }]
    : await Promise.all([getSiteSettings(), getCurrentUser(), getBusinessSettings(), getShopSettings(), getMembershipSettings()]);
  return (
    <html lang="sv" data-scroll-behavior="smooth">
      <body className={`${serif.variable} ${sans.variable}`}>
        <SiteChrome
          siteName={settings.siteName || "Tibb.nu"}
          contactEmail={settings.email || ""}
          legalName={business.legalName}
          organizationNumber={business.organizationNumber}
          shopEnabled={shop.enabled}
          membershipEnabled={membership.salesEnabled}
          user={user ? { name: user.name, role: user.role } : null}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
