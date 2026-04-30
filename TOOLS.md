# Tool Registry

This file documents the baseline public tool surface and the original question
shapes it was built around.

The current runtime surface is broader than the tables below. For the
authoritative live catalog, use one of:

- `agentmako tool list`
- `GET /api/v1/tools`
- MCP `tools/list`
- harness `tool_search`

Everything listed here is read-only and available through the same shared tool layer over:

- MCP at `http://127.0.0.1:3017/mcp`
- HTTP via `GET /api/v1/tools` and `POST /api/v1/tools/:name`
- CLI via `tool list` and `tool call`

Use `ask` when the question is natural language and you do not know the exact tool yet. Call a named tool directly when the question shape is already clear.

Every tool result includes `_hints: string[]` with result-specific next-step
guidance. Tool metadata also includes centralized MCP annotations for read-only,
open-world, idempotent, and destructive behavior.

`/api/v1/answers` remains supported for the original answer flows, but the
current product also ships later roadmap families such as graph, operator,
workflow, artifact, composer, and code-intel tools over the same shared tool
plane.

## Router

| Tool | Common question shape | Description |
| --- | --- | --- |
| `mako_help` | "how should I audit auth flow?" | Returns a task-specific Mako workflow recipe with ordered tool steps, pre-filled suggested args, and batchable follow-ups. |
| `ask` | "where is /api/v1/projects handled?" | Routes one natural-language engineering question into one canonical named tool, or falls back conservatively to `free_form`. |

## Answers

| Tool | Common question shape | Description |
| --- | --- | --- |
| `route_trace` | "what handles /auth/login?" | Traces a route to the indexed handler, matching files, and nearby evidence. |
| `schema_usage` | "where is projects used?" | Finds where an indexed schema object is defined and referenced in the repo. |
| `file_health` | "what does services/api/src/server.ts do?" | Summarizes a file's role, dependents, and notable risks with evidence. |
| `auth_path` | "what auth protects /api/v1/projects?" | Traces likely auth boundaries for a route, file, or feature without overclaiming. No-match cases return `matched: false` with a suggested `cross_search` fallback. |

## Code Intelligence

| Tool | Common question shape | Description |
| --- | --- | --- |
| `cross_search` | "where is manager onboarding checked?" | Broad indexed search across code, schema, routes, and memories. Defaults to compact output; pass `limit` or `verbosity: "full"` for wider results. |
| `live_text_search` | "find exact verifySession(" | Exact current filesystem text search after edits or for generated/unindexed files. |
| `ast_find_pattern` | "find `<Button disabled />` in TSX" | Structural TS/JS/TSX/JSX pattern search. TSX snippets starting with `{`, `[`, or `<` retry with auto-anchored parser context and report the winning variant. |
| `lint_files` | "lint these changed files" | Focused static diagnostics for selected files. Defaults compact; YAML rule packs under `.mako/rules` hot-reload and can declare `canonicalHelper` producer/consumer rules. |
| `project_index_status` | "is the index fresh?" | Reports indexed-vs-disk freshness and watcher hints. Defaults compact; use `verbosity: "full"` for stale sample paths. |

## Reef Context

| Tool | Common question shape | Description |
| --- | --- | --- |
| `context_packet` | "what should I read before fixing auth?" | First-mile task packet. Supports `mode: "explore" | "plan" | "implement" | "review"` and returns `modePolicy`, ranked context, risks, freshness gate, instructions, and expandable follow-up tools. |
| `reef_scout` | "where should I inspect auth route state?" | Intent-weighted scout over durable Reef facts, findings, rules, diagnostic runs, and review comments. App-flow queries prefer files/routes/findings; RLS/schema queries prefer database evidence. |
| `reef_inspect` | "show the Reef evidence for this file" | Returns the facts, findings, and diagnostic runs for one file or subject fingerprint. Use after `reef_scout` when you need the evidence trail. |
| `file_preflight` | "what should I know before editing this file?" | Pre-edit file gate: durable findings, file-scoped diagnostic freshness, source-filtered recent runs, watcher diagnostic state, applicable conventions, and acknowledgement history in one packet. |
| `reef_diff_impact` | "what did my changed files affect?" | Mid-edit impact packet for working-tree files: downstream import callers, active findings on those callers that may be invalidated, and conventions the diff may violate. |
| `project_conventions` | "what conventions should I follow?" | Surfaces conventions from explicit Reef facts plus profile/index/rule-derived signals: auth guards, runtime boundaries, generated paths, route patterns, and schema usage. |
| `project_open_loops` | "what unresolved work is known?" | Lists active findings, stale facts, and failed/stale diagnostics without launching broad checks. |
| `verification_state` | "are diagnostics fresh for changed files?" | Summarizes cached diagnostic freshness, file-scoped recent runs, watcher diagnostic state, and changed files that need verification. With `files`, runs only count when project-wide or scoped to those files. |

## Reef Findings

| Tool | Common question shape | Description |
| --- | --- | --- |
| `project_findings` | "what findings are active?" | Returns durable Reef findings. The `source` filter matches the producer source, such as `lint_files` or `cross_search`, the bare rule ID, or `rule_pack:<ruleId>`. |
| `file_findings` | "what findings affect this file?" | Returns durable findings for one file, including persisted query-time diagnostics from tools such as `cross_search` and `trace_file`. |
| `extract_rule_template` | "turn this fix into a rule pack" | Mines a local git fix diff for removed TS/JS anti-pattern shapes and returns a reviewable `.mako/rules` YAML draft. Read-only; it does not write the rule pack. |

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
project to have a live DB binding configured via `agentmako project db bind`.

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
- Use `reef_scout` when durable facts/findings may already identify the right
  files or schema evidence.
- Use `project_conventions` before edits where auth, runtime, route,
  generated-file, or schema habits matter.
- Use `file_preflight` before editing one risky file; it combines findings,
  diagnostics freshness, conventions, recent runs, and ack history.
- Use `reef_diff_impact` mid-edit or before review for changed files whose
  callers, caller findings, or conventions may be affected.
- Use `extract_rule_template` after fixing a repeated bug pattern to propose a
  rule-pack draft from the fix commit, then validate/edit before enabling.
- Use import and symbol tools when you want direct structural facts.
- Use `live_text_search` when exact current disk text matters after edits.
- Use `project_index_status` when indexed evidence may be stale.
- Use `db_columns` for column-only questions and `db_table_schema` for the broader table shape.
- Use `symbols_of` for all declared symbols and `exports_of` for the exported subset only.

## Next Docs

- [Reef Engine](./docs/reef-engine.md)
- [Tool annotations](./docs/tool-annotations.md)
- [Write tool convention](./docs/write-tool-convention.md)
- [Agent guidance to paste into CLAUDE.md / AGENTS.md](./AGENTS.md)
