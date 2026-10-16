import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { getSiteSettings } from "@/lib/site-data";
import { saveSettingsAction } from "@/lib/actions";
import { getBusinessSettings } from "@/lib/business-settings";
import { BusinessSettingsForm } from "@/components/admin/business-settings-form";
import { emailConfigurationStatus } from "@/lib/email-provider";
import { AdminHeading, AdminNotice, type AdminSearchParams, Field, ReturnTo, SectionHeading } from "@/components/admin/common";

export default async function SettingsPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requireAdmin();
  const [settings, business] = await Promise.all([getSiteSettings(), getBusinessSettings()]);
  const email = emailConfigurationStatus();
  const paymentChecks = [
    { label: "Stripe-anslutning", ready: !!process.env.STRIPE_SECRET_KEY },
    { label: "Verifiering av kursköp", ready: !!process.env.STRIPE_WEBHOOK_SECRET },
    { label: "Verifiering av medlemskap", ready: !!process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET },
    { label: "Hemsidans adress", ready: !!process.env.APP_URL },
  ];
  return <>
    <AdminHeading title="Inställningar" description="Uppdatera verksamhetens kontaktuppgifter och information för elever och medlemmar." />
    <AdminNotice searchParams={searchParams} />
    <section className="panel form-panel">
      <SectionHeading title="E-post" description="Resend används för verifiering av elevkonton och återställning av lösenord." />
      <p className={`badge ${email.configured ? "badge-green" : "badge-amber"}`}>{email.configured ? "Konfiguration finns" : "Anslutning saknas"}</p>
      <p className="muted">{email.configured ? "Verifiera avsändardomänen och kontrollera ett testutskick i Resend före lansering." : email.reason}</p>
    </section>
    <section className="panel form-panel">
      <SectionHeading title="Nyhetsbrev med Kit" description="Konfigurera automatiska inbjudningar för nya elever och följ synkroniseringens status." />
      <Link href="/admin/nyhetsbrev" className="button button-secondary">Hantera nyhetsbrevet</Link>
    </section>
    <form action={saveSettingsAction} className="stack">
      <ReturnTo path="/admin/installningar" />
      <section className="panel form-panel">
        <SectionHeading title="Din verksamhet" />
        <div className="stack">
          <Field label="Verksamhetens namn" name="siteName"><input id="siteName" name="siteName" required maxLength={100} defaultValue={settings.siteName} /></Field>
          <div className="form-grid">
            <Field label="E-post" name="email"><input id="email" name="email" type="email" maxLength={254} defaultValue={settings.email} placeholder="info@slowlax.se" /></Field>
            <Field label="Telefon" name="phone"><input id="phone" name="phone" type="tel" maxLength={40} defaultValue={settings.phone} placeholder="Ditt telefonnummer" /></Field>
          </div>
          <Field label="Adress" name="address"><input id="address" name="address" maxLength={250} defaultValue={settings.address} placeholder="Gatuadress, postnummer och ort" /></Field>
          <Field label="Plats" name="location"><input id="location" name="location" maxLength={150} defaultValue={settings.location} /></Field>
        </div>
      </section>
      <div><button className="button button-primary" type="submit">Spara inställningar</button></div>
    </form>
    <section className="panel form-panel">
      <SectionHeading title="Kursköp och medlemskap" description="Priser och försäljning hanteras under respektive kurs och medlemskap." />
      <ul className="credential-status">{paymentChecks.map(item => <li key={item.label}>
        {item.ready ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
        <span>{item.label}: {item.ready ? "klar" : "saknas"}</span>
      </li>)}</ul>
    </section>
    <BusinessSettingsForm settings={business} />
  </>;
}
