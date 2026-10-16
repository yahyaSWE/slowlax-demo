import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client/node";
import { Pool } from "pg";
import { POSTGRES_INITIAL_SCHEMA_SQL, POSTGRES_TABLES } from "../src/lib/postgres-purification-schema";
import { importPostgresSnapshot, POSTGRES_IMPORT_SKIPPED, snapshotFingerprint, type DatabaseSnapshot } from "../src/lib/postgres-import";
import { postgresDatabaseConfigured } from "../src/lib/database-config";
import type { PostgresConnection } from "../src/lib/postgres-database";
import { matchesSupabaseDatabaseProject } from "../src/lib/supabase-project";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const apply = process.argv.includes("--apply");
  if (apply) {
    if (!postgresDatabaseConfigured()) throw new Error("En fungerande DATABASE_URL behöver anges före importen.");
    if (!matchesSupabaseDatabaseProject(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.DATABASE_URL!)) throw new Error("Supabase-projektets URL och databasanslutningen matchar inte. Ingen import har gjorts.");
  }
  const sourcePath = resolve(process.argv.find(arg => arg.startsWith("--sqlite="))?.slice("--sqlite=".length) || process.env.TIBB_DATABASE_PATH || "data/tibb.sqlite");
  if (!existsSync(sourcePath)) throw new Error("SQLite-källan saknas. Ange --sqlite med rätt sökväg.");
  const source = createClient({ url: pathToFileURL(sourcePath).href, intMode: "number", concurrency: 1 });
  let readSource = source;
  let backupPath: string | undefined;
  const snapshot: DatabaseSnapshot = {};
  try {
    if (apply) {
      // VACUUM INTO captures committed WAL contents in a consistent backup.
      const backupDirectory = resolve("backups");
      await mkdir(backupDirectory, { recursive: true });
      backupPath = join(backupDirectory, `pre-supabase-${Date.now()}-${randomUUID()}.sqlite`);
      await source.execute({ sql: "VACUUM INTO ?", args: [backupPath] });
      readSource = createClient({ url: pathToFileURL(backupPath).href, intMode: "number", concurrency: 1 });
    }
    const read = await readSource.transaction("read");
    try {
      const present = new Set((await read.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row => String(row.name)));
      for (const table of POSTGRES_TABLES) {
        if (POSTGRES_IMPORT_SKIPPED.has(table) || !present.has(table)) continue;
        // Table names come only from the versioned application schema.
        const check = await read.execute(`PRAGMA foreign_key_check("${table}")`);
        if (check.rows.length) throw new Error("Källdatabasen har ogiltiga relationer. Importen avbröts.");
        snapshot[table] = (await read.execute(`SELECT * FROM "${table}"`)).rows.map(row => ({ ...row }));
      }
      await read.commit();
    } catch (error) { await read.rollback(); throw error; }
    finally { read.close(); }
  } finally { if (readSource !== source) readSource.close(); source.close(); }
  const counts = Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length]));
  console.log(JSON.stringify({ mode: apply ? "import" : "förhandskontroll", source: sourcePath, counts, fingerprint: snapshotFingerprint(snapshot), ...(backupPath ? { backup: backupPath } : {}) }));
  if (!apply) { console.log("Inga Supabase-anrop har gjorts. Använd --apply först när förhandskontrollen är granskad och registrering/redigering är pausad under flytten."); return; }
  const url = new URL(process.env.DATABASE_URL!);
  for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
  const pool = new Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 120000, query_timeout: 125000,
    ssl: { rejectUnauthorized: true, ...(process.env.SUPABASE_DB_CA_CERT ? { ca: process.env.SUPABASE_DB_CA_CERT.replace(/\\n/g, "\n") } : {}) } });
  try {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock(1397509976,1)");
      const existing = await connection.query("SELECT to_regnamespace('slowlax') AS schema");
      if (existing.rows[0]?.schema) throw new Error("Slowlax-schemat finns redan. Importen kräver ett nytt mål och ändrar inte befintliga data.");
      await connection.query(POSTGRES_INITIAL_SCHEMA_SQL);
      const result = await importPostgresSnapshot(connection as unknown as PostgresConnection, snapshot);
      await connection.query("COMMIT");
      console.log(JSON.stringify({ imported: true, counts: result.counts, fingerprint: result.fingerprint }));
      console.log("Importen är verifierad. Inloggning och databasväxling aktiveras separat efter kontroll av administratörskontot.");
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  } finally { await pool.end(); }
}
main().catch(error => {
  // Expected messages never contain user records or credentials; pg/libSQL
  // errors are reduced to a generic message rather than logging SQL values.
  const message = error instanceof Error && /^(SQLite-källan|Källdatabasen|En fungerande DATABASE_URL|Supabase-projektets URL och databasanslutningen|Slowlax-schemat finns redan|Importen kräver|Måldatabasen|Källans kolumner|Radantalet|Ogiltig inställning)/.test(error.message) ? error.message : "Importen kunde inte slutföras och databastransaktionen har återställts. Kontrollera schema, anslutning och certifikat.";
  console.error(message); process.exitCode = 1;
});
