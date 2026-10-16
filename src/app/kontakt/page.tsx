import Link from "next/link";
import { Mail, MapPin, Phone, ArrowUpRight } from "lucide-react";
import { getSiteSettings } from "@/lib/site-data";
import { getBusinessSettings } from "@/lib/business-settings";
import { getKitNewsletterSettings } from "@/lib/kit-newsletter-domain";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl, buildOrganizationSchema, createPageMetadata, organizationId, websiteId } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Kontakta Slowlax", path: "/kontakt",
  description: "Kontakta Slowlax om etiska och halalinvesteringar, kurser, medlemskap eller kursåtkomst. Prenumerera på vårt nyhetsbrev.",
});

export default async function ContactPage() {
  const [settings, business, newsletter] = await Promise.all([getSiteSettings(), getBusinessSettings(), getKitNewsletterSettings()]);
  return (
    <section className="section container narrow">
      <JsonLd data={[
        buildOrganizationSchema(settings),
        { "@context": "https://schema.org", "@type": "ContactPage", "@id": absoluteUrl("/kontakt"),
          url: absoluteUrl("/kontakt"), name: "Kontakta Slowlax", inLanguage: "sv-SE",
          mainEntity: { "@id": organizationId() }, isPartOf: { "@id": websiteId() } },
      ]} />
      <div className="page-heading">
        <span className="eyebrow">KONTAKT</span>
        <h1>Vi hörs gärna.</h1>
        <p>Har du frågor om våra utbildningar, halalinvesteringar eller ditt medlemskap? Hör av dig till oss.</p>
      </div>
      <div className="panel contact-details">
        {settings.email && <a href={`mailto:${settings.email}`}><Mail aria-hidden="true" />{settings.email}</a>}
        {settings.phone && <a href={`tel:${settings.phone}`}><Phone aria-hidden="true" />{settings.phone}</a>}
        {settings.address && <p><MapPin aria-hidden="true" />{settings.address}</p>}
        {business.legalName && <p>{business.legalName}{business.organizationNumber ? ` · Org.nr ${business.organizationNumber}` : ""}</p>}
        <Link href="/vanliga-fragor" className="text-link">Vanliga frågor om kurser och medlemskap <ArrowUpRight size={18} aria-hidden="true" /></Link>
        <Link href="/rening" className="text-link">Läs om rening av investeringar <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </div>
      <div className="slowlax-newsletter prose" id="nyhetsbrev">
        <span className="eyebrow">HÅLL DIG UPPDATERAD</span>
        <h2>Kunskap direkt till din inkorg</h2>
        <p>Prenumerera på vårt nyhetsbrev för uppdateringar, utbildningar och innehåll om etiska och halalinvesteringar.</p>
        <label htmlFor="newsletter-email">Din e-postadress</label>
        <form action={`https://app.kit.com/forms/${newsletter.formId}/subscriptions`} method="post">
          <input id="newsletter-email" name="email_address" type="email" autoComplete="email" placeholder="namn@exempel.se" required />
          <button className="button button-primary" type="submit">Ja, skicka mig tips!</button>
        </form>
        <p className="small muted">Anmälan hanteras av Kit. När du skickar formuläret lämnar du sidan och din e-postadress skickas till Kit för Slowlax nyhetsbrev. Följ instruktionerna i bekräftelsemeddelandet. Du kan avsluta prenumerationen via länken i utskicken. <Link href="/integritet">Läs om personuppgifter</Link>.</p>
      </div>
      <div className="prose">
        <h2>Följ vår gemenskap</h2>
        <p>Håll utkik i våra kanaler efter nyheter och kommande utbildningar.</p>
        <ul>
          <li><a href="https://www.instagram.com/slowlax.se/" target="_blank" rel="noopener noreferrer">Slowlax på Instagram</a></li>
          <li><a href="https://web.facebook.com/profile.php?id=100065558227119" target="_blank" rel="noopener noreferrer">Slowlax på Facebook</a></li>
          <li><a href="https://twitter.com/slowlaxs" target="_blank" rel="noopener noreferrer">Slowlax på X</a></li>
        </ul>
      </div>
    </section>
  );
}
