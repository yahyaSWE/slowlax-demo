import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, LogOut } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { PRIVATE_METADATA } from "@/lib/seo";
import { AdminNav } from "@/components/admin/admin-nav";
import "@/components/admin/admin.css";
import "@/components/content-accessibility.css";

export const dynamic = "force-dynamic";
export const metadata = {
  ...PRIVATE_METADATA,
  title: "Administration · Slowlax",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main-content">
        Hoppa till innehållet
      </a>
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin">
          <ChartNoAxesCombined size={30} aria-hidden="true" />
          <span>
            Slowlax
            <small>ADMINISTRATION</small>
          </span>
        </Link>
        <AdminNav />
        <div className="admin-sidebar-footer">
          <Link href="/" className="admin-nav-link">
            <ArrowUpRight size={18} aria-hidden="true" />
            Visa hemsidan
          </Link>
          <div className="admin-user">
            <span className="avatar-initial">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>Administratör</small>
            </span>
          </div>
          <form action={logoutAction}>
            <button className="admin-nav-link" type="submit">
              <LogOut size={18} aria-hidden="true" />
              Logga ut
            </button>
          </form>
        </div>
      </aside>
      <main id="admin-main-content" tabIndex={-1} className="admin-main">
        {children}
      </main>
    </div>
  );
}
