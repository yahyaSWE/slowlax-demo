import Link from "next/link";
import { ArrowRight, PackageOpen } from "lucide-react";
import { getCourseBundles } from "@/lib/course-bundles";
import { createPageMetadata } from "@/lib/seo";
import { formatMoney } from "@/lib/time";
import { TextContent } from "@/components/learning/cards";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata({ title: "Kurspaket", description: "Samla kurser och gemenskap i ett kurspaket hos Slowlax.", path: "/paket" });
export default async function BundlesPage() {
  const bundles = await getCourseBundles({ publishedOnly: true });
  return <section className="section container"><header className="membership-hero"><p className="eyebrow">Kunskap och gemenskap</p><h1 className="page-title">Kurser som hör ihop.</h1><p className="lead muted">Välj ett paket med flera kurser och studera i din egen takt.</p></header>
    <div className="membership-cards">{bundles.map(bundle => <article className="membership-card" key={bundle.id}><PackageOpen size={30} aria-hidden="true" /><h2>{bundle.title}</h2><p className="membership-price">{formatMoney(bundle.priceOre)}</p><p className="small muted">{bundle.courses.length} kurser · engångsbetalning inklusive moms</p><TextContent text={bundle.description} /><Link href={`/paket/${bundle.slug}`} className="button button-primary">Visa paketet <ArrowRight size={17} /></Link></article>)}</div>
    {!bundles.length && <p className="notice">Våra kurspaket presenteras här när de är klara. <Link href="/kurser" className="inline-link">Utforska våra kurser</Link> under tiden.</p>}</section>;
}
