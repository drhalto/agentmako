# Mako Studio Phases

These are the phase specs for the Mako Studio roadmap.

Repository status as of 2026-04-25:

- `main` contains these Studio phase specs only.
- The Studio implementation branch is `reef/studio`; it contains the
  Tauri shell, Studio bridge/runtime, installer packaging, and
  Studio-specific dashboard work.
- Reef Engine 1-6 is shipped on `main` at commit `8196476`, so future
  Studio phases should consume Reef as an available substrate.

Read in this order:

1. [studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
2. [studio-2-project-state-visualization.md](./studio-2-project-state-visualization.md)
3. [studio-3-operator-actions-surface.md](./studio-3-operator-actions-surface.md)
4. [studio-4-multi-project-workspace.md](./studio-4-multi-project-workspace.md)
5. [studio-5-auto-update-and-telemetry.md](./studio-5-auto-update-and-telemetry.md)
6. [studio-6-rule-pack-surface.md](./studio-6-rule-pack-surface.md)

Current state:

- `Studio 1` - planned. Tauri 2 shell foundation with managed services,
  Studio bootstrap/auth, static-dashboard routing, and signed
  cross-platform artifacts.
- `Studio 2` - planned. Surface Reef facts/findings and freshness in the
  dashboard. Depends on Reef 1.
- `Studio 3` - planned. In-shell operator actions for refresh, ack /
  suppress, precommit, and run inspection, with Studio-owned audit events.
- `Studio 4` - planned. Multi-project workspace with project bar and
  switcher.
- `Studio 5` - planned. Auto-update via GitHub Releases and opt-in
  Studio telemetry in a separate local event stream.
- `Studio 6` - planned. Rule pack browser. Depends on Reef 1 rule
  identity/fingerprints and Reef 5 public rule descriptors.

The sequence is conservative. Studio 1 must ship a working signed
desktop launch before any other phase starts. Studio 2 and Studio 6
gate on specific Reef phases shipping.
