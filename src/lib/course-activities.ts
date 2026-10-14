import { z } from "zod";
import { membershipCourseAccessSql } from "./membership-access";
import { coursePurchaseAccessSql } from "./course-purchase-access";
import { DomainError } from "./db";
import { getDb, transaction } from "./database";
import { text } from "./validation";
import type {
  AdminCourseActivity, AssignmentSubmission, CourseActivityBase, CourseActivityInput,
  CourseActivityResults, QuizAnswer, QuizAnswerResult, QuizAttempt, QuizQuestion,
  StudentCourseActivity,
} from "./types";
export type {
  AdminCourseActivity, AdminQuizAttempt, AdminAssignmentSubmission, AssignmentSubmission,
  CourseActivityInput, CourseActivityResults, QuizAttempt, QuizQuestion, StudentCourseActivity,
} from "./types";

type Row = Record<string, unknown>;
type RevisionData = { title: string; instructions: string; questions: QuizQuestion[]; passPercent: number | null };
const id = z.number().int().positive();
const ownership = z.object({ courseId: id, lessonId: id });
const questionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  prompt: text(2000, 1), options: z.array(text(1000, 1)).min(2).max(6),
  correctOption: z.number().int().min(0),
});
const activitySchema = ownership.extend({
  id: id.optional(), kind: z.enum(["quiz", "assignment"]), title: text(180, 2),
  instructions: text(12000), position: z.number().int().min(1).max(10000), active: z.boolean(),
  questions: z.array(questionSchema).max(30).optional(),
  passPercent: z.number().int().min(1).max(100).optional(), revision: id.optional(),
});

function revisionData(row: Row): RevisionData {
  return JSON.parse(String(row.data_json)) as RevisionData;
}
function base(row: Row, data: RevisionData): CourseActivityBase {
  return {
    id: Number(row.id), courseId: Number(row.course_id), lessonId: Number(row.lesson_id),
    kind: row.kind as CourseActivityBase["kind"], title: data.title, instructions: data.instructions,
    position: Number(row.position), active: !!row.active, revision: Number(row.current_revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
function quizAttempt(row: Row): QuizAttempt {
  return {
    id: Number(row.id), userId: Number(row.user_id), activityId: Number(row.activity_id),
    revision: Number(row.revision), attemptNumber: Number(row.attempt_number),
    scorePercent: Number(row.score_percent), correctCount: Number(row.correct_count),
    questionCount: Number(row.question_count), passPercent: Number(row.pass_percent), passed: !!row.passed,
    answers: JSON.parse(String(row.answers_json)) as QuizAnswerResult[], submittedAt: String(row.submitted_at),
  };
}
function assignmentSubmission(row: Row): AssignmentSubmission {
  return {
    id: Number(row.id), userId: Number(row.user_id), activityId: Number(row.activity_id),
    revision: Number(row.revision), text: String(row.body),
    status: row.status as AssignmentSubmission["status"], feedback: String(row.feedback),
    createdAt: String(row.created_at), submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by == null ? null : Number(row.reviewed_by),
  };
}
async function requireCourseAdmin(actorId: number, courseId: number) {
  id.parse(actorId); id.parse(courseId);
  const row = await getDb().prepare(
    "SELECT c.id FROM courses c JOIN users u ON u.id=? AND u.role='admin' WHERE c.id=?",
  ).get(actorId, courseId);
  if (!row) throw new DomainError("Du har inte behörighet till den här kursen.");
}
async function requireLesson(userId: number, courseId: number, lessonId: number, adminOnly = false) {
  id.parse(userId); ownership.parse({ courseId, lessonId });
  const row = await getDb().prepare(
    `SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id JOIN users u ON u.id=?
     WHERE l.id=? AND l.course_id=? AND ${adminOnly ? "u.role='admin'" : `(u.role='admin' OR (u.role='student' AND c.published=1 AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=u.id) OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))`}`,
  ).get(userId, lessonId, courseId);
  if (!row) throw new DomainError("Du har inte tillgång till den här lektionen.");
}
async function currentActivity(activityId: number, courseId: number, lessonId: number) {
  const row = await getDb().prepare(
    `SELECT a.*,l.course_id,r.data_json FROM course_activities a JOIN lessons l ON l.id=a.lesson_id
     JOIN activity_revisions r ON r.activity_id=a.id AND r.revision=a.current_revision
     WHERE a.id=? AND l.course_id=? AND l.id=?`,
  ).get(activityId, courseId, lessonId);
  if (!row) throw new DomainError("Aktiviteten tillhör inte den här lektionen.");
  return row;
}
function checkRevision(row: Row, revision: number) {
  if (Number(row.current_revision) !== revision)
    throw new DomainError("Aktiviteten har ändrats. Kopiera dina osparade svar innan du laddar om sidan och öppnar den nya versionen.");
}

export async function saveCourseActivity(actorId: number, input: CourseActivityInput): Promise<number> {
  const value = activitySchema.parse(input);
  const questions = value.kind === "quiz" ? value.questions ?? [] : [];
  const passPercent = value.kind === "quiz" ? value.passPercent : null;
  if (value.kind === "quiz") {
    if (!questions.length || passPercent == null) throw new DomainError("Lägg till frågor och en godkändgräns för quizet.");
    if (new Set(questions.map((question) => question.id)).size !== questions.length)
      throw new DomainError("Varje fråga behöver ett eget ID.");
    for (const question of questions) {
      if (question.correctOption >= question.options.length)
        throw new DomainError("Välj ett giltigt rätt svar för varje fråga.");
      if (new Set(question.options).size !== question.options.length)
        throw new DomainError("Svarsalternativen i en fråga måste vara olika.");
    }
  } else if (!value.instructions) throw new DomainError("Skriv en instruktion för skrivuppgiften.");
  const data: RevisionData = { title: value.title, instructions: value.instructions, questions, passPercent: passPercent ?? null };
  return transaction(async () => {
    await requireLesson(actorId, value.courseId, value.lessonId, true);
    const now = new Date().toISOString();
    let activityId = value.id;
    let revision = 1;
    let changed = true;
    if (activityId) {
      const current = await currentActivity(activityId, value.courseId, value.lessonId);
      if (current.kind !== value.kind) throw new DomainError("Aktivitetens typ kan inte ändras. Skapa en ny aktivitet i stället.");
      if (value.revision !== undefined) checkRevision(current, value.revision);
      changed = JSON.stringify(revisionData(current)) !== JSON.stringify(data);
      revision = Number(current.current_revision) + (changed ? 1 : 0);
      if (!changed && Number(current.position) === value.position && !!current.active === value.active) return activityId;
      await getDb().prepare(
        "UPDATE course_activities SET position=?,active=?,current_revision=?,updated_at=? WHERE id=?",
      ).run(value.position, value.active ? 1 : 0, revision, now, activityId);
    } else {
      const result = await getDb().prepare(
        "INSERT INTO course_activities(lesson_id,kind,position,active,current_revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
      ).run(value.lessonId, value.kind, value.position, value.active ? 1 : 0, now, now);
      activityId = Number(result.lastInsertRowid);
    }
    if (changed) await getDb().prepare(
      "INSERT INTO activity_revisions(activity_id,revision,data_json,created_at) VALUES(?,?,?,?)",
    ).run(activityId, revision, JSON.stringify(data), now);
    return activityId;
  });
}

export async function getAdminCourseActivities(actorId: number, courseId: number): Promise<AdminCourseActivity[]> {
  await requireCourseAdmin(actorId, courseId);
  const rows = await getDb().prepare(
    `SELECT a.*,l.course_id,r.data_json FROM course_activities a JOIN lessons l ON l.id=a.lesson_id
     JOIN activity_revisions r ON r.activity_id=a.id AND r.revision=a.current_revision
     WHERE l.course_id=? ORDER BY l.position,l.id,a.position,a.id`,
  ).all(courseId);
  return rows.map((row) => {
    const data = revisionData(row);
    return { ...base(row, data), questions: data.questions, passPercent: data.passPercent };
  });
}

export async function getStudentLessonActivities(userId: number, courseId: number, lessonId: number): Promise<StudentCourseActivity[]> {
  await requireLesson(userId, courseId, lessonId);
  // Repeat the access predicate in the content query: a revoked enrollment
  // between the guard and this read cannot expose the activity content.
  const rows = await getDb().prepare(
    `SELECT a.*,l.course_id,r.data_json FROM course_activities a JOIN lessons l ON l.id=a.lesson_id
     JOIN activity_revisions r ON r.activity_id=a.id AND r.revision=a.current_revision
     JOIN courses c ON c.id=l.course_id JOIN users u ON u.id=?
     WHERE a.lesson_id=? AND l.course_id=? AND a.active=1
     AND (u.role='admin' OR (u.role='student' AND c.published=1 AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=u.id) OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))
     ORDER BY a.position,a.id`,
  ).all(userId, lessonId, courseId);
  if (!rows.length) return [];
  const activityIds = rows.map((row) => Number(row.id));
  const placeholders = activityIds.map(() => "?").join(",");
  const [attempts, submissions] = await Promise.all([
    getDb().prepare(`SELECT * FROM quiz_attempts WHERE user_id=? AND activity_id IN (${placeholders}) ORDER BY id DESC`).all(userId, ...activityIds),
    getDb().prepare(`SELECT * FROM assignment_submissions WHERE user_id=? AND activity_id IN (${placeholders}) ORDER BY id DESC`).all(userId, ...activityIds),
  ]);
  return rows.map((row) => {
    const data = revisionData(row);
    return {
      ...base(row, data), passPercent: data.passPercent,
      questions: data.questions.map(({ id, prompt, options }) => ({ id, prompt, options })),
      quizAttempts: attempts.filter((attempt) => Number(attempt.activity_id) === Number(row.id)).map(quizAttempt),
      assignmentSubmissions: submissions.filter((submission) => Number(submission.activity_id) === Number(row.id)).map(assignmentSubmission),
    };
  });
}

export type QuizSubmissionInput = { activityId: number; courseId: number; lessonId: number; revision: number; answers: QuizAnswer[] };
export async function submitQuiz(userId: number, input: QuizSubmissionInput): Promise<QuizAttempt> {
  const value = ownership.extend({
    activityId: id, revision: id,
    answers: z.array(z.object({ questionId: z.string().min(1).max(80), optionIndex: z.number().int().min(0) }).strict()).min(1).max(30),
  }).parse(input);
  return transaction(async () => {
    await requireLesson(userId, value.courseId, value.lessonId);
    const activity = await currentActivity(value.activityId, value.courseId, value.lessonId);
    if (!activity.active || activity.kind !== "quiz") throw new DomainError("Quizet är inte tillgängligt.");
    checkRevision(activity, value.revision);
    const data = revisionData(activity);
    const selected = new Map(value.answers.map((answer) => [answer.questionId, answer.optionIndex]));
    if (value.answers.length !== data.questions.length || selected.size !== data.questions.length)
      throw new DomainError("Besvara varje fråga exakt en gång.");
    const answers: QuizAnswerResult[] = data.questions.map((question) => {
      const option = selected.get(question.id);
      if (option === undefined || option >= question.options.length)
        throw new DomainError("Välj ett giltigt svar på varje fråga.");
      return { questionId: question.id, prompt: question.prompt, options: question.options,
        selectedOption: option, correctOption: question.correctOption, correct: option === question.correctOption };
    });
    const correctCount = answers.filter((answer) => answer.correct).length;
    const scorePercent = Math.round(correctCount * 100 / answers.length);
    const passPercent = data.passPercent!;
    const previous = await getDb().prepare(
      "SELECT COALESCE(MAX(attempt_number),0) AS number FROM quiz_attempts WHERE activity_id=? AND user_id=?",
    ).get(value.activityId, userId);
    const result = await getDb().prepare(
      `INSERT INTO quiz_attempts(activity_id,revision,user_id,attempt_number,answers_json,correct_count,question_count,score_percent,pass_percent,passed,submitted_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(value.activityId, value.revision, userId, Number(previous?.number ?? 0) + 1,
      JSON.stringify(answers), correctCount, answers.length, scorePercent, passPercent,
      scorePercent >= passPercent ? 1 : 0, new Date().toISOString());
    return quizAttempt((await getDb().prepare("SELECT * FROM quiz_attempts WHERE id=?").get(Number(result.lastInsertRowid)))!);
  });
}

export type AssignmentInput = { activityId: number; courseId: number; lessonId: number; revision: number; text: string; submit: boolean };
export async function saveAssignment(userId: number, input: AssignmentInput): Promise<AssignmentSubmission> {
  const value = ownership.extend({ activityId: id, revision: id, text: text(20000), submit: z.boolean() }).parse(input);
  if (value.submit && !value.text) throw new DomainError("Skriv ditt svar innan du skickar in uppgiften.");
  return transaction(async () => {
    await requireLesson(userId, value.courseId, value.lessonId);
    const activity = await currentActivity(value.activityId, value.courseId, value.lessonId);
    if (!activity.active || activity.kind !== "assignment") throw new DomainError("Skrivuppgiften är inte tillgänglig.");
    checkRevision(activity, value.revision);
    const draft = await getDb().prepare(
      "SELECT id FROM assignment_submissions WHERE activity_id=? AND revision=? AND user_id=? AND status='draft'",
    ).get(value.activityId, value.revision, userId);
    const now = new Date().toISOString();
    const status = value.submit ? "submitted" : "draft";
    let submissionId: number;
    if (draft) {
      submissionId = Number(draft.id);
      await getDb().prepare("UPDATE assignment_submissions SET body=?,status=?,submitted_at=? WHERE id=?").run(
        value.text, status, value.submit ? now : null, submissionId,
      );
    } else {
      const result = await getDb().prepare(
        "INSERT INTO assignment_submissions(activity_id,revision,user_id,body,status,created_at,submitted_at) VALUES(?,?,?,?,?,?,?)",
      ).run(value.activityId, value.revision, userId, value.text, status, now, value.submit ? now : null);
      submissionId = Number(result.lastInsertRowid);
    }
    return assignmentSubmission((await getDb().prepare("SELECT * FROM assignment_submissions WHERE id=?").get(submissionId))!);
  });
}

export type AssignmentReviewInput = { submissionId: number; courseId: number; lessonId: number; feedback: string; status: "approved" | "needs_revision" };
export async function reviewAssignment(actorId: number, input: AssignmentReviewInput): Promise<void> {
  const value = ownership.extend({ submissionId: id, feedback: text(12000), status: z.enum(["approved", "needs_revision"]) }).parse(input);
  if (value.status === "needs_revision" && !value.feedback) throw new DomainError("Beskriv vad eleven behöver komplettera.");
  return transaction(async () => {
    await requireLesson(actorId, value.courseId, value.lessonId, true);
    const submission = await getDb().prepare(
      `SELECT s.* FROM assignment_submissions s JOIN course_activities a ON a.id=s.activity_id
       JOIN lessons l ON l.id=a.lesson_id WHERE s.id=? AND l.id=? AND l.course_id=?`,
    ).get(value.submissionId, value.lessonId, value.courseId);
    if (!submission) throw new DomainError("Inlämningen tillhör inte den här lektionen.");
    if (submission.status === "draft") throw new DomainError("Eleven har inte skickat in den här uppgiften ännu.");
    await getDb().prepare("UPDATE assignment_submissions SET status=?,feedback=?,reviewed_at=?,reviewed_by=? WHERE id=?").run(
      value.status, value.feedback, new Date().toISOString(), actorId, value.submissionId,
    );
  });
}

export async function getCourseActivityResults(actorId: number, courseId: number): Promise<CourseActivityResults> {
  await requireCourseAdmin(actorId, courseId);
  const context = `JOIN course_activities a ON a.id=s.activity_id JOIN lessons l ON l.id=a.lesson_id
    JOIN users u ON u.id=s.user_id JOIN activity_revisions r ON r.activity_id=s.activity_id AND r.revision=s.revision`;
  const fields = "s.*,l.course_id,l.id AS lesson_id,l.title AS lesson_title,u.name AS user_name,u.email AS user_email,r.data_json";
  const [attempts, submissions] = await Promise.all([
    getDb().prepare(`SELECT ${fields} FROM quiz_attempts s ${context} WHERE l.course_id=? ORDER BY s.id DESC`).all(courseId),
    getDb().prepare(`SELECT ${fields},reviewer.name AS reviewer_name FROM assignment_submissions s ${context}
      LEFT JOIN users reviewer ON reviewer.id=s.reviewed_by WHERE l.course_id=? AND s.status<>'draft' ORDER BY s.id DESC`).all(courseId),
  ]);
  function details(row: Row) {
    const data = revisionData(row);
    return { courseId: Number(row.course_id), lessonId: Number(row.lesson_id), lessonTitle: String(row.lesson_title),
      activityTitle: data.title, instructions: data.instructions, userName: String(row.user_name), userEmail: String(row.user_email),
      reviewerName: row.reviewer_name ? String(row.reviewer_name) : null };
  }
  return {
    quizAttempts: attempts.map((row) => ({ ...quizAttempt(row), ...details(row) })),
    assignmentSubmissions: submissions.map((row) => ({ ...assignmentSubmission(row), ...details(row) })),
  };
}
