# Phase 5.2 Deep Module Split

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 5.2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 5.2.

## Prerequisites

Phase 5.1 (codebase hygiene) must be complete. The shared indexer helpers (`withGlobalStore`, `withProjectStore`, `withResolvedProjectContext`) and the CLI command-module split shipped in Phase 5.1 are the direct substrate this phase builds on.

## Goal

Split the remaining large files by concern without changing any public API, SQL schema, method signature, or observable behavior. Leave the codebase modular enough that Roadmap 3 can extend any layer independently.

## Hard Decisions

- Every changed line must preserve existing behavior — the smoke suite is the contract.
- Internal module splits use the pattern: extract functions into a `-helpers.ts` or `-internal.ts` file, re-export through the original module so external imports do not change.
- Do not split just to split — only modularize where the current shape blocks independent work in Roadmap 3.
- Error text and candidate ordering in resolver outputs must be preserved exactly (smoke tests assert on them).

## Why This Phase Exists

Phase 5.1 paid down the most visible debt: duplicated utilities, a monolithic CLI dispatcher, and dead code. It did not touch the deepest concentration points — `project-store.ts`, `server.ts`, `runtime.ts`, and `registry.ts` — because those are larger, riskier splits that warranted their own dedicated pass.

Roadmap 3 will extend individual layers independently. If `project-store.ts` mixes six unrelated concerns, extending one concern pulls in all six. If `server.ts` holds inline route behavior, adding a new route means touching the composition file directly. This phase removes those blockers before Roadmap 3 opens.

This is the final Roadmap 2 phase. After it ships, Roadmap 2 is locked and Roadmap 3 begins.

## Scope In

Six targets, ordered by priority. Each section includes the actual code structure found by AST analysis so the implementing agent knows exactly what to move.

**1. `packages/store/src/project-store.ts` (2882 lines) — split by concern**

The file has ~30 standalone helper functions (lines 329–896) plus a `ProjectStore` class (line 898–2882) with ~65 methods. The helpers and methods group into six clear concerns:

- **Index runs** (lines 338–353 mapper, class lines 967–1041): `beginIndexRun`, `getIndexRun`, `getLatestIndexRun`, `finishIndexRun`, `replaceIndexSnapshot`, `getScanStats` plus `mapIndexRunRow`. Also the FTS trigger helpers `dropChunkFtsTriggers`/`recreateChunkFtsTriggers` (lines 598–657).
- **Lifecycle events** (lines 355–371 mapper, class lines 1043–1131): `insertLifecycleEvent`, `queryLifecycleEvents` plus `mapLifecycleEventRow`.
- **Tool runs** (lines 373–392 mapper, class lines 1133–1238): `insertToolRun`, `queryToolRuns` plus `mapToolRunRow`.
- **Benchmarks** (lines 394–482 six mappers, class lines 1240–1656): all `saveBenchmark*`, `getBenchmark*`, `listBenchmark*`, `deleteBenchmark*`, `insertBenchmark*` methods plus the six `mapBenchmark*Row` helpers and the `createBenchmarkRecordError`/`createBenchmarkLinkError` error constructors (lines 588–596).
- **Schema snapshots + read model** (lines 673–890 read-model rebuild, class lines 2194–2380): `saveSchemaSnapshot`, `loadSchemaSnapshot`, `clearSchemaSnapshot`, `markSchemaSnapshotVerified`, `markSchemaSnapshotDrift` plus `clearSchemaSnapshotReadModel`/`rebuildSchemaSnapshotReadModel` (211 lines).
- **Code queries + traces** (class lines 1658–2882): `findFile`, `searchFiles`, `searchRoutes`, `listRoutes`, `listFiles`, `listAllImportEdges`, `listImportsForFile`, `listDependentsForFile`, `listRoutesForFile`, `listSymbolsForFile`, `getFileContent`, `getFileDetail`, `searchSchemaObjects`, `listSchemaObjects`, `listSchemaUsages`, `getSchemaObjectDetail`, `saveAnswerTrace`, `getAnswerTrace`, plus `loadDbBindingState`, `saveDbBindingTestResult`, `markDbBindingVerified`, `markDbBindingRefreshed`, `getStatus`.

Extract each concern into a helper module (e.g., `project-store-benchmarks.ts`). Each module exports standalone functions that take `db: DatabaseSync` as the first argument. The `ProjectStore` class methods become thin one-line delegates: `saveBenchmarkSuite(input) { return saveBenchmarkSuiteImpl(this.db, input); }`. The class stays in `project-store.ts` and remains the only public export — the helper modules are internal.

**2. `services/api/src/server.ts` (778 lines) — extract route handlers**

The file has ~25 inline utility functions (lines 96–333) plus `createMcpServer` (line 335–390) plus `createHttpApiApp` (line 392–778). Inside `createHttpApiApp`, the route registrations are inline `app.get`/`app.post`/`app.all` handlers for: health, projects list, project attach/detach/index/status, DB bind/unbind/test/verify/refresh, schema discovery, tool list/call, answer ask, MCP streamable-http endpoint, and a catch-all 404.

Note: DB operations (bind, unbind, test, verify, refresh, schema discovery) exist as `MakoApiService` methods but have **no HTTP routes** — they are CLI-only. The server only exposes project CRUD, tool invocation, answer ask, and MCP. Do not create DB route modules that don't exist.

Split into:
- `routes/projects.ts` — project list, attach, detach, index, status (5 endpoints)
- `routes/tools.ts` — tool list, tool call (2 endpoints)
- `routes/answers.ts` — answer ask (1 endpoint)
- `mcp.ts` — `createMcpServer` + the MCP streamable-http route setup

The health endpoint is small enough to stay inline in `createHttpApiApp`.

Keep the inline utility functions (request parsing, response writing, logging) in `server.ts` or a `server-utils.ts` — they're used across all routes and don't belong to any one route module.

Implementation note: the route handler logic may move into route modules, but the `app.get`/`app.post`/`app.all` registration lines must remain in `server.ts` if needed to preserve indexed route location and smoke-test output. The smoke suite is the higher-order contract.

**3. `packages/tools/src/runtime.ts` (562 lines) — extract resolver primitives**

The file has three layers:
- **Error constructors** (lines 78–95): `createAmbiguityError`, `createNotFoundError`, `createProjectNotAttachedError`, `createMissingProjectContextError`. These are used by every resolver and should be in their own `resolver-errors.ts`.
- **Project resolution** (lines 99–324): `pickBestLocationCandidate`, `createDetachedLocationCandidate`, `resolveProjectFromLocations`, `resolveProject`, `resolveProjectFromToolContext`, `borrowGlobalStore`. This is the project-location subsystem — it could be `project-resolver.ts`.
- **Entity resolution** (lines 327–537): `normalizeFileQuery`, `collectExactFileCandidates`, `collectExactRouteCandidates`, `collectExactSchemaObjectCandidates`, `resolveIndexedFilePath`, `resolveIndexedRoute`, `resolveIndexedSchemaObject`, `resolveSchemaObjectIdentifier`, `resolveRouteIdentifier`, `resolveAuthFeature`, `withProjectContext`. These are the per-entity resolvers that all follow the same collect-candidates → exactly-one → return / ambiguity-error / not-found pattern. They could be `entity-resolver.ts`.

The critical constraint: `resolveIndexedFilePath`, `resolveIndexedRoute`, `resolveIndexedSchemaObject`, and `resolveAuthFeature` are imported directly by tool implementations across `packages/tools/src/`. Their export names and error shapes must not change. Re-export through `runtime.ts` if moving them.

**4. `packages/tools/src/registry.ts` (483 lines) — separate concerns**

Three distinct sections:
- **Tool definitions** (lines 238–398): the `TOOL_DEFINITIONS` array (26 tool entries), `TOOL_DEFINITION_MAP`, and the `listToolDefinitions`/`getToolDefinition`/`registerToolDefinition`/`unregisterToolDefinition` functions. This is a static catalog — move to `tool-definitions.ts`.
- **Invocation logging** (lines 80–237): `safeJsonStringify`, `summarizeJsonValue`, `toErrorText`, `classifyToolFailure`, `extractProjectLocator`, `resolveToolProjectForLogging`, `writeToolInvocationLogs`. These are the Phase 4 logging helpers — move to `tool-invocation-logging.ts`.
- **Invocation entry point** (lines 427–483): `invokeTool` itself. This is the public entry that wires validation + execution + logging. It stays in `registry.ts` and imports from the other two.

Also `schemaToJson` (line 80) and the `MakoToolDefinition` interface (line 68) go with the definitions file.

**5. `services/indexer/src/attach.ts` (127 lines) — use shared helpers**

Small file but still uses the manual `loadConfig → openGlobalStore → openProjectStore → try/finally close` pattern that Phase 5.1's `withGlobalStore`/`withProjectStore` helpers replaced everywhere else. The `attachProject` function (line 33) opens both stores, does work, then closes in a finally. Replace with nested `withGlobalStore` + `withProjectStore` calls from `services/indexer/src/utils.ts`. Also uses a manual `durationMs` calculation for lifecycle logging — use the shared `durationMs` from utils.ts.

The `{ logLifecycleEvent }` behavior option (added in Phase 4) must be preserved — the lifecycle event insert happens inside `attachProject` conditionally. The shared helpers must not break this conditionality.

**6. `apps/cli/src/shared.ts` (857 lines) — split only if growing (low priority)**

Currently contains: color constants, `printUsage`, CLI arg parsers (6 parser functions), format helpers (`formatTable`, `formatProjectList`, `formatToolList`), prompt helpers (`defaultKeychainRefFor`, `printDbConnectionGuide`), status rendering (`computeNextStepHints`, `printProjectStatusBlock`, `printNextStepHints`), and schema scope utility (`loadSchemaScopeFromStatus`).

Natural split if the file gets painful:
- `cli-format.ts` — `formatTable`, `formatProjectList`, `formatToolList`, `color`, `COLORS`
- `cli-parse.ts` — all 6 `parse*Args` functions + `CliOptions` + `parseGlobalArgs` + `shouldUseInteractive`
- `cli-status.ts` — `computeNextStepHints`, `printProjectStatusBlock`, `printNextStepHints`, `loadSchemaScopeFromStatus`, `printUsage`
- `cli-prompts.ts` — `defaultKeychainRefFor`, `printDbConnectionGuide`, `formatWarning`

But at 857 lines this is not urgent. Only do it if the other 5 targets are done.

### Small cleanup (also in scope)

- `services/api/src/routes.ts` (16 lines): contains `API_ROUTES` — verify whether any consumer imports it. If unused outside the repo, remove.
- Any exported-but-internal-only types from the Phase 5.1 audit that were flagged but not acted on.

## Scope Out

- `extensions/postgres/src/{columns,foreign-keys,rls,table-schema}.ts` — thin wrappers, part of exported API, still useful for tool layer. Not worth touching.
- New features, new tables, new CLI commands.
- SQL schema changes, migration changes.
- Public API changes (all exports stay the same).
- Roadmap 3 work.

## Architecture Boundary

### Owns

- Internal module structure of `packages/store/src/project-store.ts` and its extracted helper files.
- Internal module structure of `packages/tools/src/registry.ts`, `runtime.ts`, and extracted helpers.
- Internal route module structure of `services/api/src/`.
- The wiring of `services/indexer/src/attach.ts` to the Phase 5.1 shared helpers.

### Does Not Own

- Public class and function signatures across any package.
- SQL migration files.
- The extension postgres package.
- The test surface beyond removing dead-code references.

## Contracts

### Input Contract

All public imports from other packages continue to resolve to the same exported symbols. No external caller changes an import path.

### Output Contract

The smoke suite passes identically before and after. No new dependencies are added. `git diff --stat` shows net-negative or net-neutral line count per split file.

### Error Contract

Exact error text in resolver outputs is preserved unchanged. Candidate ordering in ambiguity errors is preserved unchanged.

## Execution Flow

1. Split `project-store.ts` — extract concern modules, delegate from the class, verify smoke.
2. Split `server.ts` — extract route handler modules, reduce to composition-only, verify smoke.
3. Split `runtime.ts` — extract resolver primitives, centralize error construction, verify smoke.
4. Split `registry.ts` — extract tool definitions and invocation helpers, verify smoke.
5. Migrate `attach.ts` — replace manual open/close boilerplate with Phase 5.1 helpers, verify smoke.
6. If time allows: split `shared.ts` where it is actively painful.
7. Clean up `API_ROUTES` dead code and any remaining flagged types from the Phase 5.1 audit.
8. Final full smoke run.

## File Plan

Create:

- `packages/store/src/project-store-index.ts` — index runs, FTS trigger helpers, replaceIndexSnapshot, getScanStats
- `packages/store/src/project-store-lifecycle.ts` — lifecycle events insert/query + mapper
- `packages/store/src/project-store-tool-runs.ts` — tool runs insert/query + mapper
- `packages/store/src/project-store-benchmarks.ts` — all benchmark definition + result CRUD, six mappers, error constructors
- `packages/store/src/project-store-snapshots.ts` — snapshot save/load/clear, verified/drift, read-model rebuild (211 lines)
- `packages/store/src/project-store-queries.ts` — file/route/symbol/schema search, answer traces, DB binding state, getStatus
- `services/api/src/routes/projects.ts` — project list, attach, detach, index, status (5 endpoints)
- `services/api/src/routes/tools.ts` — tool list, tool call (2 endpoints)
- `services/api/src/routes/answers.ts` — answer ask (1 endpoint)
- `services/api/src/mcp.ts` — createMcpServer + MCP streamable-http route
- `services/api/src/server-utils.ts` — shared request parsing, response writing, logging helpers (if extracted from server.ts)
- `packages/tools/src/tool-definitions.ts` — TOOL_DEFINITIONS array, TOOL_DEFINITION_MAP, list/get/register/unregister, MakoToolDefinition interface, schemaToJson
- `packages/tools/src/tool-invocation-logging.ts` — safeJsonStringify, summarizeJsonValue, toErrorText, classifyToolFailure, extractProjectLocator, resolveToolProjectForLogging, writeToolInvocationLogs
- `packages/tools/src/resolver-errors.ts` — createAmbiguityError, createNotFoundError, createProjectNotAttachedError, createMissingProjectContextError
- `packages/tools/src/project-resolver.ts` — pickBestLocationCandidate, createDetachedLocationCandidate, resolveProjectFromLocations, resolveProject, resolveProjectFromToolContext, borrowGlobalStore
- `packages/tools/src/entity-resolver.ts` — normalizeFileQuery, collect*Candidates, resolveIndexed*, resolveAuthFeature, withProjectContext

Modify:

- `packages/store/src/project-store.ts` — thin class: constructor, close, getOperationalState, loadProjectProfile, saveProjectProfile as direct methods; all other methods become one-line delegates to the concern modules above
- `services/api/src/server.ts` — middleware + route registration only; handler logic imported from route modules so indexed route location stays stable
- `packages/tools/src/runtime.ts` — re-exports from resolver-errors, project-resolver, entity-resolver for backwards compat
- `packages/tools/src/registry.ts` — imports from tool-definitions + tool-invocation-logging; keeps invokeTool as the public entry
- `services/indexer/src/attach.ts` — replace manual store open/close with withGlobalStore/withProjectStore from utils.ts

Keep unchanged:

- All SQL migrations in `packages/store/src/migration-sql.ts`
- All contracts/types in `packages/contracts/`
- The extension postgres package
- The test surface (except removing dead-code references if any)
- The barrel `index.ts` files — re-exports stay identical

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test` (full smoke suite)
- `git diff --stat` — must show net-negative or net-neutral line count per split file

Required runtime checks:

- No new dependencies added
- No public API changes
- All existing imports from other packages continue to work unchanged

Required docs checks:

- This phase file updated to `Complete` with `What Shipped` and `Code Touchpoints` sections
- `roadmap.md` phase status flipped
- `handoff.md` current target updated
- `START_HERE.md` current phase pointer updated

## Done When

- `project-store.ts` is split by concern with one public class
- `server.ts` is middleware + route registration only, with route logic extracted into modules
- `runtime.ts` resolver patterns are centralized
- `registry.ts` tool definitions are in their own file
- `attach.ts` uses the shared indexer helpers from Phase 5.1
- Smoke suite passes identically
- Dead code identified in Phase 5.1 audit is removed

## Risks And Watchouts

- `runtime.ts` error text and candidate ordering are smoke-tested — any change to the exact string or sort order will break assertions. Extract carefully and test at each step.
- `project-store.ts` is large and touches many migration-defined tables. The class surface must stay identical; only the internal implementation moves.
- `server.ts` route extraction must preserve middleware ordering. Express route registration order matters for error handling and auth middleware — verify end-to-end HTTP behavior, not just typechecking.
- `attach.ts` close ordering matters for SQLite WAL integrity — the Phase 5.1 helpers must preserve the exact teardown sequence.
- `apps/cli/src/shared.ts` split is explicitly low priority. Do not start it if the other five targets have consumed all the safe refactoring budget.

## What Shipped

- `packages/store/src/project-store.ts` split from 2882 lines to a 499-line thin delegate class plus six concern modules: `project-store-benchmarks.ts` (614 lines), `project-store-index.ts` (458), `project-store-lifecycle.ts` (131), `project-store-queries.ts` (967), `project-store-snapshots.ts` (453), `project-store-tool-runs.ts` (148). Each module exports `*Impl` functions taking `db: DatabaseSync`; class methods are one-line delegates.
- `services/api/src/server.ts` split from 778 to a 283-line composition-only file plus `routes/projects.ts` (82), `routes/tools.ts` (42), `routes/answers.ts` (75), `mcp.ts` (154), `server-utils.ts` (285). Route modules use a `createXRouteHandlers` factory pattern. Route registration stays in `server.ts` so indexed route location and smoke-visible behavior are preserved.
- `packages/tools/src/runtime.ts` split from 562 to a 55-line re-export barrel plus `resolver-errors.ts` (27), `project-resolver.ts` (253), `entity-resolver.ts` (282). All existing imports resolve through re-exports; exact error text and candidate ordering preserved.
- `packages/tools/src/registry.ts` split from 483 to an 83-line invokeTool entry plus `tool-definitions.ts` (256) and `tool-invocation-logging.ts` (165).
- `services/indexer/src/attach.ts` migrated to use shared `withGlobalStore`, `withProjectStore`, and `durationMs` from `utils.ts`; conditional lifecycle-event logging and close ordering preserved.
- `apps/cli/src/shared.ts` confirmed low priority and not touched per spec.
- `services/api/src/routes.ts` (`API_ROUTE_DEFINITIONS`) confirmed NOT dead code — actively used by `server.ts` for path matching, CORS, and health listing; kept as-is.

## Code Touchpoints

packages/store/src/:
- Created: `project-store-benchmarks.ts`, `project-store-index.ts`, `project-store-lifecycle.ts`, `project-store-queries.ts`, `project-store-snapshots.ts`, `project-store-tool-runs.ts`
- Modified: `project-store.ts`

packages/tools/src/:
- Created: `resolver-errors.ts`, `project-resolver.ts`, `entity-resolver.ts`, `tool-definitions.ts`, `tool-invocation-logging.ts`
- Modified: `runtime.ts`, `registry.ts`

services/api/src/:
- Created: `mcp.ts`, `server-utils.ts`, `routes/projects.ts`, `routes/tools.ts`, `routes/answers.ts`
- Modified: `server.ts`, `routes.ts`

services/indexer/src/:
- Modified: `attach.ts`

## References

- [./phase-5.1-codebase-hygiene.md](./phase-5.1-codebase-hygiene.md) — prerequisite; ships the shared helpers this phase relies on
- [../roadmap.md](../roadmap.md) — roadmap order and status
- [../handoff.md](../handoff.md) — execution handoff
