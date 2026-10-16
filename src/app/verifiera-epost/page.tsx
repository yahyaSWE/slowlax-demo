import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountForm } from "@/components/auth/account-forms";
import { getCurrentUser } from "@/lib/auth";
import { emailConfigurationStatus } from "@/lib/email-provider";
import { PRIVATE_METADATA } from "@/lib/seo";
import { accountAuthHref, safeAccountReturnTo } from "@/lib/account-return";
import { resolveAccountReturnTo } from "@/lib/account-return-destination";
import { supabaseAuthConfigurationStatus, supabaseAuthRequested } from "@/lib/supabase-auth-config";
export const dynamic = "force-dynamic";
export const metadata = { ...PRIVATE_METADATA, title: "Verifiera e-post" };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; token_hash?: string; type?: string; message?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeAccountReturnTo(params.returnTo, "");
  if (supabaseAuthRequested()) {
    const status = supabaseAuthConfigurationStatus();
    const token = params.token_hash;
    const valid = token && /^[a-f0-9]{64}$/.test(token) && params.type === "email";
    return <section className="section container narrow"><div className="auth-card panel">
      <h1 className="page-title">Bekräfta din e-post.</h1>
      {params.message && <p className="notice" role="status">{params.message}</p>}
      {!status.configured && <p className="notice notice-error">{status.reason}</p>}
      {token ? valid ? <><p>Bekräfta att du vill aktivera ditt konto hos Slowlax. Om du inte skapade kontot, använd Glömt lösenord för att återta adressen.</p><AccountForm kind="verify" token={token} returnTo={returnTo} supabase disabled={!status.configured} /></> : <p className="notice notice-error">Verifieringslänken är ogiltig.</p>
        : <><p>Öppna verifieringslänken i meddelandet från Slowlax. Du kan begära en ny länk med din e-postadress.</p><AccountForm kind="resend" returnTo={returnTo} supabase disabled={!status.configured} /></>}
      <p><Link href={accountAuthHref("/glomt-losenord", returnTo)} className="inline-link">Glömt lösenord eller inte ditt konto?</Link> · <Link href={accountAuthHref("/logga-in", returnTo)} className="inline-link">Till inloggning</Link></p>
    </div></section>;
  }
  if (params.token) return <section className="section container narrow"><div className="auth-card panel">
    <h1 className="page-title">Verifiera e-post.</h1>
    {/^[a-f0-9]{64}$/.test(params.token) ? <><p>Ange lösenordet du valde när du registrerade kontot. Om du inte skapade kontot, bekräfta det inte. Använd återställning för att återta din e-postadress.</p><AccountForm kind="verify" token={params.token} returnTo={returnTo} /></> : <p className="notice notice-error">Verifieringslänken är ogiltig.</p>}
    {returnTo.startsWith("/kurser/") && <p className="small muted">Efter verifieringen återvänder du till kursen. Ingen betalning sker automatiskt.</p>}
    <p><Link href={accountAuthHref("/verifiera-epost", returnTo)} className="inline-link">Begär en ny verifieringslänk</Link></p>
    <p><Link href={accountAuthHref("/glomt-losenord", returnTo)} className="inline-link">Glömt lösenord eller inte ditt konto?</Link></p>
  </div></section>;
  const user = await getCurrentUser();
  if (!user) redirect(accountAuthHref("/logga-in", returnTo));
  if (user.role === "admin") redirect("/admin");
  if (user.emailVerifiedAt) redirect(await resolveAccountReturnTo(returnTo));
  const email = emailConfigurationStatus();
  return <section className="section container narrow"><div className="auth-card panel">
    <h1 className="page-title">Bekräfta din e-post.</h1>
    <p>Verifiera {user.email} för att köpa kurser eller få ny kurs- och gruppåtkomst. Ditt konto och befintliga framsteg finns kvar.</p>
    {returnTo.startsWith("/kurser/") && <p className="notice">Öppna länken i e-postmeddelandet och verifiera kontot. Därefter fortsätter du till kursens köp.</p>}
    {params.message && <p className="notice" role="status">{params.message}</p>}
    {!email.configured && <p className="notice notice-error" role="alert">{email.reason} Kontakta verksamheten; adressen är inte verifierad ännu.</p>}
    <AccountForm kind="resend" disabled={!email.configured} returnTo={returnTo} />
    {returnTo.startsWith("/kurser/") && <p><Link href={returnTo} className="inline-link">Tillbaka till kursen</Link></p>}
    <p><Link href="/elevportal" className="inline-link">Till elevportalen</Link> · <Link href="/kontakt" className="inline-link">Kontakt</Link></p>
  </div></section>;
}
