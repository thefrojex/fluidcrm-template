import fs from "node:fs";
import path from "node:path";

if (process.env.BASE44_VERIFY_WIRED_APP !== "1") {
  process.exit(0);
}

const root = process.cwd();
const forbidden = [
  "Hello, this app is ready to be built",
  "Starter template",
  "app is ready to be built",
];

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function collectFiles(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFiles(fullPath, predicate, files);
    } else if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function assertNoForbiddenText(label, content) {
  for (const text of forbidden) {
    if (content.includes(text)) {
      throw new Error(`${label} still contains starter placeholder text: ${text}`);
    }
  }
}

const appSource = readIfExists(path.join(root, "src", "App.tsx"));
const mainSource = readIfExists(path.join(root, "src", "main.tsx"));

if (!appSource) {
  throw new Error("src/App.tsx is missing; cannot verify the rendered app entry point.");
}

if (!mainSource.includes("./App") && !mainSource.includes("/App")) {
  throw new Error("src/main.tsx does not appear to render src/App.tsx; verify the app entry point is wired correctly.");
}

assertNoForbiddenText("src/App.tsx", appSource);

const jsFiles = collectFiles(path.join(root, "dist", "assets"), (filePath) => filePath.endsWith(".js"));
if (jsFiles.length === 0) {
  throw new Error("No built JavaScript bundle found in dist/assets; run the Vite build before wiring verification.");
}

const bundle = jsFiles.map((filePath) => readIfExists(filePath)).join("\n");
assertNoForbiddenText("built JavaScript bundle", bundle);

console.log("Verified app wiring: starter placeholder is absent from src/App.tsx and the built bundle.");
