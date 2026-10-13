import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAdminGroup,getAdminPost } from "@/lib/memberships";
import { membershipRouteId } from "@/lib/membership-route";
import { AdminHeading,AdminNotice,type AdminSearchParams } from "@/components/admin/common";
import { GroupPostForm } from "@/components/admin/membership-forms";
export default async function EditPostPage({params,searchParams}:{params:Promise<{id:string;postId:string}>;searchParams:AdminSearchParams}) {const user=await requireAdmin(),values=await params,id=membershipRouteId(values.id),postId=membershipRouteId(values.postId),[group,post]=await Promise.all([getAdminGroup(user.id,id),getAdminPost(user.id,id,postId)]);if(!group||!post)notFound();return <><AdminHeading title={post.title} description={`${group.name} · ${post.published?"Publicerat":"Utkast"}`} action={<div className="membership-actions"><Link href={`/admin/grupper/${id}`} className="text-link">Tillbaka till gruppen</Link><Link href={`/elevportal/grupper/${id}/inlagg/${postId}`} className="button button-secondary">Förhandsgranska inlägg</Link></div>}/><AdminNotice searchParams={searchParams}/><section className="panel form-panel"><GroupPostForm key={post.id} groupId={id} post={post}/></section></>;}
