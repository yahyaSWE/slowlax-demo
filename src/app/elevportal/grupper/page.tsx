import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPortalGroups, getMembershipSettings } from "@/lib/memberships";
import { getStudentGroupAccessStates } from "@/lib/student-access";
import { formatDateTime } from "@/lib/time";
import { MembershipGroupCard } from "@/components/memberships/views";
export default async function PortalGroupsPage() {
  const user = await requireUser();
  const [groups, settings, states] = await Promise.all([getPortalGroups(user.id), getMembershipSettings(), getStudentGroupAccessStates(user.id)]);
  const inactive = states.filter(state => !state.available);
  return <>
    <header className="membership-hero"><h1 className="page-title">Grupper & material</h1><p>Öppna din grupp för att hitta kurser, matplaner och annat material.</p></header>
    {user.role === "admin" && <p className="notice">Administratörsvy · Du kan förhandsgranska alla grupper, inklusive utkast.</p>}
    {groups.length ? <div className="membership-cards">{groups.map(group => <MembershipGroupCard key={group.id} group={group}/>)}</div>
      : <div className="empty-state"><h2>Du har inga aktiva grupper ännu</h2><p>Grupper visas här när du har tilldelats åtkomst, har ett betalt medlemskap eller köpt en kurs där en grupp ingår.</p>{settings.salesEnabled && <Link href="/medlemskap" className="button button-primary">Utforska medlemskap</Link>}</div>}
    {inactive.length > 0 && <section className="membership-panel"><h2>Tidigare eller pausad gruppåtkomst</h2><p className="muted">Kontakta oss om du vill förnya åtkomsten eller behöver hjälp.</p><div className="stack">{inactive.map(access => <article key={access.id}><h3>{access.title}</h3><p>{access.status === "unpublished" ? "Gruppen är tillfälligt otillgänglig." : access.status === "expired" ? "Gruppåtkomsten har löpt ut." : "Gruppåtkomsten är inte aktiv."}{access.expiresAt && <> Senaste slutdatum: {formatDateTime(access.expiresAt)}.</>}</p><Link href={`/elevportal/grupper/${access.id}`} className="text-link">Visa information om åtkomsten</Link></article>)}</div></section>}
  </>;
}
