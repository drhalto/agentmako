import { resolveProjectDbPath } from "@mako-ai/config";
import { ProjectStore, type ProjectStoreOptions } from "./project-store.js";

/**
 * Per-process cache of open `ProjectStore` handles, keyed by resolved
 * project DB path. Introduced in Initial Testing roadmap Phase 2 to
 * eliminate the per-tool-call open-close overhead that `agentmako mcp`
 * was paying on every invocation.
 *
 * Lifecycle contract:
 *
 * - `borrow(options)` opens on first call for a given resolved DB path
 *   and returns the cached handle on every subsequent call. The caller
 *   MUST NOT call `store.close()` on a borrowed handle — the cache owns
 *   it. Calling `close()` on a borrowed handle breaks every other
 *   borrower.
 * - `flush()` checkpoints every pooled store with `truncate: true` so
 *   the WAL files get cleaned up at shutdown, then closes each store
 *   and drops the cache. Idempotent.
 * - `size()` is diagnostic only — smokes use it; nothing production-
 *   critical depends on the count.
 *
 * Concurrency invariant:
 *
 * - A cached store is one shared `DatabaseSync` handle per project DB
 *   path. Concurrent tool-plane callers may borrow the same handle.
 *   This is safe because every `ProjectStore` method completes its
 *   SQLite access synchronously on the Node event loop: no `await`
 *   between `db.prepare()` and the final `.get()` / `.all()` /
 *   `.run()`. Future store methods must preserve that invariant or
 *   avoid the shared-cache path.
 * - Do not add a mutex around this cache. If true parallel DB work is
 *   needed later, use separate handles or pooling rather than
 *   serializing this handle again in userland.
 *
 * Opt-in by design. Only contexts with a known process lifetime (the
 * `agentmako mcp` stdio server, tests that explicitly want a cache)
 * create one. One-shot CLI commands and HTTP request handlers keep the
 * current open-close semantics.
 */
export class ProjectStoreCache {
  private readonly stores = new Map<string, ProjectStore>();
  private flushed = false;

  borrow(options: ProjectStoreOptions): ProjectStore {
    if (this.flushed) {
      throw new Error(
        "ProjectStoreCache: cannot borrow from a flushed cache. Create a new cache.",
      );
    }

    const key = resolveProjectDbPath(
      options.projectRoot,
      options.stateDirName,
      options.projectDbFilename,
    );

    const existing = this.stores.get(key);
    if (existing) {
      return existing;
    }

    const store = new ProjectStore(options);
    this.stores.set(key, store);
    return store;
  }

  flush(): void {
    if (this.flushed) return;
    this.flushed = true;

    for (const store of this.stores.values()) {
      try {
        store.checkpoint({ truncate: true });
      } catch {
        // Best-effort — checkpoint failures must not prevent close.
      }
      try {
        store.close();
      } catch {
        // Best-effort — per-store close failure must not block others.
      }
    }
    this.stores.clear();
  }

  size(): number {
    return this.stores.size;
  }
}

export function createProjectStoreCache(): ProjectStoreCache {
  return new ProjectStoreCache();
}
