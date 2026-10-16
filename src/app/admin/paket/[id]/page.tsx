import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCourses } from "@/lib/db";
import { getCourseBundle } from "@/lib/course-bundles";
import { getCourseSalesSettings } from "@/lib/course-sales";
import { getAdminCoursePurchases } from "@/lib/course-purchase-billing";
import { getAdminGroups } from "@/lib/memberships";
import { stripeReady } from "@/lib/stripe";
import { AdminHeading, AdminNotice, type AdminSearchParams } from "@/components/admin/common";
import { CourseBundleForm } from "@/components/admin/course-bundle-form";
import { CourseSalesForm } from "@/components/admin/course-sales-form";
import { CoursePurchasesList } from "@/components/learning/course-purchases-list";
import { PurificationQuotaPanel } from "@/components/purification/views";

export default async function EditBundlePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: AdminSearchParams }) {
  const actor = await requireAdmin(), id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const bundle = await getCourseBundle(id, actor.id); if (!bundle) notFound();
  const [courses, groups, sales, purchases] = await Promise.all([getCourses(), getAdminGroups(actor.id), getCourseSalesSettings(id), getAdminCoursePurchases(actor.id, id)]);
  return <><AdminHeading title={bundle.title} description={`${bundle.published ? "Publicerat paket" : "Utkast"} · ${bundle.courses.length} kurser`} action={<div className="membership-actions"><Link href="/admin/paket" className="text-link">Alla paket</Link>{bundle.published && <Link href={`/paket/${bundle.slug}`} className="button button-secondary">Visa paketet</Link>}</div>} /><AdminNotice searchParams={searchParams} />
    <section className="panel form-panel"><h2>Paketets kurser och pris</h2><CourseBundleForm bundle={bundle} courses={courses} /></section>
    <section className="panel form-panel"><h2>Grupper och försäljning</h2><CourseSalesForm settings={sales} groups={groups} stripeReady={stripeReady()} returnTo={`/admin/paket/${id}`} /></section>
    <PurificationQuotaPanel sourceType="course_bundle" sourceId={id} returnTo={`/admin/paket/${id}`} />
    <section className="panel"><h2>Bekräftade paketköp</h2><CoursePurchasesList purchases={purchases} admin /></section></>;
}
