import { notFound } from "next/navigation";
import { getPublicPlans } from "@/lib/memberships";
import { createPageMetadata,PRIVATE_METADATA } from "@/lib/seo";
import { membershipSettingsForRender } from "@/components/memberships/server-data";
import { MembershipPlanCard } from "@/components/memberships/views";
export const dynamic="force-dynamic";
export async function generateMetadata(){return(await membershipSettingsForRender()).salesEnabled?createPageMetadata({title:"Medlemskap",description:"Utforska medlemskap med kurser och nytt gruppmaterial hos Tibb.nu.",path:"/medlemskap"}):PRIVATE_METADATA;}
export default async function MembershipsPage(){const settings=await membershipSettingsForRender();if(!settings.salesEnabled)notFound();const plans=await getPublicPlans();return <section className="section container"><header className="membership-hero"><h1 className="page-title">Medlemskap</h1><p>Lär i din egen takt med kurser och material för din grupp. Välj det medlemskap som passar dig.</p></header>{plans.length?<div className="membership-cards">{plans.map(plan=><MembershipPlanCard key={plan.id} plan={plan}/>)}</div>:<div className="empty-state"><h2>Nya medlemskap är på väg</h2><p>Här visas erbjudandena när de är publicerade.</p></div>}</section>;}
