# Phase 3.6.0 Substrate Lift

Status: `Complete` (shipped 2026-04-17)

This file is the canonical planning and ship record for Roadmap 3 Phase 3.6.0, the substrate work that unlocks Phase 3.6.1 (Investigation Composers). The detailed workstream plan below is preserved as planning history; read `Shipped Outcome` and `Deviations From Spec At Ship Time` first for the actual landed state.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use [./phase-3.6.1-investigation-composers.md](./phase-3.6.1-investigation-composers.md) for the composer design. Use [../../../scratch/phase-3.6-flow-map.md](../../../scratch/phase-3.6-flow-map.md) for the visual dependency map.

## Shipped Outcome

Phase 3.6.0 shipped all seven planned workstreams:

- Workstream E: composer tool names, `QueryKind`, and downstream type surfaces opened for `trace_file`, `preflight_table`, `cross_search`, `trace_edge`, `trace_error`, `trace_table`, and `trace_rpc`.
- Workstream A: `packages/harness-core/src/tool-bridge.ts` now bridges `TOOL_DEFINITIONS` into `streamText`, including the same bus emission and `persistToolPart(...)` behavior the web timeline depends on.
- Workstream B: the indexer now emits symbol-level chunks via `web-tree-sitter`, `searchCodeChunks(...)` returns line ranges, `symbolOnly` filtering happens in SQL before `LIMIT`, and chunk search supports natural-language lookup of camelCase identifiers through derived search text.
- Workstream C: repo-only schema snapshots now persist RPC and trigger body text, derive overload-aware `schema_snapshot_function_refs` rows, and populate indexes, foreign keys, RLS, and triggers from repo SQL.
- Workstream D: the web UI renders `AnswerResult` / `AnswerPacket` tool results through `AnswerPacketCard` with Shiki highlighting.
- Workstream F: shared composer infrastructure shipped under `packages/tools/src/composers/_shared/`.
- Workstream G: `trace_file` shipped end-to-end through CLI, HTTP, MCP, harness tool-calling, and the web UI.

All explicit 3.6.0.x follow-ups that were flagged during implementation were folded into phase close:

- structural repo-SQL DDL on the repo-only snapshot path
- CLI bundle copying of tree-sitter wasm assets
- camelCase-aware chunk search tokenization
- one-call snapshot-side table access via `ProjectStore.getSchemaTableSnapshot(schema, table)`
- overload-aware `schema_snapshot_function_refs` identity plus constructor backfill for existing stores

Verification at ship time:

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/indexer-symbol-chunking.ts`
- `node --import tsx test/smoke/schema-snapshot-bodies.ts`
- `node --import tsx test/smoke/composer-trace-file.ts`
- `corepack pnpm --filter agentmako run build`
- `node apps/cli/scripts/verify-bundle.mjs`

## Deviations From Spec At Ship Time

- The repo-SQL structural DDL work did **not** ship as a separate `extract-pg-ddl.ts`. It landed inline inside `services/indexer/src/schema-sources/sql.ts`, alongside the existing repo-SQL snapshot builder.
- The parent-scoped schema accessor did **not** ship as `listSchemaObjectsByParent(schema, table)`. The shipped API is `ProjectStore.getSchemaTableSnapshot(schema, table)`, which returns the full `SchemaTable` from the persisted snapshot IR in one call.
- The chunker does **not** currently emit `window` or `file-residual` chunks. The shipped shape is additive `file` + `symbol`, with file-level fallback on unsupported extensions or parser failure.
- camelCase lookup did **not** ship as a parallel `content_tokenized` FTS table. The shipped implementation stores derived identifier search text on `chunks.search_text` and indexes that column in `chunks_fts`.
- The function-ref read model did **not** remain at the original coarse `(rpc_schema, rpc_name)` identity. The shipped state includes migration `0015` plus constructor backfill so `schema_snapshot_function_refs` preserves overload identity through `rpc_kind` + `arg_types_json`.
- `knip` / `pnpm run audit` did **not** ship in 3.6.0. Repo-hygiene auditing remains outside the phase scope.

## Why This Phase Exists

Phase 3.6 was originally written as a single "composers" phase assuming the substrate was ready. An independent review (2026-04-16) against the actual shipped state surfaced three high-severity substrate gaps plus two medium-severity wiring problems. All seven composers depend on at least one of the gaps being closed.

Rather than hide substrate work inside the composer phase (and risk a two-week slog before a single composer ships), Phase 3.6.0 is explicitly the substrate lift. It is small enough to ship in roughly a week, produces one working composer (`trace_file`) as a tracer-bullet, and leaves the remaining six composers as a mechanical second phase.

## Goal

Land the three substrate changes, the shared composer infrastructure (Layers 2/4/5 of the five-layer plan), the web-UI rendering component, and one end-to-end composer (`trace_file`) so that:

- a harness agent turn can call `trace_file` mid-chat through tool-calling
- the result renders in the web UI as a styled `AnswerPacket` panel, not a JSON dump
- the indexer produces symbol-accurate line ranges for FTS hits
- the snapshot carries overload-aware `schema_snapshot_function_refs` edges so composers can answer "RPCs that reference table X" as a relational JOIN without collapsing overloads

## Prerequisites

- Phases 3.0–3.5.1 complete (as listed in [../handoff.md](../handoff.md))
- Roadmap 2 Phase 4.1 complete (benchmark storage already shipped)

## Research Inputs

This phase was informed by parallel research agents; their findings are preserved in [../../../scratch/phase-3.6-flow-map.md](../../../scratch/phase-3.6-flow-map.md):

- **Research A** — chunking strategy: `web-tree-sitter` WASM + symbol-level chunking + line-window fallback, matching continue.dev's `core/indexing/chunk/code.ts` pattern. Use `tsx` grammar for both `.tsx` and `.jsx`. FTS5 porter does not split camelCase — ship a pre-tokenized FTS column.
- **Research B** — AI SDK v4 tool bridging: simple `toolFromDefinition` + `buildRegistryToolset` adapter, ~50 LOC. Single-writer logging rule. Correlate resumed tool calls by `(stepIndex, toolName, input-hash)`, not by `toolCallId`. Tool names must match `^[a-zA-Z0-9_-]{1,64}$` (no dots).
- **Research C** — offline SQL body extraction: home-grown ~80-line dollar-quote-aware splitter, no heavyweight parser. Second-pass grep over bodies populates a function-to-table edge table, which shipped as overload-aware `schema_snapshot_function_refs`.
- **Research D** — `ast-grep` for structural pattern search: adds `$C.from($TABLE)` style queries to composers. Complements `web-tree-sitter` — the chunker uses raw tree-sitter, composers use ast-grep patterns. Windows 11 `win32-x64-msvc` prebuilt is mainstream-supported; no Rust toolchain needed.
- **Research E** — tooling portfolio: `shiki` for AnswerPacketCard syntax highlighting; `knip` as mako-repo dev-dep only (not a composer data source); defer `ts-morph` / `chokidar` / `diff`.

## Package Additions

Runtime deps (Phase 3.6.0 owns all of these):

| Package | Workspace | Role |
|---------|-----------|------|
| `web-tree-sitter` + `tree-sitter-typescript` | `services/indexer` | Symbol-level chunking (Gap 2) |
| `@ast-grep/napi` | `packages/tools` | Structural pattern search for composers (used in 3.6.1; primitive lands in 3.6.0 shared infra) |
| `shiki` | `apps/web` | Syntax highlighting in `AnswerPacketCard` |

Dev-only deps: none. `knip` was evaluated during planning but was not shipped in 3.6.0.

Deliberately rejected (see flow-map doc for rationale): `libpg-query`, `madge`, `dependency-cruiser`, `ts-morph` (defer), `react-diff-viewer-continued`, `highlight.js`, `Prism`, `stack-graphs`, `langchain`, `nest`, `ts-prune`, `depcheck`.

## Hard Decisions

### 1. Split `parameters` from `inputSchema` based on AI SDK major

Mako currently ships AI SDK v4 (`ai: ^4.0.0`). The tool bridge uses `parameters:` in `tool()` calls. **Do not migrate to v5 in this phase** — the migration is its own work (naming, `prepareStep`, tool-result content shape). If v5 migration becomes necessary later, it's a Phase 3.6.x follow-up.

### 2. Tool names for composers are flat — no dots

The model-facing tool name must match `^[a-zA-Z0-9_-]{1,64}$`. Composers register as `trace_file`, `trace_table`, etc. The `composer.*` namespace lives in the `QueryKind` value on `AnswerPacket`, not in the tool name.

### 3. Single-writer rule for `tool_runs`

`invokeTool` (`packages/tools/src/registry.ts`) already writes `tool_runs`. The harness tool bridge is a pure adapter — it does not re-log. `onStepFinish` in `streamText` emits UI events only, never persists tool results. `defineComposer` adds `saveAnswerTrace` on top of what `invokeTool` already does, but does **not** re-write `tool_runs`.

### 4. `trace_file` is the tracer-bullet composer

`trace_file` is the only composer in 3.6.0. It proves the whole stack — tool bridge, Layer 2/4/5 infra, UI card — against a composer that needs none of Gap 2 or Gap 3 to ship. The remaining six composers are 3.6.1.

### 5. Snapshot-strict holds

Composers never open a live DB connection. Every substrate change in this phase is snapshot-side (indexer, schema read-model). The existing live-DB tools (`db_columns`, `db_rls`, `db_rpc`, `db_fk`, `db_triggers`, `db_table_schema`) stay in their own lane.

## Workstreams

Each workstream has its own acceptance criteria, can be worked independently, and ships behind a smoke test. They are ordered from lowest-risk to highest-risk.

### Workstream E — Type-surface cleanup (lowest-risk first move)

**Purpose:** open `MAKO_TOOL_NAMES`, `ToolInput`, and `ToolOutput` so composer entries can be added without editing closed unions in multiple files.

**Touches:**
- `packages/contracts/src/tools.ts` — `MAKO_TOOL_NAMES` becomes a readonly tuple that accepts extension; add a `ComposerQueryKind` discriminator for composer AnswerPackets.
- `packages/contracts/src/answer.ts` — extend `QueryKind` with seven `composer.*` values.
- `packages/contracts/src/index.ts` — re-export new types.

**Acceptance:**
- `corepack pnpm typecheck` clean.
- No runtime behavior change. No smoke test needed; the type surface change is caught by typecheck.

**Estimated size:** ~30 LOC.

### Workstream A — Harness tool-registry bridge

**Purpose:** close Gap 1. Expose `TOOL_DEFINITIONS` to `streamText` so the model can call any registered tool mid-turn **and** so those calls render as tool cards in the web timeline.

**Critical seam the first draft missed.** The existing `ToolDispatch.executeSubAgentTool` path (`packages/harness-core/src/tool-dispatch.ts:142+148+158`) does three things per call:
1. Emits `tool.call` on the session bus (what the SSE stream publishes).
2. Calls `persistToolPart("tool_call", {...})` — writes a `harness_message_parts` row.
3. Mirrors the above for `tool.result` when the call completes.

The web timeline (`apps/web/src/lib/session-view.ts:102`, `apps/web/src/components/MessageTimeline.tsx:136`) renders tool cards from those persisted parts. **A bridge that only wires `streamText` without emitting+persisting will execute but never render.** The bridge must therefore mirror the dispatch pattern exactly — same event kinds, same call IDs, same persistence shape.

**Touches:**
- `packages/harness-core/src/tool-bridge.ts` (new) — `toolFromDefinition(def, ctx)` that wraps `invokeTool` in an AI SDK `tool({ parameters, execute })` adapter. Each `execute` call: generates a `callId`, emits `tool.call` on the bus, `persistToolPart("tool_call", ...)`, runs `invokeTool`, emits `tool.result`, `persistToolPart("tool_result", ...)`. Mirrors the existing dispatch pattern line-for-line.
- `packages/harness-core/src/tool-bridge.ts` — `buildRegistryToolset(defs, ctx)` that maps `TOOL_DEFINITIONS` through `toolFromDefinition`, flattening names (no dots) to match `^[a-zA-Z0-9_-]{1,64}$`.
- `packages/harness-core/src/tool-dispatch.ts` — `buildTools()` merges registry toolset into output with a name-collision guard (action/memory/sub-agent names win if a collision ever appears).
- `packages/harness-core/src/tool-dispatch.ts` — `(stepIndex, toolName, inputHash)` idempotency cache for resumed sessions per Research B.
- `test/smoke/harness-calls-registry-tool.ts` (new) — cloud-agent chat turn calls `symbols_of` (a deterministic registry tool); assert (a) a typed result comes back, (b) exactly one `tool_call` + one `tool_result` part written to `harness_message_parts`, (c) the matching SSE events were emitted (capture via replay `GET /sessions/:id/events`), (d) `queryToolRuns` returns exactly one row (no double-logging — registry already logs).

**Acceptance:**
- New smoke passes all four assertions.
- Existing harness smokes (`harness-sub-agent.ts`, `harness-action-tools.ts`, `harness-resume*.ts`) still pass.
- Manual check: a live session calling a bridged tool renders a tool card in the web timeline end-to-end.

**Estimated size:** ~120 LOC bridge (was 50) + smoke. The emit+persist mirroring is what grew it.

### Workstream B — Indexer symbol chunking (Gap 2)

**Purpose:** replace the one-chunk-per-file scanner with symbol-level chunks carrying real line ranges, and make camelCase identifiers searchable through natural-language terms.

**Shipped shape:**
- `services/indexer/package.json` adds `web-tree-sitter` + `tree-sitter-typescript`.
- `services/indexer/src/chunker/` emits additive `file` + `symbol` chunks. Unsupported extensions and parser failures fall back to the file-level chunk rather than emitting residual windows.
- `services/indexer/src/file-scan.ts` now awaits the chunker.
- `packages/store/src/migration-sql.ts` migration `0014` adds `chunks.search_text` and rebuilds `chunks_fts` to index `content`, `path`, `name`, and derived identifier search text.
- `packages/store/src/project-store-queries.ts` exposes `searchCodeChunks(...)`, with `symbolOnly` filtering pushed into SQL before `LIMIT`.
- `test/smoke/indexer-symbol-chunking.ts` verifies line ranges, `symbolOnly`, and natural-language lookup of `getUserByEmail`.

### Workstream C — Repo-SQL snapshot expansion (Gaps 2b + 3)

**Purpose:** teach the repo-SQL snapshot pipeline to capture the structural DDL composers need (indexes, foreign keys, RLS, triggers) and the body text of RPCs / triggers, then persist that data in the schema snapshot read model.

**Critical seam:** the substrate lives on the snapshot pipeline

```
services/indexer/src/index-project.ts
  → buildSchemaSnapshot({ projectRoot, manifest })
  → services/indexer/src/schema-sources/sql.ts :: parseSqlSchemaSource
  → projectStore.saveSchemaSnapshot(snapshot)
  → packages/store/src/project-store-snapshots.ts :: rebuildSchemaSnapshotReadModel
```

**Shipped shape:**
- `services/indexer/src/extract-pg-functions.ts` extracts RPC bodies and trigger metadata from repo SQL, including non-`public` trigger targets, timing, and events.
- `services/indexer/src/schema-sources/sql.ts` now parses repo-SQL structural DDL inline, populating `SchemaTable.indexes`, `foreignKeys`, `rls`, and `triggers` on the repo-only path.
- `packages/contracts/src/schema-snapshot.ts` exports `bodyText` on both `SchemaRpc` and `SchemaTrigger`, and the zod schemas were updated to match.
- `packages/store/src/migration-sql.ts` migration `0013` adds `body_text` columns and the initial `schema_snapshot_function_refs` table; migration `0015` hardens that table to preserve overload identity via `rpc_kind` + `arg_types_json`.
- `packages/store/src/project-store-snapshots.ts` persists those fields, derives function-to-table refs, and `ProjectStore` backfills the derived edge table on open so existing stores stay correct after upgrade.
- `packages/store/src/project-store-queries.ts` and `project-store.ts` expose `searchSchemaBodies(...)`, `listFunctionTableRefs(...)`, and `getSchemaTableSnapshot(schema, table)`.
- `test/smoke/schema-snapshot-bodies.ts` verifies bodies, structural DDL, non-`public` triggers, one-call table reads from the snapshot, overload-aware function refs, and save-close-reopen behavior.

### Workstream D — Web `AnswerPacketCard`

**Purpose:** render a composer result as a styled evidence panel, not a JSON dump. Extends the current `ToolCallCard` behavior with a tool-name dispatcher that chooses a specialized renderer when available.

**Touches:**
- `apps/web/package.json` — add `shiki`.
- `apps/web/src/lib/shiki.ts` (new) — singleton `createHighlighterCore` with TS/TSX/SQL/Python/Bash/JSON grammars + `github-dark-dimmed` theme, exposed as `highlightToHast(code, lang)`.
- `apps/web/src/components/AnswerPacketCard.tsx` (new) — render `AnswerPacket.evidence` blocks grouped by `kind`; use Shiki for code snippets; show `missingInformation[]` + `stalenessFlags[]` prominently.
- `apps/web/src/components/ToolCallCard.tsx` — dispatch on `toolName`: use `AnswerPacketCard` for answer/composer tools, fall back to JSON dump for everything else.
- `test/smoke/web-harness-shell.ts` — add an assertion that a tool call with `AnswerPacket` shape renders the styled panel.

**Acceptance:**
- Web smoke passes with the new assertion.
- `trace_file` output renders as a panel; `symbols_of` still renders as JSON dump (since it's not an AnswerPacket shape yet).

**Estimated size:** ~150 LOC web component + Shiki setup + smoke update.

### Workstream F — Composer shared infrastructure (Layers 2/4/5)

**Purpose:** build the factory, packet helpers, and evidence-block producers that Phase 3.6.1 composers will slot into. Depends on Workstream E.

**Touches:**
- `packages/tools/src/composers/_shared/context.ts` (new) — `ComposerContext` type: snapshot accessors + freshness read + memory binding + project ID + logger.
- `packages/tools/src/composers/_shared/packet.ts` (new) — `makePacket(ctx, { queryKind, evidence, summary })`, `assessConfidence(evidence, freshness) → { confidence: number, reasons: string[] }`, `summarize*` helpers. Single `AnswerPacketSchema.parse` boundary.
- `packages/tools/src/composers/_shared/blocks.ts` (new) — `blocksFromColumns`, `blocksFromForeignKeys`, `blocksFromRlsPolicies`, `blocksFromTriggers`, `blocksFromChunkHits`, `blocksFromImports`, `blocksFromRoutes`, `blocksFromRpcDefs`, `blocksFromMemories`. One per `EvidenceBlock.kind`.
- `packages/tools/src/composers/_shared/ast-patterns.ts` (new) — `@ast-grep/napi` wrapper returning `ChunkSearchHit[]` for structural pattern queries. Composers use this for `.from('table')`-style matches; agents can pass custom patterns through `cross_search`.
- `packages/tools/src/composers/_shared/define.ts` (new) — `defineComposer({ name, input, run }) → MakoToolDefinition` factory. Wraps input zod parse → ctx assembly → run → output `AnswerPacketSchema.parse` → `saveAnswerTrace`. Does **not** write `tool_runs` (registry handles it).
- `packages/tools/package.json` — add `@ast-grep/napi`.
- `composer-rules/` (new, at repo root) — one YAML rule file per composer pattern set. Loaded at composer boot.

**Acceptance:**
- Typecheck clean.
- `defineComposer` works end-to-end for a hello-world composer (no smoke needed yet — Workstream G covers integration).

**Estimated size:** ~350 LOC + ast-grep integration + rule files.

### Workstream G — `trace_file` tracer-bullet composer

**Purpose:** ship one composer end-to-end to prove the whole 3.6.0 stack. `trace_file` is chosen because it depends on none of the substrate changes that shipped in B or C — it reads imports, dependents, and symbols that are already there.

**Touches:**
- `packages/contracts/src/tools.ts` — add `TraceFileToolInputSchema` + output reference.
- `packages/tools/src/composers/trace-file.ts` (new) — ~30 lines of orchestration using the shared infra.
- `packages/tools/src/composers/index.ts` (new) — barrel.
- `packages/tools/src/tool-definitions.ts` — append the composer's `MakoToolDefinition`.
- `test/smoke/composer-trace-file.ts` (new) — happy path + one degraded-freshness path.

**Acceptance:**
- New smoke passes.
- `agentmako tool call trace_file '{"projectRef":{"canonicalPath":"..."},"file":"packages/store/src/project-store.ts"}'` returns a valid `AnswerPacket`.
- `POST /api/v1/tools/trace_file` returns the same packet.
- Web UI renders the packet as a styled panel (via Workstream D).
- Harness agent turn can request `trace_file` mid-chat and receive the packet (via Workstream A).
- Existing smokes still pass.

**Estimated size:** ~60 LOC composer + smoke.

## Execution Order

**Realistic sizing: 1.5-2 weeks.** Workstream C alone is ~2-3 days after the revision for Findings 1 + 2. Workstream A grew with the bus-emit + persist mirroring. The original 1-week estimate assumed a thinner C and a simpler A — both have been corrected.

Ordered for minimum risk and maximum parallelism. Workstreams that share files or share contract surfaces are not parallelizable; others are.

```
Week 1
  Day 1:  Workstream E (type surface)   ────────────────┐
          Workstream A (tool bridge + emit/persist) ────┤
                                                        │
  Day 2:  Workstream F (shared infra)   ────────────────┤   (depends on E)
          Workstream B (chunking)       ────────────────┤
          Workstream C (repo-SQL snapshot expansion, day 1) ─────────┐
                                                        │            │
  Day 3:  Workstream B (chunking, day 2)                │            │
          Workstream C (repo-SQL snapshot expansion, day 2)          │
                                                        │            │
  Day 4:  Workstream D (UI card)        ────────────────┤            │
          Workstream C (repo-SQL snapshot expansion, day 3, wrap)    │
                                                        ▼            ▼
  Day 5:  (A, B, C, D, E, F wrap)

Week 2
  Day 1:  Workstream G (trace_file tracer bullet — depends on A, B, F)
  Day 2:  Integration + buffer for whichever workstream ran long.
  Day 3:  Phase close — acceptance walk-through + smokes green.
```

Workstreams E, A, B, C, D are all independently parallelizable. F depends on E. G depends on A, B, and F. C is not a prerequisite for G but ships alongside to keep the substrate complete.

## File Plan

### Create

- `packages/harness-core/src/tool-bridge.ts`
- `services/indexer/src/chunker/index.ts` + `services/indexer/src/chunker/tree-sitter-chunker.ts`
- `services/indexer/src/extract-pg-functions.ts`
- `services/indexer/src/extract-pg-ddl.ts`
- `packages/tools/src/composers/_shared/context.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- `packages/tools/src/composers/_shared/blocks.ts`
- `packages/tools/src/composers/_shared/ast-patterns.ts`
- `packages/tools/src/composers/_shared/define.ts`
- `packages/tools/src/composers/trace-file.ts`
- `packages/tools/src/composers/index.ts`
- `composer-rules/trace-file.yml` (if any ast-grep rules apply)
- `apps/web/src/lib/shiki.ts`
- `apps/web/src/components/AnswerPacketCard.tsx`
- `test/smoke/harness-calls-registry-tool.ts`
- `test/smoke/indexer-symbol-chunking.ts`
- `test/smoke/schema-snapshot-bodies.ts`
- `test/smoke/composer-trace-file.ts`

### Modify

- `packages/contracts/src/tools.ts` — open `MAKO_TOOL_NAMES`; add composer input schemas
- `packages/contracts/src/answer.ts` — extend `QueryKind`
- `packages/contracts/src/index.ts` — re-exports
- `packages/harness-core/src/tool-dispatch.ts` — merge registry tools; idempotency guard
- `services/indexer/src/file-scan.ts` — replace chunker call
- `services/indexer/src/schema-sources/sql.ts` — extend repo-SQL parser to populate indexes, FKs, RLS, triggers + function/trigger body text (Workstream C)
- `packages/contracts/src/schema-snapshot.ts` — add `bodyText?: string` to `SchemaRpc` and `SchemaTrigger`; confirm `SchemaIndex` / `SchemaForeignKey*` / `SchemaRlsPolicy` shapes match extractor output
- `packages/store/src/migration-sql.ts` — migration `0013` (`body_text` columns + initial `schema_snapshot_function_refs`), migration `0014` (chunk search text / rebuilt `chunks_fts`), migration `0015` (overload-aware function-ref identity)
- `packages/store/src/project-store-queries.ts` — new accessors (`searchCodeChunks`, `getSchemaTableSnapshot`, `searchSchemaBodies`, `listFunctionTableRefs`)
- `packages/store/src/project-store-snapshots.ts` — write body text columns; derive overload-aware function→table refs via second-pass regex
- `packages/store/src/project-store.ts` — expose new accessors
- `packages/tools/src/tool-definitions.ts` — append `trace_file`
- `apps/web/src/components/ToolCallCard.tsx` — tool-name dispatcher
- `apps/web/package.json` — add `shiki`
- `services/indexer/package.json` — add `web-tree-sitter`, `tree-sitter-typescript`
- `packages/tools/package.json` — add `@ast-grep/napi`
- Root `package.json` — append new smokes to `test:smoke` chain

### Keep unchanged

- `packages/tools/src/registry.ts` — already handles logging
- All Phase 3.0–3.5.1 harness / store / services surfaces (no regression)
- Existing composer phase doc (3.6.1) now has a clean substrate to build on

## Verification

### Typecheck

`corepack pnpm typecheck` clean across the workspace.

### Smoke

The 3.6.0-specific smokes are:

- `test/smoke/harness-calls-registry-tool.ts`
- `test/smoke/indexer-symbol-chunking.ts`
- `test/smoke/schema-snapshot-bodies.ts`
- `test/smoke/composer-trace-file.ts`

They ship in the workspace `test:smoke` chain alongside the pre-existing harness and web smokes.

### Runtime

1. `agentmako tool call trace_file '{...}'` returns a valid `AnswerPacket`.
2. `POST /api/v1/tools/trace_file` returns the same packet.
3. Web UI renders the packet as a styled panel (Shiki-highlighted code, grouped evidence blocks, stalenessFlags prominent if snapshot is old).
4. A cloud-agent chat turn requesting "trace this file" causes the model to call `trace_file` and receive a typed result.
5. `listFunctionTableRefs({ tableName: "events" })` on a real Supabase fixture returns non-empty, overload-aware results and still does so after store reopen.
6. `searchCodeChunks("from")` returns symbol-accurate line ranges.

## Done When

- All seven workstreams have passed their acceptance criteria.
- `trace_file` is invokable from CLI, HTTP, MCP, the harness agent loop, and renders styled in the web UI.
- The four new smokes pass in CI.
- The three substrate gaps identified in the ChatGPT review are closed.
- Phase 3.6.1 can begin without any further substrate work from 3.6.0.x follow-ups.

## Risks And Watchouts

- **Tree-sitter grammar drift.** When tree-sitter grammars update node kinds, rules can silently stop matching. Pin `tree-sitter-typescript` and add a smoke that asserts at least one chunk per function in a known fixture.
- **Windows `@ast-grep/napi` install.** `win32-x64-msvc` prebuilt is well-exercised, but verify `node_modules/.pnpm/@ast-grep+napi-win32-x64-msvc@*` resolves after `pnpm install`. If not, add the platform sub-package as a direct optional dep.
- **Migration compatibility.** `0013` adds nullable body-text columns, `0014` adds nullable `chunks.search_text`, and `0015` rebuilds the derived function-ref table with overload identity; all three must degrade cleanly on already-indexed projects.
- **AI SDK v4 tool-result size.** A composer returning a large `AnswerPacket` will cause the model to auto-continue. For 3.6.0 ship the naïve pass-through; if `trace_file` output proves too large for the model context, add an `evidence.slice(0, N)` projection on the SDK-facing result and keep the full packet in the event log.
- **camelCase pre-tokenizer performance.** Pre-splitting identifiers doubles FTS index size. If the index grows uncomfortably, migrate to a trigram tokenizer later. For 3.6.0 the porter + pre-split column is acceptable.

## References

- [./phase-3.6.1-investigation-composers.md](./phase-3.6.1-investigation-composers.md)
- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../scratch/phase-3.6-flow-map.md](../../../scratch/phase-3.6-flow-map.md)
- [../../../scratch/fenrir_tools.md](../../../scratch/fenrir_tools.md)
- [./phase-3.5-web-ui-alpha.md](./phase-3.5-web-ui-alpha.md)
