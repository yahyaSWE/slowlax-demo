import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPublicReningOffers, getReningSettings, reningBillingReady } from "@/lib/rening-offers";
import { formatMoney } from "@/lib/time";
import { DEMO_MODE } from "@/lib/demo-mode";
import { TextContent } from "@/components/learning/cards";
import { ReningCheckout } from "./forms";

export async function ReningOffers() {
  const [offers, settings, user] = await Promise.all([
    getPublicReningOffers(), getReningSettings(), getCurrentUser(),
  ]);
  return <section className="section stack">
    <div className="section-heading">
      <h2>Rening för din portfölj</h2>
      {!DEMO_MODE && <Link className="button button-primary" href="/elevportal/rening">Till Rening i elevportalen</Link>}
    </div>
    <p>En rening gäller ett bolag, oavsett antalet aktier du äger. Medlemskap kan innehålla en kvot per betald medlemsperiod. Separata köp och kurspaket ger engångsreningar.</p>
    {DEMO_MODE && <div className="demo-offer-note"><p>Här visas exempel på reningspaket och priser. Inga innehav samlas in, ärenden skapas eller köp genomförs i visningsversionen.</p></div>}
    {offers.length > 0 ? <div className="rening-grid">{offers.map(offer => <article className="panel stack" key={offer.id}>
      <h3>{offer.title}</h3>
      <p className="rening-balance">{formatMoney(offer.priceOre)}</p>
      <p>{offer.credits} bolag · {DEMO_MODE ? "exempelpris" : "engångsköp"} · inklusive {offer.vatPercent}% moms</p>
      {DEMO_MODE ? <button type="button" className="button button-primary" disabled>Köp är avstängt i demon</button>
        : !settings.salesEnabled || !reningBillingReady() ? <p>Nya separata köp är inte öppna just nu.</p>
          : !user ? <Link className="button button-primary" href="/logga-in?returnTo=%2Frening">Logga in för att köpa</Link>
            : user.role !== "student" ? <p>Teckna tjänsten med ett elevkonto.</p>
              : !user.emailVerifiedAt ? <Link href="/verifiera-epost?returnTo=%2Frening">Verifiera ditt konto för att köpa</Link>
                : <ReningCheckout offer={offer} settingsRevision={settings.updatedAt} />}
    </article>)}</div> : <p>{DEMO_MODE ? "Här presenteras exempel på hur separata reningspaket kan erbjudas." : "Separata erbjudanden visas här när de har publicerats. Du kan använda reningar som ingår i ditt medlemskap eller kurspaket i elevportalen."}</p>}
    {DEMO_MODE ? <p><Link href="/medlemskap" className="inline-link">Utforska medlemskap med rening</Link> · <Link href="/paket" className="inline-link">Se våra kurspaket</Link></p>
      : settings.terms && <details className="panel"><summary>Köpvillkor för rening</summary><TextContent text={settings.terms} /></details>}
  </section>;
}
