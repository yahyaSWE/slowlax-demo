import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAdminPlans,getMembershipSettings } from "@/lib/memberships";
import { membershipBillingReady,membershipPortalReady,getAdminSubscriptions } from "@/lib/membership-billing";
import { AdminHeading,AdminNotice,type AdminSearchParams } from "@/components/admin/common";
import { MembershipSettingsForm } from "@/components/admin/membership-forms";
import { MembershipPlanCard } from "@/components/memberships/views";
import { SubscriptionList } from "@/components/memberships/subscription-list";
export default async function MembershipAdminPage({searchParams}:{searchParams:AdminSearchParams}) {
  const user=await requireAdmin(),[plans,settings,subscriptions]=await Promise.all([getAdminPlans(user.id),getMembershipSettings(),getAdminSubscriptions(user.id)]);
  return <><AdminHeading title="Medlemskap och abonnemang" description="Förbered erbjudanden, välj grupp och pris och öppna försäljningen när allt är klart." action={<Link href="/admin/medlemskap/ny" className="button button-primary">Skapa medlemskap</Link>}/><AdminNotice searchParams={searchParams}/><div className="notice" role="status">Försäljning: {settings.salesEnabled?"öppen":"avstängd"} · Betalningskonfiguration: {membershipBillingReady()?"angiven":"saknas"} · Kundportal: {membershipPortalReady()?"angiven":"saknas"}. Anslutningen behöver testas i Stripe innan du börjar sälja.</div><section className="panel"><h2>Medlemskap</h2>{plans.length?<div className="membership-cards">{plans.map(plan=><MembershipPlanCard plan={plan} admin key={plan.id}/>)}</div>:<p className="muted">Skapa först en grupp och lägg sedan upp ditt första medlemskap.</p>}<Link href="/admin/grupper" className="text-link">Hantera grupper och innehåll</Link></section><section className="panel form-panel"><h2>Försäljning och villkor</h2><MembershipSettingsForm settings={settings}/></section><section className="panel"><h2>Elevabonnemang</h2><SubscriptionList subscriptions={subscriptions} admin/></section></>;
}
