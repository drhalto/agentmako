# Phase 3.5.1 Live Schema Read Model And Introspection

Status: `Complete`

## What Shipped

- `services/indexer/src/db-binding/live-catalog.ts` now uses `pg-introspection` as the primary PostgreSQL catalog source for namespaces, classes, enum types, and routines. Targeted fallback queries remain only where they still add value: per-table normalization via `fetchTableSchema()` and formatted routine signature details.
- `packages/store/src/migration-sql.ts` now defines a flattened current-snapshot read model in `project.db` covering `schema_snapshot_schemas`, `schema_snapshot_tables`, `schema_snapshot_columns`, `schema_snapshot_primary_keys`, `schema_snapshot_indexes`, `schema_snapshot_foreign_keys`, `schema_snapshot_rls_policies`, `schema_snapshot_triggers`, `schema_snapshot_views`, `schema_snapshot_enums`, and `schema_snapshot_rpcs`.
- `ProjectStore.saveSchemaSnapshot()` now rebuilds the flattened read model in the same transaction as the canonical `schema_snapshots` upsert. `ProjectStore.clearSchemaSnapshot()` clears the canonical snapshot and the derived read model together.
- `schema_snapshots.ir_json` remains the canonical payload. The flattened tables are purely derived current-snapshot read surfaces.
- The existing snapshot source table now accepts `live_catalog` as a valid source kind, and a follow-up migration rewrites older project DBs so the canonical snapshot schema matches the `SchemaSourceKind` contract.
- Smoke coverage in `test/smoke/core-mvp.ts` now proves direct save, overwrite, and clear behavior against the flattened read model, plus representative direct queries over tables, columns, enums, RPCs, policies, and triggers without unpacking `ir_json`.

## Verification Notes

- Verified in this shell:
  - `corepack pnpm typecheck`
  - `corepack pnpm run build:force && node --import tsx test/smoke/core-mvp.ts`
- The live-DB-gated smoke branches remain gated on `MAKO_TEST_DATABASE_URL`; they were not runnable in this shell because that environment variable is unset.

This file is the exact implementation spec for Roadmap 2 Phase 3.5.1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.5.1.

## Prerequisites

Phase 3.5.1 assumes the following earlier phases are complete:

- Phase 3.5 — live schema scope and catalog capture
- Phase 3.4.1 — tsconfig alias hotfix
- Phase 3.4 — profile polish
- Phase 3.3 — project profile depth

Phase 3.5.1 exists before Phase 4 because the product now captures the structural live schema it wants to keep, but it does not yet persist that structure in the most queryable local form.

Before append-only logging starts recording refreshes and verifications as durable facts, the local schema substrate should already have:

- a stronger PostgreSQL catalog introspection engine
- one canonical snapshot payload
- a flattened relational read model that stays in sync with that snapshot

## Goal

Keep the schema snapshot canonically stored as JSON, but make the current live/refreshed schema easy to query locally and easier to build later alignment work on top of.

## Hard Decisions

- `schema_snapshots.ir_json` remains the canonical snapshot payload
- flattened relational tables are a derived local read model, rebuilt from the canonical snapshot
- synchronization happens when the snapshot is saved or cleared, not through background polling
- the local query model should describe the current snapshot only; append-only snapshot history is not part of this phase
- PostgreSQL introspection should move toward `pg-introspection` rather than growing more custom catalog SQL

## Why This Phase Exists

Phase 3.5 got the connect-time DB substrate to the right structural shape:

- schema scope selection is professional
- richer live metadata is captured
- refresh and verify operate on the intended DB structure

But the local persistence shape is still lopsided:

- the canonical snapshot is mostly in `schema_snapshots.ir_json`
- direct SQLite querying is possible but clumsy
- future auto-detection and alignment work would need to keep unpacking JSON instead of querying stable relational tables

That is not the right substrate to freeze before Phase 4.

Phase 3.5.1 fixes that by keeping the canonical JSON snapshot while adding a flattened current-snapshot read model and tightening the live-catalog ingestion layer around a stronger introspection engine.

## Scope In

- adopting `pg-introspection` as the preferred PostgreSQL catalog introspection layer for live schema capture
- mapping `pg-introspection` results into the existing `SchemaIR` contract rather than introducing a second canonical schema model
- adding flattened SQLite tables for the current schema snapshot, at minimum for:
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
- rebuilding the flattened read model whenever `saveSchemaSnapshot()` runs
- clearing the flattened read model whenever `clearSchemaSnapshot()` runs
- store/test coverage that proves the flattened read model is queryable directly from `project.db`
- documentation updates so later phases treat the hybrid model as the intended DB substrate

## Scope Out

- continuous background sync against the live DB
- row-data storage
- append-only historical snapshot versions
- replacing `SchemaIR` with a second canonical schema contract
- Phase 4 logging work

## Storage Model

Phase 3.5.1 standardizes the schema substrate as:

1. canonical snapshot blob
   - `schema_snapshots.ir_json`
2. derived flattened read model
   - rebuilt from the canonical snapshot in the same transaction

This means:

- JSON remains the export/debug/fingerprint source of truth
- relational tables become the local query surface
- snapshot save/clear is the only synchronization boundary in this phase

## Synchronization Rule

The read model must stay synchronized with the current stored snapshot.

That means:

- a successful connect+refresh writes the canonical snapshot and rebuilds the flattened tables
- an explicit refresh does the same
- clearing the snapshot clears the flattened tables too

This phase does **not** add:

- automatic polling
- background refresh
- write-through updates from live DB events

If the live DB changes after the last refresh, the local read model remains a faithful representation of the last stored snapshot until the next explicit refresh.

## Introspection Rule

For PostgreSQL/Supabase live catalog reads, prefer `pg-introspection` over continuing to expand ad hoc custom `pg_catalog` queries.

Rules:

- `pg-introspection` is the preferred ingestion layer
- the adapter must still emit the existing `SchemaIR` contract
- provider-specific gaps may still use targeted fallback queries if `pg-introspection` does not expose a required field cleanly
- the introspection change should reduce bespoke catalog logic, not widen the public API surface

## Build

- add `pg-introspection` to the workspace where the live catalog adapter lives
- replace or substantially narrow the current custom catalog gathering in `services/indexer/src/db-binding/live-catalog.ts`
- keep `fetchTableSchema()` helpers only where they still provide value or provider-specific normalization
- add a new project migration for flattened schema snapshot tables
- extend `ProjectStore.saveSchemaSnapshot()` to rebuild the flattened tables inside the same transaction as the canonical snapshot write
- extend `ProjectStore.clearSchemaSnapshot()` to clear the flattened read model too
- add store/query helpers only if they materially simplify tests or downstream callers; otherwise direct SQL against the flattened tables is acceptable
- add tests that prove:
  - snapshot save populates the flattened tables
  - snapshot overwrite replaces them cleanly
  - snapshot clear removes them
  - representative queries over tables/columns/enums/rpcs/policies/triggers work without unpacking JSON

## Rules

- do not remove `schema_snapshots.ir_json`
- do not build historical snapshot retention into this phase
- do not introduce background sync
- do not let the flattened tables drift independently of the canonical snapshot
- do not replace the `SchemaIR` contract just because the introspection engine changes

## Done when

- PostgreSQL live-catalog ingestion uses `pg-introspection` as its primary source
- the current schema snapshot is queryable through flattened relational tables in `project.db`
- saving a snapshot rebuilds the flattened read model in the same transaction
- clearing a snapshot clears the flattened read model
- the flattened model covers, at minimum:
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
- docs clearly state that the system now uses a hybrid storage model:
  - canonical JSON
  - flattened current-snapshot read tables
- Phase 4 can begin against a DB substrate that is both structurally rich and locally queryable
