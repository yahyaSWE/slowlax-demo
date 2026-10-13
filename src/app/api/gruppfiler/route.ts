import { prepareGroupUpload, GROUP_PRIVATE_HEADERS, groupUploadResponseError, type GroupUploadKind } from "@/lib/membership-uploads";
import { uploadAdmin, uploadJson } from "@/lib/upload-http";
import { UploadError } from "@/lib/uploads";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await uploadAdmin(request);
    const input = await uploadJson(request);
    if (typeof input.filename !== "string" || typeof input.size !== "number" || typeof input.groupId !== "number") throw new UploadError("Välj en fil och en grupp att ladda upp till.");
    const prepared = await prepareGroupUpload(user.id, { groupId: input.groupId, kind: input.kind as GroupUploadKind, filename: input.filename, size: input.size });
    return Response.json(prepared, { headers: GROUP_PRIVATE_HEADERS });
  } catch (error) { return groupUploadResponseError(error); }
}
