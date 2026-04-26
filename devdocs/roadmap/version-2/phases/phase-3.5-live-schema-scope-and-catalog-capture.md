# Phase 3.5 Live Schema Scope And Catalog Capture

Status: `Complete`

## What Shipped

- `agentmako connect` now resolves schema scope professionally after a successful live DB test instead of falling back to the old free-text schema prompt. `apps/cli/src/index.ts` now asks `Use all detected app schemas? [Y/n]`, offers a visible-schema selection list when declined, and exposes an `Advanced options` path that reveals hidden/default-ignored schemas.
- Non-interactive connect no longer defaults blindly to `public`. When no explicit `--schemas` or saved scope exists, the CLI now discovers the visible app-schema set and persists that as `defaultSchemaScope`. Saved scopes are still inherited on later runs, so reconnects stay friction-free.
- Hidden-schema classification is now explicit and centralized in `services/indexer/src/db-binding/schema-scope.ts`. The default-hidden set covers `pg_catalog`, `information_schema`, `pg_toast`, temporary schemas, and Supabase-specific schemas (`auth`, `storage`, `realtime`, `graphql_public`, `extensions`) unless the user explicitly opts into advanced selection.
- The live schema snapshot is now materially richer. `services/indexer/src/db-binding/live-catalog.ts` uses `fetchTableSchema()` to persist indexes, foreign keys, RLS state/policies, and triggers alongside the existing tables/columns/views/enums/rpcs. The snapshot continues to use the same local schema IR instead of introducing a second DB model.
- The 3.5 review follow-up gaps were fixed in source:
  - RLS capture now preserves PostgreSQL's `PUBLIC` role and stores policy mode as `PERMISSIVE` or `RESTRICTIVE`.
  - trigger capture now preserves the real `tgenabled` firing mode (`O`, `D`, `R`, `A`) in addition to the derived enabled boolean.
  - routine argument capture now uses structured catalog arg types derived from `proargtypes`, so live-catalog RPC signatures no longer come from comma-splitting `pg_get_function_arguments(...)` text.
- Live verification was widened to match the richer capture surface when the stored snapshot actually has that metadata. `services/indexer/src/db-binding/verify.ts` now compares indexes, outbound foreign keys, RLS state/policies, and triggers for live-refreshed snapshots without making repo-only verification noisy.
- Interactive status output now surfaces the saved default schema scope, making the chosen scope inspectable from the normal CLI surface.
- Smoke coverage was extended in `test/smoke/core-mvp.ts` for the 3.5 connect/snapshot behavior:
  - non-interactive connect defaults to the discovered visible schema set and persists it
  - interactive connect can accept all visible schemas, choose a visible subset, or include hidden schemas through advanced options
  - live-refresh snapshots carry indexes, foreign keys, RLS, and trigger metadata
  - richer verify output now reports drift for indexes, foreign keys, RLS, and triggers once a project has a live-refreshed snapshot

## Verification Notes

- Verified in this shell:
  - `corepack pnpm typecheck`
  - `node --import tsx test/smoke/core-mvp.ts`
- The new live-DB smoke branches are gated on `MAKO_TEST_DATABASE_URL`. They are present in source but could not be executed in this shell because that environment variable is currently unset.

This file is the exact implementation spec for Roadmap 2 Phase 3.5.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.5.

## Prerequisites

Phase 3.5 assumes the following earlier phases are complete:

- Phase 3 — live DB binding and read-only refresh substrate
- Phase 3.1 — operator setup and binding UX
- Phase 3.2 — package-level `agentmako connect` flow and top-level aliases
- Phase 3.2.1 — CLI publishability
- Phase 3.3 — project profile depth
- Phase 3.4 — profile polish

Phase 3.5 exists before Phase 4 because the connect-time live schema capture needs to reach the structural shape the product actually intends to keep before append-only logging starts recording those refreshes and bindings as durable facts.

## Goal

Make `agentmako connect` leave behind the scoped live schema structure the product actually needs for future alignment, without making users manually type schema lists in the common case.

## Hard Decisions

- successful live DB connect should default to a live schema structure refresh, not stop at secret binding
- the captured live structure updates the same local schema IR and snapshot system that earlier phases already established
- schema structure is in scope; row data is not
- schema scope should be resolved interactively or by explicit flag, not by forcing repeated `--schemas public,...` usage
- ignored or system schemas stay hidden by default, but the human must still have a clear path to include them
- the common interactive question should be framed as app-schema selection, not whole-cluster ingestion
- Phase 3.5 should improve connect-time capture and saved scope, not reopen the secret-storage substrate

## Why This Phase Exists

The current Roadmap 2 connect flow can bind and refresh, but it still leaves too much schema-scope choice on the operator and still captures a thinner live structure than the roadmap should treat as the durable local DB substrate.

That is the wrong cut point before Phase 4.

Before logging and evaluation start recording DB refreshes as facts, `agentmako` should already:

- help the human choose schema scope professionally
- persist that choice for later verify/refresh flows
- capture the structural live catalog that later alignment work actually needs

Fenrir's DB-index work got one thing right here: even without row data, having the structural DB shape cached locally is the backbone for later schema-aware reasoning.

Phase 3.5 ports that lesson into `mako-ai`'s safer local-snapshot model.

## Scope In

- connect-time schema discovery after successful live DB authentication
- hiding known ignored/system schemas by default in the interactive selection flow
- a default interactive choice to use all visible app schemas
- a decline path that lists visible schemas and lets the human choose a subset
- an advanced-options path that reveals the hidden/default-ignored schemas and lets the human include them too
- persisting the resolved schema scope to the project manifest as the default scope for later verify/refresh
- refreshing the local schema snapshot automatically after scope resolution
- expanding the live catalog capture to persist, at minimum:
  - schemas
  - tables
  - columns
  - enums
  - views
  - functions/procedures
  - PKs
  - FKs
  - indexes
  - RLS policies
  - triggers
- status visibility that makes the saved scope and richer live-refresh state inspectable

## Scope Out

- row data
- query stats
- `pg_stat_*` usage or performance telemetry
- FTS/vector cache layers
- continuous sync
- background schema polling
- a second parallel schema model
- ranking, contradiction, or logging work from Phase 4

## User Experience Rules

### Interactive connect

After the DB URL is resolved and the connection test succeeds:

1. inspect live schemas
2. hide ignored/system schemas by default
3. ask: `Use all detected app schemas? [Y/n]`
4. if yes:
   - persist the visible schema set as the default scope
   - refresh the local schema snapshot immediately
5. if no:
   - show the visible schemas as a selectable list
   - include an `Advanced options` item at the bottom
6. if advanced options is opened:
   - reveal the hidden/default-ignored schemas
   - allow them to be selected too
7. persist the final selection and use it for the immediate refresh

### Non-interactive connect

Non-interactive mode should still support:

- explicit `--schemas ...`
- an automatic/default path that resolves the visible app schemas and persists them

But it should not silently broaden to every non-system schema in the cluster.

## Schema Visibility Rules

Hide these by default from the initial app-schema selection UI:

- `pg_catalog`
- `information_schema`
- `pg_toast`
- temporary schemas

For Supabase-style projects, also hide these by default unless the human explicitly opens advanced options or passes them via flags:

- `auth`
- `storage`
- `realtime`
- `graphql_public`
- `extensions`

These are not forbidden schemas.

They are just not the default visible set for the first selection screen.

## Catalog Capture Contract

The live-catalog layer should populate the existing schema IR with structural objects for the selected scope.

At minimum, that capture must include:

- schemas
- tables
- columns
- enums
- views
- functions/procedures
- primary keys
- foreign keys
- indexes
- RLS policies
- triggers

This is still structural metadata only.

No row contents or sampled table data belong in Phase 3.5.

## Build

- extend the live catalog reader so it captures the minimum structural set above rather than the thinner Phase 3 live shape
- add the schema-discovery pass used immediately after successful DB connect
- add the hidden-by-default schema classification rules
- add interactive schema-scope selection with the `Use all detected app schemas?` first prompt and `Advanced options` path
- persist the resolved schema scope into the manifest so future top-level `verify` / `refresh` commands reuse it
- make connect perform the scoped live refresh by default after successful DB authentication and scope resolution
- update status/CLI output so the saved scope and richer snapshot shape are visible
- add smoke coverage for:
  - default visible-schema selection
  - manual subset selection
  - advanced-options inclusion of hidden schemas
  - snapshot persistence of the richer catalog structure

## Rules

- do not persist raw DB URLs in manifests or SQLite
- do not create a second schema storage format; update the same local snapshot/IR
- do not make the default path ingest every schema in the database
- do not store row data
- keep the connect flow professional: schema selection should happen once and then be persisted
- keep the ignored-schema list explicit in code/docs rather than magical
- if a live catalog surface is unavailable on a given DB/provider, degrade clearly and preserve the rest of the snapshot

## Done when

- `agentmako connect` defaults to refreshing the live schema structure after successful DB binding
- the operator is asked whether to use all detected app schemas before being forced to type schema names
- declining that prompt opens a schema-selection flow with advanced access to hidden/default-ignored schemas
- the chosen scope is persisted and reused by later `verify` / `refresh` commands
- the local snapshot captures, at minimum:
  - schemas
  - tables
  - columns
  - enums
  - views
  - functions/procedures
  - PKs
  - FKs
  - indexes
  - RLS policies
  - triggers
- no row data is persisted
- Phase 4 can begin knowing the intended DB-structure substrate is already the one being kept locally
