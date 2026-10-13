"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpRight, Leaf, Menu, UserRound, X } from "lucide-react";
import "./content-accessibility.css";
import "./site-chrome-shop.css";
import "./memberships/memberships.css";

export function OliveMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 46 46"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11 37C22 27 25 15 35 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 28C12 29 8 24 8 18c8 0 13 3 12 10ZM25 20C17 22 14 17 15 11c7 0 12 3 10 9ZM30 14c-5-6-2-11 3-13 4 5 4 10-3 13ZM22 26c8-1 13 2 13 8-8 1-12-2-13-8ZM28 17c8-2 13 0 14 6-7 3-12 1-14-6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SiteChrome({
  children,
  siteName,
  contactEmail,
  user,
  legalName,
  organizationNumber,
  shopEnabled = false,
  membershipEnabled = false,
}: {
  children: React.ReactNode;
  siteName: string;
  contactEmail: string;
  user: { name: string; role: string } | null;
  legalName?: string;
  organizationNumber?: string;
  shopEnabled?: boolean;
  membershipEnabled?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  if (pathname.startsWith("/admin") || pathname.startsWith("/elevportal"))
    return <>{children}</>;
  const nav = [
    { href: "/", label: "Startsida" },
    { href: "/boka", label: "Behandlingar & bokning" },
    { href: "/kurser", label: "Kurser" },
    ...(membershipEnabled ? [{ href: "/medlemskap", label: "Medlemskap" }] : []),
    { href: "/artiklar", label: "Artiklar" },
    { href: "/sjalvtest", label: "Självtest" },
    { href: "/om", label: "Om Tibb" },
    ...(shopEnabled ? [{ href: "/butik", label: "Butik" }, { href: "/butik/varukorg", label: "Varukorg" }] : []),
  ];
  const brandName = siteName.endsWith(".nu") ? siteName.slice(0, -3) : siteName;
  const active = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">
        Hoppa till innehållet
      </a>
      <header
        className={`site-header${shopEnabled ? " site-header-with-shop" : ""}${membershipEnabled ? " site-header-with-memberships" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            setOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="header-inner">
          <Link
            href="/"
            className="brand"
            aria-label={`${siteName}, startsida`}
            onNavigate={() => setOpen(false)}
          >
            <OliveMark />
            <span>
              {brandName}
              {siteName.endsWith(".nu") && (
                <span className="brand-domain">.nu</span>
              )}
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="Huvudmeny">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={
                  item.href === "/om" || item.href === "/sjalvtest"
                    ? true
                    : undefined
                }
                className={active(item.href) ? "active" : ""}
                aria-current={
                  pathname === item.href
                    ? "page"
                    : active(item.href)
                      ? "location"
                      : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            className="portal-link"
            intentOnly
            href={
              user?.role === "admin"
                ? "/admin"
                : user
                  ? "/elevportal"
                  : "/logga-in"
            }
          >
            <UserRound size={16} />
            <span>{user?.role === "admin" ? "Admin" : "Elevportal"}</span>
          </Link>
          <button
            type="button"
            className="mobile-toggle"
            ref={menuButton}
            aria-label={open ? "Stäng menyn" : "Öppna menyn"}
            aria-expanded={open}
            aria-controls={open ? "mobile-menu" : undefined}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav id="mobile-menu" className="mobile-menu" aria-label="Mobilmeny">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={
                  item.href === "/om" || item.href === "/sjalvtest"
                    ? true
                    : undefined
                }
                onNavigate={() => setOpen(false)}
                className={active(item.href) ? "active" : undefined}
                aria-current={
                  pathname === item.href
                    ? "page"
                    : active(item.href)
                      ? "location"
                      : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main
        id="main-content"
        className={pathname === "/" ? "public-main" : "public-main inner-page"}
      >
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <div>
            <Link href="/" className="brand" intentOnly>
              <OliveMark />
              <span>{siteName}</span>
            </Link>
            <p>
              Klassisk kinesisk medicin i ljuset
              <br />
              av den Profetiska vägledningen.
            </p>
          </div>
          <div>
            <span className="footer-label">Upptäck</span>
            <Link href="/boka" intentOnly>
              Boka en behandling
            </Link>
            <Link href="/kurser" intentOnly>
              Våra kurser
            </Link>
            {shopEnabled && <Link href="/butik" intentOnly>Butik</Link>}
            {membershipEnabled && <Link href="/medlemskap" intentOnly>Medlemskap</Link>}
            <Link href="/artiklar" intentOnly>
              Kunskap & artiklar
            </Link>
            <Link href="/sjalvtest" intentOnly>
              Självtest med fem faser
            </Link>
          </div>
          <div>
            <span className="footer-label">Välkommen</span>
            <Link href="/om" intentOnly>
              Om Tibb.nu
            </Link>
            <Link href="/vanliga-fragor" intentOnly>
              Vanliga frågor
            </Link>
            <Link href="/elevportal" intentOnly>
              Elevportalen <ArrowUpRight size={13} />
            </Link>
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            ) : (
              <Link href="/kontakt" intentOnly>
                Kontakta oss
              </Link>
            )}
          </div>
          <div className="footer-note">
            <Leaf size={24} strokeWidth={1.2} />
            <p>Traditionell kinesisk medicin i ljuset av profetisk medicin</p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {siteName}
          </span>
          {legalName && (
            <span>
              {legalName}
              {organizationNumber ? ` · Org.nr ${organizationNumber}` : ""}
            </span>
          )}
          <Link href="/villkor" intentOnly>
            Boknings- och kursvillkor
          </Link>
          <Link href="/integritet" intentOnly>
            Integritet
          </Link>
          <Link href="/admin" intentOnly>
            Administration
          </Link>
        </div>
      </footer>
    </div>
  );
}
