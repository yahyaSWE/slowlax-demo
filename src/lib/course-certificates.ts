import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertAdmin } from "./admin";
import { getDb, transaction } from "./database";
import { DomainError, hasCourseAccess } from "./db";
import { assertCourseDiplomaTextSupported, DiplomaTextError } from "./diploma-fonts";

export type CourseCertificate = {
  id: string; userId: number; courseId: number | null;
  studentName: string; courseTitle: string; issuerName: string; completedAt: string; issuedAt: string;
};
export type CourseCertificateSettings = { courseId: number; enabled: boolean; updatedAt: string | null };
export type CourseCertificateEligibility = {
  courseId: number; enabled: boolean; eligible: boolean;
  reason: "issued" | "disabled" | "not_available" | "no_lessons" | "incomplete" | "eligible";
  lessons: { total: number; completed: number }; quizzes: { total: number; passed: number };
  assignments: { total: number; approved: number }; certificate: CourseCertificate | null;
};
type Row = Record<string, unknown>;
const positiveId = z.number().int().positive();
const settingsInput = z.object({ enabled: z.boolean(), expectedUpdatedAt: z.iso.datetime().nullable() }).strict();
const identity = (course: Row) => `${Number(course.id)}:${String(course.created_at)}`;
const certificate = (row: Row): CourseCertificate => ({
  id: String(row.id), userId: Number(row.user_id), courseId: row.course_id == null ? null : Number(row.course_id),
  studentName: String(row.student_name), courseTitle: String(row.course_title), issuerName: String(row.issuer_name),
  completedAt: String(row.completed_at), issuedAt: String(row.issued_at),
});

/** Default-off reads never create a settings row. */
export async function getCourseCertificateSettings(courseId: number): Promise<CourseCertificateSettings> {
  positiveId.parse(courseId);
  const row = await getDb().prepare("SELECT enabled,updated_at FROM course_certificate_settings WHERE course_id=?").get(courseId);
  return { courseId, enabled: !!row?.enabled, updatedAt: row ? String(row.updated_at) : null };
}
export async function saveCourseCertificateSettings(actorId: number, courseId: number, input: { enabled: boolean; expectedUpdatedAt: string | null }): Promise<CourseCertificateSettings> {
  positiveId.parse(courseId);
  const value = settingsInput.parse(input);
  return transaction(async () => {
    await assertAdmin(actorId);
    if (!await getDb().prepare("SELECT id FROM courses WHERE id=? AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=courses.id)").get(courseId))
      throw new DomainError("Diplom kan bara aktiveras för enskilda kurser som finns.");
    const current = await getCourseCertificateSettings(courseId);
    if (value.expectedUpdatedAt !== current.updatedAt)
      throw new DomainError("Diplominställningen har ändrats. Ladda om sidan innan du sparar igen.");
    const updatedAt = new Date(Math.max(Date.now(), current.updatedAt ? Date.parse(current.updatedAt)+1 : 0)).toISOString();
    if (current.updatedAt) {
      const saved = await getDb().prepare("UPDATE course_certificate_settings SET enabled=?,updated_at=? WHERE course_id=? AND updated_at=?")
        .run(Number(value.enabled), updatedAt, courseId, current.updatedAt);
      if (!saved.changes) throw new DomainError("Diplominställningen har ändrats. Ladda om sidan.");
    } else await getDb().prepare("INSERT INTO course_certificate_settings(course_id,enabled,updated_at) VALUES(?,?,?)")
      .run(courseId, Number(value.enabled), updatedAt);
    return { courseId, enabled: value.enabled, updatedAt };
  });
}

type Inspection = { status: CourseCertificateEligibility; course?: Row; user?: Row; completedAt?: string };
async function inspect(userId: number, courseId: number): Promise<Inspection> {
  const status: CourseCertificateEligibility = { courseId, enabled: false, eligible: false, reason: "not_available",
    lessons: { total: 0, completed: 0 }, quizzes: { total: 0, passed: 0 }, assignments: { total: 0, approved: 0 }, certificate: null };
  const user = await getDb().prepare("SELECT id,name,role,email_verified_at FROM users WHERE id=?").get(userId);
  if (!user) return { status };
  const course = await getDb().prepare("SELECT id,title,created_at,published FROM courses WHERE id=?").get(courseId);
  if (!course) return { status };
  const existing = await getDb().prepare("SELECT * FROM course_certificates WHERE user_id=? AND course_identity=?").get(userId, identity(course));
  const settings = await getCourseCertificateSettings(courseId);
  if (existing) return { status: { ...status, enabled: settings.enabled, reason: "issued", certificate: certificate(existing) } };
  if (user.role !== "student" || !user.email_verified_at || !course.published ||
      await getDb().prepare("SELECT course_id FROM course_bundles WHERE course_id=?").get(courseId) || !await hasCourseAccess(userId, courseId)) return { status };
  status.enabled = settings.enabled;
  const lessons = await getDb().prepare("SELECT l.id,p.completed_at FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? WHERE l.course_id=? ORDER BY l.id").all(userId, courseId);
  const activities = await getDb().prepare(`SELECT a.kind,
    (SELECT MIN(q.submitted_at) FROM quiz_attempts q WHERE q.activity_id=a.id AND q.user_id=? AND q.revision=a.current_revision AND q.passed=1) AS quiz_passed_at,
    (SELECT s.status FROM assignment_submissions s WHERE s.activity_id=a.id AND s.user_id=? AND s.revision=a.current_revision AND s.status<>'draft' ORDER BY s.id DESC LIMIT 1) AS assignment_status,
    (SELECT s.reviewed_at FROM assignment_submissions s WHERE s.activity_id=a.id AND s.user_id=? AND s.revision=a.current_revision AND s.status<>'draft' ORDER BY s.id DESC LIMIT 1) AS assignment_reviewed_at
    FROM course_activities a JOIN lessons l ON l.id=a.lesson_id WHERE l.course_id=? AND a.active=1`).all(userId, userId, userId, courseId);
  status.lessons = { total: lessons.length, completed: lessons.filter(row => row.completed_at != null).length };
  const quizzes = activities.filter(row => row.kind === "quiz"), assignments = activities.filter(row => row.kind === "assignment");
  status.quizzes = { total: quizzes.length, passed: quizzes.filter(row => row.quiz_passed_at != null).length };
  status.assignments = { total: assignments.length, approved: assignments.filter(row => row.assignment_status === "approved").length };
  status.eligible = status.enabled && lessons.length > 0 && status.lessons.completed === lessons.length &&
    status.quizzes.passed === quizzes.length && status.assignments.approved === assignments.length;
  status.reason = !status.enabled ? "disabled" : !lessons.length ? "no_lessons" : status.eligible ? "eligible" : "incomplete";
  const timestamp = Date.now();
  const proofDates = [...lessons.map(row => row.completed_at), ...quizzes.map(row => row.quiz_passed_at), ...assignments.map(row => row.assignment_reviewed_at)]
    .map(value => Date.parse(String(value))).filter(value => Number.isFinite(value) && value <= timestamp);
  return { status, course, user, completedAt: new Date(proofDates.length ? Math.max(...proofDates) : timestamp).toISOString() };
}

/** A consistent read only assessment; issuance is a separate explicit action. */
export async function getCourseCertificateEligibility(userId: number, courseId: number): Promise<CourseCertificateEligibility> {
  positiveId.parse(userId); positiveId.parse(courseId);
  return transaction(async () => (await inspect(userId, courseId)).status);
}
export async function issueCourseCertificate(userId: number, courseId: number): Promise<CourseCertificate> {
  positiveId.parse(userId); positiveId.parse(courseId);
  return transaction(async () => {
    const inspected = await inspect(userId, courseId), { status, course, user, completedAt } = inspected;
    if (status.certificate) return status.certificate;
    if (!status.eligible || !course || !user || !completedAt)
      throw new DomainError(status.reason === "not_available" ? "Du kan inte hämta diplom för den här kursen." : status.reason === "disabled" ? "Diplom är inte aktiverat för den här kursen." : "Slutför kursens lektioner och godkända aktiviteter innan du hämtar ditt diplom.");
    const studentName=String(user.name), courseTitle=String(course.title), issuerName="Slowlax";
    try { await assertCourseDiplomaTextSupported({studentName,courseTitle,issuerName}); }
    catch(error) {
      throw new DomainError(error instanceof DiplomaTextError ? error.message : "Diplomet kunde inte förberedas. Försök igen om en stund.");
    }
    const id = randomBytes(16).toString("hex"), issuedAt = new Date().toISOString();
    await getDb().prepare(`INSERT INTO course_certificates(id,user_id,course_id,course_identity,student_name,course_title,issuer_name,completed_at,issued_at)
      VALUES(?,?,?,?,?,?,'Slowlax',?,?) ON CONFLICT(user_id,course_identity) DO NOTHING`)
      .run(id, userId, courseId, identity(course), studentName, courseTitle, completedAt, issuedAt);
    const saved = await getDb().prepare("SELECT * FROM course_certificates WHERE user_id=? AND course_identity=?").get(userId, identity(course));
    if (!saved) throw new DomainError("Diplomet kunde inte utfärdas. Försök igen.");
    return certificate(saved);
  });
}
/** userId is the authenticated owner's ID, supplied by the server route. */
export async function getUserCourseCertificates(userId: number): Promise<CourseCertificate[]> {
  positiveId.parse(userId);
  return (await getDb().prepare("SELECT c.* FROM course_certificates c JOIN users u ON u.id=c.user_id WHERE c.user_id=? ORDER BY c.issued_at DESC,c.id").all(userId)).map(certificate);
}
export async function getCourseCertificateForDownload(actorId: number, id: string): Promise<CourseCertificate | null> {
  positiveId.parse(actorId);
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const row = await getDb().prepare(`SELECT c.* FROM course_certificates c JOIN users actor ON actor.id=?
    WHERE c.id=? AND (c.user_id=actor.id OR actor.role='admin')`).get(actorId, id);
  return row ? certificate(row) : null;
}
