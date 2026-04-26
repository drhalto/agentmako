# Phase 4 Action And Tool-Run Logging

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 4.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 4.

## What Shipped

- `lifecycle_events` table in `project.db` — append-only rows for 9 event types (`project_attach`, `project_detach`, `project_index`, `schema_snapshot_build`, `schema_snapshot_refresh`, `db_verify`, `db_test`, `db_bind`, `db_unbind`) with immutability triggers (DELETE/UPDATE trigger at the SQLite layer)
- `tool_runs` table in `project.db` — append-only rows for every `invokeTool` call; the hook lives at the registry level in `packages/tools/src/registry.ts`, not per-tool, so every current and future tool is logged automatically. Immutability triggers enforce append-only at the storage layer.
- `tool_usage_stats` table in `global.db` — lightweight cross-project rollup (one row per `tool_name`): `call_count`, `last_called_at`, `last_project_id`. Updated via `INSERT OR REPLACE` on every `invokeTool` call. Survives project detach/purge because it lives in the global store, not the project store.
- Phase 2 deferred gap closed — snapshot build warnings are now surfaced through `lifecycle_events.metadata_json` on `schema_snapshot_build` rows and exposed to status via warning count. `IndexProjectResult.schemaSnapshotWarnings` carries the warning list for the immediate CLI/HTTP output.
- Modularity verified — a dummy tool registered dynamically in the smoke test was invoked and confirmed to appear in `tool_runs` and `tool_usage_stats` with zero changes to the logging layer.
- `ToolServiceOptions` refactored to carry an optional `sharedGlobalStore` for store reuse across tool calls; `borrowGlobalStore` helper added; `MakoToolService` now holds a long-lived `GlobalStore` instance.
- WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) added to both `GlobalStore.close()` and `ProjectStore.close()` for proper file handle cleanup on shutdown.

## Code Touchpoints

- `packages/store/src/migration-sql.ts` — new project migration: `lifecycle_events`, `tool_runs`, immutability triggers; new global migration: `tool_usage_stats`
- `packages/store/src/project-store.ts` — `insertLifecycleEvent`, `insertToolRun`, `queryLifecycleEvents`, `queryToolRuns` methods; WAL checkpoint in `close()`
- `packages/store/src/global-store.ts` — `upsertToolUsageStat`, `getToolUsageStats`, `getToolUsageStat` methods; `borrowGlobalStore` helper; WAL checkpoint in `close()`
- `packages/tools/src/registry.ts` — generic `invokeTool`-level logging hook writing to both `tool_runs` (project store) and `tool_usage_stats` (global store)
- `packages/tools/src/service.ts` — `MakoToolService` constructor now accepts `ToolServiceOptions.sharedGlobalStore`; holds a long-lived `GlobalStore`
- `services/indexer/src/index-project.ts` — lifecycle event emission for `project_attach`, `project_index`, `schema_snapshot_build` (including warning list in `metadata_json`)
- `services/indexer/src/db-binding/refresh.ts` — `schema_snapshot_refresh` event
- `services/indexer/src/db-binding/verify.ts` — `db_verify` event
- `services/indexer/src/db-binding/bind.ts` — `db_bind`, `db_unbind`, `db_test` events
- `services/indexer/src/detach.ts` — `project_detach` event
- `test/smoke/core-mvp.ts` — new assertions for `lifecycle_events`, `tool_runs`, `tool_usage_stats`; modularity smoke (dummy tool invoked, confirmed in both tables without logging-layer changes)
- `test/smoke/state-cleanup.ts` — shared smoke cleanup helper with retrying rmSync and Windows-only best-effort fallback for SQLite WAL file handle release timing
- `packages/store/src/path-utils.ts` — directory scanning ignores `.mako-ai-*` temp dirs so leftover smoke dirs don't contaminate indexing

## Prerequisites

Phase 4 assumes the following earlier phases are complete:

- Phase 3 — live DB binding and read-only refresh substrate
- Phase 3.1 — operator setup and binding UX
- Phase 3.2 — package-level `agentmako connect` flow and top-level aliases (**Complete**)
- Phase 3.3 — project profile depth (real middleware detection, server-boundary closure, `authGuardSymbols` from actual exported symbols) — hard prerequisite because Phase 4 logs against the project profile, and logging a stub profile would bake bad data into the append-only fact tables that later trust work depends on
- Phase 3.4 — profile polish (resolved path aliases, corrected `srcRoot`, enriched file-like `entryPoints`, and an explicit cache decision backed by measurement) — hard prerequisite because Phase 4 should start logging the final profile contract, not the pre-polish alias and entry-point shapes
- Phase 3.4.1 — tsconfig alias hotfix (`get-tsconfig` replacing the hand-rolled JSONC parser so `extends`-chain aliases resolve correctly) — hard prerequisite because Phase 4 should log against the corrected alias substrate, not a leaf-config-only approximation
- Phase 3.5 — live schema scope and catalog capture (interactive schema-scope selection on connect plus richer structural live-schema capture including indexes, RLS policy mode/roles, and trigger firing modes) — hard prerequisite because Phase 4 should log against the structural DB snapshot the product actually intends to keep, not a thinner pre-capture live refresh
- Phase 3.5.1 — live schema read model and introspection (hybrid canonical-JSON plus flattened read tables) — hard prerequisite because Phase 4 should log against a DB substrate that is both structurally rich and directly queryable without unpacking snapshot JSON on every downstream use
- Phase 3.5.2 — live catalog ingestion hotfix (removing `pg-introspection` and returning to flat typed catalog SQL while keeping the 3.5.1 storage model) — hard prerequisite because Phase 4 should not start on top of an ingestion layer that became more complex after the dependency experiment
- Phase 3.6 — CLI UX production polish (schema auto-import, `--keychain-from-env`, `project init` hard-deleted, bare `agentmako` context-sensitive behavior) — hard prerequisite because Phase 4 should log the CLI workflows that operators actually experience, not a transitional set that includes a deprecated command, a schema picker that is gone, and a no-arg entry point that only printed help

Phase 4 does **not** own the SQL-side authz shape (role table, role column, admin check template, RLS introspection). That work can be picked up after Phase 4 ships, once logging can record the authz-detection attempts as append-only facts.

Phase 4 does **not** ship benchmark definitions, benchmark execution records, or assertion tables — that is Phase 4.1.

## Goal

Make every meaningful action and tool invocation durable in project.db so later trust, ranking, contradiction, and ML work has structured history to consume.

## Hard Decisions

- Append-only fact rows enforced at the SQLite layer — DELETE/UPDATE triggers reject mutations at the storage layer, not only by application convention
- Tool-run logging is generic and modular — the `tool_runs` table logs by tool name; adding a new tool to the registry requires zero logging-layer changes because the hook lives at `invokeTool`, not per-tool
- Tool usage is tracked at two levels: detailed `tool_runs` rows per project (in `project.db`, append-only, immutable) AND lightweight `tool_usage_stats` rollup in `global.db` (total calls + last called, survives project detach/purge). This gives both per-project history and cross-project "which tools matter" signal.
- `lifecycle_events` and `tool_runs` are the two new canonical fact tables introduced by Phase 4 in `project.db`. `tool_usage_stats` is the new global-level table in `global.db`.
- The existing `index_runs` table stays as-is — it predates Phase 4 and already works
- `answer_traces` and `evidence_blocks` stay as-is — they are the query-trace layer, not the action-logging layer
- `db_binding_state` stays as the current-state table; Phase 4 adds historical event rows alongside it, not replacing it
- Phase 4 does NOT ship benchmark definitions, execution records, or assertion tables — that is Phase 4.1
- Phase 4 does NOT ship SQL-side authz detection

## Why This Phase Exists

Later roadmaps need historical structure.

If Roadmap 2 actions are not logged now, later contradiction, ranking, and trust work will be guesswork.

Phase 3.3 is a prerequisite for a narrower but important reason: the project profile must be honest before it becomes part of the append-only history. Logging middleware files that were never validated, server-only modules that were guessed by path heuristics, or auth-guard "symbols" that are actually SQL migration filename stems would poison the fact log with inputs that later trust and ranking work cannot recover from without rebuilding the profile anyway. Fix the profile first, then log against it.

The tool-run logging design is intentionally modular: the logging hook lives at the `invokeTool` level in the tool registry, not in each individual tool implementation. This means any tool added to the registry in the future gets logged automatically, with no changes required to the logging layer. Per-tool logging code would couple the tool catalog to the logging substrate and defeat this property.

## Scope In

- `lifecycle_events` table — append-only rows for: `project_attach`, `project_detach`, `project_index`, `schema_snapshot_build`, `schema_snapshot_refresh`, `db_verify`, `db_test`, `db_bind`, `db_unbind`. Each row: `event_id` (UUID), `project_id`, `event_type`, `outcome` (`success`/`failed`/`skipped`), `started_at`, `finished_at`, `duration_ms`, `metadata_json` (flexible per-event payload), `error_text` (nullable)
- `tool_runs` table — append-only rows for every `invokeTool` call: `run_id` (UUID), `project_id` (nullable — some tools don't need project context), `tool_name`, `input_summary_json` (the tool args, possibly truncated), `output_summary_json` (the result shape, possibly truncated), `outcome` (`success`/`failed`/`error`), `started_at`, `finished_at`, `duration_ms`, `request_id` (nullable — for HTTP/MCP correlation), `error_text` (nullable)
- `tool_usage_stats` table in `global.db` — one row per tool name: `tool_name` (PRIMARY KEY), `call_count` (INTEGER), `last_called_at` (TEXT ISO timestamp), `last_project_id` (TEXT, nullable). Updated via `INSERT OR REPLACE` on every `invokeTool` call. Not append-only — this is a current-state rollup that gives cross-project visibility into which tools are being used and how often, even after individual projects are detached or purged.
- Immutability enforcement: CREATE TRIGGER on `lifecycle_events` and `tool_runs` in project.db that raises on DELETE or UPDATE. The global `tool_usage_stats` table is intentionally mutable (it's a rollup, not a fact log).
- Close the Phase 2 deferred gap: snapshot build warnings surfaced through `lifecycle_events` (the `metadata_json` carries the warning list) and exposed to status via warning count
- Wire `invokeTool` in `packages/tools/src/registry.ts` to write a `tool_runs` row AND update `tool_usage_stats` — the hook is at the registry level so every tool, current and future, gets logged without per-tool changes
- Wire lifecycle events at the indexer service level (attach, index, refresh, verify, test, bind, unbind)
- ProjectStore gets new methods: `insertLifecycleEvent(...)`, `insertToolRun(...)`, `queryLifecycleEvents(...)`, `queryToolRuns(...)`
- GlobalStore gets new methods: `upsertToolUsageStat(toolName, projectId)`, `getToolUsageStats()`, `getToolUsageStat(toolName)`

## Scope Out

- Benchmark suite/case/assertion definitions (Phase 4.1)
- Benchmark execution records (Phase 4.1)
- Contradiction engine, ranking engine, ML behavior
- SQL-side authz detection (`AuthzProfile`)
- Hot-path rollup triggers
- Per-tool logging logic — the whole point is generic logging at `invokeTool` level

## Deferred From Phase 2

Phase 2 closed four correctness findings but intentionally left one low-severity gap because the right home for the fix is Phase 4's logging substrate.

### Gap: snapshot build warnings are lost in the `not_built` case

When `buildSchemaSnapshot` returns `{ snapshot: null, warnings }` because every declared schema source was unsupported (`prisma_schema`, `drizzle_schema`) or missing, the warnings are returned from the builder but then dropped at `services/indexer/src/index-project.ts`. Status and the CLI correctly report tri-state `not_built`, but they cannot tell the user *why* the snapshot did not build.

The same applies in a weaker form to the `present` case: warnings from the most recent build attempt are persisted on the snapshot row, but there is no durable history of prior builds — only the current state.

### Phase 4 scope for closing this

1. **Record every snapshot build attempt as an append-only fact row.** Include the inputs (source set, source mode), the outcome (persisted snapshot id or `null`), and the warning list in `metadata_json`. This must work for both persisted-snapshot outcomes and null-outcome (all-unsupported / all-missing) runs so the event log stays complete.
2. **Expose the most recent build attempt to status.** Status should be able to surface at minimum a warning count and at best the warning list for the current `not_built` or `present` state, without bloating `SchemaSnapshotSummary` with full payloads. Keep full warning detail reachable through an explicit load call.
3. **Surface full warning details at index time.** Add `schemaSnapshotWarnings: SchemaSnapshotWarning[]` to `IndexProjectResult` so the immediate CLI/HTTP output after `mako project index` tells the user exactly what was skipped in this run. This is a cheap per-call pipe; the persistent story still comes from the append-only fact table.

### Verification when the fix lands in Phase 4

- Attach a scratch project with only `prisma/schema.prisma` (no supported sources), run `mako project index`, and confirm `IndexProjectResult.schemaSnapshotWarnings` carries an `unsupported_source` entry naming the Prisma file.
- `mako project status` on the same project reports `state: "not_built"` with a non-zero `warningCount` (and exposes the warning list via the explicit load call).
- Inspect the `lifecycle_events` table directly and confirm a row exists for the failed build attempt with the warning list in `metadata_json`.
- Delete `prisma/schema.prisma`, run index again, and confirm a new append-only row captures the transition (still `not_built`, warnings now include `source_missing` or an empty set depending on manifest regeneration).

## Architecture Boundary

### Owns

- `lifecycle_events` table (project.db)
- `tool_runs` table (project.db)
- `tool_usage_stats` table (global.db)
- Immutability triggers on `lifecycle_events` and `tool_runs`
- The generic `invokeTool`-level logging hook (writes to both project.db and global.db)
- ProjectStore insert/query methods for `lifecycle_events` and `tool_runs`
- GlobalStore upsert/query methods for `tool_usage_stats`
- The Phase 2 snapshot-build-warning gap closure

### Does Not Own

- Benchmark definition tables (Phase 4.1)
- Benchmark execution records (Phase 4.1)
- The existing `index_runs`, `answer_traces`, `evidence_blocks` tables — they predate Phase 4
- Investigation memory semantics
- Learned ranking logic
- AI/ML behavior

## Contracts

### Input Contract

Roadmap 2 actions that must produce `lifecycle_events` rows:

- `project_attach`
- `project_detach`
- `project_index`
- `schema_snapshot_build` (including its warning list, even when the build ends with no persisted snapshot)
- `schema_snapshot_refresh`
- `db_verify`
- `db_test`
- `db_bind`
- `db_unbind`

Every `invokeTool` call must produce a `tool_runs` row. The logging layer needs only the tool name, input args, output shape, timing, and outcome — it does not need per-tool knowledge.

### Output Contract

The phase leaves behind:

- structured append-only event rows in `lifecycle_events`
- structured append-only tool-call rows in `tool_runs`
- ProjectStore query methods so later phases can read the history
- enough metadata for later historical comparison, trust scoring, and benchmark linking

### Error Contract

- `log-write-failed` — the logging insert itself fails; the action result should still be returned to the caller
- `summary-refresh-failed` — a derived view or count query fails

## Execution Flow

1. Define `lifecycle_events` and `tool_runs` tables via new project migration
2. Add immutability triggers (DELETE/UPDATE rejection) on both tables
3. Add ProjectStore methods: `insertLifecycleEvent`, `insertToolRun`, `queryLifecycleEvents`, `queryToolRuns`
4. Wire lifecycle events into indexer service paths (attach, index, refresh, verify, test, bind, unbind)
5. Wire tool-run logging into `invokeTool` at the registry level — generic, not per-tool
6. Close the Phase 2 snapshot-build-warning gap using `lifecycle_events`
7. Add smoke test coverage including the modularity verification
8. Verify immutability enforcement

## File Plan

Create:

- New project migration in `packages/store/src/migration-sql.ts` (`lifecycle_events`, `tool_runs`, immutability triggers)
- New global migration in `packages/store/src/migration-sql.ts` (`tool_usage_stats`)

Modify:

- `packages/store/src/project-store.ts` — new `insertLifecycleEvent`, `insertToolRun`, `queryLifecycleEvents`, `queryToolRuns` methods
- `packages/store/src/global-store.ts` — new `upsertToolUsageStat`, `getToolUsageStats`, `getToolUsageStat` methods
- `packages/tools/src/registry.ts` — tool-run logging hook in `invokeTool` (generic, not per-tool; writes to both project store and global store)
- `services/indexer/src/index-project.ts` — lifecycle event logging for attach and index paths
- `services/indexer/src/db-binding/refresh.ts` — `schema_snapshot_refresh` event
- `services/indexer/src/db-binding/verify.ts` — `db_verify` event
- `services/indexer/src/db-binding/bind.ts` — `db_bind`, `db_unbind`, `db_test` events
- `test/smoke/core-mvp.ts` — new assertions for fact tables + modularity verification

Keep unchanged:

- `packages/tools/src/ask/index.ts` — existing structured logger stays (stderr only, not durable); the new `tool_runs` rows complement rather than replace it
- Schema snapshot tables, read model, live catalog — unchanged
- CLI surface — no new commands; logging is automatic and not user-facing

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- Attach a scratch project, run index, verify `lifecycle_events` has a `project_index` row with the correct `project_id` and `outcome`
- Run `agentmako connect --yes --no-db` on a scratch project, verify `lifecycle_events` has `project_attach` and `project_index` rows
- Run a tool call (e.g., `agentmako tool call <ref> imports_deps '{"file":"src/index.ts"}'`), verify `tool_runs` has a row with the correct `tool_name` and `duration_ms`
- **Modularity test:** Register a scratch/dummy tool in the tool registry (new name, trivial implementation), invoke it via `tool call`, confirm it appears in `tool_runs` WITHOUT any changes to the logging layer. This proves new tools get logged automatically.
- After any tool call, verify `tool_usage_stats` in `global.db` has a row for that tool name with `call_count >= 1` and a recent `last_called_at`
- Detach + purge the scratch project, verify `tool_usage_stats` in `global.db` still has the row (global stats survive project purge)
- Attempt to DELETE a `lifecycle_events` row — must fail with a trigger error
- Attempt to UPDATE a `tool_runs` row — must fail with a trigger error
- Attach a scratch project with only unsupported schema sources (e.g., `prisma/schema.prisma`), run index, verify the `schema_snapshot_build` row in `lifecycle_events` carries the warning list in `metadata_json` and status surfaces a non-zero warning count

Required docs checks:

- Roadmap 2 docs stay aligned on logging being append-first and tool-run logging being modular

## Done When

- Every meaningful Roadmap 2 action leaves a structured, immutable record in `project.db`
- Every tool invocation (current and future) gets a durable `tool_runs` row without per-tool logging code
- Every tool invocation updates a `tool_usage_stats` row in `global.db` with total call count and last-called timestamp (survives project purge)
- The Phase 2 snapshot-build-warning gap is closed
- Immutable historical rows are enforced by the storage layer, not only by application convention
- A new tool added to the registry is automatically logged in both `tool_runs` and `tool_usage_stats` with zero logging-layer changes (verified by the modularity smoke test)
- Phase 4.1 can begin with a tool-run history to link benchmark results against

## Risks And Watchouts

- Over-logging: storing full tool input/output JSON on every call could bloat `project.db`. Mitigate with truncation policy on `input_summary_json` and `output_summary_json` (e.g., first 4 KB).
- Under-logging: missing a lifecycle path means a gap in the history. Wire all paths and verify with smoke tests.
- Modularity regression: someone adds per-tool logging logic instead of using the generic hook. The modularity smoke test catches this by proving a new tool works without logging changes.
- Log-write-fail coupling: a failed `tool_runs` insert must not swallow the tool result. Log-write errors should be surfaced separately.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.2-package-and-connect-ux.md](./phase-3.2-package-and-connect-ux.md)
- [./phase-3.3-project-profile-depth.md](./phase-3.3-project-profile-depth.md)
- [./phase-4.1-benchmark-and-evaluation-storage.md](./phase-4.1-benchmark-and-evaluation-storage.md)
