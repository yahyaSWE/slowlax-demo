import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter } from "../src/lib/database";
import { SCHEMA, COURSE_ACTIVITY_SCHEMA, SCHEMA_VERSION } from "../src/lib/schema";
import { hashPassword, verifyPassword } from "../src/lib/security";

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;

test("version 3 adds ownership and mail tables without auto-verifying old users or changing access, sessions, progress and bookings", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  const adapter = new DatabaseAdapter();
  Object.assign(adapter, { clientPromise: Promise.resolve(client) });
  try {
    await client.executeMultiple(SCHEMA);
    await client.executeMultiple(COURSE_ACTIVITY_SCHEMA);
    const password = hashPassword("existing migrated password fixture");
    for (const [id, role] of [[17, "admin"], [18, "student"]] as const)
      await client.execute({ sql: "INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)", args: [id, `${role}@migration.example.test`, `Existing ${role}`, password, role, "2025-01-01T00:00:00.000Z"] });
    await client.executeMultiple(`
      INSERT INTO app_meta(key,value) VALUES('seeded','1'),('schema_version','3'),('preserve-custom','legacy-marker');
      PRAGMA user_version=3;
      INSERT INTO sessions VALUES('existing-session-hash',18,'2090-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at) VALUES(31,'Existing course','existing-course','',0,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title,body,position) VALUES(32,31,'Existing lesson','Original body',1);
      INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(33,18,31,'2025-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(18,32,'2025-01-01T00:00:00.000Z');
      INSERT INTO treatments(id,name,duration_minutes,price_ore,active) VALUES(40,'Original treatment',45,49900,1);
      INSERT INTO slots(id,treatment_id,start,end) VALUES(41,40,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z');
      INSERT INTO bookings(id,reference,treatment_id,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,status,payment_method,created_at) VALUES(42,'legacy-reference',40,41,'Original snapshot',45,49900,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z','Legacy customer','customer@example.test','confirmed','onsite','2025-01-01T00:00:00.000Z');
    `);
    const tables = ["users", "sessions", "courses", "lessons", "enrollments", "progress", "bookings"];
    const before = new Map<string, Record<string, unknown>[]>();
    for (const table of tables) before.set(table, (await client.execute(`SELECT * FROM ${table}`)).rows as Record<string, unknown>[]);
    await Promise.all([adapter.initialize(), adapter.initialize()]);
    for (const table of tables) {
      const expected = before.get(table)!;
      assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows,
        table === "users" ? expected.map((row) => ({ ...row, email_verified_at: null, supabase_id: null })) : expected);
    }
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version, SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='preserve-custom'")).rows[0].value, "legacy-marker");
    assert.equal((await client.execute("SELECT COUNT(*) total FROM auth_tokens")).rows[0].total, 0);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM booking_email_outbox")).rows[0].total, 0);
    assert.ok(verifyPassword("existing migrated password fixture", String((await client.execute("SELECT password_hash FROM users WHERE id=17")).rows[0].password_hash)));
    const cold = new DatabaseAdapter();
    Object.assign(cold, { clientPromise: Promise.resolve(client) });
    await cold.initialize();
    assert.equal((await client.execute("PRAGMA table_info(users)")).rows.filter((row) => row.name === "email_verified_at").length, 1);
  } finally { await adapter.close(); }
});
