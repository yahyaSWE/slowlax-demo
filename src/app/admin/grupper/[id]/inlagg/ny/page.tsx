import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAdminGroup } from "@/lib/memberships";
import { membershipRouteId } from "@/lib/membership-route";
import { AdminHeading } from "@/components/admin/common";
import { GroupPostForm } from "@/components/admin/membership-forms";
export default async function NewPostPage({params}:{params:Promise<{id:string}>}) {const user=await requireAdmin(),id=membershipRouteId((await params).id),group=await getAdminGroup(user.id,id);if(!group)notFound();return <><AdminHeading title="Nytt gruppinlägg" description={`Publicera text, bilder och dokument för ${group.name}. Inlägget börjar som utkast.`} action={<Link href={`/admin/grupper/${id}`} className="text-link">Tillbaka till gruppen</Link>}/><section className="panel form-panel"><GroupPostForm groupId={id}/></section></>;}
