# Roadmap Version Initial Testing Handoff

This file is the execution handoff for the Initial Testing roadmap.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-8/handoff.md](../version-8/handoff.md)

## Roadmap Intent

This roadmap exists because using mako on real projects surfaced gaps
that earlier phases could not have predicted. It turns initial-testing
pain into durable improvements without becoming a kitchen-sink backlog.

## Mandatory Entry Assumptions

Treat these as already shipped:

- every tool surface from Roadmaps 1–7
- R8 Phase 8.0 typed runtime telemetry contract
- R8 Phase 8.1 runtime capture + inspection pipeline
- stdio MCP transport (`agentmako mcp`)
- `@inquirer/password` prompt fix
- Supabase pooler documentation

Do not re-open those just because a phase would be easier if they were
different.

## Working Rules

1. **Every phase cites a deployment observation.** The phase doc must
   say: what failed, in what context, on what date — and why the fix
   belongs in this roadmap instead of Roadmap 8 or a lower roadmap.

2. **Ship as slices.** A phase is a sequence of independently
   verifiable commits. Stopping between slices leaves the tree in a
   clean state.

3. **Typed contracts before behavior.** New schemas land before the
   runtime code that reads or writes them, same pattern as R8.0.

4. **Append-only for audit-relevant state.** Any new storage follows
   the `tool_runs` / `lifecycle_events` / `mako_usefulness_events`
   pattern: no-update / no-delete triggers, compaction via rollup not
   TTL.

5. **Telemetry-aware.** When a phase's output is a natural signal for
   future R8 read models or R8.5 failure clustering, emit
   `RuntimeUsefulnessEvent` rows through the 8.1 pipeline. Keep the
   decision-kind list typed; do not invent parallel telemetry plumbing.

6. **No second planner.** This roadmap does not add planning layers
   beside `ask`, packet handoff, or `investigate`.

7. **No ML or learned rollout in this roadmap.** Telemetry from these
   phases informs operators and later R8 phases — not automatic
   behavior here.

## What To Avoid

- kitchen-sink phases that bundle unrelated fixes
- speculative features without a named deployment trigger
- reopening R4 / R5 / R6 / R7 contracts without concrete evidence
- building parallel infrastructure to what R8 already provides

## Verification Posture

Each phase should leave behind:

- typed contract coverage
- focused smokes per slice
- at least one realistic usefulness check
- doc updates when contract shape or exposure posture changes

## Current Status

- Pre-phase fixes shipped (see `README.md` § "Pre-phase-1 fixes
  already shipped").
- **Phase 1** — Finding Acknowledgements — shipped. Storage + typed
  contracts + `finding_ack` / `finding_acks_report` tools + filter
  wiring into `ast_find_pattern` and `lint_files` + `finding_ack`
  decision kind on R8.1 telemetry. Four smokes green; four existing
  smokes adjusted for the wider decision-kind enum. See
  [./phases/phase-1-finding-acknowledgements.md](./phases/phase-1-finding-acknowledgements.md).
- **Phase 2** — MCP Perf: Project Store Lifetime — shipped. `ProjectStore.close()` no
  longer forces a `PRAGMA wal_checkpoint(TRUNCATE)` on every call
  (100–300ms cliff on larger WALs); new explicit `checkpoint()` method
  runs at shutdown instead. New `ProjectStoreCache` borrowed by
  `withProjectContext`, tool-invocation logging, and runtime-telemetry
  capture when a long-lived host (the `agentmako mcp` stdio server)
  provides one. Opt-in; HTTP transport and tests keep open-close
  semantics unchanged. Local perf
  smoke shows cached mean ≈ 67% of open-close mean on a 50-file seed;
  gap widens on larger project DBs. See
  [./phases/phase-2-mcp-perf-store-lifetime.md](./phases/phase-2-mcp-perf-store-lifetime.md).
- **Phase 3** — Package-Backed Search And Parsing Hardening — shipped.
  Captures the 2026-04-24 package-backed mechanics audit: replace
  duplicate custom glob matching with `picomatch`, add a ripgrep-backed
  `live_text_search` surface, establish `remark` / `gray-matter`
  Markdown parsing for knowledge, move TS / JS indexer extraction off
  regex and onto AST parsing while keeping `ts-morph` / `oxc-parser`
  parked, and run a gated `pgsql-parser` experiment with the default SQL
  extractors unchanged. See
  [./phases/phase-3-package-backed-search-and-parsing.md](./phases/phase-3-package-backed-search-and-parsing.md).
- **Phase 4** — Index Freshness And Auto-Refresh — shipped. Adds
  code-index freshness contracts, evidence-level stale/deleted/unindexed
  flags, `project_index_status` / `project_index_refresh`, cache-safe
  refresh plumbing, and the MCP watcher that refreshes on edits while
  preserving `live_text_search` as the live fallback. See
  [./phases/phase-4-index-freshness-and-auto-refresh.md](./phases/phase-4-index-freshness-and-auto-refresh.md).
- **Phase 5** — Deterministic Context Packet And Hot Retrieval —
  shipped. Added the read-only `context_packet`, deterministic provider
  pipeline, hot hint index, ranking/budgeting, freshness enrichment,
  read-only `tool_batch`, MCP/client guidance, R8.1 telemetry for
  packet/batch usefulness, triggered risks, scoped instructions, richer
  harness handoff, and the path-scoped refresh foundation. See
  [./phases/phase-5-deterministic-context-packet-and-hot-retrieval.md](./phases/phase-5-deterministic-context-packet-and-hot-retrieval.md).
- **Phase 6** — Parser And Resolver Hardening — shipped. Replaced
  additional custom mechanics with package-backed equivalents:
  Supabase generated-types parsing now walks the TypeScript AST; repo SQL
  schema-object extraction uses `pgsql-parser` with regex fallback only
  on parse failure; schema usage prefers structured Supabase call
  detection; TypeScript import resolution uses `ts.resolveModuleName`;
  and harness glob, unified diff, SSE, route matching, and indexer
  concurrency helpers now use focused packages. Function-body table refs
  are centralized in the store helper and less noisy, with full
  PL/pgSQL body parsing explicitly deferred. See
  [./phases/phase-6-parser-and-resolver-hardening.md](./phases/phase-6-parser-and-resolver-hardening.md).
- Roadmap 8 Phase 8.2+ is paused pending accumulated R8.1 telemetry.
  See `../version-8/handoff.md`.
