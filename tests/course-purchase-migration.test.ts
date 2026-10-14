import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter } from "../src/lib/database";
import { SCHEMA_VERSION } from "../src/lib/schema";

delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.VERCEL;

test("v9 course purchase migration starts disabled and empty, preserves deployed memberships/payments and rolls back atomically", async () => {
  const client = createClient({ url: "file::memory:", intMode: "number", concurrency: 1 });
  const legacy = new DatabaseAdapter(), migrated = new DatabaseAdapter();
  const observed = (skip: boolean) => new Proxy(client, {
    get(target, property) {
      if (property === "transaction") return async (mode: "write" | "read" | "deferred") => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(transaction, key) {
            if (key === "executeMultiple") return async (sql: string) => {
              if (skip && sql.includes("CREATE TABLE IF NOT EXISTS course_sales_settings")) return;
              await transaction.executeMultiple(sql);
              if (!skip && interrupt && sql.includes("CREATE TABLE IF NOT EXISTS course_sales_settings")) {
                interrupt = false; throw new Error("isolated interrupted course purchase migration");
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
  let interrupt = true;
  Object.assign(legacy, { clientPromise: Promise.resolve(observed(true)) });
  Object.assign(migrated, { clientPromise: Promise.resolve(observed(false)) });
  try {
    await legacy.initialize();
    await client.executeMultiple(`
      PRAGMA user_version=9;
      UPDATE app_meta SET value='9' WHERE key='schema_version';
      INSERT INTO app_meta VALUES('retained-course-settings','{"source":"existing"}');
      INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at)
        VALUES(101,'admin@purchase-migration.example.test','Existing admin','original-admin-hash','admin','2025-01-01T00:00:00.000Z',NULL),
          (102,'student@purchase-migration.example.test','Existing student','original-student-hash','student','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO sessions VALUES('existing-session',102,'2090-01-01T00:00:00.000Z');
      INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at)
        VALUES(103,'Existing Hijama course','existing-hijama-course','Retained course description',499000,1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO lessons(id,course_id,title,body) VALUES(104,103,'Existing lesson','Retained private body');
      INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(105,102,103,'2025-01-03T00:00:00.000Z');
      INSERT INTO progress VALUES(102,104,'2025-01-04T00:00:00.000Z');
      INSERT INTO membership_groups(id,name,slug,description,published,created_at,updated_at)
        VALUES(106,'Existing group','existing-group','Retained private group description',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_group_courses VALUES(106,103);
      INSERT INTO membership_assignments VALUES(107,102,106,NULL,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_plans VALUES(108,106,'Existing plan','existing-plan','Retained public offer',19900,25,'month',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      UPDATE membership_settings SET sales_enabled=1,terms='Existing subscription terms',updated_at='2025-01-02T00:00:00.000Z' WHERE id=1;
      INSERT INTO membership_posts VALUES(109,106,'Existing material','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Retained private material"}]}]}','2025-01',1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_uploads VALUES('a599f0fb-3f88-4e80-b1d0-365f498a6212',106,'document','Existing.pdf','application/pdf',123,'tibb/group-material/existing.pdf','local',101,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_post_uploads VALUES(109,'a599f0fb-3f88-4e80-b1d0-365f498a6212');
      INSERT INTO membership_customers VALUES(102,'cus_existing_subscription','2025-01-01T00:00:00.000Z');
      INSERT INTO membership_checkout_attempts(id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,session_id,customer_id,expires_at,created_at,updated_at)
        VALUES('existing-membership-attempt',102,108,106,'Retained accepted contract',19900,25,'month','Original plan name','existing-plan','2025-01-02T00:00:00.000Z','2025-01-02T00:00:00.000Z','subscribed','cs_existing_subscription','cus_existing_subscription','2025-01-01T01:00:00.000Z','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_checkout_tax_rates VALUES('existing-membership-attempt','txr_existing_subscription',25,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_subscriptions(stripe_id,user_id,plan_id,group_id,attempt_id,status,paid_until,blocked,cancel_at_period_end,customer_id,price_id,price_ore,vat_percent,interval,created_at,updated_at)
        VALUES('sub_existing_subscription',102,108,106,'existing-membership-attempt','active','2090-01-01T00:00:00.000Z',0,0,'cus_existing_subscription','price_existing_subscription',19900,25,'month','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z');
      INSERT INTO membership_paid_invoices VALUES('in_existing_subscription','sub_existing_subscription','pi_existing_subscription','ch_existing_subscription','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z',19900,'2025-01-01T00:00:00.000Z');
      INSERT INTO membership_billing_events VALUES('evt_existing_subscription','invoice.paid','2025-01-01T00:00:00.000Z');
      INSERT INTO treatments(id,name,duration_minutes,price_ore,active) VALUES(110,'Existing treatment',45,49900,1);
      INSERT INTO slots(id,treatment_id,start,end) VALUES(111,110,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z');
      INSERT INTO bookings(id,reference,treatment_id,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,status,payment_method,payment_status,created_at)
        VALUES(112,'existing-booking',110,111,'Existing treatment',45,49900,'2090-01-01T10:00:00.000Z','2090-01-01T10:45:00.000Z','Existing buyer','buyer@purchase-migration.example.test','confirmed','stripe','paid','2025-01-01T00:00:00.000Z');
      INSERT INTO shop_products(id,name,slug,price_ore,stock,published,created_at,updated_at,rich_description_json)
        VALUES(113,'Existing product','existing-product',15900,3,1,'2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z','{"type":"doc","content":[]}');
    `);
    const tables = ["users", "sessions", "settings", "courses", "lessons", "enrollments", "progress", "membership_groups", "membership_group_courses",
      "membership_assignments", "membership_plans", "membership_settings", "membership_posts", "membership_uploads", "membership_post_uploads",
      "membership_customers", "membership_checkout_attempts", "membership_checkout_tax_rates", "membership_subscriptions", "membership_paid_invoices",
      "membership_billing_events", "bookings", "shop_products", "shop_settings"];
    const originals = new Map<string, unknown>();
    for (const table of tables) originals.set(table, (await client.execute(`SELECT * FROM ${table}`)).rows);
    await assert.rejects(migrated.initialize(), /interrupted course purchase migration/);
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), 9);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, "9");
    assert.equal(Number((await client.execute("SELECT COUNT(*) total FROM sqlite_master WHERE name='course_sales_settings' OR name GLOB 'course_purchase*'")).rows[0].total), 0);
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, originals.get(table), table);
    await Promise.all([migrated.initialize(), migrated.initialize()]);
    assert.equal(Number((await client.execute("PRAGMA user_version")).rows[0].user_version), SCHEMA_VERSION);
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0].value, String(SCHEMA_VERSION));
    assert.equal((await client.execute("SELECT value FROM app_meta WHERE key='retained-course-settings'")).rows[0].value, '{"source":"existing"}');
    for (const table of tables) assert.deepEqual((await client.execute(`SELECT * FROM ${table}`)).rows, originals.get(table), table);
    for (const table of ["course_sales_settings", "course_purchase_customers", "course_purchase_attempts", "course_purchases", "course_purchase_events", "course_purchase_locks"])
      assert.equal(Number((await client.execute(`SELECT COUNT(*) total FROM ${table}`)).rows[0].total), 0, table);
  } finally { await migrated.close(); }
});
