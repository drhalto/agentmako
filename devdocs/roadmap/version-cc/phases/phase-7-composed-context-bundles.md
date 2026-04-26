# Phase 7 CC — Composed Context Bundles

Status: `Complete`

## Deployment Observation

Common investigative questions require 3–5 mako tool calls to answer
reliably. Concrete examples from real courseconnect sessions:

**"What touches `admin_audit_log`?"**

Today:
1. `db_table_schema` — columns, indexes, FKs
2. `db_rls` — policies
3. `schema_usage` — write/read sites
4. `trace_table` — flow-map
5. `graph_neighbors` — caller/caller-of callers

Five turns. Each returns useful info; each also returns a lot of
context the agent has to stitch together manually.

**"Show me the admin auth stack."**

Today:
1. `route_trace` — pick an admin route
2. `file_health` — `lib/auth/dal.ts`
3. `imports_deps` — what calls verifySession
4. `symbols_of` — exported symbols in dal.ts
5. `db_rpc` — `get_user_roles_for_tenant`

Same pattern. The agent burns turns assembling what should be one
composed result.

**"Who calls `admin_ban_user` and what does it write?"**

Today:
1. `db_rpc` — function body + args
2. `schema_usage` — how the RPC is invoked from app code
3. `cross_search` for `admin_audit_log` writes inside the RPC body
4. `trace_rpc` — flow-map

Mako has the artifact system (R7) for end-of-work bundles, but
artifacts answer questions like "is this change safe to ship?" —
not "give me the neighborhood context for this entity *before* I
start thinking." These are different uses.

The cost isn't latency — individual tool calls are fast. The cost is
*turns*. Each extra turn is another round-trip through CC's model
call, another chunk of context consumed by tool-result framing,
another chance for the agent to pick a slightly-wrong next tool. The
agent is actively burning its own context window on the composition
logic.

## Goal

Ship 3 "neighborhood" tools that fuse the primitives above into
single calls returning typed, structured bundles:

1. **`table_neighborhood`** — everything about a table in one call:
   columns, indexes, FKs, RLS policies, write sites, read sites,
   dependent RPCs / routes / files, trust-state-annotated.
2. **`route_context`** — everything about a route: handler file
   health, middleware chain, DAL dependency tree, downstream DB
   table + RPC touches, nearest RLS surface.
3. **`rpc_neighborhood`** — everything about an RPC: signature,
   body, callers (app-code call sites), schema objects touched
   (tables read/written), linked RLS policies.

Each bundle is bounded, trust-annotated, and returns a compact
structured output the agent can reason over without re-composing.

Not on this phase: `auth_stack` or `investigation starter bundles` —
those would need project-specific scaffolding and are better handled
by the existing artifact system. The three above are primitives.

## Implementation Notes

Shipped implementation composes persisted/indexed primitive surfaces
instead of requiring a live database binding: schema snapshot
tables/RLS/RPCs, indexed `schema_usage`, route/import indexes, and
derived `listFunctionTableRefs` RPC-to-table edges. Evidence refs
still name the equivalent primitive surfaces (`db_table_schema`,
`db_rls`, `schema_usage`, `route_trace`, `trace_rpc`) so agents can
drill down. Live `db_*` refresh remains a lower-level primitive
concern; the neighborhood bundles stay deterministic and one-hop deep.

## Hard Decisions

- **Surface: tools, not resources or skills.**
  Neighborhood lookups take structured input (`tableName`,
  `schemaName?`, `maxPerSection`) and return structured,
  multi-section output with evidence refs and an optional trust
  surface. Resources (URI-keyed fetch, no input surface beyond the
  URI) and MCP skills (prose slash-commands) can't carry that shape.
  Tools it is. See the roadmap's **Surface Choice** section for the
  broader rationale.

- **Neighborhood tools are composers, not new graph walks.**
  Each delegates to existing primitives (`db_*`, `schema_usage`,
  `graph_neighbors`, etc.) and composes the output. No new DB
  schema, no new graph code. This keeps the trust surface small:
  every fact in a neighborhood response traces back to the
  primitive that produced it.

- **Bundles ship their own evidence list.**
  Following the R7 artifact convention, neighborhood outputs
  include `evidenceRefs` — pointers to the underlying tool calls
  (or their cached results) that produced each section. Agents
  can drill into any sub-section without re-invoking from scratch.

- **Bundles are stable by input; caching is natural.**
  Given `{ projectId, tableName: "admin_audit_log" }`, the bundle
  is deterministic barring schema / index changes. We don't build
  a cache in this phase — artifact-style identity hashes come in a
  follow-up if session recall (Phase 6) isn't enough.

- **Bundle outputs are large by design.**
  One composed call replaces 5 primitives; naturally the output is
  bigger. Phase 3 (output budgets) governs the truncation here —
  CC disk-persists results over ~200 KB. Mako-side caps on
  individual sections (e.g. top-20 callers rather than all) keep
  the payload useful.

- **No recursion.**
  `table_neighborhood` doesn't recursively call `route_context`
  for every route that touches the table. That's how we end up
  with 500 KB blobs. Each neighborhood is one entity-wide and
  one-hop deep.

- **Shape mirrors `AnswerResult` where possible.**
  Agents already know how to read `AnswerResult` shape (packet +
  evidence + trust). Neighborhood outputs adopt the same
  disclosure pattern: a typed payload + evidence refs + optional
  trust annotation.

## Scope In

- new contract types: `TableNeighborhoodToolInput/Output`,
  `RouteContextToolInput/Output`, `RpcNeighborhoodToolInput/Output`
- new tool files under `packages/tools/src/neighborhoods/`
- each tool's implementation composes existing primitives (no new
  indexer / graph code) and annotates results
- new tool category `neighborhood` in `MAKO_TOOL_CATEGORIES`
- register all 3 in `tool-definitions.ts`
- `ClaudeCodeClient` hints for all 3; `table_neighborhood` marked
  `alwaysLoad: true` because it's the highest-frequency investigative
  starting point
- smoke per tool exercising the composition path end-to-end
- doc: each tool's description names the primitives it composes so
  the agent understands what it's getting

## Scope Out

- new graph / indexer infrastructure
- caching / identity hashing for bundles (artifact-style; follow-up)
- recursive neighborhoods (tool calls tool calls ...)
- a `project_overview` or `auth_stack` tool — those need project-
  specific wiring; handled by R7 artifacts
- streaming / incremental bundle delivery
- UI rendering in downstream clients

## Architecture Boundary

### Owns

- `packages/contracts/src/tool-neighborhood-schemas.ts` (new)
- `packages/tools/src/neighborhoods/` (new directory) with
  `table-neighborhood.ts`, `route-context.ts`,
  `rpc-neighborhood.ts`, `index.ts`
- `packages/contracts/src/tool-registry.ts` — extend names +
  `neighborhood` category
- `packages/contracts/src/tools.ts` — union extensions
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — hints
- `test/smoke/table-neighborhood.ts`, `route-context.ts`,
  `rpc-neighborhood.ts` (new)

### Does Not Own

- any underlying primitive (`db_*`, `schema_usage`, `graph_*`)
- the R7 artifact contract (different purpose)
- indexer behavior

## Contracts

### `TableNeighborhoodToolInput` / `Output` (representative shape)

```ts
// packages/contracts/src/tool-neighborhood-schemas.ts
export interface TableNeighborhoodToolInput {
  projectId?: string;
  projectRef?: string;
  schemaName?: string;       // default: search defaultSchemaScope
  tableName: string;
  /** Cap sections to keep payload bounded. Default 20 per section, cap 100. */
  maxPerSection?: number;
}

export interface TableNeighborhoodSection<T> {
  entries: T[];
  truncated: boolean;
  totalCount: number;
}

export interface TableNeighborhoodToolOutput {
  toolName: "table_neighborhood";
  projectId: string;
  schemaName: string;
  tableName: string;
  table: SchemaTable;                             // from db_table_schema
  rls: DbRlsPoliciesResult;                       // from db_rls
  writes: TableNeighborhoodSection<SchemaUsageMatch>;
  reads: TableNeighborhoodSection<SchemaUsageMatch>;
  dependentRpcs: TableNeighborhoodSection<FunctionTableRef>;
  dependentRoutes: TableNeighborhoodSection<ResolvedRouteRecord>;
  evidenceRefs: string[];   // ["db_table_schema:...", "schema_usage:...", ...]
  trust: AnswerTrustSurface | null;
  warnings: string[];
}
```

`RouteContextToolOutput` and `RpcNeighborhoodToolOutput` follow the
same shape: a typed payload per-section, each section bounded and
truncation-flagged, collated evidence refs, optional trust surface.

## Execution Flow (slices)

1. **Contract** — ship the three tool schemas +
   `neighborhood` category + union re-exports. Typecheck.
2. **`table_neighborhood`** — compose the 5 primitives listed above.
   Per-section maxes. Evidence refs collated from each primitive's
   output. Trust surface copied through when `schema_snapshot`
   provides one. Smoke: seed a project with a table that has RLS +
   2 reader files + 1 writer file; assert every section populated;
   assert truncation flag behavior at low `maxPerSection`.
3. **`route_context`** — compose `route_trace` +
   `file_health` + `imports_deps` (outbound) + nearest downstream
   table / RPC touches (via `flow_map` where available, fallback to
   `graph_neighbors`). Smoke with a route → RPC → table chain.
4. **`rpc_neighborhood`** — compose `db_rpc` + `schema_usage` of
   the RPC name + any RLS policies tied to the RPC's writes.
   Smoke with an RPC that writes to two tables and is called from
   one file.
5. **Registration** — add all 3 to `TOOL_DEFINITIONS` and
   `CLAUDE_CODE_TOOL_HINTS`. Mark `table_neighborhood` with
   `alwaysLoad: true` (keep other two deferred). Register all
   smokes.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/contracts/src/tool-neighborhood-schemas.ts`
- `packages/tools/src/neighborhoods/index.ts`
- `packages/tools/src/neighborhoods/table-neighborhood.ts`
- `packages/tools/src/neighborhoods/route-context.ts`
- `packages/tools/src/neighborhoods/rpc-neighborhood.ts`
- `test/smoke/table-neighborhood.ts`
- `test/smoke/route-context.ts`
- `test/smoke/rpc-neighborhood.ts`

Modify:

- `packages/contracts/src/index.ts` — re-export
- `packages/contracts/src/tools.ts` — extend unions
- `packages/contracts/src/tool-registry.ts` — add tool names +
  `neighborhood` category
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — add
  hints; `table_neighborhood` gets `alwaysLoad: true`
- `package.json` — register smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Added`

Keep unchanged:

- every underlying primitive's contract
- the R7 artifact surface
- indexer / graph infrastructure

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `table-neighborhood.ts`: seed project with a table that has:
  2 reader files, 1 writer file, 1 RLS policy, 1 dependent RPC,
  1 dependent route. Call the tool. Assert:
  - `table` section populated with column data
  - `rls` section has the 1 policy
  - `writes.entries.length === 1`, `reads.entries.length === 2`,
    etc.
  - `evidenceRefs` contains refs naming each composing primitive
  - payload total size is well under any reasonable budget
- `route-context.ts`: similar end-to-end assertion over a seeded
  route → RPC → table chain.
- `rpc-neighborhood.ts`: similar over an RPC writing to 2 tables
  called from 1 file.
- MCP `tools/list` carries the 3 new tools; `table_neighborhood`
  is `alwaysLoad`; the other two are deferred with search hints.

## Done When

- 3 contract schemas shipped
- 3 tool implementations shipped
- `neighborhood` category in registry
- all 3 smokes green; existing smokes green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **Payload size explosion.**
  5 composed primitives can produce a big result. Per-section
  caps (`maxPerSection: 20`) keep it bounded. Phase 3's output-
  budget work keeps it CC-friendly when 20 × 5 sections still
  overshoots.
- **Trust surface aggregation.**
  Not every primitive carries a trust surface. When present on
  the source primitive, propagate; when absent, return `null`.
  Don't invent trust annotations in this phase — that belongs
  to the R4 trust-state work.
- **Divergence from primitives as primitives evolve.**
  If `db_rls` ever changes its output shape, `table_neighborhood`'s
  `rls` section drifts. Mitigation: the neighborhood uses the
  same `DbRlsPoliciesResult` type the primitive produces, so
  type drift surfaces at compile time.
- **Tool-name collision risk.**
  `rpc_neighborhood` is close to the existing `trace_rpc`
  composer. Documentation in both tool descriptions clarifies:
  `trace_rpc` is execution-trace + flow-map oriented;
  `rpc_neighborhood` is entity-wide context. They complement.
- **Agent prefers the composer every time.**
  Acceptable — the composer is the default starting point for
  entity-wide questions. Primitives stay accessible for the
  narrow questions that don't need the full neighborhood.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [./phase-1-tool-discoverability.md](./phase-1-tool-discoverability.md)
  — `alwaysLoad` selection rationale
- [./phase-3-output-budget-alignment.md](./phase-3-output-budget-alignment.md)
  — budget governance for bundled payloads
- `packages/tools/src/db/*` — primitives composed by
  `table_neighborhood`, `rpc_neighborhood`
- `packages/tools/src/composers/*` — existing composers; the new
  neighborhoods complement them
- `packages/tools/src/artifacts/*` — R7 artifacts; orthogonal
  purpose (pre-ship bundles vs pre-think neighborhoods)
