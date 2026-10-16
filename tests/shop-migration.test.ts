import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter } from "../src/lib/database";
import { SCHEMA, COURSE_ACTIVITY_SCHEMA, ACCOUNT_EMAIL_SCHEMA, SCHEMA_VERSION } from "../src/lib/schema";
import { SHOP_SCHEMA } from "../src/lib/shop-schema";
import { SHOP_IMAGE_SCHEMA } from "../src/lib/shop-image-schema";
import { SHOP_EMAIL_SCHEMA } from "../src/lib/shop-email-schema";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;

test("version 4 upgrade atomically adds a disabled empty shop and preserves existing bookings, verified users, tokens, grants and progress", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  const adapter = new DatabaseAdapter();
  let fail = true;
  const wrapped = new Proxy(client, {
    get(target, key) {
      if (key === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, property) {
            if (property === "executeMultiple") return async (sql: string) => {
              await transaction.executeMultiple(sql);
              if (fail && sql.includes("CREATE TABLE IF NOT EXISTS shop_orders")) {
                fail = false;
                throw new Error("isolated interrupted shop migration");
              }
            };
            const value = Reflect.get(transaction, property);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        });
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.assign(adapter, { clientPromise: Promise.resolve(wrapped) });
  try {
    await client.executeMultiple(SCHEMA);
    await client.executeMultiple(COURSE_ACTIVITY_SCHEMA);
    await client.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    await client.executeMultiple(ACCOUNT_EMAIL_SCHEMA);
    await client.executeMultiple(`
      INSERT INTO app_meta(key,value) VALUES('seeded','1'),('schema_version','4'),('preserve-import','original-course');
      PRAGMA user_version=4;
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at) VALUES(17,'admin@fixture.example.test','Existing Admin','existing-password-hash','admin','2025-01-01T00:00:00.000Z',NULL),(18,'student@fixture.example.test','Existing Student','existing-student-hash','student','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z');
      INSERT INTO sessions VALUES('existing-session-hash',18,'2090-01-01T00:00:00.000Z');
      INSERT INTO auth_tokens VALUES('existing-token-hash',18,'reset-password','2090-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at) VALUES(31,'Existing course','existing-course','',0,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title,body,position) VALUES(32,31,'Existing lesson','Original body',1);
      INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(33,18,31,'2025-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(18,32,'2025-01-01T00:00:00.000Z');
      INSERT INTO treatments(id,name,duration_minutes,price_ore,active) VALUES(40,'Existing treatment',45,49900,1);
      INSERT INTO slots(id,treatment_id,start,end) VALUES(41,40,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z');
      INSERT INTO bookings(id,reference,treatment_id,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,status,payment_method,created_at) VALUES(42,'existing-booking-reference',40,41,'Original price snapshot',45,49900,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z','Legacy customer','customer@example.test','confirmed','onsite','2025-01-01T00:00:00.000Z');
      INSERT INTO booking_email_outbox(id,booking_id,audience,recipient,subject,body,created_at,next_attempt_at) VALUES('original-mail',42,'customer','customer@example.test','Original subject','Original body','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
    `);
    const tables = ["users", "sessions", "auth_tokens", "courses", "lessons", "enrollments", "progress", "bookings", "booking_email_outbox", "settings"];
    const before = new Map<string, Record<string, unknown>[]>();
    for (const table of tables) before.set(table, (await client.execute(`SELECT * FROM ${table}`)).rows);
    await assert.rejects(adapter.initialize(), /interrupted shop migration/);
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version, 4);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM sqlite_master WHERE name='shop_settings'")).rows[0].total, 0);
    await Promise.all([adapter.initialize(), adapter.initialize()]);
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows,
      table === "users" ? before.get(table)!.map(row => ({ ...row, supabase_id: null })) : before.get(table));
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version, SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='preserve-import'")).rows[0].value, "original-course");
    assert.equal((await client.execute("SELECT enabled FROM shop_settings WHERE id=1")).rows[0].enabled, 0);
    assert.equal((await client.execute("SELECT shipping_enabled,pickup_enabled FROM shop_settings WHERE id=1")).rows[0].shipping_enabled, 1);
    assert.equal((await client.execute("SELECT shipping_enabled,pickup_enabled FROM shop_settings WHERE id=1")).rows[0].pickup_enabled, 1);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM shop_products")).rows[0].total, 0);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM shop_orders")).rows[0].total, 0);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM shop_images")).rows[0].total, 0);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM shop_email_outbox")).rows[0].total, 0);
    const cold = new DatabaseAdapter();
    Object.assign(cold, { clientPromise: Promise.resolve(client) });
    await cold.initialize();
    assert.equal((await client.execute("SELECT COUNT(*) total FROM shop_settings")).rows[0].total, 1);
  } finally { await adapter.close(); }
});

test("version 5 upgrade preserves live shop snapshots and rolls back interrupted commerce migration", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  const adapter = new DatabaseAdapter();
  let fail = true;
  const wrapped = new Proxy(client, {
    get(target, key) {
      if (key === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, property) {
            if (property === "executeMultiple") return async (sql: string) => {
              await transaction.executeMultiple(sql);
              if (fail && sql.includes("CREATE TABLE IF NOT EXISTS shop_bundle_items")) {
                fail = false;
                throw new Error("isolated interrupted commerce migration");
              }
            };
            const value = Reflect.get(transaction, property);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        });
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.assign(adapter, { clientPromise: Promise.resolve(wrapped) });
  try {
    await client.executeMultiple(SCHEMA);
    await client.executeMultiple(COURSE_ACTIVITY_SCHEMA);
    await client.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    await client.executeMultiple(ACCOUNT_EMAIL_SCHEMA);
    await client.executeMultiple(SHOP_IMAGE_SCHEMA);
    await client.executeMultiple(SHOP_SCHEMA);
    await client.executeMultiple(SHOP_EMAIL_SCHEMA);
    await client.executeMultiple(`
      INSERT INTO app_meta(key,value) VALUES('seeded','1'),('schema_version','5');
      PRAGMA user_version=5;
      UPDATE shop_settings SET enabled=1,shipping_price_ore=6900,pickup_address='Existing pickup',terms='Existing terms';
      INSERT INTO shop_products(id,name,slug,price_ore,stock,published,created_at,updated_at) VALUES(1,'Existing product','existing-product',10000,3,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO shop_orders(id,reference,name,email,delivery,subtotal_ore,shipping_ore,total_ore,expires_at,created_at,items_json,terms,checkout_session_id)
      VALUES(1,'existing-order-reference','Existing buyer','buyer@example.test','shipping',20000,6900,26900,'2090-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','[{"productId":1,"name":"Original product name","slug":"existing-product","priceOre":10000,"vatPercent":25,"quantity":2}]','Original purchase terms','cs_existing');
    `);
    const settings = (await client.execute("SELECT * FROM shop_settings")).rows[0];
    const product = (await client.execute("SELECT * FROM shop_products")).rows[0];
    const order = (await client.execute("SELECT * FROM shop_orders")).rows[0];
    await assert.rejects(adapter.initialize(), /interrupted commerce migration/);
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version, 5);
    assert.equal((await client.execute("PRAGMA table_info(shop_products)")).rows.some(row => row.name === "kind"), false);
    assert.equal((await client.execute("SELECT COUNT(*) total FROM sqlite_master WHERE name='shop_bundle_items'")).rows[0].total, 0);
    await adapter.initialize();
    for (const [table, previous] of [["shop_settings",settings],["shop_products",product],["shop_orders",order]] as const) {
      const current = (await client.execute(`SELECT * FROM ${table}`)).rows[0];
      for (const key of Object.keys(previous)) assert.equal(current[key], previous[key], `${table}.${key}`);
    }
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version, SCHEMA_VERSION);
    assert.deepEqual({ ...(await client.execute("SELECT kind,weight_grams FROM shop_products")).rows[0] }, {kind:"product",weight_grams:0});
    assert.deepEqual({ ...(await client.execute("SELECT shipping_rule_mode,packing_weight_grams FROM shop_settings")).rows[0] }, {shipping_rule_mode:0,packing_weight_grams:0});
    assert.deepEqual({ ...(await client.execute("SELECT inventory_json,discount_ore,original_subtotal_ore FROM shop_orders")).rows[0] }, {inventory_json:"[]",discount_ore:0,original_subtotal_ore:null});
  } finally { await adapter.close(); }
});
