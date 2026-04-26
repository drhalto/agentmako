# Roadmap Version Initial Testing

This file is the canonical roadmap for the Initial Testing build cycle.

If another doc in this package disagrees with this file about what the
roadmap is for, what phases it contains, or what counts as done, this
roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-8/roadmap.md](../version-8/roadmap.md)
- [../version-8/handoff.md](../version-8/handoff.md)

## Roadmap Contract

This is the `Initial Testing Hardening` roadmap.

Its job is to close the gaps that actually using mako on real projects
surfaced — fixes that earlier phases could not have produced because
the pain was not visible until deployment.

It should make `mako-ai` better at:

- surviving the "paste a Supabase URL into a Windows terminal" kind of
  edge case that never shows up in smoke tests
- giving operators first-class ways to correct mako's own false signals
  so the system compounds instead of flooding them with the same noise
  on every re-run
- turning early real-use friction into durable improvements without
  ballooning scope

It does **not**:

- replace Roadmap 8's telemetry / learning agenda
- re-open lower-layer R4 / R5 / R6 / R7 contracts without a concrete
  deployment incident showing they are wrong
- chase hypothetical pain — every phase must cite the triggering
  observation

## Entry Assumptions

Roadmap Initial Testing begins with these already shipped:

- every primitive, composer, artifact, graph, operator, and
  project-intelligence surface from Roadmaps 1–7
- R8 Phase 8.0 contract (`RuntimeUsefulnessEvent` etc.)
- R8 Phase 8.1 capture + inspection pipeline
- stdio MCP transport
- the `@inquirer/password` prompt fix
- Supabase pooler documentation

That means each phase here composes on top of shipped substrate; it does
not rebuild it.

## Roadmap Rules

1. Each phase cites the deployment observation that motivated it in its
   phase doc. No observation → no phase.
2. Each phase is narrow and ships as independently verifiable slices.
3. Phases may emit `RuntimeUsefulnessEvent` rows through the R8.1
   pipeline where the signal is useful to future R8 read models. This
   is additive, not load-bearing.
4. No new roadmap tier is opened here. If a phase's scope grows into
   genuine architectural work, split it into its own roadmap folder
   or a Roadmap 8 phase — not a sprawling Initial Testing phase.
5. Phases are numbered sequentially (`Phase 1`, `Phase 2`, ...) in
   ship order, not in topic order.

## Evaluation Rule

Same posture as R6 / R7 / R8:

- typed contract coverage per phase
- focused smokes per slice
- at least one realistic usefulness check
- doc updates when contract shape or exposure posture changes

## Phase Sequence

1. `Phase 1` — Finding Acknowledgements
2. `Phase 2` — MCP Perf: Project Store Lifetime
3. `Phase 3` — Package-Backed Search And Parsing Hardening
4. `Phase 4` — Index Freshness And Auto-Refresh
5. `Phase 5` — Deterministic Context Packet And Hot Retrieval
   - `5a` — Context Packet And Hot Retrieval
   - `5b` — Risk, Instructions, And Path Refresh

Phases are added here as deployment surfaces new gaps. The sequence
should stay honest: if Phase N turns out to be wrong, a correction
phase is added, not an amendment.

## What Comes Next

Roadmap 8 Phase 8.2+ opens after:

- initial-testing phases have closed the highest-friction gaps, and
- R8.1 telemetry has accrued non-fixture signal from real use.

Neither gate is on a fixed schedule. The Initial Testing roadmap is the
active work surface until then.
