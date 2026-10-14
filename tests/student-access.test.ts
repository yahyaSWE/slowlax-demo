import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getDb, type User } from "../src/lib/db";
import { getStudentGroupAccessState, getStudentGroupAccessStates, getStudentGroupPostAccessState, getStudentCourseAccessState } from "../src/lib/student-access";
import { getUserCoursePurchases, getCoursePurchaseConfirmation } from "../src/lib/course-purchase-billing";
import { getAccessibleGroup, getGroupPosts, getPortalGroups } from "../src/lib/memberships";

const directory = mkdtempSync(join(tmpdir(), "tibb-student-access-"));
delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;
delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET;
process.env.TIBB_DATABASE_PATH = join(directory, "student-access.sqlite");
let admin: User, member: User, outsider: User, unverified: User;
const now = () => new Date().toISOString(), future = "2090-01-01T00:00:00.000Z", past = "2000-01-01T00:00:00.000Z";

before(async () => {
  admin = await createFirstAdmin({ name: "Admin", email: "admin@access.example.test", passwordHash: "isolated" });
  member = await createUser({ name: "Member", email: "member@access.example.test", passwordHash: "isolated", role: "student" });
  outsider = await createUser({ name: "Outside", email: "outside@access.example.test", passwordHash: "isolated", role: "student" });
  unverified = await createUser({ name: "Unverified", email: "unverified@access.example.test", passwordHash: "isolated", role: "student" });
  for (const user of [member, outsider]) await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), user.id);
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("tibb-student-access-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

async function fixture() {
  const courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,?,1,?,?)")
    .run("Owned course", randomUUID(), "Do not leak course description", 499000, now(), now())).lastInsertRowid);
  const groupId = Number((await getDb().prepare("INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES(?,?,?,1,?,?)")
    .run("Owned group", randomUUID(), "Do not leak private group description", now(), now())).lastInsertRowid);
  await getDb().prepare("INSERT INTO membership_group_courses VALUES(?,?)").run(groupId, courseId);
  await getDb().prepare("INSERT INTO membership_posts(group_id,title,published,created_at,updated_at) VALUES(?,?,1,?,?)").run(groupId, "Do not leak private post", now(), now());
  return { groupId, courseId };
}
async function manual(groupId: number, expiresAt: string | null) {
  return Number((await getDb().prepare("INSERT INTO membership_assignments(user_id,group_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(member.id, groupId, expiresAt, now(), now())).lastInsertRowid);
}
async function subscription(groupId: number, paidUntil: string) {
  const planId = Number((await getDb().prepare("INSERT INTO membership_plans(group_id,name,slug,price_ore,vat_percent,interval,created_at,updated_at) VALUES(?,?,?,19900,25,'month',?,?)")
    .run(groupId, "Plan", randomUUID(), now(), now())).lastInsertRowid);
  const attemptId = randomUUID(), customerId = `cus_access_${member.id}`, subscriptionId = `sub_access_${randomUUID()}`;
  await getDb().prepare("INSERT OR IGNORE INTO membership_customers VALUES(?,?,?)").run(member.id, customerId, now());
  await getDb().prepare(`INSERT INTO membership_checkout_attempts(id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,customer_id,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,'Accepted terms',19900,25,'month','Plan',?,?,?,'subscribed',?,?,?,?)`)
    .run(attemptId, member.id, planId, groupId, randomUUID(), now(), now(), customerId, future, now(), now());
  await getDb().prepare(`INSERT INTO membership_subscriptions(stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
    VALUES(?,?,?,?,?,'active',?,?,?,19900,25,'month',?,?)`)
    .run(subscriptionId, member.id, planId, groupId, attemptId, paidUntil, customerId, `price_${planId}`, now(), now());
  return subscriptionId;
}
async function purchase(courseId: number, groupId: number, paidAt: string) {
  const attemptId = randomUUID().replaceAll("-", ""), sessionId = `cs_access_${attemptId}`, customerId = `cus_purchase_access_${member.id}`;
  const expiresAt = new Date(Date.parse(paidAt) + 86400000).toISOString();
  await getDb().prepare("INSERT OR IGNORE INTO course_purchase_customers VALUES(?,?,?)").run(member.id, customerId, now());
  await getDb().prepare(`INSERT INTO course_purchase_attempts(id,user_id,course_id,course_title,course_slug,course_revision,settings_revision,terms,price_ore,vat_percent,group_id,group_name,group_access_days,status,session_id,customer_id,expires_at,created_at,updated_at)
    VALUES(?,?,?,'Owned course','owned-course',?,?,'Accepted terms',499000,25,?,'Owned group',1,'paid',?,?,?,?,?)`)
    .run(attemptId, member.id, courseId, now(), now(), groupId, sessionId, customerId, future, now(), now());
  await getDb().prepare(`INSERT INTO course_purchases(id,attempt_id,user_id,course_id,group_id,group_expires_at,session_id,payment_intent_id,charge_id,price_ore,vat_percent,paid_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,499000,25,?,?)`)
    .run(attemptId, attemptId, member.id, courseId, groupId, expiresAt, sessionId, `pi_${attemptId}`, `ch_${attemptId}`, paidAt, now());
  return { id: attemptId, sessionId, expiresAt };
}

test("effective group access unions active sources, uses latest expiry, and preserves an unlimited grant", async () => {
  const { groupId, courseId } = await fixture();
  const assignmentId = await manual(groupId, null), subscriptionId = await subscription(groupId, future);
  let state = (await getStudentGroupAccessState(member.id, groupId))!;
  assert.equal(state.available, true); assert.equal(state.expiresAt, null);
  assert.deepEqual(state.sources, ["manual", "subscription"]);
  await getDb().prepare("UPDATE membership_assignments SET expires_at=? WHERE id=?").run("2080-01-01T00:00:00.000Z", assignmentId);
  state = (await getStudentGroupAccessState(member.id, groupId))!;
  assert.equal(state.expiresAt, future);
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.expiresAt, future);
  assert.equal((await getPortalGroups(member.id)).find(group => group.id === groupId)?.access?.expiresAt, future);
  await getDb().prepare("UPDATE membership_assignments SET expires_at=? WHERE id=?").run(past, assignmentId);
  await getDb().prepare("UPDATE membership_subscriptions SET blocked=1 WHERE stripe_id=?").run(subscriptionId);
  state = (await getStudentGroupAccessState(member.id, groupId))!;
  assert.equal(state.available, false); assert.equal(state.status, "expired");
  assert.equal(await getAccessibleGroup(member.id, groupId), undefined);
  assert.deepEqual(await getGroupPosts(member.id, groupId), []);
});

test("expired group from course purchase preserves permanent course, while revoked source respects independent grants", async () => {
  const { groupId, courseId } = await fixture(), paid = await purchase(courseId, groupId, past);
  assert.equal((await getStudentGroupAccessState(member.id, groupId))?.status, "expired");
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.available, true);
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.expiresAt, null);
  let record = (await getUserCoursePurchases(member.id)).find(record => record.id === paid.id)!;
  assert.equal(record.courseAvailable, true); assert.equal(record.groupAvailable, false);
  const lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,?,?)").run(courseId, "Private lesson", "Private body")).lastInsertRowid);
  await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(member.id, lessonId, now());
  await getDb().prepare("UPDATE course_purchases SET revoked=1,revocation_reason='test refund' WHERE id=?").run(paid.id);
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.status, "blocked");
  record = (await getUserCoursePurchases(member.id)).find(record => record.id === paid.id)!;
  assert.equal(record.courseAvailable, false); assert.equal(record.groupAvailable, false);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(member.id, courseId, now());
  await manual(groupId, null);
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.available, true);
  record = (await getUserCoursePurchases(member.id)).find(record => record.id === paid.id)!;
  assert.equal(record.revoked, true); assert.equal(record.courseAvailable, true); assert.equal(record.groupAvailable, true);
  const confirmation = (await getCoursePurchaseConfirmation(member.id, paid.sessionId))!;
  assert.equal(confirmation.status, "blocked"); assert.equal(confirmation.courseAvailable, true); assert.equal(confirmation.groupAvailable, true);
  assert.equal(await getCoursePurchaseConfirmation(outsider.id, paid.sessionId), null);
});

test("history never exposes content or another student's identities and current publication, verification and role gate access", async () => {
  const { groupId, courseId } = await fixture();
  assert.equal(await getStudentGroupAccessState(member.id, groupId), undefined);
  assert.equal(await getStudentCourseAccessState(member.id, courseId), undefined);
  await manual(groupId, past);
  const state = (await getStudentGroupAccessState(member.id, groupId))!;
  assert.equal(state.status, "expired");
  assert.deepEqual(Object.keys(state).sort(), ["available", "expiresAt", "id", "sources", "status", "title"]);
  assert.equal(await getStudentGroupAccessState(outsider.id, groupId), undefined);
  assert.equal(await getStudentCourseAccessState(outsider.id, courseId), undefined);
  assert.deepEqual(await getStudentGroupAccessStates(unverified.id), []);
  assert.deepEqual(await getStudentGroupAccessStates(admin.id), []);
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupId);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  assert.equal((await getStudentGroupAccessState(member.id, groupId))?.status, "unpublished");
  assert.equal(await getStudentCourseAccessState(member.id, courseId), undefined);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(member.id, courseId, now());
  assert.equal((await getStudentCourseAccessState(member.id, courseId))?.status, "unpublished");
  const post = await getDb().prepare("SELECT id FROM membership_posts WHERE group_id=?").get(groupId);
  assert.equal((await getStudentGroupPostAccessState(member.id, groupId, Number(post!.id)))?.status, "unpublished");
  assert.equal(await getStudentGroupPostAccessState(member.id, groupId, 999999999), undefined);
  assert.equal(await getStudentGroupPostAccessState(outsider.id, groupId, Number(post!.id)), undefined);
  await getDb().prepare("UPDATE membership_posts SET published=0 WHERE id=?").run(Number(post!.id));
  assert.equal(await getStudentGroupPostAccessState(member.id, groupId, Number(post!.id)), undefined);
  assert.deepEqual(await getGroupPosts(member.id, groupId), []);
  await getDb().prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").run(member.id);
  assert.equal(await getStudentGroupAccessState(member.id, groupId), undefined);
  assert.equal(await getStudentCourseAccessState(member.id, courseId), undefined);
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), member.id);
  assert.equal(await getStudentGroupAccessState(member.id, 999999999), undefined);
  assert.equal(await getStudentCourseAccessState(member.id, NaN), undefined);
});
