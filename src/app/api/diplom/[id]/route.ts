import { getCurrentUser } from "@/lib/auth";
import { getCourseCertificateForDownload } from "@/lib/course-certificates";
import { createCourseDiplomaPdf } from "@/lib/course-diploma-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Logga in för att hämta ditt diplom." }, { status: 401, headers: privateHeaders });
    const { id } = await params;
    if (!/^[a-f0-9]{32}$/.test(id)) return Response.json({ error: "Diplomet finns inte." }, { status: 404, headers: privateHeaders });
    const certificate = await getCourseCertificateForDownload(user.id, id);
    if (!certificate) return Response.json({ error: "Diplomet finns inte." }, { status: 404, headers: privateHeaders });
    const bytes = await createCourseDiplomaPdf(certificate);
    return new Response(new Uint8Array(bytes).buffer, { headers: { ...privateHeaders, "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength), "Content-Disposition": `attachment; filename="slowlax-diplom-${certificate.id}.pdf"`, "Content-Security-Policy": "sandbox" } });
  } catch {
    return Response.json({ error: "Diplomet kunde inte hämtas just nu. Försök igen eller kontakta oss för hjälp." }, { status: 500, headers: privateHeaders });
  }
}
