# Phase 3.6 CLI UX Production Polish

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 3.6.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.6.

## Prerequisites

Phase 3.6 assumes the following earlier phases are complete:

- Phase 3.5 — live schema scope and catalog capture
- Phase 3.5.1 — live schema read model and introspection
- Phase 3.5.2 — live catalog ingestion hotfix (direct typed catalog SQL, `pg-introspection` removed)

## What Shipped

- Schema auto-import: `SUPABASE_HIDDEN_SCHEMAS` deleted from `services/indexer/src/db-binding/schema-scope.ts`. All non-system schemas (auth, storage, realtime, graphql_public, extensions, etc.) are now imported automatically on connect. The interactive schema picker (`promptSchemaSelection`, `printSchemaSelectionMenu`) was removed from the connect flow. Schemas are auto-discovered after DB bind and persisted silently. `--schemas` remains as an advanced override.
- `--keychain-from-env <VAR>` flag added to `connect`. Reads a DB URL from the named environment variable, stores it in the OS keychain, then binds, tests, and refreshes in one non-interactive command. Mutually exclusive with `--db-env`.
- `project init` hard-deleted: `InitArgs`, `parseInitArgs`, `promptInitBindChoice`, `resolveBindSecret`, and the ~210 lines of command implementation removed from `apps/cli/src/index.ts`. Four smoke test call sites migrated to `connect --yes --no-db` + `project db bind` equivalents.
- Bare `agentmako` auto-status: running `agentmako` with no subcommand in an attached project directory shows project status; in an unattached git repo it suggests `agentmako connect`; in a random directory it lists all attached projects.
- Help text polished: `--keychain-from-env` added to Connect options, `--schemas` removed from verify/refresh help lines, `project init` removed from the command listing, examples updated.
- `project detach --purge` keychain cleanup: when a project has a `keychain_ref` DB binding, the interactive detach flow prompts "Also remove the stored database secret from the OS keychain?" (default yes). Non-interactive mode accepts `--delete-secrets`. Prevents orphaned OS keychain entries after a full project detach. The existing `--delete-secret` flag on `project db unbind` is unchanged.
- Verify no-drift output cleaned up: count format changed from `+0 -0 (=49)` to `Tables: 49`; confusing "partial verify is informational; project state was not updated" message removed; redundant "Using saved default scope: ..." pre-header line removed. When drift is detected, diff format `+N -M (=K)` is shown with an actionable hint: "Run `agentmako refresh` to update the local snapshot."
- Refresh output simplified to a single line: `✓ Snapshot refreshed · live_refresh_enabled · 46 tables`
- `project detach --help` updated to show `[--delete-secrets]` as an option.

## Code Touchpoints

`services/indexer/src/db-binding/`:

- `schema-scope.ts` — `SUPABASE_HIDDEN_SCHEMAS` constant deleted; non-system schema discovery now runs unconditionally on connect

`apps/cli/src/`:

- `index.ts` — `project init` command (~210 lines) hard-deleted; `--keychain-from-env` flag added to `connect`; bare `agentmako` no-arg behavior added; help text for Connect, verify, and refresh updated; `--delete-secrets` flag added to `project detach`; `[--delete-secrets]` added to `project detach --help` output; verify no-drift output format changed to `Tables: N`; verify drift output gains actionable refresh hint; refresh output condensed to single summary line

`test/smoke/`:

- `core-mvp.ts` — four `project init` call sites migrated to `connect --yes --no-db` + `project db bind` equivalents

## Goal

Reduce operator friction to a minimum and shrink the CLI surface area before Phase 4 starts logging against the CLI workflows.

The core insight: pasting the DB URL is consent to read — import everything non-system by default. An explicit interactive schema picker is friction the user never needed.

## Hard Decisions

- schema auto-import is the new default; the interactive picker is gone, not just bypassed
- `project init` is a hard delete, not a deprecation; smoke tests are migrated, not marked skip
- `--keychain-from-env` is the supported CI path; no other non-interactive keychain-bind mechanism is added alongside it
- bare `agentmako` shows context-sensitive status rather than printing a help page; this makes the no-arg path useful rather than instructional
- `--schemas` stays as an explicit override; removing it entirely would break advanced and CI use cases

## Why This Phase Exists

Three friction points remained in the CLI after 3.5.2:

1. The interactive schema picker made the common path — bind and import everything — slower than it needed to be. The human already consented to read by supplying a DB URL. Making them answer a picker on top of that was redundant friction.
2. `project init` was a confusing entry point that overlapped with `connect`. Removing it reduces the surface area the operator has to reason about and the CLI has to maintain.
3. CI setups had no clean way to populate the keychain without shell gymnastics. `--keychain-from-env` provides that path in one flag.

Phase 3.6 ships a net reduction in code and a net improvement in usability before Phase 4 opens.

## Scope In

- schema auto-import on connect; removal of interactive schema picker
- `--keychain-from-env <VAR>` flag on `connect`
- hard deletion of `project init` and all supporting private functions
- smoke test migration away from `project init` call sites
- bare `agentmako` context-sensitive no-arg behavior
- help text consistency pass (verify/refresh `--schemas` removal, `project init` removal, `--keychain-from-env` addition)

## Scope Out

- any new schema-discovery heuristics beyond the non-system auto-import rule
- changes to `verify` or `refresh` behavior beyond help text
- changes to `--db-env` behavior
- new shell completion or alias machinery
- operator documentation rewrites beyond what the phase file and changelog cover
- Phase 4 logging tables or evaluation substrate

## Architecture Boundary

### Owns

- `apps/cli/src/index.ts` command surface (additions, deletions, help text)
- `services/indexer/src/db-binding/schema-scope.ts` schema-scope logic
- `test/smoke/core-mvp.ts` call sites that referenced the deleted `project init` command

### Does Not Own

- the underlying DB binding strategy layer (`keychain-ref`, `env_var_ref`)
- the project manifest schema (`defaultSchemaScope` field shape stays unchanged)
- the live catalog ingestion pipeline (no changes below the schema-scope layer)
- the snapshot storage or read-model tables

## Contracts

### Input Contract

- `agentmako connect [path]` — optional `--keychain-from-env <VAR>` (mutually exclusive with `--db-env`); optional `--schemas a,b` override; `--yes` / `--no-db` unchanged
- `agentmako [no args]` — context-sensitive: attached project → status; unattached git repo → connect suggestion; other directory → attached project list
- All other existing connect, verify, and refresh flags remain unchanged

### Output Contract

- On connect with DB: auto-discovered non-system schemas listed in status output; no picker prompt unless `--schemas` is passed
- On bare `agentmako` in attached project: same output as `agentmako status`
- On bare `agentmako` in unattached repo: human-readable suggestion to run `agentmako connect`
- On bare `agentmako` in random directory: list of all attached projects

### Error Contract

- `--keychain-from-env VAR` where `VAR` is unset: non-zero exit, message names the missing variable
- `--keychain-from-env` and `--db-env` together: non-zero exit, mutual exclusion error
- Schema auto-import failure (DB unreachable during schema discovery): propagates as existing connection error, not a new error code

## Execution Flow

1. `connect` is called with a DB URL source (interactive hidden input, `--db-env`, or `--keychain-from-env`)
2. DB connection established and tested
3. Live schemas discovered from `pg_catalog` — non-system schemas selected automatically
4. If `--schemas` was passed, that list overrides the auto-discovered set
5. Resolved scope persisted to `defaultSchemaScope` in the project manifest
6. Live catalog refresh runs against the resolved scope
7. Status printed; no picker prompt appears

For bare `agentmako`:

1. Detect whether cwd is inside an attached project → show status
2. If not, detect whether cwd is a git repo → suggest connect
3. Otherwise → list attached projects

## File Plan

Create:

- `devdocs/roadmap/version-2/phases/phase-3.6-cli-ux-production-polish.md` (this file)

Modify:

- `services/indexer/src/db-binding/schema-scope.ts` — delete `SUPABASE_HIDDEN_SCHEMAS`
- `apps/cli/src/index.ts` — delete `project init`; add `--keychain-from-env`; add bare no-arg behavior; polish help text
- `test/smoke/core-mvp.ts` — migrate `project init` call sites

Keep unchanged:

- project manifest schema shape (`defaultSchemaScope`)
- live catalog ingestion pipeline
- snapshot storage and read-model tables
- `verify` and `refresh` command logic (help text only changes)
- `--db-env` behavior

## Verification

Required commands:

```bash
corepack pnpm typecheck
corepack pnpm run test:smoke
```

Required runtime checks:

- `agentmako connect --no-db` in a repo: completes without schema picker prompt
- `agentmako connect --keychain-from-env MAKO_TEST_DATABASE_URL` (with env set): binds, tests, refreshes, exits 0
- `agentmako connect --keychain-from-env MISSING_VAR`: exits non-zero, names missing variable
- `agentmako connect --keychain-from-env VAR --db-env VAR`: exits non-zero, mutual exclusion error
- `agentmako` with no args in attached project: shows status
- `agentmako project init`: exits non-zero (command not found)

Required docs checks:

- `agentmako connect --help`: `--keychain-from-env` listed; `--schemas` not listed under verify/refresh
- `agentmako project --help`: `init` not listed

## Done When

- connect never shows the interactive schema picker unless `--schemas` is explicitly passed
- `SUPABASE_HIDDEN_SCHEMAS` is gone; all non-system schemas import by default
- `--keychain-from-env <VAR>` works end-to-end for CI keychain bind
- `project init` is gone; `agentmako project init` returns a command-not-found error
- all four smoke test call sites that used `project init` pass using `connect --yes --no-db` / `project db bind`
- bare `agentmako` is context-sensitive and never just prints a help page
- `pnpm typecheck` and `pnpm run test:smoke` both pass

## Risks And Watchouts

- schema auto-import may silently include schemas the user did not expect (e.g. `auth`, `storage`). The `--schemas` override escape hatch must remain clear in help output.
- removing the interactive picker removes a natural point where the user can review what will be imported before it happens. The connect status summary output must compensate by clearly listing which schemas were auto-selected.
- `project init` call sites in downstream scripts or documentation outside the smoke tests are not automatically migrated. If users have scripted `project init`, they will get a command-not-found error with no guidance.

## References

- [./phase-3.5-live-schema-scope-and-catalog-capture.md](./phase-3.5-live-schema-scope-and-catalog-capture.md)
- [./phase-3.5.2-live-catalog-ingestion-hotfix.md](./phase-3.5.2-live-catalog-ingestion-hotfix.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
