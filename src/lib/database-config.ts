export function postgresDatabaseConfigured(): boolean {
  const value = process.env.DATABASE_URL;
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const password = decodeURIComponent(parsed.password);
    return ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      !!parsed.hostname && !!parsed.username && !!password && !!parsed.pathname.slice(1) &&
      !/YOUR[-_ ]?PASSWORD|\[.*\]|<.*>/i.test(password) &&
      !(process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN);
  } catch { return false; }
}

export function databaseProvider(): "postgres" | "turso" | "sqlite" | "invalid" {
  // Credentials can be filled in before migration without cutting over a live
  // process. The operator explicitly switches providers only after validation.
  if (process.env.SUPABASE_DATABASE_ENABLED === "true")
    return postgresDatabaseConfigured() ? "postgres" : "invalid";
  if (process.env.SUPABASE_AUTH_ENABLED === "true") return "invalid";
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (url || token) {
    try {
      const parsed = new URL(url || "");
      return (
        !!token &&
        ["libsql:", "https:"].includes(parsed.protocol) &&
        !!parsed.hostname &&
        !parsed.username &&
        !parsed.password
      ) ? "turso" : "invalid";
    } catch {
      return "invalid";
    }
  }
  return process.env.VERCEL ? "invalid" : "sqlite";
}

export function databaseConfigured(): boolean {
  return databaseProvider() !== "invalid";
}
