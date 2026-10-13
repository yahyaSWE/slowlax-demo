import { uploadPresigned } from "@vercel/blob/client";
import type { UploadedMaterial } from "./types";

const GROUP_FILE_URL = /^\/api\/gruppfiler\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function json(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error("Uppladdningen kunde inte slutföras. Försök igen."); }
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Uppladdningen kunde inte slutföras. Försök igen.");
  return body;
}
export async function uploadGroupFile(groupId: number, kind: "image" | "document", file: File, signal: AbortSignal, onProgress?: (percentage: number) => void): Promise<UploadedMaterial> {
  const prepared = await json(await fetch("/api/gruppfiler", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, kind, filename: file.name, size: file.size }), signal }));
  if (typeof prepared.id !== "string" || typeof prepared.pathname !== "string" || typeof prepared.contentType !== "string" || !["blob", "local"].includes(String(prepared.provider))) throw new Error("Uppladdningen saknar giltiga uppgifter.");
  if (prepared.provider === "blob") await uploadPresigned(prepared.pathname, file, {
    access: "private", contentType: prepared.contentType, handleUploadUrl: "/api/gruppfiler/blob",
    clientPayload: JSON.stringify({ id: prepared.id }), abortSignal: signal,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage),
  });
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(`/api/gruppfiler/${prepared.id}/complete`, prepared.provider === "local"
      ? { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal }
      : { method: "POST", signal });
    // A signed Blob callback may be verifying the same object concurrently.
    if (response.status !== 409 || attempt >= 3) break;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 300 * (attempt + 1));
      function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Uppladdningen avbröts.", "AbortError")); }
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }
  const result = await json(response);
  if (typeof result.id !== "string" || result.id !== prepared.id || typeof result.url !== "string" || !GROUP_FILE_URL.test(result.url) || typeof result.name !== "string" || typeof result.contentType !== "string" || typeof result.size !== "number" || !Number.isSafeInteger(result.size) || result.size < 1) throw new Error("Uppladdningen saknar en giltig filreferens.");
  return result as UploadedMaterial;
}
