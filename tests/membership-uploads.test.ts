import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { createFirstAdmin, createUser, getDb, type User } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import { completeGroupUpload, getGroupUpload, getPendingGroupUpload, getReadableGroupUpload, openGroupUpload, prepareGroupUpload, groupUploadResponseError } from "../src/lib/membership-uploads";
import { UploadError } from "../src/lib/uploads";

for (const name of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "BLOB_WEBHOOK_PUBLIC_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[name];
const directory = mkdtempSync(join(tmpdir(), "tibb-group-uploads-tests-"));
process.env.TIBB_DATABASE_PATH = join(directory, "fixture.sqlite");
process.env.TIBB_UPLOAD_DIR = join(directory, "uploads");
let admin: User, otherAdmin: User, member: User, stranger: User;
let number = 0;
const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
before(async () => {
  admin = await createFirstAdmin({ name: "Group Admin", email: "group-admin@example.test", passwordHash: hashPassword("group admin test password") });
  otherAdmin = await createUser({ name: "Other Admin", email: "other-group-admin@example.test", passwordHash: hashPassword("other admin test password"), role: "admin" });
  member = await createUser({ name: "Member", email: "group-member@example.test", passwordHash: hashPassword("group member test password"), role: "student" });
  stranger = await createUser({ name: "Stranger", email: "group-stranger@example.test", passwordHash: hashPassword("group stranger test password"), role: "student" });
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(new Date().toISOString(), member.id, stranger.id);
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-group-uploads-tests-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function group() {
  const now = new Date().toISOString();
  return Number((await getDb().prepare("INSERT INTO membership_groups(name,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)").run(`Group ${++number}`, `group-${number}`, now, now)).lastInsertRowid);
}
async function document(groupId: number) {
  const pending = await prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "material.pdf", size: pdf.length });
  return completeGroupUpload(admin.id, pending.id, pdf);
}
async function post(groupId: number, uploadId: string, published = true) {
  const now = new Date().toISOString();
  const id = Number((await getDb().prepare("INSERT INTO membership_posts(group_id,title,published,created_at,updated_at) VALUES(?,?,?,?,?)").run(groupId, "Private materials", published ? 1 : 0, now, now)).lastInsertRowid);
  await getDb().prepare("INSERT INTO membership_post_uploads(post_id,upload_id) VALUES(?,?)").run(id, uploadId);
  return id;
}
async function assign(groupId: number, expires: string | null = null) {
  const now = new Date().toISOString();
  await getDb().prepare("INSERT INTO membership_assignments(user_id,group_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,group_id) DO UPDATE SET expires_at=excluded.expires_at").run(member.id, groupId, expires, now, now);
}

test("prepare validates owner group, filenames, kind, sizes and current administrator", async () => {
  const groupId = await group();
  for (const input of [
    { groupId: 999999, kind: "document" as const, filename: "a.pdf", size: 20 },
    { groupId, kind: "document" as const, filename: "../a.pdf", size: 20 },
    { groupId, kind: "document" as const, filename: "a.exe", size: 20 },
    { groupId, kind: "document" as const, filename: "a.pdf", size: 20 * 1024 * 1024 + 1 },
    { groupId, kind: "image" as const, filename: "a.png", size: 2 * 1024 * 1024 + 1 },
  ]) await assert.rejects(prepareGroupUpload(admin.id, input));
  await assert.rejects(prepareGroupUpload(member.id, { groupId, kind: "document", filename: "a.pdf", size: 20 }), /behörighet/);
  const ready = await prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "  ra\u0308tt.PDF  ", size: pdf.length });
  assert.equal((await getPendingGroupUpload(admin.id, ready.id)).filename, "rätt.PDF");
  assert.equal(ready.provider, "local");
  assert.ok(ready.pathname.startsWith("tibb/group-material/"));
});

test("pending requests enforce uploader, TTL and claims; verified retries return one asset", async () => {
  const groupId = await group();
  const pending = await prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "request.pdf", size: pdf.length });
  await assert.rejects(getPendingGroupUpload(otherAdmin.id, pending.id), /saknas/);
  await assert.rejects(completeGroupUpload(otherAdmin.id, pending.id, pdf), /saknas/);
  await assert.rejects(getPendingGroupUpload(admin.id, "bad-id"), /finns inte/);
  await assert.rejects(completeGroupUpload(admin.id, pending.id), /Välj en fil/);
  assert.equal(Number((await getDb().prepare("SELECT completing FROM membership_upload_requests WHERE id=?").get(pending.id))!.completing), 0);
  const results = await Promise.allSettled([completeGroupUpload(admin.id, pending.id, pdf), completeGroupUpload(admin.id, pending.id, pdf)]);
  assert.ok(results.some((value) => value.status === "fulfilled"));
  for (const value of results) if (value.status === "rejected") assert.ok(value.reason instanceof UploadError && value.reason.status === 409);
  const asset = (await getGroupUpload(pending.id))!;
  assert.equal((await completeGroupUpload(admin.id, pending.id)).id, asset.id);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) n FROM membership_uploads WHERE id=?").get(asset.id))!.n), 1);
  const stale = await prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "expired.pdf", size: pdf.length });
  await getDb().prepare("UPDATE membership_upload_requests SET created_at=? WHERE id=?").run(new Date(Date.now() - 16 * 60 * 1000).toISOString(), stale.id);
  await assert.rejects(completeGroupUpload(admin.id, stale.id, pdf), /löpt ut/);
});

test("invalid file bytes never become usable; images always become bounded metadata-free WebP", async () => {
  const groupId = await group();
  const bad = await prepareGroupUpload(admin.id, { groupId, kind: "document", filename: "forged.pdf", size: 4 });
  await assert.rejects(completeGroupUpload(admin.id, bad.id, Buffer.from("fake")), /innehåll/);
  assert.equal(await getGroupUpload(bad.id), null);
  assert.equal(await getDb().prepare("SELECT id FROM membership_upload_requests WHERE id=?").get(bad.id), undefined);
  const bytes = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#7a9879" } }).withMetadata({ orientation: 6 }).png().toBuffer();
  const pending = await prepareGroupUpload(admin.id, { groupId, kind: "image", filename: "private.png", size: bytes.length });
  const metadata = await completeGroupUpload(admin.id, pending.id, bytes);
  assert.equal(metadata.contentType, "image/webp");
  assert.equal(metadata.name, "private.webp");
  const upload = (await getGroupUpload(metadata.id))!;
  const output = Buffer.from(await (await openGroupUpload(upload)).arrayBuffer());
  const image = await sharp(output).metadata();
  assert.equal(image.format, "webp");
  assert.ok(image.width! <= 1280 && image.height! <= 1280);
  assert.equal(image.exif, undefined);
  assert.equal(image.orientation, undefined);
  assert.equal(await getReadableGroupUpload(upload.id, null), null);
  assert.equal(await getReadableGroupUpload(upload.id, member), null);
});

test("downloads require published group and post plus verified current membership; standalone course grants cannot authorize", async () => {
  const groupId = await group();
  const asset = await document(groupId);
  await assign(groupId);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  assert.ok(await getReadableGroupUpload(asset.id, admin));
  const postId = await post(groupId, asset.id, false);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  await getDb().prepare("UPDATE membership_posts SET published=1 WHERE id=?").run(postId);
  assert.ok(await getReadableGroupUpload(asset.id, member));
  assert.equal(await getReadableGroupUpload(asset.id, stranger), null);
  await assign(groupId, new Date(Date.now() - 1000).toISOString());
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  await assign(groupId);
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(member.id);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), member.id);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  await getDb().prepare("UPDATE membership_groups SET published=1 WHERE id=?").run(groupId);
  await getDb().prepare("DELETE FROM membership_assignments WHERE user_id=? AND group_id=?").run(member.id, groupId);
  const now = new Date().toISOString();
  const courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,0,1,?,?)").run("Independent course", `independent-${++number}`, "", now, now)).lastInsertRowid);
  await getDb().prepare("INSERT INTO membership_group_courses(group_id,course_id) VALUES(?,?)").run(groupId, courseId);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(member.id, courseId, now);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
  await assign(groupId);
  await getDb().prepare("DELETE FROM membership_post_uploads WHERE post_id=?").run(postId);
  assert.equal(await getReadableGroupUpload(asset.id, member), null);
});

test("cross-group attachment, revoked administrator and forged local paths are rejected", async () => {
  const groupId = await group();
  const asset = await document(groupId);
  const otherGroup = await group();
  await assert.rejects(post(otherGroup, asset.id), /constraint/i);
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(admin.id);
  assert.equal(await getReadableGroupUpload(asset.id, admin), null);
  await assert.rejects(completeGroupUpload(admin.id, asset.id), /behörighet/);
  await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const upload = (await getGroupUpload(asset.id))!;
  for (const storagePath of ["../outside.pdf", resolve(directory, "outside.pdf"), "tibb/group-material/not-an-id.pdf", `tibb/lesson-material/${asset.id}.pdf`]) await assert.rejects(openGroupUpload({ ...upload, storagePath }), /filsökväg/);
  const response = groupUploadResponseError(new UploadError("Private error", 404));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
});
