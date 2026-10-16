import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getFreeMembershipSettings } from "@/lib/free-membership-domain";
import { getAdminGroups } from "@/lib/memberships";
import { AdminHeading, AdminNotice, type AdminSearchParams } from "@/components/admin/common";
import { FreeMembershipForm } from "@/components/admin/free-membership-form";
import { PurificationQuotaPanel } from "@/components/purification/views";

export default async function AdminFreeMembershipPage({ searchParams }: { searchParams: AdminSearchParams }) {
  const actor = await requireAdmin();
  const [settings, groups] = await Promise.all([getFreeMembershipSettings(actor.id), getAdminGroups(actor.id)]);
  return <><AdminHeading title="Bas medlemskap" description={`Kostnadsfritt · alltid synligt · ${settings.memberCount} ${settings.memberCount === 1 ? "registrerad medlem" : "registrerade medlemmar"}`}
    action={<div className="membership-actions"><Link href="/admin/medlemskap" className="text-link">Alla medlemskap</Link><Link href="/medlemskap/bas" className="button button-secondary">Visa Bas på hemsidan</Link></div>} />
    <AdminNotice searchParams={searchParams} /><section className="panel form-panel"><FreeMembershipForm settings={settings} groups={groups} /></section>
    <PurificationQuotaPanel sourceType="bas" sourceId={1} returnTo="/admin/medlemskap/bas" />
  </>;
}
