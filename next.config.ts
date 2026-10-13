import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: process.env.VERCEL ? undefined : "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      ...["/admin/:path*", "/elevportal/:path*", "/bokning/:path*", "/bestallning/:path*", "/butik/kassa", "/butik/varukorg", "/medlemskap/bekraftelse", "/logga-in", "/registrera", "/verifiera-epost", "/glomt-losenord", "/aterstall-losenord", "/setup", "/installation", "/api/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      })),
      ...["/verifiera-epost", "/aterstall-losenord", "/bokning/:path*", "/bestallning/:path*"].map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
      ...(process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development" ? [{
        source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      }] : []),
    ];
  },
};
export default nextConfig;
