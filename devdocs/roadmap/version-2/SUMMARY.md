# Roadmap 2 Summary

Roadmap 2 ("Project And Data Backbone") shipped 18 phases between early 2026 and 2026-04-16.

## What The Repo Had Before (Roadmap 1)

- Local-first repo indexing (files, symbols, routes, schema extraction)
- Shared typed tool contracts
- MCP, HTTP, CLI, and thin web surfaces
- First tool families: answers, imports, symbols, database schema tools
- A thin `ask` router
- Public install and tool docs

The gap: project attachment was thin, DB access was process-global, schema shape had no durable local snapshot, logging was informal, and nothing was measurable against a controlled target.

## What Roadmap 2 Delivered

### Project Contract (Phases 1, 3.1, 3.2, 3.6)

- `.mako/` project manifest with project identity, framework detection, DB mode, schema sources, and indexing preferences
- Real `project detach` with optional `--purge` and keychain cleanup
- CWD defaults for all project commands (`attach`, `detach`, `status`, `index`)
- Layered MCP project-context resolution: explicit arg, session project, `roots`, `_meta.cwd`, typed error
- `agentmako connect [path]` as the cold-start front door: attach + index + optional DB bind + refresh in one flow
- Secure interactive DB URL capture with OS keychain storage; `--db-env` fallback for CI
- `defaultSchemaScope` persisted in manifest so `--schemas` is never retyped
- Top-level `agentmako status`, `agentmako verify`, `agentmako refresh` aliases with saved scope
- Context-sensitive bare `agentmako`: status in attached project, connect suggestion in unattached repo, project list elsewhere
- `--keychain-from-env <VAR>` for one-command non-interactive keychain bind (CI path)
- `project init` hard-deleted; `connect` is the single entry point

### Schema Backbone (Phases 2, 3.5, 3.5.1, 3.5.2)

- One canonical normalized schema IR with repo-derived sources as the default local substrate
- Snapshot persistence, source metadata, source-mode metadata (`repo_only`, `repo_plus_live_verify`, `live_refresh_enabled`)
- Explicit freshness state: `unknown`, `fresh`, `stale`, `verified`, `drift_detected`, `refresh_required`
- Verification and drift metadata with diff groundwork
- Live catalog capture on connect: schemas, tables, columns, PKs, FKs, indexes, RLS policies, triggers, views, enums, functions/procedures
- Batched catalog ingestion: 10 queries total regardless of table count (no N+1 catalog queries)
- Flattened current-snapshot relational read model in `project.db` rebuilt transactionally on snapshot save/clear
- `ir_json` stays canonical; flattened tables are derived and synchronized
- `pg-introspection` dependency removed; live-catalog path is direct typed catalog SQL throughout

### Project Profile (Phases 3.3, 3.4, 3.4.1)

- Content-validated middleware detection: `middleware.ts` and `proxy.ts` (Next.js 16), top-level only, validated by file body content (`config` export + `matcher` field)
- `serverOnlyModules` derived from import-graph closure over framework server primitives: uses already-indexed `project.db`, not filesystem re-scans
- `authGuardSymbols` from real exported symbol names of server-only files, filtered by auth verb-prefix x auth-substring naming convention; never filename stems or migration names
- `pathAliases` resolved to absolute filesystem paths via `get-tsconfig` (extends-chain aware); hand-rolled JSONC parser removed
- `srcRoot` tightened for Next.js: only points at `root/src` when routing roots actually live there
- `entryPoints` expanded to include app/pages entry files, Next app-router metadata files, every detected middleware/proxy file, and every `next.config.*` file

### CLI Publishing (Phase 3.2.1)

- Bundled single-file CLI artifact via tsup inlining all `@mako-ai/*` workspace deps; native modules kept external
- `prepublishOnly` guard blocks publish if bundle is invalid (missing shebang, stray `@mako-ai/*` imports)
- `apps/cli/README.md` and tight `files` whitelist so only `dist/`, `README.md`, and `package.json` ship
- Clean-machine `npm install -g agentmako` works from a fresh environment

### Logging And Evaluation (Phases 4, 4.1)

- `lifecycle_events` append-only fact table in `project.db` covering 9 lifecycle event types; DELETE and UPDATE immutability triggers enforced at storage layer
- `tool_runs` append-only fact table for every `invokeTool` call, inserted by a generic registry-level hook: new tools are logged automatically with no per-tool logging code
- `tool_usage_stats` global rollup table in `global.db`; survives project detach and purge
- `ToolServiceOptions.sharedGlobalStore` with `borrowGlobalStore` helper for store reuse; WAL checkpoint on store close for Windows file-handle safety
- Phase 2 snapshot-build-warning gap closed: warnings now surface through `lifecycle_events.metadata_json` and appear in `agentmako status`
- `benchmark_suites`, `benchmark_cases`, `benchmark_assertions` definition tables for reusable benchmark definitions
- `benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results` result tables with append-only immutability; case results link to `tool_runs` rows by FK
- `tool_runs.payload_json` nullable column for sampled full-payload capture during benchmark runs
- `benchmark_run_summaries` lightweight derived view
- `benchmark-link-failed` typed error for FK integrity enforcement at store layer

### Validation (Phase 5)

- Repeatable ForgeBench attach, DB binding, snapshot refresh, and benchmark verification flows proved end-to-end
- Roadmap 2 operator docs locked; lock criteria documented in phase 5 doc
- Windows-safe smoke cleanup via retrying `rmSync` helper in `test/smoke/state-cleanup.ts`

### Codebase Hygiene And Modularity (Phases 5.1, 5.2)

- `services/indexer/src/utils.ts` (new): shared `durationMs`, `withGlobalStore`, `withProjectStore`, `withResolvedProjectContext` helpers replacing 6+ duplicated copies across the indexer service layer
- `apps/cli/src/index.ts` reduced from ~2000 lines to ~200-line thin dispatcher; command logic extracted into 7 modules under `apps/cli/src/commands/`
- `packages/store/src/project-store.ts` split from 2882 lines to 499-line delegate class plus 6 concern modules: benchmarks (614 lines), index (458), lifecycle (131), queries (967), snapshots (453), tool-runs (148)
- `services/api/src/server.ts` split from 778 lines to 283-line composition-only file plus `routes/projects.ts` (82), `routes/tools.ts` (42), `routes/answers.ts` (75), `mcp.ts` (154), `server-utils.ts` (285)
- `packages/tools/src/runtime.ts` split from 562 to 55-line re-export barrel plus `resolver-errors.ts` (27), `project-resolver.ts` (253), `entity-resolver.ts` (282)
- `packages/tools/src/registry.ts` split from 483 to 83-line entry plus `tool-definitions.ts` (256), `tool-invocation-logging.ts` (165)
- All splits are behavior-preserving: smoke suite passed identically before and after; no public API changes, no new dependencies

## By The Numbers

- 18 phases shipped (1, 2, 3, 3.1, 3.2, 3.2.1, 3.3, 3.4, 3.4.1, 3.5, 3.5.1, 3.5.2, 3.6, 4, 4.1, 5, 5.1, 5.2)
- `project.db`: 7 migrations, ~30 tables
- `global.db`: 2 migrations (projects registry + tool_usage_stats)
- CLI: 8 command modules, ~15 top-level commands and aliases
- Tools: 26 registered tools, all auto-logged via generic registry hook
- Live catalog: 10 queries per refresh regardless of table count
- Net lines removed in hygiene passes: -1960 (Phase 5.1) plus net-negative splits across all Phase 5.2 targets
- Smoke suite: covers full lifecycle + modularity + immutability + benchmark + Windows cleanup

## What Roadmap 2 Did NOT Build (Deliberately)

- Embeddings and vector search (Roadmap 3)
- Model workers / AI operating layer (Roadmap 3)
- Investigation composer tools (Roadmap 4)
- Contradiction detection (Roadmap 5)
- Row-data ingestion
- Continuous live DB sync
- SQL-side AuthzProfile (RLS introspection, role scoring)
- Ranking and trust signal systems

## What Comes Next

Roadmap 3: AI Operating Layer And Embedding Substrate

- Embedding worker (local generation, vector storage in project.db, incremental updates)
- Model access layer (local + cloud workers with clear role boundaries)
- Semantic search primitive (embedding-backed code and schema search)
- Enhanced ask router (semantic similarity for tool family selection)
- AI operating documentation and harness rules

Then Roadmap 4: Investigation Composition (tools consume Roadmap 3's embeddings natively)
Then Roadmap 5: Trust, Memory, Contradiction (measures Roadmap 4's investigation outputs)
