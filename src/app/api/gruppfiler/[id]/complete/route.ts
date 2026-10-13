import { completeGroupUpload, getPendingGroupUpload, GROUP_PRIVATE_HEADERS, groupUploadResponseError } from "@/lib/membership-uploads";
import { uploadAdmin } from "@/lib/upload-http";
import { readLimitedStream, UploadError } from "@/lib/uploads";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await uploadAdmin(request);
    const { id } = await params;
    let bytes: Buffer | undefined;
    if (request.headers.get("content-type") === "application/octet-stream") {
      const pending = await getPendingGroupUpload(user.id, id);
      if (pending.storageProvider !== "local" || process.env.VERCEL) throw new UploadError("Den här uppladdningen stöds inte.");
      if (!request.body) throw new UploadError("Filens innehåll saknas.");
      bytes = await readLimitedStream(request.body, pending.size);
    }
    return Response.json(await completeGroupUpload(user.id, id, bytes), { headers: GROUP_PRIVATE_HEADERS });
  } catch (error) { return groupUploadResponseError(error); }
}
