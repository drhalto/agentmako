# Mako Studio Roadmap

This file is the canonical roadmap for the Mako Studio build cycle.

If another Mako Studio doc disagrees with this file about what the
roadmap is for, what phases it contains, or what counts as done, this
roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-initial-testing/roadmap.md](../version-initial-testing/roadmap.md)
- [../reef-engine/roadmap.md](../reef-engine/roadmap.md)
- [../version-cc/roadmap.md](../version-cc/roadmap.md)
- `apps/web/`
- `services/api/`
- `services/harness/`

## Repository Status

As of 2026-04-25, this roadmap is present on `main`, but the Studio
implementation is not. The Tauri shell, Studio bridge/runtime, native
packaging, Store/MSIX scripts, and Studio-specific dashboard pages are
parked on `reef/studio`.

Reef Engine phases 1 through 6 are shipped on `main`/`origin/main` at
commit `8196476`; Studio should consume those Reef contracts when this
track resumes. Until then, Mako remains fully usable through the CLI, MCP
stdio, and existing Vite dashboard without installing Studio.

Implementation precedents checked through CodexRef:

- Tauri capability/origin handling supports command access scoped by local
  origin, remote origin, window, and webview. Studio bridge commands must be
  explicit capability entries, and CI should catch command/capability drift.
- Tauri apps can serve bundled assets from a shell-owned local app URL or
  custom protocol. Studio must not rely on Vite's dev proxy once the
  dashboard is a static bundle.
- A desktop-managed backend should receive private bootstrap config through
  stdin/pipe-style bootstrap, not through operator-visible CLI args,
  persistent files, logs, or ordinary environment variables. The renderer
  receives runtime config through a Tauri initialization script;
  `127.0.0.1` alone is not authorization.
- Update UX should be explicit and channel-aware: stable/nightly manifests,
  signed release assets, no silent download/install, and CI coverage for
  tampered assets.

## Roadmap Contract

Mako Studio is the desktop packaging and operator surface for Mako.

Its job is to take the existing dashboard at `apps/web` and the existing
HTTP services at `services/api` and `services/harness` and ship them as
one downloadable, signed, auto-updating native application that runs on
Windows, macOS, and Linux without requiring the user to install Node.js,
run `pnpm dev`, or manage three terminal windows.

The desired product behavior is:

```text
download Mako Studio
  -> launch
  -> shell creates a per-launch Studio bootstrap credential
  -> shell starts services/api + services/harness with port discovery
  -> children receive stdin bootstrap config
  -> system webview opens to the dashboard
  -> dashboard receives api/harness origins and token via initialization_script
  -> user picks or attaches a project and works
  -> closing the window shuts down both services cleanly
```

Studio should make Mako better at:

- being installable by anyone with a desktop, not only Node developers
- starting up in one click instead of three terminal commands
- surfacing project state (Reef facts, findings, freshness, runs) in a
  visual UI that does not require an MCP-aware coding agent
- exposing operator actions (refresh index, ack findings, run precommit,
  inspect MCP runs) without dropping to the CLI
- supporting the existing CLI and MCP surfaces by sharing the same
  backend, never replacing them

It does **not**:

- replace the CLI or MCP stdio surfaces
- run analysis Reef does not already provide
- add cloud sync or remote telemetry
- bundle Node.js as a generic interpreter (it bundles the Mako services
  as managed children)
- ship a mobile or web-hosted client
- attempt to rewrite the React dashboard

## Studio Model

Studio is a thin native shell over the existing layering:

```text
Studio shell (Tauri 2 + Rust)
  -> managed children: services/api, services/harness
  -> Studio bootstrap/auth: per-launch token + origin checks
  -> embedded webview: apps/web (Vite-built static bundle)
  -> runtime config: apiOrigin, harnessOrigin, studioSessionToken
  -> shared backend: same that CLI and MCP stdio talk to
```

### Studio Shell

The Tauri shell is responsible for:

- launching `services/api` (port `127.0.0.1:3017` by default) and
  `services/harness` (port `127.0.0.1:3018` by default) as managed child
  processes
- creating a per-launch Studio session token and passing child bootstrap
  config through stdin/pipe with redacted logs
- dynamic port allocation when defaults are taken
- streaming child stdout/stderr into a debug pane
- forwarding shutdown signals (SIGTERM on POSIX, taskkill on Windows)
  with grace periods that match the existing stdio MCP shutdown contract
- native menus, system tray, deep-link / URI handler registration
- file-system directory picker scoped to project roots
- auto-update via Tauri updater + GitHub Releases artifact host
- code-signing pipeline (Apple Developer ID + notarization, Windows
  Authenticode, signed Linux artifacts)
- enforcing Tauri capability entries for every bridge command, scoped to
  the local app origin and main Studio window/webview

### Embedded Dashboard

The dashboard is the existing `apps/web` Vite build:

- consumed as a static `dist/` bundle served by Tauri's app URL/custom
  protocol, not a hosted dev server and not `tauri-plugin-localhost`
- receives a shell-injected runtime object through Tauri
  `initialization_script` before React boots:
  `apiOrigin`, `harnessOrigin`, `studioSessionToken`, service versions,
  and `isStudio`
- talks to the shell's children through the injected origins and Studio
  auth header
- knows nothing about Tauri except through a small bridge module
- continues to work in the browser via `pnpm dev` / `pnpm preview` for
  developers who do not want to install Studio
- treats the `apps/web` Vite proxy as development-only routing; the
  static Studio build cannot assume `/api/v1/*` is automatically proxied

### Tauri Bridge

A minimal bridge module exposes shell-only capabilities to the dashboard
through Tauri commands:

- pick a directory to attach as a project
- open a file in the user's default editor
- open an external documentation URL in the user's default browser
- copy structured payloads (e.g., evidence refs) to the system clipboard
- show native confirmation dialogs for destructive actions
- query shell version, platform, and update status

The bridge stays small. Anything that the HTTP services already expose
should keep going through HTTP.

## Hard Decisions

1. **Tauri 2 over Electron.**
   Tauri 2 wins on binary size, system webview, and RAM footprint, and
   the existing services already speak HTTP so no Node-in-main is needed.
   Electron is parked unless Tauri proves inadequate for a specific need.

2. **Services stay HTTP children.**
   `services/api` and `services/harness` are not merged into the shell
   process. The CLI and Studio share the same backend; merging would
   regress that contract.

3. **The dashboard is unchanged.**
   `apps/web` keeps shipping as-is. Studio embeds it; Studio does not fork
   it. New Studio-specific UI uses the same Tailwind / React / TanStack
   Query / shadcn-equivalent patterns the dashboard already uses.

4. **Browser-only mode survives.**
   The existing `pnpm dev` / `pnpm preview` flow remains a first-class
   dev experience. Studio is additive packaging, not a replacement.

5. **Project-root scope is non-negotiable.**
   File-system access through Tauri allowlists is restricted to the
   user's chosen project roots. The shell never reads outside. Project
   roots may live outside the user's home directory if the user explicitly
   chooses them through the picker and the canonical path is validated.

6. **Code signing is mandatory before Studio 1 ships.**
   An unsigned macOS app gets Gatekeeper-blocked. Unsigned Windows
   binaries trigger SmartScreen warnings. Studio cannot ship to operators
   without signed artifacts.

7. **Loopback is not auth.**
   Studio-managed services bind to `127.0.0.1`, but every Studio HTTP call
   also carries the per-launch token and passes Origin and Host header
   checks for the embedded dashboard origin and selected local service
   port. Browser-only dev keeps its own loopback policy and must not
   silently inherit Studio privileges.

8. **Static dashboard routing is explicit.**
   The production Studio bundle gets runtime routing config from the shell.
   Vite's dev proxy remains for `pnpm dev` only. The production dashboard
   is served from Tauri's app URL/custom protocol; do not use
   `tauri-plugin-localhost` for asset hosting.

9. **GitHub Releases is the artifact host.**
   No private auto-update server in the first cut. Releases hosts macOS
   `.dmg`, Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb`. Tauri updater
   reads from a release manifest URL.

10. **Updates are explicit, not silent.**
   The shell prompts the user before downloading a new version. Auto-
   restart only after the user agrees. No background mutation of the
   installed binary.

11. **Studio telemetry is separate from usefulness telemetry.**
   Roadmap 8.1's `RuntimeUsefulnessEvent` contract is for usefulness and
   decision feedback (`grade: full | partial | no`). Studio UI/perf/error
   events use a separate local `studio_events` table unless a later
   contract phase deliberately widens Roadmap 8.1.

12. **Reef state surfacing is gated on Reef Engine.**
    Studio 2 (project state visualization) requires Reef 1 (fact model)
    to be shipped. Studio phases that depend on Reef do not start before
    those Reef phases land.

13. **Reef owns facts, findings, and rule execution.**
    Studio renders Reef facts/findings/rules and writes acks through the
    existing `finding_acks` ledger. Studio does not create a second finding
    lifecycle or run Reef rules itself.

## Phase Sequence

1. `Studio 1` — Tauri Shell Foundation
2. `Studio 2` — Project State Visualization
3. `Studio 3` — Operator Actions Surface
4. `Studio 4` — Multi-Project Workspace
5. `Studio 5` — Auto-Update And Telemetry
6. `Studio 6` — Rule Pack Surface

## Phase Summary

### Studio 1 Tauri Shell Foundation

Status: `Planned`

Wrap the existing `apps/web` build in a Tauri 2 shell. Spawn and
supervise `services/api` and `services/harness` with port discovery,
per-launch Studio auth, runtime dashboard routing, and graceful shutdown.
Sign and publish artifacts for Windows, macOS, and Linux.

Ships:

- new `apps/studio/` package with Tauri 2 scaffolding
- Rust-side process supervisor for the two HTTP services
- per-launch Studio bootstrap token and service Origin/Host checks
- dashboard runtime config injection for api/harness origins
- TypeScript-side bridge module exposed to the dashboard
- code-signing pipeline (CI matrix per platform)
- single-launch experience: download → run → dashboard loads
- graceful shutdown that propagates SIGTERM to children with a grace
  period

### Studio 2 Project State Visualization

Status: `Planned`

Surface Reef Engine state in the dashboard once Reef 1 has shipped. The
goal is a visual answer to "what does Mako already know about this
project?"

Ships:

- findings table with severity, source, status, and ack badges
- index freshness panel with stale / deleted / unindexed breakdown
- recent index runs with trigger source and stats
- file-level findings drawer accessible from `Search` and `Tools` pages
- Reef-backed `context_packet` surface in the existing `Agent.tsx` page

Depends on Reef 1 for fact/finding contracts and store accessors.

### Studio 3 Operator Actions Surface

Status: `Planned`

Add in-shell operator commands that today require the CLI.

Ships:

- "Refresh index" button mapped to `project_index_refresh`
- "Run precommit" button mapped to `git_precommit_check`
- bulk ack / suppress for findings through the existing `finding_acks`
  ledger; resolved state is displayed when Reef reports it
- MCP run inspector that surfaces `recall_tool_runs` output
- session inspector that surfaces `session_handoff` output
- agent feedback summary view (read-only) over Roadmap 8.1 telemetry
- local Studio audit events for operator actions

Each action calls existing HTTP endpoints. No new tool contracts ship in
this phase unless Reef exposes a findings-management API before Studio 3.

### Studio 4 Multi-Project Workspace

Status: `Planned`

Let the user switch between attached projects without restarting the
shell or its services.

Ships:

- project bar with the active project, recents, and a switcher
- attach-project flow using the native directory picker
- detach-project flow with confirmation
- per-project state isolation in the dashboard (TanStack Query keys
  include the active `projectId`)
- shell remembers the last active project across launches

The services already support multi-project state. This phase wires the
UI to it.

### Studio 5 Auto-Update And Telemetry

Status: `Planned`

Make Studio updateable without manual reinstall and let users opt into
telemetry.

Ships:

- Tauri updater integration with GitHub Releases as the manifest host
- update prompt UX with release notes preview
- opt-in telemetry consent on first launch (default off)
- anonymized local Studio event capture in `studio_events`; remote upload
  remains a later opt-in endpoint decision
- "About" panel with shell version, dashboard build hash, services
  versions, and update channel

### Studio 6 Rule Pack Surface

Status: `Planned`

Once Reef 1 ships rule identity/fingerprint semantics and Reef 5 exposes
public rule descriptor/query surfaces, Studio surfaces rule packs for
browsing and ack management.

Ships:

- rule browser by source (`reef_rule`, `eslint`, `typescript`,
  `git_precommit_check`)
- per-rule documentation panel with `documentationUrl` rendering
- "fingerprint preview" panel for ack lifecycle inspection
- bulk-ack flow scoped by rule, severity, or path glob

Depends on Reef 1 shipping the executable rule contract and Reef 5
shipping a public `ReefRuleDescriptor` listing surface.

## Verification Rule

Every Studio phase should leave behind:

- a real desktop launch (not just `pnpm dev`)
- typed contract coverage where new bridge commands ship
- at least one smoke that exercises the studio binary on the platform
  the PR was written on
- code-signing parity (PR may not regress the signing pipeline)
- docs updated in this roadmap package
- CHANGELOG entry under `## [Unreleased]`

Studio is not working until it can survive:

- launch on a clean machine without Node.js installed → dashboard loads
- quit shell → both services exit, no orphaned processes
- attempt to read outside project root via the bridge → rejected
- request local service without Studio token or from the wrong origin →
  rejected
- request local service with a wrong Host header → rejected
- static dashboard build launches without Vite proxy → api/harness calls
  route through injected config
- update prompt → user accepts → new build installs → previous data
  preserved
- crash one child service → shell shows error and offers restart, does
  not silently leak

## Parked Until Evidence

- Electron migration
- mobile / iPad clients
- cloud sync or remote telemetry aggregation
- multi-window or workspace-style multi-project view
- IDE / editor extensions (those are the MCP surface's job)
- bundled Node interpreter for arbitrary scripts
- AI-driven UI personalization
- offline LLM hosting in the shell

These are not bad ideas. They need evidence from a working Studio 1-3
substrate before they earn roadmap space.
