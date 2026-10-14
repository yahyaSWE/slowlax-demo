import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getUserCoursePurchases, getUserPendingCoursePurchases } from "@/lib/course-purchase-billing";
import { CoursePurchasesList } from "@/components/learning/course-purchases-list";
import { CoursePurchaseCancelButton, CoursePurchaseRefreshButton } from "@/components/learning/course-purchase-controls";
import { formatDateTime, formatMoney } from "@/lib/time";

export default async function CoursePurchasesPage({ searchParams }: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "student") return <><h1 className="page-title">Mina köp</h1><p>Kursköp visas här för inloggade elever. Som administratör ser du köpen i respektive kursbyggare.</p></>;
  if (!user.emailVerifiedAt) return <><h1 className="page-title">Mina köp</h1><p className="notice">Verifiera din e-postadress för att köpa kurser och se dina köp. <Link href="/verifiera-epost" className="inline-link">Verifiera e-post</Link></p></>;
  const [purchases, pending, query] = await Promise.all([
    getUserCoursePurchases(user.id), getUserPendingCoursePurchases(user.id), searchParams,
  ]);
  return <>
    <Link href="/elevportal/konto" className="back-link">Till mitt konto</Link>
    <header className="membership-hero"><h1 className="page-title">Mina köp</h1><p>Dina engångsköp av kurser och den gruppåtkomst som ingår.</p></header>
    {query.cancelled === "1" && <p className="notice">Du lämnade betalningen. Ingen kursåtkomst öppnas förrän betalningen är bekräftad. Du kan fortsätta från kurssidan eller avbryta försöket nedan.</p>}
    {pending.length > 0 && <section className="panel">
      <h2>Påbörjade betalningar</h2>
      <div className="stack">{pending.map(attempt => <article key={attempt.courseId} className="course-purchase-record">
        <h3>{attempt.title}</h3>
        <p>{formatMoney(attempt.priceOre)} · {attempt.canCancel ? `Betalningslänken gäller till ${formatDateTime(attempt.expiresAt)}.` : "Betalningen behandlas. Vi inväntar Stripes bekräftelse."}</p>
        <div className="membership-actions">
          <Link href={`/kurser/${encodeURIComponent(attempt.slug)}`} className="button button-primary">Till kurssidan</Link>
          {attempt.canCancel && <CoursePurchaseCancelButton courseId={attempt.courseId} />}
        </div>
      </article>)}</div>
      <CoursePurchaseRefreshButton />
    </section>}
    <section className="stack"><h2>Köphistorik</h2><CoursePurchasesList purchases={purchases} /></section>
    <div className="membership-actions course-purchase-actions"><Link href="/kurser" className="button button-primary">Se alla kurser</Link><Link href="/kontakt" className="text-link">Frågor om köp eller återbetalning</Link></div>
  </>;
}
