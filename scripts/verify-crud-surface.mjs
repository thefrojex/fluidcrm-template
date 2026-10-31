import fs from "node:fs";
import path from "node:path";
import { getExpectedObjects, readMigrationSql } from "./schema-utils.mjs";

const root = process.cwd();
const srcDir = path.join(root, "src");

function collectSourceFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFromOperation(content, table, operation) {
  const escaped = escapeRegExp(table);
  return new RegExp(String.raw`\.from\(\s*['"]${escaped}['"]\s*\)[\s\S]{0,240}\.${operation}\s*\(`).test(content);
}

function inspectTable(table, files) {
  const tableFiles = files
    .map((filePath) => ({ filePath, content: fs.readFileSync(filePath, "utf8") }))
    .filter(({ content }) => content.includes(table));
  const combined = tableFiles.map(({ content }) => content).join("\n");

  // Heuristic only: this intentionally over-flags missing CRUD surfaces so OpenCode retries rather than silently shipping thin UI.
  return {
    table,
    read: hasFromOperation(combined, table, "select") || (combined.includes("useQuery") && combined.includes(table)),
    create: hasFromOperation(combined, table, "insert"),
    update: hasFromOperation(combined, table, "update") || hasFromOperation(combined, table, "upsert"),
    delete: hasFromOperation(combined, table, "delete"),
    form: tableFiles.some(({ content }) => /<form\b|<Dialog\b|DialogContent|<Sheet\b|SheetContent/.test(content)),
  };
}

function mark(value) {
  return value ? "✓" : "✗";
}

const { sql } = readMigrationSql();
const expected = getExpectedObjects(sql);
const tables = Array.from(expected.tables).sort();

if (tables.length === 0) {
  console.log("CRUD surface verification skipped: no tables found in migrations.");
  process.exit(0);
}

const files = collectSourceFiles(srcDir);
const results = tables.map((table) => inspectTable(table, files));
const failures = results.filter((result) => !result.read || !result.create);
const warnings = results.filter((result) => !result.update || !result.delete || !result.form);

console.log("CRUD surface verification summary:");
for (const result of results) {
  console.log(
    `${result.table}: read ${mark(result.read)} create ${mark(result.create)} update ${mark(result.update)} delete ${mark(result.delete)} form/dialog ${mark(result.form)}`,
  );
}

if (warnings.length) {
  console.log("CRUD surface warnings (non-blocking for this version):");
  for (const result of warnings) {
    const missing = [];
    if (!result.update) missing.push("update");
    if (!result.delete) missing.push("delete");
    if (!result.form) missing.push("form/dialog");
    console.log(`${result.table}: missing ${missing.join(", ")}`);
  }
}

if (failures.length) {
  console.error("CRUD surface verification failed: missing required read/create coverage.");
  for (const result of failures) {
    const missing = [];
    if (!result.read) missing.push("read/list");
    if (!result.create) missing.push("create/insert");
    console.error(`${result.table}: missing ${missing.join(", ")}`);
  }
  process.exit(1);
}

console.log("CRUD surface verification passed: every table has read and create coverage. Update/delete/form gaps, if any, are warnings only.");
