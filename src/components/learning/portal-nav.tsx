"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { BookOpen, Users, UserRound } from "lucide-react";

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
        <Users size={17} aria-hidden="true"/> Grupper & material
      </Link>
      <Link href="/elevportal/konto" intentOnly className={["/elevportal/konto", "/elevportal/kop", "/elevportal/medlemskap"].some(path => pathname.startsWith(path)) ? "active" : ""} aria-current={["/elevportal/konto", "/elevportal/kop", "/elevportal/medlemskap"].some(path => pathname.startsWith(path)) ? "page" : undefined}>
        <UserRound size={17} aria-hidden="true"/> Mitt konto
      </Link>
    </nav>
  );
}
