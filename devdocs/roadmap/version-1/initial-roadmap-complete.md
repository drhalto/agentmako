# Initial Roadmap Complete

This document is the completion summary and build debrief for the initial `mako-ai` roadmap.

It records what the roadmap set out to build, what actually shipped, what remained deferred, and how the repo should be read now that Phases 0 through 5 are complete.

## Completion Status

The initial roadmap is complete.

Completed phases:

- Phase 0: Core Layers Locked
- Phase 1: Hardening
- Phase 2: Tools Package And Transport
- Phase 3: Database Schema Tools
- Phase 4: Ask Router
- Phase 5: Public Lock

Verification snapshot:

- `corepack pnpm test` exited `0` on `2026-04-13`
- this included:
  - workspace build
  - CLI/API smoke
  - ask-router goldens
  - public-lock docs smoke
  - browser golden-path smoke
  - package-level tests

Operational note:

- the final suite had to be rerun outside the sandbox because `tsx`/`esbuild` child-process spawn was blocked by the sandbox, not because of a repo failure

## What The Initial Roadmap Set Out To Build

The initial roadmap was the rebuild from a tangled predecessor into a clean, local-first, tool-first product:

- deterministic local indexing first
- a narrow but real agent-callable tool surface
- optional read-only database awareness
- one low-friction natural-language front door
- thin transports over one shared tool layer
- enough public-facing polish that a new user or coding agent could actually start and trust the system

The roadmap explicitly did **not** aim to build:

- live DB sync
- autonomous remediation
- worker-driven architecture as a requirement
- ML/vector-first retrieval
- platform or dashboard sprawl

## What Actually Shipped

### Core Architecture

- dual SQLite state:
  - `global.db`
  - `project.db`
- deterministic repo indexing
- evidence-backed answer synthesis
- thin API, CLI, web, and MCP surfaces over shared core logic
- local-only Streamable HTTP MCP served from the main Node.js server process

### Public Runtime Surfaces

- CLI
- HTTP API
- thin HTTP tool routes
- Streamable HTTP MCP
- thin local web client
- legacy `/api/v1/answers` retained for the original answer flows

### Shipped Tool Families

- Router:
  - `ask`
- Answers:
  - `route_trace`
  - `schema_usage`
  - `file_health`
  - `auth_path`
- Imports:
  - `imports_deps`
  - `imports_impact`
  - `imports_hotspots`
  - `imports_cycles`
- Symbols:
  - `symbols_of`
  - `exports_of`
- Database:
  - `db_ping`
  - `db_columns`
  - `db_fk`
  - `db_rls`
  - `db_rpc`
  - `db_table_schema`

### Public-Lock Outputs

- public-facing `README.md`
- canonical install guide in `devdocs/install-and-run.md`
- human-facing tool registry in `TOOLS.md`
- polished tool descriptions in the shipped registry
- docs smoke that checks public docs against the shipped CLI tool surface

## How The Build Progressed

### Phase 0: Core Layers Locked

Built:

- store and DB bootstrap discipline
- deterministic indexing
- initial answer engine
- HTTP API
- CLI
- thin web client
- smoke baseline

Meaning:

- the repo stopped being scaffolding and became a usable local system

### Phase 1: Hardening

Built:

- stable error envelopes
- request IDs
- negative-path coverage
- browser automation in CI
- cleaner handoff and architecture docs

Meaning:

- the base layers became safe enough to build on without constant regression risk

### Phase 2: Tools Package And Transport

Built:

- `packages/tools`
- transport-neutral tool definitions and schemas
- HTTP tool routes
- Streamable HTTP MCP
- CLI tool list/call over the same shared registry

Meaning:

- `mako-ai` became a real agent-callable local tool server instead of only an answer endpoint

### Phase 3: Database Schema Tools

Built:

- opt-in read-only PostgreSQL/Supabase schema tools
- `pg_catalog`-first implementation
- typed not-connected behavior
- on-demand, read-only DB access

Meaning:

- optional schema awareness landed without making live database connectivity a core dependency

### Phase 4: Ask Router

Built:

- deterministic natural-language routing into the named tools
- selected tool + derived args in the result
- conservative fallback to the existing `free_form` path only when no named tool fit
- router goldens

Meaning:

- the public tool surface got a low-friction front door without turning into a second engine

### Phase 5: Public Lock

Built:

- public front-door README
- canonical install/run guide
- public tool registry
- agent config examples
- public-facing tool description polish
- docs smoke against the shipped registry

Meaning:

- the product stopped depending on repo archaeology to understand how to install, run, connect, and use it

## Final Product Shape

The initial roadmap delivered a local-first repo intelligence engine with:

- fast attach/index/query workflow
- evidence-backed answer tools
- direct structural tool calls
- optional read-only DB inspection
- one natural-language router
- MCP as the primary agent transport
- thin HTTP and CLI surfaces over the same tool layer

The product is now a meaty MVP, not just a clean foundation.

## What Stayed Deferred

These were intentionally not pulled into the initial roadmap:

- worker/background processing as a required subsystem
- live DB sync
- write-side DB connectors
- ML/vector retrieval layers
- broader automation loops
- cloud/team/dashboard expansion

These are not “unfinished pieces” of the initial roadmap. They are follow-on seams behind concrete-need gates.

## What Changed From The Earliest Rebuild Framing

The rebuild started as a “get the core layers right” effort.

The final shipped result went further:

- from answer-only flows to a named tool surface
- from local API only to MCP + HTTP + CLI over one registry
- from repo-only facts to optional DB schema inspection
- from exact tool calls only to `ask`
- from internal architecture focus to public-ready docs and connection story

That expansion stayed disciplined because it followed one rule consistently:

- build one canonical tool surface per question shape
- keep transports thin
- keep deterministic retrieval as the default
- defer heavier subsystems until there is a concrete need

## If Work Resumes

There is no active implementation phase left inside the initial roadmap.

If development resumes, start from:

- the current Roadmap 2 at [../version-2/roadmap.md](../version-2/roadmap.md)
- the final Roadmap 1 state in [roadmap.md](./roadmap.md)
- the shipped public surface in [../../../TOOLS.md](../../../TOOLS.md)

The next work should be a new approved follow-on pass, not a reopening of unfinished work inside Phases 0 through 5.
