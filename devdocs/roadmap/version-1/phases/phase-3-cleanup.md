# Phase 3 Cleanup Brief

This file is the follow-up implementation brief for the current Phase 3 database-tool pass.

Use this after reading:

- [../roadmap.md](../roadmap.md)
- [./phase-3-db-tools.md](./phase-3-db-tools.md)
- [../../../scratch/fenrir-lessons.md](../../../scratch/fenrir-lessons.md)

## Why This Exists

Phase 3 shipped the correct broad architecture:

- transport-neutral DB tools in `packages/tools`
- `pg_catalog`-based Postgres extension code in `extensions/postgres`
- thin Supabase posture
- read-only, on-demand connections
- MCP + HTTP exposure over the shared tool layer

The remaining issues are not about connectivity. The implementation connects and returns useful data.

The remaining issues are about:

- strict identifier resolution
- overload-safe routine introspection
- output-shape consistency
- a small catalog/output edge case

This is a cleanup pass, not a redesign.

## Keep vs Fix

Keep:

- `packages/tools/src/db/` as the transport-neutral DB tool layer
- `extensions/postgres/` as the owner of `pg` and raw SQL
- `pg_catalog` as the primary metadata source
- on-demand read-only connections
- `db_ping`, `db_columns`, `db_fk`, `db_rls`, `db_rpc`, `db_table_schema`

Fix:

- qualified identifier handling
- overloaded function/procedure disambiguation
- `db_table_schema` RLS shape mismatch
- expression-index output contract mismatch

Do not change:

- Phase 3 into any kind of sync architecture
- SQLite boundaries
- Supabase into a first-class divergent implementation
- the decision to keep DB tools read-only and opt-in

## What To Borrow From Fenrir

Fenrir is worth borrowing for:

- system-catalog query ideas
- practical DB tool semantics
- the notion that one tool call should return one structured DB answer

Relevant reference:

- `fenrir/src/fenrir/integrations/mcp/tools/database.py` (external Fenrir repo, referenced as archival context)

Do not copy Fenrir’s weaker patterns:

- raw SQL interpolation guarded only by sanitization
- `LIMIT 1` behavior for routine lookup
- older `information_schema`-first queries where `pg_catalog` is better
- loosely shaped outputs without explicit ambiguity/error contracts

The goal is:

- borrow Fenrir’s useful query knowledge
- keep Mako’s stronger architecture and typed contracts

## Must-Fix Issues

### 1. Qualified Identifiers Do Not Work

Severity: `High`

Problem:

- The docs say callers may pass qualified names like `schema.table` or `schema.function`.
- The current implementation never splits qualified identifiers.
- It only treats `schema` as a separate optional input field and compares the raw `table` / `name` string directly.

Current affected code:

- [packages/contracts/src/tools.ts](../../../../packages/contracts/src/tools.ts)
- [extensions/postgres/src/identifiers.ts](../../../../extensions/postgres/src/identifiers.ts)
- [packages/tools/src/db/runtime.ts](../../../../packages/tools/src/db/runtime.ts)

Current affected docs:

- [./phase-3-db-tools.md](./phase-3-db-tools.md)
- [../../../architecture/overview.md](../../../architecture/overview.md)

Required fix:

- Add one canonical identifier-normalization helper for DB tools.
- Support both:
  - separate fields: `{ table: "study_tracks", schema: "public" }`
  - qualified string: `{ table: "public.study_tracks" }`
- If both are provided and conflict, return a typed validation error.
- Apply the same rule to:
  - `db_columns`
  - `db_fk`
  - `db_rls`
  - `db_table_schema`
  - `db_rpc`

Acceptance:

- `db_columns({ table: "public.study_tracks" })` resolves correctly.
- conflicting inputs such as `{ table: "public.study_tracks", schema: "other" }` fail cleanly.

### 2. `db_rpc` Cannot Disambiguate Overloaded Routines

Severity: `High`

Problem:

- The resolver keys only on routine `name` and optional `schema`.
- Postgres allows multiple functions/procedures with the same name in the same schema.
- The current ambiguity payload returns only `schema`, `name`, and `kind`, so the caller has no retry path.

Current affected code:

- [packages/contracts/src/tools.ts](../../../../packages/contracts/src/tools.ts)
- [extensions/postgres/src/identifiers.ts](../../../../extensions/postgres/src/identifiers.ts)
- [packages/tools/src/db/runtime.ts](../../../../packages/tools/src/db/runtime.ts)

Why Fenrir is not the answer:

- Fenrir used `LIMIT 1` in `db_rpc`, which hides overload ambiguity rather than solving it.
- That is simpler but wrong for a structured tool surface.

Required fix:

- Add an overload-disambiguation path for `db_rpc`.
- The cleanest option is to extend input with an optional signature selector, for example:
  - `argTypes?: string[]`
  - or one canonical textual signature field
- Ambiguity errors must include enough detail to retry successfully, such as:
  - schema
  - name
  - kind
  - argument types / signature text

Acceptance:

- same-name routines across schemas still return `db_ambiguous_object`
- same-name overloaded routines in one schema return a retryable ambiguity response
- callers have a documented, typed way to select the intended routine

### 3. `db_table_schema` Breaks RLS Shape Reuse

Severity: `Medium`

Problem:

- `db_rls` returns:
  - `rlsEnabled`
  - `forceRls`
- `db_table_schema.rls` currently returns:
  - `enabled`
  - `force`
- The Phase 3 spec explicitly requires shape reuse for aggregate outputs.

Current affected code:

- [packages/contracts/src/tools.ts](../../../../packages/contracts/src/tools.ts)
- [packages/tools/src/db/index.ts](../../../../packages/tools/src/db/index.ts)
- [./phase-3-db-tools.md](./phase-3-db-tools.md)

Required fix:

- Make `db_table_schema.rls` reuse the `db_rls` field names exactly.
- Keep `policies` identical to `db_rls.policies`.

Acceptance:

- `db_table_schema.rls` is structurally compatible with `db_rls` for the same table
- no client-side field remapping is needed

### 4. Expression Indexes Can Violate the Output Contract

Severity: `Medium`

Problem:

- Index metadata currently builds `columns: string[]` from `pg_index.indkey`.
- Expression indexes use `0` entries, which do not map to `pg_attribute.attname`.
- That can produce `null`-like gaps while the contract requires strings.

Current affected code:

- [extensions/postgres/src/table-schema.ts](../../../../extensions/postgres/src/table-schema.ts)
- [packages/contracts/src/tools.ts](../../../../packages/contracts/src/tools.ts)

Required fix:

- Handle expression-index slots intentionally instead of leaking invalid data.
- Pick one explicit design and apply it consistently:
  - either omit non-column slots from `columns`
  - or expose a separate field for expression terms
- Do not silently violate the schema-advertised `string[]` contract.

Acceptance:

- expression indexes return valid, schema-conformant output
- no `null`/invalid values can appear in `columns`

## Implementation Notes

### Identifier Normalization

Add one shared helper in the DB tool layer for parsing identifier input.

Suggested behavior:

- input `"public.study_tracks"` -> `{ schema: "public", name: "study_tracks" }`
- input `"study_tracks"` -> `{ schema: undefined, name: "study_tracks" }`
- reject multi-dot forms for now unless you deliberately support quoted identifiers

Do not duplicate this logic across individual tools.

### Overload Disambiguation

For routines, candidates should include signature material.

Suggested candidate shape:

```ts
{
  schema: string;
  name: string;
  kind: "function" | "procedure";
  argTypes: string[];
  signature: string;
}
```

This is the minimum needed for an agent to recover from ambiguity.

### Shape Reuse Rule

If a field already has a public tool shape, aggregate tools should reuse it.

Do not invent alternate field names in `db_table_schema` for:

- columns
- foreign keys
- RLS policy payloads

## Verification Required

At minimum:

- workspace typecheck/build
- existing smoke suites
- new smoke coverage for qualified identifiers
- new smoke coverage for conflicting qualified + explicit schema inputs
- new smoke coverage for overloaded routine ambiguity and disambiguation
- smoke coverage for expression-index output staying schema-valid

Suggested concrete cases:

1. `db_columns({ table: "public.study_tracks" })` returns success.
2. `db_columns({ table: "public.study_tracks", schema: "hogwarts_smoke_shadow" })` returns a typed validation error.
3. overloaded routine fixture:
   - ambiguous call returns retryable candidates with signature detail
   - disambiguated call succeeds
4. `db_table_schema` RLS block exactly matches `db_rls` field names.
5. expression index fixture does not break the output schema.

## Stop Point

Stop after:

- all four cleanup issues are fixed
- docs and contracts are aligned
- smoke coverage exists for the new behavior

Do not expand scope into:

- DB sync
- background refresh
- SQLite caching of live DB metadata
- Supabase-specific API branches unless a real Phase 3 gap appears
