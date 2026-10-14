import Link from "next/link";
import { CreditCard, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth";

export default async function StudentAccountPage() {
  const user = await requireUser();
  return <>
    <header className="membership-hero"><h1 className="page-title">Mitt konto</h1><p>Dina kontouppgifter, kursköp och abonnemang på ett ställe.</p></header>
    <div className="portal-account-grid">
      <section className="panel"><h2>Dina uppgifter</h2>
        <dl><dt>Namn</dt><dd>{user.name}</dd><dt>E-postadress</dt><dd>{user.email}</dd><dt>E-poststatus</dt><dd>{user.role === "admin" ? "Administratörskonto" : user.emailVerifiedAt ? "Verifierad" : "Behöver verifieras"}</dd></dl>
        <div className="portal-account-links">
          {user.role === "student" && !user.emailVerifiedAt && <Link href="/verifiera-epost" className="button button-primary">Verifiera e-postadress</Link>}
          <Link href="/glomt-losenord?returnTo=%2Felevportal%2Fkonto" className="text-link">Återställ lösenord</Link>
        </div>
      </section>
      <section className="panel"><h2>Köp och abonnemang</h2><p className="muted">Engångsköp av kurser och återkommande betalningar visas separat.</p>
        <div className="portal-account-links">
          <Link href="/elevportal/kop" className="button button-secondary"><ShoppingBag size={17} aria-hidden="true" /> Mina köp</Link>
          <Link href="/elevportal/medlemskap" className="button button-secondary"><CreditCard size={17} aria-hidden="true" /> Mina abonnemang</Link>
        </div>
      </section>
    </div>
    <section className="panel"><h2>Behöver du hjälp?</h2><p className="muted">Kontakta oss om ditt konto, betalningar eller kursåtkomst.</p><div className="membership-actions"><Link href="/kontakt" className="button button-primary">Kontakta Tibb.nu</Link><Link href="/kurser" className="text-link">Utforska fler kurser</Link></div></section>
  </>;
}
