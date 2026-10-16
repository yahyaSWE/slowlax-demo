import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pglitePostgres } from "./helpers/pglite-postgres";
import { PostgresDatabaseAdapter } from "../src/lib/postgres-database";
import { createFirstAdmin, createUser, getCourseSummaries, getDb, getPortalCourseSummaries, getUserByEmail, hasCourseAccess, transaction, type User } from "../src/lib/db";
import { getCourseBundle, getPublicCourseBundle, saveCourseBundle } from "../src/lib/course-bundles";
import { getCoursePurchaseOffer, getCourseSalesSettings, saveCourseSalesSettings } from "../src/lib/course-sales";
import { getCoursePurchaseConfirmation, getUserCoursePurchases } from "../src/lib/course-purchase-billing";
import { assignGroup, getAccessibleGroup, getAdminPlan, getMembershipPlanGroups, saveGroup, savePlan } from "../src/lib/memberships";
import { getAdminSubscriptions, getUserSubscriptions } from "../src/lib/membership-billing";
import { getStudentGroupAccessStates } from "../src/lib/student-access";
import { saveCourseActivity, submitQuiz } from "../src/lib/course-activities";
import { getStudentCourseLearningStatus } from "../src/lib/course-learning-status";

// These credentials select an injected in-process PostgreSQL engine. No
// network connection, Supabase project or payment provider is contacted.
for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "SUPABASE_AUTH_ENABLED", "KIT_API_KEY"]) delete process.env[key];
process.env.DATABASE_URL = "postgres://test:test@localhost/test";
process.env.SUPABASE_DATABASE_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_postgres_domain_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_postgres_domain_fixture";
process.env.APP_URL = "https://postgres-domain.example.test";
let admin: User, buyer: User, legacy: User, adapter: PostgresDatabaseAdapter;
const now = () => new Date().toISOString();
const token = () => randomBytes(16).toString("hex");

before(async () => {
  adapter = getDb() as PostgresDatabaseAdapter;
  assert.ok(adapter instanceof PostgresDatabaseAdapter);
  await pglitePostgres(adapter);
  await adapter.migrate();
  admin = await createFirstAdmin({ name: "PostgreSQL admin", email: "pg-admin@example.test", passwordHash: "fixture" });
  buyer = await createUser({ name: "PostgreSQL buyer", email: "pg-buyer@example.test", role: "student", passwordHash: "fixture" });
  legacy = await createUser({ name: "Legacy student", email: "pg-legacy@example.test", role: "student", passwordHash: "fixture" });
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(now(), buyer.id, legacy.id);
  await getDb().prepare("UPDATE settings SET email='pg-contact@example.test' WHERE id=1").run();
});
after(async () => { await adapter?.close(); });

async function courseFixture(title: string) {
  const timestamp = now();
  const id = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,250000,1,?,?)")
    .run(title, `pg-course-${token()}`, "Private course description", timestamp, timestamp)).lastInsertRowid);
  const lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,?,?)")
    .run(id, "PostgreSQL lesson", "Private lesson body")).lastInsertRowid);
  return { id, lessonId };
}
async function groupFixture(courseIds: number[] = []) {
  return saveGroup(admin.id, undefined, { name: `Group ${token()}`, slug: `pg-group-${token()}`, description: "Private group material", published: true, courseIds });
}

/** A local verified-source fixture, exercising the same immutable snapshot
 * and grant constraints as the signed-webhook integration tests. */
async function purchaseFixture(userId: number, courseId: number, paidDaysAgo = 0) {
  const offer = (await getCoursePurchaseOffer(courseId))!;
  assert.ok(offer);
  const id = token(), timestamp = now(), paidAt = new Date(Date.now() - 1000 - paidDaysAgo * 86400000).toISOString();
  const groupExpiry = offer.groupAccessDays === null ? null : new Date(Date.parse(paidAt) + offer.groupAccessDays * 86400000).toISOString();
  const store = (revoked: boolean) => getDb().prepare(`INSERT INTO course_purchases
    (id,attempt_id,user_id,course_id,group_id,group_expires_at,session_id,payment_intent_id,charge_id,price_ore,vat_percent,paid_at,revoked,revocation_reason,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET
    revoked=MAX(course_purchases.revoked,excluded.revoked),revocation_reason=COALESCE(course_purchases.revocation_reason,excluded.revocation_reason),updated_at=excluded.updated_at`)
    .run(id, id, userId, courseId, offer.groupId, groupExpiry, `cs_${id}`, `pi_${id}`, `ch_${id}`, offer.priceOre, offer.vatPercent, paidAt, Number(revoked), revoked ? "refund-or-dispute" : null, now());
  await transaction(async () => {
    await getDb().prepare("INSERT INTO course_purchase_customers(user_id,stripe_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING").run(userId, `cus_pg_${userId}`, timestamp);
    await getDb().prepare(`INSERT INTO course_purchase_attempts
      (id,user_id,course_id,course_title,course_slug,course_revision,settings_revision,terms,price_ore,vat_percent,group_id,group_name,group_access_days,status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?)`)
      .run(id, userId, courseId, offer.title, offer.slug, offer.courseRevision, offer.settingsRevision, offer.terms, offer.priceOre, offer.vatPercent,
        offer.groupId, offer.groupName, offer.groupAccessDays, new Date(Date.now() + 3600000).toISOString(), timestamp, timestamp);
    for (const course of offer.courses) await getDb().prepare("INSERT INTO course_purchase_attempt_courses(attempt_id,course_id,title,slug) VALUES(?,?,?,?)").run(id, course.id, course.title, course.slug);
    for (const group of offer.groups) await getDb().prepare("INSERT INTO course_purchase_attempt_groups(attempt_id,group_id,group_name,access_days) VALUES(?,?,?,?)").run(id, group.id, group.name, group.accessDays);
    await getDb().prepare("UPDATE course_purchase_attempts SET customer_id=?,session_id=?,status='paid' WHERE id=?").run(`cus_pg_${userId}`, `cs_${id}`, id);
    await store(false);
  });
  return { id, paidAt, groupExpiry, store };
}

async function subscriptionFixture(userId: number, planId: number, withSnapshot: boolean) {
  const plan = (await getAdminPlan(admin.id, planId))!, id = token(), timestamp = now();
  await transaction(async () => {
    await getDb().prepare("INSERT INTO membership_customers(user_id,stripe_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING").run(userId, `cus_pg_membership_${userId}`, timestamp);
    await getDb().prepare(`INSERT INTO membership_checkout_attempts
      (id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?)`)
      .run(id, userId, planId, plan.groupId, "Accepted membership terms", plan.priceOre, plan.vatPercent, plan.interval, plan.name, plan.slug, plan.updatedAt, timestamp,
        new Date(Date.now() + 3600000).toISOString(), timestamp, timestamp);
    if (withSnapshot) for (const group of await getMembershipPlanGroups(planId))
      await getDb().prepare("INSERT INTO membership_attempt_groups(attempt_id,group_id,group_name) VALUES(?,?,?)").run(id, group.id, group.name);
    await getDb().prepare("UPDATE membership_checkout_attempts SET customer_id=?,session_id=?,status='subscribed' WHERE id=?").run(`cus_pg_membership_${userId}`, `cs_${id}`, id);
    await getDb().prepare(`INSERT INTO membership_subscriptions
      (stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,blocked,cancel_at_period_end,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
      VALUES(?,?,?,?,?,'active',?,0,0,?,?,?,?,?,?,?)`)
      .run(`sub_${id}`, userId, planId, plan.groupId, id, new Date(Date.now() + 30 * 86400000).toISOString(), `cus_pg_membership_${userId}`, `price_${id}`, plan.priceOre,
        plan.vatPercent, plan.interval, timestamp, timestamp);
  });
  return `sub_${id}`;
}

test("PostgreSQL bundles preserve paid child courses and snapshot groups across offer changes; refunds stay source-specific", async () => {
  const first = await courseFixture("First bundle course"), second = await courseFixture("Second bundle course");
  const groupA = await groupFixture(), groupB = await groupFixture();
  const input = { title: "PostgreSQL Bas-kit", slug: `pg-bundle-${token()}`, description: "Two courses, two groups", priceOre: 399000, published: true, courseIds: [first.id, second.id] };
  const bundleId = await saveCourseBundle(admin.id, undefined, input);
  await saveCourseSalesSettings(admin.id, bundleId, { enabled: true, groupId: groupA, groupIds: [groupA, groupB], groupAccessDays: 90, vatPercent: 25,
    terms: "Permanent access to both courses and ninety days in both groups.", expectedUpdatedAt: null });
  const purchase = await purchaseFixture(buyer.id, bundleId);
  assert.equal(await hasCourseAccess(buyer.id, first.id), true); assert.equal(await hasCourseAccess(buyer.id, second.id), true);
  assert.ok(await getAccessibleGroup(buyer.id, groupB));
  const current = (await getCourseBundle(bundleId, admin.id))!;
  await saveCourseBundle(admin.id, bundleId, { ...input, published: false, expectedUpdatedAt: current.updatedAt });
  await assert.rejects(saveCourseBundle(admin.id, bundleId, { ...input, expectedUpdatedAt: current.updatedAt }), /ändrats/);
  const sales = await getCourseSalesSettings(bundleId);
  await saveCourseSalesSettings(admin.id, bundleId, { enabled: false, groupId: null, groupIds: [], groupAccessDays: null, vatPercent: 25, terms: "Changed offer terms", expectedUpdatedAt: sales.updatedAt });
  assert.equal(await getPublicCourseBundle(input.slug), undefined);
  assert.equal(await hasCourseAccess(buyer.id, first.id), true);
  const confirmation = (await getCoursePurchaseConfirmation(buyer.id, `cs_${purchase.id}`))!;
  assert.equal(confirmation.confirmed, true); assert.equal(confirmation.courseAvailable, true);
  assert.deepEqual(confirmation.courses.map(course => course.id).sort(), [first.id, second.id].sort());
  assert.equal(confirmation.groups.find(group => group.id === groupB)!.expiresAt, purchase.groupExpiry);
  assert.equal((await getStudentGroupAccessStates(buyer.id)).find(group => group.id === groupB)!.available, true);
  assert.equal((await getCourseSummaries()).find(course => course.id === first.id)!.enrollmentCount, 1);
  assert.equal((await getPortalCourseSummaries(buyer.id)).some(course => course.id === bundleId), false);
  await assert.rejects(getDb().prepare("UPDATE course_purchase_attempt_courses SET title='Tampered' WHERE attempt_id=?").run(purchase.id), /immutable/);
  await assert.rejects(getDb().prepare("DELETE FROM course_purchase_attempt_groups WHERE attempt_id=?").run(purchase.id), /immutable/);
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(buyer.id, first.id, now());
  await assignGroup(admin.id, { email: buyer.email, groupId: groupB, expiresAt: null });
  await purchase.store(true); await purchase.store(false);
  assert.equal((await getUserCoursePurchases(buyer.id)).find(record => record.id === purchase.id)!.revoked, true);
  assert.equal(await hasCourseAccess(buyer.id, first.id), true); assert.equal(await hasCourseAccess(buyer.id, second.id), false);
  assert.equal(await getAccessibleGroup(buyer.id, groupA), undefined); assert.ok(await getAccessibleGroup(buyer.id, groupB));
});

test("PostgreSQL membership snapshots grant every group while legacy contracts keep only their original group", async () => {
  const first = await courseFixture("First member course"), second = await courseFixture("Second member course");
  const groupA = await groupFixture([first.id]), groupB = await groupFixture([second.id]), futureGroup = await groupFixture();
  const planId = await savePlan(admin.id, undefined, { name: "PostgreSQL membership", slug: `pg-plan-${token()}`, description: "Two groups", groupId: groupA,
    groupIds: [groupA, groupB], priceOre: 9900, vatPercent: 25, interval: "month", published: true });
  const currentSource = await subscriptionFixture(buyer.id, planId, true);
  await subscriptionFixture(legacy.id, planId, false);
  assert.equal(await hasCourseAccess(buyer.id, second.id), true); assert.equal(await hasCourseAccess(legacy.id, second.id), false);
  const plan = (await getAdminPlan(admin.id, planId))!;
  await savePlan(admin.id, planId, { ...plan, groupIds: [groupA, futureGroup], expectedUpdatedAt: plan.updatedAt });
  assert.ok(await getAccessibleGroup(buyer.id, groupB)); assert.equal(await getAccessibleGroup(buyer.id, futureGroup), undefined);
  assert.equal((await getAdminSubscriptions(admin.id, groupB)).find(source => source.stripeId === currentSource)!.groups.length, 2);
  const states = await getStudentGroupAccessStates(buyer.id);
  assert.equal(states.find(state => state.id === groupB)!.status, "active");
  await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(groupA);
  assert.equal((await getUserSubscriptions(buyer.id)).find(source => source.stripeId === currentSource)!.hasAccess, true);
  await assignGroup(admin.id, { email: buyer.email, groupId: groupB, expiresAt: null });
  await getDb().prepare("UPDATE membership_subscriptions SET blocked=1 WHERE stripe_id=?").run(currentSource);
  assert.equal(await hasCourseAccess(buyer.id, first.id), false); assert.equal(await hasCourseAccess(buyer.id, second.id), true);
  const union = (await getStudentGroupAccessStates(buyer.id)).find(state => state.id === groupB)!;
  assert.equal(union.expiresAt, null); assert.deepEqual(union.sources, ["manual"]);
});

test("PostgreSQL account lookup, quiz JSON status and concurrent attempt numbering preserve SQLite domain behavior", async () => {
  assert.equal((await getUserByEmail(buyer.email.toUpperCase()))!.id, buyer.id);
  await assert.rejects(getDb().prepare("INSERT INTO users(email,name,password_hash,role,created_at) VALUES(?,?,'fixture','student',?)")
    .run(buyer.email.toUpperCase(), "Case duplicate", now()), /unique|duplicate/i);
  const course = await courseFixture("Quiz SQL dialect");
  await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(buyer.id, course.id, now());
  const activityId = await saveCourseActivity(admin.id, { courseId: course.id, lessonId: course.lessonId, kind: "quiz", title: "JSON title åäö", instructions: "Choose one",
    position: 1, active: true, passPercent: 100, questions: [{ id: "first", prompt: "Question", options: ["Correct", "Incorrect"], correctOption: 0 }] });
  const answer = { courseId: course.id, lessonId: course.lessonId, activityId, revision: 1, answers: [{ questionId: "first", optionIndex: 0 }] };
  await Promise.all([submitQuiz(buyer.id, answer), submitQuiz(buyer.id, answer)]);
  const attempts = await getDb().prepare("SELECT attempt_number FROM quiz_attempts WHERE user_id=? AND activity_id=? ORDER BY attempt_number").all(buyer.id, activityId);
  assert.deepEqual(attempts.map(attempt => Number(attempt.attempt_number)), [1, 2]);
  const status = await getStudentCourseLearningStatus(buyer.id, course.id);
  assert.equal(status.activities[0].title, "JSON title åäö"); assert.equal(status.activities[0].status, "passed");
  assert.doesNotMatch(JSON.stringify(status), /correctOption|Private lesson body/);
});

test("PostgreSQL date checks expire only group access, reject invalid dates safely and preserve snapshot cascade constraints", async () => {
  const bought = await courseFixture("Permanent purchase"), bonus = await courseFixture("Expired group bonus");
  const group = await groupFixture([bonus.id]);
  await saveCourseSalesSettings(admin.id, bought.id, { enabled: true, groupId: group, groupAccessDays: 2, vatPercent: 25,
    terms: "The purchased course remains available after two days of group access.", expectedUpdatedAt: null });
  const purchase = await purchaseFixture(legacy.id, bought.id, 3);
  assert.equal(await hasCourseAccess(legacy.id, bought.id), true); assert.equal(await hasCourseAccess(legacy.id, bonus.id), false);
  const expired = (await getStudentGroupAccessStates(legacy.id)).find(state => state.id === group)!;
  assert.equal(expired.status, "expired"); assert.equal(expired.expiresAt, purchase.groupExpiry);
  const invalidGroup = await groupFixture();
  await getDb().prepare("INSERT INTO membership_assignments(user_id,group_id,expires_at,created_at,updated_at) VALUES(?,?,'not-a-date',?,?)")
    .run(legacy.id, invalidGroup, now(), now());
  assert.equal(await getAccessibleGroup(legacy.id, invalidGroup), undefined);
  const invalid = (await getStudentGroupAccessStates(legacy.id)).find(state => state.id === invalidGroup)!;
  assert.equal(invalid.available, false); assert.equal(invalid.status, "expired");
  await assert.rejects(getDb().prepare("DELETE FROM course_purchase_attempt_courses WHERE attempt_id=?").run(purchase.id), /immutable/);
  // Parent-source deletion is permitted only after its paid source is gone;
  // FK cascades must not be mistaken for a direct snapshot rewrite.
  await transaction(async () => {
    await getDb().prepare("DELETE FROM course_purchases WHERE attempt_id=?").run(purchase.id);
    await getDb().prepare("DELETE FROM course_purchase_attempts WHERE id=?").run(purchase.id);
  });
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) total FROM course_purchase_attempt_courses WHERE attempt_id=?").get(purchase.id))!.total), 0);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) total FROM course_purchase_attempt_groups WHERE attempt_id=?").get(purchase.id))!.total), 0);
});
