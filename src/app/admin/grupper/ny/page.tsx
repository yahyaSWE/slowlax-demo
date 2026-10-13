import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCourses } from "@/lib/db";
import { AdminHeading } from "@/components/admin/common";
import { GroupForm } from "@/components/admin/membership-forms";
export default async function NewGroupPage() {await requireAdmin();const courses=await getCourses();return <><AdminHeading title="Skapa grupp" description="Börja med en grupp och välj vilka kurser som ska ingå. Lägg sedan till inlägg och elever." action={<Link href="/admin/grupper" className="text-link">Alla grupper</Link>}/><section className="panel form-panel"><GroupForm courses={courses}/></section></>;}
