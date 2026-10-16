import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCourses } from "@/lib/db";
import { AdminHeading } from "@/components/admin/common";
import { CourseBundleForm } from "@/components/admin/course-bundle-form";

export default async function NewBundlePage() {
  await requireAdmin(); const courses = await getCourses();
  return <><AdminHeading title="Skapa kurspaket" description="Välj minst två kurser och ange ett gemensamt paketpris." action={<Link href="/admin/paket" className="text-link">Alla paket</Link>} /><section className="panel form-panel"><CourseBundleForm courses={courses} /></section></>;
}
