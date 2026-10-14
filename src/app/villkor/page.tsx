import Link from "next/link";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { cancellationText } from "@/lib/business-config";
import { TextContent } from "@/components/learning/cards";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Boknings- och kursvillkor", path: "/villkor",
  description: "Läs villkoren för bokning, återbud, kursköp och kursåtkomst hos Tibb.nu samt hur du kontaktar verksamheten.",
});

export default async function TermsPage() {
  const [s, business] = await Promise.all([getSiteSettings(), getBusinessSettings()]);
  return (
    <section className="section container narrow prose">
      <h1>Boknings- och kursvillkor</h1>
      <p>Tibb.nu drivs av {business.legalName}, organisationsnummer {business.organizationNumber}.</p>
      <h2>Boka en behandling</h2>
      <p>
        Du väljer behandling, behandlare och en tillgänglig tid. Behandlingens
        längd, pris i svenska kronor och betalningssätt visas innan du bekräftar.
        Tiderna visas i svensk tid, Europe/Stockholm.
      </p>
      <p>
        Vid betalning på plats bekräftas tiden när bokningen registreras. Vid
        kortbetalning bekräftas bokningen när Stripe har bekräftat betalningen.
        Spara bokningsreferensen och bekräftelsesidan. E-postbekräftelse kan
        skickas när verksamhetens e-posttjänst är ansluten.
      </p>
      <h2>Återbud</h2>
      <p>{cancellationText(business.cancellationHours)} Kontakta oss och ange din bokningsreferens.</p>
      {business.cancellationDetails && <TextContent text={business.cancellationDetails} />}
      <h2>Kursåtkomst</h2>
      <p>
        Kursbeskrivning och pris finns på respektive kurssida. När onlineköp är
        aktiverat kan du betala kursen med en engångsbetalning via Stripe. Du läser
        och accepterar kursens köpvillkor innan du går vidare till betalningen.
        Du behöver ett elevkonto med verifierad e-postadress. Administratören kan
        också tilldela kursåtkomst efter överenskommelse.
      </p>
      <p>
        Ett verifierat kursköp ger permanent tillgång till den köpta kursen.
        Om en grupp ingår visas gruppen och eventuell tidsgräns före köpet.
        Gruppåtkomsten ges automatiskt när betalningen bekräftas. En tidsgräns
        för gruppen ändrar inte den köpta kursens permanenta åtkomst.
        Separat manuellt tilldelad åtkomst och åtkomst genom abonnemang hanteras
        oberoende av kursköpet.
      </p>
      <TextContent text={business.courseAccessDescription} />
      <p>
        Eventuella förkunskaper och krav på genomförande anges på kurssidan.
        Kursmaterialet är avsett för utbildning och ersätter inte en individuell
        medicinsk bedömning.
      </p>
      <h2>Ånger och avbokning av kurs</h2>
      <p>
        När en konsument ingår ett kursavtal på distans kan lagstadgad ångerrätt
        gälla. Villkoren beror bland annat på hur avtalet ingås och om det gäller
        en tjänst eller digitalt innehåll. Kontakta oss om du vill ångra eller
        avboka en kurs. Att begära omedelbar kursåtkomst vid köpet eller öppna en
        lektion på Tibb.nu används inte som ett automatiskt avstående från
        ångerrätt.
      </p>
      <p>
        Läs <a href="https://www.konsumentverket.se/varor-och-tjanster/angra-eller-avboka-en-kurs-eller-utbildning/" target="_blank" rel="noopener noreferrer">
          Konsumentverkets information om att ångra eller avboka en kurs
        </a>.
      </p>
      <h2>Kontakt</h2>
      {s.email && <p><a href={`mailto:${s.email}`}>{s.email}</a></p>}
      {s.phone && <p><a href={`tel:${s.phone}`}>{s.phone}</a></p>}
      {s.address && <p>{s.address}</p>}
      <p><Link href="/kontakt">Alla kontaktuppgifter</Link> · <Link href="/integritet">Integritet och personuppgifter</Link></p>
    </section>
  );
}
