import { PGlite } from "@electric-sql/pglite";
import type { PostgresConnection, PostgresPool, PostgresQueryResult } from "../../src/lib/postgres-database";
import { PostgresDatabaseAdapter } from "../../src/lib/postgres-database";

/** Real PostgreSQL engine, in process and without a network endpoint. Match
 * pg.Pool max:1 so independent app transactions cannot share one connection.
 */
export async function pglitePostgres(adapter = new PostgresDatabaseAdapter("postgres://test:test@localhost/test")) {
  const engine = new PGlite();
  let tail: Promise<void> = Promise.resolve();
  const pool: PostgresPool = {
    connect: async () => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const connection: PostgresConnection = {
        query: async (sql, args): Promise<PostgresQueryResult> => {
          const result = args === undefined ? (await engine.exec(sql)).at(-1)! : await engine.query(sql, args);
          return { rows: result.rows as Record<string, unknown>[], fields: result.fields,
            rowCount: result.affectedRows || result.rows.length };
        },
        release,
      };
      return connection;
    },
    end: async () => { await tail; await engine.close(); },
  };
  Object.assign(adapter, { poolPromise: Promise.resolve(pool) });
  return { adapter, engine };
}
