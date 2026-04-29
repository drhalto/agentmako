#!/usr/bin/env node

// Phase 3.2.1 publish guard. Runs as part of `prepublishOnly` to make sure
// the bundled `dist/index.js` is a valid shippable artifact before npm allows
// the publish to proceed.
//
// Checks:
//   1. `dist/index.js` exists
//   2. `dist/index.d.ts` and `dist/index.d.ts.map` exist
//   3. The first line is the Node shebang (so the bin entry is executable)
//   4. The bundle has no remaining `@mako-ai/*` imports — workspace packages
//      are private and would fail to resolve on a clean install
//
// Any failure exits non-zero, which blocks `npm publish`.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const distPath = path.resolve(distDir, "index.js");
const distTypesPath = path.resolve(distDir, "index.d.ts");
const distTypesMapPath = path.resolve(distDir, "index.d.ts.map");
const dashboardIndexPath = path.resolve(distDir, "web", "index.html");
const wasmAssets = [
  "tree-sitter.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
].map((fileName) => path.resolve(distDir, fileName));

function fail(message) {
  console.error(`prepublish: ${message}`);
  process.exit(1);
}

if (!existsSync(distPath)) {
  fail(`missing ${distPath}. Run \`tsup\` before publish.`);
}

if (!existsSync(distTypesPath)) {
  fail(`missing ${distTypesPath}. Run \`npm run build:types\` before publish.`);
}

if (!existsSync(distTypesMapPath)) {
  fail(`missing ${distTypesMapPath}. Run \`npm run build:types\` before publish.`);
}

for (const wasmPath of wasmAssets) {
  if (!existsSync(wasmPath)) {
    fail(`missing ${wasmPath}. Run \`npm run build\` so the chunker wasm assets are copied into dist/.`);
  }
}

if (!existsSync(dashboardIndexPath)) {
  fail(
    `missing ${dashboardIndexPath}. Run \`corepack pnpm --filter @mako-ai/web run build\` before \`npm run build\`.`,
  );
}

const content = readFileSync(distPath, "utf8");

const firstLine = content.split("\n", 1)[0];
if (firstLine !== "#!/usr/bin/env node") {
  fail(`first line of ${distPath} is not a node shebang — got: ${JSON.stringify(firstLine)}`);
}

const importLikePattern =
  /(?:from\s+["'](?<fromSpec>[^"']+)["']|require\s*\(\s*["'](?<reqSpec>[^"']+)["']|import\s*\(\s*["'](?<dynSpec>[^"']+)["'])/g;

const offenders = new Set();
for (const match of content.matchAll(importLikePattern)) {
  const spec = match.groups?.fromSpec ?? match.groups?.reqSpec ?? match.groups?.dynSpec;
  if (!spec) {
    continue;
  }
  if (spec.startsWith("@mako-ai/")) {
    offenders.add(spec);
  }
}

if (offenders.size > 0) {
  const list = [...offenders].sort().join(", ");
  fail(`bundle still references unresolved @mako-ai/* modules: ${list}`);
}

console.log(
  `prepublish: bundle, wasm assets, and dashboard assets look good (${content.length} bytes, no @mako-ai/* references).`,
);
