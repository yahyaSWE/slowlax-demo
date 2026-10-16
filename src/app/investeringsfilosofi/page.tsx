import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Vår investeringsfilosofi – halal och etiska investeringar", path: "/investeringsfilosofi",
  description: "Lär känna Slowlax syn på långsiktigt aktiesparande, etisk screening och halalinvesteringar med AAOIFI:s principer som utgångspunkt.",
});

export default function InvestmentPhilosophyPage() {
  return (
    <section className="container section investment-philosophy-page">
      <div className="page-heading">
        <span className="eyebrow">VÅR INVESTERINGSFILOSOFI</span>
        <h1>Väx med tålamod.<br /><em>Investera med dina värderingar.</em></h1>
        <p>Vi vill göra det möjligt att förstå börsen och investera långsiktigt i linje med islamiska och etiska principer.</p>
      </div>
      <div className="about-grid">
        <div className="about-image">
          <Image src="/images/slowlax-about.png" alt="Illustration av sparande, människor och långsiktig tillväxt" fill sizes="(max-width:760px) 100vw, 45vw" />
        </div>
        <div className="prose">
          <h2>Kunskap före snabba pengar</h2>
          <p>Namnet Slowlax förenar ”Slow” och ”Lax” som en motsats till ”snabba cash”. Vår syn på aktiesparande bygger på tålamod och en långsiktig tidshorisont på minst fem år.</p>
          <p>Halalinvesteringar på börsen ryms inom ramen för etiska investeringar. Det innebär att både bolagets verksamhet och dess finansiella förhållanden behöver granskas. Det är till exempel inte tillåtet att investera i företag vars kärnverksamhet är tobak, alkohol eller hasardspel.</p>
          <p>Slowlax inspireras av idén att ge den muslimska målgruppen möjlighet att investera på börsen i linje med sin tro.</p>
          <Link href="/kurser" className="button button-primary">Lär dig mer i våra kurser <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className="section prose narrow">
        <span className="eyebrow">HALALSCREENING</span>
        <h2>Vad gör en investering halal?</h2>
        <p>Vi utgår från AAOIFI, Accounting and Auditing Organization for Islamic Financial Institutions. Organisationen utvecklar och publicerar standarder för den islamiska finansindustrin. Vår aktiescreening bygger på sharia-standard nr 21 och omfattar följande kriterier.</p>
        <h3>1. Affärsscreening</h3>
        <p>Är företagets kärnverksamhet och kärnprodukter tillåtna? Intäkter från otillåtna aktiviteter ska utgöra mindre än 5 procent av företagets totala omsättning.</p>
        <h3>2. Räntebärande skulder</h3>
        <p>Bolagets totala räntebärande skulder jämförs med dess börsvärde. Nyckeltalet får inte överstiga 30 procent.</p>
        <h3>3. Räntebärande värdepapper</h3>
        <p>Kassa, tillgodohavanden hos bank och kortfristiga placeringar jämförs med bolagets börsvärde. Nyckeltalet får inte överstiga 30 procent.</p>
        <p>Screening bygger på uppgifter om bolaget och kräver en bedömning av den tillämpliga standarden. Läs <a href="https://aaoifi.com/ss-21-financial-paper-shares-and-bonds/?lang=en" target="_blank" rel="noopener noreferrer">AAOIFI:s standard om aktier och obligationer</a> för originalkällan.</p>
        <h2>Förstå också reningen</h2>
        <p>Ett bolag kan ha mindre inkomster från källor som inte är tillåtna även om kärnverksamheten godkänns. Att identifiera den delen och beräkna vad som behöver skänkas bort kallas rening.</p>
        <Link href="/rening" className="text-link">Läs om rening av investeringar <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
