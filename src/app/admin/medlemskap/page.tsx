import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAdminPlans,getMembershipSettings } from "@/lib/memberships";
import { getFreeMembershipSettings } from "@/lib/free-membership-domain";
import { membershipBillingReady,membershipPortalReady,getAdminSubscriptions } from "@/lib/membership-billing";
import { AdminHeading,AdminNotice,type AdminSearchParams } from "@/components/admin/common";
import { MembershipSettingsForm } from "@/components/admin/membership-forms";
import { MembershipPlanCard } from "@/components/memberships/views";
import { SubscriptionList } from "@/components/memberships/subscription-list";
import { FreeMembershipCard } from "@/components/memberships/free-membership";
export default async function MembershipAdminPage({searchParams}:{searchParams:AdminSearchParams}) {
  const user=await requireAdmin(),[plans,settings,subscriptions,freeMembership]=await Promise.all([getAdminPlans(user.id),getMembershipSettings(),getAdminSubscriptions(user.id),getFreeMembershipSettings(user.id)]);
  return <><AdminHeading title="Medlemskap och abonnemang" description="Hantera det kostnadsfria Bas-medlemskapet och skapa betalda medlemskap med kurser och grupper." action={<Link href="/admin/medlemskap/ny" className="button button-primary">Skapa betalt medlemskap</Link>}/><AdminNotice searchParams={searchParams}/><div className="notice" role="status">Nya betalda abonnemang: {settings.salesEnabled?"öppna":"pausade"} · Betalningskonfiguration: {membershipBillingReady()?"angiven":"saknas"} · Kundportal: {membershipPortalReady()?"angiven":"saknas"}. Bas är kostnadsfritt och behöver ingen betalningsanslutning.</div><section className="panel"><h2>Medlemskap</h2><div className="membership-cards"><FreeMembershipCard offer={freeMembership} memberCount={freeMembership.memberCount} admin/>{plans.map(plan=><MembershipPlanCard plan={plan} admin key={plan.id}/>)}</div><p className="small muted">Publicerade medlemskap visas på hemsidan även när nya betalda abonnemang är pausade. Utkast visas bara för administratörer.</p><Link href="/admin/grupper" className="text-link">Hantera grupper och innehåll</Link></section><section className="panel form-panel"><h2>Försäljning och villkor för betalda abonnemang</h2><MembershipSettingsForm settings={settings}/></section><section className="panel"><h2>Betalda elevabonnemang</h2><SubscriptionList subscriptions={subscriptions} admin/></section></>;
}
