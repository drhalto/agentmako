# Phase 3.2 Package And Connect UX

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 3.2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.2.

## What Shipped

- `agentmako connect [path]` as the professional cold-start command (attach → index → optional live DB → test → persist scope → refresh → final status)
- hidden-input DB URL capture in interactive mode, with OS keychain storage by default
- `--db-env <VAR>` for non-interactive / CI secret capture via an env var name
- `--schemas a,b` and an interactive scope prompt, with `defaultSchemaScope` persisted in the project manifest (`.mako/project.json`)
- top-level `agentmako status`, `agentmako verify`, `agentmako refresh` aliases
- top-level `verify`/`refresh` fall back to the saved `defaultSchemaScope` when `--schemas` is not passed, so normal usage no longer retypes scope flags
- existing lower-level `project db bind/test/verify/refresh` commands preserved as the advanced/operator surface (behavior unchanged for backward compatibility)
- CLI package renamed to `agentmako` with both `agentmako` and `mako` bin entries (the `mako` bin stays as a migration alias)
- smoke tests covering the non-interactive connect path, scope persistence across re-runs, the not-attached friendly message, the `--db-env` env-missing failure, and (gated on `MAKO_TEST_DATABASE_URL`) the full live connect → verify → refresh loop with saved scope

## Code Touchpoints

- `packages/contracts/src/project.ts` — added optional `defaultSchemaScope: string[]` to `ProjectDatabaseManifest`
- `services/indexer/src/project-manifest.ts` — preserved `defaultSchemaScope` across attach/index rewrites, added `updateProjectManifestDefaultSchemaScope`
- `services/indexer/src/project-config.ts` — new `setProjectDefaultSchemaScope` helper that resolves project references through the global store
- `services/api/src/service.ts` — exposed `setProjectDefaultSchemaScope` on `MakoApiService`
- `apps/cli/src/index.ts` — new `connect` orchestration, `promptSecret` hidden-input helper, top-level `status`/`verify`/`refresh` aliases, shared `printVerifyResult`/`printRefreshResult`/`printNotAttachedMessage` helpers, updated usage text and hint strings
- `apps/cli/package.json` — renamed package to `agentmako`, added both `agentmako` and `mako` bin entries
- `test/smoke/core-mvp.ts` — Phase 3.2 smoke coverage blocks (non-interactive connect, scope persistence, top-level aliases, and a gated live-DB path)

## Known Gap: real npm publishability

Phase 3.2 shipped the `agentmako` package name, bin shape, and CLI UX, and removed the `"private"` flag on `apps/cli/package.json`, but does **not** yet produce a tarball that `npm publish` can actually ship from. Two concrete blockers remain:

1. Every `@mako-ai/*` workspace dep is still `"private": true`, so `pnpm publish` has nothing to resolve `workspace:*` against.
2. The `tsc` output in `dist/` is not bundled — it emits external `import` statements for every `@mako-ai/*` module, so a clean-machine `npm install -g agentmako` would fail to resolve those imports at startup.

These two blockers are the full scope of the dedicated follow-up phase:

- [./phase-3.2.1-cli-publishing.md](./phase-3.2.1-cli-publishing.md)

The advertised `npx agentmako connect` / `npm install -g agentmako` story is not finished until Phase 3.2.1 lands. Do not treat this as a soft "nice to have" — it's blocking the flagship install path this phase is built around.

## Goal

Turn the current setup flow into a professional package-level onboarding experience where a user can stand in a repo, run one command, and leave with the project attached, indexed, optionally connected to a live database, and ready to use without memorizing internal verbs.

## Hard Decisions

- this phase is a package and connection UX phase, not a substrate rewrite
- the normal cold-start path should be `npx agentmako connect`
- optional global install should be `npm install -g agentmako`, then `agentmako connect`
- the connect flow should still reuse the existing attach, index, bind, test, verify, and refresh contracts under the hood
- desktop interactive flow should default to secure secret capture and OS keychain storage
- headless and CI-friendly env-var flows must still exist
- the project manifest should persist default schema scope so day-to-day verify and refresh do not require repeated `--schemas ...`
- existing lower-level `project db ...` verbs remain as advanced/operator surfaces

## Why This Phase Exists

Phase 3 made the live DB path real. Phase 3.1 made the setup flow cleaner.

The remaining problem is that the current UX still feels like the substrate leaking through:

1. the user has to think in terms of bind, test, verify, and refresh
2. the user has to know whether to use env vars or keychain refs before the product helps them
3. the user still ends up carrying repeated schema-scope flags for normal usage
4. the public package/install story is not yet aligned with the intended professional product surface

Phase 3.2 exists to finish the onboarding and connection story before Phase 4 starts logging the wrong operator workflow.

## Scope In

- package/install UX for the normal human path
- a first-class `connect` onboarding command
- one-shot attach + index + optional DB connect + test + refresh flow
- hidden-input DB URL capture for interactive setup
- keychain-first local secret storage
- env-var fallback for non-interactive or CI-style use
- default schema-scope persistence in the project manifest
- top-level day-to-day command aliases that feel product-level rather than substrate-level

## Scope Out

- replacing the underlying attach/index/bind/test/verify/refresh contracts
- changing the schema IR contract
- row-data sync or continuous synchronization
- new investigation tools
- logging/ranking/ML work
- cloud account systems or hosted secret storage

## Architecture Boundary

### Owns

- public package and command-shape expectations
- onboarding and connection UX
- connect-time secret capture flow
- persistence of project-level default schema scope
- top-level command alias direction

### Does Not Own

- the underlying DB-binding storage contract
- the underlying schema refresh model
- the logging substrate
- the investigation roadmap

## Product Direction

The intended normal human flow should become:

```bash
npx agentmako connect
```

or, after optional global install:

```bash
agentmako connect
```

The connect flow should:

1. resolve repo root from the current directory by default
2. attach or reopen the project
3. run index
4. ask whether to connect a live database now
5. if yes, collect the database URL securely
6. store it in the OS keychain by default
7. test the connection immediately
8. persist default schema scope such as `public` or `public,ops`
9. run a refresh automatically so the local snapshot is actually connected when setup finishes
10. print a final status summary and next-step guidance

The low-level path remains available:

```bash
agentmako project db bind
agentmako project db test
agentmako project db verify
agentmako project db refresh
```

but it is no longer the intended cold-start workflow.

## Command Direction

### Public Onboarding Surface

The normal public entry point should move toward:

```bash
agentmako connect
```

Supported forms should include:

- `npx agentmako connect`
- `agentmako connect`
- explicit repo path only when needed

### Public Day-To-Day Surface

Roadmap 2 should move toward top-level aliases:

```bash
agentmako status
agentmako verify
agentmako refresh
```

These may delegate to existing project-scoped commands internally.

### Advanced Surface

The existing lower-level verbs remain available for power users, scripting, and debugging:

- `agentmako project attach`
- `agentmako project index`
- `agentmako project db bind`
- `agentmako project db test`
- `agentmako project db verify`
- `agentmako project db refresh`

## Secret Handling Direction

Interactive desktop flow should default to:

- prompt for DB URL with hidden input
- write the URL to the OS keychain
- store only a keychain reference in the manifest

Non-interactive and CI-compatible flow should support:

- env-var reference input such as `--db-env SUPABASE_DB_URL`

The manifest and SQLite state must still never store:

- raw DB URLs
- plaintext passwords
- copied secret bundles

## Schema Scope Direction

The project manifest should gain a durable default schema-scope field for live verification and refresh behavior.

This allows:

- `agentmako connect` to ask once which schemas matter
- later `agentmako verify` and `agentmako refresh` to use that saved scope by default
- the user to stop retyping `--schemas public` for normal usage

Explicit override flags may still exist, but they should be the exception.

## Contracts

### Input Contract

The connect flow should support:

- repo-local current-working-directory targeting by default
- explicit repo path when needed
- interactive yes/no database opt-in
- interactive hidden-input DB URL capture
- non-interactive env-var based DB input
- optional explicit schema list such as `public,ops`
- safe refusal when required DB input is missing

### Output Contract

A successful connect flow should surface:

- attached project identity
- detected frameworks/languages/package manager
- manifest path
- schema snapshot state
- DB-binding state
- whether a live DB was connected successfully
- saved default schema scope
- recommended next step

### Error Contract

This phase should reuse the existing typed project and DB-binding errors where possible.

If package/connect-specific errors are added, they should stay narrow and not fork the broader error vocabulary.

## Execution Flow

1. resolve the repo or explicit path
2. attach or reopen the project
3. run index
4. ask whether to connect a live database now
5. if yes, capture the database URL securely or resolve it from a provided env var
6. store the secret in keychain by default when interactive
7. persist the binding reference in the manifest
8. ask for or infer default schema scope
9. test the connection
10. refresh the local schema snapshot using the saved scope
11. print final status and next-step guidance

## File Plan

Create:

- one new phase-specific CLI/connect module if the current CLI file becomes too crowded

Modify:

- `apps/cli/src/index.ts`
- package metadata and bin configuration files
- manifest helpers for default schema-scope persistence
- status/output helpers as needed

Keep unchanged unless correctness fixes are required:

- the schema IR contract
- the underlying DB-binding storage contract
- the lower-level project and DB commands

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- `npx agentmako connect` works from inside a repo with no explicit path
- optional global-install command shape is documented correctly
- interactive connect can attach, index, bind, test, and refresh in one flow
- interactive connect stores DB credentials in keychain and only a ref in project config
- non-interactive connect can use `--db-env`
- saved schema scope is reused by default `verify` and `refresh` paths
- the user can finish setup without learning `project db bind` first

Required docs checks:

- Roadmap 2 docs make this the connection-polish phase before Phase 4
- docs reflect the intended public package surface as `agentmako`
- docs do not imply plaintext secret storage or raw DB URLs in repo state

## Done When

- the intended cold-start path is `npx agentmako connect`
- optional global install is documented as `npm install -g agentmako`
- one connect flow can attach, index, connect, test, and refresh a project
- DB credential capture is secure and low-friction
- schema scope is saved once and reused by default
- later status, verify, and refresh flows feel like product commands rather than substrate commands
- Phase 4 can log the intended professional onboarding workflow

## Risks And Watchouts

- turning connect into a hidden magic command that bypasses the real contracts
- capturing secrets insecurely through argv or plaintext temp files
- creating a package/install story that conflicts with the actual bin name
- overfitting the flow to Supabase while pretending it is general
- letting this UX phase turn into a broad package/distribution rewrite

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.1-project-setup-and-binding-ux.md](./phase-3.1-project-setup-and-binding-ux.md)
- [./phase-3-live-db-binding-and-read-only-refresh.md](./phase-3-live-db-binding-and-read-only-refresh.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
