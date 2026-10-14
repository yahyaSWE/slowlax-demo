import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getDb, getCourseProgress, type User } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import { getStudentCourseLearningStatus } from "../src/lib/course-learning-status";
import { reviewAssignment, saveAssignment, saveCourseActivity, submitQuiz } from "../src/lib/course-activities";
import type { CourseActivityInput } from "../src/lib/types";

const directory = mkdtempSync(join(tmpdir(), "tibb-learning-status-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "learning-status.sqlite");
let admin: User, student: User, other: User, outsider: User;
let courseId: number, lessonId: number;
const question = { id: "a", prompt: "Fråga", options: ["Rätt", "Fel"], correctOption: 0 };
function activity(kind: "quiz" | "assignment", overrides: Partial<CourseActivityInput> = {}): CourseActivityInput {
  return { courseId, lessonId, kind, title: kind === "quiz" ? "Quiz" : "Skrivuppgift", instructions: "Instruktion", position: 1, active: true,
    ...(kind === "quiz" ? { questions: [question], passPercent: 100 } : {}), ...overrides };
}
function quizInput(activityId: number, optionIndex = 0, revision = 1) {
  return { courseId, lessonId, activityId, revision, answers: [{ questionId: "a", optionIndex }] };
}
function assignmentInput(activityId: number, submit = true, revision = 1) {
  return { courseId, lessonId, activityId, revision, submit, text: "Privat elevtext" };
}
before(async () => {
  admin = await createFirstAdmin({ name: "Teacher", email: "status-teacher@example.test", passwordHash: hashPassword("local test only teacher") });
  for (const name of ["student", "other", "outsider"]) {
    const user = await createUser({ name, email: `${name}@example.test`, role: "student", passwordHash: hashPassword("local test only student") });
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(new Date().toISOString(), user.id);
    if (name === "student") student = user;
    if (name === "other") other = user;
    if (name === "outsider") outsider = user;
  }
  const now = new Date().toISOString();
  courseId = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)").run("Status course", "status-course", now, now)).lastInsertRowid);
  lessonId = Number((await getDb().prepare("INSERT INTO lessons(course_id,title,body) VALUES(?,?,?)").run(courseId, "Status lesson", "Privat lektionsinnehåll")).lastInsertRowid);
  for (const user of [student, other]) await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(user.id, courseId, now);
});
after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-learning-status-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("activity summary exposes only the student's statuses, never answer keys or private submission bodies", async () => {
  const quizId = await saveCourseActivity(admin.id, activity("quiz"));
  const assignmentId = await saveCourseActivity(admin.id, activity("assignment"));
  await submitQuiz(other.id, quizInput(quizId));
  await saveAssignment(other.id, assignmentInput(assignmentId));
  const summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.deepEqual(summary.activities.map(item => item.status), ["not_started", "not_started"]);
  assert.equal(summary.quizzes.passed, 0);
  assert.equal(summary.assignments.awaitingReview, 0);
  assert.doesNotMatch(JSON.stringify(summary), /correctOption|Privat elevtext|Privat lektionsinnehåll|answers|questions/);
});

test("lesson marking remains independent of quiz and assignment results", async () => {
  await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(student.id, lessonId, new Date().toISOString());
  assert.deepEqual(await getCourseProgress(student.id, courseId), [lessonId]);
  const summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.equal(summary.quizzes.passed, 0);
  assert.equal(summary.assignments.approved, 0);
});

test("quiz success belongs to the current revision and a practice retry cannot erase a passing result", async () => {
  const quizId = await saveCourseActivity(admin.id, activity("quiz"));
  await submitQuiz(student.id, quizInput(quizId, 1));
  assert.equal((await getStudentCourseLearningStatus(student.id, courseId)).activities.find(item => item.id === quizId)?.status, "not_passed");
  await submitQuiz(student.id, quizInput(quizId));
  await submitQuiz(student.id, quizInput(quizId, 1));
  assert.equal((await getStudentCourseLearningStatus(student.id, courseId)).activities.find(item => item.id === quizId)?.status, "passed");
  await saveCourseActivity(admin.id, activity("quiz", { id: quizId, revision: 1, title: "Quiz i ny version", questions: [{ ...question, prompt: "Ny fråga" }] }));
  const summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.equal(summary.activities.find(item => item.id === quizId)?.status, "updated");
  assert.equal(summary.quizzes.passed, 0);
  await submitQuiz(student.id, quizInput(quizId, 0, 2));
  assert.equal((await getStudentCourseLearningStatus(student.id, courseId)).quizzes.passed, 1);
});

test("assignments show submitted, revision requests and approval separately, preserving reviewed status alongside drafts", async () => {
  const assignmentId = await saveCourseActivity(admin.id, activity("assignment"));
  await saveAssignment(student.id, assignmentInput(assignmentId, false));
  assert.equal((await getStudentCourseLearningStatus(student.id, courseId)).activities.find(item => item.id === assignmentId)?.status, "draft");
  const submitted = await saveAssignment(student.id, assignmentInput(assignmentId));
  assert.equal((await getStudentCourseLearningStatus(student.id, courseId)).assignments.awaitingReview, 1);
  await reviewAssignment(admin.id, { courseId, lessonId, submissionId: submitted.id, status: "needs_revision", feedback: "Komplettera svaret" });
  await saveAssignment(student.id, assignmentInput(assignmentId, false));
  let summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.equal(summary.activities.find(item => item.id === assignmentId)?.status, "needs_revision");
  assert.equal(summary.assignments.needsRevision, 1);
  assert.equal(summary.assignments.draft, 1);
  const resubmitted = await saveAssignment(student.id, assignmentInput(assignmentId));
  await reviewAssignment(admin.id, { courseId, lessonId, submissionId: resubmitted.id, status: "approved", feedback: "Bra" });
  await saveAssignment(student.id, assignmentInput(assignmentId, false));
  summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.equal(summary.assignments.approved, 1);
  assert.equal(summary.activities.find(item => item.id === assignmentId)?.status, "approved");
  await saveCourseActivity(admin.id, activity("assignment", { id: assignmentId, revision: 1, instructions: "Nya instruktioner" }));
  summary = await getStudentCourseLearningStatus(student.id, courseId);
  assert.equal(summary.activities.find(item => item.id === assignmentId)?.status, "updated");
  assert.equal(summary.assignments.approved, 0);
});

test("inactive activities leave the current totals, while course access is checked against fresh enrollment and role", async () => {
  const quizId = await saveCourseActivity(admin.id, activity("quiz"));
  await saveCourseActivity(admin.id, activity("quiz", { id: quizId, revision: 1, active: false }));
  assert.ok(!(await getStudentCourseLearningStatus(student.id, courseId)).activities.some(item => item.id === quizId));
  await assert.rejects(getStudentCourseLearningStatus(outsider.id, courseId), /tillgång/);
  await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(courseId);
  await assert.rejects(getStudentCourseLearningStatus(student.id, courseId), /tillgång/);
  assert.ok((await getStudentCourseLearningStatus(admin.id, courseId)).activities.length > 0);
  await getDb().prepare("UPDATE courses SET published=1 WHERE id=?").run(courseId);
  await getDb().prepare("DELETE FROM enrollments WHERE user_id=? AND course_id=?").run(student.id, courseId);
  await assert.rejects(getStudentCourseLearningStatus(student.id, courseId), /tillgång/);
  await getDb().prepare("UPDATE users SET role='student' WHERE id=?").run(admin.id);
  await assert.rejects(getStudentCourseLearningStatus(admin.id, courseId), /tillgång/);
});
