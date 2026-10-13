"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Clock3,
  FileText,
  LayoutDashboard,
  Package,
  Settings2,
  Sprout,
  ShoppingBag,
  Store,
  TicketPercent,
  Truck,
  Stethoscope,
  Users,
} from "lucide-react";

const links = [
  { href: "/admin", label: "Översikt", icon: LayoutDashboard },
  { href: "/admin/bokningar", label: "Bokningar", icon: CalendarDays },
  { href: "/admin/behandlingar", label: "Behandlingar", icon: Sprout },
  { href: "/admin/behandlare", label: "Behandlare", icon: Stethoscope },
  { href: "/admin/tider", label: "Tillgängliga tider", icon: Clock3 },
  { href: "/admin/artiklar", label: "Artiklar", icon: FileText },
  { href: "/admin/kurser", label: "Kurser", icon: BookOpen },
  { href: "/admin/elever", label: "Elever", icon: Users },
  { href: "/admin/grupper", label: "Grupper", icon: Users },
  { href: "/admin/medlemskap", label: "Medlemskap", icon: TicketPercent },
  { href: "/admin/butik", label: "Butik", icon: Store },
  { href: "/admin/produkter", label: "Produkter", icon: Package },
  { href: "/admin/rabatter", label: "Rabatter", icon: TicketPercent },
  { href: "/admin/frakt", label: "Frakt", icon: Truck },
  { href: "/admin/bestallningar", label: "Beställningar", icon: ShoppingBag },
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
