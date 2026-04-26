# Phase 3.1 Project Setup And Binding UX

This file is the exact implementation spec for Roadmap 2 Phase 3.1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.1.

## Goal

Turn the completed project and DB-binding primitives into a clean setup flow that a human can run from inside a repo without already knowing the low-level `mako` contract.

## Hard Decisions

- this phase is a UX and operator-flow phase, not a new substrate phase
- attach, index, bind, test, verify, and refresh remain explicit operations under the hood
- repo-local defaults should be the normal human path
- setup may detect and suggest, but it must not silently attach or silently bind secrets
- interactive and non-interactive setup paths should both be possible
- the canonical manifest, schema snapshot IR, and DB-binding contracts stay the same

## Why This Phase Exists

Phase 3 made the live DB path real, but the user experience is still too low-level.

Right now a human needs to know the sequence:

1. `mako project attach`
2. `mako project index`
3. `mako project db bind`
4. `mako project db test`
5. `mako project db verify` or `mako project db refresh`

That sequence is correct, but it is not yet a polished operator flow.

Phase 3.1 exists so Roadmap 2 can settle on the actual intended project-setup UX before Phase 4 starts logging and evaluating that workflow.

## Scope In

- repo-local setup UX
- guided or semi-guided project initialization flow
- better current-working-directory defaults
- setup-time metadata detection and presentation
- optional DB-binding prompt or follow-up step
- clearer status output for project, schema snapshot, and DB binding state
- non-interactive setup path for repeatable scripted use

## Scope Out

- new schema sync behavior
- new public DB tool families
- investigation-composer work
- logging/ranking/ML work
- automatic secret harvesting or automatic DB binding

## Architecture Boundary

### Owns

- setup-oriented CLI UX
- setup-time manifest/bootstrap validation
- setup-time presentation of detected project metadata
- setup-time optional DB-binding flow
- clearer status/operator output

### Does Not Own

- the underlying schema snapshot model
- the underlying live DB binding model
- the logging substrate
- the trust layer

## Product Direction

The intended human experience should move toward:

```bash
mako project attach
mako project index
mako project db bind --strategy env_var_ref --ref MY_DB_URL
mako project db test
```

but Roadmap 2 should also support a cleaner front door such as:

```bash
mako project connect
```

or:

```bash
mako project init
```

where `mako` can:

- resolve the current repo
- attach it if needed
- show detected metadata
- confirm or create the manifest
- offer optional DB binding
- show the resulting state

The exact command name can change, but the setup flow should become a first-class UX.

## Contracts

### Input Contract

Setup UX should be able to work in two modes:

- interactive or guided
- non-interactive and scriptable

It should support:

- current-working-directory project targeting by default
- explicit repo path when needed
- optional DB-binding strategy selection
- optional env-var ref or keychain ref input
- safe refusal when required secret input is missing

### Output Contract

A successful setup flow should surface:

- attached project identity
- detected frameworks/languages/package manager
- manifest path
- schema snapshot state
- DB-binding state
- recommended next step

Status output should be legible in all states:

- project not attached
- attached but not indexed
- indexed with repo-only schema state
- live DB bound but untested
- live DB verified or refreshed

### Error Contract

Setup UX should reuse existing typed project and DB errors where possible.

If a dedicated setup command is added, it may need one or two setup-specific errors, but it should not invent a separate error vocabulary for paths already covered by attach/index/bind/test.

## Execution Flow

1. resolve the current repo or explicit path
2. check whether the project is already attached
3. attach if needed
4. detect metadata and validate or create the manifest
5. show the current schema snapshot state
6. optionally bind live DB access if the human requests it
7. optionally test the binding immediately
8. print the resulting project status and next-step guidance

## File Plan

Create:

- one new phase-specific CLI/setup module if the existing CLI file becomes too crowded

Modify:

- `apps/cli/src/index.ts`
- `services/indexer/src/attach.ts`
- `services/indexer/src/status.ts`
- manifest/bootstrap helpers as needed

Keep unchanged:

- the underlying schema IR contract
- the underlying live DB contract unless Phase 3 correctness fixes are required

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- `mako project attach` works from inside a repo with no explicit path
- `mako project detach` works from inside a repo with no explicit path
- the setup flow can create or reuse the manifest cleanly
- the setup flow can surface DB binding as unconfigured, disabled, or configured
- an env-var binding can be added from the repo-local setup flow without storing the secret in manifest or SQLite
- status after setup is clear enough that a human can tell what to do next without reading roadmap docs

Required docs checks:

- Roadmap 2 docs treat this phase as the bridge between the Phase 3 substrate and the Phase 4 logging substrate
- docs do not imply silent DB binding or secret storage in project config

## Done When

- repo-local project commands feel normal without explicit path arguments
- there is a first-class setup flow for attaching and preparing a project
- setup can optionally lead into live DB binding without making DB binding mandatory
- status output clearly communicates project, schema snapshot, and DB binding state
- Phase 4 can instrument the intended human workflow instead of a temporary low-level sequence

## Risks And Watchouts

- building a flashy setup command that bypasses the real attach/index/bind contracts
- silently binding a DB because detection guessed correctly
- mixing interactive UX too deeply into the substrate layer
- adding setup sugar that is impossible to script in CI or tests
- letting this phase grow into a new data or sync phase

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3-live-db-binding-and-read-only-refresh.md](./phase-3-live-db-binding-and-read-only-refresh.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
