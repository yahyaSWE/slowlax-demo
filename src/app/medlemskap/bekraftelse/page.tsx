import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getUserSubscriptions,getMembershipCheckoutConfirmation } from "@/lib/membership-billing";
import { PRIVATE_METADATA } from "@/lib/seo";
import { SubscriptionList } from "@/components/memberships/subscription-list";
import { MembershipStatusRefreshButton } from "@/components/memberships/billing-controls";
export const dynamic="force-dynamic";
export const metadata={...PRIVATE_METADATA,title:"Bekräftelse på medlemskap"};
export default async function MembershipConfirmationPage({searchParams}:{searchParams:Promise<{session_id?:string}>}){const user=await requireUser(),query=await searchParams,[subscriptions,checkout]=await Promise.all([getUserSubscriptions(user.id),query.session_id?getMembershipCheckoutConfirmation(user.id,query.session_id):Promise.resolve(null)]);return <section className="section container"><header className="membership-hero"><h1 className="page-title">{checkout?.confirmed?"Ditt medlemskap är bekräftat":checkout?.status==='cancelled'?"Betalningen slutfördes inte":checkout?"Vi inväntar betalningsbekräftelsen":"Dina medlemskap"}</h1><p>{checkout?.confirmed?`${checkout.planName} är tillgängligt i elevportalen.`:checkout?.status==='cancelled'?"Du kan välja ett medlemskap och försöka igen.":checkout?"Åtkomsten öppnas när Stripe har bekräftat betalningen. Det kan ta en kort stund.":"Se dina abonnemang och öppna dina grupper nedan."}</p></header><SubscriptionList subscriptions={subscriptions}/><div className="membership-actions"><Link href="/elevportal/grupper" className="button button-primary">Till mina grupper</Link><MembershipStatusRefreshButton/></div></section>;}
