import { getCurrentUser } from "@/lib/auth";
import { getReadableGroupUpload, openGroupUpload, GROUP_PRIVATE_HEADERS, groupUploadResponseError } from "@/lib/membership-uploads";
import { UploadError } from "@/lib/uploads";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const upload = await getReadableGroupUpload(id, await getCurrentUser());
    if (!upload) throw new UploadError("Filen finns inte eller du saknar åtkomst.", 404);
    const response = await openGroupUpload(upload);
    for (const [key, value] of Object.entries(GROUP_PRIVATE_HEADERS)) response.headers.set(key, value);
    response.headers.set("Content-Type", upload.contentType);
    response.headers.set("Content-Length", String(upload.size));
    const filename = encodeURIComponent(upload.filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.headers.set("Content-Disposition", `${upload.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${filename}`);
    response.headers.set("Content-Security-Policy", "sandbox");
    return response;
  } catch (error) { return groupUploadResponseError(error); }
}
