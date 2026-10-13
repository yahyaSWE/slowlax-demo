import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { createFirstAdmin, createUser, getDb, type User } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import type { HandleUploadPresignedOptions } from "@vercel/blob/client";

for (const name of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "BLOB_WEBHOOK_PUBLIC_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[name];
const directory = mkdtempSync(join(tmpdir(), "tibb-group-blob-tests-"));
process.env.TIBB_DATABASE_PATH = join(directory, "fixture.sqlite");
const keys = generateKeyPairSync("ed25519");
process.env.BLOB_WEBHOOK_PUBLIC_KEY = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.BLOB_READ_WRITE_TOKEN = "test-only-not-a-provider-token";
const storage = new Map<string, Buffer>();
const calls: { operation: string; path: string; options?: Record<string, unknown> }[] = [];
let actor: User | null = null;
let actualHandle: typeof import("@vercel/blob/client").handleUploadPresigned;
const mock = {
  async get(path: string, options: Record<string, unknown>) {
    calls.push({ operation: "get", path, options });
    assert.equal(options.access, "private");
    assert.equal(options.useCache, false);
    const bytes = storage.get(path);
    if (!bytes) return null;
    return { statusCode: 200, blob: { size: bytes.length }, stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  },
  async put(path: string, bytes: Buffer, options: Record<string, unknown>) {
    calls.push({ operation: "put", path, options });
    assert.equal(options.access, "private");
    assert.equal(options.allowOverwrite, false);
    storage.set(path, Buffer.from(bytes));
    return { pathname: path };
  },
  async del(path: string) { calls.push({ operation: "delete", path }); storage.delete(path); },
  async issueSignedToken(options: Record<string, unknown>) { calls.push({ operation: "token", path: String(options.pathname), options }); return { token: "mock-delegation" }; },
  async getCurrentUser() { return actor; },
  async handleUploadPresigned(options: HandleUploadPresignedOptions) {
    if (options.body.type === "blob.upload-completed") return actualHandle(options);
    const payload = options.body.payload;
    const issued = await options.getSignedToken(payload.pathname, payload.clientPayload, payload.multipart);
    return { type: options.body.type, presignedUrlPayload: issued };
  },
};
// Mock only storage and delegation boundaries. Callback verification below uses
// the installed SDK and a locally generated Ed25519 key, without a network call.
const fixtureRequire = createRequire(resolve("tests/membership-uploads-blob.test.ts"));
const originalModules: { id: string; exports: unknown }[] = [];
function mockModule(name: string, exports: unknown) {
  const id = fixtureRequire.resolve(name);
  fixtureRequire(name);
  const module = fixtureRequire.cache[id]!;
  originalModules.push({ id, exports: module.exports });
  module.exports = exports;
}
let lib: typeof import("../src/lib/membership-uploads");
let blobRoute: typeof import("../src/app/api/gruppfiler/blob/route");
let readRoute: typeof import("../src/app/api/gruppfiler/[id]/route");
let prepareRoute: typeof import("../src/app/api/gruppfiler/route");
let completeRoute: typeof import("../src/app/api/gruppfiler/[id]/complete/route");
let admin: User;
let groupId: number;
before(async () => {
  actualHandle = fixtureRequire("@vercel/blob/client").handleUploadPresigned;
  mockModule("@vercel/blob", { get: mock.get, put: mock.put, del: mock.del, issueSignedToken: mock.issueSignedToken });
  mockModule("@vercel/blob/client", { handleUploadPresigned: mock.handleUploadPresigned });
  mockModule("../src/lib/auth", { getCurrentUser: mock.getCurrentUser });
  lib = await import("../src/lib/membership-uploads");
  blobRoute = await import("../src/app/api/gruppfiler/blob/route");
  readRoute = await import("../src/app/api/gruppfiler/[id]/route");
  prepareRoute = await import("../src/app/api/gruppfiler/route");
  completeRoute = await import("../src/app/api/gruppfiler/[id]/complete/route");
  admin = await createFirstAdmin({ name: "Blob Group Admin", email: "blob-group-admin@example.test", passwordHash: hashPassword("blob fixture password") });
  actor = admin;
  const now = new Date().toISOString();
  groupId = Number((await getDb().prepare("INSERT INTO membership_groups(name,slug,published,created_at,updated_at) VALUES('Blob Group','blob-group',1,?,?)").run(now, now)).lastInsertRowid);
});
after(async () => {
  for (const original of originalModules) fixtureRequire.cache[original.id]!.exports = original.exports;
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-group-blob-tests-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function request(body: unknown, signature?: string, origin = "https://example.test") {
  return new Request("https://example.test/api/gruppfiler/blob", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(signature ? { "x-vercel-signature": signature } : {}) }, body: JSON.stringify(body) });
}
function generation(id: string, pathname: string, multipart = false) { return { type: "blob.generate-presigned-url", payload: { pathname, multipart, clientPayload: JSON.stringify({ id }) } }; }

test("presigned uploads bind a fresh admin, exact private path, size/type and request TTL", async () => {
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const pending = await lib.prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "private.pdf", size: pdf.length });
  assert.equal(pending.provider, "blob");
  const response = await blobRoute.POST(request(generation(pending.id, pending.pathname)));
  assert.equal(response.status, 200);
  const body = await response.json();
  const options = body.presignedUrlPayload.urlOptions;
  assert.equal(options.access, "private");
  assert.equal(options.allowOverwrite, false);
  assert.equal(options.maximumSizeInBytes, pdf.length);
  assert.deepEqual(options.allowedContentTypes, ["application/pdf"]);
  const tokenPayload = JSON.parse(options.tokenPayload);
  assert.deepEqual(tokenPayload, { id: pending.id, actorId: admin.id, pathname: pending.pathname });
  assert.equal(options.callbackUrl, "https://example.test/api/gruppfiler/blob");
  const stored = await lib.getPendingGroupUpload(admin.id, pending.id);
  assert.ok(options.validUntil <= Date.parse(stored.createdAt) + 15 * 60 * 1000);
  assert.equal((await blobRoute.POST(request(generation(pending.id, "tibb/group-material/forged.pdf")))).status, 400);
  assert.equal((await blobRoute.POST(request(generation(pending.id, pending.pathname, true)))).status, 400);
  assert.equal((await blobRoute.POST(request(generation(pending.id, pending.pathname), undefined, "https://evil.test"))).status, 403);
  storage.set(pending.pathname, pdf);
  await lib.completeGroupUpload(admin.id, pending.id);
});

test("only SDK-verified callbacks finalize images; private rewritten bytes are served with private headers", async () => {
  const bytes = await sharp({ create: { width: 1700, height: 1200, channels: 3, background: "#708f65" } }).png().toBuffer();
  const pending = await lib.prepareGroupUpload(admin.id, { groupId, kind: "image", filename: "private.png", size: bytes.length });
  storage.set(pending.pathname, bytes);
  const callback = { type: "blob.upload-completed", payload: { blob: { pathname: pending.pathname, url: "https://ignored-external-url.test/file", contentType: "image/png", size: bytes.length }, tokenPayload: JSON.stringify({ id: pending.id, actorId: admin.id, pathname: pending.pathname }) } };
  const unsigned = await blobRoute.POST(request(callback, undefined, ""));
  assert.notEqual(unsigned.status, 200);
  assert.equal(await lib.getGroupUpload(pending.id), null);
  const signature = sign(null, Buffer.from(JSON.stringify(callback)), keys.privateKey).toString("hex");
  actor = null;
  const completed = await blobRoute.POST(request(callback, signature, ""));
  assert.equal(completed.status, 200);
  const asset = (await lib.getGroupUpload(pending.id))!;
  assert.equal(asset.contentType, "image/webp");
  assert.ok(asset.storagePath.endsWith("-image.webp"));
  assert.equal(storage.has(pending.pathname), false);
  const metadata = await sharp(storage.get(asset.storagePath)!).metadata();
  assert.ok(metadata.width! <= 1280 && metadata.height! <= 1280);
  assert.equal(metadata.exif, undefined);
  const anonymous = await readRoute.GET(new Request(`https://example.test/api/gruppfiler/${asset.id}`), { params: Promise.resolve({ id: asset.id }) });
  assert.equal(anonymous.status, 404);
  assert.equal(anonymous.headers.get("Cache-Control"), "private, no-store");
  actor = admin;
  const readable = await readRoute.GET(new Request(`https://example.test/api/gruppfiler/${asset.id}`), { params: Promise.resolve({ id: asset.id }) });
  assert.equal(readable.status, 200);
  assert.equal(readable.headers.get("Cache-Control"), "private, no-store");
  assert.ok(readable.headers.get("Content-Disposition")!.startsWith("inline;"));
  assert.equal(readable.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(readable.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal((await sharp(Buffer.from(await readable.arrayBuffer())).metadata()).format, "webp");
  assert.ok(calls.filter((call) => call.operation === "get" || call.operation === "put").every((call) => call.options?.access === "private"));
});

test("signature-valid callbacks still reject swapped paths and revoked administrators", async () => {
  actor = admin;
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const pending = await lib.prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "revoked.pdf", size: pdf.length });
  storage.set(pending.pathname, pdf);
  const callback = { type: "blob.upload-completed", payload: { blob: { pathname: "tibb/group-material/other.pdf" }, tokenPayload: JSON.stringify({ id: pending.id, actorId: admin.id, pathname: pending.pathname }) } };
  let signature = sign(null, Buffer.from(JSON.stringify(callback)), keys.privateKey).toString("hex");
  assert.equal((await blobRoute.POST(request(callback, signature, ""))).status, 403);
  callback.payload.blob.pathname = pending.pathname;
  signature = sign(null, Buffer.from(JSON.stringify(callback)), keys.privateKey).toString("hex");
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(admin.id);
  assert.equal((await blobRoute.POST(request(callback, signature, ""))).status, 403);
  assert.equal(await lib.getGroupUpload(pending.id), null);
  await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const stranger = await createUser({ name: "Blob student", email: "blob-student@example.test", passwordHash: hashPassword("blob student password"), role: "student" });
  actor = stranger;
  assert.equal((await blobRoute.POST(request(generation(pending.id, pending.pathname)))).status, 403);
  actor = admin;
});

test("HTTP preparation, completion and downloads enforce auth, metadata and safe attachment headers", async () => {
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const input = { groupId, kind: "document", filename: "one's (å).pdf", size: pdf.length };
  actor = null;
  let response = await prepareRoute.POST(request(input));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  actor = admin;
  assert.equal((await prepareRoute.POST(request({ ...input, kind: "forged" }))).status, 400);
  assert.equal((await prepareRoute.POST(request({ ...input, groupId: 999999 }))).status, 400);
  response = await prepareRoute.POST(request(input));
  assert.equal(response.status, 200);
  const prepared = await response.json();
  storage.set(prepared.pathname, pdf);
  const complete = await completeRoute.POST(new Request(`https://example.test/api/gruppfiler/${prepared.id}/complete`, { method: "POST", headers: { Origin: "https://example.test" } }), { params: Promise.resolve({ id: prepared.id }) });
  assert.equal(complete.status, 200);
  const metadata = await complete.json();
  assert.equal(metadata.url, `/api/gruppfiler/${prepared.id}`);
  const download = await readRoute.GET(new Request(`https://example.test${metadata.url}`), { params: Promise.resolve({ id: prepared.id }) });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("Content-Type"), "application/pdf");
  assert.equal(download.headers.get("Content-Disposition"), "attachment; filename*=UTF-8''one%27s%20%28%C3%A5%29.pdf");
  assert.equal(download.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
});
