import { postgresDatabaseConfigured } from "./database-config";
import { emailAppUrl } from "./email-provider";

export class SupabaseAuthConfigurationError extends Error {}

export function supabaseAuthRequested() { return process.env.SUPABASE_AUTH_ENABLED === "true"; }

export function supabaseAuthConfigurationStatus(): { enabled: boolean; configured: boolean; reason: string | null } {
  if (!supabaseAuthRequested()) return { enabled: false, configured: false, reason: null };
  try { requireSupabaseAuthConfiguration(); return { enabled: true, configured: true, reason: null }; }
  catch (error) { return { enabled: true, configured: false, reason: error instanceof SupabaseAuthConfigurationError ? error.message : "Supabase Auth är inte färdigkonfigurerat." }; }
}

export function requireSupabaseAuthConfiguration(): { url: string; publishableKey: string; origin: string } {
  if (!supabaseAuthRequested()) throw new SupabaseAuthConfigurationError("Supabase-inloggningen är inte aktiverad.");
  if (process.env.SUPABASE_DATABASE_ENABLED !== "true" || !postgresDatabaseConfigured())
    throw new SupabaseAuthConfigurationError("Supabase-inloggning kräver en färdig databasflytt och aktiverad PostgreSQL-anslutning.");
  let url: URL;
  try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ""); }
  catch { throw new SupabaseAuthConfigurationError("Supabase-projektets URL saknas eller är ogiltig."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new SupabaseAuthConfigurationError("Supabase-projektets URL måste vara en betrodd HTTPS-adress utan sökväg.");
  const project = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1];
  if (project) {
    const database = new URL(process.env.DATABASE_URL!);
    const direct = database.hostname === `db.${project}.supabase.co`;
    const pooler = database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username).endsWith(`.${project}`);
    if (!direct && !pooler)
      throw new SupabaseAuthConfigurationError("Supabase Auth och DATABASE_URL behöver tillhöra samma projekt. Kontrollera projektets anslutningsuppgifter.");
  }
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey))
    throw new SupabaseAuthConfigurationError("En giltig publishable key för Supabase saknas.");
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || "";
  if (!/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(secret))
    throw new SupabaseAuthConfigurationError("Supabase-servernyckeln saknas. Konfigurera SUPABASE_SECRET_KEY på servern.");
  let origin: string;
  try { origin = emailAppUrl(); }
  catch { throw new SupabaseAuthConfigurationError("Supabase Auth kräver en giltig APP_URL för hemsidans bekräftelselänkar."); }
  return { url: url.origin, publishableKey, origin };
}
