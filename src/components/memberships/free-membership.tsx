import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import type { FreeMembershipOffer, StudentFreeMembership } from "@/lib/free-membership-domain";
import { formatDateTime } from "@/lib/time";
import { FreeMembershipJoinButton } from "./free-membership-controls";

export function FreeMembershipCard({ offer, admin = false, memberCount }: { offer: Pick<FreeMembershipOffer, "description">; admin?: boolean; memberCount?: number }) {
  return <article className="membership-card"><Users size={28} aria-hidden="true" /><h2>Bas medlemskap</h2><p className="membership-price">Gratis</p>
    <p>{offer.description.length > 200 ? `${offer.description.slice(0, 200)}…` : offer.description}</p><p className="small muted">Kostnadsfritt · ingen bindningstid</p>
    {memberCount !== undefined && <p className="small muted">{memberCount} {memberCount === 1 ? "registrerad medlem" : "registrerade medlemmar"}</p>}
    <Link href={admin ? "/admin/medlemskap/bas" : "/medlemskap/bas"} className="button button-secondary">{admin ? "Redigera Bas" : "Visa Bas medlemskap"}<ArrowRight size={17} aria-hidden="true" /></Link>
  </article>;
}

export function StudentFreeMembershipCard({ offer, membership }: { offer: FreeMembershipOffer; membership: StudentFreeMembership }) {
  return <section className="membership-subscription stack" aria-labelledby="free-membership-heading"><h2 id="free-membership-heading">Bas medlemskap</h2>
    <p><strong>Gratis</strong> · {membership.isMember ? "Du är medlem" : "Kostnadsfritt medlemskap"}</p>
    {membership.joinedAt && <p className="small muted">Medlem sedan {formatDateTime(membership.joinedAt)}</p>}
    <p>{offer.description}</p>
    {membership.isMember ? membership.verified ? <>
      {offer.groups.length > 0 ? <div className="membership-actions">{offer.groups.map(group => <Link key={group.id} href={`/elevportal/grupper/${group.id}`} className="text-link">Öppna {group.name}</Link>)}</div>
        : <p className="small muted">Grupper och material visas här när de läggs till i Bas.</p>}
    </> : <p className="notice">Verifiera din e-postadress för att öppna de grupper och det material som ingår. <Link href="/verifiera-epost?returnTo=%2Felevportal%2Fmedlemskap" className="inline-link">Verifiera e-post</Link></p>
      : membership.verified ? <FreeMembershipJoinButton returnTo="/elevportal/medlemskap" />
        : <p className="notice">Verifiera din e-postadress för att gå med. <Link href="/verifiera-epost?returnTo=%2Felevportal%2Fmedlemskap" className="inline-link">Verifiera e-post</Link></p>}
    <Link href="/medlemskap/bas" className="text-link">Om Bas medlemskap</Link>
  </section>;
}
