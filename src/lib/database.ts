import { AsyncLocalStorage } from "node:async_hooks";
import { createClient as createRemoteClient } from "@libsql/client/http";
import {
  LibsqlError,
  type Client,
  type InValue,
  type ResultSet,
  type Transaction,
} from "@libsql/client";
import {
  SCHEMA,
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  SLOT_SCHEDULE_SCHEMA,
  COURSE_ACTIVITY_SCHEMA,
  ACCOUNT_EMAIL_SCHEMA,
} from "./schema";
import { databaseConfigured, databaseProvider } from "./database-config";
import { PostgresDatabaseAdapter } from "./postgres-database";
import { SHOP_SCHEMA } from "./shop-schema";
import { SHOP_IMAGE_SCHEMA } from "./shop-image-schema";
import { SHOP_EMAIL_SCHEMA } from "./shop-email-schema";
import { SHOP_COMMERCE_SCHEMA } from "./shop-commerce-schema";
import { SHOP_PRODUCT_CONTENT_SCHEMA } from "./shop-product-content-schema";
import { MEMBERSHIP_SCHEMA } from "./membership-schema";
import { MEMBERSHIP_UPLOAD_SCHEMA } from "./membership-upload-schema";
import { MEMBERSHIP_BILLING_SCHEMA } from "./membership-billing-schema";
import { COURSE_PURCHASE_SCHEMA } from "./course-purchase-schema";
import { COURSE_BUNDLES_SCHEMA } from "./course-bundles-schema";
import { KIT_NEWSLETTER_SCHEMA } from "./kit-newsletter-schema";
import { COURSE_CERTIFICATES_SCHEMA } from "./course-certificates-schema";
import { PURIFICATION_SCHEMA } from "./purification-schema";
import { PURIFICATION_BILLING_SCHEMA } from "./purification-billing-schema";
import { FREE_MEMBERSHIP_SCHEMA } from "./free-membership-schema";
import slowlaxArticles from "./slowlax-articles.json";
import { DEMO_MODE } from "./demo-mode";
export { databaseConfigured } from "./database-config";

export class DatabaseConfigurationError extends Error {
  constructor() {
    super(
      "Databasen är inte konfigurerad. Ange en fungerande DATABASE_URL för PostgreSQL, eller TURSO_DATABASE_URL och TURSO_AUTH_TOKEN. Supabase-inloggning kräver PostgreSQL. Konfigurera bara en databasleverantör.",
    );
  }
}
const context = new AsyncLocalStorage<Transaction>();
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
type Row = Record<string, unknown>;
export class DatabaseAdapter {
  private clientPromise?: Promise<Client>;
  private readyPromise?: Promise<void>;
  private localMutex = new Mutex();
  private readonly remote = !!process.env.TURSO_DATABASE_URL;
  private async client(): Promise<Client> {
    if (!databaseConfigured()) throw new DatabaseConfigurationError();
    this.clientPromise ??= (async () => {
      if (this.remote)
        return createRemoteClient({
          url: process.env.TURSO_DATABASE_URL!,
          authToken: process.env.TURSO_AUTH_TOKEN!,
          intMode: "number",
        });
      // Never import the local SQLite driver or create files on Vercel.
      const [
        { createClient },
        { mkdir },
        { dirname, resolve },
        { pathToFileURL },
      ] = await Promise.all([
        import("@libsql/client/node"),
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
      ]);
      const path =
        process.env.TIBB_DATABASE_PATH ||
        resolve(process.cwd(), "data/tibb.sqlite");
      if (path !== ":memory:")
        await mkdir(dirname(resolve(path)), { recursive: true });
      return createClient({
        url:
          path === ":memory:"
            ? "file::memory:"
            : pathToFileURL(resolve(path)).href,
        intMode: "number",
        concurrency: 1,
        timeout: 5000,
      });
    })();
    try {
      return await this.clientPromise;
    } catch (error) {
      this.clientPromise = undefined;
      throw error;
    }
  }
  private gate<T>(work: () => Promise<T>) {
    return this.remote ? work() : this.localMutex.run(work);
  }
  private async hasCurrentSchema(
    client: Pick<Client, "execute">,
  ): Promise<boolean> {
    // Hosted Turso does not permit assigning PRAGMA user_version. Keep its
    // version in an ordinary table; local SQLite can use the header field.
    let version: number;
    if (this.remote) {
      let result: ResultSet;
      try {
        result = await client.execute({
          sql: "SELECT value FROM app_meta WHERE key=?",
          args: [SCHEMA_VERSION_KEY],
        });
      } catch (error) {
        if (
          error instanceof LibsqlError &&
          ["SQLITE_ERROR", "SQL_INPUT_ERROR"].includes(error.code) &&
          /no such table:\s*(?:main\.)?app_meta\b/i.test(error.message)
        )
          return false;
        throw error;
      }
      if (!result.rows.length) return false;
      version = Number(result.rows[0].value);
    } else {
      const result = await client.execute("PRAGMA user_version");
      version = Number(result.rows[0]?.user_version);
    }
    if (!Number.isSafeInteger(version) || version < 0)
      throw new Error("Databasens schemaversion kunde inte läsas.");
    if (version > SCHEMA_VERSION)
      throw new Error(
        "Databasen har en nyare schemaversion. Använd den senaste publicerade versionen av Slowlax.",
      );
    return version === SCHEMA_VERSION;
  }
  async initialize(): Promise<void> {
    this.readyPromise ??= this.gate(async () => {
      const client = await this.client();
      if (!this.remote) {
        await client.execute("PRAGMA foreign_keys=ON");
        await client.execute("PRAGMA journal_mode=WAL");
      }
      // Existing deployments need one read instead of replaying all DDL and
      // opening a write transaction on every serverless cold start.
      if (await this.hasCurrentSchema(client)) return;
      const tx = await client.transaction("write");
      try {
        // Another instance may have migrated while this one waited for the
        // database write lock. Recheck under that lock before doing any DDL.
        if (await this.hasCurrentSchema(tx)) {
          await tx.commit();
          return;
        }
        await tx.executeMultiple(SCHEMA);
        await tx.executeMultiple(COURSE_ACTIVITY_SCHEMA);
        const userColumns = await tx.execute("PRAGMA table_info(users)");
        if (!userColumns.rows.some((row) => row.name === "email_verified_at"))
          await tx.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
        if (!userColumns.rows.some((row) => row.name === "supabase_id"))
          await tx.execute("ALTER TABLE users ADD COLUMN supabase_id TEXT");
        await tx.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON users(supabase_id)");
        await tx.executeMultiple(ACCOUNT_EMAIL_SCHEMA);
        await tx.executeMultiple(SHOP_IMAGE_SCHEMA);
        await tx.executeMultiple(SHOP_SCHEMA);
        await tx.executeMultiple(SHOP_EMAIL_SCHEMA);
        const shopAdditions: Record<string, Record<string, string>> = {
          shop_settings: { shipping_rule_mode: "INTEGER NOT NULL DEFAULT 0 CHECK(shipping_rule_mode IN (0,1))", packing_weight_grams: "INTEGER NOT NULL DEFAULT 0 CHECK(packing_weight_grams BETWEEN 0 AND 1000000)" },
          shop_products: { kind: "TEXT NOT NULL DEFAULT 'product' CHECK(kind IN ('product','bundle'))", weight_grams: "INTEGER NOT NULL DEFAULT 0 CHECK(weight_grams BETWEEN 0 AND 100000000)", rich_description_json: "TEXT" },
          shop_orders: { inventory_json: "TEXT NOT NULL DEFAULT '[]'", original_subtotal_ore: "INTEGER", discount_ore: "INTEGER NOT NULL DEFAULT 0", discounts_json: "TEXT NOT NULL DEFAULT '[]'", weight_grams: "INTEGER", shipping_label: "TEXT NOT NULL DEFAULT ''", coupon_code: "TEXT" },
        };
        for (const [table, additions] of Object.entries(shopAdditions)) {
          const present = await tx.execute(`PRAGMA table_info(${table})`);
          for (const [column, definition] of Object.entries(additions)) {
            if (!present.rows.some((row) => row.name === column))
              await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
          }
        }
        await tx.executeMultiple(SHOP_COMMERCE_SCHEMA);
        await tx.executeMultiple(SHOP_PRODUCT_CONTENT_SCHEMA);
        await tx.executeMultiple(MEMBERSHIP_SCHEMA);
        await tx.executeMultiple(MEMBERSHIP_UPLOAD_SCHEMA);
        await tx.executeMultiple(MEMBERSHIP_BILLING_SCHEMA);
        await tx.executeMultiple(COURSE_PURCHASE_SCHEMA);
        await tx.executeMultiple(COURSE_BUNDLES_SCHEMA);
        await tx.executeMultiple(KIT_NEWSLETTER_SCHEMA);
        await tx.executeMultiple(FREE_MEMBERSHIP_SCHEMA);
        // /medlemskap/bas now belongs to the free membership. Preserve legacy
        // paid contracts and their immutable checkout slugs while giving only
        // the editable current plan a fresh, collision-free URL and revision.
        const legacyBasPlans=await tx.execute("SELECT id,updated_at FROM membership_plans WHERE slug='bas'");
        for(const plan of legacyBasPlans.rows) {
          const base=`bas-betalt-${Number(plan.id)}`;
          let candidate=base,suffix=1;
          while((await tx.execute({sql:"SELECT id FROM membership_plans WHERE slug=? AND id<>?",args:[candidate,Number(plan.id)]})).rows.length)
            candidate=`${base}-${++suffix}`;
          const previous=Date.parse(String(plan.updated_at));
          const revision=new Date(Math.max(Date.now(),Number.isFinite(previous)?previous+1:0)).toISOString();
          await tx.execute({sql:"UPDATE membership_plans SET slug=?,updated_at=? WHERE id=?",args:[candidate,revision,Number(plan.id)]});
        }
        // v15 extends the access predicate with Bas. Existing IF NOT EXISTS
        // certificate guards must be recreated to recognize the new source.
        await tx.execute("DROP TRIGGER IF EXISTS course_certificate_issuance_reference");
        await tx.executeMultiple(COURSE_CERTIFICATES_SCHEMA);
        await tx.executeMultiple(PURIFICATION_SCHEMA);
        await tx.executeMultiple(PURIFICATION_BILLING_SCHEMA);
        const uploadRequestColumns = await tx.execute(
          "PRAGMA table_info(upload_requests)",
        );
        if (!uploadRequestColumns.rows.some((row) => row.name === "completing"))
          await tx.execute(
            "ALTER TABLE upload_requests ADD COLUMN completing INTEGER NOT NULL DEFAULT 0 CHECK(completing IN (0,1))",
          );
        const practitionerColumns = await tx.execute(
          "PRAGMA table_info(practitioners)",
        );
        if (
          !practitionerColumns.rows.some(
            (row) => row.name === "photo_upload_id",
          )
        )
          await tx.execute(
            "ALTER TABLE practitioners ADD COLUMN photo_upload_id TEXT REFERENCES uploads(id)",
          );
        const columns = await tx.execute("PRAGMA table_info(slots)");
        if (!columns.rows.some((row) => row.name === "archived"))
          await tx.execute(
            "ALTER TABLE slots ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
          );
        if (!columns.rows.some((row) => row.name === "schedule_id"))
          await tx.execute(
            "ALTER TABLE slots ADD COLUMN schedule_id INTEGER REFERENCES availability_schedules(id)",
          );
        // Existing SQLite tables cannot add a REFERENCES column with a non-null
        // default while FK enforcement is on. The migration adds the stable
        // default id; the post-migration triggers enforce all references on both
        // local and HTTP connections without rebuilding historical tables.
        for (const table of [
          "slots",
          "availability_schedules",
          "bookings",
          "availability_blocks",
        ]) {
          const tableColumns =
            table === "slots"
              ? columns
              : await tx.execute(`PRAGMA table_info(${table})`);
          if (!tableColumns.rows.some((row) => row.name === "practitioner_id"))
            await tx.execute(
              `ALTER TABLE ${table} ADD COLUMN practitioner_id INTEGER ${table === "availability_blocks" ? "REFERENCES practitioners(id)" : "NOT NULL DEFAULT 1"}`,
            );
          if (
            table === "bookings" &&
            !tableColumns.rows.some((row) => row.name === "practitioner_name")
          )
            await tx.execute(
              "ALTER TABLE bookings ADD COLUMN practitioner_name TEXT NOT NULL DEFAULT 'Tibb.nu'",
            );
        }
        await tx.executeMultiple(SLOT_SCHEDULE_SCHEMA);
        const seeded = await tx.execute(
          "SELECT value FROM app_meta WHERE key='seeded'",
        );
        if (!seeded.rows.length) await this.seed(tx);
        await tx.execute({
          sql: "INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          args: [SCHEMA_VERSION_KEY, String(SCHEMA_VERSION)],
        });
        if (!this.remote)
          await tx.execute(`PRAGMA user_version=${SCHEMA_VERSION}`);
        await tx.commit();
      } catch (error) {
        try {
          await tx.rollback();
        } catch {}
        throw error;
      } finally {
        tx.close();
      }
    });
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = undefined;
      throw error;
    }
  }
  private async seed(tx: Transaction) {
    // Only new installations receive these public Slowlax facts. Existing
    // installations keep their content, settings and account history intact.
    await tx.execute({
      sql: "UPDATE settings SET site_name=?,email=?,location='',pay_on_site=0,stripe_enabled=0 WHERE id=1",
      args: ["Slowlax", "info@slowlax.se"],
    });
    await tx.execute("UPDATE practitioners SET name='Slowlax',active=0 WHERE id=1");
    const now = new Date().toISOString();
    for (const article of slowlaxArticles) {
      await tx.execute({
        sql: "INSERT INTO articles(title,slug,excerpt,body,published,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
        args: [article.title, article.slug, article.excerpt, article.body, article.publishedAt, article.publishedAt],
      });
    }
    await tx.execute({
      sql: "INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,0,1,?,?)",
      args: [
        "Bygg din egen Halal-pengamaskin",
        "bygg-din-egen-halal-pengamaskin",
        "En kurs från Slowlax.",
        now,
        now,
      ],
    });
    // The original lesson content requires a WordPress login and is not
    // available in Git. Do not invent lessons or promise unverified access.
    // The source's USD plan prices cannot be inserted into this SEK checkout.
    for (const [name, slug, description] of [
      ["Bas", "bas", "Communityuppdateringar från Slowlax."],
      ["Premium", "premium", "Alla tillgängliga kurser och exklusiva uppdateringar."],
    ]) {
      await tx.execute({
        sql: "INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES(?,?,?,0,?,?)",
        args: [name, slug, description, now, now],
      });
    }
    await tx.execute("INSERT INTO app_meta(key,value) VALUES('seeded','1')");
  }
  private async execute(sql: string, args: InValue[]): Promise<ResultSet> {
    const tx = context.getStore();
    if (tx) return tx.execute({ sql, args });
    await this.initialize();
    return this.gate(async () => (await this.client()).execute({ sql, args }));
  }
  prepare(sql: string) {
    return {
      get: async (...args: InValue[]): Promise<Row | undefined> =>
        (await this.execute(sql, args)).rows[0],
      all: async (...args: InValue[]): Promise<Row[]> =>
        (await this.execute(sql, args)).rows,
      run: async (...args: InValue[]) => {
        const result = await this.execute(sql, args);
        return {
          lastInsertRowid: result.lastInsertRowid,
          changes: result.rowsAffected,
        };
      },
    };
  }
  async exec(sql: string): Promise<void> {
    const tx = context.getStore();
    if (tx) {
      await tx.executeMultiple(sql);
      return;
    }
    await this.initialize();
    await this.gate(async () => {
      await (await this.client()).executeMultiple(sql);
    });
  }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (context.getStore()) return work();
    await this.initialize();
    return this.gate(async () => {
      const tx = await (await this.client()).transaction("write");
      try {
        const result = await context.run(tx, work);
        await tx.commit();
        return result;
      } catch (error) {
        try {
          await tx.rollback();
        } catch {}
        throw error;
      } finally {
        tx.close();
      }
    });
  }
  async close(): Promise<void> {
    if (this.clientPromise) (await this.clientPromise).close();
    this.clientPromise = undefined;
    this.readyPromise = undefined;
  }
}
let database: DatabaseAdapter | PostgresDatabaseAdapter | undefined;
let selectedProvider: ReturnType<typeof databaseProvider> | undefined;
export function getDb(): DatabaseAdapter | PostgresDatabaseAdapter {
  if (DEMO_MODE) throw new Error("The presentation demo has no database access.");
  if (!databaseConfigured()) throw new DatabaseConfigurationError();
  const provider = databaseProvider();
  // Next dev can reload environment variables without replacing this module.
  // Once the operator activates cutover, never keep using the old SQLite DB.
  if (database && selectedProvider !== provider) {
    const previous = database;
    database = undefined;
    void previous.close().catch(() => {});
  }
  selectedProvider = provider;
  return (database ??= provider === "postgres" ? new PostgresDatabaseAdapter() : new DatabaseAdapter());
}
export function transaction<T>(work: () => T | Promise<T>): Promise<T> {
  return getDb().transaction(work);
}
export async function initializeDatabase() {
  await getDb().initialize();
}
