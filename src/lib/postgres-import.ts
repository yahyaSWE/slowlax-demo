import { createHash } from "node:crypto";
import { POSTGRES_IDENTITY_TABLES, POSTGRES_TABLES, POSTGRES_RESERVE_BAS_SLUG_SQL } from "./postgres-purification-schema";
import type { PostgresConnection } from "./postgres-database";

export type DatabaseSnapshot = Record<string, Record<string, unknown>[]>;
// Sessions, recovery links and unfinished upload/worker leases do not survive
// an identity-provider cutover. Completed purchases and invitations do.
export const POSTGRES_IMPORT_SKIPPED = new Set(["sessions", "auth_tokens", "rate_limits", "upload_requests", "membership_upload_requests", "membership_billing_locks", "course_purchase_locks", "rening_purchase_locks"]);
const singletons = new Set(["settings", "practitioners", "membership_settings", "kit_newsletter_settings", "free_membership_settings", "rening_settings", "rening_offers"]);
const quote = (name: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Ogiltigt databasnamn.");
  return `"${name}"`;
};
export function snapshotFingerprint(snapshot: DatabaseSnapshot): string {
  const canonical = Object.keys(snapshot).sort().map(table => [table, snapshot[table].map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort()]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Run only inside the transaction that created a fresh private baseline.
 * Refuses populated targets and validates every FK before returning. USER
 * triggers are restored in that same transaction; they would otherwise reject
 * historical immutable purchase snapshots whose offer has since changed.
 */
export async function importPostgresSnapshot(connection: PostgresConnection, snapshot: DatabaseSnapshot) {
  const tableNames: readonly string[] = POSTGRES_TABLES;
  const tables = tableNames.filter(table => table !== "app_meta" && !POSTGRES_IMPORT_SKIPPED.has(table));
  for (const table of Object.keys(snapshot)) if (!tableNames.includes(table)) throw new Error("Källan innehåller en okänd tabell.");
  if (!snapshot.users || !snapshot.courses || !snapshot.articles || snapshot.settings?.length !== 1 || Number(snapshot.settings[0].id) !== 1) throw new Error("Källans grundtabeller saknas eller är ogiltiga.");
  const seeded = await connection.query("SELECT value FROM slowlax.app_meta WHERE key IN ('seeded','postgres_import_sha256')");
  if (seeded.rows.length) throw new Error("Importen kräver ett nytt, tomt Slowlax-schema.");
  for (const table of tables) {
    const count = await connection.query(`SELECT count(*) AS total FROM slowlax.${quote(table)}`);
    if (Number(count.rows[0]?.total) && !singletons.has(table)) throw new Error("Måldatabasen innehåller redan innehåll. Importen avbröts.");
    if (table === "rening_offers" && Number(count.rows[0]?.total)) {
      const offers = await connection.query("SELECT preset_code,title,credits,price_ore,vat_percent,published,created_at,updated_at FROM slowlax.rening_offers ORDER BY credits");
      const defaults = [[4,19900],[9,29900],[14,39900]];
      if (offers.rows.length !== defaults.length || offers.rows.some((row,i) => {
        const [credits,price] = defaults[i];
        return row.preset_code !== `rening-${credits}` || row.title !== `Rening – ${credits} bolag` || Number(row.credits) !== credits || Number(row.price_ore) !== price || Number(row.vat_percent) !== 25 || Number(row.published) !== 0 || row.created_at !== "1970-01-01T00:00:00.000Z" || row.updated_at !== "1970-01-01T00:00:00.000Z";
      })) throw new Error("Måldatabasen innehåller redan innehåll. Importen avbröts.");
    }
  }
  await connection.query("SET CONSTRAINTS ALL DEFERRED");
  for (const table of tables) await connection.query(`ALTER TABLE slowlax.${quote(table)} DISABLE TRIGGER USER`);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (singletons.has(table) && snapshot[table]?.length) await connection.query(`DELETE FROM slowlax.${quote(table)}`);
    const rows = snapshot[table] ?? [];
    const columns = await connection.query("SELECT column_name FROM information_schema.columns WHERE table_schema='slowlax' AND table_name=$1", [table]);
    const allowedColumns = new Set(columns.rows.map(row => String(row.column_name)));
    for (const row of rows) {
      const names = Object.keys(row);
      if (!names.length || names.some(name => !allowedColumns.has(name))) throw new Error("Källans kolumner matchar inte PostgreSQL-schemat.");
      await connection.query(`INSERT INTO slowlax.${quote(table)} (${names.map(quote).join(",")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(",")})`, names.map(name => row[name]));
    }
    const count = await connection.query(`SELECT count(*) AS total FROM slowlax.${quote(table)}`);
    if (rows.length && Number(count.rows[0]?.total) !== rows.length) throw new Error("Radantalet stämmer inte efter importen.");
    counts[table] = rows.length;
  }
  for (const row of snapshot.app_meta ?? []) {
    if (typeof row.key !== "string" || typeof row.value !== "string") throw new Error("Ogiltig inställning i källdatabasen.");
    if (row.key === "schema_version" || row.key.startsWith("postgres_")) continue;
    await connection.query("INSERT INTO slowlax.app_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [row.key, row.value]);
  }
  // Old SQLite sources may predate Bas. Reserve its public URL after copying
  // current offers, while historical accepted checkout snapshots stay intact.
  await connection.query(POSTGRES_RESERVE_BAS_SLUG_SQL);
  // Deferral covers nullable cycles such as course -> upload -> course.
  // Flush the FK events before ALTER TABLE, which otherwise fails with 55006.
  await connection.query("SET CONSTRAINTS ALL IMMEDIATE");
  for (const table of tables) await connection.query(`ALTER TABLE slowlax.${quote(table)} ENABLE TRIGGER USER`);
  for (const table of POSTGRES_IDENTITY_TABLES) {
    if (!tables.includes(table)) continue;
    await connection.query(`SELECT setval(pg_get_serial_sequence($1,'id'),GREATEST(COALESCE(MAX(id),1),1),COUNT(*)>0) FROM slowlax.${quote(table)}`, [`slowlax.${table}`]);
  }
  const fingerprint = snapshotFingerprint(snapshot);
  await connection.query("INSERT INTO slowlax.app_meta(key,value) VALUES('seeded','1') ON CONFLICT(key) DO NOTHING");
  await connection.query("INSERT INTO slowlax.app_meta(key,value) VALUES('postgres_import_sha256',$1)", [fingerprint]);
  return { counts, fingerprint };
}
