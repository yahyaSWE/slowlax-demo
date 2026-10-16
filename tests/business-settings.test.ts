import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getCourses, getDb, type User } from "../src/lib/db";
import { saveCourse } from "../src/lib/admin";
import { hashPassword } from "../src/lib/security";
import { getBusinessSettings, getCourseInformation, saveBusinessSettings, saveCourseInformation, getBookingTerms, recordBookingTermsSnapshot } from "../src/lib/business-settings";
import { DEFAULT_BUSINESS_SETTINGS, EMPTY_COURSE_INFORMATION, businessSettingsSchema, missingPrivacyInformation } from "../src/lib/business-config";

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
const directory = mkdtempSync(join(tmpdir(), "tibb-business-tests-"));
process.env.TIBB_DATABASE_PATH = join(directory, "tibb.sqlite");
let admin: User;
let student: User;
before(async () => {
  admin = await createFirstAdmin({ name: "Business Admin", email: "business-admin@example.test", passwordHash: hashPassword("business admin fixture password") });
  student = await createUser({ name: "Business Student", email: "business-student@example.test", role: "student", passwordHash: hashPassword("business student fixture password") });
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-business-tests-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("Slowlax defaults do not invent legal identity, access duration or privacy decisions", async () => {
  assert.deepEqual(await getBusinessSettings(), DEFAULT_BUSINESS_SETTINGS);
  assert.equal(DEFAULT_BUSINESS_SETTINGS.legalName, "");
  assert.equal(DEFAULT_BUSINESS_SETTINGS.organizationNumber, "");
  assert.equal(DEFAULT_BUSINESS_SETTINGS.cancellationHours, 24);
  assert.equal(DEFAULT_BUSINESS_SETTINGS.cancellationDetails, "");
  assert.equal(missingPrivacyInformation(DEFAULT_BUSINESS_SETTINGS).length, 3);
  assert.doesNotMatch(DEFAULT_BUSINESS_SETTINGS.courseAccessDescription, /utan tidsgräns/);
  assert.equal(businessSettingsSchema.safeParse(DEFAULT_BUSINESS_SETTINGS).success, true);
});

test("business information persists validated values and rejects non-admin or stale-role callers", async () => {
  const input = { ...DEFAULT_BUSINESS_SETTINGS, cancellationHours: 48,
    bookingRetention: "Enligt beslutade kriterier för testverksamheten.", studentRetention: "Kriterier för elevuppgifter.",
    legalBasis: "Bedömning för testverksamheten.", internationalTransfers: "Leverantörsavtal i testverksamheten." };
  await assert.rejects(saveBusinessSettings(student.id, input), /administrationen/);
  await assert.rejects(saveBusinessSettings(999999, input), /administrationen/);
  await saveBusinessSettings(admin.id, input);
  assert.deepEqual(await getBusinessSettings(), input);
  assert.deepEqual(missingPrivacyInformation(input), []);
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(admin.id);
  await assert.rejects(saveBusinessSettings(admin.id, DEFAULT_BUSINESS_SETTINGS), /administrationen/);
  await getDb().prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  assert.deepEqual(await getBusinessSettings(), input);
});

test("invalid company, cancellation bounds and overlong terms never overwrite stored settings", async () => {
  const before = await getBusinessSettings();
  for (const bad of [{ organizationNumber: "123" }, { cancellationHours: 0 }, { cancellationHours: 337 }, { cancellationHours: 2.5 }, { additionalPrivacy: "x".repeat(5001) }]) {
    assert.equal(businessSettingsSchema.safeParse({ ...before, ...bad }).success, false);
    await assert.rejects(saveBusinessSettings(admin.id, { ...before, ...bad }));
    assert.deepEqual(await getBusinessSettings(), before);
  }
});

test("course information is isolated by course creation and checks admin and course existence", async () => {
  await saveCourse(admin.id, { title: "Business Test Course", slug: "business-test-course", description: "Course fixture", price: "4990", published: false });
  const course = (await getCourses()).find((item) => item.slug === "business-test-course")!;
  const input = { audience: "Målgrupp", prerequisites: "Förkunskaper", learningOutcomes: "Mål för kursen", completionRequirements: "Genomförande" };
  assert.deepEqual(await getCourseInformation(course), EMPTY_COURSE_INFORMATION);
  await assert.rejects(saveCourseInformation(student.id, course.id, input), /administrationen/);
  await assert.rejects(saveCourseInformation(admin.id, 999999, input), /finns inte/);
  await saveCourseInformation(admin.id, course.id, input);
  assert.deepEqual(await getCourseInformation(course), input);
  assert.deepEqual(await getCourseInformation({ id: course.id, createdAt: "2099-01-01T00:00:00.000Z" }), EMPTY_COURSE_INFORMATION);
  await assert.rejects(saveCourseInformation(admin.id, course.id, { ...input, learningOutcomes: "x".repeat(4001) }));
  assert.deepEqual(await getCourseInformation(course), input);
});

test("recorded booking terms stay immutable when general terms change", async () => {
  const reference = "f".repeat(32);
  const old = await getBusinessSettings();
  assert.equal(await getBookingTerms(reference), null);
  await recordBookingTermsSnapshot({ reference, createdAt: new Date().toISOString() });
  await saveBusinessSettings(admin.id, { ...old, cancellationHours: 72, cancellationDetails: "Nya allmänna villkor." });
  await recordBookingTermsSnapshot({ reference, createdAt: new Date().toISOString() });
  const recorded = await getBookingTerms(reference);
  assert.equal(recorded?.cancellationHours, old.cancellationHours);
  assert.equal(recorded?.cancellationDetails, old.cancellationDetails);
  assert.equal((await getBusinessSettings()).cancellationHours, 72);
  assert.equal(await getBookingTerms("../../users"), null);
});
