import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import sharp from "sharp";
import {
  get as getBlob,
  put as putBlob,
  del as deleteBlob,
} from "@vercel/blob";
import { assertAdmin } from "./admin";
import {
  DomainError,
  getDb,
  getCourseById,
  getUpload,
  hasCourseAccess,
  transaction,
} from "./db";
import type { UploadRecord, UploadedMaterial, User } from "./types";
import {
  UPLOAD_ID,
  UPLOAD_LIMITS,
  uploadContentType,
  type UploadKind,
} from "./upload-rules";

export class UploadError extends DomainError {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const REQUEST_LIFETIME = 15 * 60 * 1000;
export function blobConfigured() {
  return (
    !!process.env.BLOB_WEBHOOK_PUBLIC_KEY &&
    (!!process.env.BLOB_READ_WRITE_TOKEN ||
      !!(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN))
  );
}
function storageProvider(): "blob" | "local" {
  if (blobConfigured()) return "blob";
  if (process.env.VERCEL)
    throw new UploadError(
      "Fillagring saknas. Anslut en privat Vercel Blob-lagring under projektets Storage och publicera igen.",
      503,
    );
  return "local";
}
export function uploadMetadata(upload: UploadRecord): UploadedMaterial {
  return {
    id: upload.id,
    name: upload.filename,
    size: upload.size,
    contentType: upload.contentType,
    url: `/api/uploads/${upload.id}`,
  };
}
function localFile(path: string) {
  const root = resolve(
    /* turbopackIgnore: true */
    process.env.TIBB_UPLOAD_DIR || resolve(process.cwd(), "data/uploads"),
  );
  const result = resolve(root, path);
  if (
    !result.startsWith(root + sep) ||
    !/^tibb\/(practitioner-photo|lesson-material)\/[a-f0-9-]{36}(-portrait)?\.(jpg|jpeg|png|webp|pdf|doc|docx)$/.test(
      path,
    )
  )
    throw new UploadError("Ogiltig filsökväg.");
  return result;
}
export async function prepareUpload(
  actorId: number,
  input: {
    kind: UploadKind;
    filename: string;
    size: number;
    courseId?: number;
  },
) {
  await assertAdmin(actorId);
  if (input.kind !== "practitioner-photo" && input.kind !== "lesson-material")
    throw new UploadError("Välj bild eller kursmaterial.");
  const filename = input.filename.normalize("NFC").trim();
  if (!filename || filename.length > 200 || /[\x00-\x1f\x7f/\\]/.test(filename))
    throw new UploadError("Filnamnet är ogiltigt eller för långt.");
  const contentType = uploadContentType(input.kind, filename);
  if (!contentType)
    throw new UploadError(
      input.kind === "practitioner-photo"
        ? "Välj en JPG-, PNG- eller WebP-bild."
        : "Välj en PDF- eller Word-fil (.doc eller .docx).",
    );
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < 1 ||
    input.size > UPLOAD_LIMITS[input.kind]
  )
    throw new UploadError(
      input.kind === "practitioner-photo"
        ? "Bilden får vara högst 2 MB."
        : "Kursmaterial får vara högst 20 MB per fil.",
    );
  const courseId = input.kind === "lesson-material" ? input.courseId : null;
  if (
    input.kind === "lesson-material" &&
    (!Number.isSafeInteger(courseId) ||
      !courseId ||
      !(await getCourseById(courseId)))
  )
    throw new UploadError("Kursen finns inte.");
  const id = randomUUID();
  const provider = storageProvider();
  const path = `tibb/${input.kind}/${id}.${filename.split(".").at(-1)!.toLowerCase()}`;
  const pending = await getDb()
    .prepare(
      "SELECT COUNT(*) AS total FROM upload_requests WHERE uploader_id=? AND created_at>?",
    )
    .get(actorId, new Date(Date.now() - REQUEST_LIFETIME).toISOString());
  if (Number(pending?.total || 0) >= 40)
    throw new UploadError(
      "För många pågående uppladdningar. Vänta en stund och försök igen.",
      429,
    );
  await getDb()
    .prepare(
      "INSERT INTO upload_requests(id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,course_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      input.kind,
      filename,
      contentType,
      input.size,
      path,
      provider,
      actorId,
      courseId ?? null,
      new Date().toISOString(),
    );
  return { id, pathname: path, provider, contentType };
}
export async function getPendingUpload(
  actorId: number,
  id: string,
): Promise<UploadRecord> {
  await assertAdmin(actorId);
  if (!UPLOAD_ID.test(id))
    throw new UploadError("Uppladdningen finns inte.", 404);
  const row = await getDb()
    .prepare(
      "SELECT * FROM upload_requests WHERE id=? AND uploader_id=? AND created_at>?",
    )
    .get(id, actorId, new Date(Date.now() - REQUEST_LIFETIME).toISOString());
  if (!row)
    throw new UploadError(
      "Uppladdningen saknas eller har löpt ut. Välj filen igen.",
      404,
    );
  return {
    id: String(row.id),
    kind: String(row.kind) as UploadKind,
    filename: String(row.filename),
    contentType: String(row.content_type),
    size: Number(row.size),
    storagePath: String(row.storage_path),
    storageProvider: String(row.storage_provider) as "local" | "blob",
    uploaderId: Number(row.uploader_id),
    courseId: row.course_id == null ? null : Number(row.course_id),
    createdAt: String(row.created_at),
  };
}
export async function readLimitedStream(
  stream: ReadableStream<Uint8Array>,
  limit: number,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new UploadError("Filen är större än den tillåtna gränsen.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}
function docxEntries(bytes: Buffer): string[] {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) return [];
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  if (count > 10000) return [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      return [];
    const length = bytes.readUInt16LE(cursor + 28);
    const next =
      cursor +
      46 +
      length +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
    if (next > bytes.length) return [];
    names.push(
      bytes.subarray(cursor + 46, cursor + 46 + length).toString("utf8"),
    );
    cursor = next;
  }
  return names;
}
export async function validateUploadBytes(upload: UploadRecord, bytes: Buffer) {
  if (bytes.length !== upload.size || bytes.length > UPLOAD_LIMITS[upload.kind])
    throw new UploadError(
      "Filens storlek stämmer inte. Välj filen och ladda upp igen.",
    );
  if (upload.kind === "practitioner-photo") {
    try {
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000,
        animated: false,
      }).metadata();
      const expected = {
        "image/jpeg": "jpeg",
        "image/png": "png",
        "image/webp": "webp",
      }[upload.contentType];
      if (!expected || metadata.format !== expected) throw new Error("format");
      // Decode and re-encode once: portraits are bounded and metadata is removed.
      return await sharp(bytes, {
        limitInputPixels: 40_000_000,
        animated: false,
      })
        .rotate()
        .resize(600, 600, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new UploadError(
        "Bilden kunde inte läsas. Välj en giltig JPG-, PNG- eller WebP-bild.",
      );
    }
  }
  const valid =
    upload.contentType === "application/pdf"
      ? bytes.subarray(0, 5).toString("ascii") === "%PDF-" &&
        bytes
          .subarray(Math.max(0, bytes.length - 2048))
          .includes(Buffer.from("%%EOF"))
      : upload.contentType === "application/msword"
        ? bytes
            .subarray(0, 8)
            .equals(
              Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            ) && bytes.includes(Buffer.from("WordDocument", "utf16le"))
        : upload.contentType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
          docxEntries(bytes).includes("[Content_Types].xml") &&
          docxEntries(bytes).includes("word/document.xml");
  if (!valid)
    throw new UploadError(
      "Filens innehåll motsvarar inte filtypen. Välj en giltig PDF- eller Word-fil.",
    );
  return bytes;
}
export async function completeUpload(
  actorId: number,
  id: string,
  localBytes?: Buffer,
): Promise<UploadedMaterial> {
  await assertAdmin(actorId);
  // Retry after a lost HTTP response returns the previously verified asset.
  const ready = UPLOAD_ID.test(id) ? await getUpload(id) : undefined;
  if (ready && ready.uploaderId === actorId) return uploadMetadata(ready);
  const pending = await getPendingUpload(actorId, id);
  const claim = await getDb()
    .prepare(
      "UPDATE upload_requests SET completing=1 WHERE id=? AND uploader_id=? AND completing=0",
    )
    .run(id, actorId);
  if (!claim.changes)
    throw new UploadError(
      "Filen håller på att sparas. Försök igen om en liten stund.",
      409,
    );
  try {
    return await storeVerifiedUpload(actorId, pending, localBytes);
  } finally {
    await getDb()
      .prepare("UPDATE upload_requests SET completing=0 WHERE id=?")
      .run(id);
  }
}
async function storeVerifiedUpload(
  actorId: number,
  pending: UploadRecord,
  localBytes?: Buffer,
): Promise<UploadedMaterial> {
  const id = pending.id;
  let bytes: Buffer;
  if (pending.storageProvider === "local") {
    if (!localBytes) throw new UploadError("Välj en fil att ladda upp.");
    bytes = localBytes;
  } else {
    const result = await getBlob(pending.storagePath, {
      access: "private",
      useCache: false,
    });
    if (!result || result.statusCode !== 200)
      throw new UploadError("Filen har inte laddats upp. Försök igen.");
    if (result.blob.size !== pending.size) {
      await result.stream.cancel();
      throw new UploadError("Filens storlek stämmer inte.");
    }
    bytes = await readLimitedStream(result.stream, pending.size);
  }
  let stored: Buffer;
  try {
    stored = await validateUploadBytes(pending, bytes);
  } catch (error) {
    if (pending.storageProvider === "blob")
      await deleteBlob(pending.storagePath).catch(() => {});
    await getDb().prepare("DELETE FROM upload_requests WHERE id=?").run(id);
    throw error;
  }
  const asset: UploadRecord =
    pending.kind === "practitioner-photo"
      ? {
          ...pending,
          contentType: "image/webp",
          size: stored.length,
          filename: pending.filename.replace(/\.[^.]+$/, ".webp"),
          storagePath: pending.storagePath.replace(
            /\.[^.]+$/,
            "-portrait.webp",
          ),
        }
      : pending;
  // The path validator permits the bounded UUID plus an optional portrait suffix.
  if (asset.storageProvider === "local") {
    const file = localFile(asset.storagePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, stored);
  } else if (asset.kind === "practitioner-photo") {
    await putBlob(asset.storagePath, stored, {
      access: "private",
      contentType: "image/webp",
      allowOverwrite: false,
    });
  }
  try {
    await transaction(async () => {
      await assertAdmin(actorId);
      await getPendingUpload(actorId, id);
      await getDb()
        .prepare(
          "INSERT INTO uploads(id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,course_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          asset.id,
          asset.kind,
          asset.filename,
          asset.contentType,
          asset.size,
          asset.storagePath,
          asset.storageProvider,
          actorId,
          asset.courseId,
          asset.createdAt,
        );
      await getDb().prepare("DELETE FROM upload_requests WHERE id=?").run(id);
    });
  } catch (error) {
    if (asset.storageProvider === "local")
      await unlink(localFile(asset.storagePath)).catch(() => {});
    else await deleteBlob(asset.storagePath).catch(() => {});
    throw error;
  }
  if (asset.storageProvider === "blob" && asset.kind === "practitioner-photo")
    await deleteBlob(pending.storagePath).catch(() => {});
  return uploadMetadata(asset);
}
export async function getReadableUpload(
  id: string,
  user: User | null,
): Promise<UploadRecord | null> {
  if (!UPLOAD_ID.test(id)) return null;
  const upload = await getUpload(id);
  if (!upload) return null;
  if (user && (await getDb().prepare("SELECT role FROM users WHERE id=?").get(user.id))?.role === "admin") return upload;
  if (upload.kind === "practitioner-photo")
    return (await getDb()
      .prepare(
        "SELECT id FROM practitioners WHERE photo_upload_id=? AND active=1",
      )
      .get(id))
      ? upload
      : null;
  if (
    !user ||
    !upload.courseId ||
    !(await hasCourseAccess(user.id, upload.courseId))
  )
    return null;
  return (await getDb()
    .prepare(
      "SELECT lm.lesson_id FROM lesson_materials lm JOIN lessons l ON l.id=lm.lesson_id WHERE lm.upload_id=? AND l.course_id=?",
    )
    .get(id, upload.courseId))
    ? upload
    : null;
}
export async function openUpload(upload: UploadRecord) {
  if (upload.storageProvider === "local") {
    if (process.env.VERCEL) throw new UploadError("Filen finns inte.", 404);
    return new Response(
      new Uint8Array(
        await readFile(
          /* turbopackIgnore: true */ localFile(upload.storagePath),
        ),
      ),
    );
  }
  const result = await getBlob(upload.storagePath, { access: "private" });
  if (!result || result.statusCode !== 200)
    throw new UploadError("Filen finns inte.", 404);
  return new Response(result.stream);
}
