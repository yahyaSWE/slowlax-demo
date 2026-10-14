import Link from "next/link";

export default function StudentPortalNotFound() {
  return <section className="panel stack">
    <h1 className="page-title">Innehållet kunde inte öppnas</h1>
    <p>Länken kan vara inaktuell eller innehållet sakna tillgänglig åtkomst för ditt konto. Dina andra kurser och ditt sparade arbete finns kvar.</p>
    <div className="membership-actions"><Link href="/elevportal" className="button button-primary">Till mina kurser</Link><Link href="/elevportal/grupper" className="button button-secondary">Grupper & material</Link><Link href="/kontakt" className="text-link">Kontakta oss för hjälp</Link></div>
  </section>;
}
