import { dispatchKitNewsletterOutbox } from "@/lib/kit-newsletter";
import { equalSecret } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !equalSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    // A bounded batch stays within serverless execution time even when Kit
    // uses every request timeout. Subsequent scheduled calls drain the queue.
    const result = await dispatchKitNewsletterOutbox({ limit: 1 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Kön kunde inte behandlas." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const POST = GET;
