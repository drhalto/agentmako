---
description: >-
  Start here when working in a project with the mako-ai MCP server configured.
  Entry point that explains how mako's tool skills are organized and carries
  the policy for logging `agent_feedback` vs acknowledging static findings with
  `finding_ack`.
when_to_use: >-
  Use when starting a Mako-backed investigation, deciding which Mako skill to
  invoke, deciding whether to log tool feedback, or deciding whether a static
  finding should be acknowledged.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Guide

Mako is a project-intelligence MCP server. Use it when the user asks structural,
cross-surface, or evidence-backed engineering questions that are better answered
from indexed code, schemas, routes, graph edges, prior sessions, or telemetry
than from ad hoc file reads.

Do not use this skill as a schema reference. For current tool schemas, use MCP
ToolSearch or the live tool definition loaded by Claude Code.

## Skill Map

- Use `/mako-ai:mako-discovery` for first-turn orientation, broad search, and
  "which tool should I use?" questions.
- Use `/mako-ai:mako-trace` for targeted route, schema, file, table, RPC, edge,
  auth, or error tracing.
- Use `/mako-ai:mako-neighborhoods` for one-call table, route, or RPC context
  bundles.
- Use `/mako-ai:mako-graph` for relationships, dependency paths, import impact,
  symbol impact, flow mapping, and change planning.
- Use `/mako-ai:mako-database` for direct database schema, RLS, foreign-key, or
  RPC introspection.
- Use `/mako-ai:mako-code-intel` for structural AST pattern search and focused
  lint diagnostics.
- Use `/mako-ai:mako-workflow` for investigation packets, artifacts, recall,
  telemetry inspection, feedback, and finding acknowledgements.

## General Routing Rules

- Prefer Mako over built-in grep when the question is about relationships,
  not literal text.
- Built-in text search is fine for exact strings inside known files.
- Start broad only when the target is unknown; switch to targeted tools once
  you have a route, table, RPC, file, or symbol.
- Do not invent schemas, arguments, request IDs, finding fingerprints, or
  telemetry events.
- If a tool name is uncertain, use `tool_search` before calling a Mako tool.

## Feedback Logging Policy

Log `agent_feedback` selectively when a Mako result is notably useful,
partially useful, noisy, stale, incomplete, wrong, or wasted the turn. Do not
emit routine feedback after every tool call.

Before calling `agent_feedback`:

1. Call `recall_tool_runs`.
2. Filter by `toolName` and a recent ISO time window when possible.
3. Use a small `limit` first.
4. Copy the recalled `requestId` into `referencedRequestId`.
5. Set `referencedToolName` to the tool being rated.
6. Use `grade: "full" | "partial" | "no"`.
7. Include concise `reasonCodes` and a short human-readable `reason`.

If no `requestId` is available, do not fabricate one. Refine
`recall_tool_runs` or skip feedback.

Use these starter reason codes exactly when they fit:

- `grade: "full"`: `answer_complete`, `evidence_sufficient`,
  `trust_matches`
- `grade: "partial"`: `partial_coverage`, `noisy`, `stale_evidence`,
  `missing_known_caller`, `top_not_useful`
- `grade: "no"`: `answer_wrong`, `wasted_turn`, `tool_did_nothing`,
  `schema_missing`

The reason-code vocabulary is guidance, not a hard enum. New snake_case codes
are acceptable when none of the starter codes fit.

## Finding Acks Are Different

Use `finding_ack` for reviewed static findings, not for tool usefulness.

- Use `agent_feedback` to rate a specific Mako tool run.
- Use `finding_ack` to acknowledge a specific AST/lint/static finding as
  reviewed, accepted-risk, false-positive, or otherwise handled.
- Do not use `finding_ack` to rate search quality.
- Do not use `agent_feedback` to suppress or accept a static finding.

## Telemetry Inspection

Use `agent_feedback_report` and `runtime_telemetry_report` for inspection:

- confirm feedback capture worked;
- summarize tool quality over a window;
- debug whether a live session recorded events;
- prepare roadmap or implementation review notes.

Do not use telemetry reports as an automatic ranking system for tool selection
unless a future Mako phase explicitly implements that behavior.

