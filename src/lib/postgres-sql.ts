/** Translate the small, explicit SQLite SQL dialect used by the application.
 * Values remain bound parameters. Never interpolate user values into SQL.
 */
export function postgresSql(input: string): string {
  let sql = input.trim().replace(/;$/, "");
  sql = sql.replace(/(\b(?:\w+\.)?\w+)\s*=\s*\?\s+COLLATE NOCASE\b/gi, "lower($1)=lower(?)")
    .replace(/(\b(?:\w+\.)?\w+)\s+COLLATE NOCASE\b/gi, "lower($1)")
    .replace(/MAX\(course_purchases\.revoked,excluded\.revoked\)/gi, "GREATEST(course_purchases.revoked,excluded.revoked)");
  const ignore = /^INSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/^INSERT OR IGNORE\b/i, "INSERT");
  if (/^INSERT OR REPLACE\b/i.test(sql))
    throw new Error("INSERT OR REPLACE kräver en uttrycklig PostgreSQL ON CONFLICT-regel.");
  if (ignore && !/\bON CONFLICT\b/i.test(sql)) sql += " ON CONFLICT DO NOTHING";
  // Do not replace question marks inside SQL string literals, identifiers,
  // comments or dollar-quoted PL/pgSQL. No persistent named prepares are used.
  let output = "", parameter = 0;
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$|\?/g;
  let position = 0;
  for (let match = tokens.exec(sql); match; match = tokens.exec(sql)) {
    output += sql.slice(position, match.index);
    if (match[0] === "?") output += `$${++parameter}`;
    else if (match[0].startsWith("$")) {
      const end = sql.indexOf(match[0], tokens.lastIndex);
      if (end < 0) throw new Error("Ogiltig SQL-sträng.");
      output += sql.slice(match.index, end + match[0].length);
      tokens.lastIndex = end + match[0].length;
    } else output += match[0];
    position = tokens.lastIndex;
  }
  return output + sql.slice(position);
}
