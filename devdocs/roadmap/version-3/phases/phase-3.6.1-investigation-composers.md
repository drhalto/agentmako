# Phase 3.6.1 Investigation Composers

Status: `Complete` (shipped 2026-04-17)

Follow-on planning note (2026-04-17): Roadmap 3 was later reopened for Phase 3.7 semantic retrieval expansion before Roadmap 4 begins. This file remains the canonical ship record for 3.6.1 itself.

This file is the canonical planning and ship record for Roadmap 3 Phase 3.6.1 — the six remaining composers, shipped on top of the substrate 3.6.0 lifted. The detailed composer catalog below is preserved as planning history; read `Shipped Outcome` and `Deviations From Spec At Ship Time` first for the actual landed state.

Use [../roadmap.md](../roadmap.md) for roadmap order. Use [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md) for the substrate work this phase depends on. Use [../../../scratch/phase-3.6-flow-map.md](../../../scratch/phase-3.6-flow-map.md) for the visual pipeline map.

## Shipped Outcome

Phase 3.6.1 shipped all six remaining composers as deterministic, snapshot-strict, `composer`-category tools registered in `TOOL_DEFINITIONS`:

- `preflight_table` — full table surface (columns/indexes/FKs/RLS/triggers via `getSchemaTableSnapshot`), routes matching the table name, and ast-grep `z.object({ $$$ })` zod schemas whose local code/comment window mentions the table.
- `cross_search` — cross-source fan-out across `searchCodeChunks`, `searchSchemaObjects`, `searchSchemaBodies`, `searchRoutes`, and `ftsSearchHarnessMemories` / `getHarnessMemoryByRowid`. The retrieval-layer composer; no ast-grep.
- `trace_edge` — route metadata for the handler, ast-grep `supabase.functions.invoke('$NAME', …)` and `fetch('/functions/v1/$NAME')` callers from FTS-retrieved files, ast-grep `$C.from('$TABLE')` / `$C.rpc('$FN', $$$)` on the handler's own file, and DB triggers whose executable body text references the edge.
- `trace_error` — ast-grep `throw new $ERR($MSG)` and `try { $$$TRY } catch ($E) { $$$HANDLER }` filtered to hits whose match text contains the term, over FTS+LIKE retrieved files, plus PL/pgSQL bodies via `searchSchemaBodies`.
- `trace_table` — full `SchemaTable` surface + schema-scoped `listFunctionTableRefs({ tableName, targetSchema })` + ast-grep `$C.from('$TABLE')` over FTS+LIKE-retrieved files.
- `trace_rpc` — `searchSchemaObjects` filtered to the RPC definition, optional overload narrowing via `argTypes`, body-text-proven `searchSchemaBodies` hits for OTHER DB bodies referencing the RPC, overload-aware `listFunctionTableRefs({ rpcSchema, rpcName, argTypes })`, and ast-grep `$C.rpc('$FN', $$$)` callers.

Supporting code shipped in the same phase:

- Nine new evidence-block producers in `packages/tools/src/composers/_shared/blocks.ts`: `blocksFromSchemaColumns`, `blocksFromSchemaIndexes`, `blocksFromSchemaForeignKeys`, `blocksFromSchemaRls`, `blocksFromSchemaTriggers`, `blocksFromChunkHits`, `blocksFromSchemaBodies`, `blocksFromFunctionTableRefs`, `blocksFromAstHits`. All consume shared contract types exclusively; no local shape redefinition.
- Six input + six output schemas in `packages/contracts/src/tools.ts`, mirroring the `TraceFileToolInput/Output` pattern exactly (`AnswerToolResultBaseSchema.extend({ toolName: z.literal(...) })`). `ToolInput` / `ToolOutput` unions extended accordingly.
- Six new smokes (`test/smoke/composer-{preflight-table,cross-search,trace-edge,trace-error,trace-table,trace-rpc}.ts`) appended to the root `test:smoke` chain.

Verification at ship time:

- `corepack pnpm typecheck` — clean workspace
- `corepack pnpm run test:smoke` — 20/20 passing (14 pre-3.6.1 + 6 new composer smokes)

## Deviations From Spec At Ship Time

- **FTS retrieval is unioned with `searchFiles` LIKE fallback** for `trace_error`, `trace_table`, and `trace_rpc`. The shipped `extractSearchTokens` helper expands camelCase identifiers (`UserNotFound` → `user AND not AND found`) and AND-joins the tokens; file content tokenizes camelCase as a single token, so the expanded AND fails against indexed content that doesn't carry a search_text column for each line. `searchFiles` has a LIKE path that substring-matches content directly, so unioning the two guarantees that camelCase error/table/RPC names still yield candidate files for the ast-grep proof step. `trace_edge` and `preflight_table` do not need this — they search on names that happen to tokenize cleanly.
- **No ast-grep YAML rule packs shipped** under `composer-rules/`. Each composer encodes its patterns inline (`$C.from('$TABLE')` etc.) via `findAstMatches(...)`. This keeps the composer files self-contained and removes a file-resolution hazard when the CLI is bundled; rule packs remain a future option if composer patterns multiply.
- **No sub-phase docs shipped** for `trace_rpc` or `trace_table`. Both landed at their predicted size (`trace_rpc` ~115 LOC including comments, `trace_table` ~130 LOC). Their algorithm descriptions live in-file and in the "Composer Catalog" section below.
- **No benchmark runner shipped** in this phase. The kickoff default of "defer" held — composer smokes verify behavior. Benchmark case seeding is deferred to a Roadmap 4 follow-up per the standing 3.6 decision.
- **`trace_error` uses one ast-grep throw pattern**, not two. The original plan called for both `throw new Error($MSG)` and `throw new $ERR($MSG)`; the subclass pattern matches the `Error` class too and would double-emit. The shipped composer uses only `throw new $ERR($MSG)` with the `$ERR` capture carrying the class name.

## Prerequisites

Phase 3.6.1 requires **Phase 3.6.0 Substrate Lift** complete. 3.6.0 delivers:

- **Gap 1 closed** — harness tool-registry bridge so agent turns can call any registered tool through `streamText`.
- **Gap 2 closed** — indexer produces symbol-level chunks with real line ranges; `searchCodeChunks(term)` returns precise callers.
- **Gap 3 closed** — schema snapshot carries RPC/trigger body text and an overload-aware `schema_snapshot_function_refs` edge table, so `listFunctionTableRefs(...)` is safe on overloaded RPCs.
- **Shared composer infrastructure** — `_shared/context.ts`, `_shared/packet.ts`, `_shared/blocks.ts`, `_shared/ast-patterns.ts`, `_shared/define.ts` all shipped.
- **AnswerPacketCard web component** — composer output renders as a styled evidence panel.
- **`trace_file` composer** — tracer-bullet proving the whole stack end-to-end.

Phase 3.6.1 also continues to require Phases 3.0–3.5.1 complete and Roadmap 2 Phase 4.1 (benchmark storage, shipped).

## Goal

Deliver the remaining six composers - `cross_search`, `trace_rpc`, `trace_table`, `trace_error`, `trace_edge`, `preflight_table` - on top of 3.6.0's substrate. Each is ~30-80 lines of orchestration using the shared `_shared/` infrastructure.

`trace_file` already shipped in 3.6.0. Phase 3.6.1 is mechanical: repeat the pattern six times, one file per composer, with composer-specific orchestration and `composer-rules/*.yml` ast-grep rule packs.

## Hard Decisions

Inherited from 3.6.0 — no new decisions in this phase.

1. **Composers reuse `AnswerPacket`** - one packet shape across all tools. Composers produce packets with flat composer query kinds (`"trace_file"`, `"preflight_table"`, `"cross_search"`, `"trace_edge"`, `"trace_error"`, `"trace_table"`, `"trace_rpc"`), matching the tool names and `isComposerQueryKind(...)`.
2. **Composers are snapshot-strict** — no live DB, ever. `db_*` tools stay in their own lane.
3. **Five-layer architecture** — accessors / producers / composers / packet helpers / defineComposer factory. No composer touches SQLite directly.
4. **Sub-phase docs are optional** — write `phase-3.6.x-<name>.md` only if a composer's algorithm outgrows this parent doc. Likely candidates: `trace_rpc`, `trace_table`.
5. **Benchmark seeding stayed deferred** — composer smokes are the verification surface for 3.6.1. Benchmark-case seeding remains a later follow-up, not a phase requirement.

See [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md) for the full rationale.

## Composer Catalog

Build order (shortest → longest algorithm):

### 1. `preflight_table`

Pre-build checklist for a table — everything an agent needs before touching it.

**Accessors used:** `getSchemaTableSnapshot(schema, table)`, `searchSchemaObjects`, `listSchemaUsages(objectId)`, `searchCodeChunks`, `listRoutesForFile`.

**Evidence blocks:** columns, FKs, RLS policies, triggers, indexes, related routes, zod schemas detected via ast-grep.

**ast-grep patterns:** `z.object({ $$$FIELDS })` where the surrounding file mentions the table name; `z.$TYPE(...)` variants for schema-matching.

**Size:** ~40 LOC.

### 2. `cross_search`

Cross-source search over code, routes, schema objects, function bodies, and memories.

**Accessors used:** `searchCodeChunks`, `searchSchemaObjects`, `searchSchemaBodies`, `searchRoutes`, `recallMemories`.

**Evidence blocks:** chunk hits grouped by kind (`symbol` preferred, `file` fallback), schema matches, route matches, memory matches.

**ast-grep patterns:** agents can pass custom patterns through an optional input param; default canned rules pulled from `composer-rules/cross-search-canned.yml`.

**Size:** ~50 LOC.

### 3. `trace_edge`

Trace a handler / edge function end-to-end: source, DB triggers that invoke it, app-code callers, and tables the edge handler's own code touches.

**Important data-source correction.** `schema_snapshot_function_refs` is keyed by **PL/pgSQL RPC identity** — it answers "which DB RPC bodies reference which tables." Edge functions are **application code** (TypeScript handler files), not RPCs, so `listFunctionTableRefs({ rpcName: edgeName })` would always return empty. For "tables this edge touches" we have to go through the handler's **own code chunks** via ast-grep patterns, exactly like `trace_table` does for `.from()` call sites — just scoped to the edge's file path instead of the whole repo.

**Accessors used:** `listRoutesForFile`, `searchCodeChunks` (scoped to the edge's file), `getFileContent`.

**Evidence blocks:** route metadata, app-code caller chunks (who invokes the edge), handler-scoped chunks showing `.from()` / `.rpc()` call sites (what the edge touches), DB triggers that invoke the edge via `net.http` — the latter found by `searchSchemaBodies(edgeName)` intersected with trigger-owner metadata from the read model.

**ast-grep patterns:**
- Who calls the edge: `fetch('/functions/v1/$NAME', $$$ARGS)`, `supabase.functions.invoke('$NAME', $$$)`.
- What the edge touches (run scoped to the handler file's chunks): `$C.from('$TABLE')`, `$C.rpc('$FN', $$$)`.

**Size:** ~60 LOC (grew from 50 with the scoped-chunk + body-search dual source).

### 4. `trace_error`

Trace an error symbol or message across throw sites, catch blocks, edge functions, and DB function bodies.

**Accessors used:** `searchCodeChunks`, `searchSchemaBodies`.

**Evidence blocks:** throw-site chunks, catch-block chunks, schema body matches.

**ast-grep patterns:** `throw new Error($MSG)`, `throw new $ERR($MSG)`, `throw $X` (where `$X.message` contains the term), `try { $$$ } catch ($E) { $$$ }`.

**Size:** ~60 LOC (multiple ast-grep patterns, need to merge hits).

### 5. `trace_table`

Full table trace: schema + indexes + FKs + RLS + triggers + code queries + RPCs referencing + TS type usage.

**Accessors used:** `getSchemaTableSnapshot(schema, table)`, `listFunctionTableRefs({ tableName: table })`, `searchCodeChunks`, `searchSchemaObjects`, `listSchemaUsages`.

**Evidence blocks:** columns, FKs, RLS, triggers, indexes, caller chunks, RPC-ref edges, schema usages.

**ast-grep patterns:** `$C.from('$TABLE')`, `$C.from($TABLE_VAR)` with constraint on the var name.

**Size:** ~70 LOC. **Likely candidate for sub-phase doc** (`phase-3.6.1-trace-table.md`).

### 6. `trace_rpc`

Full RPC lifecycle: DB source + code callers + triggers using it + DB functions that call it + TS signature.

**Accessors used:** `searchSchemaBodies(rpcName)`, `searchCodeChunks`, `listFunctionTableRefs({ rpcName })`, `searchSchemaObjects`.

**Evidence blocks:** RPC source body, caller chunks, trigger/function bodies referencing it, and table-ref edges emitted from the RPC body.

**ast-grep patterns:** `$C.rpc('$FN', $$$ARGS)`, `supabase.rpc('$FN', $$$)`.

**Size:** ~80 LOC. **Likely candidate for sub-phase doc** (`phase-3.6.1-trace-rpc.md`).

## Execution Flow

1. Pick the next composer in build order (start with `preflight_table`).
2. Write the composer file at `packages/tools/src/composers/<name>.ts` using `defineComposer`.
3. If ast-grep rules are needed, add `composer-rules/<name>.yml`.
4. Add its `MakoToolDefinition` to `TOOL_DEFINITIONS`.
5. Add input schema to `packages/contracts/src/tools.ts`, re-export from index.
6. Write smoke test at `test/smoke/composer-<name>.ts` (happy path + one degraded-freshness path).
7. Run `corepack pnpm run test:smoke`, confirm all pass.
8. If the composer's algorithm exceeded ~80 LOC or introduced novel decisions, write `phase-3.6.x-<name>.md`.
9. Repeat for the next composer.

## File Plan

### Create

- `packages/tools/src/composers/preflight-table.ts`
- `packages/tools/src/composers/cross-search.ts`
- `packages/tools/src/composers/trace-edge.ts`
- `packages/tools/src/composers/trace-error.ts`
- `packages/tools/src/composers/trace-table.ts`
- `packages/tools/src/composers/trace-rpc.ts`
- `composer-rules/preflight-table.yml` (optional)
- `composer-rules/cross-search-canned.yml`
- `composer-rules/trace-edge.yml`
- `composer-rules/trace-error.yml`
- `composer-rules/trace-table.yml`
- `composer-rules/trace-rpc.yml`
- `test/smoke/composer-preflight-table.ts`
- `test/smoke/composer-cross-search.ts`
- `test/smoke/composer-trace-edge.ts`
- `test/smoke/composer-trace-error.ts`
- `test/smoke/composer-trace-table.ts`
- `test/smoke/composer-trace-rpc.ts`
- Optional per-composer sub-phase docs for `trace_table` and/or `trace_rpc` if algorithms warrant them.

### Modify

- `packages/tools/src/composers/index.ts` — append six new exports.
- `packages/tools/src/tool-definitions.ts` — append six new `MakoToolDefinition` entries.
- `packages/contracts/src/tools.ts` — add six input schemas.
- `packages/contracts/src/index.ts` — re-exports.
- Root `package.json` — append six new smokes to the `test:smoke` chain.

### Keep unchanged

- `packages/tools/src/composers/_shared/*` — shipped in 3.6.0; no changes.
- `packages/store/src/*` — shipped in 3.6.0; no new accessors needed.
- `services/indexer/*` — shipped in 3.6.0; substrate is complete.
- `apps/web/*` — the `AnswerPacketCard` already renders any composer packet.
- `packages/harness-core/*` — tool-bridge already exposes all registered tools.

## Verification

### Typecheck

`corepack pnpm typecheck` clean.

### Smoke

`corepack pnpm run test:smoke` — existing smokes + `composer-trace-file` (from 3.6.0) + six new composer smokes all pass.

`corepack pnpm run test:smoke:web` — passes; each composer renders through `AnswerPacketCard`.

### Runtime

For each composer:
1. `agentmako tool call <composer_name> '<argsJson>'` returns a valid `AnswerPacket`.
2. `POST /api/v1/tools/<composer_name>` returns the same packet.
3. MCP `tools/list` includes the composer; `tools/call` invokes it.
4. A cloud-agent chat turn can request the composer by name and receive a typed result.
5. Web UI renders the packet through `AnswerPacketCard`.

## Done When

- Six new composers ship on top of 3.6.0 substrate.
- Each composer has a smoke test.
- `trace_table` and `trace_rpc` have sub-phase docs if their algorithms warranted them.
- All seven composers (including `trace_file` from 3.6.0) are invokable from CLI, HTTP, MCP, the harness, and the web UI.
- 3.6.1 closes the investigation-composer slice itself; later roadmap planning may add additional retrieval/UI follow-up phases before Roadmap 4 begins.

## Risks And Watchouts

- **Packet-shape drift.** The value of `AnswerPacket` reuse collapses if composers start adding ad-hoc fields. Every composer goes through `makePacket` which runs `AnswerPacketSchema.parse` at the boundary. New fields go on `AnswerPacket` itself or don't go on at all.
- **ast-grep pattern brittleness.** `$X.from(...)` does not match `$X?.from(...)` or `($X as Foo).from(...)`. Every composer-rules file needs `any:` compositions for these variants. Test each rule against a Supabase-shaped fixture.
- **Sub-phase sprawl.** Six composers do not require six sub-phase docs. Parent doc + optional sub-phase docs for algorithms that warrant review (likely: `trace_rpc`, `trace_table`) keeps overhead proportional.
- **Large packet payloads.** `trace_rpc` and `trace_table` can return dozens of evidence blocks. Watch the `experimental_toToolResultContent` behavior — if the model context blows up, ship a `evidence.slice(0, N)` projection for the SDK-facing result and keep the full packet in the event log.
- **Benchmark coverage remains deferred.** 3.6.1 closes on composer smokes, not benchmark seeding. If Roadmap 4 wants benchmark-driven retrieval/trust evaluation, it should add that surface explicitly rather than pretending 3.6.1 already shipped it.

## References

- [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md)
- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../scratch/phase-3.6-flow-map.md](../../../scratch/phase-3.6-flow-map.md)
- [../../../scratch/fenrir_tools.md](../../../scratch/fenrir_tools.md)
- [../../../master-plan.md](../../../master-plan.md)
