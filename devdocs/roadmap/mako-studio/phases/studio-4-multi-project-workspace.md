# Studio 4 Multi-Project Workspace

Status: `Planned`

## Goal

Let the operator switch between attached projects without restarting
the shell or its services. The dashboard already supports multiple
projects via the existing global store; this phase wires the UI to make
switching a one-click action and ensures all per-project query caches
invalidate cleanly.

The user-visible test is: attach two projects, switch between them via
a project bar, and the dashboard's findings, freshness, and tool runs
update in under one second per switch with no stale state.

## Scope

- project bar component (top-left of the dashboard chrome) showing the
  active project, recents, and an "attach project" entry
- attach-project flow using the Studio bridge's native directory picker
- detach-project flow with confirmation
- per-project state isolation: TanStack Query keys include the active
  `projectId`; switching projects invalidates queries for the previous
  active project
- shell remembers the last active project across launches via a small
  shell-side preferences file
- "recents" list (last 10 projects) sourced from the global store

## Out Of Scope

- multi-window or tabbed workspace UI
- cross-project queries (e.g., "show findings across all attached
  projects")
- attaching projects from a Git URL or remote source
- moving / archiving projects via the UI
- preview overlays (Reef 3 may add this; Studio surfaces it later)

## Dependencies

- Studio 1, 2, 3 shipped
- Existing global store accessors:
  - `globalStore.listProjects()`
  - `globalStore.saveProject()`
  - `globalStore.markProjectIndexed()`
  - HTTP endpoints under `/api/v1/projects/*`

No new MCP tool contracts ship in this phase.

## UI Surfaces

### Project bar

- compact dropdown next to the Mako logo
- shows: active project name, canonical path tooltip, support level
  badge
- click opens panel with:
  - recent projects (last 10), each with last-indexed-at and findings
    count
  - "Attach project..." entry that triggers
    `bridge.pickProjectDirectory()`
  - "Detach this project..." entry (visible when an active project is
    selected)

### Attach flow

1. operator clicks "Attach project..."
2. native directory picker opens at the user's home dir or the most
   recently used parent
3. on selection, the dashboard calls `POST /api/v1/projects/attach`
   with the canonical path
4. service responds with the attached project record; dashboard sets it
   as active and pushes it to the recents list
5. project bar updates; the rest of the dashboard re-renders for the
   new project

### Detach flow

1. operator selects "Detach this project..."
2. native confirm dialog: "Detach <name>? This stops indexing it but
   keeps the project DB on disk."
3. on confirm, dashboard calls `POST /api/v1/projects/detach`
4. project moves to a "detached" sub-list in the bar
5. dashboard switches to no-project state if the detached one was
   active

## Bridge Additions

```ts
// added to StudioBridge in apps/studio/src/bridge.ts
export interface StudioBridgeWorkspace {
  loadPreferences(): Promise<{
    lastActiveProjectId?: string;
    projectBarCollapsed?: boolean;
  }>;
  savePreferences(prefs: {
    lastActiveProjectId?: string;
    projectBarCollapsed?: boolean;
  }): Promise<void>;
}
```

Preferences live in `~/.mako-studio/preferences.json` (macOS / Linux) or
`%APPDATA%/Mako Studio/preferences.json` (Windows). The shell, not the
services, owns this file because it is shell-only state.

## Done When

- attaching two distinct projects, switching between them, and
  verifying that the freshness panel, findings page, recent runs list,
  agent feedback summary, and `Tools.tsx` content all reflect the
  active project
- a query running for project A in flight when the operator switches
  to project B does not write its result into project B's cache
- shell quit + relaunch restores the last active project
- detach flow leaves the project DB on disk (verified by
  `ls $MAKO_STATE_HOME/projects/`)
- attach flow rejects paths that are not directories, cannot be
  canonicalized, or were not explicitly granted through the native picker.
  Projects may live outside the user's home directory when the picker grant
  and project-root validation both pass.
- browser-only mode degrades: project bar shows recents from the global
  store but native picker falls back to a path input field
- existing single-project smokes continue to pass
- CHANGELOG entry under `## [Unreleased]`
- roadmap status updated

## Verification

Smokes:

- new `web-project-bar-switch.ts` smoke: attaches two fixture projects,
  switches three times, verifies query keys re-issue and stale data
  does not leak
- new `web-project-bar-attach.ts` smoke: bridge picker mocked,
  verifies attach flow
- new `web-project-bar-detach.ts` smoke: verifies the project DB
  remains on disk after detach
- existing `web-project-dashboard.ts` smoke continues to pass

General checks:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke:web`

## Risks And Watchouts

- **Query cache leakage.** TanStack Query caches are global by default.
  Forgetting to scope a key by `projectId` means project A's data
  flashes when project B is loading. Convention: every
  project-dependent query key starts with `["project", projectId, ...]`
  and `useEffect`-cancels via TanStack Query's `cancelQueries` on
  switch.
- **Service load on switch.** Switching projects triggers ~10
  parallel requests (freshness, findings, runs, etc.). The api service
  must handle these without contention. The Phase 2 `ProjectStoreCache`
  helps; verify in a smoke that switching does not produce
  busy-timeout errors.
- **Active project drift between Studio and CLI.** The shell remembers
  its own active project; the CLI's active project state lives in the
  CLI's preferences. They are intentionally independent so a CLI
  user's shell does not get hijacked. Document this clearly.
- **Project rename or move.** If the operator moves a project directory
  on disk, the canonical path stored in the global store goes stale.
  Phase 4 surfaces a "this project's path no longer exists" warning
  and offers re-attach.
- **Detach race.** Detaching a project while a refresh is running on
  it could corrupt indexer state. The detach flow must wait for any
  in-flight refresh on that project to finish (use `coordinator.close`
  on that project's coordinator).
- **Cross-platform preferences path.** Use Tauri's `path::config_dir`
  resolver, not a hand-rolled path. Verify the preferences file
  survives an OS upgrade or user rename on Windows specifically.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- [./studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
- [./studio-2-project-state-visualization.md](./studio-2-project-state-visualization.md)
- [./studio-3-operator-actions-surface.md](./studio-3-operator-actions-surface.md)
- `packages/store/src/global-store.ts`
- `services/api/src/routes/projects.ts`
