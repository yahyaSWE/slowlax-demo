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
        : <><p>Kursåtkomst utan tidsgräns.</p>{purchase.isBundle && <ul>{purchase.courses.map(course => <li key={course.id}>{course.title}</li>)}</ul>}{purchase.groups.length > 0 && <ul>{purchase.groups.map(group => <li key={group.id}>Gruppen <strong>{group.name}</strong> ingår{group.expiresAt ? <> till {formatDateTime(group.expiresAt)}{Date.parse(group.expiresAt) <= Date.now() && " (gruppåtkomsten har löpt ut)"}</> : " utan tidsgräns"}.</li>)}</ul>}</>}
      <details>
        <summary>Köpvillkor som godkändes vid köpet</summary>
        <TextContent text={purchase.terms} />
      </details>
      {!admin && <div className="membership-actions">
        {purchase.courses.filter(course => course.available).map(course => <Link key={course.id} href={`/elevportal/kurser/${course.id}`} className="text-link">{purchase.isBundle ? course.title : "Öppna kursen"}</Link>)}
        {!purchase.courses.some(course => course.available) && <Link href="/kontakt" className="text-link">Få hjälp med kursåtkomsten</Link>}
        {purchase.groups.filter(group => group.available).map(group => <Link key={group.id} href={`/elevportal/grupper/${group.id}`} className="text-link">Öppna {group.name}</Link>)}
      </div>}
    </article>)}
  </div>;
}
