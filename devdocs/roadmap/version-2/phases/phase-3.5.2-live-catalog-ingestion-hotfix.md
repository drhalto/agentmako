# Phase 3.5.2 Live Catalog Ingestion Hotfix

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 3.5.2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.5.2.

## Prerequisites

Phase 3.5.2 assumes the following earlier phases are complete:

- Phase 3.5 — live schema scope and catalog capture
- Phase 3.5.1 — live schema read model and introspection

## Goal

Keep the 3.5 and 3.5.1 DB substrate gains, but simplify the live catalog ingestion layer back down to direct typed catalog SQL instead of the mixed `pg-introspection` plus fallback-query path.

## What Shipped

- `services/indexer/src/db-binding/live-catalog.ts` no longer uses `pg-introspection`; schema names, relations, enums, and routines now come from direct typed catalog SQL again
- the richer 3.5 structure stayed intact: live capture still feeds schemas, tables, columns, enums, views, functions/procedures, PKs, FKs, indexes, RLS policies, and triggers into `SchemaIR`
- the 3.5.1 flattened read model stayed intact; no storage/read-model tables were reverted
- `services/indexer/package.json` no longer declares `pg-introspection`
- verification:
  - `corepack pnpm typecheck`
  - `corepack pnpm run test:smoke`

## Hard Decisions

- keep the flattened snapshot read-model tables from Phase 3.5.1
- keep `schema_snapshots.ir_json` as the canonical snapshot payload
- keep the transactional rebuild-on-save / clear-on-clear behavior
- keep the RPC merge fix that preserves richer live routine metadata
- drop `pg-introspection`
- prefer direct targeted `pg_catalog` / `information_schema` queries when they return the exact flat row shape we persist

## Why This Phase Exists

Phase 3.5.1 got the storage substrate right:

- current schema snapshots are queryable
- the canonical JSON snapshot remains intact
- the read model stays synchronized transactionally

But the `pg-introspection` adoption did not actually simplify the system.

Instead, it produced a mixed ingestion layer:

- object-graph traversal for namespaces, classes, and enums
- fallback custom SQL for routine details
- normalization glue between those two paths

That is not the right substrate to freeze before Phase 4.

## Scope In

- removing `pg-introspection` from the live catalog ingestion path
- reverting `services/indexer/src/db-binding/live-catalog.ts` to direct typed catalog SQL
- keeping the richer 3.5 capture surface:
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
- keeping the flattened current-snapshot read model from 3.5.1
- keeping the RPC merge fix in the snapshot merge path
- documenting the reversal and the lesson so later phases do not reintroduce an abstraction that fails to reduce complexity

## Scope Out

- removing the flattened snapshot tables
- changing the canonical `SchemaIR`
- adding snapshot history
- adding continuous live sync
- Phase 4 logging work

## Build

- remove `pg-introspection` from `services/indexer/package.json`
- replace the current mixed object-model ingestion in `services/indexer/src/db-binding/live-catalog.ts` with direct typed queries that return:
  - schema rows
  - table/view rows
  - enum rows
  - routine rows with full `return_type` and `arg_types` in one path
- keep any narrower helper queries only when they directly populate richer table-level metadata already used elsewhere (`fetchTableSchema()`)
- retain the flattened snapshot read model and transactional rebuild logic from 3.5.1 unchanged
- keep the Phase 3.5.1 source-kind fix and the RPC merge fix unchanged
- add or update tests so they prove:
  - the richer live routine metadata still survives through refresh and merge
  - the read model still populates exactly as before
  - the `pg-introspection` dependency is fully gone from the live-catalog path

## Rules

- do not revert the flattened read-model work from Phase 3.5.1
- do not revert the RPC merge fix
- do not keep `pg-introspection` and custom catalog SQL side-by-side
- prefer one flat-query ingestion path over a mixed object-model + supplemental-query path
- if a future dependency does not remove bespoke logic, treat that as a failed adoption and back it out

## Retrospective Notes Captured Here

- Phase 3.5.1 correctly improved storage but overreached on ingestion abstraction
- the `live_catalog` source-kind migration belonged conceptually with Phase 3.5, but was fixed in 3.5.1 and should be retained
- when a phase thickens one stage of a pipeline with richer structural fields, it must audit downstream merge and dedupe sites in the same phase; the RPC merge bug demonstrated this

## Done when

- `pg-introspection` is removed from the live-catalog ingestion path
- the richer live schema capture still works
- the flattened read model from 3.5.1 remains intact and synchronized
- the richer live routine metadata still survives refresh and merge
- docs record why the ingestion-layer reversal happened
- Phase 4 can begin against the simpler ingestion path and the already-correct hybrid storage model
