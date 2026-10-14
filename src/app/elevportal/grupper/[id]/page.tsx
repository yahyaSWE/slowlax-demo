import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccessibleGroup,getGroupPosts } from "@/lib/memberships";
import { getStudentGroupAccessState } from "@/lib/student-access";
import { StudentAccessDetails, StudentAccessNotice } from "@/components/learning/student-access-notice";
import { membershipRouteId } from "@/lib/membership-route";
import { GroupCourseLinks,GroupPostsList,MembershipGroupIntro } from "@/components/memberships/views";
import { GroupMonthFilter } from "@/components/memberships/month-filter";
export default async function PortalGroupPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{month?:string}>}) {
  const user=await requireUser(),id=membershipRouteId((await params).id);
  const [group,access]=await Promise.all([getAccessibleGroup(user.id,id),getStudentGroupAccessState(user.id,id)]);
  if(!group) { if(access)return <StudentAccessNotice access={access} kind="group"/>;notFound(); }
  const [posts,query]=await Promise.all([getGroupPosts(user.id,id),searchParams]),months=[...new Set(posts.map(post=>post.period).filter((period):period is string=>!!period))].sort().reverse(),selected=months.includes(query.month??"")?query.month:"",visible=selected?posts.filter(post=>post.period===selected):posts;
  return <><Link href="/elevportal/grupper" className="back-link">Till mina grupper</Link>{user.role==="admin"&&<p className="notice">Administratörsvy · Utkast visas för dig. <Link href={`/admin/grupper/${id}`} className="inline-link">Redigera grupp</Link></p>}<MembershipGroupIntro group={group}/>{access&&<section className="membership-panel membership-access-summary"><StudentAccessDetails access={access}/><p className="small muted">Kurser som du har köpt separat behåller sin egen åtkomst även om gruppåtkomsten löper ut.</p></section>}<GroupCourseLinks group={group}/><section><h2>Gruppens material</h2>{months.length>0&&<GroupMonthFilter months={months} selected={selected??""}/>}<GroupPostsList posts={visible} groupId={id} admin={user.role==="admin"} preview/></section></>;
}
