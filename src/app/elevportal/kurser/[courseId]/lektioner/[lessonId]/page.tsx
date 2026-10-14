import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getAccessibleCourse,
  getLesson,
  getLessonOutline,
  getCourseProgress,
  getDb,
} from "@/lib/db";
import { markLessonAction } from "@/lib/actions";
import { TextContent } from "@/components/learning/cards";
import {
  LessonVideo,
  LessonMaterial,
} from "@/components/learning/lesson-media";
import { LessonActivities } from "@/components/learning/lesson-activities";
import { LessonCourseMenu } from "@/components/learning/lesson-course-menu";
import { getStudentCourseAccessState } from "@/lib/student-access";
import { StudentAccessNotice } from "@/components/learning/student-access-notice";
import { formatDateTime } from "@/lib/time";
import styles from "@/components/learning/portal-learning.module.css";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { courseId: rawCourseId, lessonId: rawLessonId } = await params;
  const courseId = Number(rawCourseId);
  const lessonId = Number(rawLessonId);
  if (
    !Number.isSafeInteger(courseId) ||
    courseId < 1 ||
    !Number.isSafeInteger(lessonId) ||
    lessonId < 1
  )
    notFound();
  const course = await getAccessibleCourse(user.id, courseId);
  if (!course) {
    const access = await getStudentCourseAccessState(user.id, courseId);
    if (!access || access.available) notFound();
    const exists = await getDb().prepare("SELECT id FROM lessons WHERE id=? AND course_id=?").get(lessonId, courseId);
    if (!exists) notFound();
    return <StudentAccessNotice access={access} />;
  }
  const [lessons, lesson, completed, query, access] = await Promise.all([
    getLessonOutline(courseId),
    getLesson(lessonId, courseId),
    getCourseProgress(user.id, courseId),
    searchParams,
    getStudentCourseAccessState(user.id, courseId),
  ]);
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index < 0 || !lesson) notFound();
  const isComplete = completed.includes(lessonId);
  const completedCount = lessons.filter((item) =>
    completed.includes(item.id),
  ).length;
  const coursePath = `/elevportal/kurser/${courseId}`;
  const lessonPath = `${coursePath}/lektioner/${lessonId}`;
  const nextLesson = lessons[index + 1];
  const nextPath = nextLesson
    ? `${coursePath}/lektioner/${nextLesson.id}`
    : coursePath;
  return (
    <>
      <Link className="back-link" href={coursePath}>
        <ArrowLeft size={16} /> {course.title}
      </Link>
      <div className="lesson-layout">
        <LessonCourseMenu courseId={courseId} courseTitle={course.title} lessons={lessons} completed={completed} lessonId={lessonId} />
        <article className="lesson-content">
          <p className="eyebrow">
            Lektion {index + 1} av {lessons.length}
          </p>
          <h1>{lesson.title}</h1>
          <p className={styles.lessonProgress}>{completedCount} av {lessons.length} lektioner markerade som genomförda.
            {access?.available && access.expiresAt && <> Tillgång till {formatDateTime(access.expiresAt)}.</>}
          </p>
          <nav className={styles.lessonQuickNav} aria-label="Bläddra mellan lektioner">
            {index > 0 ? <Link className="text-link" href={`${coursePath}/lektioner/${lessons[index - 1].id}`}><ArrowLeft size={16} /> Föregående</Link> : <span />}
            <Link className="text-link" href={nextPath}>{nextLesson ? "Nästa lektion" : "Kursöversikt"}<ArrowRight size={16} /></Link>
          </nav>
          {query.error && (
            <p className="notice notice-error" role="alert">
              {query.error}
            </p>
          )}
          <LessonVideo url={lesson.videoUrl} />
          <TextContent text={lesson.body} />
          <LessonMaterial url={lesson.materialUrl} files={lesson.materials} />
          <Suspense
            fallback={
              <p className="muted" role="status">
                Laddar lektionsaktiviteter…
              </p>
            }
          >
            <LessonActivities
              userId={user.id}
              courseId={courseId}
              lessonId={lessonId}
            />
          </Suspense>
          <div className="lesson-completion panel">
            {isComplete ? (
              <>
                <div className="lesson-completed-label">
                  <CheckCircle2 size={22} />
                  <span>Du har markerat den här lektionen som genomförd.</span>
                </div>
                <Link className="button button-primary" href={nextPath}>
                  {nextLesson ? "Nästa lektion" : "Till kursöversikten"}
                  <ArrowRight size={17} />
                </Link>
                <form action={markLessonAction}>
                  <input type="hidden" name="lessonId" value={lessonId} />
                  <input type="hidden" name="returnTo" value={lessonPath} />
                  <button className="text-link small" type="submit">
                    <RotateCcw size={14} /> Markera som ej genomförd
                  </button>
                </form>
              </>
            ) : (
              <>
                <div>
                  <h3>Redo att gå vidare?</h3>
                  <p className="muted">
                    Markera lektionen som genomförd för att spara dina lektionsframsteg.
                    Quiz och skrivuppgifter får egna resultat.
                  </p>
                </div>
                <form action={markLessonAction}>
                  <input type="hidden" name="lessonId" value={lessonId} />
                  <input type="hidden" name="completed" value="on" />
                  <input type="hidden" name="returnTo" value={nextPath} />
                  <button className="button button-primary" type="submit">
                    <Check size={17} />
                    {nextLesson ? "Markera och gå vidare" : "Markera lektionen som genomförd"}
                  </button>
                </form>
              </>
            )}
          </div>
          <nav
            className="lesson-bottom-nav"
            aria-label="Nästa och föregående lektion"
          >
            {index > 0 ? (
              <Link
                href={`${coursePath}/lektioner/${lessons[index - 1].id}`}
                className="text-link"
              >
                <ArrowLeft size={16} /> Föregående lektion
              </Link>
            ) : (
              <span />
            )}
            {nextLesson && (
              <Link href={nextPath} className="text-link">
                Nästa lektion <ArrowRight size={16} />
              </Link>
            )}
          </nav>
        </article>
      </div>
    </>
  );
}
