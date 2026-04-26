# Phase 2 Schema Source Discovery And Snapshot Backbone

This file is the exact implementation spec for Roadmap 2 Phase 2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 2.

## Goal

Make schema shape a first-class local asset through one canonical normalized schema IR derived primarily from repo sources.

## Hard Decisions

- repo-derived schema comes first
- one canonical local schema IR is the target contract
- live DB is not required for a useful local snapshot
- snapshot freshness must be explicit
- drift state must be explicit
- snapshot state should be queryable later without re-reading all sources ad hoc

## Why This Phase Exists

Roadmap 1 can inspect schema through existing extraction and DB tools, but it does not yet have a durable schema snapshot system that later systems can trust.

Phase 2 exists to turn schema shape into stable local state.

That state is not "always current" by definition.

It is a local snapshot with explicit source and freshness metadata.

## Scope In

- schema source detection
- repo-derived snapshot persistence
- snapshot metadata
- freshness state
- diff groundwork

## Scope Out

- live DB binding UX
- trust-layer contradiction logic
- investigation composition

## Architecture Boundary

### Owns

- schema source inventory
- canonical local schema IR contract
- snapshot persistence model
- refresh and freshness rules
- drift metadata and comparison basis

### Does Not Own

- secret handling
- live DB binding
- public investigation packets

## Contracts

### Input Contract

Inputs should include project-scoped schema sources such as:

- SQL migrations
- generated DB types
- ORM schema files

The phase should support a source-mode model such as:

- `repo_only`
- `repo_plus_live_verify`
- `live_refresh_enabled`

Phase 2 only needs to build the repo-derived half of that model cleanly.

### Output Contract

The phase should leave behind a persisted snapshot concept with:

- snapshot ID
- one canonical normalized schema IR
- source list
- source mode
- created/refreshed timestamps
- freshness state
- verification metadata
- drift metadata
- schema fingerprint
- diff basis for later comparison

### Error Contract

- schema-sources-not-found
- snapshot-build-failed
- unsupported-schema-source

## Execution Flow

1. load project manifest and capabilities
2. detect configured schema sources
3. parse repo-derived schema inputs
4. build one canonical local schema IR
5. persist a canonical local snapshot
6. expose freshness state, verification state, and refresh metadata

## File Plan

Create:

- snapshot persistence support modules
- schema IR support modules

Modify:

- `services/indexer/src/schema-scan.ts`
- `packages/store/src/project-store.ts`
- `packages/contracts/src/project.ts`

Keep unchanged:

- public DB tool contracts unless snapshot exposure requires a deliberate extension

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- ForgeBench schema snapshot can be built from repo sources only
- snapshot refresh updates freshness metadata correctly
- snapshot metadata can express `repo_only` without pretending the snapshot is live-verified
- schema changes in repo sources can be detected as refresh-required or stale

Required docs checks:

- Roadmap 2 docs stay aligned on repo-derived schema priority

## Done When

- ForgeBench schema can be represented locally from repo sources
- snapshot refresh behavior is explicit
- local schema state has one stable IR shape regardless of later source mode
- freshness and drift state are queryable
- later live DB refresh has a real local target to compare against

## Risks And Watchouts

- making snapshot state too ad hoc
- letting every consumer parse raw schema inputs independently again
- treating generated types as the only schema source
- over-coupling snapshot state to live DB logic

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../test-project/architecture.md](../../../test-project/architecture.md)
