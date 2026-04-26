# Phase 3 Database Tools Specification

This file is the exact implementation spec for the current Phase 3 build target.

Use [../roadmap.md](../roadmap.md) for phase order and status. Use this file for the concrete design of the Phase 3 PostgreSQL/Supabase tool surface.

## Goal

Add opt-in, read-only PostgreSQL/Supabase schema tools to `mako-ai` without turning live database access into a core runtime dependency.

This phase is about inspection, not synchronization.

## Hard Decisions

- Phase 3 is read-only introspection only.
- Phase 3 does not include live DB sync.
- Phase 3 does not include LISTEN/NOTIFY, replication, triggers, or polling loops.
- Phase 3 uses `pg_catalog` as the primary metadata source.
- Phase 3 does not cache live DB metadata in SQLite.
- Phase 3 opens database connections on demand and closes them after each tool call.
- Phase 3 wraps every DB tool query in a read-only transaction guard.
- Phase 3 treats Supabase as PostgreSQL-first, with only thin platform detection.
- Repo-derived schema understanding and live DB introspection are separate lanes.

## Why No Sync

Schema metadata changes when migrations run. That is a low-frequency, explicit event.

For this product shape, sync infrastructure is the wrong problem because it adds:

- background behavior
- more operational state
- stale-data risk
- more coupling between the core engine and external systems

Phase 3 should answer:

- what tables and columns exist right now
- how they relate
- whether RLS is enabled
- what RPCs/functions exist

It should not try to maintain a continuously synchronized shadow database.

## Architecture Boundary

### `packages/tools/src/db/`

Owns:

- tool input/output schemas
- transport-neutral tool functions
- normalized output mapping
- typed error normalization

Does not own:

- `pg` driver setup
- raw SQL query text
- connection pooling logic

### `extensions/postgres/`

Owns:

- `pg` client usage
- connection lifecycle
- read-only transaction wrapper
- SQL against `pg_catalog`
- normalized low-level row mapping

### `extensions/supabase/`

Owns:

- thin platform detection
- future Supabase-specific augmentations if ever needed

Phase 3 rule:

- Supabase support is PostgreSQL-compatible first.
- Do not fork the design around Supabase-specific APIs unless a real gap appears.

### SQLite Boundary

Phase 3 does not write live DB metadata into `global.db` or `project.db`.

SQLite remains the home for:

- repo-derived facts
- indexed schema facts from the repo itself
- project state
- answer traces and app-owned state

Live DB tools should query the target directly and return structured output. They do not create a second cached source of truth in Phase 3.

## Tool Inventory

Phase 3 ships these tools:

1. `db_ping`
2. `db_columns`
3. `db_fk`
4. `db_rls`
5. `db_rpc`
6. `db_table_schema`

### 1. `db_ping`

Purpose:

- verify connectivity
- detect platform
- expose a safe first-call health probe for agents

Input:

```ts
{}
```

Output:

```ts
{
  connected: boolean;
  platform: "postgres" | "supabase" | "unknown";
  database: string;
  serverVersion: string;
  currentUser: string;
  readOnly: boolean;
  schemas: string[];
}
```

Notes:

- This is the canonical probe for `db_not_connected`.
- Supabase detection should stay heuristic and thin.
- Good enough heuristics include presence of common Supabase schemas such as `auth`, `storage`, or `supabase_functions`.
- If detection is uncertain or multiple heuristics disagree, `platform` must default to `"unknown"`. Do not guess.
- The `readOnly` field in this output is the **database connection's transaction read-only state** (e.g., from `SHOW transaction_read_only`). It is not the same as the MCP tool annotation `readOnlyHint`. They are unrelated concepts that happen to share a similar name: `readOnlyHint` tells an agent "this tool doesn't mutate state," while `readOnly` here tells a caller "this DB session is currently in a read-only transaction." Do not rename either to make them match.

### 2. `db_columns`

Purpose:

- inspect a table's columns cleanly

Input:

```ts
{
  table: string; // unqualified `table` or qualified `schema.table`
  schema?: string;
}
```

Rules:

- callers may pass either `table: "study_tracks"` plus `schema: "public"`, or one qualified value like `table: "public.study_tracks"`
- if both forms are provided and conflict, return `invalid_tool_input`

Output:

```ts
{
  table: string;
  schema: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    isPrimaryKey: boolean;
    isIdentity: boolean;
    comment?: string | null;
  }>;
}
```

### 3. `db_fk`

Purpose:

- inspect inbound and outbound foreign-key relationships

Input:

```ts
{
  table: string; // unqualified `table` or qualified `schema.table`
  schema?: string;
}
```

Output:

```ts
{
  table: string;
  schema: string;
  outbound: Array<{
    constraintName: string;
    columns: string[];
    targetSchema: string;
    targetTable: string;
    targetColumns: string[];
    onUpdate: string;
    onDelete: string;
  }>;
  inbound: Array<{
    constraintName: string;
    sourceSchema: string;
    sourceTable: string;
    sourceColumns: string[];
    columns: string[];
    onUpdate: string;
    onDelete: string;
  }>;
}
```

### 4. `db_rls`

Purpose:

- inspect row-level security state and policies

Input:

```ts
{
  table: string; // unqualified `table` or qualified `schema.table`
  schema?: string;
}
```

Output:

```ts
{
  table: string;
  schema: string;
  rlsEnabled: boolean;
  forceRls: boolean;
  policies: Array<{
    name: string;
    command: string;
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }>;
}
```

### 5. `db_rpc`

Purpose:

- inspect stored procedures/functions safely

Input:

```ts
{
  name: string;
  schema?: string;
  argTypes?: string[];
  includeSource?: boolean;
}
```

Rules:

- callers may pass either `name: "study_track_badge"` plus `schema: "public"`, or one qualified value like `name: "public.study_track_badge"`
- qualified-name parsing in Phase 3 supports simple unquoted `schema.name` forms only; quoted identifiers with embedded dots remain out of scope
- `argTypes` is the overload selector when multiple routines share the same name in one schema
- if both qualified and explicit `schema` are provided and conflict, return `invalid_tool_input`

Output:

```ts
{
  name: string;
  schema: string;
  args: Array<{
    name: string | null;
    type: string;
    mode: "in" | "out" | "inout" | "variadic" | "table";
  }>;
  returns: string;
  language: string;
  securityDefiner: boolean;
  volatility: "immutable" | "stable" | "volatile";
  source: string | null;
}
```

Rules:

- `source` defaults to `null`
- only populate `source` when `includeSource: true`
- do not expose function source by default
- for functions, `returns` is the function return signature from Postgres
- for procedures, `returns` is the literal string `"procedure"`

### 6. `db_table_schema`

Purpose:

- provide one aggregated table-level view

Input:

```ts
{
  table: string; // unqualified `table` or qualified `schema.table`
  schema?: string;
}
```

Output:

```ts
{
  table: string;
  schema: string;
  columns: unknown[];
  indexes: Array<{
    name: string;
    unique: boolean;
    primary: boolean;
    columns: string[];
    definition?: string | null;
  }>;
  constraints: Array<{
    name: string;
    type: string;
    definition?: string | null;
  }>;
  foreignKeys: unknown[];
  rls: {
    rlsEnabled: boolean;
    forceRls: boolean;
    policies: unknown[];
  };
  triggers: Array<{
    name: string;
    enabled: boolean;
    timing: string;
    events: string[];
  }>;
}
```

Notes:

- This is the aggregate inspection tool for one table.
- It is not a "list tables" endpoint.
- If a listing tool is needed later, add a separate `db_tables` tool instead of overloading this one.
- **Shape reuse is mandatory.** `columns` must match the exact shape returned by `db_columns.columns`, and `foreignKeys` must match the combined `db_fk.outbound` and `db_fk.inbound` shapes. Do not define a second shape for either. If a type changes in `db_columns` or `db_fk`, update `db_table_schema` in the same change. This keeps `db_table_schema` as a true aggregation, not a divergent format.
- `rls.policies` must match the shape returned by `db_rls.policies` for the same reason.
- `db_table_schema.rls` must reuse the exact field names from `db_rls`: `rlsEnabled`, `forceRls`, `policies`.
- `indexes[].columns` only includes physical column slots. Expression-only indexes therefore return `columns: []`, with the expression still visible in `indexes[].definition`.

## Data Sources

Use `pg_catalog` as the primary source for Phase 3.

Key catalogs:

- `pg_namespace`
- `pg_class`
- `pg_attribute`
- `pg_type`
- `pg_attrdef`
- `pg_constraint`
- `pg_index`
- `pg_trigger`
- `pg_proc`
- `pg_language`
- `pg_policy`
- `pg_description`

Use `information_schema` only if there is a narrow compatibility reason. It is not the primary design surface.

## Error Model

Phase 3 should return typed, agent-friendly errors:

- `db_not_connected`
- `db_permission_denied`
- `db_object_not_found`
- `db_ambiguous_object`
- `db_unsupported_target`
- `invalid_tool_input`

Guidelines:

- missing or invalid project live DB binding should return a typed binding/configuration error
- disabled DB tools should return `db_not_connected`
- missing table/function should not crash the server
- cross-schema ambiguity should be explicit

### Ambiguity Error Shape

Per architecture decision #18 ("Strict Identifier Resolution In Tools"), when an unqualified table or function name matches multiple objects across schemas, return a typed error with the candidate list. Do not silently pick one.

Required shape for `db_ambiguous_object`:

```ts
{
  error: "db_ambiguous_object";
  code: "db_ambiguous_object";
  message: string;
  candidates: Array<{
    schema: string;
    name: string;
    kind: "table" | "view" | "function" | "procedure";
    argTypes?: string[];
    signature?: string;
  }>;
}
```

Required shape for `db_object_not_found`:

```ts
{
  error: "db_object_not_found";
  code: "db_object_not_found";
  message: string;
  requested: {
    schema: string | null;
    name: string;
  };
}
```

When a caller passes a qualified `schema.table` / `schema.function` (or the `schema` input field) that resolves to exactly one object, return the tool result. When qualified and explicit `schema` conflict, return `invalid_tool_input`. When unqualified and multiple schemas match, return `db_ambiguous_object` with every candidate. For routine ambiguity, include `argTypes` and `signature` so the caller can retry with `db_rpc.argTypes`. When unqualified and zero schemas match, return `db_object_not_found`. These rules apply uniformly to `db_columns`, `db_fk`, `db_rls`, `db_rpc`, and `db_table_schema`.

## Security Model

- bind local transports to loopback as already designed
- treat all DB tools as read-only
- start a read-only transaction for every tool call
- do not rely only on the DB role being read-only
- never issue DDL or write queries in Phase 3
- keep credentials in config/env handling, not in tool payloads
- default `db_rpc.source` to `null`

## Connection Model

- gate feature activation with `MAKO_DB_TOOLS_ENABLED`
- resolve the current project's live DB binding from `.mako/project.json`
- support `env_var_ref` and `keychain_ref` binding strategies
- connect on demand
- run the query set
- close the connection

Phase 3 does not need:

- persistent pools
- long-lived listeners
- background refresh jobs

## Relationship To Repo Schema Parsing

Keep these as separate systems:

### Repo Schema Lane

- source: migrations, schema files, ORM definitions in the repo
- state: app-owned SQLite
- purpose: local code understanding

### Live DB Lane

- source: target Postgres/Supabase `pg_catalog`
- state: no Phase 3 caching
- purpose: direct environment inspection

Future drift detection can compare the two lanes, but that is not required to ship Phase 3.

## Verification

Phase 3 should verify:

- `db_ping` succeeds against disposable Postgres
- typed binding/configuration errors are stable when the project binding is absent or invalid
- every DB tool works through:
  - shared tool call
  - HTTP route
  - MCP
- read-only transaction guard is active
- cross-schema ambiguity returns typed errors
- `db_rpc` source stays `null` unless explicitly requested

### Assertion Strength

Smoke assertions must pin **specific catalog return values**, not token-level checks. This is the same discipline Phase 2 second-pass reinforced: `length > 0` style checks let real regressions slip through.

For example, against a disposable Postgres fixture with a known migration:

- `db_columns({ table: "projects" })` must pin the exact column list defined by the migration — names, types, nullability, and primary key — not just "returns some columns."
- `db_fk({ table: "projects" })` must pin the exact inbound and outbound foreign-key constraints by name.
- `db_rls({ table: "projects" })` must pin the exact `rlsEnabled` value and the policy names.
- `db_rpc({ name: "some_function" })` must pin the exact argument list, return type, and language. Additionally, assert that `source === null` when `includeSource` is absent or false, and that `source` is a non-empty string when `includeSource: true`.
- `db_table_schema({ table: "projects" })` must return shapes that are byte-for-byte compatible with the per-tool outputs for the same table (see `db_table_schema` shape reuse note).

Negative-path assertions (required):

- Unqualified ambiguous name returns `db_ambiguous_object` with a candidates array of length ≥ 2, each entry with `schema` and `name` fields.
- Non-existent object returns `db_object_not_found` with the `requested.schema` and `requested.name` fields populated.
- Missing or invalid project live DB binding returns a typed error without crashing the server.

The smoke harness should run against a Docker-launched disposable Postgres (or `pg-mem` if viable) so CI can exercise the full stack end-to-end. A mocked driver is insufficient — the catalog queries against `pg_catalog` must hit a real Postgres to verify the SQL is correct.

## Out Of Scope

- live schema sync
- background polling loops
- LISTEN/NOTIFY
- WAL / logical replication
- trigger-based shadow metadata
- SQLite caching of live DB metadata
- making Supabase a first-class fork in Phase 3
