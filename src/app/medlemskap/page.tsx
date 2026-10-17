import Link from "next/link";
import { getPublicPlans } from "@/lib/memberships";
import { getPublicFreeMembership } from "@/lib/free-membership-domain";
import { createPageMetadata } from "@/lib/seo";
import { MembershipPlanCard } from "@/components/memberships/views";
import { FreeMembershipCard } from "@/components/memberships/free-membership";
import { DEMO_MODE } from "@/lib/demo-mode";
export const dynamic = "force-dynamic";
export const metadata = createPageMetadata({ title: "Medlemskap", description: "Välj Bas medlemskap kostnadsfritt eller utforska Slowlax medlemskap med kurser, grupper och gemenskap.", path: "/medlemskap" });
export default async function MembershipsPage() {
  const [freeMembership, plans] = await Promise.all([getPublicFreeMembership(), getPublicPlans()]);
  return <section className="section container">
    <header className="page-heading"><p className="eyebrow">LÄR TILLSAMMANS MED SLOWLAX</p><h1>En gemenskap.<br /><em>Flera vägar att växa.</em></h1><p>Kurser och kunskapsdelning för dig som vill lära dig mer om etiska och halalinvesteringar.</p></header>
    <div className="membership-cards"><FreeMembershipCard offer={freeMembership} />{plans.map(plan => <MembershipPlanCard key={plan.id} plan={plan} />)}</div>
    {DEMO_MODE ? <div className="demo-offer-note" style={{marginTop:32}}><p>Medlemskapen visar exempel på hur kurser, grupper och rening kan kombineras. Priserna är exempelpriser och medlemskap kan inte tecknas i visningsversionen.</p></div> : <div className="section-heading" style={{marginTop:48}}><h2>Redan medlem?</h2><Link href="/elevportal" className="button button-secondary">Till elevportalen</Link></div>}
  </section>;
}
