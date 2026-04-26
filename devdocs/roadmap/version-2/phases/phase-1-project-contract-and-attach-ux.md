# Phase 1 Project Contract And Attach UX

This file is the exact implementation spec for Roadmap 2 Phase 1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 1.

## Goal

Turn project attachment into a real project contract with a repo-local manifest and sane repo-local CLI ergonomics.

## Hard Decisions

- attach remains explicit
- project commands should default to the current working directory when no ref is passed
- `project detach` becomes a real command
- project context resolution is layered: explicit arg -> session project -> MCP `roots` -> `_meta.cwd` -> clear error
- the project-local manifest stores metadata, not secrets
- global registry state and local manifest state must have clear responsibilities

## Why This Phase Exists

The shipped attach flow is useful, but still too thin:

- no real detach flow
- no project-local manifest contract
- current CLI still leans too hard on explicit paths
- project attachment is not yet durable enough for the later snapshot and binding systems

Phase 1 exists to make project identity stable before deeper data systems land.

## Scope In

- `.mako/` project manifest contract
- richer project capability metadata
- cwd-default project CLI behavior
- `project detach`
- session-scoped active project groundwork
- MCP `roots` and `_meta.cwd` project-resolution groundwork
- explicit detach semantics
- clearer global-vs-local state split

## Scope Out

- schema snapshot persistence
- live DB binding
- benchmark logging
- investigation tooling

## Architecture Boundary

### Owns

- project manifest definition
- attach/detach/status CLI ergonomics
- project capability metadata
- registry/manifest synchronization rules

### Does Not Own

- schema refresh logic
- DB secret storage
- later trust-layer logging systems

## Contracts

### Input Contract

CLI direction:

```text
mako project attach [path]
mako project detach [ref] [--purge]
mako project status [ref]
mako project index [ref]
```

Rules:

- no path/ref means current working directory
- explicit path or project ID still works
- `detach --purge` may remove repo-local `.mako-ai` state in addition to unregistering

MCP/client context direction:

```text
project resolution order:
1. explicit tool arg
2. session active project
3. MCP roots
4. _meta.cwd
5. clear error
```

Rules:

- context resolution may be automatic
- project registration is never automatic
- `roots` and `_meta.cwd` resolve attached projects only
- unresolved context returns a typed error

### Output Contract

Manifest direction:

```json
{
  "version": "2.0.0",
  "projectId": "proj_...",
  "root": ".",
  "frameworks": ["nextjs"],
  "languages": ["typescript"],
  "database": {
    "kind": "supabase",
    "mode": "repo_only",
    "schemaSources": ["supabase/migrations", "types/supabase.ts"],
    "liveBinding": {
      "strategy": "keychain_ref",
      "ref": "mako:proj_abc123:primary-db",
      "enabled": false
    }
  }
}
```

Rules:

- final exact shape may change
- manifest must describe the project and its capabilities
- manifest must not hold secrets
- binding references are allowed; secret values are not

### Error Contract

- not-a-project-path
- project-not-attached
- project-context-missing
- detach-target-ambiguous
- purge-failed

## Execution Flow

1. resolve project ref or default to cwd
2. detect or load project metadata
3. write/update global registry entry
4. write/update local manifest
5. return stable project information

MCP/context resolution flow:

1. try explicit tool arg
2. try session active project
3. try attached-project resolution from MCP `roots`
4. try attached-project resolution from `_meta.cwd`
5. return typed project-context error if nothing resolves cleanly

Detach flow:

1. resolve project ref or default to cwd
2. mark detached or remove registry entry
3. optionally purge local state
4. return structured detach result

## File Plan

Create:

- manifest support module under the appropriate package or service boundary

Modify:

- `apps/cli/src/index.ts`
- `services/indexer/src/attach.ts`
- `services/indexer/src/status.ts`
- `services/api/src/server.ts`
- `packages/contracts/src/project.ts`
- `packages/store/src/global-store.ts`

Keep unchanged:

- MCP/HTTP transport layer
- shared tool registry behavior

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- attach ForgeBench from inside the repo with no path arg
- detach ForgeBench from inside the repo with no ref arg
- reattach ForgeBench cleanly after detach
- MCP-facing project resolution follows explicit arg -> session project -> roots -> `_meta.cwd` -> clear error

Required docs checks:

- Roadmap 2 docs stay aligned on attach/detach behavior

## Done When

- attach, detach, status, and index work repo-locally by default
- project manifest exists and is stable enough to build on
- project context resolves through the documented layered chain without auto-attaching projects
- ForgeBench can be attached and detached without manual SQLite surgery

## Risks And Watchouts

- putting secrets into the manifest
- making detach destructive by default
- blurring what lives in global state versus local project state
- silently auto-attaching projects because a client exposed `roots` or `_meta.cwd`

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
