# Mako Studio Handoff

This file is the execution handoff for the Mako Studio roadmap.

Source inputs:

- [./roadmap.md](./roadmap.md)
- [./README.md](./README.md)
- [../version-initial-testing/roadmap.md](../version-initial-testing/roadmap.md)
- [../reef-engine/roadmap.md](../reef-engine/roadmap.md)
- `apps/web/`
- `services/api/`
- `services/harness/`

## Current Repository Status

On `main`, Mako Studio is documentation and planning only. The actual
Studio/Tauri/MSI/MSIX implementation is parked on `reef/studio` and is
not part of the shipped Reef merge.

Reef Engine is shipped on `main`/`origin/main` at commit `8196476`
(2026-04-25). Studio work should assume Reef is available, but should not
be required for Reef, CLI, MCP stdio, or the existing dashboard to work.

## Roadmap Intent

Mako Studio should make Mako installable. Today the dashboard is real and
useful, but to use it an operator must install Node.js, clone the repo,
run `pnpm install`, run `pnpm dev` for the Vite server, and run two
service processes alongside it. That is fine for developers and wrong
for everyone else.

The core promise:

```text
Download Mako Studio.
Launch it.
Pick your project.
Mako already knows what is wrong, what is fresh, and what to do next.
```

## Mandatory Entry Assumptions

Treat these as already shipped:

- the `apps/web` dashboard with React 19, TanStack Query, Tailwind 4,
  Shiki, and Sonner
- the `services/api` HTTP service on `127.0.0.1:3017`
- the `services/harness` HTTP service on `127.0.0.1:3018`
- HTTP routing conventions documented in `apps/web/vite.config.ts`
  for browser-dev mode only
- Initial Testing Phase 4 freshness contracts and `project_index_refresh`
- Initial Testing Phase 5 `context_packet`, `tool_batch`, and overlays
- Roadmap 8.1 runtime telemetry capture
- Reef 1's rule/fact/finding contracts once Studio 2+ starts
- the existing CLI `agentmako` and MCP stdio surfaces

Studio depends on these but does not modify their contracts.

## Working Rules

1. **Do not modify the dashboard for Studio's sake.**
   Studio embeds `apps/web` as-is. New Studio-specific UI is added via
   pages that the dashboard already renders, behind an "is running in
   Studio" capability flag exposed by the Tauri bridge.

2. **Do not modify the services for Studio's sake.**
   `services/api` and `services/harness` keep their HTTP boundary. If
   Studio needs new shell-only behavior, that goes in the Tauri bridge,
   not in the services.

   Exception: Studio 1 may add a minimal shared local-auth middleware to
   both services so Studio-managed requests require a per-launch token and
   Origin check. That middleware must be optional for existing CLI/dev
   launches and documented as a service boundary, not shell business logic.

3. **Tauri 2, not Electron.**
   Phase Studio 1 commits to Tauri 2. Re-evaluate only if a measured
   blocker appears.

4. **Code signing is a release blocker.**
   No unsigned macOS or Windows artifacts ship to the GitHub Releases
   channel. Internal dev builds are fine; public artifacts must be
   signed.

5. **One project at a time.**
   The first three Studio phases assume a single active project. Multi-
   project surfaces wait for Studio 4. Do not pre-build multi-project
   abstractions in Studio 1-3.

6. **Browser-only mode survives every change.**
   Every PR that touches `apps/web` must keep `pnpm dev` and
   `pnpm preview` working. Studio is additive packaging.

7. **Rust stays minimal.**
   The Tauri shell's Rust code handles process supervision, port
   discovery, file-system picker, native menus, deep-link / URI handler,
   and update prompts. Anything else lives in TypeScript or in the
   services.

8. **Project-root scope is enforced by Tauri allowlists.**
   The shell never reads outside the user's chosen project roots. Bridge
   commands that take paths must validate against the active project's
   canonical root before delegating.

9. **Loopback is not authorization.**
   Studio-managed services bind to `127.0.0.1`, but they still require the
   shell-generated Studio token plus Origin and Host validation. Pass
   bootstrap config through stdin/pipe with redacted logs. Do not put
   tokens in operator-visible CLI args, ordinary environment variables, or
   persisted preferences.

10. **Vite proxy is dev-only.**
    `apps/web/vite.config.ts` documents the browser-dev proxy. The static
    Studio bundle must receive runtime config (`apiOrigin`, `harnessOrigin`,
    token, versions) from the shell through Tauri `initialization_script`
    before React boots. Bundled dashboard assets are served through the
    Tauri app URL/custom protocol, not `tauri-plugin-localhost`.

11. **Bridge capabilities are explicit.**
    Every Tauri command must have a capability entry scoped to the local
    Studio app origin, main window, and webview. Add a CI check that fails
    when exported commands and capability config drift.

12. **Studio telemetry is not Roadmap 8.1 usefulness telemetry.**
    UI navigation, performance, and local shell errors go to a Studio-owned
    local event table. `mako_usefulness_events` remains for existing
    usefulness/finding feedback unless a later contract phase widens it.

13. **No silent autonomy.**
   Studio displays Reef findings and Mako suggestions. It does not edit
   files, run repair plans, or silently mutate project code. Operator
   actions are explicit clicks.

14. **Local-first stays intact.**
    Facts, findings, telemetry, and embeddings remain local unless a
    separate explicit export feature is built.

## Initial Architecture Bias

Use the existing Mako layering:

- **Tauri shell** lives in a new `apps/studio/` workspace package.
- **Bundled dashboard** comes from `apps/web/dist/` via a build-time
  copy step the Tauri config drives.
- **Service binaries** are spawned from the user's installed
  `agentmako` if present, else from a bundled Node-runtime + service
  bundle (Studio 1 decides which path; both are tested).
- **Service bootstrap** is Studio-owned: the shell allocates ports,
  creates the token, passes a bootstrap envelope to child services, and
  injects matching runtime config into the dashboard. Today
  `agentmako serve` starts only `services/api`, while
  `agentmako dashboard` starts api + harness + Vite for monorepo dev, so
  do not assume a combined production service command exists.
- **Bridge contracts** live alongside the shell as a small Tauri command
  set. They are not part of `@mako-ai/contracts` because they are
  shell-only.
- **MCP / CLI exposure** stays through the existing tool registry and
  CLI commands. Studio does not re-export tool contracts.

Avoid a new service boundary until the Tauri bridge proves insufficient.

## Language Guidance

Default to TypeScript on the dashboard side and Rust only inside the
Tauri shell.

Use Rust for:

- Tauri main entry point
- process supervisor for the two service children
- port discovery (find a free port near the default)
- platform-specific code-signing helpers in `tauri.conf.json`
- file-system picker and project-root validation
- update prompt orchestration

Do not use Rust for:

- business logic
- finding processing
- fact lookups
- session handling

If a hot path appears that demands more than the supervisor needs, route
it through the existing services first. Reef 6 is the place to evaluate
broader Rust use.

## Service Hosting Decision

Studio 1 has to choose between two hosting patterns:

**A. Use the user's installed `agentmako`.**
Studio expects `agentmako` on `PATH` (or via known install location).
This is only valid after a dedicated Studio service command exists, for
example `agentmako studio serve --json-bootstrap`, because the current
`agentmako serve` starts only `services/api` and `agentmako dashboard`
also starts a Vite dev server. Lower binary size; requires the user to
have installed `mako` via npm or to bundle it via a Studio installer
step.

**B. Bundle Node + the services inside Studio.**
Studio ships a Node runtime and the workspace's `services/api` +
`services/harness` builds inside its app bundle. Higher disk footprint
(~80-150 MB extra); zero external dependencies.

The first cut should pick **B** for the published artifacts and **A**
only if the dedicated Studio service command exists for
`cargo tauri dev` local development. Until then, dev mode should spawn
the workspace service entrypoints directly the same way
`agentmako dashboard` imports `startHttpApiServer` and
`startHarnessServer`. Bundling guarantees the single-launch promise;
direct workspace entrypoints let Mako contributors iterate on services
without rebuilding the shell.

Studio 1 must include a measurement of bundled artifact size. If the
combined Mac `.dmg` is over 200 MB, escalate the decision before
shipping.

## Suggested First PR

The first PR should be Studio 1 only:

- add `StudioSecurityModel.md` and `ServiceBootstrapProtocol.md` under
  the Studio docs package before code lands
- create `apps/studio/` with Tauri 2 scaffolding
- write the Rust supervisor that spawns `services/api` and
  `services/harness` as children, allocates ports, and forwards
  shutdown signals
- add Studio bootstrap/auth: per-launch token, child bootstrap config,
  HTTP auth/Origin/Host checks, redacted service logs, stdin EOF shutdown
- write the TypeScript bridge module that exposes shell capabilities
  to the dashboard
- add Tauri capability config and a CI command/capability drift check
- add a build-time step that copies `apps/web/dist/` into the Studio
  bundle
- wire the dashboard's runtime config to use shell-discovered api/harness
  origins and auth headers without relying on Vite proxy
- verify launch → dashboard loads → quit cleanly on macOS at minimum
- add CI matrix scaffolding; unsigned internal dev artifacts may merge,
  but public Studio 1 artifacts cannot ship until signing/notarization is
  green

Do not add auto-update, telemetry, or operator actions in the first PR.
Those are Studio 3 / Studio 5.

## What To Avoid

- no Electron migration without measured Tauri inadequacy
- no rewriting the dashboard
- no merging services into the Tauri main process
- no bundling tools that the user must invoke separately (`agentmako`,
  `git`, etc. — Studio orchestrates calls, not replacements)
- no auto-update in the first PR
- no telemetry without explicit opt-in
- no global filesystem watcher outside project roots
- no shell-side cache of project facts (the services own that)
- no production `tauri-plugin-localhost` asset server
- no service credentials in process args, ordinary environment variables,
  persisted preferences, or logs
- no new `RuntimeUsefulnessEvent` decision kinds for Studio UI events
  unless the runtime telemetry contract is intentionally widened first
- no documentation URLs opened through `openInSystemEditor`; external URLs
  need a separate allowlisted `openExternalUrl` bridge command

## Verification Posture

Each phase should include:

- platform-specific build coverage (macOS minimum in PR; Windows + Linux
  in CI)
- bridge contract tests where new commands ship
- at least one shell-launched smoke per phase
- project-root safety coverage where bridge commands take paths
- service-shutdown verification (no orphaned processes after quit)
- local-auth rejection coverage: missing token, wrong token, wrong Origin,
  wrong Host
- forced-exit/orphan-process coverage: killing the shell leaves no
  `services/api` or `services/harness` processes behind
- static-dashboard routing coverage without the Vite dev proxy
- docs and handoff status update

For update or signing work, include:

- signed artifact verification on the target platform
- updater rollback story (does the previous version remain installable)
- release-channel separation (stable vs nightly)

## Current Status

- Mako Studio roadmap opened.
- No implementation has shipped.
- First implementation target is Studio 1: Tauri 2 shell foundation
  with service supervision, Studio bootstrap/auth, static-dashboard
  routing, and code-signing pipeline.
