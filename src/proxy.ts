import { NextRequest, NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/database-config";
import { supabaseAuthRequested, supabaseAuthConfigurationStatus } from "@/lib/supabase-auth-config";
import { refreshSupabaseSession } from "@/lib/supabase-proxy";
import { DEMO_MODE, demoPublicPath } from "@/lib/demo-mode";

export async function proxy(request: NextRequest) {
  if (DEMO_MODE) {
    const headers = { "X-Robots-Tag": "noindex, nofollow, noarchive" };
    if (!["GET", "HEAD"].includes(request.method))
      return new NextResponse(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
    if (!demoPublicPath(request.nextUrl.pathname))
      return new NextResponse(null, { status: 404, headers });
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", headers["X-Robots-Tag"]);
    return response;
  }
  const needsDatabase = !!process.env.VERCEL && !databaseConfigured();
  const path = request.nextUrl.pathname;
  // Removed features stay unavailable during installation as well as normal use.
  const removedRoutes = ["/boka", "/bokning", "/butik", "/bestallning", "/api/shop", "/api/stripe", "/api/email/outbox", "/admin/bokningar", "/admin/behandlingar", "/admin/behandlare", "/admin/tider", "/admin/butik", "/admin/produkter", "/admin/rabatter", "/admin/frakt", "/admin/bestallningar"];
  if (removedRoutes.some(route => path === route || path.startsWith(`${route}/`)))
    return new NextResponse(null, { status: 404 });
  // Discovery routes must return their own robots/XML/text responses even
  // during installation, instead of a successful HTML rewrite.
  if (!needsDatabase || ["/installation", "/robots.txt", "/sitemap.xml", "/llms.txt", "/opengraph-image"].includes(path))
    {
      if (!supabaseAuthRequested() || ["/robots.txt", "/sitemap.xml", "/llms.txt", "/opengraph-image", "/installation"].includes(path) || path.startsWith("/api/cron/") || path.endsWith("/webhook")) return NextResponse.next();
      if (!supabaseAuthConfigurationStatus().configured)
        return new NextResponse("Supabase-inloggningen är inte färdigkonfigurerad. Kontakta den som ansvarar för driften.", { status: 503, headers: { "Cache-Control": "no-store" } });
      return refreshSupabaseSession(request);
    }
  if (
    request.nextUrl.pathname.startsWith("/api/") ||
    request.method !== "GET"
  ) {
    return NextResponse.json(
      { error: "Tjänsten förbereds. Försök igen senare." },
      { status: 503 },
    );
  }
  const destination = request.nextUrl.clone();
  destination.pathname = "/installation";
  return NextResponse.rewrite(destination, { status: 503 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|images/).*)"],
};
