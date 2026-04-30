---
description: >-
  TRIGGER when: user asks about database schema, RLS policies, foreign keys,
  stored procedures, or table DDL directly. Covers `db_ping`, `db_columns`,
  `db_fk`, `db_rls`, `db_rpc`, `db_table_schema`.
when_to_use: >-
  Use for focused live database introspection when the question is about schema,
  policies, relationships, or stored procedures rather than app-code usage.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Database

Use this skill for direct database introspection. These tools require the
project to have a live DB binding configured. If the user asks how app code uses
database objects, use trace or neighborhood tools instead.

## Tools

### `db_ping`

Use to verify database connectivity and project wiring.

- Best when DB tools seem unavailable or the user asks whether the DB is
  connected.
- Use before deeper DB queries when the binding is uncertain.

### `db_columns`

Use to inspect columns and primary-key details for one or more tables.

- Best for narrow column questions.
- Use `db_table_schema` when indexes, constraints, triggers, or broader table
  shape matter.

### `db_fk`

Use to inspect foreign keys and relationships.

- Best for inbound/outbound relationship questions.
- Pair with `table_neighborhood` when code readers/writers also matter.

### `db_rls`

Use to inspect row-level security status and policies.

- Best for policy and protection questions.
- Pair with `tenant_leak_audit` for broader tenant-boundary risk review.

### `db_rpc`

Use to inspect database RPC/function definitions, signatures, args, return
shape, language, and security.

- Pair with `rpc_neighborhood` or `trace_rpc` when app-code callers matter.

### `db_table_schema`

Use to inspect the full table shape, including columns, indexes, constraints,
foreign keys, RLS, and triggers.

- Use when column-only output is insufficient.
- Pair with `trace_table` or `table_neighborhood` when code usage matters.

## Feedback Logging

Log `agent_feedback` when a DB introspection result here was notably
useful, partial, noisy, stale, wrong, or wasted the turn. Skip routine
calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.

## See Also

- Use `/mako-ai:mako-neighborhoods` for table/RPC context that combines DB facts
  with app-code usage.
- Use `/mako-ai:mako-trace` for table/RPC traces through code and schema.
- Use `/mako-ai:mako-workflow` for tenant audits and review artifacts.

