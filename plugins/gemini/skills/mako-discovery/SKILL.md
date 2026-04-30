---
description: >-
  TRIGGER when: user is working in an unfamiliar repo, asks 'where is X', 'what
  touches Y', needs broad search across code/schema/routes, or is unsure which
  mako tool fits the task. Covers `mako_help`, `tool_search`, `repo_map`,
  `context_packet`, `ask`, `cross_search`, `reef_scout`, `file_preflight`,
  `reef_diff_impact`, `project_conventions`.
when_to_use: >-
  Use before targeted tracing when the implementation location, entity type, or
  best Mako tool is not yet clear.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Discovery

Use this skill for orientation and broad discovery. Prefer it when the user has
not yet named a precise file, route, table, RPC, or symbol.

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

### `repo_map`

Use for first-turn repo orientation, entry points, central files, and major
modules.

- Use when the user asks what is important in a repo or package.
- Use before editing unfamiliar code when the likely blast radius is unclear.
- Do not use when the user has already named a specific route/table/RPC and
  wants direct evidence; use trace or neighborhood tools instead.

### `context_packet`

Use for first-mile task context before reading or editing.

- Use `mode: "explore"` for discovery, `"plan"` before writing an
  implementation plan, `"implement"` before editing code, and `"review"` for
  verification or change review.
- Read `modePolicy` to understand which providers and follow-up tools were
  emphasized.
- Read `_hints`, `freshnessGate`, `risks`, `scopedInstructions`, and
  `expandableTools` before choosing the next call.

### `ask`

Use for one evidence-backed engineering question when a compact answer loop is
enough.

- Use when the user asks a natural-language question and does not need a full
  artifact or multi-tool packet.
- Prefer targeted tools directly when the question shape is already obvious.
- When routed to `cross_search`, Mako preserves the full normalized question
  instead of compressing it into a tiny keyword pair.
- Treat the answer as a starting point if the task needs implementation or
  review-quality evidence.

### `cross_search`

Use for broad search across code, schema, route, and type surfaces when the
relevant implementation location is uncertain.

- Use for "where is X", "what touches Y", or "find the code/schema/route for Z".
- Use when exact text search is too narrow and repo relationships matter.
- Defaults to compact output. Pass an explicit `limit` or
  `verbosity: "full"` when you need a broader search result.
- Follow up with `route_trace`, `schema_usage`, `trace_table`,
  `trace_rpc`, or graph tools once the target is known.

### `reef_scout`

Use for durable, ranked Reef context before reading or editing.

- Use for messy requests where existing facts, findings, rules, diagnostics, or
  DB review comments may already point at the right files.
- Ranking is intent-aware: app-flow questions favor files, routes, and
  findings; RLS/schema questions favor database evidence.
- Treat the top candidates as a reading queue, then use normal reads/search and
  targeted tools to verify.

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

### `reef_diff_impact`

Use mid-edit or before review when changed files may affect callers.

- Pass `filePaths` for the working-tree files you changed.
- Returns downstream import callers, active findings on those callers that may
  need re-checking, and applicable convention risks.
- It is read-only and does not run `working_tree_overlay`; if overlay facts are
  missing, call `working_tree_overlay` or wait for the watcher first.

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
