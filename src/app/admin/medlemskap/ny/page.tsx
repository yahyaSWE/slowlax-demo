import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAdminGroups } from "@/lib/memberships";
import { AdminHeading,EmptyState } from "@/components/admin/common";
import { MembershipPlanForm } from "@/components/admin/membership-forms";
export default async function NewMembershipPage(){const user=await requireAdmin(),groups=await getAdminGroups(user.id);return <><AdminHeading title="Skapa medlemskap" description="Koppla ett återkommande pris till en grupp. Du kan förbereda erbjudandet som utkast." action={<Link href="/admin/medlemskap" className="text-link">Alla medlemskap</Link>}/>{groups.length?<section className="panel form-panel"><MembershipPlanForm groups={groups}/></section>:<EmptyState title="Skapa en grupp först" href="/admin/grupper/ny" label="Skapa grupp">Gruppen avgör vilka kurser och vilket material medlemskapet ger tillgång till.</EmptyState>}</>;}
