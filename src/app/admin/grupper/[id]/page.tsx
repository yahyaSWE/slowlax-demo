import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCourses } from "@/lib/db";
import { getAdminStudentChoices } from "@/lib/admin-students";
import { getAdminGroup,getAdminPosts,getAdminAssignments } from "@/lib/memberships";
import { getAdminSubscriptions } from "@/lib/membership-billing";
import { getAdminCoursePurchases } from "@/lib/course-purchase-billing";
import { CoursePurchasesList } from "@/components/learning/course-purchases-list";
import { membershipRouteId } from "@/lib/membership-route";
import { removeGroupAssignmentAction } from "@/lib/membership-actions";
import { AdminHeading,AdminNotice,dateOnly,type AdminSearchParams } from "@/components/admin/common";
import { GroupAssignmentForm,GroupForm } from "@/components/admin/membership-forms";
import { GroupPostsList } from "@/components/memberships/views";
import { SubscriptionList } from "@/components/memberships/subscription-list";
import { SubmitButton } from "@/components/admin/submit-button";
export default async function EditGroupPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:AdminSearchParams}) {
  const user=await requireAdmin(),id=membershipRouteId((await params).id);
  const [group,courses,posts,assignments,subscriptions,students,purchases]=await Promise.all([getAdminGroup(user.id,id),getCourses(),getAdminPosts(user.id,id),getAdminAssignments(user.id,id),getAdminSubscriptions(user.id,id),getAdminStudentChoices(user.id),getAdminCoursePurchases(user.id)]);
  if(!group)notFound();
  return <><AdminHeading title={group.name} description={`${group.published?"Publicerad":"Utkast"} · ${group.courses.length} ${group.courses.length===1?"kurs":"kurser"} · ${posts.length} inlägg`} action={<div className="membership-actions"><Link href="/admin/grupper" className="text-link">Alla grupper</Link><Link href={`/admin/grupper/${id}/forhandsvisa`} className="button button-secondary">Förhandsgranska grupp</Link></div>}/><AdminNotice searchParams={searchParams}/>
    <section className="panel form-panel"><h2>Gruppens uppgifter</h2><GroupForm group={group} courses={courses}/></section>
    <section className="panel"><div className="section-heading"><h2>Inlägg och material</h2><Link href={`/admin/grupper/${id}/inlagg/ny`} className="button button-primary">Nytt inlägg</Link></div><GroupPostsList posts={posts} groupId={id} admin/></section>
    <div className="membership-columns"><section className="panel"><h2>Manuellt tilldelad åtkomst</h2>{assignments.length?<div className="table-wrap"><table className="admin-table"><thead><tr><th>Elev</th><th>Slutdatum</th><th>Åtgärd</th></tr></thead><tbody>{assignments.map(assignment=><tr key={assignment.id}><td>{assignment.name}<small className="muted">{assignment.email}</small></td><td>{assignment.expiresAt?`${dateOnly(new Date(Date.parse(assignment.expiresAt)-60000).toISOString())}${Date.parse(assignment.expiresAt)<=Date.now()?" · utgånget":""}`:"Obegränsad"}</td><td><form action={removeGroupAssignmentAction}><input type="hidden" name="id" value={assignment.id}/><input type="hidden" name="groupId" value={id}/><SubmitButton className="button button-danger button-small">Ta bort manuell tillgång</SubmitButton></form></td></tr>)}</tbody></table></div>:<p className="muted">Inga elever har tilldelats gruppen manuellt.</p>}<p className="small muted">Att ta bort manuell gruppåtkomst ändrar inte elevens separata kurstillgång eller betalda abonnemang.</p></section><section className="panel form-panel"><h2>Tilldela en elev</h2><GroupAssignmentForm groupId={id} students={students}/></section></div>
    <section className="panel"><h2>Abonnemang i gruppen</h2><SubscriptionList subscriptions={subscriptions} admin/></section>
    <section className="panel"><h2>Gruppåtkomst från kursköp</h2><p className="muted">Här visas kursköp och paket där gruppen ingick, med avtalad tidsgräns och eventuell spärr efter återbetalning eller tvist.</p><CoursePurchasesList purchases={purchases.filter(purchase=>purchase.groups.some(group=>group.id===id))} admin/></section>
  </>;
}
