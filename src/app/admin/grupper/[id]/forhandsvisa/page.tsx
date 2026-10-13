import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAdminGroup,getAdminPosts } from "@/lib/memberships";
import { membershipRouteId } from "@/lib/membership-route";
import { AdminHeading } from "@/components/admin/common";
import { GroupCourseLinks,GroupPostsList,MembershipGroupIntro } from "@/components/memberships/views";
export default async function GroupPreviewPage({params}:{params:Promise<{id:string}>}) {const user=await requireAdmin(),id=membershipRouteId((await params).id),[group,posts]=await Promise.all([getAdminGroup(user.id,id),getAdminPosts(user.id,id)]);if(!group)notFound();return <><AdminHeading title="Förhandsgranska grupp" description="Granska det sparade innehållet. Utkast visas här för admin." action={<Link href={`/admin/grupper/${id}`} className="button button-secondary">Tillbaka till gruppen</Link>}/><p className="notice">Administratörsvy · Gruppen är {group.published?"publicerad":"ett utkast"}. Elever ser bara publicerat material i publicerade grupper.</p><MembershipGroupIntro group={group} preview/><GroupCourseLinks group={group} admin/><GroupPostsList posts={posts} groupId={id} admin preview/></>;}
