# Tool Registry

This file documents the baseline public tool surface and the original question
shapes it was built around.

The current runtime surface is broader than the tables below. For the
authoritative live catalog, use one of:

- `mako tool list`
- `GET /api/v1/tools`
- MCP `tools/list`
- harness `tool_search`

Everything listed here is read-only and available through the same shared tool layer over:

- MCP at `http://127.0.0.1:3017/mcp`
- HTTP via `GET /api/v1/tools` and `POST /api/v1/tools/:name`
- CLI via `tool list` and `tool call`

Use `ask` when the question is natural language and you do not know the exact tool yet. Call a named tool directly when the question shape is already clear.

`/api/v1/answers` remains supported for the original answer flows, but the
current product also ships later roadmap families such as graph, operator,
workflow, artifact, composer, and code-intel tools over the same shared tool
plane.

## Router

| Tool | Common question shape | Description |
| --- | --- | --- |
| `ask` | "where is /api/v1/projects handled?" | Routes one natural-language engineering question into one canonical named tool, or falls back conservatively to `free_form`. |

## Answers

| Tool | Common question shape | Description |
| --- | --- | --- |
| `route_trace` | "what handles /auth/login?" | Traces a route to the indexed handler, matching files, and nearby evidence. |
| `schema_usage` | "where is projects used?" | Finds where an indexed schema object is defined and referenced in the repo. |
| `file_health` | "what does services/api/src/server.ts do?" | Summarizes a file's role, dependents, and notable risks with evidence. |
| `auth_path` | "what auth protects /api/v1/projects?" | Traces likely auth boundaries for a route, file, or feature without overclaiming. |

## Imports

| Tool | Common question shape | Description |
| --- | --- | --- |
| `imports_deps` | "what does services/api/src/server.ts import?" | Lists a file's direct indexed imports and flags unresolved internal edges. |
| `imports_impact` | "what depends on services/api/src/server.ts?" | Traces downstream dependents for a file through the indexed import graph. |
| `imports_hotspots` | "what are the import hotspots?" | Ranks the most connected files in the internal import graph. |
| `imports_cycles` | "show me import cycles" | Detects circular dependencies in the internal import graph. |

## Symbols

| Tool | Common question shape | Description |
| --- | --- | --- |
| `symbols_of` | "symbols in services/api/src/server.ts" | Lists the indexed symbols declared in a file. |
| `exports_of` | "exports of apps/cli/src/index.ts" | Lists only the indexed symbols that a file exports. |

## Database

These tools are optional. They require DB tools to be enabled and the current
project to have a live DB binding configured via `mako project db bind`.

| Tool | Common question shape | Description |
| --- | --- | --- |
| `db_ping` | "is the database connected?" | Verifies read-only connectivity and surfaces platform, version, schemas, and transaction state. |
| `db_columns` | "what columns does public.study_tracks have?" | Inspects only columns and primary-key details for a table via `pg_catalog`. |
| `db_fk` | "what foreign keys does courses have?" | Inspects inbound and outbound foreign-key references for a table via `pg_catalog`. |
| `db_rls` | "is RLS enabled on study_tracks?" | Inspects row-level security status and policies for a table via `pg_catalog`. |
| `db_rpc` | "show rpc get_student_profile" | Inspects one stored procedure or function signature, args, return shape, language, and security. |
| `db_table_schema` | "schema for public.study_tracks" | Inspects the full table shape, including columns, indexes, constraints, foreign keys, RLS, and triggers. |

## Tool Choice Rules

- Start with `ask` for open-ended questions.
- Use answer tools when you want an evidence-backed synthesized answer.
- Use import and symbol tools when you want direct structural facts.
- Use `db_columns` for column-only questions and `db_table_schema` for the broader table shape.
- Use `symbols_of` for all declared symbols and `exports_of` for the exported subset only.

## Next Docs

- [Install and run guide](./docs/install-and-run.md)
- [Master plan](./devdocs/master-plan.md)
- [Roadmap Version 2](./devdocs/roadmap/version-2/roadmap.md)
- [Phase 1 implementation brief](./devdocs/roadmap/version-2/phases/phase-1-project-contract-and-attach-ux.md)
