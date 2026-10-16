import Link from "next/link";
import { createPageMetadata } from "@/lib/seo";
import "./questions.css";

export const metadata = createPageMetadata({
  title: "Vanliga frågor om kurser och medlemskap", path: "/vanliga-fragor",
  description: "Svar om Slowlax, halalinvesteringar, utbildningar, elevkonton, kursmaterial och medlemskap.",
});

export default function QuestionsPage() {
  return (
    <section className="section container narrow">
      <div className="page-heading">
        <span className="eyebrow">VANLIGA FRÅGOR</span>
        <h1>Nyfiken på Slowlax?</h1>
        <p>Här hittar du svar inför ditt lärande och hjälp med kurser och medlemskap.</p>
      </div>
      <div className="questions-list">
        <details open><summary>Vad är Slowlax?</summary>
          <p>Slowlax började som en aktieklubb 2018. Vi vill ge fler kunskap om långsiktigt sparande och investeringar som följer islamiska och etiska principer. <Link href="/om">Läs om oss och vår bakgrund</Link>.</p>
        </details>
        <details><summary>Hur bedömer man om en aktie är halal?</summary>
          <p>Vi utgår från AAOIFI:s kriterier och granskar både företagets verksamhet och dess finansiella nyckeltal. Företagets kärnverksamhet får till exempel inte vara alkohol, tobak eller hasardspel. <Link href="/investeringsfilosofi">Läs mer om vår investeringsfilosofi och screening</Link>.</p>
        </details>
        <details><summary>Kan ni investera mina pengar åt mig?</summary>
          <p>Vi förvaltar inte dina pengar. Slowlax delar kunskap om ansvarsfullt aktiesparande, etiska principer och hur bolag kan granskas. Du fattar själv dina investeringsbeslut.</p>
        </details>
        <details><summary>När kommer nästa utbildning eller föreläsning?</summary>
          <p>Kommande utbildningar annonseras i våra kanaler. Följ oss i sociala medier eller <Link href="/kontakt#nyhetsbrev">anmäl dig till nyhetsbrevet</Link> för uppdateringar. Våra äldre <Link href="/artiklar">nyheter och utbildningsartiklar</Link> visar tidigare aktiviteter.</p>
        </details>
        <details><summary>Hur får jag tillgång till en kurs?</summary>
          <p>Börja med <Link href="/kurser">kursbeskrivningen</Link>. Skapa ett <Link href="/registrera">elevkonto</Link> och verifiera din e-postadress. Om kursköp är tillgängligt på kurssidan får du åtkomst efter bekräftad betalning. Administratören kan också tilldela en kurs efter överenskommelse. Dina tillgängliga kurser samlas i <Link href="/elevportal">elevportalen</Link>.</p>
        </details>
        <details><summary>Hur fungerar lektioner, quiz och kursuppgifter?</summary>
          <p>När du har kursåtkomst kan du öppna publicerade lektioner, se kursmaterial och följa dina framsteg. Om läraren har lagt till quiz eller skrivuppgifter hittar du dem i lektionen. Där framgår också eventuella krav för att genomföra kursen.</p>
        </details>
        <details><summary>Vad ingår i ett medlemskap?</summary>
          <p>Innehåll, pris och betalningsintervall framgår av respektive <Link href="/medlemskap">medlemskap</Link>. Ett medlemskap kan ge tillgång till gruppens kurser, inlägg och privata material. I elevportalen ser du de grupper och abonnemang som hör till ditt konto.</p>
        </details>
        <details><summary>Hur hanterar jag mitt abonnemang?</summary>
          <p>Logga in och öppna <Link href="/elevportal/medlemskap">Mina abonnemang</Link> för betalningsstatus och tillgängliga val för betalningar och uppsägning. Kontakta oss om du behöver hjälp. Villkoren för det valda medlemskapet visas innan du tecknar det.</p>
        </details>
        <details><summary>Vad betyder rening av en portfölj?</summary>
          <p>Rening handlar om att identifiera den del av ett bolags inkomster som kommer från källor som inte är tillåtna enligt de islamiska kriterier man följer. Läs om hur granskning och sammanställning går till på sidan <Link href="/rening">Rening av investeringar</Link>.</p>
        </details>
        <details><summary>Vad är självtestet med fem faser?</summary>
          <p>Det är ett separat <Link href="/sjalvtest">självtest för självreflektion</Link>, inspirerat av traditionell kinesisk medicins fem faser. Det är ingen medicinsk diagnos och gör ingen bedömning av din ekonomi eller dina investeringar. Du behöver inget konto. Svar och resultat sparas i din webbläsare och skickas inte till servern.</p>
        </details>
      </div>
      <p>Hittar du inte svaret? <Link href="/kontakt">Kontakta Slowlax</Link>.</p>
    </section>
  );
}
