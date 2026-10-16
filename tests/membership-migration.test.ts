import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import type { InStatement } from "@libsql/client";
import { DatabaseAdapter } from "../src/lib/database";
import { SCHEMA_VERSION } from "../src/lib/schema";

delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;

test("v7 migration creates disabled empty memberships atomically and preserves historical users, courses, activities, payments and progress", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  // Reuse the pre-v8 schema fragments without running the current Slowlax
  // seed, which depends on tables that did not exist in the v7 fixture.
  const legacy = new DatabaseAdapter();
  const legacyClient = new Proxy(client, {
    get(target, property) {
      if (property === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, key) {
            if (key === "executeMultiple") return async (sql: string) => {
              if (!/CREATE TABLE IF NOT EXISTS (membership_|free_membership_|purification_|rening_|course_sales_settings)/.test(sql)) await transaction.executeMultiple(sql);
            };
            if (key === "execute") return async (statement: InStatement) => {
              const sql=typeof statement === "string" ? statement : statement.sql;
              // v15 reserves the Bas URL in current paid plans. This historical
              // fixture intentionally predates the plans table, so there can
              // be no legacy paid Bas candidate to rename during its setup.
              if (/^SELECT\s+id\s*,\s*updated_at\s+FROM\s+membership_plans\s+WHERE\s+slug='bas'$/i.test(sql))
                return transaction.execute("SELECT 0 AS id,'' AS updated_at WHERE 0");
              return transaction.execute(statement);
            };
            const value = Reflect.get(transaction, key);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.assign(legacy, { clientPromise: Promise.resolve(legacyClient) });
  const migrated = new DatabaseAdapter();
  let interrupt = true;
  const migrationClient = new Proxy(client, {
    get(target, property) {
      if (property === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, key) {
            if (key === "executeMultiple") return async (sql: string) => {
              await transaction.executeMultiple(sql);
              if (interrupt && sql.includes("CREATE TABLE IF NOT EXISTS membership_subscriptions")) {
                interrupt = false; throw new Error("isolated interrupted membership migration");
              }
            };
            const value = Reflect.get(transaction, key);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.assign(migrated, { clientPromise: Promise.resolve(migrationClient) });
  try {
    await client.executeMultiple("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_meta(key,value) VALUES('seeded','1');");
    await legacy.initialize();
    await client.executeMultiple(`
      PRAGMA user_version=7;
      UPDATE app_meta SET value='7' WHERE key='schema_version';
      INSERT INTO app_meta(key,value) VALUES('preserve-custom-import','legacy-course-31');
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at)
        VALUES(17,'admin@migration.example.test','Original admin','original-hash','admin','2025-01-01T00:00:00.000Z',NULL),
          (18,'student@migration.example.test','Original student','original-student-hash','student','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z');
      INSERT INTO sessions VALUES('original-session',18,'2090-01-01T00:00:00.000Z');
      INSERT INTO auth_tokens VALUES('original-token',18,'reset-password','2090-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at)
        VALUES(31,'Original course','original-course','Original description',0,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title,body) VALUES(32,31,'Original lesson','Original lesson body');
      INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(33,18,31,'2025-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(18,32,'2025-01-01T00:00:00.000Z');
      INSERT INTO course_activities(id,lesson_id,kind,position,current_revision,created_at,updated_at)
        VALUES(34,32,'assignment',1,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO activity_revisions VALUES(34,1,'{"title":"Original assignment","instructions":"Write","questions":[],"passPercent":null}','2025-01-01T00:00:00.000Z');
      INSERT INTO assignment_submissions(id,activity_id,revision,user_id,body,status,feedback,created_at,submitted_at)
        VALUES(35,34,1,18,'Original student answer','submitted','','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO treatments(id,name,duration_minutes,price_ore,active) VALUES(40,'Original treatment',45,49900,1);
      INSERT INTO slots(id,treatment_id,start,end) VALUES(41,40,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z');
      INSERT INTO bookings(id,reference,treatment_id,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,status,payment_method,payment_status,created_at)
        VALUES(42,'original-booking',40,41,'Original booked treatment',45,49900,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z','Original buyer','buyer@migration.example.test','confirmed','stripe','paid','2025-01-01T00:00:00.000Z');
      INSERT INTO shop_products(id,name,slug,price_ore,stock,published,created_at,updated_at,rich_description_json)
        VALUES(43,'Original product','original-product',15900,3,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','{"type":"doc","content":[]}');
      INSERT INTO shop_orders(id,reference,name,email,delivery,subtotal_ore,shipping_ore,total_ore,expires_at,created_at,items_json,terms,status,payment_status)
        VALUES(44,'original-order','Original buyer','buyer@migration.example.test','pickup',15900,0,15900,'2090-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','[{"productId":43,"quantity":1,"priceOre":15900}]','Original purchase terms','paid','paid');
    `);
    const tables = ["users", "sessions", "auth_tokens", "settings", "courses", "lessons", "enrollments", "progress",
      "course_activities", "activity_revisions", "assignment_submissions", "bookings", "shop_products", "shop_orders", "shop_settings"];
    const original = new Map<string, unknown>();
    for (const table of tables) original.set(table, (await client.execute(`SELECT * FROM ${table}`)).rows);
    await assert.rejects(migrated.initialize(), /interrupted membership migration/);
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), 7);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, "7");
    assert.equal(Number((await client.execute("SELECT COUNT(*) total FROM sqlite_master WHERE name LIKE 'membership_%'")).rows[0].total), 0);
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, original.get(table), table);
    await Promise.all([migrated.initialize(), migrated.initialize()]);
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, String(SCHEMA_VERSION));
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, original.get(table), table);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='preserve-custom-import'")).rows[0].value, "legacy-course-31");
    assert.equal((await client.execute("SELECT sales_enabled,terms FROM membership_settings WHERE id=1")).rows[0].sales_enabled, 0);
    assert.equal((await client.execute("SELECT sales_enabled,terms FROM membership_settings WHERE id=1")).rows[0].terms, "");
    for (const table of ["membership_groups", "membership_plans", "membership_assignments", "membership_posts", "membership_uploads", "membership_subscriptions", "membership_checkout_attempts", "membership_checkout_tax_rates"])
      assert.equal(Number((await client.execute(`SELECT COUNT(*) total FROM ${table}`)).rows[0].total), 0, table);
  } finally { await migrated.close(); }
});

test("v8 migration adds inclusive VAT bindings atomically while preserving existing membership contracts and course progress", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  const source = new DatabaseAdapter();
  Object.assign(source, { clientPromise: Promise.resolve(client) });
  const migrated = new DatabaseAdapter();
  let interrupt = true;
  const observedClient = new Proxy(client, {
    get(target, property) {
      if (property === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, key) {
            if (key === "executeMultiple") return async (sql: string) => {
              await transaction.executeMultiple(sql);
              if (interrupt && sql.includes("CREATE TABLE IF NOT EXISTS membership_checkout_tax_rates")) {
                interrupt = false; throw new Error("isolated interrupted membership VAT migration");
              }
            };
            const value = Reflect.get(transaction, key);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.assign(migrated, { clientPromise: Promise.resolve(observedClient) });
  try {
    await source.initialize();
    // v9 is additive. Removing its new empty table and related triggers leaves
    // every v8 definition intact, avoiding a second hand-maintained schema.
    const vatTriggers = await client.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%membership_checkout_tax_rates%'");
    for (const trigger of vatTriggers.rows)
      await client.execute(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
    await client.execute("DROP TABLE membership_checkout_tax_rates");
    await client.executeMultiple(`
      PRAGMA user_version=8;
      UPDATE app_meta SET value='8' WHERE key='schema_version';
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at)
        VALUES(17,'vat-admin@migration.example.test','Existing admin','original-admin-hash','admin','2025-01-01T00:00:00.000Z',NULL),
          (18,'vat-member@migration.example.test','Existing member','original-member-hash','student','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at)
        VALUES(31,'Existing member course','existing-member-course','Original description',0,1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title,body) VALUES(32,31,'Existing member lesson','Original body');
      INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(33,18,31,'2025-01-01T00:00:00.000Z');
      INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(18,32,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_groups(id,name,slug,description,published,created_at,updated_at)
        VALUES(101,'Existing group','existing-group','Original private group description',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_group_courses VALUES(101,31);
      INSERT INTO membership_assignments(id,user_id,group_id,expires_at,created_at,updated_at)
        VALUES(104,18,101,NULL,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_plans(id,group_id,name,slug,description,price_ore,vat_percent,interval,published,created_at,updated_at)
        VALUES(102,101,'Existing monthly membership','existing-monthly-membership','Original public offer',12000,25,'month',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      UPDATE membership_settings SET sales_enabled=1,terms='Existing membership terms, recurring payments and cancellation.',updated_at='2025-01-02T00:00:00.000Z' WHERE id=1;
      INSERT INTO membership_posts(id,group_id,title,body_json,period,published,created_at,updated_at)
        VALUES(103,101,'Existing monthly material','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original private material"}]}]}','2025-01',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_uploads(id,group_id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,created_at)
        VALUES('cda264a7-8194-45e0-994e-fd03611c82d3',101,'document','Original material.pdf','application/pdf',123,'tibb/group-material/cda264a7-8194-45e0-994e-fd03611c82d3.pdf','local',17,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_post_uploads VALUES(103,'cda264a7-8194-45e0-994e-fd03611c82d3');
      INSERT INTO membership_customers VALUES(18,'cus_existing_member','2025-01-01T00:00:00.000Z');
      INSERT INTO membership_checkout_attempts(id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,session_id,customer_id,expires_at,created_at,updated_at)
        VALUES('1234567890abcdef1234567890abcdef',18,102,101,'Original accepted subscription terms',12000,25,'month','Original accepted plan name','existing-monthly-membership','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','subscribed','cs_existing_member','cus_existing_member','2025-01-01T01:00:00.000Z','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_subscriptions(stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,blocked,cancel_at_period_end,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
        VALUES('sub_existing_member',18,102,101,'1234567890abcdef1234567890abcdef','active','2090-01-01T00:00:00.000Z',0,1,'cus_existing_member','price_existing_member',12000,25,'month','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_paid_invoices VALUES('in_existing_member','sub_existing_member','pi_existing_member','ch_existing_member','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z',12000,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_billing_events VALUES('evt_existing_member','invoice.paid','2025-01-01T00:00:00.000Z');
    `);
    const tables = ["users", "courses", "lessons", "enrollments", "progress", "membership_groups", "membership_group_courses",
      "membership_assignments", "membership_plans", "membership_settings", "membership_posts", "membership_uploads", "membership_post_uploads",
      "membership_customers", "membership_checkout_attempts", "membership_subscriptions", "membership_paid_invoices", "membership_billing_events"];
    const originals = new Map<string, unknown>();
    for (const table of tables) originals.set(table, (await client.execute(`SELECT * FROM ${table}`)).rows);
    await assert.rejects(migrated.initialize(), /interrupted membership VAT migration/);
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), 8);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, "8");
    assert.equal(Number((await client.execute("SELECT COUNT(*) total FROM sqlite_master WHERE name='membership_checkout_tax_rates'")).rows[0].total), 0);
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, originals.get(table), table);
    await migrated.initialize();
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, String(SCHEMA_VERSION));
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, originals.get(table), table);
    assert.equal(Number((await client.execute("SELECT COUNT(*) total FROM membership_checkout_tax_rates")).rows[0].total), 0);
    await assert.rejects(client.execute("INSERT INTO membership_checkout_tax_rates VALUES('1234567890abcdef1234567890abcdef','txr_wrong_percent',12,'2025-01-01T00:00:00.000Z')"));
    await client.execute("INSERT INTO membership_checkout_tax_rates VALUES('1234567890abcdef1234567890abcdef','txr_correct_percent',25,'2025-01-01T00:00:00.000Z')");
    await assert.rejects(client.execute("UPDATE membership_checkout_tax_rates SET stripe_id='txr_changed'"));
  } finally { await migrated.close(); }
});
