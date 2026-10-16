import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Leaf, Users } from "lucide-react";
import { getArticles, getCourses, getEnrollments } from "@/lib/db";
import { getSiteSettings } from "@/lib/site-data";
import {
  AdminHeading,
  AdminNotice,
  type AdminSearchParams,
  EmptyState,
  SectionHeading,
} from "@/components/admin/common";

export default async function AdminDashboard({ searchParams }: { searchParams: AdminSearchParams }) {
  await requireAdmin();
  const [courses, articles, enrollments, settings] = await Promise.all([
    getCourses(), getArticles(), getEnrollments(), getSiteSettings(),
  ]);
  const stats = [
    { label: "Publicerade kurser", value: courses.filter(course => course.published).length, href: "/admin/kurser", icon: BookOpen },
    { label: "Publicerade artiklar", value: articles.filter(article => article.published).length, href: "/admin/artiklar", icon: FileText },
    { label: "Elever med kurstillgång", value: new Set(enrollments.map(enrollment => enrollment.userId)).size, href: "/admin/elever", icon: Users },
    { label: "Tilldelade kurstillgångar", value: enrollments.length, href: "/admin/elever", icon: BookOpen },
  ];
  return <>
    <AdminHeading
      eyebrow="Välkommen tillbaka"
      title="Översikt"
      description={`Här tar du hand om ${settings.siteName} – dina artiklar, kurser, grupper och elever.`}
      action={<Link href="/admin/kurser/ny" className="button button-primary">Skapa en kurs</Link>}
    />
    <AdminNotice searchParams={searchParams} />
    <div className="stats-grid">
      {stats.map(({ label, value, href, icon: Icon }) => <Link href={href} className="stat-card" key={label}>
        <div className="stat-card-top"><span>{label}</span><Icon size={20} aria-hidden="true" /></div>
        <strong className="stat-value">{value}</strong>
        <small>Visa översikt <ArrowRight size={14} aria-hidden="true" /></small>
      </Link>)}
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <div className="section-heading-with-action">
          <SectionHeading title="Dina kurser" />
          <Link href="/admin/kurser" className="text-link">Alla kurser <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        {courses.length ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Kurs</th><th>Status</th></tr></thead>
          <tbody>{courses.slice(0, 5).map(course => <tr key={course.id}>
            <td><Link className="text-link" href={`/admin/kurser/${course.id}`}>{course.title}</Link></td>
            <td><span className={`badge ${course.published ? "badge-green" : "badge-amber"}`}>{course.published ? "Publicerad" : "Utkast"}</span></td>
          </tr>)}</tbody>
        </table></div> : <EmptyState title="Din kunskap börjar här">Skapa en kurs med lektioner, video och material för dina elever.</EmptyState>}
      </section>
      <section className="panel quick-actions">
        <SectionHeading title="Dela din kunskap" description="Artiklar, kurser och gemenskap på ett ställe." />
        <Link href="/admin/artiklar/ny"><FileText size={21} aria-hidden="true" /><span><strong>Skriv en artikel</strong><small>Dela dina tankar och din kunskap</small></span><ArrowRight size={17} aria-hidden="true" /></Link>
        <Link href="/admin/kurser/ny"><BookOpen size={21} aria-hidden="true" /><span><strong>Bygg en ny kurs</strong><small>Lektioner, video och kursmaterial</small></span><ArrowRight size={17} aria-hidden="true" /></Link>
        <Link href="/admin/elever"><Users size={21} aria-hidden="true" /><span><strong>Hantera elever</strong><small>{enrollments.length} tilldelade kurstillgångar</small></span><ArrowRight size={17} aria-hidden="true" /></Link>
        <Link href="/admin/grupper"><Users size={21} aria-hidden="true" /><span><strong>Hantera grupper</strong><small>Material, medlemskap och gemenskap</small></span><ArrowRight size={17} aria-hidden="true" /></Link>
      </section>
    </div>
    <div className="admin-tip"><Leaf size={22} aria-hidden="true" /><div><strong>En sak i taget.</strong><p>Låt dina artiklar och kurser växa fram i sin egen takt.</p></div></div>
  </>;
}
