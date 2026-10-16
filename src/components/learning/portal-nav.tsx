"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { Award, BookOpen, Users, UserRound, Waves } from "lucide-react";

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="portal-nav" aria-label="Medlemsportal">
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
      <Link href="/elevportal/diplom" intentOnly className={pathname.startsWith("/elevportal/diplom") ? "active" : ""} aria-current={pathname.startsWith("/elevportal/diplom") ? "page" : undefined}>
        <Award size={17} aria-hidden="true"/> Mina diplom
      </Link>
      <Link href="/elevportal/rening" intentOnly className={pathname.startsWith("/elevportal/rening") ? "active" : ""} aria-current={pathname.startsWith("/elevportal/rening") ? "page" : undefined}>
        <Waves size={17} aria-hidden="true"/> Rening
      </Link>
      <Link href="/elevportal/konto" intentOnly className={["/elevportal/konto", "/elevportal/kop", "/elevportal/medlemskap"].some(path => pathname.startsWith(path)) ? "active" : ""} aria-current={["/elevportal/konto", "/elevportal/kop", "/elevportal/medlemskap"].some(path => pathname.startsWith(path)) ? "page" : undefined}>
        <UserRound size={17} aria-hidden="true"/> Mitt konto
      </Link>
    </nav>
  );
}
