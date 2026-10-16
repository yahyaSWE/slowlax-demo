import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl, createPageMetadata, organizationId, websiteId } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Om Slowlax", path: "/om",
  description: "Från en aktieklubb 2018 till en gemenskap för etiska och halalinvesteringar. Lär känna Slowlax och vår långsiktiga investeringsfilosofi.",
});

export default function AboutPage() {
  return (
    <section className="container section">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "AboutPage", "@id": absoluteUrl("/om"),
        url: absoluteUrl("/om"), name: "Om Slowlax", inLanguage: "sv-SE",
        mainEntity: { "@id": organizationId() }, isPartOf: { "@id": websiteId() },
      }} />
      <div className="page-heading">
        <span className="eyebrow">OM SLOWLAX</span>
        <h1>Långsiktig tillväxt.<br /><em>Gemensamma värderingar.</em></h1>
        <p>Vi vill göra börsen tillgänglig för fler, med kunskap, tålamod och islamiska principer som grund.</p>
      </div>
      <div className="about-grid">
        <div className="about-image">
          <Image src="/images/slowlax-about.png" alt="Illustration av gemensamt sparande och långsiktig ekonomisk tillväxt" fill sizes="(max-width:760px) 100vw, 45vw" />
        </div>
        <div className="prose">
          <h2>Från intresse till gemenskap</h2>
          <p>Vi på Slowlax är en grupp på åtta högutbildade individer inom olika områden med en gemensam och djupt rotad passion för aktiesparande och ekonomisk tillväxt.</p>
          <p>Vår resa började som en aktieklubb år 2018, där vi delade vårt intresse för ekonomi och investeringar med varandra. Med tiden utvecklades denna passion till något större, något som vi nu gemensamt driver som ett företag med målsättningen att möjliggöra för att fler människor ska få en rättvis tillgång till börsen.</p>
          <h3>Slow + Lax</h3>
          <p>Slowlax är ett ekonomiskt hållbart koncept bestående av orden ”Slow” och ”Lax” som är motsatsen till ”snabba cash”. Synsättet på börsen är att man tjänar pengar på lång sikt med en tidshorisont på minst fem år.</p>
          <Link href="/investeringsfilosofi" className="button button-primary">Vår investeringsfilosofi <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className="section prose narrow">
        <span className="eyebrow">VÅR VISION</span>
        <h2>Kunskap som gör skillnad</h2>
        <p>Vårt gemensamma mål är att bidra till att fler människor får tillgång till börsen, med en stark betoning på att främja halalinvesteringar. Genom att sammanföra våra kunskaper och vår entusiasm strävar vi efter att utbilda människor i konsten att investera ansvarsfullt, med vår etik och moral som baserar sig på islamiska principer.</p>
        <p>För oss är investeringar mer än bara siffror på en skärm. Det handlar om att skapa långsiktiga förbättringar i människors ekonomiska situation, främja sunda hushållsekonomiska principer och uppmuntra till sparande över tid.</p>
        <h2>En inkluderande gemenskap</h2>
        <p>Vi är övertygade om att vi genom samarbete, utbildning och delning av kunskap kan skapa en inkluderande gemenskap som främjar ekonomisk framgång i enlighet med våra övertygelser. Vårt mål är att vara förebilder inom halalinvesteringar och att fungera som mentorer för dem som vill navigera genom den komplexa finansiella världen, utan att behöva kompromissa med sina övertygelser.</p>
        <p>Vi är Slowlax – en grupp dedikerade till att göra en verklig skillnad i människors ekonomiska liv. Genom vårt engagemang och vår passion hoppas vi kunna skapa en bättre finansiell framtid där fler kan ta del av de möjligheter som investeringar och ekonomiskt ansvarstagande har att erbjuda.</p>
        <Link href="/kurser" className="button button-primary">Utforska våra kurser <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
