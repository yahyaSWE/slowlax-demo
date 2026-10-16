import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pglitePostgres } from "./helpers/pglite-postgres";
import { postgresSql } from "../src/lib/postgres-sql";
import { databaseConfigured, databaseProvider, postgresDatabaseConfigured } from "../src/lib/database-config";

test("PostgreSQL bootstrap is explicit, transactional, idempotent and private", async () => {
  const { adapter, engine } = await pglitePostgres();
  try {
    await engine.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await assert.rejects(adapter.initialize(), /schemat saknas/);
    await adapter.migrate();
    const first = await adapter.prepare("SELECT COUNT(*) AS total FROM articles").get();
    assert.ok(Number(first?.total) > 0);
    await adapter.migrate();
    assert.deepEqual(await adapter.prepare("SELECT COUNT(*) AS total FROM articles").get(), first);
    const tables = await engine.query<{ tablename: string; rowsecurity: boolean }>("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='slowlax'");
    assert.ok(tables.rows.length >= 50);
    assert.ok(tables.rows.every(table => table.rowsecurity));
    assert.ok(!tables.rows.some(table => /^(shop_|bookings$|slots$|treatments$)/.test(table.tablename)));
    await engine.exec("SET ROLE anon");
    await assert.rejects(engine.query("SELECT * FROM slowlax.users"), /permission denied/);
    await engine.exec("RESET ROLE; SET ROLE authenticated");
    await assert.rejects(engine.query("SELECT * FROM slowlax.users"), /permission denied/);
    await engine.exec("RESET ROLE");
  } finally { await adapter.close(); }
});

test("PostgreSQL adapter preserves identities, case-insensitive email, dates, JSON and transaction rollback", async () => {
  const { adapter } = await pglitePostgres();
  try {
    await adapter.migrate();
    const now = new Date().toISOString();
    const created = await adapter.prepare("INSERT INTO users(email,name,password_hash,role,created_at,supabase_id) VALUES(?,?,?,?,?,?)")
      .run("Ada@EXAMPLE.com", "Ada", "supabase-managed", "student", now, "c07b31d5-743f-4f2a-838b-2c91d64e15e8");
    const id = Number(created.lastInsertRowid);
    assert.ok(id > 0);
    assert.equal(created.changes, 1);
    assert.equal((await adapter.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").get("ada@example.COM"))?.id, id);
    await assert.rejects(adapter.prepare("INSERT INTO users(email,name,password_hash,role,created_at) VALUES(?,?,?,?,?)").run("ADA@example.com", "Other", "unused", "student", now), /unique constraint/);
    assert.equal((await adapter.prepare("SELECT COUNT(*) AS total FROM users").get())?.total, 1);
    const helpers = await adapter.prepare("SELECT json_extract(?,'$.title') AS title,julianday(?) AS invalid,julianday(?) - julianday(?) AS days").get('{"title":"Lär dig"}', "bad-date", "2026-10-16T12:30:00.000Z", "2026-10-15T12:30:00.000Z");
    assert.equal(helpers?.title, "Lär dig"); assert.equal(helpers?.invalid, null); assert.equal(Number(helpers?.days), 1);
    await assert.rejects(adapter.transaction(async () => {
      await adapter.prepare("UPDATE users SET name=? WHERE id=?").run("Changed", id);
      await adapter.transaction(async () => { await adapter.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run("rollback-probe", "x"); });
      throw new Error("rollback");
    }), /rollback/);
    assert.equal((await adapter.prepare("SELECT name FROM users WHERE id=?").get(id))?.name, "Ada");
    assert.equal(await adapter.prepare("SELECT value FROM app_meta WHERE key=?").get("rollback-probe"), undefined);
    await adapter.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)").run("seeded", "ignored");
    assert.equal((await adapter.prepare("SELECT value FROM app_meta WHERE key=?").get("seeded"))?.value, "1");
    await adapter.prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)").run("serialization", 0, now);
    await Promise.all(Array.from({length: 12}, () => adapter.transaction(async () => {
      const row = await adapter.prepare("SELECT count FROM rate_limits WHERE key=?").get("serialization");
      await adapter.prepare("UPDATE rate_limits SET count=? WHERE key=?").run(Number(row?.count)+1, "serialization");
    })));
    assert.equal((await adapter.prepare("SELECT count FROM rate_limits WHERE key=?").get("serialization"))?.count, 12);
  } finally { await adapter.close(); }
});

test("versioned SQL migration bootstraps the same private schema independently", async () => {
  const { adapter, engine } = await pglitePostgres();
  try {
    const sql = await readFile("supabase/migrations/202610150001_slowlax.sql", "utf8");
    await engine.exec(sql);
    await assert.rejects(adapter.initialize(),/uppgraderas/);
    const migration = await readFile("supabase/migrations/202610150002_course_certificates.sql", "utf8");
    await engine.exec(migration);
    const freeMembershipMigration = await readFile("supabase/migrations/202610160003_free_membership.sql", "utf8");
    await engine.exec(freeMembershipMigration);
    await assert.rejects(adapter.initialize(),/uppgraderas/);
    await engine.exec(await readFile("supabase/migrations/202610160004_purification.sql", "utf8"));
    await adapter.initialize();
    assert.equal((await adapter.prepare("SELECT value FROM app_meta WHERE key=?").get("postgres_schema_version"))?.value, "4");
    const unique = await engine.query<{indexname:string}>("SELECT indexname FROM pg_indexes WHERE schemaname='slowlax' AND tablename='users'");
    assert.ok(unique.rows.some(row => row.indexname === "users_email_lower"));
  } finally { await adapter.close(); }
});

test("SQL parameter conversion preserves literal question marks and scalar/aggregate MAX", () => {
  assert.equal(postgresSql("SELECT '?' AS literal, ? AS value -- ?\n"), "SELECT '?' AS literal, $1 AS value -- ?");
  assert.equal(postgresSql("SELECT MAX(attempt_number) FROM quiz_attempts WHERE user_id=?"), "SELECT MAX(attempt_number) FROM quiz_attempts WHERE user_id=$1");
  assert.equal(postgresSql("UPDATE course_purchases SET revoked=MAX(course_purchases.revoked,excluded.revoked) WHERE id=?"), "UPDATE course_purchases SET revoked=GREATEST(course_purchases.revoked,excluded.revoked) WHERE id=$1");
});

test("database cutover requires an explicit gate and never falls back after activation", () => {
  const keys = ["DATABASE_URL", "SUPABASE_DATABASE_ENABLED", "SUPABASE_AUTH_ENABLED", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.DATABASE_URL = "postgres://test:test@localhost/slowlax";
    assert.equal(postgresDatabaseConfigured(), true);
    assert.equal(databaseProvider(), "sqlite");
    process.env.SUPABASE_DATABASE_ENABLED = "true";
    assert.equal(databaseProvider(), "postgres");
    process.env.DATABASE_URL = "postgres://test:[YOUR-PASSWORD]@localhost/slowlax";
    assert.equal(databaseConfigured(), false);
    process.env.DATABASE_URL = "not-a-database";
    assert.equal(databaseProvider(), "invalid");
    process.env.SUPABASE_DATABASE_ENABLED = "false";
    process.env.SUPABASE_AUTH_ENABLED = "true";
    assert.equal(databaseConfigured(), false);
  } finally { for (const [key,value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
