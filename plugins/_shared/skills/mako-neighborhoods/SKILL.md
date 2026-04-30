---
description: >-
  TRIGGER when: user wants entity-wide context for a table, route, or RPC --
  schema + RLS + readers + writers + downstream touches all at once. Covers
  `table_neighborhood`, `route_context`, `rpc_neighborhood`.
when_to_use: >-
  Use when a single table, route, or RPC is the center of the investigation and
  one composed context bundle is better than several primitive calls.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Neighborhoods

Use this skill when the user needs the surrounding context for one known table,
route, or RPC. Neighborhood tools are bounded composed bundles; they are usually
better than manually chaining primitives for common entity-centered questions.

## Tools

### `table_neighborhood`

Use for table-centered questions.

- Includes schema, RLS, readers, writers, routes, and RPC context.
- Best for "what touches this table?", "is this table protected?", and
  "what code reads/writes this table?"
- Pair with `preflight_table` before implementation when the user needs a more
  edit-oriented table preflight.

### `route_context`

Use for route-centered questions.

- Includes handler, imports, database touchpoints, RPCs, and nearby policy
  context.
- Best for "what does this route do?", "what data does this endpoint touch?",
  and "what is downstream of this route?"
- Pair with `auth_path` for auth-boundary-specific questions.

### `rpc_neighborhood`

Use for RPC-centered questions.

- Includes callers, touched tables, RLS context, and nearby implementation
  evidence.
- Best for "who calls this RPC?", "what tables does this function touch?", and
  "what policies matter for this RPC?"
- Pair with `trace_rpc` when the user needs a narrower evidence trace.

## Feedback Logging

Log `agent_feedback` when a neighborhood bundle here was notably useful,
partial, noisy, stale, wrong, or wasted the turn. Skip routine calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.

## See Also

- Use `/mako-ai:mako-trace` for narrower route/table/RPC evidence traces.
- Use `/mako-ai:mako-graph` for paths between entities or blast radius.
- Use `/mako-ai:mako-database` for direct live DB schema/RLS/RPC inspection.

