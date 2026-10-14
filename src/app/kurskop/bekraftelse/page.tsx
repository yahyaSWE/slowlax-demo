import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { accountAuthHref } from "@/lib/account-return";
import { getCoursePurchaseConfirmation } from "@/lib/course-purchase-billing";
import { CoursePurchaseRefreshButton } from "@/components/learning/course-purchase-controls";
import { PRIVATE_METADATA } from "@/lib/seo";
import { formatDateTime, formatMoney } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { ...PRIVATE_METADATA, title: "Bekräftelse på kursköp" };

export default async function CoursePurchaseConfirmationPage({ searchParams }: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const query = await searchParams, user = await getCurrentUser();
  const sessionId = typeof query.session_id === "string" && /^cs_[A-Za-z0-9_]{1,200}$/.test(query.session_id) ? query.session_id : null;
  const returnTo = sessionId ? `/kurskop/bekraftelse?session_id=${encodeURIComponent(sessionId)}` : "/elevportal/kop";
  if (!user) redirect(accountAuthHref("/logga-in", returnTo));
  if (user.role === "student" && !user.emailVerifiedAt) redirect(accountAuthHref("/verifiera-epost", returnTo));
  const checkout = user.role === "student" && user.emailVerifiedAt && typeof query.session_id === "string"
    ? await getCoursePurchaseConfirmation(user.id, query.session_id) : null;
  const title = checkout?.confirmed ? "Ditt kursköp är bekräftat" : checkout?.status === "blocked" ? "Köpåtkomsten är spärrad"
    : checkout?.status === "cancelled" ? "Betalningen slutfördes inte" : checkout ? "Vi inväntar betalningsbekräftelsen" : "Dina kursköp";
  return <section className="section container">
    <header className="membership-hero"><h1 className="page-title">{title}</h1>
      <p>{checkout?.confirmed ? `${checkout.title} · ${formatMoney(checkout.priceOre)}. Din kursåtkomst har ingen tidsgräns.`
        : checkout?.status === "blocked" ? "Åtkomsten från köpet har spärrats efter en återbetalning, tvist eller betalningskontroll. Kontakta oss om du har frågor."
          : checkout?.status === "cancelled" ? "Du kan gå tillbaka till kursen och försöka igen."
            : checkout ? "Åtkomsten öppnas när Stripe har bekräftat betalningen. Det kan ta en kort stund."
              : "Se dina betalningar och köp i elevportalen."}</p>
    </header>
    {checkout && (checkout.confirmed || checkout.courseAvailable || checkout.groupAvailable) && <div className="panel stack">
      {checkout.confirmed && checkout.groupName && <p>Gruppen <strong>{checkout.groupName}</strong> ingår{checkout.groupExpiresAt ? <> till {formatDateTime(checkout.groupExpiresAt)}</> : " utan tidsgräns"}.</p>}
      {!checkout.confirmed && <p>Du har åtkomst från en separat tilldelning eller betalning. Den påverkas inte av detta köp.</p>}
      {checkout.confirmed && !checkout.courseAvailable && <p className="notice">Kursen är för närvarande inte tillgänglig. Ditt köp finns sparat. Kontakta oss för hjälp.</p>}
      <div className="membership-actions">
        {checkout.courseAvailable && <Link href={`/elevportal/kurser/${checkout.courseId}`} className="button button-primary">Öppna kursen</Link>}
        {checkout.groupAvailable && <Link href={`/elevportal/grupper/${checkout.groupId}`} className="button button-secondary">Öppna gruppen</Link>}
      </div>
    </div>}
    <div className="membership-actions course-purchase-actions">
      <Link href="/elevportal/kop" className="button button-secondary">Mina köp</Link>
      {checkout?.status === "pending" && <CoursePurchaseRefreshButton />}
      {checkout?.status === "cancelled" && <Link href={`/kurser/${encodeURIComponent(checkout.slug)}`} className="button button-primary">Till kursen</Link>}
      <Link href="/kontakt" className="text-link">Kontakta oss</Link>
    </div>
  </section>;
}
