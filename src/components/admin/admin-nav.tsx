"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Mail,
  Settings2,
  TicketPercent,
  Users,
  Waves,
} from "lucide-react";

const links = [
  { href: "/admin", label: "Översikt", icon: LayoutDashboard },
  { href: "/admin/artiklar", label: "Artiklar", icon: FileText },
  { href: "/admin/kurser", label: "Kurser", icon: BookOpen },
  { href: "/admin/paket", label: "Kurspaket", icon: TicketPercent },
  { href: "/admin/elever", label: "Elever", icon: Users },
  { href: "/admin/grupper", label: "Grupper", icon: Users },
  { href: "/admin/medlemskap", label: "Medlemskap", icon: TicketPercent },
  { href: "/admin/rening", label: "Rening", icon: Waves },
  { href: "/admin/nyhetsbrev", label: "Nyhetsbrev", icon: Mail },
  { href: "/admin/installningar", label: "Inställningar", icon: Settings2 },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Administration">
      {links.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            intentOnly
            className={`admin-nav-link${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
