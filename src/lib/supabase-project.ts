/** Protect cutover tools from importing this site's data into another project.
 * Custom Auth domains cannot reveal a project reference and are validated by
 * the operator; standard Supabase domains must match the Postgres endpoint.
 */
export function matchesSupabaseDatabaseProject(projectUrl: string, databaseUrl: string): boolean {
  try {
    const project = new URL(projectUrl), database = new URL(databaseUrl);
    if (project.protocol !== "https:" || project.username || project.password || project.pathname !== "/" || project.search || project.hash || !["postgres:", "postgresql:"].includes(database.protocol)) return false;
    const reference = project.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1];
    if (!reference) return true;
    return database.hostname === `db.${reference}.supabase.co` ||
      (database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username).endsWith(`.${reference}`));
  } catch { return false; }
}
