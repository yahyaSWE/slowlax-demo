import type { Metadata, Viewport } from "next";
import { Poppins, Inter } from "next/font/google";
import { SiteChrome } from "@/components/site-chrome";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/business-config";
import { getCurrentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/database-config";
import { createPageMetadata, getSiteUrl } from "@/lib/seo";
import "./globals.css";
import "@/components/learning/learning.css";
import "./public-theme.css";
import "./slowlax-theme.css";

const serif = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  ...createPageMetadata({
    title: "Slowlax", path: "/",
    description: "Investera i aktier utan att kompromissa med dina värderingar. Kurser, kunskap och gemenskap inom etiska och halalinvesteringar.",
  }),
  metadataBase: getSiteUrl(),
  // Canonicals belong to individual pages; private routes must not inherit '/'.
  alternates: { canonical: null },
  title: {
    default: "Slowlax | Etiska och halalinvesteringar",
    template: "%s | Slowlax",
  },
  icons: { icon: "/favicon.svg" },
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const needsDatabase = !!process.env.VERCEL && !databaseConfigured();
  const [settings, user, business] = needsDatabase
    ? [{ siteName: "Slowlax", email: "info@slowlax.se" }, null, DEFAULT_BUSINESS_SETTINGS]
    : await Promise.all([getSiteSettings(), getCurrentUser(), getBusinessSettings()]);
  return (
    <html lang="sv" data-scroll-behavior="smooth">
      <body className={`${serif.variable} ${sans.variable}`}>
        <SiteChrome
          siteName={settings.siteName || "Slowlax"}
          contactEmail={settings.email || ""}
          legalName={business.legalName}
          organizationNumber={business.organizationNumber}
          user={user ? { name: user.name, role: user.role } : null}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
