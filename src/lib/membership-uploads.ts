import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import sharp from "sharp";
import { get as getBlob, put as putBlob, del as deleteBlob } from "@vercel/blob";
import { assertAdmin } from "./admin";
import { getDb, transaction } from "./db";
import { membershipGroupAccessSql } from "./membership-access";
import { blobConfigured, readLimitedStream, UploadError, validateUploadBytes } from "./uploads";
import { UPLOAD_ID, UPLOAD_LIMITS, uploadContentType } from "./upload-rules";
import { uploadResponseError } from "./upload-http";
import type { UploadedMaterial, User } from "./types";

export type GroupUploadKind = "image" | "document";
export type GroupUploadRecord = {
  id: string;
  groupId: number;
  kind: GroupUploadKind;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  storageProvider: "local" | "blob";
  uploaderId: number;
  createdAt: string;
};
export const GROUP_UPLOAD_REQUEST_LIFETIME = 15 * 60 * 1000;
export const GROUP_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function groupUploadResponseError(error: unknown) {
  const response = uploadResponseError(error);
  for (const [key, value] of Object.entries(GROUP_PRIVATE_HEADERS)) response.headers.set(key, value);
  return response;
}

function record(row: Record<string, unknown>): GroupUploadRecord {
  return {
    id: String(row.id), groupId: Number(row.group_id),
    kind: String(row.kind) as GroupUploadKind, filename: String(row.filename),
    contentType: String(row.content_type), size: Number(row.size),
    storagePath: String(row.storage_path), storageProvider: String(row.storage_provider) as "local" | "blob",
    uploaderId: Number(row.uploader_id), createdAt: String(row.created_at),
  };
}
export function groupUploadMetadata(upload: GroupUploadRecord): UploadedMaterial {
  return { id: upload.id, name: upload.filename, contentType: upload.contentType, size: upload.size, url: `/api/gruppfiler/${upload.id}` };
}
function localFile(path: string) {
  const root = resolve(/* turbopackIgnore: true */ process.env.TIBB_UPLOAD_DIR || resolve(process.cwd(), "data/uploads"));
  const result = resolve(root, path);
  if (!result.startsWith(root + sep) || !/^tibb\/group-material\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(-image)?\.(jpg|jpeg|png|webp|pdf|doc|docx)$/.test(path))
    throw new UploadError("Ogiltig filsökväg.");
  return result;
}
export async function getGroupUpload(id: string): Promise<GroupUploadRecord | null> {
  if (!UPLOAD_ID.test(id)) return null;
  const row = await getDb().prepare("SELECT * FROM membership_uploads WHERE id=?").get(id.toLowerCase());
  return row ? record(row) : null;
}
export async function prepareGroupUpload(actorId: number, input: { groupId: number; kind: GroupUploadKind; filename: string; size: number }) {
  await assertAdmin(actorId);
  if (input.kind !== "image" && input.kind !== "document") throw new UploadError("Välj en bild eller ett dokument.");
  if (!Number.isSafeInteger(input.groupId) || input.groupId < 1) throw new UploadError("Gruppen finns inte.");
  const filename = input.filename.normalize("NFC").trim();
  if (!filename || filename.length > 200 || /[\x00-\x1f\x7f/\\]/.test(filename)) throw new UploadError("Filnamnet är ogiltigt eller för långt.");
  const mappedKind = input.kind === "image" ? "practitioner-photo" : "lesson-material";
  const contentType = uploadContentType(mappedKind, filename);
  if (!contentType) throw new UploadError(input.kind === "image" ? "Välj en JPG-, PNG- eller WebP-bild." : "Välj en PDF- eller Word-fil (.doc eller .docx).");
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > UPLOAD_LIMITS[mappedKind]) throw new UploadError(input.kind === "image" ? "Bilden får vara högst 2 MB." : "Varje fil får vara högst 20 MB.");
  const provider = blobConfigured() ? "blob" : "local";
  if (provider === "local" && process.env.VERCEL) throw new UploadError("Fillagring saknas. Anslut en privat Vercel Blob-lagring under projektets Storage och publicera igen.", 503);
  const id = randomUUID();
  const pathname = `tibb/group-material/${id}.${filename.split(".").at(-1)!.toLowerCase()}`;
  await transaction(async () => {
    await assertAdmin(actorId);
    if (!(await getDb().prepare("SELECT id FROM membership_groups WHERE id=?").get(input.groupId))) throw new UploadError("Gruppen finns inte.");
    const pending = await getDb().prepare("SELECT COUNT(*) AS total FROM membership_upload_requests WHERE uploader_id=? AND created_at>?").get(actorId, new Date(Date.now() - GROUP_UPLOAD_REQUEST_LIFETIME).toISOString());
    if (Number(pending?.total || 0) >= 40) throw new UploadError("För många pågående uppladdningar. Vänta en stund och försök igen.", 429);
    await getDb().prepare("INSERT INTO membership_upload_requests(id,group_id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, input.groupId, input.kind, filename, contentType, input.size, pathname, provider, actorId, new Date().toISOString());
  });
  return { id, pathname, provider, contentType };
}
export async function getPendingGroupUpload(actorId: number, id: string): Promise<GroupUploadRecord> {
  await assertAdmin(actorId);
  if (!UPLOAD_ID.test(id)) throw new UploadError("Uppladdningen finns inte.", 404);
  const row = await getDb().prepare("SELECT r.* FROM membership_upload_requests r JOIN membership_groups g ON g.id=r.group_id WHERE r.id=? AND r.uploader_id=? AND r.created_at>?").get(id.toLowerCase(), actorId, new Date(Date.now() - GROUP_UPLOAD_REQUEST_LIFETIME).toISOString());
  if (!row) throw new UploadError("Uppladdningen saknas eller har löpt ut. Välj filen igen.", 404);
  return record(row);
}
export async function validateGroupUploadBytes(upload: GroupUploadRecord, bytes: Buffer): Promise<Buffer> {
  if (upload.kind === "document") return validateUploadBytes({ ...upload, kind: "lesson-material", courseId: null }, bytes);
  if (bytes.length !== upload.size || !bytes.length || bytes.length > UPLOAD_LIMITS["practitioner-photo"]) throw new UploadError("Filens storlek stämmer inte. Välj filen och ladda upp igen.");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, animated: false }).metadata();
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[upload.contentType];
    if (!expected || metadata.format !== expected || (metadata.pages ?? 1) > 1) throw new Error("format");
    const stored = await sharp(bytes, { limitInputPixels: 40_000_000, animated: false }).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (!stored.length || stored.length > UPLOAD_LIMITS["practitioner-photo"]) throw new Error("size");
    return stored;
  } catch { throw new UploadError("Bilden kunde inte läsas. Välj en giltig JPG-, PNG- eller WebP-bild."); }
}
export async function completeGroupUpload(actorId: number, id: string, localBytes?: Buffer): Promise<UploadedMaterial> {
  await assertAdmin(actorId);
  const ready = await getGroupUpload(id);
  if (ready && ready.uploaderId === actorId) return groupUploadMetadata(ready);
  const pending = await getPendingGroupUpload(actorId, id);
  const claim = await getDb().prepare("UPDATE membership_upload_requests SET completing=1 WHERE id=? AND uploader_id=? AND completing=0 AND created_at>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin')").run(pending.id, actorId, new Date(Date.now() - GROUP_UPLOAD_REQUEST_LIFETIME).toISOString(), actorId);
  if (!claim.changes) throw new UploadError("Filen håller på att sparas. Försök igen om en liten stund.", 409);
  try { return await storeVerifiedGroupUpload(actorId, pending, localBytes); }
  finally { await getDb().prepare("UPDATE membership_upload_requests SET completing=0 WHERE id=?").run(pending.id); }
}
async function storeVerifiedGroupUpload(actorId: number, pending: GroupUploadRecord, localBytes?: Buffer) {
  let bytes: Buffer;
  if (pending.storageProvider === "local") {
    if (process.env.VERCEL || !localBytes) throw new UploadError("Välj en fil att ladda upp.");
    bytes = localBytes;
  } else {
    const result = await getBlob(pending.storagePath, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) throw new UploadError("Filen har inte laddats upp. Försök igen.");
    if (result.blob.size !== pending.size) { await result.stream.cancel(); throw new UploadError("Filens storlek stämmer inte."); }
    bytes = await readLimitedStream(result.stream, pending.size);
  }
  let stored: Buffer;
  try { stored = await validateGroupUploadBytes(pending, bytes); }
  catch (error) {
    if (pending.storageProvider === "blob") await deleteBlob(pending.storagePath).catch(() => {});
    await getDb().prepare("DELETE FROM membership_upload_requests WHERE id=?").run(pending.id);
    throw error;
  }
  const asset = pending.kind === "image" ? { ...pending, filename: pending.filename.replace(/\.[^.]+$/, ".webp"), contentType: "image/webp", size: stored.length, storagePath: pending.storagePath.replace(/\.[^.]+$/, "-image.webp") } : pending;
  if (asset.storageProvider === "local") {
    const file = localFile(asset.storagePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, stored, { flag: "wx" });
  } else if (asset.kind === "image") await putBlob(asset.storagePath, stored, { access: "private", contentType: "image/webp", allowOverwrite: false });
  try {
    await transaction(async () => {
      await assertAdmin(actorId);
      await getPendingGroupUpload(actorId, pending.id);
      await getDb().prepare("INSERT INTO membership_uploads(id,group_id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(asset.id, asset.groupId, asset.kind, asset.filename, asset.contentType, asset.size, asset.storagePath, asset.storageProvider, actorId, asset.createdAt);
      await getDb().prepare("DELETE FROM membership_upload_requests WHERE id=?").run(pending.id);
    });
  } catch (error) {
    if (asset.storageProvider === "local") await unlink(localFile(asset.storagePath)).catch(() => {});
    else await deleteBlob(asset.storagePath).catch(() => {});
    throw error;
  }
  if (asset.storageProvider === "blob" && asset.kind === "image") await deleteBlob(pending.storagePath).catch(() => {});
  return groupUploadMetadata(asset);
}
/** One SQL gate checks the current role, verified membership, publication and attachment. */
export async function getReadableGroupUpload(id: string, user: User | null): Promise<GroupUploadRecord | null> {
  if (!UPLOAD_ID.test(id) || !user) return null;
  const row = await getDb().prepare(`SELECT f.* FROM membership_uploads f JOIN users u ON u.id=?
    WHERE f.id=? AND (u.role='admin' OR (u.role='student' AND u.email_verified_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM membership_post_uploads a JOIN membership_posts p ON p.id=a.post_id
        JOIN membership_groups g ON g.id=p.group_id WHERE a.upload_id=f.id AND p.group_id=f.group_id
        AND p.published=1 AND g.published=1 AND ${membershipGroupAccessSql("u.id", "g.id")})))`).get(user.id, id.toLowerCase());
  return row ? record(row) : null;
}
export async function openGroupUpload(upload: GroupUploadRecord) {
  if (upload.storageProvider === "local") {
    if (process.env.VERCEL) throw new UploadError("Filen finns inte.", 404);
    return new Response(new Uint8Array(await readFile(/* turbopackIgnore: true */ localFile(upload.storagePath))));
  }
  const result = await getBlob(upload.storagePath, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new UploadError("Filen finns inte.", 404);
  return new Response(result.stream);
}
