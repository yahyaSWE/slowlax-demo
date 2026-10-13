import Link from "next/link";
import { ArrowUpRight, BookOpen, Sprout } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPortalCourseSummaries } from "@/lib/db";
import { CourseCard } from "@/components/learning/cards";

export const dynamic = "force-dynamic";

export default async function StudentPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const courses = await getPortalCourseSummaries(user.id);
  return (
    <>
      <section className="portal-welcome">
        <div>
          <p className="eyebrow">Din plats för kunskap</p>
          <h1>
            Välkommen, {user.name.split(" ")[0]}
            <span className="brand-dot">.</span>
          </h1>
          <p className="muted">
            En lektion i taget. Fortsätt din resa där du slutade.
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
          Verifiera din e-postadress innan administratören kan tilldela nya kurser. Dina befintliga kurser finns kvar.{" "}
          <Link href="/verifiera-epost" className="inline-link">Verifiera e-post</Link>
        </p>
      )}
      <div className="section-heading">
        <div>
          <p className="eyebrow">Fortsätt växa</p>
          <h2>Mina kurser</h2>
        </div>
        <span className="badge badge-green">
          {courses.length} {courses.length === 1 ? "kurs" : "kurser"}
        </span>
      </div>
      <p className="muted">Gruppmaterial och månadsplaner hittar du under <Link href="/elevportal/grupper" className="inline-link">Mina grupper</Link>.</p>
      {courses.length ? (
        <div className="card-grid">
          {courses.map((course, index) => (
            <CourseCard
              key={course.id}
              course={course}
              index={index}
              href={`/elevportal/kurser/${course.id}`}
              progress={course.progress}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state portal-empty">
          <BookOpen size={38} strokeWidth={1.2} />
          <h2>Din kunskapsresa börjar här</h2>
          <p className="muted">
            Du har inte tillgång till någon kurs ännu. När Tibb.nu har
            registrerat din kursanmälan dyker din kurs upp här.
          </p>
          <Link className="button button-primary" href="/kurser">
            Utforska våra kurser <ArrowUpRight size={17} />
          </Link>
        </div>
      )}
    </>
  );
}
