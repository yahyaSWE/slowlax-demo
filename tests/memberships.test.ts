import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createFirstAdmin, createUser, getDb, getAccessibleCourse, getCourseProgress,
  getPortalCourseSummaries, getStudentCourses, hasCourseAccess, type User,
} from "../src/lib/db";
import { markLesson } from "../src/lib/admin";
import {
  assignGroup, getAccessibleGroup, getAccessiblePost, getAdminAssignments, getAdminGroup, getAdminPlan, getAdminPost,
  getGroupPosts, getMembershipSettings, getPortalGroups, getPublicPlan, getPublicPlanCourses, getPublicPlans, removeAssignment,
  saveGroup, saveMembershipSettings, savePlan, savePost,
} from "../src/lib/memberships";
import { getReadableUpload } from "../src/lib/uploads";
import { getReadableGroupUpload } from "../src/lib/membership-uploads";
import { getStudentLessonActivities, saveCourseActivity, saveAssignment, submitQuiz } from "../src/lib/course-activities";
import type { MembershipGroupInput, MembershipPlanInput } from "../src/lib/membership-types";

const directory = mkdtempSync(join(tmpdir(), "tibb-memberships-"));
delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "membership.sqlite");
let admin: User, member: User, outsider: User, unverified: User;
const future = "2090-01-01T00:00:00.000Z", past = "2000-01-01T00:00:00.000Z";
const now = () => new Date().toISOString();
function groupInput(courseIds: number[] = [], changes: Partial<MembershipGroupInput> = {}): MembershipGroupInput {
  return { name: "Medlemsgrupp", slug: `grupp-${randomUUID()}`, description: "Gruppens beskrivning", published: true, courseIds, ...changes };
}
function planInput(groupId: number, changes: Partial<MembershipPlanInput> = {}): MembershipPlanInput {
  return { groupId, name: "Månadsmedlem", slug: `plan-${randomUUID()}`, description: "Löpande tillgång", priceOre: 19900, vatPercent: 25, interval: "month", published: true, ...changes };
}
async function courseFixture(published = true) {
  const courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run("Medlemskurs", `kurs-${randomUUID()}`, published ? 1 : 0, now(), now())).lastInsertRowid);
  const lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,?,?)").run(courseId, "Lektion", "Kursinnehåll")).lastInsertRowid);
  return { courseId, lessonId };
}
async function paidFixture(groupId: number, status = "active", paidUntil: string | null = future) {
  const planId = await savePlan(admin.id, undefined, planInput(groupId));
  const plan = (await getAdminPlan(admin.id, planId))!;
  const attemptId = randomUUID(), subscriptionId = `sub_${randomUUID()}`, customerId = `cus_${member.id}`;
  await getDb().prepare("INSERT OR IGNORE INTO membership_customers(user_id,stripe_id,created_at) VALUES(?,?,?)").run(member.id, customerId, now());
  await getDb().prepare(`INSERT INTO membership_checkout_attempts(id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,customer_id,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(attemptId, member.id, planId, groupId, "Godkända medlemsvillkor", plan.priceOre, 25, "month", plan.name, plan.slug, plan.updatedAt,
      (await getMembershipSettings()).updatedAt, "subscribed", customerId, future, now(), now());
  await getDb().prepare(`INSERT INTO membership_subscriptions(stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(subscriptionId, member.id, planId, groupId, attemptId, status, paidUntil, customerId, `price_${planId}`, plan.priceOre, 25, "month", now(), now());
  return { subscriptionId, planId };
}
async function uploadFixture(groupId: number, kind: "image" | "document") {
  const id = randomUUID();
  await getDb().prepare("INSERT INTO membership_uploads(id,group_id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,created_at) VALUES(?,?,?,?,?,?,?,'local',?,?)")
    .run(id, groupId, kind, kind === "image" ? "bild.png" : "material.pdf", kind === "image" ? "image/png" : "application/pdf", 100, `tibb/group-material/${id}.${kind === "image" ? "png" : "pdf"}`, admin.id, now());
  return id;
}
before(async () => {
  admin = await createFirstAdmin({ name: "Administratör", email: "admin@memberships.example.test", passwordHash: "isolated-admin-hash" });
  member = await createUser({ name: "Medlem", email: "member@memberships.example.test", role: "student", passwordHash: "isolated-member-hash" });
  outsider = await createUser({ name: "Utanför", email: "outside@memberships.example.test", role: "student", passwordHash: "isolated-outsider-hash" });
  unverified = await createUser({ name: "Ej verifierad", email: "unverified@memberships.example.test", role: "student", passwordHash: "isolated-unverified-hash" });
  for (const user of [member, outsider]) await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), user.id);
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("tibb-memberships-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("manual and paid memberships union across groups; revocation and expiry preserve independent lifetime grants", async () => {
  const { courseId, lessonId } = await courseFixture();
  const first = await saveGroup(admin.id, undefined, groupInput([courseId]));
  const second = await saveGroup(admin.id, undefined, groupInput([courseId]));
  const manualId = await assignGroup(admin.id, { email: member.email.toUpperCase(), groupId: first, expiresAt: null });
  const { subscriptionId } = await paidFixture(second);
  assert.equal(await hasCourseAccess(member.id, courseId), true);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) total FROM enrollments WHERE user_id=? AND course_id=?").get(member.id, courseId))!.total), 0);
  assert.ok((await getStudentCourses(member.id)).some(c => c.id === courseId));
  assert.equal((await getPortalCourseSummaries(member.id)).filter(c => c.id === courseId).length, 1);
  await markLesson(member.id, lessonId, true);
  assert.deepEqual(await getCourseProgress(member.id, courseId), [lessonId]);
  await removeAssignment(admin.id, manualId);
  assert.equal(await hasCourseAccess(member.id, courseId), true);
  await getDb().prepare("UPDATE membership_subscriptions SET paid_until=? WHERE stripe_id=?").run(past, subscriptionId);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  assert.equal(await getAccessibleCourse(member.id, courseId), undefined);
  assert.deepEqual(await getCourseProgress(member.id, courseId), [lessonId]);
  await assert.rejects(markLesson(member.id, lessonId, false), /tillgång/);
  assert.ok(await getDb().prepare("SELECT * FROM progress WHERE user_id=? AND lesson_id=?").get(member.id, lessonId));
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(member.id, courseId, now());
  const again = await assignGroup(admin.id, { email: member.email, groupId: first, expiresAt: future });
  await removeAssignment(admin.id, again);
  assert.equal(await hasCourseAccess(member.id, courseId), true);
  assert.deepEqual(await getCourseProgress(member.id, courseId), [lessonId]);
});

test("only paid current active or past_due subscriptions grant access and sales pause does not revoke members", async () => {
  const { courseId } = await courseFixture();
  const groupId = await saveGroup(admin.id, undefined, groupInput([courseId]));
  const { subscriptionId } = await paidFixture(groupId, "active", null);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  for (const status of ["trialing", "incomplete", "unpaid", "canceled", "paused"]) {
    await getDb().prepare("UPDATE membership_subscriptions SET status=?,paid_until=? WHERE stripe_id=?").run(status, future, subscriptionId);
    assert.equal(await hasCourseAccess(member.id, courseId), false, status);
  }
  for (const status of ["active", "past_due"]) {
    await getDb().prepare("UPDATE membership_subscriptions SET status=?,paid_until=? WHERE stripe_id=?").run(status, future, subscriptionId);
    assert.equal(await hasCourseAccess(member.id, courseId), true, status);
  }
  assert.equal((await getMembershipSettings()).salesEnabled, false);
  assert.deepEqual(await getPublicPlans(), []);
  assert.ok(await getAccessibleGroup(member.id, groupId));
  await getDb().prepare("UPDATE membership_subscriptions SET blocked=1 WHERE stripe_id=?").run(subscriptionId);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  await getDb().prepare("UPDATE membership_subscriptions SET blocked=0,paid_until='malformed' WHERE stripe_id=?").run(subscriptionId);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
});

test("manual membership requires verified existing students and future expiry; draft groups and courses stay private", async () => {
  const { courseId } = await courseFixture();
  const groupId = await saveGroup(admin.id, undefined, groupInput([courseId], { published: false }));
  for (const email of [unverified.email, admin.email, "missing@memberships.example.test"])
    await assert.rejects(assignGroup(admin.id, { email, groupId, expiresAt: null }), /verifierad/);
  await assert.rejects(assignGroup(admin.id, { email: member.email, groupId, expiresAt: past }), /framtida/);
  const assignmentId = await assignGroup(admin.id, { email: member.email, groupId, expiresAt: future });
  assert.equal(await getAccessibleGroup(member.id, groupId), undefined);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  const current = (await getAdminGroup(admin.id, groupId))!;
  await saveGroup(admin.id, groupId, { ...current, published: true, expectedUpdatedAt: current.updatedAt });
  assert.ok(await getAccessibleGroup(member.id, groupId));
  assert.ok((await getPortalGroups(member.id)).some(g => g.id === groupId));
  await getDb().prepare("UPDATE membership_assignments SET expires_at=? WHERE id=?").run(past, assignmentId);
  assert.equal(await getAccessibleGroup(member.id, groupId), undefined);
  await assignGroup(admin.id, { email: member.email, groupId, expiresAt: null });
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(member.id);
  assert.equal(await getAccessibleGroup(member.id, groupId), undefined);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), member.id);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  assert.equal(await hasCourseAccess(member.id, courseId), false);
  assert.deepEqual((await getAccessibleGroup(member.id, groupId))!.courses, []);
});

test("membership grants apply to quizzes, assignments, progress and linked course material downloads", async () => {
  const { courseId, lessonId } = await courseFixture();
  const groupId = await saveGroup(admin.id, undefined, groupInput([courseId]));
  const assignmentId = await assignGroup(admin.id, { email: member.email, groupId, expiresAt: null });
  const quizId = await saveCourseActivity(admin.id, { courseId, lessonId, kind: "quiz", title: "Kunskapsquiz", instructions: "Svara", position: 1, active: true,
    passPercent: 100, questions: [{ id: "q1", prompt: "Frågan", options: ["Rätt", "Fel"], correctOption: 0 }] });
  const taskId = await saveCourseActivity(admin.id, { courseId, lessonId, kind: "assignment", title: "Reflektion", instructions: "Skriv", position: 2, active: true });
  const fileId = randomUUID();
  await getDb().prepare("INSERT INTO uploads(id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,course_id,created_at) VALUES(?,'lesson-material','lesson.pdf','application/pdf',100,?,'local',?,?,?)")
    .run(fileId, `tibb/lesson-material/${fileId}.pdf`, admin.id, courseId, now());
  await getDb().prepare("INSERT INTO lesson_materials(lesson_id,upload_id) VALUES(?,?)").run(lessonId, fileId);
  assert.equal((await getStudentLessonActivities(member.id, courseId, lessonId)).length, 2);
  assert.ok((await submitQuiz(member.id, { activityId: quizId, courseId, lessonId, revision: 1, answers: [{ questionId: "q1", optionIndex: 0 }] })).passed);
  await saveAssignment(member.id, { activityId: taskId, courseId, lessonId, revision: 1, text: "Mitt reflektionssvar", submit: true });
  assert.ok(await getReadableUpload(fileId, member));
  assert.equal(await getReadableUpload(fileId, outsider), null);
  await removeAssignment(admin.id, assignmentId);
  await assert.rejects(getStudentLessonActivities(member.id, courseId, lessonId), /tillgång/);
  await assert.rejects(submitQuiz(member.id, { activityId: quizId, courseId, lessonId, revision: 1, answers: [{ questionId: "q1", optionIndex: 0 }] }), /tillgång/);
  await assert.rejects(saveAssignment(member.id, { activityId: taskId, courseId, lessonId, revision: 1, text: "Nytt svar", submit: true }), /tillgång/);
  assert.equal(await getReadableUpload(fileId, member), null);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) total FROM quiz_attempts WHERE user_id=? AND activity_id=?").get(member.id, quizId))!.total), 1);
});

test("posts and files require live group membership and publication; rich images and document references validate atomically", async () => {
  const groupId = await saveGroup(admin.id, undefined, groupInput());
  const otherGroup = await saveGroup(admin.id, undefined, groupInput());
  await assignGroup(admin.id, { email: member.email, groupId, expiresAt: null });
  const documentId = await uploadFixture(groupId, "document"), imageId = await uploadFixture(groupId, "image"), foreign = await uploadFixture(otherGroup, "document");
  const body = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Medlemsinnehåll" }] }, { type: "image" as const, attrs: { src: `/api/gruppfiler/${imageId}` } }] };
  const input = { groupId, title: "Månadens material", body, period: "2026-10", published: false, uploadIds: [documentId] };
  const postId = await savePost(admin.id, undefined, input);
  assert.equal(await getAccessiblePost(member.id, groupId, postId), undefined);
  assert.equal(await getReadableGroupUpload(documentId, member), null);
  const draft = (await getAdminPost(admin.id, groupId, postId))!;
  await savePost(admin.id, postId, { ...input, published: true, expectedUpdatedAt: draft.updatedAt });
  const published = (await getAccessiblePost(member.id, groupId, postId))!;
  assert.deepEqual(published.uploads.map(file => file.id), [documentId]);
  assert.ok(await getReadableGroupUpload(documentId, member)); assert.ok(await getReadableGroupUpload(imageId, member));
  assert.equal(await getReadableGroupUpload(documentId, outsider), null);
  assert.equal(await getAccessiblePost(member.id, otherGroup, postId), undefined);
  assert.deepEqual((await getGroupPosts(member.id, groupId)).map(p => p.id), [postId]);
  const links = await getDb().prepare("SELECT * FROM membership_post_uploads WHERE post_id=? ORDER BY upload_id").all(postId);
  for (const invalid of [
    { ...input, uploadIds: [foreign] }, { ...input, uploadIds: [imageId] },
    { ...input, body: "<script>alert(1)</script>" }, { ...input, period: "2026-13" },
    { ...input, body: { type: "doc", content: [{ type: "image", attrs: { src: "https://outside.example.test/image.png" } }] } },
  ]) await assert.rejects(savePost(admin.id, postId, { ...invalid, expectedUpdatedAt: published.updatedAt } as never));
  assert.deepEqual(await getDb().prepare("SELECT * FROM membership_post_uploads WHERE post_id=? ORDER BY upload_id").all(postId), links);
  assert.equal((await getAdminPost(admin.id, groupId, postId))!.updatedAt, published.updatedAt);
  await assert.rejects(savePost(admin.id, postId, { ...input, expectedUpdatedAt: draft.updatedAt }), /ändrats/);
  const group = (await getAdminGroup(admin.id, groupId))!;
  await saveGroup(admin.id, groupId, { ...group, published: false, expectedUpdatedAt: group.updatedAt });
  assert.equal(await getReadableGroupUpload(documentId, member), null);
  assert.equal(await getAccessiblePost(member.id, groupId, postId), undefined);
});

test("admin CAS prevents stale group/plan/settings writes and billed plans retain their original group", async () => {
  const { courseId } = await courseFixture();
  const groupId = await saveGroup(admin.id, undefined, groupInput([courseId]));
  const current = (await getAdminGroup(admin.id, groupId))!;
  await saveGroup(admin.id, groupId, { ...current, name: "Ny grupptext", expectedUpdatedAt: current.updatedAt });
  await assert.rejects(saveGroup(admin.id, groupId, { ...current, courseIds: [], expectedUpdatedAt: current.updatedAt }), /ändrats/);
  assert.deepEqual((await getAdminGroup(admin.id, groupId))!.courseIds, [courseId]);
  await assert.rejects(saveGroup(admin.id, groupId, { ...current, courseIds: [999999], expectedUpdatedAt: (await getAdminGroup(admin.id, groupId))!.updatedAt }), /kurser/);
  const { planId } = await paidFixture(groupId);
  const otherGroup = await saveGroup(admin.id, undefined, groupInput());
  const plan = (await getAdminPlan(admin.id, planId))!;
  await assert.rejects(savePlan(admin.id, planId, { ...plan, groupId: otherGroup, expectedUpdatedAt: plan.updatedAt }), /betalning/);
  await savePlan(admin.id, planId, { ...plan, priceOre: 24900, expectedUpdatedAt: plan.updatedAt });
  await assert.rejects(savePlan(admin.id, planId, { ...plan, expectedUpdatedAt: plan.updatedAt }), /ändrats/);
  assert.equal(Number((await getDb().prepare("SELECT price_ore FROM membership_subscriptions WHERE plan_id=?").get(planId))!.price_ore), 19900);
  const settings = await getMembershipSettings();
  await saveMembershipSettings(admin.id, { salesEnabled: false, terms: "Nya löpande medlemsvillkor", expectedUpdatedAt: settings.updatedAt });
  await assert.rejects(saveMembershipSettings(admin.id, { salesEnabled: false, terms: "Föråldrade medlemsvillkor", expectedUpdatedAt: settings.updatedAt }), /ändrats/);
  await assert.rejects(saveMembershipSettings(admin.id, { salesEnabled: true, terms: "Villkoren är godkända", expectedUpdatedAt: (await getMembershipSettings()).updatedAt }), /Stripe/);
  const target = (await getAdminGroup(admin.id, groupId))!;
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(admin.id);
  try {
    await assert.rejects(saveGroup(admin.id, groupId, { ...target, expectedUpdatedAt: target.updatedAt }), /behörighet/);
    await assert.rejects(getAdminAssignments(admin.id), /behörighet/);
    assert.equal(await hasCourseAccess(admin.id, courseId), false);
  } finally { await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id); }
});

test("sales activation validates terms, contact and publication; public plans disappear with hidden linked content", async () => {
  const keys = ["STRIPE_SECRET_KEY", "MEMBERSHIP_STRIPE_WEBHOOK_SECRET", "MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID", "APP_URL"] as const;
  const environment = new Map(keys.map(key => [key, process.env[key]]));
  const oldEmail = String((await getDb().prepare("SELECT email FROM settings WHERE id=1").get())!.email);
  const original = await getMembershipSettings();
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_isolated_membership_fixture";
    process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET = "whsec_isolated_membership_fixture";
    process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID = "bpc_isolated_membership_fixture";
    process.env.APP_URL = "https://memberships.example.test";
    const enabled = { salesEnabled: true, terms: "Villkor för löpande medlemskap, uppsägning och betalning.", expectedUpdatedAt: original.updatedAt };
    await getDb().prepare("UPDATE settings SET email='' WHERE id=1").run();
    await assert.rejects(saveMembershipSettings(admin.id, enabled), /kontaktadress/);
    await getDb().prepare("UPDATE settings SET email='contact@memberships.example.test' WHERE id=1").run();
    await assert.rejects(saveMembershipSettings(admin.id, { ...enabled, terms: "" }), /medlemsvillkor/);
    const { courseId } = await courseFixture();
    const groupId = await saveGroup(admin.id, undefined, groupInput([courseId]));
    const planId = await savePlan(admin.id, undefined, planInput(groupId));
    const plan = (await getAdminPlan(admin.id, planId))!;
    await saveMembershipSettings(admin.id, enabled);
    assert.equal((await getPublicPlan(plan.slug))!.id, planId);
    assert.deepEqual((await getPublicPlanCourses(planId)).map(course => course.id), [courseId]);
    await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
    assert.equal(await getPublicPlan(plan.slug), undefined);
    assert.deepEqual(await getPublicPlanCourses(planId), []);
    await getDb().prepare("UPDATE courses SET published=1 WHERE id=?").run(courseId);
    const group = (await getAdminGroup(admin.id, groupId))!;
    await saveGroup(admin.id, groupId, { ...group, published: false, expectedUpdatedAt: group.updatedAt });
    assert.equal(await getPublicPlan(plan.slug), undefined);
  } finally {
    await saveMembershipSettings(admin.id, { salesEnabled: false, terms: original.terms, expectedUpdatedAt: (await getMembershipSettings()).updatedAt });
    await getDb().prepare("UPDATE settings SET email=? WHERE id=1").run(oldEmail);
    for (const key of keys) {
      const value = environment.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
