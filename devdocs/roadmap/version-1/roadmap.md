# Product Roadmap

This file is the canonical development guide for `mako-ai`.

If another doc disagrees with this roadmap about what is done, what is next, what may overlap, or what is deferred, this roadmap wins.

## Product Contract

`mako-ai` is a local-first repo intelligence engine for JS/TS web projects, with optional Postgres/Supabase schema awareness.

Its job is to let a user or coding agent attach to a project, index the repo and schema shape, and get back fast, evidence-backed, structured answers in one round trip.

It is not:

- a general autonomous maintainer
- an ML-first product
- a dashboard platform
- a giant tool catalog with overlapping capabilities

## Current Status

The initial roadmap from Phase 0 through Phase 5 is now complete and verified.

The shipped product includes:

- store and DB
- indexer
- engine
- API
- CLI
- thin web client
- shared tools package
- thin HTTP tool routes
- Streamable HTTP MCP transport
- read-only DB schema tools
- smoke and browser verification
- thin `ask` routing over the shipped named tool families
- public-facing install/run guidance and tool registry

Use [initial-roadmap-complete.md](./initial-roadmap-complete.md) as the completion summary and build debrief.
Use [phases/phase-5-public-lock.md](./phases/phase-5-public-lock.md) as the final shipped phase spec.
Use [phases/phase-4-ask-router.md](./phases/phase-4-ask-router.md) as the shipped ask baseline.

## Where To Begin

There is no active implementation phase left inside this initial roadmap.

If work resumes, start in:

- [initial-roadmap-complete.md](./initial-roadmap-complete.md)
- the current Roadmap 2 at [../version-2/roadmap.md](../version-2/roadmap.md)
- the concrete-need gates and deferred seams, not by reopening unfinished work in Phases 0 through 5

Reuse the shipped:

- named tools in `packages/tools/src/answers/`
- named tools in `packages/tools/src/imports/`
- named tools in `packages/tools/src/symbols/`
- named tools in `packages/tools/src/db/`
- MCP surface
- thin HTTP tool routes
- CLI commands

The existing `/api/v1/answers` flow is still valuable and stays supported during the transition. The current high-level answer shapes are the product's proven behavior and should be wrapped, not discarded:

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`
- `free_form` as engine fallback only

`free_form` should not become a sprawling standalone tool surface. The long-term low-friction entry point is `ask`, which routes into named tools and falls back to the existing engine only when no structured tool matches.

## Locked Transport Architecture

The primary agent transport is Streamable HTTP MCP served from the same long-lived Node.js process as `mako serve`.

This gives the product:

- one warm daemon
- centralized store/bootstrap behavior
- shared local state
- multi-agent access from one endpoint
- easier debugging than stdio-only transport

Secondary surfaces remain:

- thin HTTP REST routes
- CLI commands

All three surfaces must adapt over the same transport-neutral logic in `packages/tools`.

### Transport Rules

- MCP is served from the same process as `mako serve`
- bind to `127.0.0.1` only
- validate `Origin` on the MCP endpoint
- use the SDK's recommended localhost host-validation path for MCP
- every tool declares `outputSchema`
- every non-destructive tool declares `annotations: { readOnlyHint: true }` (the spec-accurate field name)
- stdout is reserved for protocol traffic when MCP is active; logs go to stderr

## Phases

### Phase 0: Core Layers Locked

Status: `Done`

Completed:

- dual SQLite stores with enforced bootstrap policy
- deterministic indexing
- evidence-backed answer engine
- HTTP API, CLI, and thin web client
- CLI/API/browser smoke coverage

Done when:

- `pnpm test:smoke` exits `0`
- `pnpm test:smoke:web` exits `0`
- browser golden path works end to end

### Phase 1: Hardening

Status: `Done`

Completed:

- stable API envelopes and request IDs
- negative-path assertions for the existing answer flows
- browser automation in CI
- clearer handoff docs

Done when:

- smoke runs in CI on push
- invalid JSON and representative runtime failures return stable envelopes
- current layers are safe to build on

### Phase 2: Tools Package And Transport

Status: `Done`

Goal:

Ship the invariant tool layer and the first agent-facing transports together.

Completed:

- `packages/tools/src/answers/` for the existing high-value answer shapes
- `packages/tools/src/imports/` for graph-driven import tools
- `packages/tools/src/symbols/` for symbol/export tools
- shared tool input/output types in `packages/contracts`
- `GET /api/v1/tools` and thin `POST /api/v1/tools/<name>` routes on the existing server
- `POST /mcp` on the existing server using the SDK's recommended Express integration pattern
- one MCP server registration path backed by the shared tools package
- output schemas and read-only annotations on all applicable tools
- local-only host/origin validation around the MCP endpoint

Rules:

- no business logic in transport code
- no MCP SDK code inside `packages/tools`
- no CLI-specific code inside `packages/tools`
- pure async functions returning typed JSON

Ship these tools first:

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`
- `imports_deps`
- `imports_impact`
- `imports_hotspots`
- `imports_cycles`
- `symbols_of`
- `exports_of`

Done when:

- the current high-level answers are callable through `packages/tools`
- `tools/list` returns the full Phase 2 tool set with `outputSchema`
- an MCP client can call the tools and receive structured JSON
- matching HTTP tool routes return the same shape
- the tool package can be tested without starting the HTTP server
- existing `/api/v1/answers` behavior still works

### Phase 3: Database Schema Tools

Status: `Done`

Goal:

Add opt-in, read-only database schema tools without making live database access a core dependency.

Build:

- `db_ping`
- `db_columns`
- `db_fk`
- `db_rls`
- `db_rpc`
- `db_table_schema`

Implementation rules:

- use `pg_catalog` as the primary metadata source
- no live DB sync
- no SQLite caching of live DB metadata in Phase 3
- on-demand connections only
- wrap every call in a read-only transaction guard
- keep Supabase support thin and PostgreSQL-first

Connection model at ship time:

- gate the feature behind `MAKO_DB_TOOLS_ENABLED`
- resolve the current project's live DB binding from `.mako/project.json`
- when the project has no usable binding, return a typed binding/configuration error instead of crashing

Done when:

- all DB tools are available through MCP and matching HTTP routes
- CI smoke can exercise them against a disposable Postgres
- docs explain how to bind a project DB via env-var ref or keychain ref
- the implementation matches [phases/phase-3-db-tools.md](./phases/phase-3-db-tools.md)

### Phase 4: Ask Router

Status: `Done`

Goal:

Add one low-friction tool for agents that do not know the exact named tool yet.

Build:

- `ask(question)` pattern-matches into named tools first
- fallback to the existing engine `free_form` handler only when no named tool fits
- preserve the named tool families as the canonical direct surfaces
- expose which tool `ask` chose and which arguments it derived

Rules:

- `ask` is a thin router, not a second sprawling engine
- `ask` selects one best named tool in Phase 4
- `ask` does not do broad multi-tool orchestration in Phase 4
- if a new question shape becomes common, add or improve the underlying named tool first

Done when:

- common natural-language requests route into the correct structured tools
- fallback stays conservative when confidence is weak
- dispatch goldens pin selected tools and derived arguments
- the implementation matches [phases/phase-4-ask-router.md](./phases/phase-4-ask-router.md)

### Phase 5: Public Lock

Status: `Done`

Goal:

Polish the tool surface into a releaseable local-first MVP.

Build:

- README centered on the tool-call value proposition
- one install-and-run guide
- agent config examples for the shipped MCP surface
- one public tool registry page
- tool description polish and current-phase doc cleanup
- release-facing framing around the shipped MVP

Done when:

- a user can install, start `mako`, point an agent at `/mcp`, and call the tools without digging through the repo
- the public docs clearly present `ask` plus the named tools as the shipped MVP surface
- the implementation matches [phases/phase-5-public-lock.md](./phases/phase-5-public-lock.md)

Roadmap state:

- the initial Phase 0 through Phase 5 roadmap is complete
- follow-on work now moves through concrete-need gates rather than an open current phase

## Dependencies And Co-Development

- Phase 2 is one shipping unit. `packages/tools` and the first transports should be built together, not treated as isolated deliverables.
- Phase 3 built on the shipped Phase 2 contracts, registration pattern, config handling, and transport shape.
- Phase 4 is genuinely sequential. `ask` depends on the named tools existing first.
- Public lock follows the tool surface that actually ships; it is not a substitute for unfinished tool work.

This roadmap is disciplined about coupling, not artificially waterfall by default. Clean parallel work is allowed when the seams are real.

## Deferral Gates

### Sequencing Gates

These are delayed because they depend on earlier work:

- `ask` comes after the named tools exist
- public lock comes after the tool surface is usable and verified

### Concrete-Need Gates

These are delayed because there is no product need yet, not because they are "waiting their turn":

- worker/background job infrastructure
- live DB sync and write-side connectors
- ML or vector retrieval layers
- broader automation and platform features

## Planned Tool Inventory

| Tool | Phase | Category | Input | Output | Purpose |
|------|-------|----------|-------|--------|---------|
| `route_trace` | 2 | answer | `{ route }` | route handler, file, evidence | answer where a route is handled |
| `schema_usage` | 2 | answer | `{ object, schema? }` | definition, usages, evidence | answer where a table or schema object is used |
| `file_health` | 2 | answer | `{ file }` | role, dependents, risks, evidence | answer what a file does and what depends on it |
| `auth_path` | 2 | answer | `{ route?, file?, feature? }` | auth clues, confidence, evidence | answer likely auth path conservatively |
| `imports_deps` | 2 | imports | `{ file }` | imports, unresolved | inspect a file's imports |
| `imports_impact` | 2 | imports | `{ file, depth? }` | dependents graph, levels | trace downstream impact |
| `imports_hotspots` | 2 | imports | `{ limit? }` | files with import counts | identify highly connected files |
| `imports_cycles` | 2 | imports | `{}` | cycles | detect circular dependencies |
| `symbols_of` | 2 | symbols | `{ file }` | symbols | list indexed symbols in a file |
| `exports_of` | 2 | symbols | `{ file }` | exports | list indexed exports in a file |
| `db_ping` | 3 | db | `{}` | connectivity and platform metadata | verify database connectivity safely |
| `db_columns` | 3 | db | `{ table, schema? }` | columns | inspect columns and primary-key details |
| `db_fk` | 3 | db | `{ table, schema? }` | inbound and outbound foreign keys | inspect foreign-key references |
| `db_rls` | 3 | db | `{ table, schema? }` with optional qualified `schema.table` | RLS status and policies | inspect row-level security |
| `db_rpc` | 3 | db | `{ name, schema?, argTypes?, includeSource? }` with optional qualified `schema.function` | args, returns, language, security, source | inspect stored procedures/functions |
| `db_table_schema` | 3 | db | `{ table, schema? }` with optional qualified `schema.table` | columns, indexes, constraints, foreign keys, RLS, triggers | inspect full table schema shape |
| `ask` | 4 | router | `{ question, projectId?, projectRef? }` | selected tool, derived args, structured result | route natural language into named tools |

## Guardrails

- tool budget is `<= 20` at MVP
- before adding tool `#21`, delete or merge redundant tools
- one canonical tool per question shape
- no business logic in transport code
- no stdout logging during MCP protocol traffic
- all non-destructive tools are read-only
- keep `/api/v1/answers` working while the tool surface is added
- no ML or vector retrieval unless deterministic indexing proves insufficient
- read-only DB tools are allowed later; live DB sync and write-side connectors remain behind a concrete-need gate

## Non-Goals

- background workers as a core requirement
- live database synchronization
- autonomous remediation
- ML-first retrieval or pattern learning
- vector search as a requirement
- plugin marketplace work
- team, cloud, or dashboard-platform features
- multiple overlapping search tools that answer the same question differently
