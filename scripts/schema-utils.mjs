import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");

export function readMigrationSql() {
  if (!fs.existsSync(migrationsDir)) return { sql: "", fileCount: 0 };

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return {
    fileCount: files.length,
    sql: files.map((file) => fs.readFileSync(path.join(migrationsDir, file), "utf8")).join("\n"),
  };
}

function identifierPattern() {
  return String.raw`(?:(?:"([^"]+)")|([a-zA-Z_][a-zA-Z0-9_$]*))`;
}

function collectMatches(sql, regex) {
  const values = new Set();
  let match;

  while ((match = regex.exec(sql)) !== null) {
    const value = match[1] || match[2] || match[3] || match[4];
    if (value) values.add(value);
  }

  return values;
}

export function getExpectedObjects(sql) {
  const ident = identifierPattern();

  return {
    tables: collectMatches(sql, new RegExp(String.raw`\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.${ident}`, "gi")),
    enums: collectMatches(sql, new RegExp(String.raw`\bcreate\s+type\s+(?:if\s+not\s+exists\s+)?public\.${ident}\s+as\s+enum\b`, "gi")),
    rlsTables: collectMatches(sql, new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?public\.${ident}\s+enable\s+row\s+level\s+security\b`, "gi")),
    policyTables: collectMatches(sql, new RegExp(String.raw`\bcreate\s+policy\s+.+?\s+on\s+public\.${ident}\b`, "gis")),
  };
}

export function hasAnyExpected(expected) {
  return expected.tables.size || expected.enums.size || expected.rlsTables.size || expected.policyTables.size;
}
