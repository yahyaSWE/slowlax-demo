import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getDb, getAccessibleCourse, getPortalCourseSummaries,
  getCourseSummaries, getStudentCourses, hasCourseAccess, type User } from "../src/lib/db";
import { markLesson } from "../src/lib/admin";
import { assignGroup, getAccessibleGroup, getAccessiblePost, getAdminGroup, getPortalGroups, removeAssignment, saveGroup, savePost } from "../src/lib/memberships";
import { getCoursePurchaseOffer, getCourseSalesSettings, getPublicCourseSalesSettings, saveCourseSalesSettings,
  hasPermanentCourseAccess, type CourseSalesSettingsInput } from "../src/lib/course-sales";
import { getStudentLessonActivities, saveCourseActivity, saveAssignment, submitQuiz } from "../src/lib/course-activities";
import { getReadableUpload } from "../src/lib/uploads";
import { getReadableGroupUpload } from "../src/lib/membership-uploads";

const directory = mkdtempSync(join(tmpdir(), "tibb-course-sales-"));
delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "course-sales.sqlite");
// These isolated test values are never sent to Stripe.
process.env.STRIPE_SECRET_KEY = "sk_test_course_sales_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_course_sales_fixture";
process.env.APP_URL = "https://course-sales.example.test";
let admin: User, buyer: User, outsider: User, unverified: User;
const now = () => new Date().toISOString();
function input(changes: Partial<CourseSalesSettingsInput> = {}): CourseSalesSettingsInput {
  return { enabled: true, groupId: null, groupAccessDays: null, vatPercent: 25,
    terms: "Engångsköp ger permanent åtkomst till den köpta kursen. Eventuell gruppåtkomst visas före betalningen.",
    expectedUpdatedAt: null, ...changes };
}
async function courseFixture(published = true, priceOre = 499000) {
  const courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,price_ore,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("Köpt kurs", `kurs-${randomUUID()}`, published ? 1 : 0, priceOre, now(), now())).lastInsertRowid);
  const lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,?,?)")
    .run(courseId, "Lektion", "Privat kursinnehåll")).lastInsertRowid);
  return { courseId, lessonId };
}
async function groupFixture(courseIds: number[] = [], published = true) {
  return saveGroup(admin.id, undefined, { name: "Köpargrupp", slug: `grupp-${randomUUID()}`,
    description: "Privat gruppbeskrivning", courseIds, published });
}
async function purchaseFixture(courseId: number, options: { groupId?: number; days?: number; expired?: boolean; actor?: User } = {}) {
  const actor = options.actor ?? buyer, timestamp = now(), id = randomUUID(), groupId = options.groupId ?? null;
  const paidAt = new Date(Date.now() - (options.expired ? 10 * 86400000 : 1000)).toISOString();
  const expiresAt = options.days == null ? null : new Date(Date.parse(paidAt) + options.days * 86400000).toISOString();
  const course = (await getDb().prepare("SELECT * FROM courses WHERE id=?").get(courseId))!;
  await getDb().prepare("INSERT OR IGNORE INTO course_purchase_customers VALUES(?,?,?)").run(actor.id, `cus_course_${actor.id}`, timestamp);
  await getDb().prepare(`INSERT INTO course_purchase_attempts
    (id,user_id,course_id,course_title,course_slug,course_revision,settings_revision,terms,price_ore,vat_percent,
     group_id,group_name,group_access_days,status,session_id,customer_id,tax_rate_id,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?,?,?,?,?,?)`)
    .run(id, actor.id, courseId, String(course.title), String(course.slug), String(course.updated_at), timestamp, "Godkända köp- och åtkomstvillkor",
      Number(course.price_ore), 25, groupId, groupId ? "Köpargrupp" : null, options.days ?? null,
      `cs_course_${id}`, `cus_course_${actor.id}`, `txr_course_${id}`, timestamp, timestamp, timestamp);
  await getDb().prepare(`INSERT INTO course_purchases
    (id,attempt_id,user_id,course_id,group_id,group_expires_at,session_id,payment_intent_id,charge_id,price_ore,vat_percent,paid_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, id, actor.id, courseId, groupId, expiresAt, `cs_course_${id}`, `pi_course_${id}`, `ch_course_${id}`,
      Number(course.price_ore), 25, paidAt, timestamp);
  return id;
}
before(async () => {
  admin = await createFirstAdmin({ name: "Admin", email: "admin@course-sales.example.test", passwordHash: "fixture" });
  buyer = await createUser({ name: "Köpare", email: "buyer@course-sales.example.test", role: "student", passwordHash: "fixture" });
  outsider = await createUser({ name: "Utanför", email: "outside@course-sales.example.test", role: "student", passwordHash: "fixture" });
  unverified = await createUser({ name: "Ej verifierad", email: "unverified@course-sales.example.test", role: "student", passwordHash: "fixture" });
  for (const user of [buyer, outsider]) await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), user.id);
  await getDb().prepare("UPDATE settings SET email=? WHERE id=1").run("contact@course-sales.example.test");
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("tibb-course-sales-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("sales start disabled without writes; admin edits preserve revisions and require viable offers", async () => {
  const { courseId } = await courseFixture();
  assert.deepEqual(await getCourseSalesSettings(courseId), { courseId, enabled: false, groupId: null, groupAccessDays: null,
    vatPercent: 25, terms: "", updatedAt: null });
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM course_sales_settings WHERE course_id=?").get(courseId))!.total, 0);
  await assert.rejects(saveCourseSalesSettings(buyer.id, courseId, input()), /behörighet/);
  await assert.rejects(saveCourseSalesSettings(admin.id, courseId, input({ terms: " " })), /villkor/);
  await assert.rejects(saveCourseSalesSettings(admin.id, courseId, input({ groupAccessDays: 1 })), /grupp/);
  const draft = await courseFixture(false), free = await courseFixture(true, 0);
  for (const fixture of [draft, free]) await assert.rejects(saveCourseSalesSettings(admin.id, fixture.courseId, input()), /Publicera|pris/);
  const groupId = await groupFixture([], false);
  await assert.rejects(saveCourseSalesSettings(admin.id, courseId, input({ groupId })), /Publicera gruppen/);
  const settings = await saveCourseSalesSettings(admin.id, courseId, input());
  assert.ok(settings.updatedAt);
  await assert.rejects(saveCourseSalesSettings(admin.id, courseId, input()), /ändrats/);
  const updated = await saveCourseSalesSettings(admin.id, courseId, input({ enabled: false, expectedUpdatedAt: settings.updatedAt }));
  assert.notEqual(updated.updatedAt, settings.updatedAt);
  for (const days of [0, -1, 1.5, 3651])
    await assert.rejects(saveCourseSalesSettings(admin.id, courseId, input({ groupId, groupAccessDays: days, expectedUpdatedAt: updated.updatedAt })));
});

test("purchase offers require publication, configured payment, contact and current terms but do not require group-course links", async () => {
  const { courseId } = await courseFixture(), groupId = await groupFixture();
  const settings = await saveCourseSalesSettings(admin.id, courseId, input({ groupId, groupAccessDays: 365 }));
  const offer = (await getCoursePurchaseOffer(courseId))!;
  assert.equal(offer.courseId, courseId); assert.equal(offer.groupId, groupId); assert.equal(offer.groupAccessDays, 365);
  assert.equal(offer.settingsRevision, settings.updatedAt); assert.equal(offer.termsRevision, settings.updatedAt);
  assert.equal(offer.terms, settings.terms); assert.equal(offer.priceOre, 499000);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM membership_group_courses WHERE group_id=?").get(groupId))!.total, 0);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_course_sales_fixture";
  process.env.APP_URL = "https://unsafe.example.test/path?token=x"; // origins remain validated by appUrl.
  assert.ok(await getCoursePurchaseOffer(courseId));
  process.env.APP_URL = "javascript:invalid";
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
  process.env.APP_URL = "https://course-sales.example.test";
  await getDb().prepare("UPDATE settings SET email='' WHERE id=1").run();
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
  await getDb().prepare("UPDATE settings SET email=? WHERE id=1").run("contact@course-sales.example.test");
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
  assert.equal(await getPublicCourseSalesSettings(courseId), undefined);
  await getDb().prepare("UPDATE membership_groups SET published=1 WHERE id=?").run(groupId);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  assert.equal(await getCoursePurchaseOffer(courseId), undefined);
});

test("a paid course grants permanent access and its optional group independently, including other currently linked courses", async () => {
  const bought = await courseFixture(), linked = await courseFixture(), groupId = await groupFixture([linked.courseId]);
  await purchaseFixture(bought.courseId, { groupId, days: 30 });
  assert.ok(await getAccessibleCourse(buyer.id, bought.courseId));
  assert.ok(await getAccessibleGroup(buyer.id, groupId));
  assert.equal(await hasCourseAccess(buyer.id, linked.courseId), true);
  assert.equal(await hasPermanentCourseAccess(buyer.id, bought.courseId), true);
  assert.equal(await hasPermanentCourseAccess(buyer.id, linked.courseId), false);
  assert.equal((await getStudentCourses(buyer.id)).filter(c => c.id === bought.courseId).length, 1);
  assert.equal((await getPortalCourseSummaries(buyer.id)).filter(c => c.id === bought.courseId).length, 1);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM enrollments WHERE user_id=? AND course_id=?").get(buyer.id, bought.courseId))!.total, 0);
  assert.equal((await getDb().prepare("SELECT COUNT(*) total FROM membership_assignments WHERE user_id=? AND group_id=?").get(buyer.id, groupId))!.total, 0);
  assert.equal(await hasCourseAccess(outsider.id, bought.courseId), false);
  assert.equal(await getAccessibleGroup(outsider.id, groupId), undefined);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  assert.equal(await hasCourseAccess(buyer.id, linked.courseId), false);
  assert.equal(await hasCourseAccess(buyer.id, bought.courseId), true);
});

test("expired group access leaves the purchased course and historical progress intact", async () => {
  const bought = await courseFixture(), linked = await courseFixture(), groupId = await groupFixture([linked.courseId]);
  const source = await purchaseFixture(bought.courseId, { groupId, days: 1, expired: true });
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  assert.equal(await hasCourseAccess(buyer.id, linked.courseId), false);
  assert.equal(await hasCourseAccess(buyer.id, bought.courseId), true);
  assert.deepEqual(await getStudentLessonActivities(buyer.id, bought.courseId, bought.lessonId), []);
  await assert.rejects(getStudentLessonActivities(buyer.id, linked.courseId, linked.lessonId), /tillgång/);
  await markLesson(buyer.id, bought.lessonId, true);
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='refund',updated_at=? WHERE id=?").run(now(), source);
  assert.equal(await hasCourseAccess(buyer.id, bought.courseId), false);
  await assert.rejects(markLesson(buyer.id, bought.lessonId, false), /tillgång/);
  assert.ok(await getDb().prepare("SELECT * FROM progress WHERE user_id=? AND lesson_id=?").get(buyer.id, bought.lessonId));
});

test("purchase revocation never deletes independent manual course/group access or another paid source", async () => {
  const bought = await courseFixture(), linked = await courseFixture(), groupId = await groupFixture([linked.courseId]);
  const source = await purchaseFixture(bought.courseId, { groupId });
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(buyer.id, bought.courseId, now());
  assert.equal(await hasPermanentCourseAccess(buyer.id, bought.courseId), true);
  const assignmentId = await assignGroup(admin.id, { email: buyer.email, groupId, expiresAt: null });
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='dispute',updated_at=? WHERE id=?").run(now(), source);
  assert.equal(await hasCourseAccess(buyer.id, bought.courseId), true);
  assert.ok(await getAccessibleGroup(buyer.id, groupId));
  assert.equal(await hasCourseAccess(buyer.id, linked.courseId), true);
  await removeAssignment(admin.id, assignmentId);
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  await purchaseFixture(bought.courseId, { groupId });
  assert.ok(await getAccessibleGroup(buyer.id, groupId));
  assert.equal((await getPortalGroups(buyer.id)).filter(g => g.id === groupId).length, 1);
  await assert.rejects(getDb().prepare("UPDATE course_purchases SET revoked=0,revocation_reason=NULL WHERE id=?").run(source), /cannot be restored/);
});

test("current account status and course publication guard purchases without erasing paid grants", async () => {
  const { courseId } = await courseFixture(), groupId = await groupFixture();
  const source = await purchaseFixture(courseId, { groupId });
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(buyer.id);
  assert.equal(await hasCourseAccess(buyer.id, courseId), false);
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), buyer.id);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  assert.equal(await hasCourseAccess(buyer.id, courseId), false);
  assert.ok(await getAccessibleGroup(buyer.id, groupId));
  await getDb().prepare("UPDATE courses SET published=1 WHERE id=?").run(courseId);
  await getDb().prepare("UPDATE course_purchase_attempts SET status='completed' WHERE id=?").run(source);
  assert.equal(await hasCourseAccess(buyer.id, courseId), false);
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  await getDb().prepare("UPDATE course_purchase_attempts SET status='paid' WHERE id=?").run(source);
  assert.equal(await hasCourseAccess(buyer.id, courseId), true);
  await assert.rejects(purchaseFixture(courseId, { actor: unverified }), /Verified course customer/);
});

test("purchase access covers lesson progress, quizzes, assignments and private course documents", async () => {
  const { courseId, lessonId } = await courseFixture();
  const source = await purchaseFixture(courseId);
  const quizId = await saveCourseActivity(admin.id, { courseId, lessonId, kind: "quiz", title: "Kursquiz", instructions: "Svara", position: 1,
    active: true, questions: [{ id: "q1", prompt: "Välj", options: ["Ett", "Två"], correctOption: 0 }], passPercent: 80 });
  const assignmentId = await saveCourseActivity(admin.id, { courseId, lessonId, kind: "assignment", title: "Reflektion", instructions: "Skriv din reflektion",
    position: 2, active: true });
  await submitQuiz(buyer.id, { courseId, lessonId, activityId: quizId, revision: 1, answers: [{ questionId: "q1", optionIndex: 0 }] });
  await saveAssignment(buyer.id, { courseId, lessonId, activityId: assignmentId, revision: 1, text: "Min reflektion", submit: true });
  assert.equal((await getStudentLessonActivities(buyer.id, courseId, lessonId)).length, 2);
  const uploadId = randomUUID();
  await getDb().prepare(`INSERT INTO uploads(id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,course_id,created_at)
    VALUES(?,'lesson-material','Kursmaterial.pdf','application/pdf',123,?,'local',?,?,?)`).run(uploadId, `course-material/${uploadId}.pdf`, admin.id, courseId, now());
  await getDb().prepare("INSERT INTO lesson_materials(lesson_id,upload_id) VALUES(?,?)").run(lessonId, uploadId);
  assert.ok(await getReadableUpload(uploadId, buyer));
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='refund',updated_at=? WHERE id=?").run(now(), source);
  assert.equal(await getReadableUpload(uploadId, buyer), null);
  await assert.rejects(getStudentLessonActivities(buyer.id, courseId, lessonId), /tillgång/);
  await assert.rejects(submitQuiz(buyer.id, { courseId, lessonId, activityId: quizId, revision: 1, answers: [{ questionId: "q1", optionIndex: 0 }] }), /tillgång/);
  await assert.rejects(saveAssignment(buyer.id, { courseId, lessonId, activityId: assignmentId, revision: 1, text: "Ändring", submit: true }), /tillgång/);
});

test("historical course contracts and grant boundaries cannot be rewritten by later admin settings", async () => {
  const { courseId } = await courseFixture(), groupId = await groupFixture(), otherGroup = await groupFixture();
  const initial = await saveCourseSalesSettings(admin.id, courseId, input({ groupId, groupAccessDays: 30 }));
  const source = await purchaseFixture(courseId, { groupId, days: 30 });
  const before = (await getDb().prepare("SELECT * FROM course_purchases WHERE id=?").get(source))!;
  await saveCourseSalesSettings(admin.id, courseId, input({ groupId: otherGroup, groupAccessDays: 365,
    terms: "Nya villkor för framtida köpare", expectedUpdatedAt: initial.updatedAt }));
  assert.deepEqual(await getDb().prepare("SELECT * FROM course_purchases WHERE id=?").get(source), before);
  assert.ok(await getAccessibleGroup(buyer.id, groupId));
  assert.equal(await getAccessibleGroup(buyer.id, otherGroup), undefined);
  await assert.rejects(getDb().prepare("UPDATE course_purchase_attempts SET group_id=? WHERE id=?").run(otherGroup, source), /immutable/);
  await assert.rejects(getDb().prepare("UPDATE course_purchases SET group_expires_at=? WHERE id=?").run("2090-01-01T00:00:00.000Z", source), /immutable/);
  await assert.rejects(getDb().prepare("UPDATE course_purchase_attempts SET tax_rate_id=? WHERE id=?").run("txr_other", source), /immutable/);
  await assert.rejects(getDb().prepare("DELETE FROM courses WHERE id=?").run(courseId), /purchase history/);
  const group = (await getAdminGroup(admin.id, groupId))!;
  await saveGroup(admin.id, groupId, { ...group, published: false, expectedUpdatedAt: group.updatedAt });
  assert.equal(await getAccessibleGroup(buyer.id, groupId), undefined);
  assert.equal(await hasCourseAccess(buyer.id, courseId), true);
});

test("only a live purchase source grants private group posts and document bytes, with no cross-group or outsider access", async () => {
  const { courseId } = await courseFixture(), groupId = await groupFixture();
  const source = await purchaseFixture(courseId, { groupId });
  const uploadId = randomUUID();
  await getDb().prepare(`INSERT INTO membership_uploads
    (id,group_id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,created_at)
    VALUES(?,?,'document','Gruppmaterial.pdf','application/pdf',123,?,'local',?,?)`)
    .run(uploadId, groupId, `tibb/group-material/${uploadId}.pdf`, admin.id, now());
  const postId = await savePost(admin.id, undefined, { groupId, title: "Köparnas gruppmaterial",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Privat för gruppmedlemmar" }] }] },
    period: null, uploadIds: [uploadId], published: true });
  assert.ok(await getAccessiblePost(buyer.id, groupId, postId));
  assert.ok(await getReadableGroupUpload(uploadId, buyer));
  assert.equal(await getAccessiblePost(outsider.id, groupId, postId), undefined);
  assert.equal(await getReadableGroupUpload(uploadId, outsider), null);
  const otherGroup = await groupFixture();
  assert.equal(await getAccessiblePost(buyer.id, otherGroup, postId), undefined);
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='refund',updated_at=? WHERE id=?").run(now(), source);
  assert.equal(await getAccessiblePost(buyer.id, groupId, postId), undefined);
  assert.equal(await getReadableGroupUpload(uploadId, buyer), null);
});

test("admin student counts union permanent purchase and manual enrollments without double-counting or counting indirect group access", async () => {
  const bought = await courseFixture(), linked = await courseFixture(), groupId = await groupFixture([linked.courseId]);
  await purchaseFixture(bought.courseId, { groupId });
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(buyer.id, bought.courseId, now());
  await purchaseFixture(bought.courseId);
  const outsideSource = await purchaseFixture(bought.courseId, { actor: outsider });
  let summaries = await getCourseSummaries();
  assert.equal(summaries.find(c => c.id === bought.courseId)!.enrollmentCount, 2);
  assert.equal(summaries.find(c => c.id === linked.courseId)!.enrollmentCount, 0);
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='refund',updated_at=? WHERE id=?").run(now(), outsideSource);
  summaries = await getCourseSummaries();
  assert.equal(summaries.find(c => c.id === bought.courseId)!.enrollmentCount, 1);
});
