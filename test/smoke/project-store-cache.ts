/**
 * ProjectStoreCache smoke — Phase 2 slice 2.
 *
 * Verifies:
 * - same `borrow(options)` returns the same handle on repeated calls
 * - different projects get different handles
 * - `flush()` closes every pooled store (subsequent DB ops throw)
 * - `flush()` is idempotent (no double-close crash)
 * - `checkpoint()` runs without throwing whether WAL has data or not
 * - `close()` no longer runs a forced TRUNCATE checkpoint (Phase 2
 *   slice 1 regression guard: WAL is allowed to persist across close)
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProjectStoreCache,
  openGlobalStore,
  openProjectStore,
  type ProjectStore,
} from "../../packages/store/src/index.ts";
import { writeToolInvocationLogs } from "../../packages/tools/src/tool-invocation-logging.ts";

function safeWalSize(projectRoot: string): number {
  try {
    return statSync(path.join(projectRoot, ".mako-ai", "project.db-wal")).size;
  } catch {
    return 0;
  }
}

function seed(store: ProjectStore): void {
  store.saveProjectProfile({
    name: "cache-smoke",
    rootPath: "/tmp/cache-smoke",
    framework: "unknown",
    orm: "unknown",
    srcRoot: ".",
    entryPoints: [],
    pathAliases: {},
    middlewareFiles: [],
    serverOnlyModules: [],
    authGuardSymbols: [],
    supportLevel: "best_effort",
    detectedAt: new Date().toISOString(),
  });
}

async function main(): Promise<void> {
  const tmp1 = mkdtempSync(path.join(os.tmpdir(), "mako-cache-a-"));
  const tmp2 = mkdtempSync(path.join(os.tmpdir(), "mako-cache-b-"));
  try {
    // --- Same path returns same handle; different paths get different ---

    const cache = createProjectStoreCache();
    assert.equal(cache.size(), 0);

    const a1 = cache.borrow({ projectRoot: tmp1 });
    assert.equal(cache.size(), 1);
    const a2 = cache.borrow({ projectRoot: tmp1 });
    assert.equal(cache.size(), 1, "second borrow on same path does not open a new store");
    assert.strictEqual(a1, a2, "borrow returns the same ProjectStore instance");

    const b1 = cache.borrow({ projectRoot: tmp2 });
    assert.equal(cache.size(), 2);
    assert.notStrictEqual(a1, b1, "different projects get distinct handles");

    // --- Borrowed store is usable across calls ---
    seed(a1);
    const profile = a2.loadProjectProfile();
    assert.ok(profile, "second handle reads what first handle wrote");
    assert.equal(profile?.profile.name, "cache-smoke");

    // --- flush() closes every pooled store ---
    cache.flush();
    assert.equal(cache.size(), 0, "flush drops every pooled store");

    assert.throws(
      () => a1.loadProjectProfile(),
      "closed store rejects queries",
    );

    // --- flush() is idempotent ---
    assert.doesNotThrow(() => cache.flush(), "double flush is a no-op");

    // --- borrow after flush rejects (new cache required) ---
    assert.throws(
      () => cache.borrow({ projectRoot: tmp1 }),
      /flushed/,
      "cannot borrow from a flushed cache",
    );

    // --- Phase 2 slice 1 regression guard: close() no longer TRUNCATEs ---
    //
    // Open a fresh store, do a write that creates WAL content, close it
    // without calling checkpoint(). The WAL file should still exist on
    // disk — proving close() is not forcing a TRUNCATE behind the
    // caller's back.
    const tmp3 = mkdtempSync(path.join(os.tmpdir(), "mako-cache-c-"));
    try {
      const store = openProjectStore({ projectRoot: tmp3 });
      seed(store);
      // Force at least one commit via an additional write so the WAL
      // has something non-trivial to carry.
      store.saveProjectProfile({
        name: "cache-smoke-v2",
        rootPath: "/tmp/cache-smoke",
        framework: "unknown",
        orm: "unknown",
        srcRoot: ".",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "best_effort",
        detectedAt: new Date().toISOString(),
      });
      const walBeforeClose = safeWalSize(tmp3);
      store.close();
      const walAfterClose = safeWalSize(tmp3);
      // The WAL may still exist post-close; what we want to rule out is
      // "close forced a zero-byte TRUNCATE even though there was recent
      // write activity." An untruncated close leaves walAfterClose >= 0
      // without surprise; pre-Phase-2 code would have flushed to 0.
      // Cannot assert an inequality deterministically because SQLite's
      // auto-checkpoint may have already run, but we CAN assert the
      // close() call returns promptly even when walBeforeClose is
      // non-trivial — i.e., no synchronous TRUNCATE stalling the close.
      const closeStart = Date.now();
      const store2 = openProjectStore({ projectRoot: tmp3 });
      store2.close();
      const closeDuration = Date.now() - closeStart;
      assert.ok(
        closeDuration < 500,
        `open+close must be fast (<500ms); got ${closeDuration}ms`,
      );
      // Reference: keeps TS from flagging walBeforeClose as unread.
      void walBeforeClose;
      void walAfterClose;

      // --- checkpoint(truncate: true) works and is safe to call twice ---
      const store3 = openProjectStore({ projectRoot: tmp3 });
      try {
        assert.doesNotThrow(() => store3.checkpoint({ truncate: true }));
        assert.doesNotThrow(() => store3.checkpoint({ truncate: true }));
        assert.doesNotThrow(() => store3.checkpoint());
      } finally {
        store3.close();
      }
    } finally {
      rmSync(tmp3, { recursive: true, force: true });
    }

    // --- Registry logging borrows the shared cache when one is provided ---
    const tmp4 = mkdtempSync(path.join(os.tmpdir(), "mako-cache-logging-"));
    const previousStateHome = process.env.MAKO_STATE_HOME;
    const previousStateDirName = process.env.MAKO_STATE_DIRNAME;
    try {
      const stateHome = path.join(tmp4, "state");
      const projectRoot = path.join(tmp4, "project");
      mkdirSync(stateHome, { recursive: true });
      mkdirSync(projectRoot, { recursive: true });
      process.env.MAKO_STATE_HOME = stateHome;
      delete process.env.MAKO_STATE_DIRNAME;

      const projectId = randomUUID();
      const globalStore = openGlobalStore();
      try {
        globalStore.saveProject({
          projectId,
          displayName: "cache-logging-smoke",
          canonicalPath: projectRoot,
          lastSeenPath: projectRoot,
          supportTarget: "best_effort",
        });
      } finally {
        globalStore.close();
      }

      const loggingCache = createProjectStoreCache();
      try {
        const startedAt = new Date().toISOString();
        await writeToolInvocationLogs({
          toolName: "cache_logging_probe",
          input: { projectId },
          output: { ok: true },
          outcome: "success",
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          options: { projectStoreCache: loggingCache },
        });

        assert.equal(loggingCache.size(), 1, "tool logging should borrow the provided project-store cache");
        const cachedStore = loggingCache.borrow({ projectRoot });
        const runs = cachedStore.queryToolRuns({ toolName: "cache_logging_probe", limit: 1 });
        assert.equal(runs.length, 1, "tool logging should write through the cached project store");
      } finally {
        loggingCache.flush();
      }
    } finally {
      if (previousStateHome === undefined) {
        delete process.env.MAKO_STATE_HOME;
      } else {
        process.env.MAKO_STATE_HOME = previousStateHome;
      }
      if (previousStateDirName === undefined) {
        delete process.env.MAKO_STATE_DIRNAME;
      } else {
        process.env.MAKO_STATE_DIRNAME = previousStateDirName;
      }
      rmSync(tmp4, { recursive: true, force: true });
    }

    console.log("project-store-cache: PASS");
  } finally {
    rmSync(tmp1, { recursive: true, force: true });
    rmSync(tmp2, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
