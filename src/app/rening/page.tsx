import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { getSiteSettings } from "@/lib/site-data";
import { createPageMetadata } from "@/lib/seo";
import { ReningOffers } from "@/components/purification/offers";

export const metadata = createPageMetadata({
  title: "Rening av investeringar", path: "/rening",
  description: "Skicka in dina aktieinnehav för Slowlax granskning enligt islamiska principer och läs svaret i elevportalen. Rening kan ingå i medlemskap och kurspaket eller köpas separat.",
});

export default async function PurificationPage() {
  const settings = await getSiteSettings();
  return (
    <section className="container section">
      <div className="page-heading">
        <span className="eyebrow">RENING AV INVESTERINGAR</span>
        <h1>Förstå dina innehav.<br /><em>Få klarhet i reningen.</em></h1>
        <p>En granskning av bolagens inkomster hjälper dig att förstå vilken del som behöver renas enligt islamiska principer.</p>
      </div>
      <div className="about-grid">
        <div className="about-image">
          <Image src="/images/slowlax-rening.png" alt="Slowlax illustration om rening av investeringar" fill sizes="(max-width:760px) 100vw, 45vw" />
        </div>
        <div className="prose">
          <h2>Vad betyder rening?</h2>
          <p>Även ett bolag med en tillåten kärnverksamhet kan få en mindre del av sina inkomster från källor som inte är tillåtna enligt islamiska principer. Den delen behöver identifieras för att beräkna ett belopp att skänka bort.</p>
          <p>Vi granskar aktieinnehaven i din portfölj och beräknar vilket belopp som behöver renas. Vårt arbetssätt utgår från AAOIFI:s kriterier.</p>
          <p>Vill du veta mer om granskningen av din portfölj? Kontakta oss med dina frågor så kan vi berätta hur du går vidare.</p>
          {settings.email ? <a href={`mailto:${settings.email}`} className="button button-primary">Kontakta oss om rening <ArrowUpRight size={18} aria-hidden="true" /></a> : <Link href="/kontakt" className="button button-primary">Kontakta Slowlax <ArrowUpRight size={18} aria-hidden="true" /></Link>}
        </div>
      </div>
      <ReningOffers />
      <div className="section prose narrow">
        <span className="eyebrow">SÅ FUNGERAR GRANSKNINGEN</span>
        <h2>Från innehav till sammanställning</h2>
        <ol>
          <li><strong>Sammanställ dina aktier.</strong> Granskningen utgår från vilka bolag du har i portföljen.</li>
          <li><strong>Bolagen analyseras.</strong> Innehaven granskas enligt islamiska kriterier och det belopp som behöver renas beräknas.</li>
          <li><strong>Du får ett svar i elevportalen.</strong> Admin granskar ditt ärende och publicerar svaret på din elevsida.</li>
        </ol>
        <h2>Vanliga frågor om rening</h2>
        <h3>Behövs rening även när jag väljer tillåtna bolag?</h3>
        <p>Det kan behövas. Granskningen av kärnverksamheten och beräkningen av eventuella inkomster från otillåtna källor är olika delar av bedömningen.</p>
        <h3>Hur ofta görs granskningen?</h3>
        <p>Utgångspunkten är en årlig genomgång. Kontakta oss om vilka uppgifter och vilken period som behöver ingå för dina innehav.</p>
        <h3>Vilka kriterier utgår Slowlax från?</h3>
        <p>Vi utgår från AAOIFI, Accounting and Auditing Organization for Islamic Financial Institutions. <Link href="/investeringsfilosofi">Läs mer om vår investeringsfilosofi och screening</Link>.</p>
        <h3>Hur får jag mer information?</h3>
        <p>Hör av dig via <Link href="/kontakt">kontaktsidan</Link> för information om granskningens omfattning, underlag och nästa steg.</p>
      </div>
    </section>
  );
}
