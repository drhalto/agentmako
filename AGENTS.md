# Mako MCP Usage

This file is the short agent-facing guide for projects that have Mako
registered as `mako-ai`:

```json
{
  "mako-ai": {
    "command": "agentmako",
    "args": ["mcp"]
  }
}
```

In Claude Code, tools usually appear as `mcp__mako-ai__<toolName>`. Examples
below use bare names. For complete CLI/tool details, use `agentmako --help`,
`agentmako tool --help`, MCP `tools/list`, or `mako_help`.

## Operating Model

Mako is deterministic project context, not a replacement for reading files,
editing carefully, and running tests. Use it to narrow scope: relevant files,
symbols, routes, schema objects, findings, freshness, and risks.

Prefer Mako before broad grep when the question is about structure,
cross-file impact, routing, auth, database usage, or known findings. Prefer
`live_text_search` or shell `rg` when exact current disk text matters.

Evidence modes:

- Indexed/Reef: fast and structured, but tied to the last index or persisted
  fact snapshot.
- Live: current filesystem or database. Use for exact lines, edited files, or
  new/generated files.

Read `_hints` on every Mako result. They are generated from the actual output
and often give the best next step.

## Default Workflow

When unsure, call `mako_help` first. It returns an ordered recipe with
suggested args and verification steps:

```json
{
  "task": "audit auth flow for tenant-scoped dashboard role checks",
  "focusFiles": ["app/dashboard/layout.tsx"],
  "changedFiles": ["app/dashboard/layout.tsx"]
}
```

For broad or vague work, start with `context_packet`:

```json
{
  "request": "debug why manager onboarding role checks are failing",
  "mode": "explore",
  "includeInstructions": true,
  "includeRisks": true,
  "risksMinConfidence": 0.7,
  "includeLiveHints": true,
  "freshnessPolicy": "prefer_fresh",
  "budgetTokens": 4000
}
```

Use `mode: "explore" | "plan" | "implement" | "review"` to tune the packet.
Read `primaryContext`, `activeFindings`, `risks`, `scopedInstructions`,
`freshnessGate`, and `expandableTools`, then continue with normal file reads,
targeted search, edits, and tests.

When files are already known, pass `focusFiles`.

## Fast Batches

Use `tool_batch` for independent read-only follow-ups:

```json
{
  "verbosity": "compact",
  "continueOnError": true,
  "ops": [
    { "label": "freshness", "tool": "project_index_status", "args": { "includeUnindexed": false } },
    { "label": "conventions", "tool": "project_conventions", "args": { "limit": 20 } },
    { "label": "open-loops", "tool": "project_open_loops", "args": { "limit": 20 } }
  ]
}
```

`tool_batch` rejects mutation tools such as `project_index_refresh`,
`working_tree_overlay`, `diagnostic_refresh`, `db_reef_refresh`, and
acknowledgement writes.

## Freshness

In long-running MCP sessions, Mako's watcher refreshes changed files and runs
scoped diagnostics in the background. Normal edits should not require manual
`project_index_refresh` or `diagnostic_refresh`.

Use `project_index_status` before trusting indexed line numbers, after large
edits, or when a tool reports stale/degraded evidence. Use
`includeUnindexed: true` only when discovering new files; it walks the
filesystem.

For file-scoped verification, a diagnostic run counts only when it was
project-wide or its `metadata.requestedFiles` includes the file.
`verification_state` returns filtered `recentRuns` plus watcher diagnostic
state, so stale output should show whether the daemon skipped, failed, or has
not caught up.

Fallbacks:

- `live_text_search`: exact current text without reindexing.
- `project_index_refresh { "mode": "if_stale" }`: refresh stale index data.
- `project_index_refresh { "mode": "force" }`: only when indexed AST/search
  looks wrong.
- `working_tree_overlay`: snapshot working-tree file facts without full AST
  reparse.
- `diagnostic_refresh`: run selected diagnostics when watcher-backed
  verification still reports stale, failed, unavailable, or unknown.

## Search And Code Intelligence

- `cross_search`: broad indexed search across code, routes, schema, RPCs,
  triggers, and memories. Defaults compact.
- `live_text_search`: exact current disk search; defaults fixed string.
- `ast_find_pattern`: structural TS/JS/TSX/JSX search. TSX snippets starting
  with `{`, `[`, or `<` also try an auto-anchored parser context.
- `repo_map`: token-budgeted project outline.
- `symbols_of`, `exports_of`: file symbol/export surfaces.
- `imports_deps`, `imports_impact`, `imports_hotspots`, `imports_cycles`:
  import graph questions.
- `graph_neighbors`, `graph_path`, `flow_map`: graph and flow context.
- `trace_file`, `route_trace`, `route_context`, `auth_path`: focused file,
  route, and auth tracing. `auth_path` returns a structured `matched: false`
  fallback instead of breaking batches.
- `schema_usage`, `table_neighborhood`, `rpc_neighborhood`, `trace_table`,
  `trace_rpc`, `trace_edge`, `trace_error`: schema/RPC and composer traces.

## Reef Tools

Reef is Mako's durable fact/finding layer.

- Start messy investigations with `reef_scout`.
- Inspect one evidence trail with `reef_inspect`.
- Before editing a risky file, use `file_preflight` instead of separate
  `file_findings`, `verification_state`, `project_conventions`, and ack
  history calls.
- Mid-edit or before review, use `reef_diff_impact` for changed files. It
  reports downstream callers, active caller findings that may need re-checking,
  and convention risks. It does not refresh Reef.
- Use `project_findings` / `file_findings` for durable findings. Source filters
  accept producer sources, bare rule IDs, and `rule_pack:<ruleId>` aliases.
- Use `project_open_loops`, `project_diagnostic_runs`, `verification_state`,
  `project_conventions`, `rule_memory`, `evidence_confidence`,
  `evidence_conflicts`, and `reef_instructions` for focused review.

## Diagnostics And Rule Packs

Use diagnostics before and after code changes:

- `lint_files`: bounded Mako diagnostics plus hot-reloaded `.mako/rules` YAML.
- `typescript_diagnostics`, `eslint_diagnostics`, `oxlint_diagnostics`,
  `biome_diagnostics`: source-specific checks.
- `diagnostic_refresh`: persist selected diagnostic results into Reef.
- `git_precommit_check`: staged auth and client/server boundary checks.

For repeated bug patterns, use `extract_rule_template` on a fix commit to
draft a `.mako/rules` YAML rule, then validate with `rule_pack_validate`.
Rule packs can use `canonicalHelper` for primitive cross-file helper-bypass
checks.

Use `finding_ack` / `finding_ack_batch` only for reviewed findings that are
accepted or intentionally ignored. Do not ack findings just to reduce noise.
Check `finding_acks_report` before assuming clean output means nothing was
suppressed.

## Database And Supabase

For Postgres/Supabase projects, use live DB tools for schema/RLS/RPC questions:

- `db_ping`, `db_table_schema`, `db_columns`, `db_fk`, `db_rls`, `db_rpc`.
- `db_reef_refresh` after migrations or Supabase type regeneration.

For RLS-sensitive work, combine `db_table_schema` + `db_rls`, then use
`schema_usage` or `table_neighborhood` to find app callers.

## Project-Specific Notes

Customize this section in target repos with stack, auth model, risky
directories, required checks, and `.mako/instructions.md` location.

For risky auth, route, tenant, RLS, or role changes:

1. `context_packet` with instructions and risks.
2. `reef_instructions` for target files if needed.
3. `auth_path`, `route_context`, or `route_trace`.
4. `db_rls`, `db_rpc`, and `tenant_leak_audit` for privileged data or tenant
   isolation.
5. `file_preflight` before editing and `verification_state` / tests after.
6. `git_precommit_check` before committing boundary-sensitive changes.

## Shell Fallback

Use shell tools when Mako is unavailable, when you need to run apps/tests/builds
or migrations, or when exact file contents matter. Prefer `rg` for text search.
If Mako and live files/tests disagree, trust live reads and test output, then
refresh Mako if indexed context should catch up.
