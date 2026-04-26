# Phase 6 Parser And Resolver Hardening

Status: `Shipped`

## Deployment Observation

On 2026-04-24, after Phase 5 made Mako a stronger first-mile context
scout, the operator asked for a second pass over custom mechanics that
could be replaced with mature packages or structured parsers.

The review found several places where Mako was still spending product
risk on generic parsing, matching, transport framing, and resolver
logic:

- Supabase generated-types parsing hand-walked braces, comments,
  strings, object keys, and type expressions.
- repo SQL schema-object extraction used regex for `CREATE TABLE`,
  `CREATE VIEW`, `CREATE TYPE`, and `CREATE FUNCTION`.
- schema usage indexing used broad object-name word scans before
  structured code patterns.
- harness permission globs, unified diff application, SSE event parsing,
  route matching, and indexer concurrency were custom helpers.
- TS / JS import resolution manually handled extensions, index files,
  and path aliases.

This belongs in Initial Testing because these are correctness and
maintenance risks that show up only once external coding agents rely on
Mako's indexed evidence as a starting point.

## Goal

Replace narrow custom mechanics with package-backed implementations
where the tradeoff is small, while preserving Mako's typed storage,
tool contracts, and project-root safety boundaries.

## Hard Decisions

- **Prefer structured parsers for code and schema facts.**
  Supabase generated types now use the TypeScript compiler AST; repo SQL
  schema-object discovery now uses `pgsql-parser` for valid Postgres DDL
  with the old regex path only as parse-failure fallback.
- **Do not pretend PL/pgSQL body analysis is fully solved.**
  `deriveFunctionTableRefs` is centralized and now strips comments and
  string literals before its heuristic scan, but procedural function-body
  table references remain a follow-up for a dedicated SQL / PL/pgSQL
  analyzer.
- **Reuse existing dependencies where possible.**
  `picomatch`, TypeScript, `pgsql-parser`, and `diff` already fit the
  repo's direction. New packages are tiny and scoped to the packages that
  use them.
- **Keep public semantics narrow.**
  Permission globs use `picomatch` with brace, extglob, and negation
  syntax disabled so the old contract does not silently broaden.
- **Use package APIs as mechanics, not product boundaries.**
  Mako still owns evidence shape, ranking, refresh behavior, and safety
  checks.

## Scope Shipped

### Workstream A - Supabase Types AST Parser

- Replaced the generated-types hand parser in
  `services/indexer/src/schema-sources/supabase-types.ts` with the
  TypeScript compiler AST.
- Supports `interface Database` and `type Database`.
- Extracts schema namespaces, tables, views, enums, RPCs, and row
  columns from nested `TypeLiteralNode` / interface members.
- Added `test/smoke/supabase-types-ast-parser.ts`.

### Workstream B - Repo SQL DDL Extraction

- Switched `extractSchemaObjectsFromSql` to async `pgsql-parser`
  extraction for valid Postgres SQL.
- Extracts table, column, view, enum, and RPC object records from parser
  AST nodes.
- Keeps the previous regex extractor as fallback only when parser
  initialization or parsing fails.
- `buildSchemaSnapshot`, repo DB refresh, and full project indexing now
  await the parser-backed path.
- `schema-snapshot-bodies` now proves fake DDL inside comments and
  string literals is ignored.

### Workstream C - Schema Usage Structure

- Added TypeScript AST detection for Supabase call sites:
  `.from("table")`, `.schema("schema").from("table")`, `.rpc("name")`,
  and `.schema("schema").rpc("name")`.
- Keeps plain word matching as fallback when no structured usage exists
  for that object/file.
- Existing language filter still prevents docs/config prose from
  becoming executable schema usage.

### Workstream D - SQL Body Table-Ref Helper

- Moved duplicate function-body table-reference derivation into
  `packages/store/src/sql-analysis.ts`.
- Store snapshot read-model rebuilds and indexer function extraction now
  use the same helper.
- The helper strips SQL comments and single-quoted string literals before
  matching `FROM` / `JOIN` / `UPDATE` / `INSERT` / `DELETE` references.
- Full parser-backed PL/pgSQL body analysis remains parked because this
  path runs inside synchronous store read-model rebuilds and function
  bodies are often procedural text, not standalone SQL statements.

### Workstream E - TS / JS Resolution

- `services/indexer/src/ts-js-structure.ts` now uses
  `ts.resolveModuleName` with project `tsconfig` compiler options via
  `get-tsconfig`.
- Manual local resolution remains fallback when TypeScript cannot resolve
  a project-local target.
- Smoke coverage now includes a `paths` alias import.

### Workstream F - Small Package Swaps

- `packages/harness-core` permission glob matching now uses
  `picomatch` with constrained syntax.
- `packages/harness-tools` unified diff creation/parsing/application now
  uses the `diff` package.
- CLI harness SSE stream parsing now uses `eventsource-parser`.
- Harness server route matching now uses `path-to-regexp`.
- Indexer chunk-build concurrency now uses `p-limit`.

## Deferred

- Full parser-backed PL/pgSQL function-body table-reference extraction.
  The current shared helper is less noisy and no longer duplicated, but
  a complete replacement needs a dedicated analyzer that can handle
  procedural bodies, dynamic SQL, and the synchronous store rebuild
  boundary.
- Type-aware TS project modeling with `ts-morph`. TypeScript resolver
  coverage was enough for this phase; richer type graph work belongs in
  a later indexing phase.

## Verification

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/supabase-types-ast-parser.ts`
- `node --import tsx test/smoke/schema-scan-usage.ts`
- `node --import tsx test/smoke/schema-snapshot-bodies.ts`
- `node --import tsx test/smoke/pgsql-parser-experiment.ts`
- `node --import tsx test/smoke/ts-js-structure-indexing.ts`
- `node --import tsx test/smoke/harness-action-tools.ts`
- `node --import tsx test/smoke/harness-no-agent.ts`
- `node --import tsx test/smoke/harness-providers.ts`
- `node --import tsx test/smoke/harness-resume.ts`
- `node --import tsx test/smoke/harness-tool-runs.ts`

## Done When

- Supabase generated-type extraction no longer uses brace/string
  hand-parsing.
- Valid repo SQL DDL object extraction is parser-backed and ignores DDL
  text in comments/string literals.
- TS / JS schema usage prefers structured Supabase calls over broad word
  hits.
- TS / JS import resolution honors project `tsconfig` paths through the
  TypeScript resolver.
- Harness glob, diff, SSE, route matching, and indexer concurrency
  helpers are package-backed.
- Function-body table refs are centralized with the remaining heuristic
  called out explicitly.
- `devdocs/roadmap/version-initial-testing/handoff.md` includes Phase 6
  status and links.
- CHANGELOG entry present.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Initial Testing contract
- [../handoff.md](../handoff.md) - execution handoff
- [./phase-3-package-backed-search-and-parsing.md](./phase-3-package-backed-search-and-parsing.md)
- `services/indexer/src/schema-sources/supabase-types.ts`
- `services/indexer/src/schema-scan.ts`
- `services/indexer/src/schema-sources/sql.ts`
- `services/indexer/src/ts-js-structure.ts`
- `packages/store/src/sql-analysis.ts`
- `packages/harness-core/src/permission-engine.ts`
- `packages/harness-tools/src/action-tools.ts`
- `apps/cli/src/commands/harness.ts`
- `services/harness/src/server-helpers.ts`
