import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { completeGroupUpload, getPendingGroupUpload, GROUP_PRIVATE_HEADERS, GROUP_UPLOAD_REQUEST_LIFETIME, groupUploadResponseError } from "@/lib/membership-uploads";
import { uploadAdmin, uploadJson } from "@/lib/upload-http";
import { UploadError } from "@/lib/uploads";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await uploadJson(request);
    if (body.type !== "blob.generate-presigned-url" && body.type !== "blob.upload-completed") throw new UploadError("Ogiltig uppladdningsbegäran.");
    // Completion is authenticated by the SDK's Ed25519 webhook signature. It
    // cannot carry a browser session or pass the browser-origin upload gate.
    const user = body.type === "blob.generate-presigned-url" ? await uploadAdmin(request) : null;
    const response = await handleUploadPresigned({
      body: body as unknown as HandleUploadPresignedBody,
      request,
      getSignedToken: async (pathname, payload, multipart) => {
        if (!user) throw new UploadError("Uppladdningen saknas.", 403);
        if (multipart) throw new UploadError("Filen får vara högst 20 MB.");
        let id: unknown;
        try { id = (JSON.parse(payload || "{}") as { id?: unknown }).id; }
        catch { throw new UploadError("Uppladdningen saknas."); }
        if (typeof id !== "string") throw new UploadError("Uppladdningen saknas.");
        const pending = await getPendingGroupUpload(user.id, id);
        if (pending.storageProvider !== "blob" || pathname !== pending.storagePath) throw new UploadError("Ogiltig uppladdningssökväg.");
        const validUntil = Math.min(Date.now() + 10 * 60 * 1000, Date.parse(pending.createdAt) + GROUP_UPLOAD_REQUEST_LIFETIME);
        return {
          token: await issueSignedToken({ pathname, operations: ["put"], validUntil, allowedContentTypes: [pending.contentType], maximumSizeInBytes: pending.size }),
          urlOptions: { access: "private", allowOverwrite: false, validUntil, contentType: pending.contentType, maximumSizeInBytes: pending.size, allowedContentTypes: [pending.contentType], callbackUrl: new URL("/api/gruppfiler/blob", request.url).href, tokenPayload: JSON.stringify({ id: pending.id, actorId: user.id, pathname: pending.storagePath }) },
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload: { id?: unknown; actorId?: unknown; pathname?: unknown };
        try { payload = JSON.parse(tokenPayload || "{}"); }
        catch { throw new UploadError("Ogiltig uppladdningsbekräftelse.", 403); }
        if (!payload || typeof payload.id !== "string" || typeof payload.actorId !== "number" || !Number.isSafeInteger(payload.actorId) || payload.actorId < 1 || typeof payload.pathname !== "string" || blob.pathname !== payload.pathname) throw new UploadError("Ogiltig uppladdningsbekräftelse.", 403);
        // Never fetch a callback URL: completion reads our saved private path,
        // rechecks the administrator and validates the actual object bytes.
        await completeGroupUpload(payload.actorId, payload.id);
      },
    });
    return Response.json(response, { headers: GROUP_PRIVATE_HEADERS });
  } catch (error) { return groupUploadResponseError(error); }
}
