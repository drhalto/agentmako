# Studio 5 Auto-Update And Telemetry

Status: `Planned`

## Goal

Make Studio update without manual reinstall and let users opt into
anonymized Studio telemetry. Updates are explicit (the user agrees before
download), and telemetry is opt-in (default off). Studio telemetry uses a
separate local event stream; Roadmap 8.1's `mako_usefulness_events`
contract remains for usefulness/finding feedback.

The user-visible test is: a new release ships, the running Studio shell
shows a non-modal update prompt with release notes, the user clicks
"Update," the new build downloads and the shell restarts itself with
the operator's last active project preserved.

## Scope

- Tauri updater integration with GitHub Releases as the manifest host
- Tauri updater signing keypair, `.sig` artifact generation, and tamper
  rejection tests
- update prompt UX with release notes preview
- per-channel updater (stable, nightly)
- opt-in telemetry consent on first launch (default off)
- anonymized local Studio event capture in a Studio-owned table
- "About" panel with shell version, dashboard build hash, services
  versions, and update channel
- update settings panel: change channel, check now, defer until next
  launch, disable auto-prompt

## Out Of Scope

- crash reporting (separate decision; parked unless evidence of crash
  patterns appears)
- in-product feedback / bug-report submission (Studio 6 candidate or
  later)
- A/B feature gating
- silent updates (explicit consent is a hard rule)
- multi-stage rollouts

## Dependencies

- Studio 1, 2, 3, 4 shipped
- a working code-signing pipeline (Studio 1)
- GitHub Releases set up as the artifact host with at least one prior
  signed release published

## Update Architecture

### Manifest

Tauri updater reads a JSON manifest hosted at a stable URL:

```
https://github.com/<owner>/mako-ai/releases/latest/download/studio-update-manifest.json
```

The manifest looks like:

```json
{
  "version": "0.5.0",
  "notes": "Studio 4 multi-project workspace. ...",
  "pub_date": "2026-05-01T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<base64>",
      "url": "https://github.com/<owner>/mako-ai/releases/download/v0.5.0/Mako_Studio_0.5.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { ... },
    "windows-x86_64": { ... },
    "linux-x86_64": { ... }
  }
}
```

CI generates and signs the manifest as part of the release pipeline.
Each platform/architecture release asset must have a matching manifest
entry, signature, checksum, and smoke-tested download URL.
Updater private keys live only in CI/CD secrets. They are never committed,
printed in logs, or stored in shell preferences.

### Channel separation

Two manifest URLs:

- `studio-update-manifest-stable.json`
- `studio-update-manifest-nightly.json`

Default channel is stable. Nightly channel is opt-in via the update
settings panel. Channel choice persists in shell preferences (Studio 4).
Stable builds reject nightly manifests, nightly builds reject stable
manifests unless the user explicitly opted into that channel, and CI
tests both directions.

### Prompt UX

- non-modal toast on the bottom-right when an update is available
- "View update" expands a panel with: version, pub date, release notes
  (rendered Markdown from the `notes` field, sanitized), "Update now"
  button, "Later" button
- on "Update now": download, verify signature, prompt to restart, save
  active project to preferences, restart with the new binary
- on "Later": dismiss for the current session; re-prompt on next
  launch unless "deferred until next major version" is checked

### Failure modes

- network error fetching manifest → silent fail, log to debug pane,
  retry every hour
- signature verification fail → loud error toast: "Update rejected:
  signature mismatch"; do not retry until restart
- download interrupted → resume on next attempt; do not corrupt the
  installed binary
- post-install crash on first launch → Studio detects this and offers
  to roll back to the previous binary kept as `Mako Studio.previous`

## Telemetry Architecture

### Opt-in flow

First launch shows a one-time consent dialog before the dashboard
loads:

```
"Help improve Mako Studio by sending anonymized usage data?
 Mako collects: tool names you use, feature counts, error rates.
 Mako does NOT collect: file contents, project names, identifiers, IP.
 You can change this any time in Settings → Privacy."

 [No, thanks]   [Yes, send anonymized data]
```

Default: off. The dialog cannot be skipped without an explicit choice.
Consent is persisted in shell preferences.

### Event capture

When telemetry is on, the shell appends events to a local
`studio_events` table, then a background flush task batches events to a
configured endpoint (see "Endpoint" below). The local table is useful for
debugging and privacy review even when no remote endpoint exists.

**Storage location:** the `studio_events` table lives inside the
**per-project SQLite store** (`<project>/.mako/project.db`), alongside
`mako_usefulness_events` and `finding_acks`. Rationale:

- Project-scoped queries (e.g., "show Studio events for the active
  project") become trivial; no cross-database joins on `projectId`.
- The Phase 2 `ProjectStoreCache` already gives Studio a long-lived
  handle, so writes are cheap.
- The framing "Studio-owned" is about *who writes* the table, not
  *who can read* it. CLI/MCP processes can read `studio_events` for
  diagnostics if they want; they cannot write because the table only
  has a Studio-side insert path. This avoids the ambiguity of a
  separate `~/.mako-studio/events.db` while keeping the audit trail
  clear.
- Migration `0032_studio_events` adds the table with the same append-
  only / no-update / no-delete trigger pattern used by
  `mako_usefulness_events` and `finding_acks`.

Event shape:

```ts
{
  eventId: string;
  kind: "ui_navigation" | "operator_action" | "error" | "performance";
  family: "ui_navigation" | "operator_action" | "error" | "performance";
  projectId?: string;
  requestId?: string;
  toolName?: string;
  status: "info" | "succeeded" | "failed" | "partial";
  reasonCodes: string[];
  reason?: string;
  durationMs?: number;
  counts?: Record<string, number>;
  metadata: {
    studioVersion: string;
    platform: "darwin" | "windows" | "linux";
    arch: "x64" | "arm64";
  };
}
```

Do not widen `RuntimeUsefulnessEvent` to add `studio_telemetry`, and do
not add `grade: "info"` to the usefulness grade enum. If a future roadmap
decides Studio telemetry should feed Roadmap 8.1 directly, that contract
change must happen in its own migration.

Anonymization rules enforced before send:

- strip any `path`, `filePath`, `projectId`, `requestId`
- strip any tool input/output payloads
- only ship `kind`, `family`, `reasonCodes`, `metadata`, durations, and
  counts
- new events that violate the rule are rejected at the flush step with
  a debug-pane warning

### Endpoint

First cut: no endpoint. The flush task is a no-op until a hosted
endpoint is decided. Local capture still runs only for consenting users,
and Studio reads it through a Studio-owned diagnostics surface rather
than `runtime_telemetry_report`.

A real endpoint is its own decision (cost, hosting, privacy review). It
ships in a Studio 5.x follow-up if at all.

## Bridge Additions

```ts
// added to StudioBridge in apps/studio/src/bridge.ts
export interface StudioBridgeUpdater {
  checkForUpdate(): Promise<{
    available: boolean;
    version?: string;
    notes?: string;
    pubDate?: string;
  }>;
  applyUpdate(): Promise<void>; // downloads, verifies, prompts restart
  getChannel(): Promise<"stable" | "nightly">;
  setChannel(channel: "stable" | "nightly"): Promise<void>;
}

export interface StudioBridgeTelemetry {
  getConsent(): Promise<boolean>;
  setConsent(consent: boolean): Promise<void>;
  captureEvent(event: StudioTelemetryEvent): Promise<void>;
  listLocalEvents(filter?: {
    family?: string;
    since?: string;
    limit?: number;
  }): Promise<StudioTelemetryEvent[]>;
}
```

## Done When

- a fixture release is published to a test GitHub Releases page; the
  shell detects the update, shows the prompt, applies it, and restarts
  with the active project preserved
- signature verification rejects a tampered binary in CI
- mutating one byte of a fixture update payload causes updater rejection
- channel switching from stable → nightly fetches the nightly
  manifest within 5 minutes
- stable builds reject nightly manifests and nightly builds reject stable
  manifests unless the user has explicitly selected that channel
- first launch on a clean install shows the telemetry consent dialog
  before the dashboard loads
- declining telemetry results in zero `studio_events` rows written
- accepting telemetry writes local `studio_events` rows but the flush
  endpoint is a no-op
  (until a real endpoint is decided)
- "About" panel shows correct version + channel + last update check
- migration creates the append-only local `studio_events` table without
  widening `mako_usefulness_events`
- CHANGELOG entry under `## [Unreleased]`
- roadmap status updated

## Verification

Smokes:

- new `studio-updater-manifest.ts`: serves a fake manifest, verifies
  the shell consumes it correctly
- new `studio-updater-signature-fail.ts`: serves a manifest with a bad
  signature, verifies rejection
- new `studio-telemetry-consent.ts`: verifies decline + accept paths
- new `studio-telemetry-anonymization.ts`: feeds events with PII-like
  fields, verifies they are stripped before send
- new `studio-updater-channel-separation.ts`: verifies stable/nightly
  manifest selection and rejection rules

General checks:

- `corepack pnpm run typecheck`
- existing telemetry smokes continue to pass
- new Studio event-table migration shipped and reversible

## Risks And Watchouts

- **Downgrade flow.** If the user manually installs an older version
  while a newer one is on disk, the updater could fight them. Pin
  channel from the installed bundle's metadata, not from the
  manifest's `version` field, so the user's choice wins.
- **Update during in-flight refresh.** Applying an update while
  `project_index_refresh` is running could corrupt the project DB. The
  shell must wait for any in-flight refresh to finish before
  restarting (mirror Initial Testing Phase 4 watcher shutdown).
- **Telemetry definition drift.** Adding telemetry data points after
  consent was given is a privacy regression. Whenever a new telemetry
  field is added, surface a one-time "telemetry contents updated"
  notice to consenting users.
- **Usefulness telemetry confusion.** Studio UI telemetry is product
  diagnostics, not `RuntimeUsefulnessEvent`. Do not add fake usefulness
  grades or new decision kinds to `mako_usefulness_events` from this
  phase.
- **Update signature key rotation.** The Tauri updater's public key is
  baked into the signed binary. Rotating it requires a build that
  trusts both old and new keys for one release cycle. Document this in
  the release runbook.
- **Stale local manifest cache.** Tauri caches the manifest URL
  response. A failed release that ships a broken manifest must be
  recoverable by users without manual cache deletion. Add a "Force
  re-check" affordance in the update settings panel.
- **GitHub Releases rate limits.** Anonymous downloads from GitHub
  Releases have rate limits. The manifest URL hits the limit before
  the binary URL. Cache manifest aggressively (1 hour) and degrade to
  the cached version on rate-limit responses.
- **Notarization staple bypass.** macOS Gatekeeper checks the
  notarization staple. If the updater swaps a signed-but-unstapled
  binary in, Gatekeeper blocks the next launch. Always staple before
  publishing.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- [./studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
- Tauri updater: https://tauri.app/plugin/updater/
- `packages/store/src/project-store-runtime-telemetry.ts`
