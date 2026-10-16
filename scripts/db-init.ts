import { existsSync } from "node:fs";
import { initializeDatabase, getDb } from "../src/lib/database";
import { PostgresDatabaseAdapter } from "../src/lib/postgres-database";
import { postgresDatabaseConfigured } from "../src/lib/database-config";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  // This command explicitly requests bootstrap, before activating the live
  // provider flag. Requests themselves only verify an already-migrated schema.
  if (process.env.DATABASE_URL) {
    if (!postgresDatabaseConfigured()) throw new Error("DATABASE_URL är ofullständig eller blandad med Turso-konfiguration. Ange rätt PostgreSQL-uppgifter före migrering.");
    const database = new PostgresDatabaseAdapter();
    try {
      await database.migrate();
      console.log("PostgreSQL-schemat och Slowlax startinnehåll är klara.");
    } finally { await database.close(); }
    return;
  }
  await initializeDatabase();
  console.log("Databasens schema är klart.");
  await getDb().close();
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Databasen kunde inte initieras.",
  );
  process.exitCode = 1;
});
