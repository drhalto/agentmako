# Roadmap Version 8

**Status:** PAUSED (Phase 8.2+) — initial-testing hardening in
[`../version-initial-testing/`](../version-initial-testing/) is active.

**Upstream Baseline:** Roadmap 7 complete

**Primary Goal:** use accumulated structured history to improve ranking,
routing, promotion / rollout, and failure triage — without breaking the
deterministic backbone or shipping opaque model training.

## Pause Notice

Phases 8.0 (docs + contract) and 8.1 (runtime capture + inspection)
shipped. Phase 8.2+ is paused while the Initial Testing roadmap closes
real-world gaps that emerged from putting mako to use on `courseconnect`
and `forgebench`. The pause is intentional — 8.2+ depends on meaningful
R8.1 telemetry from real use, which accumulates faster once deployment
friction is addressed. See
[../version-initial-testing/README.md](../version-initial-testing/README.md).

The 8.1 telemetry pipeline keeps running through the pause; fixes shipped
in the Initial Testing roadmap emit `RuntimeUsefulnessEvent` rows where
that signal is useful to 8.5 failure clustering later.

## Purpose

This folder is the canonical roadmap package for Roadmap 8 of `mako-ai`.

Roadmap 8 is the `ML, Learning, And Advanced Optimization` roadmap.

It is not:

- a rebuild of the usefulness evaluators shipped in R6 / R7.5
- a rewrite of trust, packet, artifact, or workflow contracts
- a training harness or model-hosting roadmap
- a place to reopen exposure policy for the artifact / wrapper / workflow
  families decided in 7.5

It is the roadmap that should make `mako-ai` stronger at:

- turning live usage into persisted, typed usefulness history
- replacing static promotion thresholds with operator-tunable,
  telemetry-backed ones
- applying bounded learned deltas to ranking and routing without
  overriding trust safety rules
- clustering repeated failure reason codes so operators can triage real
  patterns instead of one-off incidents
- closing with an honest exposure decision per learned surface

## Starting Point

Roadmap 8 starts from shipped substrate, not from scratch:

- Roadmap 5 shipped typed workflow packets, packet handoff, and
  follow-up tracking.
- Roadmap 6 shipped `powerWorkflowUsefulness` grading plus exposure
  thresholds.
- Roadmap 7 shipped `artifactUsefulness` grading plus exposure thresholds
  and closed with conservative static policy in
  `packages/tools/src/artifact-evaluation.ts`.

The missing piece is that `evaluateArtifactUsefulness` /
`evaluatePowerWorkflowUsefulness` / `evaluateWorkflowPacketUsefulness` run only
inside `packages/tools/src/evals/runner.ts`. Interactive runtime flows
never persist the same typed usefulness signals. Roadmap 8 closes that
gap first, then uses the resulting history to drive bounded learned
behavior.

## Natural Pause

Roadmap 8 is a two-stage roadmap by design. Phases 8.0 and 8.1 can ship
immediately because they are plumbing, not learning. Phases 8.2–8.6 are
gated on accumulated production history — running them on synthetic or
smoke-only data would overfit to tests and tell us nothing about real
usage. Expect a real dogfood / usage window between 8.1 and 8.2.

## Package Contents

- [roadmap.md](./roadmap.md) — canonical roadmap contract and phase sequence
- [handoff.md](./handoff.md) — execution assumptions and working rules
- [phases/README.md](./phases/README.md) — phase index

## Rules

- deterministic systems remain the source of truth
- learned deltas are bounded and feature-flagged
- every learned decision emits `{ baseline, learned_delta, final_decision,
  rollback_reason? }`
- no learned policy may override trust safety rules or unblock denied
  tools
- no daemon / background worker is required for the core path
- no second planner beside `ask`, packet handoff, or `investigate`
- promotion requires explicit rollback discipline; demotion is automatic
  on regression
- telemetry accrues locally and ships nowhere by default — the BYOK /
  local-first rule from R3 carries forward
