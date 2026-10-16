import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Sprout } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { signupAction } from "@/lib/actions";
import { PRIVATE_METADATA } from "@/lib/seo";
import { accountAuthHref, safeAccountReturnTo } from "@/lib/account-return";
import { resolveAccountReturnTo } from "@/lib/account-return-destination";
import { getKitSignupNotice } from "@/lib/kit-newsletter";

export const metadata: Metadata = { ...PRIVATE_METADATA, title: "Skapa konto" };
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const returnTo = safeAccountReturnTo(params.returnTo, "");
  if (user) redirect(await resolveAccountReturnTo(returnTo, user.role === "admin" ? "/admin" : "/elevportal"));
  const newsletter = await getKitSignupNotice();
  return (
    <section className="section container auth-layout">
      <div className="auth-intro">
        <p className="eyebrow">Ett nytt steg</p>
        <h1 className="page-title">
          Låt din kunskap
          <br />
          <em>växa.</em>
        </h1>
        <p className="lead muted">
          Skapa ett elevkonto och få Bas medlemskap kostnadsfritt. Verifiera
          din e-postadress för att öppna innehållet som ingår. Dina kurser och
          grupper samlas sedan i elevportalen.
        </p>
        <Sprout
          className="auth-leaf"
          size={130}
          strokeWidth={0.8}
          aria-hidden="true"
        />
      </div>
      <div className="auth-card panel">
        <h2>Skapa ett konto</h2>
        <p className="muted">Börja med dina uppgifter nedan.</p>
        {returnTo.startsWith("/kurser/") && <p className="notice">Efter e-postverifieringen kommer du tillbaka till kursen för att slutföra ditt köp. Att skapa konto innebär inget köp.</p>}
        {params.error && (
          <p className="notice notice-error" role="alert">
            {params.error}
          </p>
        )}
        <form action={signupAction} className="auth-form">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="field">
            Ditt namn
            <input
              type="text"
              name="name"
              required
              autoComplete="name"
              placeholder="För- och efternamn"
              minLength={2}
              maxLength={100}
            />
          </label>
          <label className="field">
            E-postadress
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="din@epost.se"
              maxLength={254}
            />
          </label>
          <label className="field">
            Lösenord
            <input
              type="password"
              name="password"
              required
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
            />
            <small className="muted">Använd minst 12 tecken.</small>
          </label>
          <p className="small muted">
            Ditt konto används för inloggning, kursåtkomst och dina framsteg.
            Kurser med onlineköp blir tillgängliga efter bekräftad betalning.
            Du kan också få tillgång genom tilldelning eller en grupp.
          </p>
          {newsletter.enabled && <p className="small muted">{newsletter.message} <Link href="/integritet" className="inline-link">Om dina personuppgifter</Link>.</p>}
          <button className="button button-primary full-width" type="submit">
            Skapa konto <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch muted">
          Har du redan ett konto?{" "}
          <Link href={accountAuthHref("/logga-in", returnTo)} className="inline-link">
            Logga in
          </Link>
        </p>
      </div>
    </section>
  );
}
