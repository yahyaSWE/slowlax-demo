import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { createCourseDiplomaPdf } from "../../src/lib/course-diploma-pdf";
import { createFirstAdmin, createUser, getDb, type User } from "../../src/lib/db";
import { issueCourseCertificate, saveCourseCertificateSettings, type CourseCertificate } from "../../src/lib/course-certificates";

for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "DATABASE_URL", "KIT_API_KEY"]) delete process.env[key];
process.env.TIBB_DATABASE_PATH = ":memory:";
process.env.SUPABASE_DATABASE_ENABLED = "false"; process.env.SUPABASE_AUTH_ENABLED = "false";
const fixtureRequire = createRequire(import.meta.url);
let actor: User | null = null, owner: User, other: User, admin: User, certificate: CourseCertificate;
let route: typeof import("../../src/app/api/diplom/[id]/route");
let authPath: string, originalAuth: NodeJS.Module | undefined;
const request = () => new Request("https://slowlax.example.test/api/diplom/fixture");
function download(id = certificate.id) { return route.GET(request(), { params: Promise.resolve({ id }) }); }

before(async () => {
  authPath = fixtureRequire.resolve("../../src/lib/auth");
  originalAuth = fixtureRequire.cache[authPath];
  fixtureRequire.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { getCurrentUser: async () => actor } } as unknown as NodeJS.Module;
  route = await import("../../src/app/api/diplom/[id]/route");
  admin = await createFirstAdmin({ name: "Testadmin", email: "diploma-admin@example.test", passwordHash: "fixture" });
  owner = await createUser({ name: "Åsa Östergård", email: "diploma-owner@example.test", passwordHash: "fixture", role: "student" });
  other = await createUser({ name: "Annan elev", email: "diploma-other@example.test", passwordHash: "fixture", role: "student" });
  const now = new Date().toISOString();
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now, owner.id);
  const courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES('Bygg din egen Halal-pengamaskin','diploma-pdf-test',1,?,?)").run(now, now)).lastInsertRowid);
  const lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,'Sista lektionen','Innehåll')").run(courseId)).lastInsertRowid);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(owner.id, courseId, now);
  await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(owner.id, lessonId, now);
  await saveCourseCertificateSettings(admin.id, courseId, { enabled: true, expectedUpdatedAt: null });
  certificate = await issueCourseCertificate(owner.id, courseId);
  // Current names, publication and access can change after an issued diploma.
  await getDb().prepare("UPDATE users SET name='Changed name' WHERE id=?").run(owner.id);
  await getDb().prepare("UPDATE courses SET title='Changed course',published=0 WHERE id=?").run(courseId);
  await getDb().prepare("DELETE FROM enrollments WHERE user_id=?").run(owner.id);
});
after(async () => { if (authPath) { if (originalAuth) fixtureRequire.cache[authPath] = originalAuth; else delete fixtureRequire.cache[authPath]; } await getDb().close(); });

test("a diploma is one A4 landscape page with embedded Swedish text and immutable issue metadata", async () => {
  const bytes = await createCourseDiplomaPdf(certificate), pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 841.89, height: 595.28 });
  assert.equal(pdf.getTitle(), "Diplom - Bygg din egen Halal-pengamaskin");
  assert.equal(pdf.getAuthor(), "Slowlax");
  assert.equal(pdf.getCreationDate()?.toISOString().slice(0, 19), certificate.issuedAt.slice(0, 19));
  assert.ok(bytes.byteLength < 300000);
});
test("long names and course titles wrap on one page; Arabic names use a bundled fallback", async () => {
  for (const studentName of ["Alexandra ".repeat(10).slice(0, 100), "محمد عبدالله", "Олександра Іваненко"]) {
    const bytes = await createCourseDiplomaPdf({ ...certificate, studentName, courseTitle: "Långsiktiga och medvetna investeringar med kunskap och principer ".repeat(3).slice(0, 180) });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
});
test("anonymous, other students and malformed IDs cannot retrieve a diploma", async () => {
  actor = null; const anonymous = await download(); assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
  actor = other; const denied = await download(); assert.equal(denied.status, 404);
  assert.doesNotMatch(await denied.text(), /Åsa|Halal-pengamaskin|Changed/);
  assert.equal((await download("../private")).status, 404);
});
test("the authenticated owner and admin can download an issued historical snapshot privately", async () => {
  for (const user of [owner, admin]) {
    actor = user; const response = await download();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-security-policy"), "sandbox");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="slowlax-diplom-${certificate.id}.pdf"`);
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    assert.equal(pdf.getTitle(), "Diplom - Bygg din egen Halal-pengamaskin");
  }
});
