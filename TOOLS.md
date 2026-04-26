# Tool Registry

This document lists the public Mako tool surface in this release snapshot.

Source of truth:

- Registry tools: `packages/tools/src/tool-definitions.ts`
- Composer tools: `packages/tools/src/composers/*`
- MCP discovery and harness action exposure: `services/api/src/mcp.ts`
- Harness action tools: `packages/harness-tools/src/action-tools.ts`

Mako currently ships 85 registry tools. MCP also exposes `tool_search` and lists
6 harness action tools as blocked unless a harness approval session is active.

Authoritative runtime catalog:

```bash
agentmako tool list
```

You can also inspect tools through:

- HTTP: `GET /api/v1/tools`
- MCP: `tools/list`
- MCP discovery: `tool_search`

Mode legend:

- `read-only`: reads index/store/live DB/disk state without writing Mako state.
- `mutation`: writes local Mako state, refreshes indexes/diagnostic facts, or records feedback/acks. Database mutation tools in this list write only to Mako's local store unless explicitly stated.

## Router

| Tool | Mode | Purpose |
| --- | --- | --- |
| `ask` | read-only | Routes one natural-language engineering question to one canonical named tool, or conservatively falls back to free-form handling. |

## Context

| Tool | Mode | Purpose |
| --- | --- | --- |
| `context_packet` | read-only | Turns a messy coding request into ranked, source-labeled context using deterministic providers first. |
| `reef_scout` | read-only | Builds a Reef-backed scout packet from durable facts, findings, rules, and diagnostic runs. |
| `reef_inspect` | read-only | Explains one file or subject fingerprint with its facts, findings, and relevant diagnostic runs. |
| `evidence_confidence` | read-only | Labels evidence as verified, fresh, stale, fuzzy, historical, contradicted, or unknown. |
| `evidence_conflicts` | read-only | Surfaces stale indexed evidence, explicit conflict facts, and incorrect-evidence findings. |
| `tool_batch` | read-only | Runs independent read-only Mako lookups in one request with labeled sub-results. |

## Code Intelligence

| Tool | Mode | Purpose |
| --- | --- | --- |
| `repo_map` | read-only | Emits a token-budgeted aider-style outline of ranked files and key symbols. |
| `ast_find_pattern` | read-only | Runs ast-grep structural search over fresh indexed JS/TS/JSX/TSX files. |
| `live_text_search` | read-only | Runs live ripgrep text search over the project root. |
| `lint_files` | mutation | Runs Mako rule-pack, TS-aware, and structural diagnostics for indexed files and persists Reef findings. |
| `typescript_diagnostics` | mutation | Runs TypeScript compiler diagnostics and persists Reef diagnostic run/finding rows. |
| `eslint_diagnostics` | mutation | Runs local ESLint on requested files and persists Reef diagnostic run/finding rows. |
| `oxlint_diagnostics` | mutation | Runs local Oxlint on requested files and persists Reef diagnostic run/finding rows. |
| `biome_diagnostics` | mutation | Runs local Biome checks on requested files and persists Reef diagnostic run/finding rows. |
| `git_precommit_check` | mutation | Checks staged TS/TSX files for route auth and Next.js client/server boundary mistakes. |
| `diagnostic_refresh` | mutation | Invokes selected diagnostic sources and records compact per-source Reef results. |

## Composers

| Tool | Mode | Purpose |
| --- | --- | --- |
| `cross_search` | read-only | Searches one term across code chunks, schema objects, RPC/trigger bodies, routes, and memories. |
| `preflight_table` | read-only | Returns table preflight context: columns, keys, indexes, FKs, RLS, triggers, routes, and schemas. |
| `trace_file` | read-only | Traces a file through symbols, imports, dependents, routes, and related evidence. |
| `trace_edge` | read-only | Traces a handler or edge function through routes, callers, tables, RPCs, and DB triggers. |
| `trace_error` | read-only | Traces an error term across throw sites, catch handlers, and PL/pgSQL bodies. |
| `trace_table` | read-only | Traces a table through schema shape, RPC-to-table edges, and app-code `.from()` call sites. |
| `trace_rpc` | read-only | Traces an RPC through definition, body references, table refs, and app-code `.rpc()` call sites. |

## Answers

| Tool | Mode | Purpose |
| --- | --- | --- |
| `route_trace` | read-only | Traces a route to the indexed handler, matching files, and nearby evidence. |
| `schema_usage` | read-only | Finds where an indexed schema object is defined and referenced. |
| `file_health` | read-only | Summarizes a file's role, dependents, and notable risks with evidence. |
| `auth_path` | read-only | Traces likely auth boundaries for a route, file, or feature without overclaiming. |

## Neighborhoods

| Tool | Mode | Purpose |
| --- | --- | --- |
| `table_neighborhood` | read-only | Builds a bounded table context bundle from schema, usage, RPC, route, and RLS surfaces. |
| `route_context` | read-only | Builds a bounded route context bundle from handler, imports, schema usage, RPC, and RLS surfaces. |
| `rpc_neighborhood` | read-only | Builds a bounded RPC context bundle from signature/body, callers, table refs, and RLS surfaces. |

## Graph

| Tool | Mode | Purpose |
| --- | --- | --- |
| `graph_neighbors` | read-only | Traverses typed graph neighbors from one or more start entities. |
| `graph_path` | read-only | Finds a shortest typed path between two entities. |
| `flow_map` | read-only | Converts a graph path into ordered flow steps and boundary crossings. |
| `change_plan` | read-only | Returns path-derived change surfaces, one-hop dependents, and dependency order. |

## Imports

| Tool | Mode | Purpose |
| --- | --- | --- |
| `imports_deps` | read-only | Lists a file's indexed direct imports and unresolved internal edges. |
| `imports_impact` | read-only | Traces indexed files that depend on a file. |
| `imports_hotspots` | read-only | Ranks the most connected files in the internal import graph. |
| `imports_cycles` | read-only | Detects circular dependencies in the internal import graph. |

## Symbols

| Tool | Mode | Purpose |
| --- | --- | --- |
| `symbols_of` | read-only | Lists indexed symbols declared in a file. |
| `exports_of` | read-only | Lists indexed exported symbols for a file. |

## Database

These require DB tools to be enabled and the project to have a live DB binding.

| Tool | Mode | Purpose |
| --- | --- | --- |
| `db_ping` | read-only | Verifies read-only connectivity and reports platform, version, schemas, and transaction state. |
| `db_columns` | read-only | Inspects columns and primary-key details for one table via `pg_catalog`. |
| `db_fk` | read-only | Inspects inbound and outbound foreign-key references for one table. |
| `db_rls` | read-only | Inspects row-level security state and policies for one table. |
| `db_rpc` | read-only | Inspects one stored procedure or function signature, args, return shape, language, and security. |
| `db_table_schema` | read-only | Inspects full table shape: columns, indexes, constraints, FKs, RLS, and triggers. |

## Reef And Project State

| Tool | Mode | Purpose |
| --- | --- | --- |
| `project_index_status` | read-only | Compares indexed file rows against live disk metadata and reports freshness/watch state. |
| `project_index_refresh` | mutation | Runs the project indexer and returns before/after freshness summaries. |
| `db_reef_refresh` | mutation | Replaces Reef DB facts from the current schema snapshot. |
| `working_tree_overlay` | mutation | Snapshots working-tree file facts into Reef without reparsing AST/imports/routes/schema. |
| `reef_overlay_diff` | read-only | Diffs durable facts between overlays, usually indexed vs working tree. |
| `project_findings` | read-only | Queries durable Reef findings by overlay, source, status, and resolved inclusion. |
| `file_findings` | read-only | Queries durable Reef findings attached to one file. |
| `project_facts` | read-only | Queries durable Reef facts by overlay, source, kind, and subject fingerprint. |
| `file_facts` | read-only | Queries durable Reef facts for one file subject. |
| `list_reef_rules` | read-only | Lists durable Reef rule descriptors and rule metadata. |
| `rule_pack_validate` | read-only | Validates `.mako/rules` YAML packs without running diagnostics or writing state. |
| `project_diagnostic_runs` | read-only | Lists recent diagnostic source runs, status, duration, counts, command, config, and cache age. |
| `project_open_loops` | read-only | Lists unresolved findings, stale facts, and stale or failed diagnostic runs. |
| `verification_state` | read-only | Summarizes whether cached diagnostic runs still cover the current working-tree overlay. |
| `project_conventions` | read-only | Surfaces project convention facts and rule-derived convention candidates. |
| `rule_memory` | read-only | Aggregates rule descriptors and finding history for active, acknowledged, resolved, or suppressed rules. |
| `reef_instructions` | read-only | Loads applicable `.mako/instructions.md` and `AGENTS.md` guidance for requested files. |
| `db_review_comment` | mutation | Appends a local Mako review note about a database object or replication topic. |
| `db_review_comments` | read-only | Reads local DB review comments by object, category, tag, query, or fingerprint. |

## Workflows

| Tool | Mode | Purpose |
| --- | --- | --- |
| `suggest` | read-only | Recommends one canonical workflow or a short ordered sequence without hidden planner execution. |
| `investigate` | read-only | Runs a bounded read-only investigation chain and returns typed step history. |
| `workflow_packet` | read-only | Generates a typed workflow packet from a project-scoped query answer. |

## Artifacts

| Tool | Mode | Purpose |
| --- | --- | --- |
| `task_preflight_artifact` | read-only | Composes implementation brief, verification plan, change plan, and flow map into a preflight artifact. |
| `implementation_handoff_artifact` | read-only | Composes implementation brief and current session handoff into a reusable handoff artifact. |
| `review_bundle_artifact` | read-only | Composes implementation brief, change plan, flow map, and tenant audit into a review bundle. |
| `verification_bundle_artifact` | read-only | Composes verification plan, project-intelligence signals, and tenant audit into a verification bundle. |

## Operators

| Tool | Mode | Purpose |
| --- | --- | --- |
| `tenant_leak_audit` | read-only | Audits tenant-keyed tables, RLS posture, and RPC/code touch points. |
| `session_handoff` | read-only | Summarizes recent answer traces, unresolved focus, and follow-up momentum. |
| `health_trend` | read-only | Compares a recent trace window against a prior window. |
| `issues_next` | read-only | Derives one current issue plus queued follow-on issues from recent unresolved traces. |

## Session Recall

| Tool | Mode | Purpose |
| --- | --- | --- |
| `recall_answers` | read-only | Searches prior project answer traces by text, query kind, support level, trust state, and time window. |
| `recall_tool_runs` | read-only | Inspects prior project tool runs by tool name, outcome, request id, and time window. |

## Feedback

| Tool | Mode | Purpose |
| --- | --- | --- |
| `agent_feedback` | mutation | Appends agent feedback about a specific prior Mako tool run. |
| `agent_feedback_report` | read-only | Reports aggregate and recent agent feedback rows. |

## Finding Acknowledgements

| Tool | Mode | Purpose |
| --- | --- | --- |
| `finding_ack` | mutation | Appends one reviewed-safe marker to the `finding_acks` ledger. |
| `finding_ack_batch` | mutation | Appends many reviewed finding acknowledgements in one call. |
| `finding_acks_report` | read-only | Reports counts and recent rows from the `finding_acks` ledger. |

## Runtime Telemetry

| Tool | Mode | Purpose |
| --- | --- | --- |
| `runtime_telemetry_report` | read-only | Reports aggregate and recent `mako_usefulness_events` rows. |

## MCP Discovery Tool

`tool_search` is MCP-only. It searches the MCP-visible tool catalog, including
deferred registry tools and blocked harness action tools. Use it when an agent
is unsure which tool fits a task or why a tool is unavailable.

| Tool | Mode | Purpose |
| --- | --- | --- |
| `tool_search` | read-only | Searches MCP-visible tools and returns ranked matching tool names, descriptions, availability, and category. |

## Harness Action Tools

These are action tools from `@mako-ai/harness-tools`. The MCP server lists them
for discoverability, but marks them blocked unless a harness approval session is
available. They are not the normal read-only Mako knowledge tools.

| Tool | Mode | Purpose |
| --- | --- | --- |
| `file_write` | action | Creates or overwrites a project-relative file and returns a snapshot id for undo. |
| `file_edit` | action | Replaces a substring in an existing file. |
| `create_file` | action | Creates a new project-relative file and errors if it already exists. |
| `delete_file` | action | Deletes a project-relative file and snapshots bytes for undo. |
| `apply_patch` | action | Applies a multi-file unified diff whose hunks match exactly. |
| `shell_run` | action | Runs a shell command with argv-style arguments, cwd locked to the project root or a subdirectory. |

## Tool Choice Rules

- Start with `context_packet`, `reef_scout`, or `repo_map` for orientation.
- Use `ask` for a single natural-language question when the exact tool is unclear.
- Use `tool_search` from MCP clients when the visible catalog is too large.
- Use `tool_batch` to combine independent read-only follow-up lookups.
- Use `project_index_status` before trusting indexed evidence if files may have changed.
- Use `live_text_search` when you need exact live disk text instead of indexed evidence.
- Use Reef tools when you want what Mako already knows: facts, findings, diagnostics, conventions, open loops, and verification state.
- Use mutation tools deliberately: they write local Mako state, refresh cached analysis, or record feedback/acks.
