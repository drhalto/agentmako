import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openProjectStore } from "../../packages/store/src/index.ts";
import type { IndexedFileRecord } from "../../packages/store/src/types.ts";

function fileRecord(filePath: string, content: string): IndexedFileRecord {
  const indexedContent = `${content}\n`;
  return {
    path: filePath,
    sha256: filePath,
    language: "typescript",
    sizeBytes: Buffer.byteLength(indexedContent),
    lineCount: indexedContent.split("\n").length,
    chunks: [{
      chunkKind: "file",
      name: filePath,
      lineStart: 1,
      lineEnd: content.split("\n").length,
      content,
    }],
    symbols: [],
    imports: [],
    routes: [],
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-search-files-fts-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "search-files-fts-smoke" }));

  const files: IndexedFileRecord[] = [];
  for (let index = 0; index < 500; index += 1) {
    files.push(fileRecord(
      `src/filler-${index}.ts`,
      [
        `export const filler${index} = ${index};`,
        "export function ordinaryUtility() { return 'common boring content'; }",
      ].join("\n"),
    ));
  }
  files.push(fileRecord(
    "src/content-target.ts",
    "export const target = 'ultrararecontenttoken';",
  ));
  files.push(fileRecord(
    "src/path-only-match.ts",
    "export const pathOnly = true;",
  ));

  const store = openProjectStore({ projectRoot });
  try {
    store.replaceIndexSnapshot({
      files,
      schemaObjects: [],
      schemaUsages: [],
    });

    const ftsBackedHits = store.searchFiles("ultrararecontenttoken", 5);
    assert.ok(
      ftsBackedHits.some((hit) => hit.path === "src/content-target.ts"),
      "content-only search should find files through chunks_fts",
    );

    store.db.exec("DELETE FROM chunks_fts");

    const contentHitsWithoutFts = store.searchFiles("ultrararecontenttoken", 5);
    assert.equal(
      contentHitsWithoutFts.some((hit) => hit.path === "src/content-target.ts"),
      false,
      "content-only search must not fall back to scanning chunks.content with LIKE",
    );

    const pathHitsWithoutFts = store.searchFiles("path-only-match", 5);
    assert.ok(
      pathHitsWithoutFts.some((hit) => hit.path === "src/path-only-match.ts"),
      "path LIKE matches should still work when chunks_fts is empty",
    );

    const started = performance.now();
    for (let index = 0; index < 50; index += 1) {
      store.searchFiles(`definitely-missing-${index}`, 5);
    }
    const durationMs = performance.now() - started;
    assert.ok(
      durationMs < 500,
      `path-only direct search should stay fast without chunk-content LIKE scans; got ${durationMs.toFixed(1)}ms`,
    );

    console.log("search-files-fts: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
