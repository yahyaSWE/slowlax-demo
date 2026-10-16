import Link from "next/link";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { TextContent } from "@/components/learning/cards";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Kurs- och medlemsvillkor", path: "/villkor",
  description: "Information om elevkonton, kursköp, kursåtkomst, medlemskap och hur du kontaktar Slowlax om ditt avtal.",
});

export default async function TermsPage() {
  const [settings, business] = await Promise.all([getSiteSettings(), getBusinessSettings()]);
  return (
    <section className="section container narrow prose">
      <span className="eyebrow">VILLKOR</span>
      <h1>Kurs- och medlemsvillkor</h1>
      {business.legalName && <p>Slowlax drivs av {business.legalName}{business.organizationNumber ? `, organisationsnummer ${business.organizationNumber}` : ""}.</p>}
      <p>Här finns information om hur webbplatsens utbildningar och medlemskap fungerar. De villkor som visas för den valda kursen eller medlemskapet före ett köp beskriver det aktuella erbjudandet.</p>
      <h2>Ditt elevkonto</h2>
      <p>Du behöver ett elevkonto för att använda tilldelade kurser och privat gruppmaterial. Ange korrekta uppgifter och håll dina inloggningsuppgifter privata. E-postadressen behöver verifieras innan du kan genomföra ett köp. Använd bara ditt eget konto och dela inte privata kursfiler eller andra deltagares uppgifter utan tillåtelse.</p>
      <h2>Kursköp och kursåtkomst</h2>
      <p>Kursens innehåll, eventuella förkunskaper, genomförandekrav och pris framgår av kurssidan. När onlineköp är tillgängligt betalar du kursen med en engångsbetalning via Stripe. Du läser och accepterar köpvillkoren innan du går vidare till betalningen. Åtkomsten öppnas när betalningen har bekräftats. Administratören kan också tilldela kursåtkomst efter överenskommelse.</p>
      <p>Ett verifierat kursköp ger permanent tillgång till den köpta kursen. Om en grupp ingår visas gruppen och eventuell tidsgräns före köpet. En tidsgräns för gruppåtkomsten ändrar inte den köpta kursens permanenta åtkomst. Separat tilldelad åtkomst och åtkomst genom abonnemang hanteras oberoende av kursköpet.</p>
      {business.courseAccessDescription && <TextContent text={business.courseAccessDescription} />}
      <p>Du hittar dina tillgängliga kurser, lektioner, quiz och kursuppgifter i elevportalen. Bekräftade kursköp visas under Mina köp. Kursmaterialet är avsett för utbildning; det utgör inte individuell investeringsrådgivning eller förvaltning av dina pengar.</p>
      <h2>Medlemskap, grupper och abonnemang</h2>
      <p>På medlemskapets sida visas vad som ingår, pris, moms, betalningsintervall och abonnemangsvillkor. Du godkänner villkoren innan du går till betalningen. Ett abonnemang betalas återkommande enligt valt intervall tills det sägs upp enligt erbjudandets villkor.</p>
      <p>Gruppens publicerade inlägg, kurser och privata filer är tillgängliga för behöriga medlemmar medan åtkomsten gäller. I <Link href="/elevportal/medlemskap">Mina abonnemang</Link> kan du se betalningsstatus och öppna de tillgängliga valen för betalningar och uppsägning. Kontakta oss om du behöver hjälp.</p>
      <h2>Ångerrätt och frågor om ett köp</h2>
      <p>När en konsument ingår ett kursavtal på distans kan lagstadgad ångerrätt gälla. Villkoren beror bland annat på hur avtalet ingås och om det gäller en tjänst eller digitalt innehåll. Kontakta oss om du vill ångra ett köp eller har problem med åtkomsten och ange vilken kurs eller vilket medlemskap det gäller.</p>
      <p>Att begära omedelbar kursåtkomst vid köpet eller att öppna en lektion används inte som ett automatiskt avstående från ångerrätt. Läs <a href="https://www.konsumentverket.se/varor-och-tjanster/angra-eller-avboka-en-kurs-eller-utbildning/" target="_blank" rel="noopener noreferrer">Konsumentverkets information om att ångra eller avboka en kurs</a>.</p>
      <h2>Utbildning och eget ansvar</h2>
      <p>Slowlax delar kunskap om etiska och halalinvesteringar. Du fattar själv dina investeringsbeslut. Det separata självtestet med fem faser är ett verktyg för självreflektion och ger ingen medicinsk diagnos eller finansiell bedömning.</p>
      <h2>Kontakt</h2>
      {settings.email && <p><a href={`mailto:${settings.email}`}>{settings.email}</a></p>}
      {settings.phone && <p><a href={`tel:${settings.phone}`}>{settings.phone}</a></p>}
      {settings.address && <p>{settings.address}</p>}
      <p><Link href="/kontakt">Kontakta Slowlax</Link> · <Link href="/integritet">Integritet och personuppgifter</Link></p>
    </section>
  );
}
