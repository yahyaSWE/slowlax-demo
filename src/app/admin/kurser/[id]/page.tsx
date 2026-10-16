import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseById, getLessons, getEnrollments } from "@/lib/db";
import {
  getAdminCourseActivities,
  getCourseActivityResults,
} from "@/lib/course-activities";
import {
  deleteCourseAction,
  deleteLessonAction,
  enrollStudentAction,
  removeEnrollmentAction,
} from "@/lib/actions";
import {
  AdminHeading,
  AdminNotice,
  AdminSearchParams,
  dateOnly,
  EmptyState,
  Field,
  ReturnTo,
  SectionHeading,
} from "@/components/admin/common";
import { CourseForm } from "@/components/admin/course-form";
import { CourseSalesForm } from "@/components/admin/course-sales-form";
import { getCourseSalesSettings } from "@/lib/course-sales";
import { getAdminGroups } from "@/lib/memberships";
import { stripeReady } from "@/lib/stripe";
import { LessonForm } from "@/components/admin/lesson-form";
import { CourseLessonActivities } from "@/components/admin/course-activities";
import { CourseActivityResultsPanel } from "@/components/admin/course-activity-results";
import { getCourseInformation } from "@/lib/business-settings";
import { CourseInformationForm } from "@/components/admin/course-information-form";
import { getAdminCoursePurchases } from "@/lib/course-purchase-billing";
import { CoursePurchasesList } from "@/components/learning/course-purchases-list";
import { CourseCertificateForm } from "@/components/admin/course-certificate-form";
import { getCourseCertificateSettings } from "@/lib/course-certificates";
import "@/components/admin/course-activities.css";

export default async function CourseBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: AdminSearchParams;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isSafeInteger(courseId) || courseId < 1) notFound();
  const course = await getCourseById(courseId);
  if (!course) notFound();
  const information = await getCourseInformation(course);
  const [lessons, allEnrollments, activities, results, sales, groups, purchases, certificateSettings] = await Promise.all([
    getLessons(course.id),
    getEnrollments(),
    getAdminCourseActivities(user.id, course.id),
    getCourseActivityResults(user.id, course.id),
    getCourseSalesSettings(course.id),
    getAdminGroups(user.id),
    getAdminCoursePurchases(user.id, course.id),
    getCourseCertificateSettings(course.id),
  ]);
  const enrollments = allEnrollments.filter((e) => e.courseId === course.id);
  const studentCount = new Set([...enrollments.map(e => e.email), ...purchases.filter(p => !p.revoked).map(p => p.email)]).size;
  const returnTo = `/admin/kurser/${id}`;
  return (
    <>
      <AdminHeading
        eyebrow="Kursbyggare"
        title={course.title}
        description={`${lessons.length} lektioner · ${activities.length} aktiviteter · ${studentCount} ${studentCount === 1 ? "elev" : "elever"} med separat kursåtkomst · ${course.published ? "Publicerad" : "Utkast"}`}
        action={
          <div className="admin-heading-actions">
            <Link
              href={`/elevportal/kurser/${course.id}`}
              className="button button-secondary"
            >
              Förhandsgranska kurs
            </Link>
            <a href="#elevresultat" className="text-link">
              Elevresultat
            </a>
            <Link href="/admin/kurser" className="text-link">
              Alla kurser
            </Link>
          </div>
        }
      />
      <AdminNotice searchParams={searchParams} />
      <div className="stack">
        <section className="panel form-panel">
          <SectionHeading title="Kursens grunduppgifter" />
          <CourseForm course={course} returnTo={returnTo} />
        </section>
        <CourseInformationForm courseId={course.id} information={information} />
        <CourseCertificateForm settings={certificateSettings} />
        <section className="panel form-panel">
          <SectionHeading title="Försäljning och grupp efter köp" />
          <CourseSalesForm settings={sales} groups={groups} stripeReady={stripeReady()} />
        </section>
        <section className="panel">
          <SectionHeading
            title="Lektioner"
            description="Text, video och material visas i elevportalen i den ordning du väljer."
          />
          {lessons.length ? (
            <div className="stack">
              {lessons.map((lesson) => (
                <details className="lesson-card" key={lesson.id}>
                  <summary>
                    <span className="lesson-number">{lesson.position}</span>
                    <strong>{lesson.title}</strong>
                    <span className="muted">Redigera</span>
                  </summary>
                  <div className="lesson-editor">
                    <LessonForm
                      lesson={lesson}
                      courseId={course.id}
                      position={lesson.position}
                      returnTo={returnTo}
                    />
                    <CourseLessonActivities
                      courseId={course.id}
                      lessonId={lesson.id}
                      activities={activities.filter(
                        (activity) => activity.lessonId === lesson.id,
                      )}
                    />
                    <form action={deleteLessonAction} className="lesson-delete">
                      <input type="hidden" name="id" value={lesson.id} />
                      <input type="hidden" name="courseId" value={course.id} />
                      <ReturnTo path={returnTo} />
                      <p className="course-activity-help">
                        Om du tar bort lektionen tas även dess aktiviteter,
                        quizresultat och inlämningar bort permanent.
                      </p>
                      <button
                        className="button button-secondary button-small delete-button"
                        type="submit"
                      >
                        Ta bort lektion
                      </button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <EmptyState title="Bygg kursen en lektion i taget">
              Lägg till den första lektionen nedan.
            </EmptyState>
          )}
        </section>
        <section className="panel form-panel">
          <SectionHeading title="Ny lektion" />
          <LessonForm
            courseId={course.id}
            returnTo={returnTo}
            position={
              lessons.length
                ? Math.max(...lessons.map((l) => l.position)) + 1
                : 1
            }
          />
        </section>
        <section className="panel">
          <div id="elevresultat">
            <SectionHeading
              title="Elevresultat och inlämningar"
              description="Se sparade quizförsök, granska skrivuppgifter och ge återkoppling. Resultat från tidigare aktivitetsversioner bevaras."
            />
          </div>
          <CourseActivityResultsPanel results={results} />
        </section>
        <section className="panel">
          <SectionHeading
            title="Manuellt tilldelad kursåtkomst"
            description="Eleven skapar först sitt konto och verifierar sin e-postadress från elevportalen. Tilldela sedan tillgång med samma adress."
          />
          {!course.published ? (
            <div className="notice">
              Kursen är ett utkast. Tilldelade elever får tillgång i
              elevportalen när du publicerar den.
            </div>
          ) : null}
          <form action={enrollStudentAction} className="form-inline">
            <ReturnTo path={returnTo} />
            <input type="hidden" name="courseId" value={course.id} />
            <Field label="Elevens e-postadress" name="enroll-email">
              <input
                type="email"
                id="enroll-email"
                name="email"
                required
                maxLength={254}
                placeholder="elev@exempel.se"
              />
            </Field>
            <button type="submit" className="button button-primary">
              Tilldela tillgång
            </button>
          </form>
          {enrollments.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Elev</th>
                    <th>E-post</th>
                    <th>Tilldelad</th>
                    <th>
                      <span className="sr-only">Åtgärd</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td>{e.email}</td>
                      <td>{dateOnly(e.createdAt)}</td>
                      <td>
                        <form action={removeEnrollmentAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <ReturnTo path={returnTo} />
                          <button
                            type="submit"
                            className="button button-secondary button-small delete-button"
                          >
                            Ta bort tillgång
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Ingen manuellt tilldelad kursåtkomst">
              Tilldela en registrerad elev tillgång med formuläret ovan.
            </EmptyState>
          )}
        </section>
        <section className="panel">
          <SectionHeading title="Kursköp" description="Bekräftade engångsköp och den gruppåtkomst som ingick. Återbetalningar och tvister hanteras i Stripe." />
          <CoursePurchasesList purchases={purchases} admin />
        </section>
        <section className="panel danger-panel">
          <h2>Ta bort kurs</h2>
          <p className="muted">
            Kursen, dess lektioner och elevernas tillgång samt alla quizresultat
            och inlämningar tas bort permanent.
          </p>
          <form action={deleteCourseAction}>
            <input type="hidden" name="id" value={course.id} />
            <ReturnTo path="/admin/kurser" />
            <button
              className="button button-secondary delete-button"
              type="submit"
            >
              Ta bort kurs
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
