import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getDb } from "../src/lib/db";
import { getPortalDashboard } from "../src/lib/portal-dashboard";

const directory = mkdtempSync(join(tmpdir(), "tibb-portal-dashboard-"));
delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "preview.sqlite");
let adminId: number, buyerId: number, outsiderId: number, courseA: number, courseB: number;
let lessonA: number, lessonB: number, groupId: number;
const stamp = () => new Date().toISOString();
async function course(title: string) {
  const id = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)").run(title, title.toLowerCase(), stamp(), stamp())).lastInsertRowid);
  const second = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body,position) VALUES(?,?,?,20)").run(id, `${title} andra`, "Privat text")).lastInsertRowid);
  const first = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body,position) VALUES(?,?,?,10)").run(id, `${title} första`, "Privat text")).lastInsertRowid);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(buyerId, id, stamp());
  return { id, first, second };
}
before(async () => {
  adminId = (await createFirstAdmin({ name: "Admin", email: "admin@dashboard.example.test", passwordHash: "fixture" })).id;
  buyerId = (await createUser({ name: "Elev", email: "student@dashboard.example.test", passwordHash: "fixture", role: "student" })).id;
  outsiderId = (await createUser({ name: "Annan elev", email: "outside@dashboard.example.test", passwordHash: "fixture", role: "student" })).id;
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(stamp(), buyerId, outsiderId);
  const a = await course("Balans"), b = await course("Reflektion");
  courseA = a.id; courseB = b.id; lessonA = a.first; lessonB = b.first;
  groupId = Number((await getDb().prepare("INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES('Privat grupp','privat-grupp','Privat beskrivning',1,?,?)").run(stamp(), stamp())).lastInsertRowid);
  await getDb().prepare("INSERT INTO membership_assignments(user_id,group_id,created_at,updated_at) VALUES(?,?,?,?)").run(buyerId, groupId, stamp(), stamp());
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-portal-dashboard-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("next lesson respects course order and resumes the most recently marked unfinished course", async () => {
  const initial = await getPortalDashboard(buyerId);
  assert.equal(initial.courses.find(c => c.id === courseA)?.nextLesson?.id, lessonA);
  await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(buyerId, lessonA, "2026-09-01T12:00:00.000Z");
  assert.equal((await getPortalDashboard(buyerId)).resume?.id, courseA);
  await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(buyerId, lessonB, "2026-10-01T12:00:00.000Z");
  const resumed = (await getPortalDashboard(buyerId)).resume;
  assert.equal(resumed?.id, courseB);
  assert.equal(resumed?.nextLesson?.title, "Reflektion andra");
});
test("completed courses keep their overview without offering a misleading next lesson", async () => {
  await getDb().prepare("INSERT OR IGNORE INTO progress(user_id,lesson_id,completed_at) SELECT ?,id,? FROM lessons WHERE course_id IN (?,?)").run(buyerId, stamp(), courseA, courseB);
  const dashboard = await getPortalDashboard(buyerId);
  assert.equal(dashboard.resume, null);
  assert.ok(dashboard.courses.every(c => c.nextLesson === null && c.progress === 100));
});
test("recent material includes only published posts from currently accessible groups", async () => {
  for (const [title, published, changed] of [["Tidigare plan", 1, "2026-08-01"], ["Senaste plan", 1, "2026-10-01"], ["Privat utkast", 0, "2026-11-01"]] as const)
    await getDb().prepare("INSERT INTO membership_posts(group_id,title,published,created_at,updated_at) VALUES(?,?,?,?,?)").run(groupId, title, published, `${changed}T12:00:00.000Z`, `${changed}T12:00:00.000Z`);
  const dashboard = await getPortalDashboard(buyerId);
  assert.deepEqual(dashboard.latestMaterials.map(post => post.title), ["Senaste plan", "Tidigare plan"]);
  assert.ok(dashboard.latestMaterials.every(post => !('body' in post) && !('uploads' in post)));
  const outside = await getPortalDashboard(outsiderId);
  assert.equal(outside.courses.length, 0); assert.equal(outside.latestMaterials.length, 0); assert.equal(outside.resume, null);
});
test("publication, revocation and verification immediately remove unavailable dashboard destinations", async () => {
  await getDb().prepare("UPDATE membership_assignments SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(buyerId);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseA);
  const expired = await getPortalDashboard(buyerId);
  assert.equal(expired.latestMaterials.length, 0); assert.ok(expired.courses.every(c => c.id !== courseA));
  await getDb().prepare("UPDATE membership_assignments SET expires_at=NULL WHERE user_id=?").run(buyerId);
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(buyerId);
  assert.equal((await getPortalDashboard(buyerId)).latestMaterials.length, 0);
  assert.equal((await getPortalDashboard(999999)).courses.length, 0);
});
