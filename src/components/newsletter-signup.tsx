import Link from "next/link";
import { getKitNewsletterSettings } from "@/lib/kit-newsletter-domain";

export async function NewsletterSignup() {
  const { formId } = await getKitNewsletterSettings();
  return <section className="section container">
    <div className="slowlax-newsletter">
      <p className="eyebrow">KUNSKAP I DIN INKORG</p>
      <h2>Håll dig uppdaterad.</h2>
      <p>Få tips, nyheter och uppdateringar om våra utbildningar i etiska och halalinvesteringar.</p>
      <form action={`https://app.kit.com/forms/${formId}/subscriptions`} method="post">
        <label htmlFor="home-newsletter-email" className="sr-only">Din e-postadress</label>
        <input id="home-newsletter-email" name="email_address" type="email" autoComplete="email" placeholder="Din e-postadress" required />
        <button className="button button-primary" type="submit">Ja, skicka mig tips!</button>
      </form>
      <p className="small muted">Nyhetsbrevet hanteras av Kit. Din e-postadress skickas till Kit när du anmäler dig. Bekräfta prenumerationen via e-post; du kan avsluta den via länken i utskicken. <Link href="/integritet">Läs om personuppgifter</Link>.</p>
    </div>
  </section>;
}
