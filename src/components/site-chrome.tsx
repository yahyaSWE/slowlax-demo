"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, Menu, UserRound, X } from "lucide-react";
import "./content-accessibility.css";
import "./memberships/memberships.css";

export function OliveMark({ className = "" }: { className?: string }) {
  return <ChartNoAxesCombined className={className} aria-hidden="true" />;
}

export function SiteChrome({ children, siteName, contactEmail, user, legalName, organizationNumber }: {
  children: React.ReactNode; siteName: string; contactEmail: string;
  user: { name: string; role: string } | null; legalName?: string; organizationNumber?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  if (pathname.startsWith("/admin") || pathname.startsWith("/elevportal")) return <>{children}</>;
  const nav = [
    { href: "/", label: "Hem" }, { href: "/kurser", label: "Kurser" }, { href: "/paket", label: "Kurspaket" },
    { href: "/investeringsfilosofi", label: "Vår filosofi" },
    { href: "/artiklar", label: "Nyheter" }, { href: "/medlemskap", label: "Medlemskap" }, { href: "/rening", label: "Rening" },
    { href: "/om", label: "Om oss" },
  ];
  const active = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return <div className="public-site">
    <a className="skip-link" href="#main-content">Hoppa till innehållet</a>
    <header className="site-header" onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); menuButton.current?.focus(); } }}>
      <div className="header-inner">
        <Link href="/" className="brand slowlax-brand" aria-label={`${siteName}, startsida`} onNavigate={() => setOpen(false)}><img src="/images/slowlax-logo-white.png" alt={siteName} width="180" height="34" /></Link>
        <nav className="desktop-nav" aria-label="Huvudmeny">{nav.map(item => <Link key={item.href} href={item.href} className={active(item.href) ? "active" : ""} aria-current={pathname === item.href ? "page" : active(item.href) ? "location" : undefined}>{item.label}</Link>)}</nav>
        <Link className="portal-link" intentOnly href={user?.role === "admin" ? "/admin" : user ? "/elevportal" : "/logga-in"}><UserRound size={16} /><span>{user?.role === "admin" ? "Admin" : user ? "Min sida" : "Logga in"}</span></Link>
        <button type="button" className="mobile-toggle" ref={menuButton} aria-label={open ? "Stäng menyn" : "Öppna menyn"} aria-expanded={open} aria-controls={open ? "mobile-menu" : undefined} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
      {open && <nav id="mobile-menu" className="mobile-menu" aria-label="Mobilmeny">{nav.map(item => <Link key={item.href} href={item.href} onNavigate={() => setOpen(false)} className={active(item.href) ? "active" : undefined} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>}
    </header>
    <main id="main-content" className={pathname === "/" ? "public-main" : "public-main inner-page"}>{children}</main>
    <footer className="site-footer"><div className="footer-top">
      <div><Link href="/" className="brand slowlax-brand" intentOnly><img src="/images/slowlax-logo-white.png" alt={siteName} width="180" height="34" /></Link><p>Investera med kunskap.<br />Väx med dina värderingar.</p></div>
      <div><span className="footer-label">Upptäck</span><Link href="/kurser" intentOnly>Våra kurser</Link><Link href="/paket" intentOnly>Kurspaket</Link><Link href="/investeringsfilosofi" intentOnly>Halal investering</Link><Link href="/rening" intentOnly>Rening av investeringar</Link><Link href="/artiklar" intentOnly>Nyheter & artiklar</Link><Link href="/medlemskap" intentOnly>Medlemskap</Link></div>
      <div><span className="footer-label">Välkommen</span><Link href="/om" intentOnly>Om Slowlax</Link><Link href="/vanliga-fragor" intentOnly>Vanliga frågor</Link><Link href="/elevportal" intentOnly>Elevportalen <ArrowUpRight size={13} /></Link><Link href="/kontakt" intentOnly>Kontakt</Link>{contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}</div>
      <div className="footer-note"><ChartNoAxesCombined size={27} strokeWidth={1.4} /><p>En gemenskap för ansvarsfulla investerare.</p><a href="https://www.instagram.com/slowlax.se/" target="_blank" rel="noopener noreferrer">Slowlax på Instagram <ArrowUpRight size={13} /></a></div>
    </div><div className="footer-bottom"><span>© {new Date().getFullYear()} {siteName}</span>{legalName && <span>{legalName}{organizationNumber ? ` · Org.nr ${organizationNumber}` : ""}</span>}<Link href="/villkor" intentOnly>Kurs- och medlemsvillkor</Link><Link href="/integritet" intentOnly>Integritet</Link><Link href="/sjalvtest" intentOnly>Självtest med fem faser</Link><Link href="/admin" intentOnly>Administration</Link></div></footer>
  </div>;
}
