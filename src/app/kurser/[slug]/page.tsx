import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  LockKeyhole,
  ChartNoAxesCombined,
} from "lucide-react";
import { getLessonOutline, hasCourseAccess } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatPrice, TextContent } from "@/components/learning/cards";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildBreadcrumbSchema,
  createPageMetadata,
  PRIVATE_METADATA,
  seoDescription,
} from "@/lib/seo";
import { buildCourseSchema } from "@/lib/seo-content";
import { getPublicCourse } from "@/lib/seo-data";
import { getBusinessSettings, getCourseInformation } from "@/lib/business-settings";
import { getCoursePurchaseOffer, hasPermanentCourseAccess } from "@/lib/course-sales";
import { CoursePurchaseButton } from "@/components/learning/course-purchase-controls";
import { accountAuthHref } from "@/lib/account-return";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = await getPublicCourse(slug);
  if (!course) return { ...PRIVATE_METADATA, title: "Kursen finns inte" };
  return createPageMetadata({
    title: course.title,
    description: seoDescription(course.description, course.title),
    path: `/kurser/${encodeURIComponent(course.slug)}`,
  });
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { slug } = await params;
  const course = await getPublicCourse(slug);
  if (!course) notFound();
  const courseSchema = buildCourseSchema(course);
  const [lessons, user, information, business, offer] = await Promise.all([
    getLessonOutline(course.id),
    getCurrentUser(),
    getCourseInformation(course),
    getBusinessSettings(),
    getCoursePurchaseOffer(course.id),
  ]);
  const hasAccess = user ? await hasCourseAccess(user.id, course.id) : false;
  const permanentAccess = user?.role === "student" ? await hasPermanentCourseAccess(user.id, course.id) : false;
  const query = await searchParams;
  const coursePath = `/kurser/${course.slug}`;
  return (
    <section className="section container course-detail">
      {courseSchema && <JsonLd id="course-schema" data={courseSchema} />}
      <JsonLd
        id="course-breadcrumbs"
        data={buildBreadcrumbSchema([
          { name: "Start", path: "/" },
          { name: "Kurser", path: "/kurser" },
          {
            name: course.title,
            path: `/kurser/${encodeURIComponent(course.slug)}`,
          },
        ])}
      />
      {query.success && <p className="notice notice-success" role="status">{query.success.slice(0, 500)}</p>}
      <Link href="/kurser" className="back-link">
        <ArrowLeft size={16} /> Alla kurser
      </Link>
      <nav aria-label="Brödsmulor" className="small muted">
        <Link href="/">Start</Link> <span aria-hidden="true">/</span>{" "}
        <Link href="/kurser">Kurser</Link> <span aria-hidden="true">/</span>{" "}
        <span aria-current="page">{course.title}</span>
      </nav>
      <div className="course-detail-grid">
        <div>
          <p className="eyebrow">Slowlax akademi · Onlinekurs</p>
          <h1 className="page-title">{course.title}</h1>
          <TextContent text={course.description} />
          {([
            ["audience", "Vem passar kursen för?"],
            ["prerequisites", "Förkunskaper"],
            ["learningOutcomes", "Lärandemål"],
            ["completionRequirements", "Genomförande"],
          ] as const).map(([key, title]) => information[key] ? (
            <section key={key} className="course-information-section">
              <h2>{title}</h2><TextContent text={information[key]} />
            </section>
          ) : null)}
          <div className="course-detail-meta">
            <span>
              <BookOpen size={17} /> {lessons.length}{" "}
              {lessons.length === 1 ? "lektion" : "lektioner"}
            </span>
            <span>
              <Clock size={17} /> I din egen takt
            </span>
          </div>
          <div className="course-outline">
            <h2>Det här får du lära dig</h2>
            <p className="muted">
              En stegvis fördjupning, med plats för både kunskap och reflektion.
            </p>
            {lessons.length ? (
              <ol>
                {lessons.map((lesson, index) => (
                  <li key={lesson.id}>
                    <span className="lesson-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{lesson.title}</span>
                    <LockKeyhole size={16} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                Kursens lektionsmaterial har inte lagts in i denna elevportal ännu. Kontakta oss för information om kursinnehåll och tillgång.
              </p>
            )}
          </div>
          {offer && (
            <section className="course-information-section prose">
              <h2>Köpvillkor för kursen</h2>
              {business.legalName && <p>Kursen säljs av {business.legalName}{business.organizationNumber ? `, organisationsnummer ${business.organizationNumber}` : ""}.</p>}
              <TextContent text={offer.terms} />
              <p><Link href="/kontakt" className="inline-link">Kontakta oss om kursköpet</Link> · <Link href="/villkor" className="inline-link">Kurs- och medlemsvillkor</Link></p>
            </section>
          )}
        </div>
        <aside className="course-enrollment panel">
          <div className="course-enrollment-art" aria-hidden="true">
            <ChartNoAxesCombined size={103} strokeWidth={0.85} />
          </div>
          <p className="eyebrow">En investering i din kunskap</p>
          <p className="course-price">{formatPrice(course.priceOre)}</p>
          {offer && <p className="small muted">Engångsbetalning · inklusive {offer.vatPercent}% moms</p>}
          <ul className="check-list">
            <li>
              <Check size={16} /> Tillgång via din elevportal
            </li>
            <li>
              <Check size={16} /> Studera när det passar dig
            </li>
            <li><Check size={16} /> {business.courseAccessDescription}</li>
            <li>
              <Check size={16} /> Följ dina framsteg lektion för lektion
            </li>
            {offer?.groups.map(group => <li key={group.id}><Check size={16} /> Gruppen {group.name} ingår{group.accessDays === null ? " utan tidsgräns" : ` i ${group.accessDays} dagar efter betalningen`}.</li>)}
          </ul>
          {hasAccess && (
            <Link
              className="button button-primary full-width"
              href={`/elevportal/kurser/${course.id}`}
            >
              Öppna kursen <ArrowRight size={17} />
            </Link>
          )}
          {offer && !permanentAccess && user?.role !== "admin" && hasAccess && <p className="small muted">Du har tillgång via en grupp. Du kan även köpa kursen för att få egen kursåtkomst utan tidsgräns.</p>}
          {offer && !permanentAccess ? (
            user?.role === "admin" ? <p className="notice">Du granskar kursen som administratör. Kursköp görs med ett elevkonto.</p>
              : !user ? <div className="stack"><Link className="button button-primary full-width" href={accountAuthHref("/logga-in", coursePath)}>Logga in för att köpa kursen</Link><Link className="text-link" href={accountAuthHref("/registrera", coursePath)}>Skapa elevkonto</Link></div>
                : !user.emailVerifiedAt ? <p className="notice">Verifiera din e-postadress innan du köper kursen. <Link href={accountAuthHref("/verifiera-epost", coursePath)} className="inline-link">Verifiera e-post</Link></p>
                  : <CoursePurchaseButton courseId={course.id} courseRevision={offer.courseRevision} settingsRevision={offer.settingsRevision} priceLabel={formatPrice(offer.priceOre)} />
          ) : !hasAccess && !offer ? (
            <>
              <Link
                className="button button-primary full-width"
                href="/kontakt"
              >
                Anmäl ditt intresse <ArrowRight size={17} />
              </Link>
              <p className="small muted">
                Slowlax hjälper dig med anmälan och tilldelar sedan kursåtkomst.
              </p>
            </>
          ) : null}
          {!user && (
            <p className="small muted">
              Har du redan tillgång?{" "}
              <Link
                href={`/logga-in?returnTo=${encodeURIComponent(`/elevportal/kurser/${course.id}`)}`}
                className="inline-link"
              >
                Logga in
              </Link>
            </p>
          )}
          <p className="small muted"><Link href="/villkor" className="inline-link">Kurs- och medlemsvillkor</Link></p>
        </aside>
      </div>
    </section>
  );
}
