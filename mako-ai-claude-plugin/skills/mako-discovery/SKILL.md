---
description: >-
  TRIGGER when: user is working in an unfamiliar repo, asks 'where is X', 'what
  touches Y', needs broad search across code/schema/routes, or is unsure which
  mako tool fits the task. Covers `tool_search`, `repo_map`, `ask`,
  `cross_search`.
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

### `repo_map`

Use for first-turn repo orientation, entry points, central files, and major
modules.

- Use when the user asks what is important in a repo or package.
- Use before editing unfamiliar code when the likely blast radius is unclear.
- Do not use when the user has already named a specific route/table/RPC and
  wants direct evidence; use trace or neighborhood tools instead.

### `ask`

Use for one evidence-backed engineering question when a compact answer loop is
enough.

- Use when the user asks a natural-language question and does not need a full
  artifact or multi-tool packet.
- Prefer targeted tools directly when the question shape is already obvious.
- Treat the answer as a starting point if the task needs implementation or
  review-quality evidence.

### `cross_search`

Use for broad search across code, schema, route, and type surfaces when the
relevant implementation location is uncertain.

- Use for "where is X", "what touches Y", or "find the code/schema/route for Z".
- Use when exact text search is too narrow and repo relationships matter.
- Follow up with `route_trace`, `schema_usage`, `trace_table`,
  `trace_rpc`, or graph tools once the target is known.

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

