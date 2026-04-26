# Roadmap Version 8

This file is the canonical roadmap for the Roadmap 8 build cycle.

If another Roadmap 8 doc disagrees with this file about what the roadmap
is for, what phases it contains, or what counts as done, this roadmap
wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-6/roadmap.md](../version-6/roadmap.md)
- [../version-7/roadmap.md](../version-7/roadmap.md)
- [../version-7/handoff.md](../version-7/handoff.md)

## Roadmap Contract

Roadmap 8 is the `ML, Learning, And Advanced Optimization` roadmap.

Its job is to use accumulated structured history to make mako's ranking,
routing, promotion / rollout, and failure triage materially better —
without breaking the deterministic backbone and without shipping opaque
model training into the local-first product.

Roadmap 8 should make `mako-ai` better at:

- persisting usefulness signals from every interactive answer / tool /
  artifact call in the same typed shape the eval runner already computes
- deriving operator-tunable thresholds from observed history instead of
  hardcoding them
- applying bounded learned deltas to ranking and routing where
  deterministic policies already exist
- promoting and demoting artifact / wrapper / workflow exposure from
  real usage signals with explicit rollback
- naming and clustering the failure shapes that recur across sessions

Roadmap 8 does **not** rebuild:

- packet / artifact / workflow / trust contracts
- evaluation grading logic (`evaluateArtifactUsefulness`,
  `evaluatePowerWorkflowUsefulness`, `evaluateWorkflowPacketUsefulness`)
- existing deterministic ranking and routing — those stay authoritative;
  learned deltas sit above them
- the exposure state machine shipped in 7.5
  (`default / opt_in / dark / not_promoted`)

## Entry Assumptions

Roadmap 8 begins with all of these already shipped:

- typed workflow packets and packet handoff
- graph / operator / project-intelligence workflows
- bounded investigate / suggest
- artifact families (`task_preflight`, `implementation_handoff`,
  `review_bundle`, `verification_bundle`) plus `tool_plane` /
  `file_export` wrappers
- usefulness evaluators and exposure policy tables with conservative
  static thresholds
- trust runs, benchmark suites, and follow-up tracking in `project.db`
- `@mako-ai/contracts` and `@mako-ai/tools` structured to accept new
  telemetry types without shape breaks

That means the first Roadmap 8 phase should define the telemetry contract
and write paths against shipped grading logic, not invent new grading.

## Core Deliverables

Roadmap 8 should ship these families:

- a runtime telemetry contract that mirrors the eval runner's typed shape
- append-only runtime write paths at every decision site (answer, tool,
  artifact, workflow, attachment)
- derived read models (per-tool / per-query-kind / per-project /
  per-surface priors for helpfulness, no-noise, follow-up rate,
  contradiction rate, and staleness)
- bounded learned deltas for ranking and routing with feature-flagged
  rollout and `{ baseline, learned_delta, final_decision, rollback_reason }`
  envelopes
- telemetry-backed promotion thresholds replacing the static 7.5 values,
  plus an explicit demotion-on-regression path
- failure clustering over repeated reason codes
- a closeout phase that grades each learned surface and decides
  `default / opt_in / dark / not_promoted` the same way 7.5 did

Every learned surface should:

- declare its baseline deterministic policy explicitly
- emit a structured decision envelope
- be feature-flag gated with a named default stage
- have an automatic demotion trigger tied to eval regression
- leave behind focused smokes and a real usefulness check

## Research-Grounded Shape

Reference patterns this roadmap should draw from. Read these before
writing the equivalent mako code:

1. **Staged rollout registry.** `codex-rs/features/src/lib.rs` — `Feature`
   plus `Stage` enum (`UnderDevelopment / Experimental / Stable /
   Deprecated / Removed`), `FeatureSpec { id, key, stage, default_enabled }`
   registry, CLI `features {list, enable, disable}`. The 7.5
   `default / opt_in / dark / not_promoted` shape is already this pattern;
   the registry ergonomics scale it.

2. **Decision envelope with source + reason.**
   `codex-rs/network-proxy/src/network_policy.rs:229-256` — every policy
   decision emits `decision / source / reason / override`. Direct
   precedent for the `{ baseline, learned_delta, final_decision,
   rollback_reason }` shape.

3. **Lifecycle usefulness capture.**
   `cody-public-snapshot-main/vscode/src/completions/analytics-logger.ts`
   — opaque log IDs, a state machine over the decision lifecycle, safe
   vs private metadata split, LRU-cached in-memory state. Reference
   implementation for the 8.1 capture pattern.

4. **Append-only SQLite aggregates.**
   `continue-main/core/data/devdataSqlite.ts:46-75` — `INSERT` on write,
   `SELECT ... GROUP BY date(timestamp)` / `GROUP BY model` aggregates.
   Pattern for `mako_usefulness_events` and derived rollups.

5. **Percentile threshold calibration.**
   `deepeval-main/docs/guides/guides-answer-correctness-metric.mdx:214-228`
   — `calculate_threshold(scores, percentile)`. Pattern to replace 7.5's
   static `0.75 / 0.5` thresholds with telemetry-backed ones.

## Roadmap Rules

1. One telemetry contract per decision kind, not one per call site.
2. No learned policy may override trust safety rules, unblock denied
   tools, or reinstate a `not_promoted` family without re-evaluation.
3. Every learned decision carries its baseline and its rollback reason.
4. No ML library dependency added without a named eval regression it
   prevents — learned policy tables (weight vectors, regression over
   reason codes stored in sqlite) stay the ceiling unless data says
   otherwise.
5. No daemon / background worker required for the core path; scheduled
   aggregation jobs may run on demand or inside the harness event loop.
6. If a learned surface cannot be eval'd, it is not ready to ship.
7. Thresholds tuned against real production history, not smoke fixtures.
8. The natural pause after 8.1 is a feature, not a failure. 8.2+ do not
   open until enough real usage has been captured.

## Evaluation Rule

Roadmap 8 must reuse Roadmap 6 / 7 evaluation posture.

That means:

- add focused smokes for every new telemetry write path
- add at least one realistic usefulness check per learned surface
- evaluate whether a learned delta materially beats its baseline
- keep explicit rollback states for learned surfaces that do not earn
  broader exposure
- failure-cluster output must be testable against a fixture of reason
  codes

## Phase Sequence

1. `Phase 8.0` — docs and telemetry contract
2. `Phase 8.1` — live usefulness telemetry
3. `Phase 8.2` — learned read models
4. `Phase 8.3` — bounded learned ranking and routing
5. `Phase 8.4` — learned promotion, attachment, and rollout
6. `Phase 8.5` — failure clustering and optimization experiments
7. `Phase 8.6` — usefulness evaluation and default exposure (closeout)

## Phase Summary

### Phase 8.0 Docs And Telemetry Contract

Status: `Shipped`

Open Roadmap 8 with a clean documentation package and a typed runtime
telemetry contract that mirrors the shape the eval runner already
computes. Docs + contract types only — no runtime behavior change, no
write paths.

Should establish:

- the roadmap / handoff / README / phases package
- `RuntimeUsefulnessEvent`, `RuntimeRankingDecision`,
  `RuntimeRoutingDecision`, `LearnedDecisionEnvelope` typed contracts in
  `packages/contracts/src/runtime-telemetry.ts`
- decision-envelope shape `{ baseline, learned_delta, final_decision,
  rollback_reason? }` shared across 8.3 / 8.4

### Phase 8.1 Live Usefulness Telemetry

Status: `Shipped`

Persist append-only runtime telemetry rows from every interactive
answer / tool / artifact call, reusing the existing evaluators rather
than inventing new grading.

Should establish:

- `mako_usefulness_events` table (append-only, one row per eligible
  decision) and migration
- write-path adapters at every decision site
  (`packages/tools/src/trust/enrich-answer-result.ts`, artifact tool
  handlers, workflow composer outputs, packet attachment)
- inspection / report tool surface — read-only, for operators
- no behavior change in ranking / routing / exposure

Natural pause follows — see `Natural Pause` in
[README.md](./README.md#natural-pause).

### Phase 8.2 Learned Read Models

Status: `Gated on accumulated history`

Build derived aggregations over recent telemetry: per-tool /
per-query-kind / per-project / per-surface priors for helpfulness,
no-noise, follow-up rate, contradiction rate, and staleness. Reuse the
history windowing pattern already present in project-intelligence.

### Phase 8.3 Bounded Learned Ranking And Routing

Status: `Gated on 8.2`

Apply learned signals as bounded deltas to existing deterministic
policies. First targets: tool-search ranking, answer ranking tie-breaks,
packet-attachment routing. Hard guards stay absolute — blocked tools
stay blocked, trust de-emphasis stays authoritative, learned logic
cannot invent new tool families.

### Phase 8.4 Learned Promotion, Attachment, And Rollout

Status: `Gated on 8.2`

Replace R7.5's static promotion thresholds with telemetry-backed
percentile thresholds. Move companion-packet attachment
(`packages/tools/src/workflow-packets/attachment-policy.ts`) and R6 / R7
exposure decisions from fixed rules to telemetry-backed rules, keeping
policy caps and one-switch rollback. Every decision returns the shared
envelope.

### Phase 8.5 Failure Clustering And Optimization Experiments

Status: `Gated on 8.2`

Cluster repeated `missing_basis_ref`, `stale_basis_ref`,
`no_diagnostic_signal`, `contradicted`, `insufficient_evidence`, and
similar reason-code patterns. Expose an operator-facing report. Optionally
run dark retrieval / ranking experiments behind an experiment flag,
replay-only, never touching the default path.

### Phase 8.6 Usefulness Evaluation And Default Exposure

Status: `Planned (closeout)`

Close Roadmap 8 by grading each learned surface the same way 7.5 graded
artifact families. Each surface resolves to
`default / opt_in / dark / not_promoted` with an explicit rollback
reason for anything that did not earn its exposure. Roadmap 8 is done
when every learned surface has an exposure decision or a documented
removal.

## What Comes Next

Roadmap 8 is the last roadmap in the current master-plan sequence. After
it closes, the next major direction should come from what Roadmap 8's
failure-clustering and telemetry surface — not from a pre-written
Roadmap 9 scaffolding document.
