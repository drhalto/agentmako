# Studio 1 Tauri Shell Foundation

Status: `Planned`

## Goal

Ship a Tauri 2 desktop shell that bundles the existing `apps/web` build,
spawns and supervises `services/api` and `services/harness` as managed
children, and produces signed downloadable artifacts for Windows, macOS,
and Linux.

The user-visible test is: download → double-click → dashboard loads with
a working local backend → close window → both services exit cleanly.
Zero terminal commands required.

## Scope

- new `apps/studio/` workspace package with Tauri 2 scaffolding
- Rust process supervisor for the two services
- per-launch Studio bootstrap credential and local service auth checks
- Host/Origin validation and service exit on stdin EOF
- static-dashboard runtime routing config (`apiOrigin`, `harnessOrigin`,
  Studio token, service versions)
- TypeScript bridge module for shell-only capabilities
- new CLI command `agentmako studio serve --json-bootstrap` that starts
  `services/api` + `services/harness` together, accepts a Studio
  bootstrap envelope on stdin (token, port preferences), and emits the
  resolved ports back to stdout. Required for `cargo tauri dev` and for
  the bundled-services hosting pattern. Today's `agentmako serve`
  starts only api, and `agentmako dashboard` also starts Vite; neither
  matches the production Studio service host.
- build-time copy of `apps/web/dist/` into the Studio bundle
- code-signing pipeline (Apple Developer ID + notarization, Windows
  Authenticode, signed Linux AppImage)
- CI matrix that builds (and signs in a follow-up) per platform
- macOS launch verification in the PR; Windows + Linux follow-ups via
  CI artifacts

## Out Of Scope

- auto-update (Studio 5)
- telemetry (Studio 5)
- multi-project workspace (Studio 4)
- operator actions beyond what the dashboard already calls (Studio 3)
- Reef state surfacing (Studio 2)
- rule pack UI (Studio 6)
- absorbing services into the Tauri main process

## Hosting Decision

Studio 1 must pick a service-hosting pattern (see handoff "Service
Hosting Decision"). Recommended:

- **Published artifacts:** bundle the services. The shell ships with a
  Node runtime and the workspace's `services/api` and `services/harness`
  builds inside the app bundle.
- **Local dev (`cargo tauri dev`):** spawn the workspace service
  entrypoints directly through sidecar/dev-child wrappers unless a
  dedicated `agentmako studio serve` command exists. The current
  `agentmako serve` starts only
  `services/api`, while `agentmako dashboard` also starts Vite, so
  neither is the production Studio service host.

The PR must report the bundled artifact size on each platform. If macOS
`.dmg` exceeds 200 MB or Windows `.exe` exceeds 150 MB, escalate before
shipping.

## Architecture Sketch

```
apps/studio/
├── package.json           // workspace package, drives `tauri build`
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json    // bundled assets, allowlist, signing config
│   └── src/
│       ├── main.rs        // app entry, window setup
│       ├── supervisor.rs  // child process lifecycle
│       ├── bootstrap.rs   // per-launch token + child bootstrap config
│       ├── ports.rs       // free-port discovery near defaults
│       ├── bridge.rs      // tauri::command exports for the dashboard
│       ├── runtime.rs     // dashboard runtime config injection
│       └── safety.rs      // project-root validation
└── src/                   // TypeScript bridge module + thin shell-only
                            //   surface that the dashboard imports
```

## Contract Sketch

### Bridge commands exposed to the dashboard

```ts
// apps/studio/src/bridge.ts
export interface StudioBridge {
  isStudio: true;                              // capability flag

  runtimeConfig(): Promise<{
    apiOrigin: string;
    harnessOrigin: string;
    studioSessionToken: string;
    dashboardOrigin: string;
  }>;
  pickProjectDirectory(): Promise<string | null>;
  openInSystemEditor(absolutePath: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  copyToClipboard(payload: string): Promise<void>;
  showConfirm(message: string): Promise<boolean>;

  shellInfo(): Promise<{
    studioVersion: string;
    dashboardBuildHash: string;
    services: {
      api: { port: number; pid: number; status: "running" | "starting" | "stopped" | "failed" };
      harness: { port: number; pid: number; status: "running" | "starting" | "stopped" | "failed" };
    };
    platform: "darwin" | "windows" | "linux";
    arch: "x64" | "arm64";
  }>;
}
```

When the dashboard renders in a regular browser, `window.__MAKO_STUDIO__`
is undefined. Code that needs shell features tests for it before using.

The shell also injects a one-shot runtime object before React boots:

```ts
declare global {
  interface Window {
    __MAKO_STUDIO_BOOTSTRAP__?: {
      apiOrigin: string;
      harnessOrigin: string;
      studioSessionToken: string;
      dashboardOrigin: string;
      studioVersion: string;
      serviceVersions: { api: string; harness: string };
    };
  }
}
```

Use Tauri `WebviewWindowBuilder::initialization_script` for this
bootstrap. Do not fetch it from an HTTP endpoint after load; that creates
a race and exposes another surface before the dashboard knows its service
origins.

The dashboard HTTP client reads this object in Studio. Browser-dev mode
continues to use the `apps/web` Vite proxy and `MAKO_API_URL` /
`MAKO_HARNESS_URL` conventions.

### Supervisor invariants

- Children are spawned with `127.0.0.1` bind, never `0.0.0.0`.
- Default ports are 3017 (api) and 3018 (harness). If taken, the
  supervisor allocates the next free port in 30xx.
- The shell creates a high-entropy per-launch token using OS randomness
  and passes it to both services through stdin/pipe bootstrap. Process
  args, ordinary environment variables, persisted files, and logs are not
  acceptable token channels.
- Services read bootstrap config at startup, then treat stdin EOF as a
  parent-death signal and exit gracefully.
- Studio-managed service requests must include the Studio token, and the
  services must reject requests from the wrong Origin or Host header.
  Binding to `127.0.0.1` is necessary but not sufficient.
- Each child's stdout and stderr are captured and surfaced through a
  `bridge.streamServiceLogs()` event channel.
- The supervisor maintains a process registry for api/harness children and
  drains it on window close, app exit, and crash paths. A forced shell exit
  must not leave orphaned service processes.
- On window close request, the shell sends SIGTERM (POSIX) or
  `taskkill /F /T` (Windows) with a 10-second grace period before SIGKILL.
- Crashed children produce a user-visible toast and offer one-click
  restart. The shell does not silently restart on its own.

Reference precedent: Tauri's own desktop CLI tooling uses
`shared_child::SharedChild` plus a `manually_killed_app: AtomicBool`
to track whether a kill came from the operator vs an unexpected exit
— see `tauri-dev/crates/tauri-cli/src/interface/rust/desktop.rs:23-43`
for the `DevChild` struct and `kill()` / `wait()` / `manually_killed_process()`
methods. Reef's process supervisor adopts the same pattern. Tauri also
emits `RunEvent::Exit` before killing managed sidecars to allow
graceful shutdown (Tauri 1.0.3 changelog), which Studio's supervisor
mirrors via the 10-second grace period.

### Safety invariants

- `pickProjectDirectory()` resolves the directory path through the OS
  picker; the path is validated as a real directory and stored as the
  active project root.
- All bridge commands that take paths validate they resolve under the
  active project root before forwarding to children. Outside-root paths
  return `{ ok: false, code: "outside_project_root" }`.
- `openInSystemEditor()` only accepts canonical project-root-scoped file
  paths. It must not open arbitrary URLs.
- `openExternalUrl()` only accepts allowlisted external schemes
  (`https:` by default; `http://localhost` only for local dev docs if
  explicitly allowed). It opens in the system browser, not inside the
  Studio webview.
- The Tauri allowlist for `fs` is empty in production builds; all file
  access goes through bridge-validated commands.
- Every Tauri command has a capability entry scoped to the local Studio
  app origin, the main window, and the intended webview. Remote origins
  get no shell command access.
- Production builds set an explicit WebView CSP. At minimum, script/style
  sources come from the bundled app origin, and `connect-src` is limited to
  the injected `127.0.0.1` api/harness origins plus the Tauri app origin.
- Production builds must not depend on `tauri-plugin-localhost`.

Reference precedent: Tauri 2's `Capability` struct lives at
`tauri-dev/crates/tauri-utils/src/acl/capability.rs:150-206` and
includes `windows`, `webviews` (fine-grained), `permissions`, `local`,
and `remote.urls` fields. A capability TOML example is at
`tauri-dev/crates/tests/acl/fixtures/capabilities/multiwebview/cap.toml`.
The runtime builder is at `tauri-dev/crates/tauri/src/ipc/capability_builder.rs`.
Per-command scope checks (allow / deny lists) follow
`tauri-dev/examples/api/src-tauri/src/cmd.rs` (`command_scope.allows()`
/ `.denies()` pattern). Studio 1's CI capability/command-drift check
verifies that every `#[tauri::command]` export has a matching capability
entry under `apps/studio/src-tauri/capabilities/`.

## Done When

- `apps/studio/` package builds via `cargo tauri build` on macOS, with
  a signed artifact verifiable by `codesign --verify --deep --strict`.
- `StudioSecurityModel.md` and `ServiceBootstrapProtocol.md` exist and
  document token generation, stdin bootstrap, Host/Origin checks,
  capability scope, CSP, and child-process lifecycle.
- Studio launch on macOS opens a window, the dashboard loads, the api
  and harness children appear in `Activity Monitor`, the dashboard's
  "Health" page shows them as connected.
- The dashboard loads from the static bundle without Vite running, reads
  shell-injected runtime config, and successfully calls both services.
- A request to either local service without the Studio token, with a bad
  token, from the wrong Origin, or with the wrong Host header is rejected.
- Closing the window terminates both children within the grace period
  (verified by `ps aux | grep services/`).
- Killing the shell from the OS leaves no api/harness child processes
  behind within 5 seconds.
- Bridge command `pickProjectDirectory` shows a native picker; selecting
  a directory updates the dashboard's active project state.
- A bridge command that receives a path outside the active project root
  is rejected with `code: "outside_project_root"`.
- A bridge command exported from Rust without a matching Tauri capability
  entry fails CI.
- Production Studio has no `tauri-plugin-localhost` dependency and ships a
  checked CSP.
- `pnpm dev` and `pnpm preview` for `apps/web` continue to work without
  Studio installed.
- Windows and Linux build artifacts are produced by CI, even if signing
  is deferred to Studio 1.x follow-ups.
- CHANGELOG entry under `## [Unreleased]`.
- Roadmap status updated.

## Verification

Smokes:

- `apps/studio/test/smoke/launch.ts` (Node-driven, spawns the built
  binary, asserts the dashboard's health endpoint responds, asserts the
  binary exits cleanly when sent SIGTERM)
- `apps/studio/test/smoke/safety.ts` (calls bridge commands with paths
  outside the active project root, asserts rejection)
- `apps/studio/test/smoke/local-auth.ts` (calls api/harness with missing
  token, wrong token, wrong Origin, wrong Host, and valid Studio token)
- `apps/studio/test/smoke/static-routing.ts` (launches the built static
  dashboard with no Vite process and asserts api/harness routes use the
  injected origins)
- `apps/studio/test/smoke/orphan-process.ts` (kills the shell process and
  asserts no api/harness children remain after 5 seconds)
- `apps/studio/test/smoke/port-discovery.ts` (pre-binds 3017 and 3018,
  launches Studio, asserts services land on alternate 30xx ports and
  the dashboard finds them)

General checks:

- `corepack pnpm run typecheck`
- `corepack pnpm --filter @mako-ai/studio build`
- existing `pnpm dev` flow for `apps/web` still works
- macOS notarization staple on the published `.dmg`

## Risks And Watchouts

- **Notarization latency.** Apple notarization can take 5-15 minutes per
  artifact and occasionally fails for opaque reasons. Build the CI step
  to retry once and surface the rejection ticket if it fails twice.
- **Windows SmartScreen.** Authenticode-signed apps still trigger
  SmartScreen for the first ~thousand downloads. Document this in the
  release notes; do not panic.
- **Bundled Node version drift.** The bundled Node must match what
  `services/api` and `services/harness` need (currently
  `--experimental-sqlite`). Pin the bundled Node version explicitly in
  `tauri.conf.json` resource paths. Bumping the project's Node must
  bump the bundled Node.
- **WebView2 evergreen on Windows.** WebView2 auto-updates on most
  Windows installs but can be missing on Server SKUs or LTSC. The Tauri
  installer should bootstrap WebView2 if absent.
- **WKWebView quirks.** Service workers in WKWebView (macOS) behave
  differently than Chromium. The dashboard does not use service workers
  today; add a regression check that this stays true.
- **First-launch performance.** Macs notarize-on-first-launch checks can
  add several seconds of startup time. Make sure the launch screen
  shows a loading state instead of a blank window.
- **Token leakage.** Bootstrap tokens must not appear in process titles,
  crash logs, debug panes, stdout/stderr, or persisted preferences. Redact
  any field named `token`, `authorization`, or `bootstrap`.
- **Environment leakage.** Environment variables are easy to inherit or
  inspect under the same user. Use stdin/pipe bootstrap for Studio service
  credentials, not env vars.
- **Orphan sidecars.** Sidecar processes do not become safe just because
  the shell spawned them. Track every child handle, drain the registry on
  close/destroy/exit, and make services exit on stdin EOF.
- **Static routing drift.** The Vite proxy masks routing mistakes in dev.
  Always run a smoke against the static bundle where `/api/v1/*` is not
  magically proxied by Vite.
- **Localhost plugin temptation.** `tauri-plugin-localhost` is useful for
  narrow cases, but it exposes assets on a real TCP port. Keep production
  dashboard assets on Tauri's app URL/custom protocol.
- **Bundled artifact size.** Node + the two services + the dashboard
  bundle could push the macOS `.dmg` past 200 MB. Tree-shake aggressively;
  consider unbundling Shiki language assets that are not used by the
  dashboard's primary pages.
- **Path validation traversal.** Bridge command path validators must
  resolve symlinks and `..` segments before comparison. Use Rust's
  `std::fs::canonicalize` plus active-root prefix check.
- **Tauri allowlist drift.** Each new bridge command needs an explicit
  capability entry in `tauri.conf.json`. Catch new commands without
  capability registration in CI.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- `apps/web/` - the embedded dashboard
- `services/api/` - HTTP service (port 3017)
- `services/harness/` - HTTP service (port 3018)
- Tauri 2 docs: https://tauri.app/
