/**
 * Phase 3.6.0 Workstream B smoke — indexer symbol-level chunking.
 *
 * Proves:
 *   - `scanProject` emits `chunkKind: "symbol"` rows with accurate line ranges
 *     for module-surface TS declarations and class methods.
 *   - `searchCodeChunks("identifier")` returns chunk-level hits with line
 *     ranges pointing at the symbol (not line 1 of the file).
 *   - Parse failures fall back to `chunkKind: "file"` without throwing.
 *   - `.tsx` files parse through the tsx grammar (JSX-aware).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../../services/indexer/src/file-scan.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-chunker-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  // --- Seed source files: one TS, one TSX, one unparseable ---
  writeFileSync(
    path.join(projectRoot, "src", "math.ts"),
    [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "",
      "export class Calculator {",
      "  multiply(a: number, b: number): number {",
      "    return a * b;",
      "  }",
      "}",
      "",
      "export const PI = 3.14159;",
      "",
      "export async function getUserByEmail(email: string) {",
      "  return email.toLowerCase();",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "button.tsx"),
    [
      "import React from 'react';",
      "",
      "export function Button(props: { label: string }) {",
      "  return <button>{props.label}</button>;",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "broken.ts"),
    "export function broken(\n",
  );
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "chunker-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    writeFileSync(
      path.join(projectRoot, "docs", `noise-${i}.md`),
      `add add add add add add add add add add ${i}\n`,
    );
  }

  try {
    const { snapshot, stats } = await scanProject(projectRoot, {
      name: "chunker-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });

    assert.ok(stats.files >= 3, `expected at least 3 scannable files; got ${stats.files}`);

    const mathFile = snapshot.files.find((f) => f.path.endsWith("math.ts"));
    assert.ok(mathFile, "math.ts must appear in the snapshot");

    const symbolChunks = mathFile.chunks.filter((c) => c.chunkKind === "symbol");
    assert.ok(
      symbolChunks.length >= 2,
      `expected multiple symbol chunks for math.ts; got ${symbolChunks.length}`,
    );

    const addChunk = symbolChunks.find((c) => c.name === "add");
    assert.ok(addChunk, "expected a symbol chunk named 'add'");
    assert.equal(addChunk.lineStart, 1, "'add' should start at line 1");
    assert.equal(addChunk.lineEnd, 3, "'add' should end at line 3");

    const calcChunk = symbolChunks.find((c) => c.name === "Calculator");
    assert.ok(calcChunk, "expected a symbol chunk named 'Calculator'");
    assert.ok(calcChunk.lineStart && calcChunk.lineEnd && calcChunk.lineEnd > calcChunk.lineStart, "'Calculator' should span multiple lines");
    const multiplyChunk = symbolChunks.find((c) => c.name === "Calculator.multiply");
    assert.ok(multiplyChunk, "expected a symbol chunk for the Calculator.multiply method");
    assert.equal(multiplyChunk.lineStart, 6, "Calculator.multiply should start at line 6");
    assert.equal(multiplyChunk.lineEnd, 8, "Calculator.multiply should end at line 8");

    const tsxFile = snapshot.files.find((f) => f.path.endsWith("button.tsx"));
    assert.ok(tsxFile, "button.tsx must appear in the snapshot");
    const tsxSymbolChunks = tsxFile.chunks.filter((c) => c.chunkKind === "symbol");
    assert.ok(
      tsxSymbolChunks.some((c) => c.name === "Button"),
      "tsx grammar must emit 'Button' component symbol chunk",
    );

    const brokenFile = snapshot.files.find((f) => f.path.endsWith("broken.ts"));
    assert.ok(brokenFile, "broken.ts must appear in the snapshot");
    const fileChunk = brokenFile.chunks.find((c) => c.chunkKind === "file");
    assert.ok(fileChunk, "parse failures must still emit a file-level fallback chunk");

    // --- Now persist snapshot + verify searchCodeChunks returns line ranges ---
    const store = openProjectStore({ projectRoot });
    try {
      store.saveProjectProfile({
        name: "chunker-smoke",
        rootPath: projectRoot,
        framework: "unknown",
        orm: "unknown",
        srcRoot: "src",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "best_effort",
        detectedAt: new Date().toISOString(),
      });
      store.replaceIndexSnapshot(snapshot);

      const hits = store.searchCodeChunks("Calculator", { limit: 10 });
      assert.ok(hits.length > 0, "searchCodeChunks('Calculator') must return at least one hit");
      const symbolHit = hits.find((h) => h.chunkKind === "symbol" && h.name === "Calculator");
      assert.ok(symbolHit, "expected a symbol-kind hit for 'Calculator'");
      assert.ok(
        symbolHit.lineStart! > 1 && symbolHit.lineEnd! > symbolHit.lineStart!,
        `expected symbol hit with a real line range; got ${symbolHit.lineStart}-${symbolHit.lineEnd}`,
      );

      const symbolOnly = store.searchCodeChunks("add", { symbolOnly: true });
      assert.ok(
        symbolOnly.every((h) => h.chunkKind === "symbol"),
        "symbolOnly=true must filter out file-level hits",
      );
      const symbolOnlyLimited = store.searchCodeChunks("add", { limit: 1, symbolOnly: true });
      assert.equal(
        symbolOnlyLimited.length,
        1,
        "symbolOnly=true should still return a symbol hit when file-level chunks are noisier",
      );
      assert.equal(symbolOnlyLimited[0]!.chunkKind, "symbol");

      const methodHits = store.searchCodeChunks("multiply", {
        symbolOnly: true,
        limit: 10,
      });
      assert.ok(
        methodHits.some((hit) => hit.name === "Calculator.multiply"),
        "symbol search should return nested class methods",
      );

      const camelCaseHits = store.searchCodeChunks("get user by email", {
        symbolOnly: true,
        limit: 10,
      });
      assert.ok(
        camelCaseHits.some((h) => h.name === "getUserByEmail"),
        "natural-language lookup should find camelCase symbol names",
      );
    } finally {
      store.close();
    }

    console.log("indexer-symbol-chunking: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
