# Mako Studio Roadmap

**Status:** PLANNED ON MAIN; implementation parked on `reef/studio`

**Upstream Baseline:** Initial Testing Phases 1-6 shipped, Reef Engine
1-6 shipped on `main`, Roadmap CC complete, Roadmap 8.1 telemetry
shipped and paused for accumulated usage.

**Repository Status (2026-04-25):** `main` contains the Mako Studio
roadmap only. The Tauri shell, Studio bridge, MSI/MSIX packaging, Store
scripts, and Studio-specific dashboard pages remain parked on
`reef/studio`. Do not treat Studio as part of the shipped `main` product
until that branch is deliberately merged.

**Primary Goal:** wrap the existing `apps/web` dashboard in a single-launch
desktop shell so operators get one download for Windows, macOS, and Linux
that boots the Mako services, hosts the dashboard UI, and provides direct
access to project facts, findings, indexed evidence, and tool runs without
asking the user to manage three local processes manually.

## Purpose

This folder is the canonical roadmap package for the Mako Studio track.

Mako Studio is the answer to the product gap:

> Mako already has a React dashboard at `apps/web` and two HTTP services
> (`services/api` and `services/harness`). Today they require three manual
> launches plus a browser tab. Should that be one application?

The target architecture is:

```text
Mako Studio app launch
  -> Tauri shell creates a per-launch Studio bootstrap credential
  -> shell starts services/api + services/harness as managed children
  -> children receive ports + credentials through stdin bootstrap
  -> shell hosts the existing Vite-built dashboard via Tauri app protocol
  -> dashboard receives runtime config via initialization_script
  -> dashboard talks to local services with Studio auth headers
  -> shell handles updates, signing, project picker, and lifecycle
```

The CLI (`agentmako`) and MCP stdio surfaces remain unchanged. Studio is a
third surface, not a replacement for the other two.

## What Studio Should Own

- **Process lifecycle.** Boot, supervise, and shut down `services/api` and
  `services/harness` as Tauri-managed child processes with discoverable
  ports.
- **Local service bootstrap/auth.** Generate a per-launch Studio session
  token, pass it to managed children through stdin bootstrap, and make
  service requests prove they came from the embedded dashboard.
- **Dashboard hosting.** Serve the existing `apps/web` static build through
  the system webview (WebView2 / WKWebView / WebKitGTK) from the Tauri app
  URL/custom protocol, not a production localhost asset server.
- **Runtime routing.** Inject the api/harness origins and Studio token into
  the dashboard at boot. The Vite dev proxy is a browser-dev convenience,
  not the production Studio routing model.
- **Project picker.** Native file-system directory picker for attaching new
  projects without touching the CLI.
- **Updates.** Auto-update via Tauri updater + GitHub Releases as the
  artifact host.
- **Code signing.** Apple Developer ID + notarization on macOS, Authenticode
  on Windows, signed AppImage / .deb on Linux.
- **Sandboxing.** Tauri permission allowlists scoped to the user's chosen
  project roots.
- **Eventually:** project state visualization, findings management, rule
  pack browsing, operator action surface for refresh / ack / precommit /
  MCP session inspection.

## What Studio Does Not Own

- Reef Engine internals (Studio surfaces Reef state; it does not implement
  facts or findings logic).
- The CLI or MCP stdio transport (those remain primary for headless use).
- Cloud sync or multi-machine state.
- Mobile / iPad clients.
- Cross-repo workspace navigation (single project at a time).
- Hosted analysis or remote telemetry.

## Hard Boundaries

- Studio is a packaging and operator surface, not a new computation engine.
- The Vite-built dashboard at `apps/web` remains the canonical UI. Studio
  embeds it; Studio does not fork its own React tree.
- `services/api` and `services/harness` keep their HTTP boundary. They are
  not absorbed into the Tauri main process. The CLI and Studio share the
  same backend.
- Loopback is not auth. Studio-managed services bind to `127.0.0.1`, but
  still require the per-launch Studio token and reject non-Studio Origin
  and Host headers.
- Tauri bridge commands are capability-scoped to the local app origin,
  window, and webview. Remote origins never receive shell command access.
- `tauri-plugin-localhost` is not a production asset-hosting mechanism for
  Studio. Use Tauri's app URL/custom protocol for bundled dashboard assets.
- Service credentials never travel through process args, persistent files,
  logs, or ordinary environment variables. Stdin bootstrap is the Studio 1
  contract.
- The embedded dashboard must not depend on `apps/web`'s Vite dev proxy.
  Studio injects runtime routing config before React boots.
- Tauri 2 is the chosen native shell. Electron is parked unless Tauri is
  later proven inadequate for a specific need.
- Rust in the Tauri shell stays minimal: process supervision, port
  discovery, native menus, file-system picker, deep-link handling. No
  business logic.
- Project-root scope is non-negotiable. The shell never reads outside the
  user's chosen project roots.
- Browser-only mode (existing `pnpm dev` / `pnpm preview` flow) must keep
  working. Studio is additive, not exclusive.

## Package Contents

- [roadmap.md](./roadmap.md) - canonical roadmap contract and phase
  sequence
- [handoff.md](./handoff.md) - execution assumptions and working rules
- [phases/README.md](./phases/README.md) - phase index

## Names

- **Studio shell:** the Tauri-built native application that hosts the
  dashboard.
- **Embedded dashboard:** the existing `apps/web` Vite build, served from
  the shell's bundled static assets.
- **Managed child:** an `services/api` or `services/harness` process the
  shell spawns, supervises, and shuts down with the app.
- **Project picker:** the native directory chooser that resolves a project
  root and hands it to `agentmako connect` semantics.
- **Project bar:** the Studio UI surface that shows the active project,
  recently attached projects, and a switcher.
- **Operator action:** an in-shell command that maps to a CLI/API call
  (`refresh index`, `ack finding`, `run precommit`, `inspect MCP run`).

## Cross-Roadmap Dependencies

Studio depends on specific Reef Engine phases for content, not for
timing:

- Studio 1 has no Reef dependency; it can ship as soon as the dashboard
  and services are stable.
- Studio 2 depends on **Reef 1** (`project_findings` / `file_findings`
  + freshness contracts).
- Studio 6 depends on **Reef 1** (rule descriptor type + `list_reef_rules`
  tool stub) and benefits from **Reef 5** (real rules registered).
- Studio 4's overlay surfacing benefits from **Reef 3** (overlay
  contracts) but ships an "indexed-only" UI until Reef 3 lands.

The contract is **by-name, not by-date.** If Reef N slips, the
dependent Studio phase slips with it. Studio phases that have no Reef
dependency (1, 3, 5) ship on Studio's own timeline. The Mako Studio
roadmap does not gate on any Reef phase shipping by a specific quarter.

## First Slice Bias

The first implementation should be boring and useful:

1. Tauri 2 shell that bundles the existing `apps/web` build.
2. The shell launches `services/api` and `services/harness` as managed
   children with port discovery.
3. The dashboard loads from the static bundle, receives shell-injected
   runtime config, and connects to the local services without any manual
   `pnpm dev` invocation.
4. Quitting the shell gracefully shuts down both services.
5. Internal dev artifacts may be unsigned, but no public Studio 1 release
   ships until signing/notarization is green for Windows, macOS, and Linux.

That gets Mako one download and one launch without changing a single line
of dashboard code or service code.
