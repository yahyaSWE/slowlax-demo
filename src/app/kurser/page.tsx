import { ArrowDown, BookOpen, CirclePlay, Sprout } from "lucide-react";
import { getCourses } from "@/lib/db";
import { createPageMetadata } from "@/lib/seo";
import { CourseCard } from "@/components/learning/cards";

export const metadata = createPageMetadata({
  title: "Kurser i klassisk kinesisk medicin",
  description:
    "Utforska Tibb.nu:s kurser i klassisk kinesisk medicin i ljuset av den profetiska vägledningen. Fördjupa din kunskap i egen takt via elevportalen.",
  path: "/kurser",
});
export const dynamic = "force-dynamic";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [courses, query] = await Promise.all([getCourses({ publishedOnly: true }), searchParams]);
  return (
    <>
      <section className="learning-hero section container">
        <div className="learning-hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" /> Tibb akademi
          </p>
          <h1 className="page-title">
            Kunskap som
            <br />
            <em>slår rot.</em>
          </h1>
          <p className="lead muted">
            Utforska mötet mellan klassisk kinesisk medicin och den profetiska
            vägledningen. Lär i din egen takt, med utrymme för reflektion.
          </p>
          <a href="#kurser" className="button button-primary">
            Utforska våra kurser <ArrowDown size={17} />
          </a>
        </div>
        <div className="learning-hero-visual" aria-hidden="true">
          <span className="learning-orbit orbit-one" />
          <span className="learning-orbit orbit-two" />
          <Sprout size={154} strokeWidth={0.8} />
          <p>
            Väx i kunskap.
            <br />
            Väx i balans.
          </p>
          <span className="learning-visual-note">
            Tradition möter förståelse
          </span>
        </div>
      </section>
      <section className="section container learning-values">
        <div>
          <BookOpen size={23} />
          <span>
            <strong>Omsorgsfullt sammansatt</strong>
            <small>Kunskap med sammanhang och fördjupning</small>
          </span>
        </div>
        <div>
          <CirclePlay size={23} />
          <span>
            <strong>Lär i din egen takt</strong>
            <small>Lektioner som passar in i din vardag</small>
          </span>
        </div>
        <div>
          <Sprout size={23} />
          <span>
            <strong>Från teori till förståelse</strong>
            <small>Ta med dig kunskapen in i livet</small>
          </span>
        </div>
      </section>
      <section id="kurser" className="section container learning-catalog">
        {query.message && <p className="notice" role="status">{query.message.slice(0, 500)}</p>}
        <div className="section-heading">
          <div>
            <p className="eyebrow">Din nästa fördjupning</p>
            <h2>Våra kurser</h2>
          </div>
          <span className="muted">
            {courses.length} {courses.length === 1 ? "kurs" : "kurser"}
          </span>
        </div>
        {courses.length ? (
          <div className="card-grid">
            {courses.map((course, index) => (
              <CourseCard key={course.id} course={course} index={index} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <BookOpen size={32} />
            <h3>Nya kurser är på väg</h3>
            <p className="muted">
              Här hittar du våra kurser när de har publicerats.
            </p>
          </div>
        )}
        <p className="catalog-note">
          Kurser med onlineköp kan köpas direkt på kurssidan. För övriga kurser
          kontaktar du oss för anmälan och tilldelning av kursåtkomst.
        </p>
      </section>
    </>
  );
}
