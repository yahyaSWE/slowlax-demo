import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Leaf } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { loginAction } from "@/lib/actions";
import { PRIVATE_METADATA } from "@/lib/seo";
import { accountAuthHref, safeAccountReturnTo } from "@/lib/account-return";
import { resolveAccountReturnTo } from "@/lib/account-return-destination";

export const metadata: Metadata = { ...PRIVATE_METADATA, title: "Logga in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    message?: string;
    returnTo?: string;
  }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const returnTo = safeAccountReturnTo(params.returnTo, "");
  if (user) redirect(await resolveAccountReturnTo(returnTo, user.role === "admin" ? "/admin" : "/elevportal"));
  return (
    <section className="section container auth-layout">
      <div className="auth-intro">
        <p className="eyebrow">Din plats för fördjupning</p>
        <h1 className="page-title">
          Välkommen
          <br />
          <em>tillbaka.</em>
        </h1>
        <p className="lead muted">
          Fortsätt där du slutade. Dina kurser, lektioner och framsteg väntar i
          elevportalen.
        </p>
        <Leaf
          className="auth-leaf"
          size={130}
          strokeWidth={0.8}
          aria-hidden="true"
        />
      </div>
      <div className="auth-card panel">
        <h2>Logga in</h2>
        <p className="muted">Använd e-postadressen som hör till ditt konto.</p>
        {returnTo.startsWith("/kurser/") && <p className="notice">Logga in för att fortsätta till kursens köp.</p>}
        {params.error && (
          <p className="notice notice-error" role="alert">
            {params.error}
          </p>
        )}
        {params.message && (
          <p className="notice notice-success" role="status">
            {params.message}
          </p>
        )}
        <form action={loginAction} className="auth-form">
          <input type="hidden" name="returnTo" value={returnTo} />
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
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          <button className="button button-primary full-width" type="submit">
            Logga in <ArrowRight size={17} />
          </button>
        </form>
        <p className="small"><Link href={accountAuthHref("/glomt-losenord", returnTo)} className="inline-link">Glömt lösenord?</Link></p>
        <p className="auth-switch muted">
          Ny här?{" "}
          <Link href={accountAuthHref("/registrera", returnTo)} className="inline-link">
            Skapa ett konto
          </Link>
        </p>
        <p className="small muted">
          Behöver du hjälp med ditt konto?{" "}
          <Link href="/kontakt" className="inline-link">
            Kontakta Tibb.nu
          </Link>
        </p>
      </div>
    </section>
  );
}
