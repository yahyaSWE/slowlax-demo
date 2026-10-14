import { z } from "zod";
import { getDb } from "./database";
import { DomainError, hasCourseAccess } from "./db";
import { membershipCourseAccessSql } from "./membership-access";
import { coursePurchaseAccessSql } from "./course-purchase-access";

export type LearningActivityStatus =
  | "not_started"
  | "not_passed"
  | "passed"
  | "draft"
  | "submitted"
  | "approved"
  | "needs_revision"
  | "updated";

export type StudentLearningActivityStatus = {
  id: number;
  lessonId: number;
  lessonTitle: string;
  title: string;
  kind: "quiz" | "assignment";
  status: LearningActivityStatus;
  hasDraft: boolean;
};

export type StudentCourseLearningStatus = {
  activities: StudentLearningActivityStatus[];
  quizzes: { total: number; passed: number };
  assignments: {
    total: number;
    approved: number;
    awaitingReview: number;
    needsRevision: number;
    draft: number;
  };
};

export function learningActivityStatusLabel(status: LearningActivityStatus) {
  const labels: Record<LearningActivityStatus, string> = {
    not_started: "Inte påbörjad",
    not_passed: "Inte godkänt ännu",
    passed: "Godkänt",
    draft: "Utkast sparat",
    submitted: "Väntar på återkoppling",
    approved: "Godkänd",
    needs_revision: "Behöver kompletteras",
    updated: "Ny version – tidigare svar finns i lektionen",
  };
  return labels[status];
}

/** No answer keys, submission text or other students' histories leave this read. */
export async function getStudentCourseLearningStatus(
  userId: number,
  courseId: number,
): Promise<StudentCourseLearningStatus> {
  z.number().int().positive().parse(userId);
  z.number().int().positive().parse(courseId);
  if (!(await hasCourseAccess(userId, courseId)))
    throw new DomainError("Du har inte tillgång till den här kursen.");
  const rows = await getDb().prepare(
    `SELECT a.id,a.kind,a.current_revision,l.id AS lesson_id,l.title AS lesson_title,
      json_extract(r.data_json,'$.title') AS title,
      EXISTS(SELECT 1 FROM quiz_attempts q WHERE q.activity_id=a.id AND q.user_id=u.id
        AND q.revision=a.current_revision AND q.passed=1) AS quiz_passed,
      EXISTS(SELECT 1 FROM quiz_attempts q WHERE q.activity_id=a.id AND q.user_id=u.id
        AND q.revision=a.current_revision) AS quiz_attempted,
      (SELECT s.status FROM assignment_submissions s WHERE s.activity_id=a.id AND s.user_id=u.id
        AND s.revision=a.current_revision AND s.status<>'draft' ORDER BY s.id DESC LIMIT 1) AS submission_status,
      EXISTS(SELECT 1 FROM assignment_submissions s WHERE s.activity_id=a.id AND s.user_id=u.id
        AND s.revision=a.current_revision AND s.status='draft') AS has_draft,
      (EXISTS(SELECT 1 FROM quiz_attempts q WHERE q.activity_id=a.id AND q.user_id=u.id
        AND q.revision<>a.current_revision) OR
       EXISTS(SELECT 1 FROM assignment_submissions s WHERE s.activity_id=a.id AND s.user_id=u.id
        AND s.revision<>a.current_revision)) AS earlier_version
     FROM course_activities a JOIN lessons l ON l.id=a.lesson_id JOIN courses c ON c.id=l.course_id
     JOIN activity_revisions r ON r.activity_id=a.id AND r.revision=a.current_revision
     JOIN users u ON u.id=? WHERE c.id=? AND a.active=1 AND
       (u.role='admin' OR (u.role='student' AND c.published=1 AND
       (EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=u.id)
       OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))
     ORDER BY l.position,l.id,a.position,a.id`,
  ).all(userId, courseId);
  const activities = rows.map((row): StudentLearningActivityStatus => {
    const kind = row.kind as StudentLearningActivityStatus["kind"];
    // A saved draft cannot erase a reviewed or submitted answer. A passed quiz
    // stays passed for this revision even when the student later practises again.
    const status: LearningActivityStatus = kind === "quiz"
      ? row.quiz_passed ? "passed" : row.quiz_attempted ? "not_passed" : row.earlier_version ? "updated" : "not_started"
      : row.submission_status ? row.submission_status as LearningActivityStatus
        : row.has_draft ? "draft" : row.earlier_version ? "updated" : "not_started";
    return {
      id: Number(row.id), lessonId: Number(row.lesson_id), lessonTitle: String(row.lesson_title),
      title: String(row.title), kind, status, hasDraft: !!row.has_draft,
    };
  });
  return {
    activities,
    quizzes: {
      total: activities.filter((item) => item.kind === "quiz").length,
      passed: activities.filter((item) => item.kind === "quiz" && item.status === "passed").length,
    },
    assignments: {
      total: activities.filter((item) => item.kind === "assignment").length,
      approved: activities.filter((item) => item.kind === "assignment" && item.status === "approved").length,
      awaitingReview: activities.filter((item) => item.kind === "assignment" && item.status === "submitted").length,
      needsRevision: activities.filter((item) => item.kind === "assignment" && item.status === "needs_revision").length,
      draft: activities.filter((item) => item.kind === "assignment" && item.hasDraft).length,
    },
  };
}
