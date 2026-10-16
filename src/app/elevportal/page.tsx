import Link from "next/link";
import { ArrowUpRight, BookOpen, Sprout } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPortalDashboard } from "@/lib/portal-dashboard";
import { CourseCard } from "@/components/learning/cards";
import { periodLabel } from "@/components/memberships/views";

export const dynamic = "force-dynamic";

export default async function StudentPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const { courses, resume, latestMaterials } = await getPortalDashboard(user.id);
  return (
    <>
      <section className="portal-welcome">
        <div>
          <h1>
            Välkommen, {user.name.split(" ")[0]}
            <span className="brand-dot">.</span>
          </h1>
          <p className="muted">
            Dina kurser och ditt gruppmaterial, samlade på ett ställe.
          </p>
        </div>
        <Sprout size={80} strokeWidth={1} aria-hidden="true" />
      </section>
      {query.success && (
        <p className="notice notice-success" role="status">
          {query.success}
        </p>
      )}
      {query.error && (
        <p className="notice notice-error" role="alert">
          {query.error}
        </p>
      )}
      {user.role === "admin" && (
        <p className="notice">
          Du förhandsgranskar elevportalen som administratör. Alla kurser visas
          här, inklusive utkast.{" "}
          <Link href="/admin" className="inline-link">
            Till administrationen
          </Link>
        </p>
      )}
      {user.role === "student" && !user.emailVerifiedAt && (
        <p className="notice">
          Verifiera din e-postadress för att köpa kurser och använda gruppmaterial. Dina befintliga kurser finns kvar.{" "}
          <Link href="/verifiera-epost" className="inline-link">Verifiera e-post</Link>
        </p>
      )}
      {resume?.nextLesson && <section className="portal-resume" aria-labelledby="portal-resume-title">
        <div><p className="eyebrow">{resume.progress > 0 ? "Din nästa lektion" : "Börja här"}</p><h2 id="portal-resume-title">{resume.title}</h2><p>{resume.nextLesson.title}</p><p className="small">{resume.completedLessonCount} av {resume.lessonCount} lektioner markerade som genomförda</p></div>
        <Link className="button button-primary" href={`/elevportal/kurser/${resume.id}/lektioner/${resume.nextLesson.id}`}>{resume.progress > 0 ? "Fortsätt kursen" : "Börja kursen"}<ArrowUpRight size={17} aria-hidden="true" /></Link>
      </section>}
      <div className="section-heading">
        <div>
          <h2>Mina kurser</h2>
        </div>
        <span className="badge badge-green">
          {courses.length} {courses.length === 1 ? "kurs" : "kurser"}
        </span>
      </div>
      {courses.length ? (
        <div className="card-grid">
          {courses.map((course, index) => (
            <article className="portal-course-choice" key={course.id}>
              <CourseCard
              course={course}
              index={index}
              href={`/elevportal/kurser/${course.id}`}
              progress={course.progress}
              />
              {course.nextLesson && <Link href={`/elevportal/kurser/${course.id}/lektioner/${course.nextLesson.id}`} className="button button-secondary button-small">{course.progress > 0 ? "Fortsätt kursen" : "Börja kursen"}<ArrowUpRight size={15} aria-hidden="true" /></Link>}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state portal-empty">
          <BookOpen size={38} strokeWidth={1.2} />
          <h2>Din kunskapsresa börjar här</h2>
          <p className="muted">
            Du har inga kurser ännu. Kurser visas här efter ett bekräftat köp eller när Slowlax har tilldelat dig tillgång.
          </p>
          <Link className="button button-primary" href="/kurser">
            Utforska våra kurser <ArrowUpRight size={17} />
          </Link>
          <p className="small muted">Har du redan påbörjat ett köp? <Link href="/elevportal/kop" className="inline-link">Kontrollera betalningsstatus</Link>.</p>
        </div>
      )}
      {latestMaterials.length > 0 && <section className="portal-material-preview" aria-labelledby="portal-material-title">
        <div className="section-heading"><h2 id="portal-material-title">Senaste gruppmaterialet</h2><Link href="/elevportal/grupper" className="text-link">Allt gruppmaterial <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
        <div className="membership-cards">{latestMaterials.map(material => <article className="membership-card" key={`${material.groupId}-${material.id}`}>
          <span className="membership-period">{periodLabel(material.period)}</span><h3>{material.title}</h3><p className="small muted">{material.groupName}{material.fileCount > 0 && ` · ${material.fileCount} ${material.fileCount === 1 ? "bilaga" : "bilagor"}`}</p>
          <Link href={`/elevportal/grupper/${material.groupId}/inlagg/${material.id}`} className="text-link">Öppna material <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </article>)}</div>
      </section>}
    </>
  );
}
