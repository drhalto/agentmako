# Phase 2 MCP Perf — Project Store Lifetime

Status: `Shipped`

## Deployment Observation

On 2026-04-23, after using the `agentmako mcp` stdio transport against
courseconnect for a real Claude Code session, the operator noted that
mako tool calls felt noticeably slower than a comparable Python-based
MCP server (Fenrir) running on the same project. Fenrir returns results
"fast"; mako returns results with perceptible lag on a session that
makes 10–20 tool calls to answer one question.

Direct inspection of `courseconnect/.mako-ai/project.db`: **~220 MB**
main file, **~78 MB WAL**. The mechanism is architectural, not
language-level:

- `packages/store/src/project-store.ts:126` runs
  `PRAGMA wal_checkpoint(TRUNCATE)` on every `ProjectStore.close()`.
  On a 78 MB WAL that is a bulk synchronous write + truncate — easily
  100–300ms of pure bookkeeping before or after the tool's actual query.
- `packages/tools/src/entity-resolver.ts:137` — `withProjectContext`
  opens and closes the project store on every single tool invocation.
  Fenrir keeps one SQLite connection alive for the life of its MCP
  server process; mako pays open + migration-check + close on every
  call.
- `packages/tools/src/runtime-telemetry/capture.ts:68` — for every
  telemetry-emitting tool call, the capture hook opens a *second*
  project store in its `finally` block. That second open also pays the
  same open + close (and, today, a second WAL checkpoint).

The gap is not SQLite-level: `node:sqlite` and Python's `sqlite3` are
both thin C-library wrappers. Python is not inherently faster.

## Goal

Make `agentmako mcp` tool latency feel equivalent to Fenrir on
courseconnect-sized projects (~200 MB project.db). Target: after a
one-time warm-up at server start, per-tool-call SQLite overhead drops
from "hundreds of ms" to "single-digit ms" for read-heavy tool calls.

This is a perf phase, not a contract phase. No tool input/output shape
changes. No migrations. Existing callers — CLI `tool call`, harness,
HTTP transport, direct `invokeTool` in tests — continue to work, just
faster when the MCP server is the host.

## Hard Decisions

- **Remove the forced `PRAGMA wal_checkpoint(TRUNCATE)` from
  `ProjectStore.close()`.**
  SQLite's auto-checkpoint already fires at 1000 pages (~4MB) on commit.
  A forced TRUNCATE on every close is what makes the WAL balloon into
  a latency cliff. Checkpointing becomes explicit: a new
  `ProjectStore.checkpoint({ truncate?: boolean })` method that
  callers (CLI exit, MCP server shutdown) can invoke deliberately.
- **Introduce a per-process `ProjectStoreCache` keyed by resolved
  project DB path.**
  The MCP stdio server builds one on startup, flushes on shutdown. When
  a cache is configured, `withProjectContext` borrows from the cache
  instead of opening a fresh store. When the cache is not configured
  (direct tool invocation in tests, one-shot CLI commands), behavior
  is unchanged — open-close per call.
- **Cache is opt-in via `ToolServiceOptions`.**
  No new runtime dependency on a module-level singleton. The MCP entry
  plumbs a `projectStoreCache` into every `invokeTool` call; tests and
  one-shots don't have to.
- **Telemetry capture reuses the cached store.**
  `packages/tools/src/runtime-telemetry/capture.ts` takes the same
  `projectStoreCache` through `ToolServiceOptions` and borrows from it
  instead of opening a second store. When no cache is present, falls
  back to the current `openProjectStore` / `close` path (unchanged).
- **No refcount games; the cache owns the handle.**
  Borrowed stores are not "closed" by callers — the cache decides. The
  cache close-all runs on SIGINT / SIGTERM in the MCP stdio entry and
  on process exit via a `process.once("exit", ...)` fallback. WAL
  checkpoint with `truncate: true` fires at that single shutdown point.
- **Scope is the `agentmako mcp` stdio transport.**
  HTTP transport (`services/api`) keeps the current open-close semantics
  for now. It's a request-scoped multi-tenant server; a shared cache
  would need more careful invalidation. Follow-up phase if needed.

## Scope In

- remove the forced WAL checkpoint from `ProjectStore.close()`
- add `ProjectStore.checkpoint(options?)` as an explicit API
- new `ProjectStoreCache` class in `@mako-ai/store`
- `ToolServiceOptions.projectStoreCache` (optional) plumbed through
  `withProjectContext`, tool-invocation logging, and the
  runtime-telemetry capture entries
- `agentmako mcp` wires up a cache at server start, tears it down on
  shutdown, calls `checkpoint({ truncate: true })` on each pooled
  store before close
- tests: perf smoke asserting warm-call latency stays under a threshold
- existing smokes unaffected (they use open-close; no cache)

## Scope Out

- HTTP transport caching (clean follow-up if real workloads show it
  matters — one MCP stdio session is already the hot path for Claude
  Code / Cursor / Codex)
- Migration-check caching (measurable but tiny; single SELECT on
  `schema_migrations` per open. With pooling it runs once per process.)
- Global store caching (`global.db` is small and rarely read twice in
  one tool call; not worth the invalidation surface)
- Fine-grained cache invalidation on config reload, project detach,
  or filesystem moves — MCP server restart is the blunt answer for now
- `RunAsync` vs `RunSync` or query batching — different problem

## Architecture Boundary

### Owns

- `packages/store/src/project-store.ts` — `ProjectStore.close()` no
  longer runs a forced TRUNCATE; new `ProjectStore.checkpoint(...)`
- `packages/store/src/project-store-cache.ts` (new) — pooled store
  lifecycle
- `packages/tools/src/runtime.ts` — `ToolServiceOptions.projectStoreCache`
- `packages/tools/src/entity-resolver.ts` — `withProjectContext` uses
  the cache when present
- `packages/tools/src/runtime-telemetry/capture.ts` — capture hook
  reuses the cache
- `services/api/src/mcp-stdio.ts` — wires up the cache for the stdio
  transport and calls checkpoint on shutdown
- `test/smoke/mcp-perf-store-lifetime.ts` (new) — timing harness

### Does Not Own

- SQLite WAL mode configuration (stays `journal_mode = WAL`, auto-
  checkpoint at 1000 pages); this phase does not retune SQLite pragmas
- HTTP transport request lifecycle
- Global-store caching
- Any tool contract or schema

## Contracts

### `ProjectStore.checkpoint`

```ts
interface ProjectStoreCheckpointOptions {
  /**
   * When true, runs `PRAGMA wal_checkpoint(TRUNCATE)` — fsyncs the WAL
   * into the main database file and resets the WAL to empty. Typical
   * at process shutdown. Default: false (runs a `PASSIVE` checkpoint
   * which does not block readers).
   */
  truncate?: boolean;
}

export class ProjectStore {
  // ...
  checkpoint(options?: ProjectStoreCheckpointOptions): void;
}
```

### `ProjectStoreCache`

```ts
export class ProjectStoreCache {
  /**
   * Borrow a ProjectStore for the given resolved project DB path.
   * Opens on first call; returns the same handle on subsequent calls.
   * The caller MUST NOT call `store.close()` — the cache owns the
   * handle. When the cache is flushed, all pooled stores close.
   */
  borrow(options: ProjectStoreOptions): ProjectStore;

  /**
   * Flush and close every pooled store. Each pooled store is
   * checkpointed with `truncate: true` before close. Safe to call
   * multiple times; idempotent.
   */
  flush(): void;

  /** Current pool size — for smokes and diagnostics. */
  size(): number;
}

export function createProjectStoreCache(): ProjectStoreCache;
```

### `ToolServiceOptions` extension

```ts
// packages/tools/src/runtime.ts
export interface ToolServiceOptions {
  // ...existing fields
  /**
   * Optional project-store pool. When provided, `withProjectContext`
   * tool-invocation logging, and the runtime-telemetry capture hook
   * borrow from this pool instead of opening / closing per call.
   * Lifecycle is the caller's responsibility (MCP stdio entry flushes
   * on shutdown).
   */
  projectStoreCache?: ProjectStoreCache;
}
```

## Execution Flow (slices)

1. **Store lifecycle surgery** — move the WAL checkpoint out of
   `close()` into a new explicit `checkpoint()`. Add a `checkpoint()`
   unit-equivalent to existing smokes: a DB-state smoke that asserts
   close is no longer doing bulk IO. Also confirms auto-checkpoint
   still works (insert enough rows to cross the 1000-page threshold,
   verify WAL bounds).
2. **Project store cache** — add `ProjectStoreCache` and the
   `ToolServiceOptions.projectStoreCache` plumb-through. Default code
   path unchanged (no cache = open-close per call). New smoke:
   `ProjectStoreCache` round-trip, flush idempotency, borrow returns
   same handle, `flush` checkpoints + closes.
3. **Wire `withProjectContext` to the cache** — behind the optional
   `projectStoreCache`. Fallback unchanged. Reuses perf smoke.
4. **Wire capture hook to the cache** — runtime-telemetry capture
   hook uses the cache when present. No behavior change when not.
5. **MCP stdio entry hookup** — `services/api/src/mcp-stdio.ts`
   creates the cache, passes it into `ToolServiceOptions`, installs
   SIGINT / SIGTERM / exit handlers that call `flush()` (which
   checkpoints + closes all pooled stores).
6. **Perf smoke** — new `test/smoke/mcp-perf-store-lifetime.ts`.
   Seeds a project with a bulk-indexed snapshot so project.db grows
   > 50 MB. Invokes a read-heavy tool N times with a configured
   cache. Asserts: first call is allowed up to X ms (warm-up);
   calls 2..N each stay under Y ms. Threshold chosen to be loose
   enough not to flake in CI, tight enough to regress on a re-
   introduced per-call open-close.

Stopping between any two slices leaves mako in a working state —
slice 1 alone already removes the biggest latency source; slices 2–5
compound but each is independently verifiable.

## File Plan

Create:

- `packages/store/src/project-store-cache.ts`
- `test/smoke/finding-acks-cache-lifecycle.ts` — wait, scratch that
- `test/smoke/project-store-cache.ts`
- `test/smoke/mcp-perf-store-lifetime.ts`

Modify:

- `packages/store/src/project-store.ts` — `close()` no longer
  checkpoints; add `checkpoint(options?)`
- `packages/store/src/index.ts` — re-export cache
- `packages/tools/src/runtime.ts` — add `projectStoreCache` field
  to `ToolServiceOptions`
- `packages/tools/src/entity-resolver.ts` — `withProjectContext`
  borrows from cache when present, does not close
- `packages/tools/src/tool-invocation-logging.ts` — reuse cache for
  `tool_runs` writes when present
- `packages/tools/src/runtime-telemetry/capture.ts` — reuse cache
  when present
- `services/api/src/mcp-stdio.ts` — create cache, wire to tool
  invocations, install shutdown hooks
- `package.json` — register new smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Changed`

Keep unchanged:

- SQLite pragmas (WAL mode, foreign_keys, busy_timeout)
- Migration application logic
- Any tool contract / schema
- HTTP transport lifecycle
- All existing smokes (they use open-close; cache is opt-in)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `ProjectStore.close()` on a 50+ MB WAL returns promptly (not 100+ms).
  Covered by the perf smoke's close-time measurement.
- `ProjectStoreCache.flush()` runs a `truncate: true` checkpoint so
  operators running `agentmako mcp` → Ctrl-C → `agentmako status` don't
  see unbounded WAL growth between sessions.
- Warm-call overhead on the perf smoke stays under the chosen threshold
  on the CI host. If CI noise makes a single threshold flaky, assert
  a *ratio*: warm calls must be <30% the duration of an open-close-
  per-call baseline.
- Existing smokes pass unchanged (they don't set `projectStoreCache`,
  so the open-close path is still exercised).

## Done When

- `ProjectStore.close()` no longer runs a forced TRUNCATE checkpoint
- `ProjectStore.checkpoint({ truncate?: boolean })` is the explicit
  entry point, invoked at server shutdown
- `ProjectStoreCache` ships and is exercised by the new smokes
- `agentmako mcp` uses the cache for every tool invocation and
  flushes on SIGINT / SIGTERM / process exit
- runtime-telemetry capture reuses the cached store when present
- new perf smoke covers the warm-call-latency regression surface
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **Connection leak on abnormal termination.**
  If `agentmako mcp` is killed with SIGKILL, pooled stores never close.
  WAL-mode SQLite recovers on next open; nothing corrupt. But the WAL
  file stays on disk until the next successful shutdown. Acceptable.
- **Shared cache across multiple project roots.**
  The cache is keyed by resolved project DB path, so two different
  project roots get two different pooled stores. A single MCP stdio
  session typically binds to one project, but multi-project is
  supported.
- **Cache interacts with re-index / re-attach flows.**
  If an operator runs `agentmako detach` against a project whose store
  is cached in a separate `agentmako mcp` process, the cached store
  keeps its handle open. That's fine for WAL-mode readers; write
  contention goes through `busy_timeout = 5000`. Restart the MCP
  process to fully release. Documented but not auto-invalidated.
- **Opt-in flag risk: capture without the cache double-opens.**
  Current shape. Already slow. Slice 4 fixes it. Slice 5 makes it
  permanent. Don't ship slice 1–3 without 4–5 if the MCP server was
  the whole reason for the phase.
- **Threshold-based perf smokes can flake.**
  CI hosts vary. If a single absolute ms threshold is noisy, switch
  to the ratio assertion. Don't loosen the threshold past the point
  it would catch the regression it exists for.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [./phase-1-finding-acknowledgements.md](./phase-1-finding-acknowledgements.md) — previous phase
- `packages/store/src/project-store.ts:126` — current forced TRUNCATE
  site
- `packages/tools/src/entity-resolver.ts:137` — current open-close
  pattern in `withProjectContext`
- `packages/tools/src/runtime-telemetry/capture.ts:68` — second store
  open in the telemetry capture hook
- `packages/store/src/sqlite.ts:50` — SQLite pragma configuration
  (WAL mode, busy_timeout, synchronous)
