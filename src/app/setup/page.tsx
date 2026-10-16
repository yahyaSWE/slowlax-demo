import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { hasAdmin } from "@/lib/db";
import { setupAction } from "@/lib/actions";
import { PRIVATE_METADATA } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = {
  ...PRIVATE_METADATA,
  title: "Konfigurera Slowlax",
};
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
  }>;
}) {
  const { error } = await searchParams;
  if (await hasAdmin())
    return (
      <section className="section container narrow">
        <div className="panel">
          <p className="eyebrow">Administration</p>
          <h1 style={{ fontSize: "clamp(2rem,4vw,3rem)", marginBlock: "16px" }}>
            Slowlax är konfigurerat
          </h1>
          <p className="muted">Ett administratörskonto finns redan.</p>
          <div className="form-actions">
            <Link className="button button-primary" href="/logga-in">
              Logga in <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>
    );
  return (
    <section className="section container narrow">
      <div className="page-heading">
        <p className="eyebrow">
          <ShieldCheck size={15} /> Första uppstarten
        </p>
        <h1 style={{ fontSize: "clamp(2rem,4vw,3rem)" }}>
          Skapa administratör
        </h1>
        <p className="muted">
          Ditt konto ger tillgång till artiklar, kurser, grupper och medlemskap.
        </p>
      </div>
      <div className="auth-card panel">
        <h2>Ditt administratörskonto</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          Använd konfigurationstoken som du sparade i serverns miljövariabel
          SETUP_TOKEN. På Vercel hittar du den under projektets inställningar.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <form
          action={setupAction}
          className="form-grid one-column"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <label className="field">
            Konfigurationstoken
            <input
              name="token"
              type="password"
              required
              autoComplete="off"
              minLength={32}
            />
          </label>
          <label className="field">
            Namn
            <input
              name="name"
              required
              autoComplete="name"
              minLength={2}
              maxLength={100}
            />
          </label>
          <label className="field">
            E-postadress
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </label>
          <label className="field">
            Lösenord
            <input
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
            />
            <small>Minst 12 tecken. Välj ett unikt lösenord.</small>
          </label>
          <button className="button button-primary full-width" type="submit">
            Skapa konto <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </section>
  );
}
