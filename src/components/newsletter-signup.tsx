import Link from "next/link";
import { getKitNewsletterSettings } from "@/lib/kit-newsletter-domain";
import { DEMO_MODE } from "@/lib/demo-mode";

export async function NewsletterSignup() {
  const formId = DEMO_MODE ? null : (await getKitNewsletterSettings()).formId;
  return <section className="section container">
    <div className="slowlax-newsletter">
      <p className="eyebrow">KUNSKAP I DIN INKORG</p>
      <h2>Håll dig uppdaterad.</h2>
      <p>Få tips, nyheter och uppdateringar om våra utbildningar i etiska och halalinvesteringar.</p>
      {DEMO_MODE ? <div className="demo-newsletter-preview" aria-describedby="demo-newsletter-note">
        <label htmlFor="home-newsletter-email" className="sr-only">Din e-postadress</label>
        <input id="home-newsletter-email" type="email" placeholder="Din e-postadress" disabled />
        <button className="button button-primary" type="button" disabled>Anmälan är avstängd i demon</button>
      </div> : <form action={`https://app.kit.com/forms/${formId}/subscriptions`} method="post">
        <label htmlFor="home-newsletter-email" className="sr-only">Din e-postadress</label>
        <input id="home-newsletter-email" name="email_address" type="email" autoComplete="email" placeholder="Din e-postadress" required />
        <button className="button button-primary" type="submit">Ja, skicka mig tips!</button>
      </form>}
      {DEMO_MODE ? <p id="demo-newsletter-note" className="small muted">Förhandsvisning av nyhetsbrevet. Inga e-postadresser samlas in i visningsversionen.</p> : <p className="small muted">Nyhetsbrevet hanteras av Kit. Din e-postadress skickas till Kit när du anmäler dig. Bekräfta prenumerationen via e-post; du kan avsluta den via länken i utskicken. <Link href="/integritet">Läs om personuppgifter</Link>.</p>}
    </div>
  </section>;
}
