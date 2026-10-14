import Link from "next/link";
import type { CoursePurchaseView } from "@/lib/course-purchase-billing";
import { formatDateTime, formatMoney } from "@/lib/time";
import { TextContent } from "./cards";
import "./course-purchases.css";

export function CoursePurchasesList({ purchases, admin = false }: {
  purchases: CoursePurchaseView[];
  admin?: boolean;
}) {
  if (!purchases.length) return <p className="muted">Inga bekräftade kursköp ännu.</p>;
  return <div className="stack">
    {purchases.map(purchase => <article className="panel course-purchase-record" key={purchase.id}>
      <div className="course-purchase-record-heading">
        <h3>{purchase.title}</h3>
        <span className={`badge ${purchase.revoked ? "badge-warning" : ""}`}>{purchase.revoked ? "Köpåtkomst spärrad" : "Betalt"}</span>
      </div>
      {admin && <p>{purchase.name} · {purchase.email}</p>}
      <p className="small muted">{formatDateTime(purchase.paidAt)} · {formatMoney(purchase.priceOre)} inklusive {purchase.vatPercent}% moms</p>
      {purchase.revoked
        ? <p className="notice">Åtkomsten från detta köp har spärrats efter en återbetalning, tvist eller betalningskontroll. Separat tilldelad åtkomst påverkas inte. {admin ? "Kontrollera betalningen i Stripe." : <Link href="/kontakt" className="inline-link">Kontakta oss om köpet.</Link>}</p>
        : <p>Kursåtkomst utan tidsgräns. {purchase.groupName && <>Gruppen <strong>{purchase.groupName}</strong> ingår{purchase.groupExpiresAt ? <> till {formatDateTime(purchase.groupExpiresAt)}{Date.parse(purchase.groupExpiresAt) <= Date.now() && " (gruppåtkomsten har löpt ut)"}</> : " utan tidsgräns"}.</>}</p>}
      <details>
        <summary>Köpvillkor som godkändes vid köpet</summary>
        <TextContent text={purchase.terms} />
      </details>
      {!admin && <div className="membership-actions">
        {purchase.courseAvailable ? <Link href={`/elevportal/kurser/${purchase.courseId}`} className="text-link">Öppna kursen</Link>
          : <Link href="/kontakt" className="text-link">Få hjälp med kursåtkomsten</Link>}
        {purchase.groupAvailable && <Link href={`/elevportal/grupper/${purchase.groupId}`} className="text-link">Öppna gruppen</Link>}
      </div>}
    </article>)}
  </div>;
}
