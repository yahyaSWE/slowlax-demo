import { existsSync } from "node:fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { POSTGRES_SCHEMA_VERSION, POSTGRES_TABLES } from "../src/lib/postgres-purification-schema";
import { matchesSupabaseDatabaseProject } from "../src/lib/supabase-project";

// Read-only preflight. Never initializes schemas, creates users, or sends mail.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function configured(value: string | undefined) {
  return !!value?.trim() && !/\[YOUR-PASSWORD\]|^\.\.\.$|^<.+>$/.test(value);
}
function failureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "PROJECT_MISMATCH") return "Supabase-projektets URL och databasanslutningen behöver tillhöra samma projekt.";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "Databasvärden kunde inte hittas. Kontrollera anslutningssträngen från Connect.";
  if (["ENETUNREACH", "EHOSTUNREACH"].includes(code)) return "Databasen kunde inte nås. Prova Session pooler för IPv4 i den lokala miljön.";
  if (code === "28P01") return "Databasens inloggningsuppgifter accepterades inte.";
  if (["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(code)) return "Servercertifikatet kunde inte verifieras. Ange Supabases CA-certifikat i SUPABASE_DB_CA_CERT.";
  return "Databasanslutningen misslyckades. Kontrollera värd, lösenord, nätverk och servercertifikat.";
}

async function main() {
  let ready = true;
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"] as const) {
    const valid = configured(process.env[name]);
    console.log(`${name}: ${valid ? "ifylld" : "saknas eller innehåller platshållare"}`);
    ready &&= valid;
  }
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (configured(projectUrl) && configured(publishableKey)) {
    const parsed = new URL(projectUrl!);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Supabase-projektets URL behöver vara en HTTPS-adress utan inloggningsuppgifter.");
    try {
      const response = await fetch(new URL("/auth/v1/settings", parsed), { headers: { apikey: publishableKey! }, signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store" });
      if (!response.ok) throw new Error();
      const settings = await response.json() as { external?: { email?: boolean }; mailer_autoconfirm?: boolean };
      console.log("Publik API-anslutning: godkänd");
      console.log(`E-postinloggning: ${settings.external?.email ? "aktiverad" : "kontrollera i Supabase"}`);
      if (settings.mailer_autoconfirm === true) { console.log("E-postbekräftelse: behöver aktiveras före användarflytten"); ready = false; }
    } catch { console.log("Publik API-anslutning: kunde inte verifieras"); ready = false; }
    if (configured(process.env.SUPABASE_SECRET_KEY)) {
      try {
        const client = createClient(projectUrl!, process.env.SUPABASE_SECRET_KEY!.trim(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" }) } });
        const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
        if (error) throw new Error();
        console.log("Serverns användaradministration: godkänd (inga konton ändrade)");
      } catch { console.log("Serverns användaradministration: kunde inte verifieras"); ready = false; }
    }
  }
  if (configured(process.env.DATABASE_URL)) {
    let pool: Pool | undefined;
    try {
      if (!matchesSupabaseDatabaseProject(projectUrl || "", process.env.DATABASE_URL!)) throw { code: "PROJECT_MISMATCH" };
      const parsed = new URL(process.env.DATABASE_URL!);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) throw new Error();
      // URL sslmode=require can weaken node-postgres certificate validation.
      // Keep verification explicit and never print the connection string.
      for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) parsed.searchParams.delete(key);
      pool = new Pool({ connectionString: parsed.href, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 10000,
        ssl: { rejectUnauthorized: true, ...(process.env.SUPABASE_DB_CA_CERT ? { ca: process.env.SUPABASE_DB_CA_CERT.replace(/\\n/g, "\n") } : {}) }, application_name: "slowlax-readiness" });
      await pool.query("SELECT 1");
      const { rows } = await pool.query<{ tablename: string; rowsecurity: boolean }>("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='slowlax'");
      console.log("Databasanslutning: godkänd (endast läsning)");
      if (!rows.length) { console.log("Slowlax-schema: behöver installeras"); ready = false; }
      else {
        const tables = new Map(rows.map(row => [row.tablename, row.rowsecurity]));
        const complete = POSTGRES_TABLES.every(table => tables.get(table) === true);
        const version = tables.has("app_meta") ? await pool.query<{ value: string }>("SELECT value FROM slowlax.app_meta WHERE key='postgres_schema_version'") : null;
        const correctVersion = Number(version?.rows[0]?.value) === POSTGRES_SCHEMA_VERSION;
        const roles = await pool.query<{ allowed: boolean }>("SELECT has_schema_privilege(oid,'slowlax','USAGE') AS allowed FROM pg_roles WHERE rolname IN ('anon','authenticated')");
        const privateSchema = roles.rows.every(role => !role.allowed);
        const validSchema = complete && correctVersion && privateSchema;
        console.log(`Slowlax-schema: ${validSchema ? "godkänt (tabeller, schemaversion och åtkomstskydd)" : "ofullständigt eller fel version/åtkomstskydd; kontrollera migrationen"}`);
        if (!validSchema) ready = false;
      }
    } catch (error) { console.log(failureCode(error)); ready = false; }
    finally { await pool?.end(); }
  }
  console.log(`Databasväxling: ${process.env.SUPABASE_DATABASE_ENABLED === "true" ? "aktiverad" : "väntar"}`);
  console.log(`Auth-växling: ${process.env.SUPABASE_AUTH_ENABLED === "true" ? "aktiverad" : "väntar"}`);
  if (!ready) process.exitCode = 1;
}
main().catch(() => { console.error("Förkontrollen kunde inte slutföras. Inga ändringar har gjorts i Supabase."); process.exitCode = 1; });
