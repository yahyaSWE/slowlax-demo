import type { MetadataRoute } from "next";
import { databaseConfigured } from "@/lib/database-config";
import { absoluteUrl, isIndexableDeployment } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment() || !databaseConfigured()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const privatePaths = [
    "/admin",
    "/elevportal",
    "/api/",
    "/bokning",
    "/bestallning",
    "/kurskop",
    "/butik/kassa",
    "/butik/varukorg",
    "/medlemskap/bekraftelse",
    "/*?*",
  ];

  // Public login/setup forms remain crawlable so engines can read their
  // noindex metadata and HTTP headers. Authenticated content is excluded.

  // Specific crawler groups replace the wildcard group. Keep the same private
  // exclusions in every group, including the search-specific AI crawlers.
  return {
    rules: ["*", "OAI-SearchBot", "PerplexityBot"].map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: [...privatePaths],
    })),
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
