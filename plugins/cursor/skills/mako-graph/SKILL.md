---
description: >-
  TRIGGER when: user asks about relationships, dependency paths, import hotspots
  or cycles, symbol impact, or blast radius of a proposed change. Covers
  `graph_neighbors`, `graph_path`, `flow_map`, `change_plan`, `imports_deps`,
  `imports_impact`, `imports_hotspots`, `imports_cycles`, `symbols_of`,
  `exports_of`.
when_to_use: >-
  Use for relationship questions, dependency traversal, import/symbol impact,
  end-to-end flows, and planning multi-file changes.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Graph

Use this skill when the user's question is about relationships rather than a
single entity. Graph, import, and symbol tools help estimate impact, find paths,
and plan changes from indexed project facts.

## Graph Tools

### `graph_neighbors`

Use to inspect immediate graph neighbors for a file, symbol, route, table, RPC,
or other known node.

### `graph_path`

Use to find evidence-backed paths between two known nodes.

- Best when the user asks whether A reaches B or how a route connects to a
  table/RPC/file.
- If the endpoints are ambiguous, use discovery or trace tools first.

### `flow_map`

Use to map a higher-level flow across routes, components, services, tables, and
RPCs.

- Best for end-to-end user stories or system behavior.
- Pair with `review_bundle_artifact` when a flow is being reviewed pre-ship.

### `change_plan`

Use to produce an evidence-backed edit plan and expected blast radius before
implementation.

- Best when the user asks "what do we need to change?" or "what might break?"
- Pair with artifact tools when the plan needs a durable handoff.

## Imports

### `imports_deps`

Use to inspect direct imports and unresolved internal edges for one or more
files.

### `imports_impact`

Use to estimate downstream dependents and likely blast radius of changing a
file/module.

### `imports_hotspots`

Use to identify highly connected import hotspots.

### `imports_cycles`

Use to detect or inspect circular dependencies.

## Symbols

### `symbols_of`

Use to list important symbols declared in a file.

### `exports_of`

Use to list exported symbols from a file or module.

## Feedback Logging

Log `agent_feedback` when a graph, import, or symbol result here was
notably useful, partial, noisy, stale, wrong, or wasted the turn. Skip
routine calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.

## See Also

- Use `/mako-ai:mako-trace` when the target is a specific route, table, RPC,
  file, or error.
- Use `/mako-ai:mako-neighborhoods` when one table, route, or RPC should be the
  center of the context bundle.
- Use `/mako-ai:mako-workflow` for artifacts after a plan or flow is clear.

