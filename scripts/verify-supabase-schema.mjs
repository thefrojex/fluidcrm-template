import { spawnSync } from "node:child_process";
import { getExpectedObjects, hasAnyExpected, readMigrationSql } from "./schema-utils.mjs";

function runPsql(sql) {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!projectRef || !dbPassword) {
    return { skipped: true, rows: [] };
  }

  const result = spawnSync(
    "psql",
    ["-h", `db.${projectRef}.supabase.co`, "-p", "5432", "-U", "postgres", "-d", "postgres", "-AtX", "-F", "\t", "-c", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: dbPassword },
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error("Unable to verify Supabase schema: psql query failed. Check project database connectivity and credentials.");
  }

  return {
    skipped: false,
    rows: result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")),
  };
}

function setFromRows(rows, index = 0) {
  return new Set(rows.map((row) => row[index]).filter(Boolean));
}

const { sql, fileCount } = readMigrationSql();
const expected = getExpectedObjects(sql);

if (!hasAnyExpected(expected)) {
  if (fileCount === 0) {
    console.log("Supabase schema verification skipped: no migration files found.");
    process.exit(0);
  }

  console.error("Supabase schema verification failed: migration files exist, but no schema objects were found. Do not leave empty/no-op migration files.");
  process.exit(1);
}

const tableResult = runPsql("select table_name from information_schema.tables where table_schema = 'public';");

if (tableResult.skipped) {
  console.log("Supabase schema verification skipped: database connection env is not available.");
  process.exit(0);
}

const typeResult = runPsql("select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e';");
const rlsResult = runPsql("select tablename, rowsecurity::text from pg_tables where schemaname = 'public';");
const policyResult = runPsql("select tablename, count(*)::text from pg_policies where schemaname = 'public' group by tablename;");

const actualTables = setFromRows(tableResult.rows);
const actualEnums = setFromRows(typeResult.rows);
const rlsEnabled = new Set(rlsResult.rows.filter((row) => row[1] === "true").map((row) => row[0]));
const policyCounts = new Map(policyResult.rows.map((row) => [row[0], Number(row[1] || 0)]));
const failures = [];

for (const table of expected.tables) {
  if (!actualTables.has(table)) failures.push(`MISSING: table '${table}' not found in database`);
}

for (const enumName of expected.enums) {
  if (!actualEnums.has(enumName)) failures.push(`MISSING: enum type '${enumName}' not found in database`);
}

for (const table of expected.rlsTables) {
  if (!rlsEnabled.has(table)) failures.push(`MISSING: RLS is not enabled on table '${table}'`);
}

for (const table of expected.policyTables) {
  if ((policyCounts.get(table) || 0) < 1) failures.push(`MISSING: policy on table '${table}' not found in database`);
}

if (failures.length) {
  console.error("Supabase schema verification failed.");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(
  `Supabase schema verification passed: ${expected.tables.size}/${expected.tables.size} tables found, ${expected.enums.size}/${expected.enums.size} enum types found, RLS enabled on ${expected.rlsTables.size}/${expected.rlsTables.size}, policies found for ${expected.policyTables.size}/${expected.policyTables.size} tables.`,
);
