import Link from "next/link";
import { AccountForm } from "@/components/auth/account-forms";
import { PRIVATE_METADATA } from "@/lib/seo";
import { accountAuthHref, safeAccountReturnTo } from "@/lib/account-return";
import { supabaseAuthConfigurationStatus, supabaseAuthRequested } from "@/lib/supabase-auth-config";
export const dynamic = "force-dynamic";
export const metadata = { ...PRIVATE_METADATA, title: "Återställ lösenord" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; token_hash?: string; type?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const { returnTo: requested } = params;
  const supabase = supabaseAuthRequested();
  const token = supabase ? params.token_hash : params.token;
  const returnTo = safeAccountReturnTo(requested, "");
  const valid = token && /^[a-f0-9]{64}$/.test(token) && (!supabase || params.type === "recovery");
  const status = supabase ? supabaseAuthConfigurationStatus() : { configured: true, reason: null };
  return <section className="section container narrow"><div className="auth-card panel">
    <h1 className="page-title">Välj nytt lösenord.</h1>
    {!status.configured && <p className="notice notice-error">{status.reason}</p>}
    {valid ? <><p>{supabase ? "Länken kan användas en gång och gäller enligt tiden i e-postmeddelandet. Välj ett nytt lösenord för att återta kontot." : "Länken kan användas en gång och gäller i 30 minuter. Kontots e-postadress verifieras samtidigt. Tidigare sessioner avslutas."}</p><AccountForm kind="reset" token={token} returnTo={returnTo} supabase={supabase} disabled={!status.configured} /></> : <p className="notice notice-error" role="alert">Återställningslänken saknas eller är ogiltig.</p>}
    <p><Link href={accountAuthHref("/glomt-losenord", returnTo)} className="inline-link">Begär en ny länk</Link> · <Link href={accountAuthHref("/logga-in", returnTo)} className="inline-link">Till inloggning</Link></p>
  </div></section>;
}
