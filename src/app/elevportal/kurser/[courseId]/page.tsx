import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  Play,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getAccessibleCourse,
  getLessonOutline,
  getCourseProgress,
} from "@/lib/db";
import { TextContent } from "@/components/learning/cards";
import { CourseActivityProgress } from "@/components/learning/course-activity-progress";
import { getStudentCourseLearningStatus } from "@/lib/course-learning-status";
import { getStudentCourseAccessState } from "@/lib/student-access";
import { StudentAccessDetails, StudentAccessNotice } from "@/components/learning/student-access-notice";
import styles from "@/components/learning/portal-learning.module.css";

export const dynamic = "force-dynamic";

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireUser();
  const { courseId: rawCourseId } = await params;
  const courseId = Number(rawCourseId);
  if (!Number.isSafeInteger(courseId) || courseId < 1) notFound();
  const course = await getAccessibleCourse(user.id, courseId);
  if (!course) {
    const access = await getStudentCourseAccessState(user.id, courseId);
    if (!access || access.available) notFound();
    return <StudentAccessNotice access={access} />;
  }
  const [lessons, completed, learningStatus, access] = await Promise.all([
    getLessonOutline(courseId),
    getCourseProgress(user.id, courseId),
    getStudentCourseLearningStatus(user.id, courseId),
    getStudentCourseAccessState(user.id, courseId),
  ]);
  const completedCount = lessons.filter((lesson) =>
    completed.includes(lesson.id),
  ).length;
  const progress = lessons.length
    ? Math.round((completedCount / lessons.length) * 100)
    : 0;
  const nextUnmarkedLesson = lessons.find((lesson) => !completed.includes(lesson.id));
  const nextActivity = !nextUnmarkedLesson && learningStatus.activities.find((item) =>
    ["not_started", "not_passed", "draft", "needs_revision", "updated"].includes(item.status),
  );
  const nextLesson = nextUnmarkedLesson || lessons[0];
  const nextPath = nextActivity
    ? `/elevportal/kurser/${courseId}/lektioner/${nextActivity.lessonId}#activity-${nextActivity.id}`
    : nextLesson ? `/elevportal/kurser/${courseId}/lektioner/${nextLesson.id}` : null;
  return (
    <>
      <Link className="back-link" href="/elevportal">
        <ArrowLeft size={16} /> Mina kurser
      </Link>
      <div className="portal-course-heading">
        <div>
          <h1 className="page-title">{course.title}</h1>
        </div>
        <BookOpen size={73} strokeWidth={1} aria-hidden="true" />
      </div>
      {!course.published && (
        <p className="notice">
          Den här kursen är ett utkast. Den syns för dig som administratör.
        </p>
      )}
      <div className="portal-course-progress panel">
        <div>
          <span className="eyebrow">Lektionsframsteg</span>
          <h3>
            {completedCount} av {lessons.length} lektioner markerade som genomförda
          </h3>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className={`small muted ${styles.progressExplanation}`}>Markeringen sparar var du är i lektionerna.{learningStatus.activities.length > 0 && " Quiz och skrivuppgifter visas separat nedan."}</p>
        </div>
        <strong>{progress}%</strong>
        {nextPath && (
          <Link
            className="button button-primary"
            href={nextPath}
          >
            {nextActivity
              ? nextActivity.status === "needs_revision" ? "Komplettera uppgiften" : "Fortsätt med uppgifterna"
              : progress === 100
              ? "Repetera lektionerna"
              : completedCount
                ? "Fortsätt kursen"
                : "Börja kursen"}
            <ArrowRight size={17} />
          </Link>
        )}
      </div>
      {access?.available && <section className={`panel ${styles.courseDescription}`} aria-label="Din kursåtkomst"><StudentAccessDetails access={access} /></section>}
      <CourseActivityProgress courseId={courseId} status={learningStatus} />
      {course.description && <details className={`panel ${styles.courseDescription}`}><summary>Om kursen</summary><TextContent text={course.description} /></details>}
      <div className="section-heading">
        <h2>Kursens lektioner</h2>
        <span className="muted">Lär i din egen takt</span>
      </div>
      {lessons.length ? (
        <ol className="portal-lesson-list">
          {lessons.map((lesson, index) => (
            <li key={lesson.id}>
              <Link
                href={`/elevportal/kurser/${courseId}/lektioner/${lesson.id}`}
              >
                <span className="lesson-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="portal-lesson-label">
                  <strong>{lesson.title}</strong>
                  <small className="muted">
                    {[
                      lesson.hasVideo && "Video",
                      lesson.hasText && "Läsning",
                      lesson.hasMaterial && "Material",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {completed.includes(lesson.id) ? (
                  <span className="lesson-status">
                    <CheckCircle2 size={19} />
                    <span>Genomförd</span>
                  </span>
                ) : (
                  <Circle className="muted" size={19} />
                )}
                <Play size={16} />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <BookOpen size={32} />
          <h3>Lektionerna är på väg</h3>
          <p className="muted">
            Här ser du lektionerna när de lagts till av Tibb.nu.
          </p>
        </div>
      )}
    </>
  );
}
