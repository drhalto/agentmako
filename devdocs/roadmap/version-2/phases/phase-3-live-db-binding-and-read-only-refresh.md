# Phase 3 Live DB Binding And Read-Only Refresh

This file is the exact implementation spec for Roadmap 2 Phase 3.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.

## Goal

Let a human enable project-scoped live DB access safely and use it for read-only verification and refresh of the same local schema IR built in Phase 2.

## Hard Decisions

- live DB access is opt-in
- binding is project-scoped
- secrets are not stored in committed project config
- Roadmap 2 uses read-only verification and refresh only
- live DB updates freshness and drift state; it does not create a second schema contract
- binding should be strategy-based, with `keychain_ref` preferred for local interactive use
- `env_var_ref` remains the required fallback for headless and CI-style flows
- plaintext SQLite secret storage is not a Roadmap 2 pattern

## Why This Phase Exists

Roadmap 2 needs a real live-DB story, but not a reckless one.

Phase 3 exists to replace the current process-global DB model with a safer project-scoped capability model.

It also exists to strengthen trust in the local schema IR without making the live DB mandatory for every project.

## Scope In

- DB capability binding model
- connection test flow
- `keychain_ref` and `env_var_ref` binding strategies
- read-only refresh flow
- project-scoped live schema confirmation

## Scope Out

- row-data syncing
- continuous sync
- write-side connectors
- contradiction detection

## Architecture Boundary

### Owns

- project-scoped DB capability metadata
- binding/test/refresh flows
- read-only import behavior
- live verification and drift confirmation against the existing local schema IR
- reference-only secret contract for DB binding

### Does Not Own

- secret-manager implementation beyond the chosen binding reference strategy
- live data pipelines
- trust-layer comparison logic

## Contracts

### Input Contract

Binding direction should support:

- strategy
- env var name
- keychain reference ID
- explicit enable/disable state

Allowed later extension:

- encrypted binding file reference

### Output Contract

Project status should be able to communicate:

- DB kind
- binding mode
- binding strategy
- configured vs unconfigured
- last verified at
- last refreshed at
- snapshot freshness state
- drift state

### Error Contract

- db-binding-not-configured
- db-binding-invalid
- db-connection-test-failed
- db-refresh-failed

## Execution Flow

1. load project manifest and DB capability state
2. resolve binding strategy
3. test read-only connectivity
4. compare live catalog state to the existing local schema IR
5. mark verification or drift state
6. refresh the local schema IR when explicitly requested
7. update snapshot and project status metadata

## File Plan

Create:

- project-scoped DB binding support modules

Modify:

- `packages/contracts/src/project.ts`
- `packages/store/src/global-store.ts`
- `packages/store/src/project-store.ts`
- existing DB-related service wiring where project-scoped capability needs to be introduced

Keep unchanged:

- public DB tool semantics unless a deliberate compatibility layer is required

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- ForgeBench can be bound to its cloud Supabase DB explicitly
- connectivity test works
- read-only refresh updates local schema state
- live verification can mark the snapshot as verified without requiring a refresh every time
- drift can be surfaced clearly when live DB shape diverges from the local snapshot

Required docs checks:

- docs never imply secrets are stored in project config
- docs never imply plaintext SQLite secret storage is acceptable as the default

## Done When

- ForgeBench can be manually bound to its cloud DB
- connectivity and refresh work read-only
- the same local schema IR contract remains valid before and after live verification
- verification, freshness, and drift state are visible in status/metadata
- project-scoped DB capability is visible in status/metadata
- binding references are stored without storing the secret itself in manifest or SQLite

## Risks And Watchouts

- letting process-global DB config remain the hidden primary path
- storing raw URLs in committed files
- letting live DB reads bypass the local schema IR contract casually
- inventing a plaintext SQLite secret store because it is convenient
- creeping into live sync or row ingestion too early

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../test-project/setup.md](../../../test-project/setup.md)
