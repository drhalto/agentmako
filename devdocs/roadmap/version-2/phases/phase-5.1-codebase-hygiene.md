# Phase 5.1 Codebase Hygiene

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 5.1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 5.1.

## Prerequisites

Phase 5 (ForgeBench validation and Roadmap 2 lock) must be complete before this phase begins. Cleanup should happen after the codebase is validated, not before, so that validated behavior is the baseline the refactor must preserve.

## What Shipped

- `services/indexer/src/utils.ts` (new) — shared `durationMs`, `withGlobalStore`, `withProjectStore`, and `withResolvedProjectContext` helpers, replacing 6+ duplicated copies spread across the indexer service layer
- All indexer service files updated to import from shared helpers: `index-project.ts`, `status.ts`, `detach.ts`, `db-binding/bind.ts`, `db-binding/refresh.ts`, `db-binding/test.ts`, `db-binding/verify.ts`
- `apps/cli/src/index.ts` reduced from ~2000 lines to ~200 lines; all command logic extracted to 7 command modules under `apps/cli/src/commands/`: `default.ts`, `system.ts`, `status.ts`, `connect.ts`, `project.ts`, `project-db.ts`, `tools.ts`
- `apps/cli/src/shared.ts` (new) — shared CLI utilities extracted during the command split
- Dead internal CLI helpers removed during the command split
- Extension postgres bulk/single helpers audited and intentionally kept as-is (part of exported API surface)
- Workspace barrel `index.ts` files audited and kept unchanged (no public API changes)
- Net diff: 670 insertions, 2630 deletions (net −1960 lines)
- No new dependencies, no `package.json` changes, no public API changes

## Code Touchpoints

`services/indexer/`:

- `src/utils.ts` — created; `durationMs`, `withGlobalStore`, `withProjectStore`, `withResolvedProjectContext`
- `src/index-project.ts` — uses shared helpers from `utils.ts`
- `src/status.ts` — uses shared helpers from `utils.ts`
- `src/detach.ts` — uses shared helpers from `utils.ts`
- `src/db-binding/bind.ts` — uses shared helpers from `utils.ts`
- `src/db-binding/refresh.ts` — uses shared helpers from `utils.ts`
- `src/db-binding/test.ts` — uses shared helpers from `utils.ts`
- `src/db-binding/verify.ts` — uses shared helpers from `utils.ts`

`apps/cli/src/`:

- `index.ts` — reduced to bootstrap + thin dispatch (~200 lines)
- `shared.ts` — created; shared CLI utility functions
- `commands/default.ts` — created; no-arg / default behavior command
- `commands/system.ts` — created; system-level commands
- `commands/status.ts` — created; status command module
- `commands/connect.ts` — created; connect command module
- `commands/project.ts` — created; project subcommand group
- `commands/project-db.ts` — created; project db subcommand group
- `commands/tools.ts` — created; tools command module

Audited, intentionally unchanged:

- `extensions/postgres/src/columns.ts`, `foreign-keys.ts`, `rls.ts`, `table-schema.ts`
- Barrel `index.ts` files across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, `services/api`

## Goal

Reduce duplication, modularize the CLI, consolidate shared patterns, and leave the codebase clean enough that Roadmap 3 can extend it without inheriting Phase 3.x debt.

This phase ships no new features. Every changed line must preserve existing behavior. The smoke test suite is the behavior contract: if smoke passes before and after, the refactor is correct.

## Hard Decisions

- This is a refactoring phase — every changed line must preserve existing behavior.
- The smoke test suite is the behavior contract. If smoke passes before and after, the refactor is correct.
- Do not split files just to split them — only modularize where the current shape is actively painful. The CLI `main()` is painful. The duplicated helpers are painful. Scattered types are painful.
- Match existing code style even where you would do it differently.

## Why This Phase Exists

Phases 3.x through 4.1 accumulated real debt: duplicated utility functions copy-pasted across the indexer service layer, a CLI `main()` that has grown to ~2000 inlined lines, and scattered type exports across barrel files. None of that debt was wrong to incur during fast-moving feature work. Phase 5.1 pays it down before Roadmap 3 inherits it.

Cleanup after validation — not before — means the refactor has a known-good behavioral baseline (the ForgeBench-validated smoke suite from Phase 5) to compare against. A refactor that changes behavior will show up immediately in smoke.

## Scope In

- **Duplicated `durationMs` helpers** — at least 6 copies of `function durationMs(startedAt, finishedAt)` across `services/indexer/src/index-project.ts`, `services/indexer/src/db-binding/refresh.ts`, `services/indexer/src/db-binding/verify.ts`, `services/indexer/src/db-binding/bind.ts`, `services/indexer/src/db-binding/test.ts`, and `services/indexer/src/detach.ts`. Extract to a shared utility module in the indexer service.
- **Repeated `loadConfig + openGlobalStore + openProjectStore` boilerplate** — most indexer service functions repeat the same 10-line open/try/finally/close pattern. Consider a `withProjectContext` or `withStores` helper at the indexer level, similar to the one in `packages/tools/src/runtime.ts` but scoped to the indexer service layer.
- **CLI modularization** — `apps/cli/src/index.ts` is ~2000 lines with all commands inlined in `main()`. Split into command modules (e.g., `commands/connect.ts`, `commands/status.ts`, `commands/project-db.ts`) with `main()` as a thin dispatcher.
- **Extension postgres bulk/single helper consolidation** — `extensions/postgres/src/columns.ts`, `foreign-keys.ts`, `rls.ts`, and `table-schema.ts` each have both a bulk version and a single version that delegates to the bulk. The single versions are used by `packages/tools/src/db/index.ts` for single-table inspection. Assess whether the thin wrapper adds enough clarity to keep, or whether it is dead weight that can be removed in favor of calling the bulk API with one element.
- **Type export cleanup** — some types are exported from multiple packages or re-exported inconsistently. Audit the `index.ts` barrel files across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, and `services/api`.
- **Dead code audit** — check for unused imports, unexported functions, and orphaned types across the workspace. Phase 3.6 removed ~200 lines but there may be more.

## Scope Out

- New features, new tables, new CLI commands
- Changing the `SchemaIR` or manifest contract
- Changing the tool registry API
- Roadmap 3 work (embeddings, new tools, investigation composition)

## Architecture Boundary

### Owns

- Internal utility consolidation within the indexer service layer
- CLI file structure and dispatcher pattern
- Barrel file consistency across workspace packages
- Dead code removal

### Does Not Own

- Public API contracts — all exports must remain the same after this phase
- Store schemas and migrations — no schema changes
- The tool registry — no interface changes
- The test surface — smoke tests must pass unchanged; no new test additions required by this phase

## Contracts

### Input Contract

The codebase entering Phase 5.1 has passed Phase 5 ForgeBench validation. The smoke suite defines the full behavioral baseline.

### Output Contract

The codebase exiting Phase 5.1 must pass the identical smoke suite with no behavioral differences. All public exports remain stable. No new dependencies are added.

### Error Contract

If any smoke assertion fails after a refactor step, the step is incorrect and must be reverted or fixed before continuing. The refactor does not change what errors are surfaced — it only changes how the underlying code is organized.

## Execution Flow

1. Extract `durationMs` to a shared indexer utility module. Update all six call sites to import from the new location.
2. Extract the `loadConfig + openGlobalStore + openProjectStore` open/try/finally/close boilerplate into a `withProjectContext` or `withStores` helper. Update each indexer service function to use it.
3. Split `apps/cli/src/index.ts` into command modules under `apps/cli/src/commands/`. Make `main()` a thin dispatcher.
4. Audit the postgres extension bulk/single pairs. Remove single wrappers that add no value; keep those that add meaningful clarity.
5. Audit barrel files across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, `services/api`. Remove duplicate re-exports and resolve inconsistencies.
6. Run dead code audit. Remove unused imports, unexported dead functions, and orphaned types.
7. Run `corepack pnpm typecheck` and `corepack pnpm test` after each step. Do not accumulate broken states across steps.

## File Plan

Create:

- Shared indexer utility module — `services/indexer/src/utils.ts` or `services/indexer/src/lifecycle-helpers.ts` (exact name TBD at implementation time)
- CLI command modules under `apps/cli/src/commands/` — one file per command group (e.g., `connect.ts`, `status.ts`, `project-db.ts`)

Modify:

- `apps/cli/src/index.ts` — thin dispatcher; all command logic moves to `commands/`
- `services/indexer/src/index-project.ts` — use shared helpers
- `services/indexer/src/db-binding/refresh.ts` — use shared helpers
- `services/indexer/src/db-binding/verify.ts` — use shared helpers
- `services/indexer/src/db-binding/bind.ts` — use shared helpers
- `services/indexer/src/db-binding/test.ts` — use shared helpers
- `services/indexer/src/detach.ts` — use shared helpers
- `extensions/postgres/src/columns.ts` — consolidate if warranted
- `extensions/postgres/src/foreign-keys.ts` — consolidate if warranted
- `extensions/postgres/src/rls.ts` — consolidate if warranted
- `extensions/postgres/src/table-schema.ts` — consolidate if warranted
- Barrel `index.ts` files across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, `services/api` — cleanup only

Keep unchanged:

- All store schemas and migrations
- All contracts and types (shapes stay the same; only re-export paths may change)
- The tool registry
- The test surface

Actual files touched:

- `services/indexer/src/utils.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/status.ts`
- `services/indexer/src/detach.ts`
- `services/indexer/src/db-binding/bind.ts`
- `services/indexer/src/db-binding/refresh.ts`
- `services/indexer/src/db-binding/test.ts`
- `services/indexer/src/db-binding/verify.ts`
- `apps/cli/src/shared.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/commands/default.ts`
- `apps/cli/src/commands/system.ts`
- `apps/cli/src/commands/status.ts`
- `apps/cli/src/commands/connect.ts`
- `apps/cli/src/commands/project.ts`
- `apps/cli/src/commands/project-db.ts`
- `apps/cli/src/commands/tools.ts`

Audited and intentionally left unchanged:

- `extensions/postgres/src/columns.ts`
- `extensions/postgres/src/foreign-keys.ts`
- `extensions/postgres/src/rls.ts`
- `extensions/postgres/src/table-schema.ts`
- Barrel `index.ts` files across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, and `services/api`

Implementation notes:

- Extracted shared indexer lifecycle/store helpers, including the duplicated `durationMs()` implementation and reusable store-open/close helpers that preserve sync and async lifetimes.
- Split the CLI into command modules under `apps/cli/src/commands/` with `apps/cli/src/index.ts` reduced to a dispatcher and process bootstrap.
- Removed dead internal CLI helpers during the split, but did not remove public exports that were only lightly used because this phase must preserve the public surface.
- Audited the Postgres single-table wrappers and kept them because they are part of the exported package API and still provide the single-table call shape used by the tool layer.
- Audited workspace barrel files and left them unchanged in this pass because the safe export-preservation choice was to avoid widening or narrowing public entrypoints during a refactor-only phase.

## Verification

Required commands:

```bash
corepack pnpm typecheck
corepack pnpm test
git diff --stat   # should show net-negative or net-neutral line count
```

Required runtime checks:

- No new dependencies added (`package.json` files unchanged except for possible removal of now-unused internal imports)
- No public API changes — all exports present before Phase 5.1 remain present after

Required docs checks:

- This phase doc is updated to reflect the actual files touched once implementation completes

## Done When

- No duplicated utility functions across the indexer service layer
- CLI `main()` is a thin dispatcher that delegates to command modules under `apps/cli/src/commands/`
- The smoke suite passes identically before and after
- `git diff --stat` shows a net-negative or net-neutral line count
- No new dependencies introduced
- All barrel exports remain stable

## Risks And Watchouts

- The CLI split is the highest-risk change. `main()` at ~2000 lines will require careful extraction to avoid accidental scope changes or import ordering issues. Do this last, after the lower-risk utility consolidations are done and verified.
- The `withStores` helper pattern must preserve the exact try/finally/close behavior of the current boilerplate. Verify with tests that store handles are released correctly on both success and error paths.
- Barrel file cleanup can silently break consumers if a re-exported type is removed rather than merely de-duplicated. Verify with `typecheck` after each barrel change.
- The postgres extension consolidation is the lowest-risk and highest-clarity item. Start there to build confidence before touching CLI.

## References

- [./phase-5-forgebench-validation-and-roadmap-2-lock.md](./phase-5-forgebench-validation-and-roadmap-2-lock.md) — must be complete before this phase starts
- [../roadmap.md](../roadmap.md) — canonical phase order and Roadmap 2 intent
- [../handoff.md](../handoff.md) — execution context and constraints
