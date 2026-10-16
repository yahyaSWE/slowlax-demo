import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCourseBundles } from "@/lib/course-bundles";
import { formatMoney } from "@/lib/time";
import { AdminHeading } from "@/components/admin/common";

export default async function AdminBundlesPage() {
  const actor = await requireAdmin(), bundles = await getCourseBundles({ actorId: actor.id });
  return <><AdminHeading title="Kurspaket" description="Samla flera kurser och grupper i ett paket med ett gemensamt pris." action={<Link href="/admin/paket/ny" className="button button-primary">Skapa paket</Link>} />
    <div className="membership-cards">{bundles.map(bundle => <article className="panel stack" key={bundle.id}><h2>{bundle.title}</h2><p>{bundle.courses.length} kurser · {formatMoney(bundle.priceOre)}</p><span className={`badge ${bundle.published ? "badge-green" : "badge-amber"}`}>{bundle.published ? "Publicerat" : "Utkast"}</span><Link href={`/admin/paket/${bundle.id}`} className="text-link">Redigera paket</Link></article>)}</div>
    {!bundles.length && <p className="notice">Skapa exempelvis ett Bas-kit med två kurser och tillgång till flera grupper.</p>}</>;
}
