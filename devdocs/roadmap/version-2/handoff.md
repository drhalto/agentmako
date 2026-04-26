# Roadmap Version 2 Handoff

This file is the execution handoff for Roadmap Version 2.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)
- [../../test-project/setup.md](../../test-project/setup.md)
- [../../test-project/architecture.md](../../test-project/architecture.md)
- [../../test-project/benchmark-answer-key.md](../../test-project/benchmark-answer-key.md)

## Roadmap Intent

Roadmap 2 is not the investigation-composer roadmap.

Roadmap 2 is the backbone roadmap that makes later investigation work trustworthy.

The implementation goal is to leave the repo with:

- a real project contract
- a project-local manifest
- a durable schema snapshot backbone
- one canonical local schema IR
- a safe project-scoped live DB binding model
- a clear layered project-context resolution model for MCP and CLI-style callers
- structured logging and evaluation storage
- a repeatable ForgeBench validation flow

## Current Implementation Target

**Roadmap 2 complete** — Phase 5.2 deep module split shipped ([./phases/phase-5.2-deep-module-split.md](./phases/phase-5.2-deep-module-split.md))

Phase 5.2 was the final Roadmap 2 phase. It completed the behavior-preserving split of the deferred concentration points (`project-store.ts`, `server.ts`, `runtime.ts`, `registry.ts`, `attach.ts`), locked Roadmap 2 permanently, and left Roadmap 3 as the next work cycle. This handoff is now a frozen reference for the closed roadmap.

All seventeen prior Roadmap 2 phases are done:

- **Phase 1** — project contract and attach UX: `.mako/` manifest, richer project capability metadata, CWD defaults, real `project detach`, layered MCP context resolution.
- **Phase 2** — schema source discovery and snapshot backbone: one canonical local schema IR, repo-derived snapshot persistence, freshness and drift state.
- **Phase 3** — live DB binding and read-only refresh: project-scoped DB binding model, env-var / keychain strategy, connection test, read-only refresh, drift detection.
- **Phase 3.1** — project setup and binding UX: first-class `connect` front door, setup-time metadata presentation, optional DB-binding guidance, clearer status output.
- **Phase 3.2** — package and connect UX: `agentmako connect [path]` cold-start command, secure DB URL capture + keychain storage, default schema scope persistence, top-level `status`/`verify`/`refresh` aliases.
- **Phase 3.2.1** — CLI publishing: bundled tarball via tsup (inlining `@mako-ai/*` workspace deps), inlined SQLite migrations, `prepublishOnly` guard, CLI README, clean-environment verification.
- **Phase 3.3** — project profile depth: content-validated middleware detection, `serverOnlyModules` via import-graph closure, `authGuardSymbols` from real exported symbols, all from already-indexed `project.db` data.
- **Phase 3.4** — profile polish: `baseUrl`-aware path aliases resolved to absolute paths, `srcRoot` tightened for Next.js, `entryPoints` expanded with metadata and middleware files, latency measured and cache deferred.
- **Phase 3.4.1** — tsconfig alias hotfix: hand-rolled JSONC parser replaced with `get-tsconfig`; `extends`-chain aliases now resolve correctly.
- **Phase 3.5** — live schema scope and catalog capture: connect discovers and persists schema scope; richer live catalog capture including indexes, FKs, RLS, and triggers; drift verify extended to richer structures.
- **Phase 3.5.1** — live schema read model: flattened current-snapshot relational tables in `project.db` rebuilt transactionally on snapshot save/clear; `ir_json` remains canonical.
- **Phase 3.5.2** — live catalog ingestion hotfix: `pg-introspection` removed; live-catalog path is direct typed catalog SQL; richer capture surface and flattened read model both retained.
- **Phase 3.6** — CLI UX production polish: schema auto-import on connect, `--keychain-from-env` for CI, `project init` hard-deleted, bare `agentmako` is context-sensitive, help text polished.
- **Phase 4** — action and tool-run logging: `lifecycle_events` and `tool_runs` append-only fact tables with immutability triggers, `tool_usage_stats` global rollup, `sharedGlobalStore` / `borrowGlobalStore` refactor, WAL checkpoint, Windows-safe smoke cleanup.
- **Phase 4.1** — benchmark and evaluation storage: benchmark definition and result tables, append-only immutability, `payload_json` on `tool_runs`, `benchmark_run_summaries` view, `benchmark-link-failed` typed error, full smoke coverage.
- **Phase 5** — ForgeBench validation and Roadmap 2 lock: repeatable ForgeBench attach, DB binding, snapshot refresh, and benchmark verification flows proved end-to-end; Roadmap 2 operator docs locked.
- **Phase 5.1** — codebase hygiene: shared `durationMs` / `withGlobalStore` / `withProjectStore` / `withResolvedProjectContext` helpers extracted to `services/indexer/src/utils.ts`, replacing 6+ duplicated copies; CLI split from a ~2000-line monolithic `index.ts` into 8 command modules under `apps/cli/src/commands/` plus a thin dispatcher; dead internal helpers removed; net −1960 lines, no new dependencies, no public API changes.

Roadmap 2 is locked after Phase 5.2. Do not open any further phases in this roadmap. Start Roadmap 3 for the next work cycle.

## Working Principle

Roadmap 2 should improve the substrate, not widen the public tool catalog aggressively.

The main question for each change should be:

Does this make project connection, schema state, logging, or evaluation stronger in a way the later investigation roadmap will rely on?

If the answer is no, it probably does not belong in Roadmap 2.

## Required References

Read these before changing Roadmap 2 code:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [./phases/phase-3-live-db-binding-and-read-only-refresh.md](./phases/phase-3-live-db-binding-and-read-only-refresh.md)
- [./phases/phase-3.1-project-setup-and-binding-ux.md](./phases/phase-3.1-project-setup-and-binding-ux.md)
- [./phases/phase-3.2-package-and-connect-ux.md](./phases/phase-3.2-package-and-connect-ux.md)
- [./phases/phase-3.5-live-schema-scope-and-catalog-capture.md](./phases/phase-3.5-live-schema-scope-and-catalog-capture.md)
- [./phases/phase-3.5.1-live-schema-read-model-and-introspection.md](./phases/phase-3.5.1-live-schema-read-model-and-introspection.md)
- [./phases/phase-3.5.2-live-catalog-ingestion-hotfix.md](./phases/phase-3.5.2-live-catalog-ingestion-hotfix.md)
- [./phases/phase-3.6-cli-ux-production-polish.md](./phases/phase-3.6-cli-ux-production-polish.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)
- [../../test-project/setup.md](../../test-project/setup.md)
- [../../test-project/architecture.md](../../test-project/architecture.md)
- [../../test-project/benchmark-answer-key.md](../../test-project/benchmark-answer-key.md)

## Existing Surfaces To Reuse

Do not rebuild these from scratch:

- `apps/cli/src/index.ts`
- `services/indexer/src/attach.ts`
- `services/indexer/src/status.ts`
- `services/indexer/src/project-profile.ts`
- `services/indexer/src/schema-scan.ts`
- `packages/contracts/src/project.ts`
- `packages/store/src/global-store.ts`
- `packages/store/src/project-store.ts`
- existing Roadmap 1 MCP/HTTP/tool surfaces

Roadmap 2 should extend these seams rather than replace them casually.

## Constraint Set

### 1. Keep Roadmap 1 Working

The shipped MVP still matters.

Do not break:

- attach/index/status basics
- MCP transport
- shared tool registry
- existing DB tools
- public docs unexpectedly

### 2. Project Manifest Holds Metadata, Not Secrets

The project-local `.mako/` manifest should describe the project.

It should not hold:

- raw DB URLs
- committed secrets
- environment secrets copied into repo state

### 3. Live DB Access Is Explicit

Live DB access must remain:

- human-enabled
- project-scoped
- read-only

Do not reintroduce hidden or automatic DB binding at attach time.

The binding model should be strategy-based.

Roadmap 2 should prefer:

- `keychain_ref` for interactive local machines

And should support:

- `env_var_ref` for compatibility, headless, and CI-style flows

Roadmap 2 should not store plaintext secret values in:

- the project manifest
- project-local SQLite state
- global SQLite state

If SQLite is used in the binding system during Roadmap 2, it should hold metadata and references only.

### 4. Project Context Resolution Is Layered

Roadmap 2 should resolve project context in this order:

1. explicit tool arg
2. session active project
3. MCP `roots`
4. `_meta.cwd`
5. clear error

Rules:

- context resolution may be automatic
- project attachment is never automatic
- `roots` and `_meta.cwd` help resolve attached projects only
- if no attached project resolves cleanly, return a typed error

### 5. Repo-Derived Schema Comes First

Roadmap 2 should treat repo-derived schema sources as the default local substrate.

The target is one canonical local schema IR that later systems read from.

That IR may be produced in different modes:

- `repo_only`
- `repo_plus_live_verify`
- `live_refresh_enabled`

The IR shape stays stable across those modes.

What changes is:

- how it was built
- how recently it was refreshed
- whether it has been verified
- whether drift has been detected

Live DB access is for:

- verification
- refresh
- drift confirmation

Not for making every answer dependent on a live connection.

### 6. Freshness And Drift Are First-Class

Roadmap 2 must treat schema freshness as explicit state.

Do not model the snapshot as if it is always current.

At minimum, the snapshot contract should be able to express:

- source metadata
- source mode
- generated/refreshed timestamps
- verification timestamps
- fingerprint or diff basis
- drift-detected state

This is what allows the later trust layer to reason about whether schema knowledge is current.

### 7. Logging Must Be Structured

Logging must be useful for later:

- contradiction detection
- ranking
- benchmark comparison
- AI and ML inputs

If a logging design would not help later trust/evaluation work, it is too weak.

Roadmap 2 should implement this with append-only project-local fact tables first.

That means:

- immutable event rows in `project.db`
- reusable benchmark definitions separate from benchmark execution rows
- optional cold payload storage for sampled or redacted raw inputs/outputs
- benchmark report/result facts
- assertion result facts
- benchmark links back to the underlying tool-run history
- summary views or delayed derived summaries only when they stay subordinate to the raw facts

Do not prebuild:

- contradiction tables as a product feature
- ranking score systems
- hot-path trigger-heavy rollup machinery
- a second fully separate trace tree if benchmark rows can reference the existing tool-run chain

## Phase Sequence

1. `Phase 1` — project contract and attach UX
2. `Phase 2` — schema source discovery and snapshot backbone
3. `Phase 3` — live DB binding and read-only refresh
4. `Phase 3.1` — project setup and binding UX
5. `Phase 3.2` — package and connect UX
6. `Phase 3.2.1` — CLI publishing
7. `Phase 3.3` — project profile depth
8. `Phase 3.4` — profile polish
9. `Phase 3.4.1` — tsconfig alias hotfix
10. `Phase 3.5` — live schema scope and catalog capture
11. `Phase 3.5.1` — live schema read model and introspection
12. `Phase 3.5.2` — live catalog ingestion hotfix
13. `Phase 3.6` — CLI UX production polish
14. `Phase 4` — action and tool-run logging
15. `Phase 4.1` — benchmark and evaluation storage
16. `Phase 5` — ForgeBench validation and Roadmap 2 lock
17. `Phase 5.1` — codebase hygiene (first-pass cleanup: shared helpers, CLI split, dead code removal)
18. `Phase 5.2` — deep module split (final Roadmap 2 phase; deeper concentration-point splits before Roadmap 3)

Do not skip phase order without updating the roadmap docs.

## What The Implementation Agent Should Produce

By the end of Roadmap 2, the implementation should leave behind:

- a stable project manifest contract
- a stable attach/detach/status workflow
- a first-class setup flow that makes attach/index/bind/test understandable to a human operator
- schema snapshots that can exist without live DB dependency
- one stable local schema IR contract with explicit freshness/drift state
- an explicit per-project live DB binding model
- a reference-only secret contract for DB binding
- structured append-only run and benchmark logging
- a repeatable ForgeBench validation story

## What The Implementation Agent Should Not Do

Do not pull these forward into Roadmap 2 unless the roadmap itself is revised:

- Fenrir-class typed investigation family
- contradiction engine
- ranking or learned routing
- rollup-first analytics tables
- AI worker system
- embeddings
- local/cloud model harness
- continuous live DB sync
- row-data ingestion
- plaintext SQLite secret storage as a product pattern

## Expected CLI Direction

Roadmap 2 should move the CLI toward repo-local defaults:

- `mako project attach`
- `mako project detach`
- `mako project status`
- `mako project index`

when run in a repo, without requiring an explicit path every time.

Explicit refs should still work.

Roadmap 2 should also move toward a clearer operator front door such as:

- `mako project connect`
- or `mako project init`

where `mako` can guide the human through attach, manifest readiness, schema status, and optional DB binding without changing the underlying explicit contracts.

MCP-facing project resolution should move toward the same layered model:

- explicit arg
- session project
- `roots`
- `_meta.cwd`
- clear error

## Expected ForgeBench Role

ForgeBench is the main Roadmap 2 validation target.

Use it to prove:

- project attach works
- metadata detection works
- schema source detection works
- live DB binding works
- snapshot refresh works
- benchmark runs can be recorded

Roadmap 2 is not done until ForgeBench proves those paths.

## Documentation Rule

If implementation reveals a better pattern that materially changes Roadmap 2:

- update the Roadmap 2 docs deliberately
- keep the changes coherent across roadmap, handoff, and phase docs
- if the change is large enough, create a new documentation branch/version instead of silently reshaping the roadmap in place

## Immediate Starting Files

Most likely first-touch files for Phase 4:

- `packages/store/src/migration-sql.ts`
- `packages/store/src/project-store.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/attach.ts`
- `services/indexer/src/detach.ts`
- `test/smoke/core-mvp.ts`
- `devdocs/roadmap/version-2/phases/phase-4-logging-and-evaluation-backbone.md`
- `devdocs/roadmap/version-2/phases/phase-4.1-benchmark-and-evaluation-storage.md`

Use the phase docs for the actual slice-by-slice implementation brief.
