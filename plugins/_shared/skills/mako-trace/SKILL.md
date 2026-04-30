---
description: >-
  TRIGGER when: user asks to trace a specific route, schema object, file, table,
  RPC, or error string through its evidence. Covers `route_trace`,
  `schema_usage`, `file_health`, `auth_path`, `trace_file`, `preflight_table`,
  `trace_edge`, `trace_error`, `trace_table`, `trace_rpc`.
when_to_use: >-
  Use after discovery has identified a concrete entity or when the user already
  provided a route, file, schema object, table, RPC, edge, auth surface, or
  error text.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Trace

Use this skill for focused evidence traces around a known target. The output
should help the user understand what implements the target, what depends on it,
and what evidence supports the answer.

## Targeted Answer Tools

### `route_trace`

Use to find the route handler, nearby files, and evidence for a route/API
behavior.

- Best when the user names a route, page, method/path pair, or route-like URL.
- Pair with `auth_path` for authorization questions.
- Pair with `route_context` when the user wants a wider route neighborhood.

### `schema_usage`

Use to find where an indexed schema object, table shape, or validation type is
defined and referenced.

- Best for schema objects and type-ish entities.
- Use before editing validation contracts or generated schema surfaces.
- Pair with `trace_table` or `table_neighborhood` for database-backed entities.

### `file_health`

Use to understand a file's role, dependents, risks, and likely blast radius.

- Best before editing a central or unfamiliar file.
- Pair with `imports_impact` for a deeper dependency view.
- Do not use it for repo-wide orientation; use `repo_map`.

### `auth_path`

Use to inspect likely authentication or authorization boundaries for a route,
file, feature, or flow.

- Best when the user asks what protects something or whether auth is enforced.
- Pair with `route_trace`, `route_context`, and `tenant_leak_audit` when the
  risk is tenant or data-boundary related.
- If no exact route, file, or feature matches, `auth_path` returns
  `matched: false`, `reason`, and a suggested `cross_search` fallback instead
  of throwing a batch-breaking error.
- Do not overclaim; report evidence and uncertainty.

## Composer Trace Tools

### `trace_file`

Use for a compact file trace: symbols, imports, routes, schema touches, and
notable relationships before editing.

### `preflight_table`

Use before changing database-backed behavior to inspect table usage, RLS,
relations, and common query paths.

### `trace_edge`

Use to gather evidence for a relationship between two entities, files, routes,
tables, symbols, or RPCs.

### `trace_error`

Use to investigate an error string, stack, or failure mode and produce likely
causes with evidence.

### `trace_table`

Use to trace a table through schema, code references, routes, and related RPCs.

### `trace_rpc`

Use to trace a database RPC/function through schema and app-code callers.

## Feedback Logging

Log `agent_feedback` when a trace here was notably useful, partial,
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

- Use `/mako-ai:mako-neighborhoods` when a table, route, or RPC needs wider
  bundled context.
- Use `/mako-ai:mako-graph` when the question is dependency path, flow, impact,
  or change planning.
- Use `/mako-ai:mako-workflow` when the user wants a review bundle,
  verification bundle, or pre-ship artifact after tracing.
