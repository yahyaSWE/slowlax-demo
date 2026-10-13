"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, Users, CreditCard } from "lucide-react";

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="portal-nav" aria-label="Elevportal">
      <Link
        href="/elevportal"
        intentOnly
        className={pathname === "/elevportal" || pathname.startsWith("/elevportal/kurser") ? "active" : ""}
        aria-current={pathname === "/elevportal" || pathname.startsWith("/elevportal/kurser") ? "page" : undefined}
      >
        <BookOpen size={17} /> Mina kurser
      </Link>
      <Link href="/elevportal/grupper" intentOnly className={pathname.startsWith("/elevportal/grupper") ? "active" : ""} aria-current={pathname.startsWith("/elevportal/grupper") ? "page" : undefined}>
        <Users size={17} aria-hidden="true"/> Mina grupper
      </Link>
      <Link href="/elevportal/medlemskap" intentOnly className={pathname === "/elevportal/medlemskap" ? "active" : ""} aria-current={pathname === "/elevportal/medlemskap" ? "page" : undefined}>
        <CreditCard size={17} aria-hidden="true"/> Mina abonnemang
      </Link>
      <Link href="/kurser" intentOnly>
        <Compass size={17} /> Utforska kurser
      </Link>
    </nav>
  );
}
