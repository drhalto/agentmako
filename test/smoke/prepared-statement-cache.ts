import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProjectStore, type ProjectStore } from "../../packages/store/src/index.ts";

interface PreparedCacheProbe {
  prepared(sql: string): unknown;
  preparedStatements: Map<string, unknown>;
}

function cacheProbe(store: ProjectStore): PreparedCacheProbe {
  return store as unknown as PreparedCacheProbe;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-prepared-statement-cache-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  const fileBody = [
    "export function loadEvents() {",
    "  return [];",
    "}",
  ].join("\n");
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "prepared-statement-cache-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "src", "events.ts"), fileBody);

  const store = openProjectStore({ projectRoot });
  const probe = cacheProbe(store);
  let closed = false;

  try {
    assert.equal(probe.preparedStatements.size, 0, "constructor/backfills must not populate the per-store statement cache");

    const directSql = "SELECT 1 AS value";
    const directA = probe.prepared(directSql);
    const directB = probe.prepared(directSql);
    assert.equal(directA, directB, "same SQL string should return the same StatementSync object");
    assert.equal(probe.preparedStatements.size, 1, "same SQL should add one cached statement");

    probe.prepared("SELECT 2 AS value");
    assert.equal(probe.preparedStatements.size, 2, "distinct SQL should add one cached statement each");

    store.replaceIndexSnapshot({
      files: [
        {
          path: "src/events.ts",
          sha256: "events",
          language: "typescript",
          sizeBytes: fileBody.length,
          lineCount: fileBody.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "src/events.ts",
              lineStart: 1,
              lineEnd: fileBody.split("\n").length,
              content: fileBody,
            },
          ],
          symbols: [
            {
              name: "loadEvents",
              kind: "function",
              exportName: "loadEvents",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export function loadEvents()",
            },
          ],
          imports: [],
          routes: [
            {
              routeKey: "GET /events",
              framework: "nextjs-app-router",
              pattern: "/events",
              method: "GET",
              handlerName: "GET",
              isApi: true,
            },
          ],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });

    const afterSeedSize = probe.preparedStatements.size;

    assert.equal(store.listFiles().length, 1);
    assert.equal(store.listFiles().length, 1);
    assert.equal(probe.preparedStatements.size, afterSeedSize + 1, "listFiles should prepare once across repeated calls");

    assert.equal(store.getFileContent("src/events.ts"), fileBody);
    assert.equal(store.getFileContent("src/events.ts"), fileBody);
    assert.equal(probe.preparedStatements.size, afterSeedSize + 2, "getFileContent should prepare once across repeated calls");

    assert.equal(store.findFile("src/events.ts")?.path, "src/events.ts");
    assert.equal(store.findFile("events.ts")?.path, "src/events.ts");
    assert.equal(probe.preparedStatements.size, afterSeedSize + 3, "findFile should prepare once across repeated calls");

    assert.deepEqual(store.listRoutes().map((route) => route.routeKey), ["GET /events"]);
    assert.deepEqual(store.listRoutes().map((route) => route.routeKey), ["GET /events"]);
    assert.equal(probe.preparedStatements.size, afterSeedSize + 4, "listRoutes should prepare once across repeated calls");

    assert.deepEqual(store.listSymbolsForFile("src/events.ts").map((symbol) => symbol.name), ["loadEvents"]);
    assert.deepEqual(store.listSymbolsForFile("src/events.ts").map((symbol) => symbol.name), ["loadEvents"]);
    assert.equal(probe.preparedStatements.size, afterSeedSize + 5, "listSymbolsForFile should prepare once across repeated calls");

    store.close();
    closed = true;
    assert.equal(probe.preparedStatements.size, 0, "close should clear cached statements before closing the db");

    console.log("prepared-statement-cache: PASS");
  } finally {
    try {
      if (!closed) {
        store.close();
      }
    } catch {
      // Best-effort cleanup after assertion failures.
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
