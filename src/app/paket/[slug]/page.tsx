import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicCourseBundle } from "@/lib/course-bundles";
import { getCoursePurchaseOffer, getPublicCourseSalesDetails, hasPermanentCourseAccess } from "@/lib/course-sales";
import { getCurrentUser } from "@/lib/auth";
import { accountAuthHref } from "@/lib/account-return";
import { createPageMetadata, PRIVATE_METADATA, seoDescription } from "@/lib/seo";
import { formatMoney } from "@/lib/time";
import { CoursePurchaseButton } from "@/components/learning/course-purchase-controls";
import { TextContent } from "@/components/learning/cards";
import { getPurificationQuotaSettings } from "@/lib/purification-domain";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const bundle = await getPublicCourseBundle((await params).slug);
  return bundle ? createPageMetadata({ title: bundle.title, description: seoDescription(bundle.description, bundle.title), path: `/paket/${bundle.slug}` }) : PRIVATE_METADATA;
}
export default async function BundlePage({ params }: Props) {
  const bundle = await getPublicCourseBundle((await params).slug); if (!bundle) notFound();
  const quota = await getPurificationQuotaSettings("course_bundle", bundle.id);
  const [offer, details, user] = await Promise.all([getCoursePurchaseOffer(bundle.id), getPublicCourseSalesDetails(bundle.id), getCurrentUser()]);
  const purchased = user?.role === "student" ? await hasPermanentCourseAccess(user.id, bundle.id) : false;
  const returnTo = `/paket/${bundle.slug}`;
  return <section className="section container"><Link href="/paket" className="back-link">Alla kurspaket</Link><header className="membership-hero"><p className="eyebrow">Slowlax · Kurspaket</p><h1 className="page-title">{bundle.title}</h1><p className="membership-price">{formatMoney(bundle.priceOre)}</p><p>Engångsbetalning inklusive moms · {bundle.courses.length} kurser</p></header>
    <div className="membership-columns"><div className="membership-panel"><TextContent text={bundle.description} /><h2>Kurser som ingår</h2><ul>{bundle.courses.map(course => <li key={course.id}><Link href={`/kurser/${course.slug}`} className="inline-link">{course.title}</Link></li>)}</ul><p>Du får tillgång till dessa kurser utan tidsgräns via elevportalen.</p>
      {details && details.groups.length > 0 && <><h2>Grupper som ingår</h2><ul>{details.groups.map(group => <li key={group.id}>{group.name} — {group.accessDays === null ? "utan tidsgräns" : `${group.accessDays} dagar efter betalningen`}</li>)}</ul></>}
      {quota.credits > 0 && <p><Link href="/rening" className="inline-link">Rening</Link> av {quota.credits} bolag ingår som engångskrediter utan tidsgräns.</p>}
      {details && <><h2>Köpvillkor för paketet</h2><TextContent text={details.terms} /></>}<p><Link href="/villkor" className="inline-link">Kurs- och medlemsvillkor</Link> · <Link href="/kontakt" className="inline-link">Kontakta oss</Link></p>
    </div><aside className="membership-panel stack"><h2>Kom igång</h2>{purchased ? <><p>Du har köpt paketet. Dina kurser och grupper finns i elevportalen.</p><Link href="/elevportal" className="button button-primary">Öppna elevportalen</Link></>
      : !offer ? <><p>Kontakta oss för information om paketet och anmälan.</p><Link href="/kontakt" className="button button-primary">Kontakta oss</Link></>
        : user?.role === "admin" ? <p className="notice">Du granskar paketet som administratör. Köp görs med ett elevkonto.</p>
          : !user ? <><Link href={accountAuthHref("/logga-in", returnTo)} className="button button-primary">Logga in för att köpa paketet</Link><Link href={accountAuthHref("/registrera", returnTo)} className="text-link">Skapa elevkonto</Link></>
            : !user.emailVerifiedAt ? <p className="notice">Verifiera din e-postadress före köpet. <Link href={accountAuthHref("/verifiera-epost", returnTo)} className="inline-link">Verifiera e-post</Link></p>
              : <CoursePurchaseButton courseId={bundle.id} courseRevision={offer.courseRevision} settingsRevision={offer.settingsRevision} priceLabel={formatMoney(offer.priceOre)} purificationRevision={quota.updatedAt} isBundle />}
    </aside></div></section>;
}
