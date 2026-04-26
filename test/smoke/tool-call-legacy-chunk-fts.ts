/**
 * Regression smoke — legacy chunk-search backfill must not break tool calls.
 *
 * Reproduces the exact user-facing failure:
 *   - a project DB has 0014 applied, but its `chunks_*` FTS triggers still use
 *     the old FTS5 `'delete'` command form
 *   - one or more `chunks.search_text` rows are NULL, so opening the store runs
 *     `backfillChunkSearchTextImpl(...)`
 *   - the legacy trigger body makes that backfill fail with `SQL logic error`,
 *     which prevents every tool call from booting
 *
 * The fixed startup path should:
 *   - drop/recreate the trigger definitions
 *   - backfill `search_text`
 *   - bulk-rebuild `chunks_fts`
 *   - let a real tool call succeed
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { normalizePath, openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { cleanupSmokeStateDir, rmSyncRetry } from "./state-cleanup.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-legacy-chunks-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const normalizedProjectRoot = normalizePath(projectRoot);
  const stateDirName = `.mako-ai-legacy-chunks-${process.pid}`;
  const projectStateDir = path.join(projectRoot, stateDirName);
  const dbPath = path.join(projectRoot, stateDirName, "project.db");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  process.env.MAKO_STATE_DIRNAME = stateDirName;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "legacy-chunk-fts-smoke", version: "0.0.0" }),
  );

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId: "project_legacy_chunks_smoke",
      displayName: "legacy-chunk-fts-smoke",
      canonicalPath: normalizedProjectRoot,
      lastSeenPath: normalizedProjectRoot,
      supportTarget: "best_effort",
    });

    const store = openProjectStore({ projectRoot, stateDirName });
    try {
      store.saveProjectProfile({
        name: "legacy-chunk-fts-smoke",
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

      store.replaceIndexSnapshot({
        files: [
          {
            path: "src/users-service.ts",
            sha256: "legacy-search-text",
            language: "typescript",
            sizeBytes: 96,
            lineCount: 3,
            chunks: [
              {
                chunkKind: "file",
                name: "src/users-service.ts",
                lineStart: 1,
                lineEnd: 3,
                content:
                  "export async function loadUsers() {\n  return supabase.from('users').select('*');\n}",
              },
            ],
            symbols: [
              {
                name: "loadUsers",
                kind: "function",
                exportName: "loadUsers",
                lineStart: 1,
                lineEnd: 3,
                signatureText: "export async function loadUsers()",
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
    } finally {
      store.close();
    }

    // Simulate a pre-fix database:
    //   - `search_text` never backfilled
    //   - chunks_fts empty
    //   - update/delete triggers still use the broken FTS5 "delete" command
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS chunks_ai;
        DROP TRIGGER IF EXISTS chunks_ad;
        DROP TRIGGER IF EXISTS chunks_au;

        UPDATE chunks
        SET search_text = NULL;

        DELETE FROM chunks_fts;

        CREATE TRIGGER chunks_ai
        AFTER INSERT ON chunks
        FOR EACH ROW
        BEGIN
          INSERT INTO chunks_fts(rowid, content, path, name, search_text)
          VALUES (
            NEW.chunk_id,
            NEW.content,
            (SELECT path FROM files WHERE file_id = NEW.file_id),
            COALESCE(NEW.name, ''),
            COALESCE(NEW.search_text, '')
          );
        END;

        CREATE TRIGGER chunks_ad
        AFTER DELETE ON chunks
        FOR EACH ROW
        BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, content, path, name, search_text)
          VALUES (
            'delete',
            OLD.chunk_id,
            OLD.content,
            (SELECT path FROM files WHERE file_id = OLD.file_id),
            COALESCE(OLD.name, ''),
            COALESCE(OLD.search_text, '')
          );
        END;

        CREATE TRIGGER chunks_au
        AFTER UPDATE ON chunks
        FOR EACH ROW
        BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, content, path, name, search_text)
          VALUES (
            'delete',
            OLD.chunk_id,
            OLD.content,
            (SELECT path FROM files WHERE file_id = OLD.file_id),
            COALESCE(OLD.name, ''),
            COALESCE(OLD.search_text, '')
          );

          INSERT INTO chunks_fts(rowid, content, path, name, search_text)
          VALUES (
            NEW.chunk_id,
            NEW.content,
            (SELECT path FROM files WHERE file_id = NEW.file_id),
            COALESCE(NEW.name, ''),
            COALESCE(NEW.search_text, '')
          );
        END;
      `);
    } finally {
      db.close();
    }

    const output = (await invokeTool("cross_search", {
      projectRef: normalizedProjectRoot,
      term: "load users",
    }, {
      sharedGlobalStore: globalStore,
    })) as {
      toolName: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; content: string }>;
        };
      };
    };

    assert.equal(output.toolName, "cross_search");
    assert.ok(
      output.result.packet.evidence.some(
        (block) => block.kind === "trace" && block.content.includes("loadUsers"),
      ),
      "expected a trace evidence block after repairing the legacy DB",
    );

    const repaired = new DatabaseSync(dbPath);
    try {
      const nullSearchText = repaired
        .prepare(`SELECT COUNT(*) AS value FROM chunks WHERE search_text IS NULL`)
        .get() as { value: number };
      const ftsRows = repaired
        .prepare(`SELECT COUNT(*) AS value FROM chunks_fts`)
        .get() as { value: number };
      const triggers = repaired
        .prepare(`
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'trigger' AND name IN ('chunks_ad', 'chunks_au')
          ORDER BY name
        `)
        .all() as Array<{ name: string; sql: string }>;

      assert.equal(nullSearchText.value, 0, "search_text backfill should repair every chunk row");
      assert.equal(ftsRows.value, 1, "chunks_fts should be rebuilt during legacy-db repair");
      for (const trigger of triggers) {
        assert.match(trigger.sql, /DELETE FROM chunks_fts/i, `${trigger.name} should use rowid delete`);
        assert.doesNotMatch(
          trigger.sql,
          /INSERT INTO chunks_fts\(chunks_fts,/i,
          `${trigger.name} must not use the broken FTS5 delete command`,
        );
      }
    } finally {
      repaired.close();
    }

    console.log("tool-call-legacy-chunk-fts: PASS");
  } finally {
    globalStore.close();
    cleanupSmokeStateDir(projectStateDir);
    try {
      rmSyncRetry(tmp);
    } catch (error: unknown) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "path" in error &&
        typeof (error as NodeJS.ErrnoException).path === "string" &&
        (error as NodeJS.ErrnoException).path!.startsWith(projectStateDir)
      ) {
        return;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
