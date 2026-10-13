import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAdminGroups } from "@/lib/memberships";
import { AdminHeading, EmptyState } from "@/components/admin/common";
import { MembershipGroupCard } from "@/components/memberships/views";
export default async function GroupsPage() {
  const user=await requireAdmin(),groups=await getAdminGroups(user.id);
  return <><AdminHeading title="Grupper" description="Samla kurser och privat material för dina elever. Tilldela grupper manuellt eller koppla dem till ett medlemskap." action={<Link href="/admin/grupper/ny" className="button button-primary">Skapa grupp</Link>}/>{groups.length?<div className="membership-cards">{groups.map(group=><MembershipGroupCard group={group} admin key={group.id}/>)}</div>:<EmptyState title="Skapa din första grupp" href="/admin/grupper/ny" label="Skapa grupp">Förbered exempelvis matplaner, recept och kurser för en utvald grupp elever.</EmptyState>}</>;
}
