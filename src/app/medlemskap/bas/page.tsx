import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPublicFreeMembership, getStudentFreeMembership } from "@/lib/free-membership-domain";
import { accountAuthHref } from "@/lib/account-return";
import { createPageMetadata } from "@/lib/seo";
import { TextContent } from "@/components/learning/cards";
import { FreeMembershipJoinButton } from "@/components/memberships/free-membership-controls";
import { getPurificationQuotaSettings } from "@/lib/purification-domain";
import { DEMO_MODE } from "@/lib/demo-mode";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata({ title: "Bas medlemskap – gratis", description: "Bli en del av Slowlax med Bas medlemskap. Kostnadsfritt medlemskap med gemenskap och uppdateringar.", path: "/medlemskap/bas" });

export default async function FreeMembershipPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const [offer, user, query] = await Promise.all([getPublicFreeMembership(), getCurrentUser(), searchParams]);
  const membership = user?.role === "student" ? await getStudentFreeMembership(user.id) : null;
  const quota = await getPurificationQuotaSettings("bas", 1);
  const returnTo = "/medlemskap/bas";
  return <section className="section container"><Link href="/medlemskap" className="back-link">Alla medlemskap</Link>
    <header className="membership-hero"><p className="eyebrow">Gemenskap med Slowlax</p><h1 className="page-title">Bas medlemskap</h1><p className="membership-price">Gratis</p><p>Kostnadsfritt medlemskap · ingen bindningstid</p></header>
    {typeof query.success === "string" && <p className="notice notice-success" role="status">{query.success.slice(0, 500)}</p>}
    <div className="membership-columns"><div className="membership-panel"><h2>Det här ingår</h2><TextContent text={offer.description} />
      {offer.groups.length > 0 && <><h3>Grupper i Bas</h3><ul>{offer.groups.map(group => <li key={group.id}>{group.name}</li>)}</ul><p>Gruppernas publicerade kurser, inlägg och material samlas i elevportalen.</p></>}
      <h3>Slowlax nyhetsbrev</h3><p>{DEMO_MODE ? "Nyhetsbrev och uppdateringar kan vara en del av gemenskapen. I visningsversionen skickas inga inbjudningar och inga e-postadresser samlas in." : "Du kan få en separat inbjudan till nyhetsbrevet via e-post. Bekräfta den om du vill få nyhetsbrevet. Du kan avregistrera dig när som helst."}</p>
      {quota.credits > 0 && <p><Link href="/rening" className="inline-link">Rening</Link> av {quota.credits} bolag ingår som en engångskvot utan tidsgräns.</p>}
      <p className="small muted">Bas är gratis. Betalda kurser och medlemskap köps separat om du väljer att fördjupa dig.</p><p><Link href="/integritet" className="inline-link">Om dina personuppgifter</Link></p>
    </div><aside className="membership-panel stack"><h2>{membership?.isMember ? "Du är Bas-medlem" : "Välkommen till Bas"}</h2>
      {DEMO_MODE ? <><div className="demo-offer-note"><p><strong>En första kontakt med Slowlax.</strong></p><p>Här ser du ett exempel på det kostnadsfria Bas-medlemskapet. Konton och registrering är avstängda i visningsversionen.</p></div><button type="button" className="button button-primary" disabled>Registrering är avstängd i demon</button><Link href="/medlemskap" className="text-link">Jämför alla medlemskap</Link></> : user?.role === "admin" ? <p className="notice">Du granskar Bas som administratör. Medlemskapet gäller elevkonton.</p>
        : !user ? <><p>När du skapar ett elevkonto får du automatiskt Bas medlemskap. Verifiera din e-postadress för att öppna innehållet som ingår.</p><Link href={accountAuthHref("/registrera", returnTo)} className="button button-primary">Skapa konto och bli medlem gratis</Link><Link href={accountAuthHref("/logga-in", returnTo)} className="text-link">Har du redan ett konto? Logga in</Link></>
          : !user.emailVerifiedAt ? <><p>{membership?.isMember ? "Ditt kostnadsfria Bas-medlemskap är registrerat." : "Verifiera din e-postadress för att gå med i Bas."} Därefter får du tillgång till grupper och material som ingår.</p><Link href={accountAuthHref("/verifiera-epost", returnTo)} className="button button-primary">Verifiera e-post</Link></>
            : membership?.isMember ? <><p>Ditt medlemskap är kostnadsfritt och visas i elevportalen.</p><Link href="/elevportal/medlemskap" className="button button-primary">Till mitt medlemskap</Link>{offer.groups.length > 0 && <Link href="/elevportal/grupper" className="text-link">Öppna mina grupper</Link>}</>
              : <FreeMembershipJoinButton />}
    </aside></div>
  </section>;
}
