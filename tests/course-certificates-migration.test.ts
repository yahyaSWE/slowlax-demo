import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter } from "../src/lib/database";
import { SCHEMA, SCHEMA_VERSION } from "../src/lib/schema";
import { POSTGRES_BASELINE_SQL } from "../src/lib/postgres-schema";
import { pglitePostgres } from "./helpers/pglite-postgres";

for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","VERCEL","SUPABASE_AUTH_ENABLED","SUPABASE_DATABASE_ENABLED"]) delete process.env[key];

test("SQLite v14 adds disabled diploma settings without changing existing progress or issuing certificates", async () => {
  const client=createClient({url:"file::memory:",intMode:"number",concurrency:1});
  const adapter=new DatabaseAdapter(); Object.assign(adapter,{clientPromise:Promise.resolve(client)});
  try {
    await client.executeMultiple(SCHEMA);
    await client.executeMultiple(`
      ALTER TABLE users ADD COLUMN email_verified_at TEXT;
      ALTER TABLE users ADD COLUMN supabase_id TEXT;
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at) VALUES(7,'old@example.test','Old student','fixture','student','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,published,created_at,updated_at) VALUES(31,'Existing completed course','existing-completed',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title) VALUES(32,31,'Existing lesson');
      INSERT INTO enrollments(user_id,course_id,created_at) VALUES(7,31,'2026-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(7,32,'2026-01-02T00:00:00.000Z');
      INSERT INTO app_meta(key,value) VALUES('seeded','1'),('schema_version','13'),('preserve-marker','original');
      PRAGMA user_version=13;
    `);
    const before=new Map<string,unknown>();
    for(const table of ["users","courses","lessons","enrollments","progress"]) before.set(table,(await client.execute(`SELECT * FROM ${table}`)).rows);
    await Promise.all([adapter.initialize(),adapter.initialize()]);
    for(const [table,rows] of before) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows,rows);
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version,SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='preserve-marker'")).rows[0].value,"original");
    for(const table of ["course_certificate_settings","course_certificates"]) assert.equal((await client.execute(`SELECT COUNT(*) AS total FROM ${table}`)).rows[0].total,0);
  } finally { await adapter.close(); }
});

test("PostgreSQL v1 remains unchanged on normal startup; explicit v2 migration preserves all historical rows", async () => {
  const {adapter,engine}=await pglitePostgres();
  try {
    await engine.exec("BEGIN"); await engine.exec(POSTGRES_BASELINE_SQL);
    await engine.exec(`INSERT INTO app_meta(key,value) VALUES('seeded','1'),('preserve-marker','original');
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at) VALUES(7,'old@example.test','Old student','fixture','student','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,published,created_at,updated_at) VALUES(31,'Old completed course','old-completed',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title) VALUES(32,31,'Old lesson');
      INSERT INTO enrollments(user_id,course_id,created_at) VALUES(7,31,'2026-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(7,32,'2026-01-02T00:00:00.000Z');`);
    await engine.exec("COMMIT");
    const before=new Map<string,unknown>();
    for(const table of ["users","courses","lessons","enrollments","progress"]) before.set(table,(await engine.query(`SELECT * FROM slowlax.${table}`)).rows);
    await assert.rejects(adapter.initialize(),/uppgraderas/);
    assert.equal((await engine.query<{name:string|null}>("SELECT to_regclass('slowlax.course_certificates') AS name")).rows[0].name,null);
    await adapter.migrate(); await adapter.migrate();
    for(const [table,rows] of before) assert.deepEqual((await adapter.prepare(`SELECT * FROM ${table}`).all()),rows);
    assert.equal((await adapter.prepare("SELECT value FROM app_meta WHERE key=?").get("postgres_schema_version"))?.value,"4");
    assert.equal((await adapter.prepare("SELECT value FROM app_meta WHERE key=?").get("preserve-marker"))?.value,"original");
    for(const table of ["course_certificate_settings","course_certificates"]) assert.equal((await adapter.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get())?.total,0);
  } finally {await adapter.close();}
});
