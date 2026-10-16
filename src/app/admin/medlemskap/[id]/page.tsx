import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAdminPlan,getAdminGroups } from "@/lib/memberships";
import { membershipRouteId } from "@/lib/membership-route";
import { AdminHeading,AdminNotice,type AdminSearchParams } from "@/components/admin/common";
import { MembershipPlanForm } from "@/components/admin/membership-forms";
import { PurificationQuotaPanel } from "@/components/purification/views";
export default async function EditMembershipPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:AdminSearchParams}){const user=await requireAdmin(),id=membershipRouteId((await params).id),[plan,groups]=await Promise.all([getAdminPlan(user.id,id),getAdminGroups(user.id)]);if(!plan)notFound();return <><AdminHeading title={plan.name} description={`${plan.published?"Publicerat erbjudande":"Utkast"} · ${plan.groupName}`} action={<div className="membership-actions"><Link href="/admin/medlemskap" className="text-link">Alla medlemskap</Link><Link href={`/admin/grupper/${plan.groupId}/forhandsvisa`} className="button button-secondary">Förhandsgranska gruppen</Link></div>}/><AdminNotice searchParams={searchParams}/><section className="panel form-panel"><MembershipPlanForm plan={plan} groups={groups}/></section><PurificationQuotaPanel sourceType="membership_plan" sourceId={id} returnTo={`/admin/medlemskap/${id}`} /></>;}
