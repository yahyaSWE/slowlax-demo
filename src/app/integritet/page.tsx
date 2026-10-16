import Link from "next/link";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { TextContent } from "@/components/learning/cards";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Integritet och personuppgifter", path: "/integritet",
  description: "Läs hur Slowlax hanterar uppgifter för elevkonton, kursköp, quiz, grupper, abonnemang och nyhetsbrev samt hur du kontaktar oss.",
});

export default async function PrivacyPage() {
  const [settings, business] = await Promise.all([getSiteSettings(), getBusinessSettings()]);
  return (
    <section className="section container narrow prose">
      <span className="eyebrow">INTEGRITET</span>
      <h1>Integritet och personuppgifter</h1>
      <h2>Kontakt om dina uppgifter</h2>
      {business.legalName && <p>{business.legalName}{business.organizationNumber ? `, organisationsnummer ${business.organizationNumber}` : ""}, ansvarar för personuppgifterna på Slowlax.</p>}
      <p>Har du frågor om dina personuppgifter eller vill använda dina rättigheter kan du kontakta Slowlax{settings.email ? <> på <a href={`mailto:${settings.email}`}>{settings.email}</a></> : <> via <Link href="/kontakt">kontaktsidan</Link></>}.</p>
      <h2>Ditt elevkonto</h2>
      <p>Vi sparar ditt namn, din e-postadress, ett skyddat lösenord, e-postverifiering, dina kurstilldelningar och slutförda lektioner. Inloggning, verifiering och lösenordsåterställning använder sessionsuppgifter och tidsbegränsade engångskoder.</p>
      <p>Quizsvar, resultat och försök samt skrivuppgifter, inlämningar, återkoppling och uppgiftsversioner sparas för kursens genomförande. Administratören kan granska inlämnade svar. Privata utkast till skrivuppgifter visas inte i administrationen. Anonymisera personer i dina exempel och lämna inte andra personers personnummer eller känsliga personuppgifter i kursuppgifter.</p>
      <h2>När du köper en kurs</h2>
      <p>Kursköpet kopplas till ditt inloggade elevkonto. Vi sparar vald kurs, pris, moms, accepterade köpvillkor, betalningsstatus och uppgifter som identifierar betalningen hos Stripe. Om en grupp ingår sparar vi också vilken grupp du får tillgång till och ett eventuellt slutdatum. Uppgifterna används för köpet och din kurs- och gruppåtkomst.</p>
      <p>Betalningen hanteras av Stripe. Faktureringsadressen som du lämnar vid betalningen behandlas hos Stripe. Kortuppgifter lagras inte i Slowlax databas. Du kan se dina kursköp under Mina köp när du är inloggad.</p>
      <h2>Grupper, abonnemang och privata filer</h2>
      <p>Vi sparar dina grupptilldelningar och abonnemang, accepterade abonnemangsvillkor, pris, betalningsintervall, betalningsstatus och betald period. Uppgifterna används för medlemskapet och tillgången till gruppens kurser och privata material.</p>
      <p>Återkommande betalningar och kundportalen hanteras av Stripe. Faktureringsadressen behandlas hos Stripe. Gruppmaterial och bilagor visas för behöriga gruppmedlemmar och administratörer.</p>
      <h2>När du kontaktar oss eller prenumererar</h2>
      <p>När du kontaktar oss behandlar vi de kontaktuppgifter och det meddelande du lämnar för att kunna svara på din fråga. Skicka bara de uppgifter som behövs för ditt ärende.</p>
      <p>Nyhetsbrevsformuläret skickar din e-postadress direkt till Kit, som används för Slowlax utskick. Formuläret leder till Kit där anmälan hanteras. Följ instruktionerna i bekräftelsemeddelandet. Du kan avsluta prenumerationen via länken i nyhetsbrevet. Läs också <a href="https://kit.com/privacy" target="_blank" rel="noopener noreferrer">Kits integritetsinformation</a>.</p>
      <p>När automatisk nyhetsbrevsinbjudan är aktiverad får nya elever information om det vid registreringen. Efter att elevkontots e-postadress har verifierats skickas namn och e-postadress till Kit för en separat inbjudan. Bekräfta i Kits meddelande om du vill få nyhetsbrevet. Vi sparar inbjudans status för att kunna hantera misslyckade försök. En tidigare avregistrerad adress återaktiveras inte automatiskt.</p>
      <h2>Självtestet och din webbläsare</h2>
      <p>Självtestets svar och resultat sparas lokalt i din webbläsare för att du ska kunna fortsätta senare. De skickas inte till Slowlax server och kopplas inte till ditt elevkonto. Du kan ta bort dem genom att rensa webbplatsens data i webbläsaren. När du gör om testet ersätts tidigare svar.</p>
      <h2>Kakor och inbäddade videor</h2>
      <p>En nödvändig sessionskaka håller dig inloggad i högst sju dagar och tas bort när du loggar ut. Webbplatsens egen kod använder inga reklam- eller analyskakor.</p>
      <p>YouTube-spelaren laddas när du väljer att spela en video. Då ansluter din webbläsare till YouTube, som kan behandla exempelvis IP-adress och uppgifter om uppspelningen enligt sina egna villkor. Andra externa videospelare och länkar kan ansluta dig till respektive leverantör.</p>
      <h2>Leverantörer och åtkomst</h2>
      <p>Webbplatsen har stöd för Vercel för drift och privata uppladdade filer, Turso för databas, Resend för e-post och Stripe för betalningar när tjänsterna är anslutna. Kit används för nyhetsbrevet. Behöriga administratörer får tillgång till de uppgifter som behövs för elevkonton, kursadministration, köp och medlemskap.</p>
      {business.internationalTransfers && <TextContent text={business.internationalTransfers} />}
      {business.legalBasis && <><h2>Rättslig grund</h2><TextContent text={business.legalBasis} /></>}
      {business.studentRetention && <><h2>Hur länge sparas uppgifterna?</h2><TextContent text={business.studentRetention} /></>}
      <h2>Dina rättigheter</h2>
      <p>Du kan begära tillgång till och rättelse av dina uppgifter. Du kan också begära radering, begränsning eller överföring av uppgifter eller invända mot behandlingen när förutsättningarna för respektive rättighet är uppfyllda. Vi kan behöva kontrollera din identitet innan uppgifter lämnas ut.</p>
      <p>Läs mer om <a href="https://www.imy.se/privatperson/dataskydd/dina-rattigheter/" target="_blank" rel="noopener noreferrer">dina rättigheter hos Integritetsskyddsmyndigheten</a>. Du kan också <a href="https://www.imy.se/privatperson/utfora-arenden/lamna-ett-klagomal/" target="_blank" rel="noopener noreferrer">lämna ett klagomål till IMY</a> om du anser att dina personuppgifter hanteras felaktigt.</p>
      {business.additionalPrivacy && <TextContent text={business.additionalPrivacy} />}
      <p><Link href="/kontakt">Kontakta Slowlax</Link> · <Link href="/villkor">Kurs- och medlemsvillkor</Link></p>
    </section>
  );
}
