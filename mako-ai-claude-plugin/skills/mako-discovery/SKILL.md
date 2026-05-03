---
description: >-
  TRIGGER when: user is working in an unfamiliar repo, asks 'where is X', 'what
  touches Y', needs broad search across code/schema/routes, or is unsure which
  mako tool fits the task. Covers `reef_ask`, `reef_status`, `reef_verify`,
  `reef_impact`, `mako_help`, `tool_search`, `context_packet`,
  `live_text_search`, `lint_files`, and `tool_batch`.
when_to_use: >-
  Use before targeted tracing when the implementation location, entity type, or
  best Mako tool is not yet clear.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Discovery

Use this skill for orientation and broad discovery. Prefer it when the user has
not yet named a precise file, route, table, RPC, or symbol. Default to
`reef_ask`; load specialist tools only when Reef or `tool_search` identifies a
concrete need.

## Tools

### `tool_search`

Use when the task intent is clear but the exact Mako tool name or schema is
unknown.

- Use it to find the right Mako tool and load its live schema.
- Do not use it as the final answer when a domain tool should be called next.
- Pair it with the other skills when a result points to a trace, graph,
  database, or workflow tool.

### `mako_help`

Use when you know the task but not the Mako workflow order.

- Returns a task-specific recipe such as auth-flow audit, DB/RLS audit,
  pre-edit file gate, review/verification, diagnostics triage, or general
  orientation.
- Each step includes `toolName`, `suggestedArgs`, `whenToUse`, `readOnly`, and
  `batchable`.
- Use the returned `batchHint` to batch independent read-only follow-ups after
  the first orientation call.

### `reef_ask`

Use for the primary answer loop over codebase, database, findings,
diagnostics, instructions, freshness, and quoted literal checks.

- Use for open-ended repo questions, planning questions, debugging questions,
  where-used questions, database inventory questions, and known-finding
  questions.
- Pass `focus` or `changedFiles` when known.
- Read `evidence`, `risks`, `freshness`, `missingEvidence`, and `nextQueries`
  before choosing any follow-up.
- Use `evidenceMode: "full"` only when compact evidence is insufficient.

### Reef Loop Tools

Use these direct Reef adapters for the normal agent loop after `reef_ask`.

- `reef_status`: maintained issues, changed files, stale diagnostics, schema,
  watcher state, and queue health.
- `reef_verify`: completion gate for diagnostic freshness and unresolved open
  loops; read it before claiming work is verified.
- `reef_impact`: changed-file impact over downstream callers, invalidated
  findings, and convention risks.

### `context_packet`

Use when `reef_ask` needs raw ranked context expansion before reading or
editing.

- Use `mode: "explore"` for discovery, `"plan"` before outlining
  implementation work, `"implement"` before editing code, and `"review"` for
  verification or change review.
- Read `modePolicy` to understand which providers and follow-up tools were
  emphasized.
- Read `_hints`, `freshnessGate`, `risks`, `scopedInstructions`, and
  `expandableTools` before choosing the next call.

### `live_text_search`

Use when exact current disk text matters more than indexed/project knowledge.

- Use for regex, custom globs, generated or unindexed files, and raw full
  inventories.
- For bounded quoted literal checks, prefer `reef_ask` first.

### Specialist discovery

Use `tool_search` for specialist tools such as `repo_map`, `cross_search`,
`ast_find_pattern`, `reef_scout`, route/table/RPC neighborhoods, graph tools,
DB inspection, or finding/ack workflows.

- Do not load specialist tools just to browse the catalog.
- Prefer `reef_ask` or `mako_help` first unless the exact specialist target is
  already known.

### `project_conventions`

Use to learn project-specific habits before changing risky surfaces.

- Returns explicit Reef convention facts plus conventions derived from the
  project profile, indexed auth-like symbols, routes, generated files, schema
  usage, and rules.
- Useful kinds include `auth_guard`, `runtime_boundary`, `generated_path`,
  `route_pattern`, and `schema_pattern`.
- Use before auth, routing, generated-file, or database-touching edits when the
  local conventions are unclear.

### `file_preflight`

Use before editing a known risky file.

- Returns durable findings, file-scoped diagnostic freshness, recent diagnostic
  runs, watcher diagnostic state, applicable conventions, and finding
  acknowledgement history in one packet.
- With `sources`, recent diagnostic runs are filtered to those sources. For
  file-scoped checks, only project-wide runs or runs whose `requestedFiles`
  include the file count as covering it.
- Use instead of chaining `file_findings`, `verification_state`,
  `project_conventions`, and ack-history calls when the question is "what
  should I know before changing this file?"
- Use `reef_inspect` only when a returned finding or fact needs deeper
  evidence.

### `reef_impact`

Use mid-edit or before review when changed files may affect callers.

- Pass `filePaths` for the working-tree files you changed.
- Returns downstream import callers, active findings on those callers that may
  need re-checking, and applicable convention risks.
- It is read-only and does not run `working_tree_overlay`; if overlay facts are
  missing, call `working_tree_overlay` or wait for the watcher first.
- `reef_diff_impact` remains the lower-level compatibility name for the same
  calculation.

## Feedback Logging

Log `agent_feedback` when a result here was notably useful, partial,
noisy, stale, wrong, or wasted the turn. Skip routine calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.

## See Also

- Use `/mako-ai:mako-trace` after discovery identifies a concrete target.
- Use `/mako-ai:mako-neighborhoods` when the target is a table, route, or RPC
  and the user needs bundled surrounding context.
- Use `/mako-ai:mako-graph` for dependency paths and blast radius.
