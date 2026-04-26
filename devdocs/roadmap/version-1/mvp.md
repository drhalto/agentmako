# MVP Scope

This file defines the product scope for the shippable local-first MVP.

The phase order lives in [roadmap.md](./roadmap.md). This file answers a different question: what the MVP must do, what it must expose, and what still stays out.

## MVP Outcome

Prove that `mako-ai` can serve as a useful local intelligence layer for a coding agent working in a JS/TS web project, with optional Postgres/Supabase schema awareness.

The smallest meaningful version is not just "an answer endpoint." It is:

- a project can be attached and indexed locally
- a coding agent can call structured tools against that index
- the response is fast, typed, and evidence-backed

## MVP Includes

- single-user local-first setup
- project attach and project registry
- repo indexing
- schema metadata capture from the project
- evidence-backed answer synthesis
- local HTTP server
- Streamable HTTP MCP served from the same process
- thin web client for attach, index, query, and evidence review
- CLI commands for local operator workflows
- shared tool layer that both MCP and HTTP adapt over

## MVP Query And Tool Surface

The MVP keeps the proven high-value answer shapes and exposes them as first-class tools:

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`

The MVP also adds lower-level structured tools that are directly useful to agents:

- `imports_deps`
- `imports_impact`
- `imports_hotspots`
- `imports_cycles`
- `symbols_of`
- `exports_of`

Phase 3 read-only database schema tools are now shipped. They extend the MVP's optional database awareness without changing the local-first core.

Phase 3 adds:

- `db_ping`
- `db_columns`
- `db_fk`
- `db_rls`
- `db_rpc`
- `db_table_schema`

Phase 4 adds:

- `ask`

`free_form` remains available only as the conservative fallback path behind the engine and the shipped `ask` router.

Phase 5 does not widen the MVP surface. It locks the public story around what is already shipped:

- install and run flow
- public tool registry
- agent config examples
- public-facing README and release polish

## MVP Tool Rules

- every tool has a clear single purpose
- every tool returns structured output
- every non-destructive tool is read-only
- one canonical tool per question shape
- the total MVP surface stays below the tool-budget cap in the roadmap and architecture decisions

## MVP User Experience

A successful MVP should let a user do this:

1. start `mako-ai`
2. attach a project
3. let the repo index finish
4. point a coding agent at the local MCP endpoint
5. call a named tool and get back structured evidence

## MVP Excludes

- autonomous remediation
- background workers as a requirement
- live database synchronization
- broad extension marketplace work
- semantic retrieval as a requirement
- heavy ML pipelines
- vector search as a requirement
- team, cloud, and dashboard-platform features
- overlapping tool sprawl

## Deferred But Planned

These are later roadmap items, not current MVP scope:

- worker groundwork if a real background need appears
- deeper DB connectivity beyond read-only inspection
