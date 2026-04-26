# Roadmap Version 6

**Status:** COMPLETE

**Upstream Baseline:** Roadmap 5 complete, including the `5.6` closeout

**Primary Goal:** make `mako-ai` materially more powerful through a small set of
high-leverage, typed workflows

## Purpose

This folder is the canonical roadmap package for Roadmap 6 of `mako-ai`.

Roadmap 6 is the `Power Workflows And Operational Intelligence` roadmap.

It is not:

- the generated-artifact roadmap
- the ML / learning roadmap
- a scheduler / daemon roadmap
- permission to recreate Fenrir's 134-tool sprawl

It is the roadmap that should make `mako-ai` stronger at:

- “how does this connect to that?”
- “show me the actual end-to-end flow”
- “where are the tenant/auth gaps?”
- “what should I work on next across this project?”
- “run a bounded investigation over the existing tools and tell me what matters”

This package now assumes four explicit boundary rules before implementation
starts:

- graph edges must declare exact vs heuristic status
- `change_plan` must not duplicate Roadmap 5 packets
- `tenant_leak_audit` must define its tenant-boundary model up front
- project queue surfaces are derived-first, not secretly mutable by default

## Starting Point

Roadmap 6 starts from shipped substrate, not from scratch:

- Roadmaps 1-4 delivered the deterministic tool, harness, trust, and eval spine
- Roadmap 5 delivered:
  - typed workflow context
  - workflow packets
  - packet surfaces
  - default-path packet attachment
  - handoff-driven next actions
  - execution-ready workflow actions
  - follow-up tracking

That means Roadmap 6 should not keep expanding packet plumbing. It should use
that substrate to ship a small number of powerful workflows.

Current progress:

- `6.0` is complete:
  - shared graph contracts are landed
  - the first derived exact edge slice is landed
- `6.1` is complete:
  - `graph_neighbors` and `graph_path` are landed as public typed tools
  - rooted traversal/filtering now exists at the tool layer
  - `calls_rpc` is emitted as the first heuristic graph edge
- `6.2` is complete:
  - `flow_map` and `change_plan` are landed as public typed tools
  - `flow_map` turns one graph path into ordered steps, transitions, and major
    boundaries
  - `change_plan` stays graph-derived by combining direct path surfaces with
    one-hop dependent surfaces and explicit step ordering
- `6.3` is complete:
  - `tenant_leak_audit` is landed as an advisory / opt-in operator tool
  - first slice is limited to tenant-keyed tables, RLS posture, protected-table
    RPC touch points, and indexed route/file RPC usage sites
- `6.4` is complete:
  - `session_handoff` is landed as the derived project-level handoff surface
  - `health_trend` is landed as the derived recent-window trend surface
  - `issues_next` is landed as the derived queue-oriented “what next?” surface
  - `issues_next` is a recommendation surface, not a mutable task board
  - its first-slice ranking keeps a small completion bias for unresolved traces
    that already have recorded follow-up momentum
  - all three share the same recent-trace window contract:
    - default `8`
    - max `32`
- `6.6` is complete:
  - shared workflow usefulness and exposure helpers are landed
  - explicit exposure states and fallback states are now assigned for every
    shipped Roadmap 6 public workflow
  - the shared eval runner now reports Roadmap 6 power-workflow usefulness
    alongside the existing workflow-packet usefulness surface
- `6.5` is complete:
  - `suggest` is landed as a bounded recommendation surface
  - `investigate` is landed as a bounded read-only execution surface
  - both prefer shipped graph / operator / project-intelligence workflows
    before falling back to one ask-routed canonical tool
- no implementation phase remains in Roadmap 6
- post-close cleanup is also landed:
  - several internal god files were split into thinner facades plus focused
    helper modules
  - this cleanup did not change Roadmap 6 scope or add new public workflows
  - it was a behavior-preserving maintainability pass after `6.6`, not a new
    roadmap phase

## Package Contents

- [roadmap.md](./roadmap.md) — canonical roadmap contract and phase sequence
- [handoff.md](./handoff.md) — execution assumptions and working rules
- [phases/README.md](./phases/README.md) — phase index

## Rules

- one canonical tool per question shape
- typed outputs over decorative text blobs
- compose existing named tools before inventing new primitives
- local project evidence stays primary
- external reference research stays optional and source-labeled
- no ML or self-modifying policy in this roadmap
- generated artifacts remain out of scope for this roadmap
- no second planner that overlaps `ask` or packet handoff
- no extra closeout phase by default if `6.6` can carry the evaluation and
  exposure work cleanly
- internal refactors after `6.6` should stay behavior-preserving and should not
  be presented as new roadmap scope
