import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccessibleGroup,getAccessiblePost } from "@/lib/memberships";
import { getStudentGroupAccessState, getStudentGroupPostAccessState } from "@/lib/student-access";
import { StudentAccessDetails, StudentAccessNotice } from "@/components/learning/student-access-notice";
import { membershipRouteId } from "@/lib/membership-route";
import { GroupPostView } from "@/components/memberships/views";
export default async function GroupPostPage({params}:{params:Promise<{id:string;postId:string}>}){
  const user=await requireUser(),values=await params,id=membershipRouteId(values.id),postId=membershipRouteId(values.postId);
  const [group,post,access]=await Promise.all([getAccessibleGroup(user.id,id),getAccessiblePost(user.id,id,postId),getStudentGroupAccessState(user.id,id)]);
  if(!group) { if(await getStudentGroupPostAccessState(user.id,id,postId))return <StudentAccessNotice access={access!} kind="group"/>;notFound(); }
  if(!post)notFound();
  return <><Link href={`/elevportal/grupper/${id}`} className="back-link">Till {group.name}</Link>{user.role==="admin"&&<p className="notice">Administratörsvy · Inlägget är {post.published?"publicerat":"ett utkast"}. <Link href={`/admin/grupper/${id}/inlagg/${postId}`} className="inline-link">Redigera inlägg</Link></p>}{access&&<section className="membership-panel membership-access-summary"><StudentAccessDetails access={access}/></section>}<GroupPostView post={post} group={group}/></>;
}
