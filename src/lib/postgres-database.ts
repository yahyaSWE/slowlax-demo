import { AsyncLocalStorage } from "node:async_hooks";
import type { InValue } from "@libsql/client";
import { POSTGRES_CERTIFICATE_SQL } from "./postgres-certificate-schema";
import { POSTGRES_FREE_MEMBERSHIP_SQL } from "./postgres-free-membership-schema";
import { POSTGRES_INITIAL_SCHEMA_SQL, POSTGRES_PURIFICATION_SQL, POSTGRES_IDENTITY_TABLES, POSTGRES_SCHEMA_VERSION } from "./postgres-purification-schema";
import { postgresSql } from "./postgres-sql";
import slowlaxArticles from "./slowlax-articles.json";

type Row = Record<string, unknown>;
export type PostgresQueryResult = { rows: Row[]; rowCount: number | null; fields?: { name: string; dataTypeID: number }[] };
export type PostgresConnection = { query(sql: string, args?: unknown[]): Promise<PostgresQueryResult>; release(error?: boolean | Error): void };
export type PostgresPool = { connect(): Promise<PostgresConnection>; end(): Promise<void> };
const context = new AsyncLocalStorage<{ owner: PostgresDatabaseAdapter; connection: PostgresConnection }>();

/** The app's existing write transactions are serialized by SQLite. Preserve
 * that guarantee across processes using one transaction-scoped advisory lock.
 * This intentionally favors correct access/payment updates over throughput.
 */
export class PostgresDatabaseAdapter {
  private poolPromise?: Promise<PostgresPool>;
  private readyPromise?: Promise<void>;
  constructor(private readonly connectionString = process.env.DATABASE_URL) {}
  private async pool(): Promise<PostgresPool> {
    this.poolPromise ??= (async () => {
      if (!this.connectionString) throw new Error("DATABASE_URL saknas.");
      const url = new URL(this.connectionString);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL måste vara en PostgreSQL-adress.");
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const mode = url.searchParams.get("sslmode");
      if (!loopback && ["disable", "no-verify", "prefer"].includes(mode ?? ""))
        throw new Error("PostgreSQL kräver verifierad TLS för externa anslutningar.");
      // Prevent pg-connection-string from overriding our verified TLS config.
      for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: url.toString(), max: 1,
        connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
        statement_timeout: 30000, query_timeout: 35000,
        ssl: loopback && (!mode || mode === "disable") ? false : {
          rejectUnauthorized: true,
          ...(process.env.SUPABASE_DB_CA_CERT ? { ca: process.env.SUPABASE_DB_CA_CERT.replace(/\\n/g, "\n") } : {}),
        },
      });
      // Idle connection errors must not become unhandled process exceptions.
      pool.on("error", () => { /* Failed clients are removed by pg; next request reconnects. */ });
      return pool;
    })();
    try { return await this.poolPromise; }
    catch (error) { this.poolPromise = undefined; throw error; }
  }
  private activeConnection() {
    const active = context.getStore();
    return active?.owner === this ? active.connection : undefined;
  }
  private async connectionTransaction<T>(work: (connection: PostgresConnection) => Promise<T>): Promise<T> {
    const active = this.activeConnection();
    if (active) return work(active);
    const connection = await (await this.pool()).connect();
    let discardConnection = false;
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock(1397509976,1)");
      await connection.query("SET LOCAL search_path=slowlax,pg_catalog");
      await connection.query("SET LOCAL TIME ZONE 'UTC'");
      const result = await context.run({ owner: this, connection }, () => work(connection));
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      try { await connection.query("ROLLBACK"); } catch { discardConnection = true; }
      throw error;
    } finally { connection.release(discardConnection); }
  }
  private async schemaVersion(connection: PostgresConnection): Promise<number | null> {
    const table = await connection.query("SELECT to_regclass('slowlax.app_meta') AS name");
    if (!table.rows[0]?.name) return null;
    const result = await connection.query("SELECT value FROM slowlax.app_meta WHERE key='postgres_schema_version'");
    const version = Number(result.rows[0]?.value);
    if (!Number.isInteger(version) || version < 1 || version > POSTGRES_SCHEMA_VERSION)
      throw new Error("PostgreSQL-schemat matchar inte appen. Kör de versionsstyrda databas-migreringarna före driftsättning.");
    return version;
  }
  async initialize(): Promise<void> {
    this.readyPromise ??= this.connectionTransaction(async connection => {
      const version = await this.schemaVersion(connection);
      if (version === null)
        throw new Error("PostgreSQL-schemat saknas. Kör npm run db:init med rätt DATABASE_URL före start.");
      if (version !== POSTGRES_SCHEMA_VERSION)
        throw new Error("PostgreSQL-schemat behöver uppgraderas. Kör npm run db:init före start.");
    });
    try { await this.readyPromise; }
    catch (error) { this.readyPromise = undefined; throw error; }
  }
  /** Explicit bootstrap only. Ordinary app requests never create remote tables. */
  async migrate(): Promise<void> {
    await this.connectionTransaction(async connection => {
      const version = await this.schemaVersion(connection);
      if (version === null) await connection.query(POSTGRES_INITIAL_SCHEMA_SQL);
      else {
        if (version === 1) await connection.query(POSTGRES_CERTIFICATE_SQL);
        if (version < 3) await connection.query(POSTGRES_FREE_MEMBERSHIP_SQL);
        if (version < 4) await connection.query(POSTGRES_PURIFICATION_SQL);
      }
      const seeded = await connection.query("SELECT value FROM app_meta WHERE key='seeded'");
      if (!seeded.rows.length) await this.seed(connection);
    });
    this.readyPromise = Promise.resolve();
  }
  private async seed(connection: PostgresConnection) {
    await connection.query("UPDATE settings SET site_name=$1,email=$2,location='',pay_on_site=0,stripe_enabled=0 WHERE id=1", ["Slowlax", "info@slowlax.se"]);
    const now = new Date().toISOString();
    for (const article of slowlaxArticles)
      await connection.query("INSERT INTO articles(title,slug,excerpt,body,published,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5)", [article.title, article.slug, article.excerpt, article.body, article.publishedAt]);
    await connection.query("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES($1,$2,$3,0,1,$4,$4)", ["Bygg din egen Halal-pengamaskin", "bygg-din-egen-halal-pengamaskin", "En kurs från Slowlax.", now]);
    for (const [name, slug, description] of [["Bas", "bas", "Communityuppdateringar från Slowlax."], ["Premium", "premium", "Alla tillgängliga kurser och exklusiva uppdateringar."]])
      await connection.query("INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES($1,$2,$3,0,$4,$4)", [name, slug, description, now]);
    await connection.query("INSERT INTO app_meta(key,value) VALUES('seeded','1')");
  }
  private async execute(input: string, args: InValue[], returnIdentity = false): Promise<PostgresQueryResult> {
    if (!this.activeConnection()) await this.initialize();
    let sql = postgresSql(input);
    const insert = sql.match(/^INSERT INTO\s+(\w+)\b/i);
    if (returnIdentity && insert && POSTGRES_IDENTITY_TABLES.has(insert[1]) && !/\bRETURNING\b/i.test(sql)) sql += " RETURNING id";
    const values = args.map(value => typeof value === "boolean" ? Number(value) : value instanceof Date ? value.toISOString() : value instanceof ArrayBuffer ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : value);
    const result = await this.connectionTransaction(connection => connection.query(sql, values));
    // node-postgres returns count(int8) as a string. Keep the app's SQLite row
    // contract without globally replacing pg parsers or losing large integers.
    for (const field of result.fields ?? []) if (field.dataTypeID === 20 || field.dataTypeID === 1700)
      for (const row of result.rows) if (typeof row[field.name] === "string" && Number.isSafeInteger(Number(row[field.name]))) row[field.name] = Number(row[field.name]);
    for (const row of result.rows) for (const key of Object.keys(row)) if (typeof row[key] === "boolean") row[key] = Number(row[key]);
    return result;
  }
  prepare(sql: string) {
    return {
      get: async (...args: InValue[]): Promise<Row | undefined> => (await this.execute(sql, args)).rows[0],
      all: async (...args: InValue[]): Promise<Row[]> => (await this.execute(sql, args)).rows,
      run: async (...args: InValue[]) => {
        const result = await this.execute(sql, args, true);
        const id = result.rows[0]?.id;
        return { lastInsertRowid: id === undefined ? undefined : BigInt(String(id)), changes: result.rowCount ?? 0 };
      },
    };
  }
  async exec(sql: string): Promise<void> {
    if (!this.activeConnection()) await this.initialize();
    await this.connectionTransaction(async connection => { await connection.query(postgresSql(sql)); });
  }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.activeConnection()) return work();
    await this.initialize();
    return this.connectionTransaction(async () => work());
  }
  async close(): Promise<void> {
    if (this.poolPromise) await (await this.poolPromise).end();
    this.poolPromise = undefined;
    this.readyPromise = undefined;
  }
}
