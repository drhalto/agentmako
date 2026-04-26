# Roadmap Version 8 Handoff

This file is the execution handoff for the Roadmap 8 build cycle.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-6/roadmap.md](../version-6/roadmap.md)
- [../version-7/roadmap.md](../version-7/roadmap.md)
- [../version-7/handoff.md](../version-7/handoff.md)

## Roadmap Intent

Roadmap 8 is the `ML, Learning, And Advanced Optimization` roadmap.

Its purpose is to turn accumulated structured history into measurable
improvements to ranking, routing, promotion / rollout, and failure
triage — while preserving every deterministic guarantee the product
already ships.

The target outcome is:

- persisted runtime usefulness telemetry from interactive flows
- operator-tunable thresholds sourced from observed history
- bounded learned deltas over deterministic baselines with automatic
  rollback on regression
- failure clusters that help humans triage, not auto-fix
- an honest per-surface exposure closeout

## Mandatory Entry Assumptions

Treat these as already solved:

- packet, artifact, workflow, and trust contracts
- `evaluateArtifactUsefulness` / `evaluatePowerWorkflowUsefulness` /
  `evaluateWorkflowPacketUsefulness` grading logic
- deterministic ranking and routing — they stay authoritative
- R7.5 exposure state machine and its static first-slice thresholds

Do not reopen those just because learned behavior would be easier if the
lower layers changed.

## Natural Pause

Roadmap 8 is a two-stage roadmap by design:

- **Stage 1 (8.0, 8.1):** ships immediately. Plumbing work that does not
  need training data. Capture telemetry, expose inspection tools, change
  no behavior.
- **Stage 2 (8.2–8.6):** opens only after real usage has accumulated
  meaningful telemetry. Training on synthetic or smoke-only data
  produces a model that overfits to the test suite and tells us nothing
  about real usage.

Do not attempt to pre-build 8.2–8.6 against fixture data. The pause is
part of the plan, not a slip.

## Working Rules

1. **Persist at the decision site.**
   - Capture usefulness / ranking / routing decisions where the typed
     output still exists
     (`packages/tools/src/trust/enrich-answer-result.ts`, artifact tool
     handlers, workflow generators, attachment-policy callers).
   - `tool_runs` stores summaries, not typed evaluations — do not try to
     reconstruct usefulness from summaries alone.

2. **Reuse the shipped evaluators.**
   - `evaluateArtifactUsefulness`, `evaluatePowerWorkflowUsefulness`,
     `evaluateWorkflowPacketUsefulness` already define grades and reason codes.
   - Runtime capture should reuse those, not invent parallel grading.

3. **Baseline + delta, never replace.**
   - Every learned output declares the deterministic baseline it came
     from and the bounded delta it applied.
   - Rollback to baseline must be a single toggle, not a code change.

4. **Hard guards stay absolute.**
   - Blocked tools stay blocked. Trust de-emphasis stays authoritative.
   - Learned logic never invents new tool families, never reinstates
     `not_promoted` families, never overrides a safety rule.

5. **Bounded deltas, explicit caps.**
   - Learned reordering can move a result N positions, not arbitrary.
   - Learned threshold changes can drift M percentage points per
     rollout window, not unbounded.
   - Write the caps into the contract, not the implementation.

6. **No second planner.**
   - Roadmap 8 must not add a planning layer beside `ask`, packet
     handoff, or `investigate`. Learned logic sits under those, not
     beside them.

7. **BYOK / local-first carries forward.**
   - Telemetry persists locally. No remote training endpoint. No shared
     model keys. If the ML ceiling ever rises to real models, they ship
     as local artifacts, never as a hosted service.

8. **Close Roadmap 8 at `8.6`.**
   - `8.6` should grade learned surfaces and decide exposure. Do not
     open a post-`8.6` extension unless a genuinely separate packaging
     problem appears — the same rule that governed R7's close.

## Research-Derived Guidance

Read these references before writing the equivalent mako code:

- `codex-rs/features/src/lib.rs:1-220` — staged-rollout registry + CLI
- `codex-rs/network-proxy/src/network_policy.rs:229-256` — decision
  audit envelope (`decision / source / reason / override`)
- `cody-public-snapshot-main/vscode/src/completions/analytics-logger.ts:1-420`
  — opaque-ID lifecycle capture pattern
- `continue-main/core/data/devdataSqlite.ts:46-75` — append-only
  aggregate SQL
- `deepeval-main/docs/guides/guides-answer-correctness-metric.mdx:214-228`
  — percentile threshold calibration
- `cody-public-snapshot-main/vscode/src/services/utils/enrollment-event.ts`
  — treatment / control enrollment gate

Do not clone these verbatim. Translate the pattern to mako idioms — typed
contracts in `@mako-ai/contracts`, implementation in `@mako-ai/tools` or
accessor modules in `@mako-ai/store`.

## What To Avoid

- no remote telemetry shipping, no shared training endpoint
- no ML dependency added without a named eval regression it prevents
- no opaque model-file artifacts inside the npm surface at start
- no daemon / background worker as a core requirement
- no learned override of a safety rule or denied tool
- no over-committing to 8.2–8.6 shape before real telemetry exists
- no second planner beside `ask` / handoff / `investigate`

## Verification Posture

Each phase should leave behind:

- typed contract coverage
- focused telemetry / decision-envelope smokes
- at least one realistic usefulness or replay check
- doc updates when contract shape or exposure posture changes

Concrete first-slice defaults to keep reviews honest:

- `8.0` ships docs + contracts; no runtime behavior; no write paths
- `8.1` ships write paths + an inspection tool; no ranking / routing
  changes, no exposure changes
- every later-phase PR must cite a specific regression guard
  (eval suite name + expected delta floor) or it is not ready

## Expected Completion State

Roadmap 8 is complete when:

- every interactive decision site emits typed runtime telemetry
- operator-tunable, telemetry-backed thresholds replace the 7.5 static
  ones
- at least one learned ranking / routing surface ships with a bounded
  delta, decision envelope, and proven non-regression
- failure clustering surfaces recurring reason-code patterns operators
  can act on
- every learned surface has an exposure decision
  (`default / opt_in / dark / not_promoted`) with an explicit rollback
  reason for anything demoted

At that point, the next roadmap direction should come from what R8's
telemetry and clustering actually reveal.

## Current Status

- Roadmap 7 is complete.
- Roadmap 8 is opened.
- `8.0` is shipped (docs + typed runtime telemetry contract in
  `packages/contracts/src/runtime-telemetry.ts`; no runtime callers).
- `8.1` is shipped (storage substrate + runtime capture at every
  gradeable decision site + `runtime_telemetry_report` inspection
  tool + `agentmako telemetry show` CLI). Interactive answer / tool /
  artifact calls now persist `RuntimeUsefulnessEvent` rows to
  `mako_usefulness_events`. No ranking / routing / exposure behavior
  changed.
- **`8.2`–`8.6` are paused.** First-deployment use of mako on real
  projects surfaced gaps that must close before further R8 work
  begins. See
  [../version-initial-testing/README.md](../version-initial-testing/README.md).
  The pause is not a slip — it is the natural accumulation window R8.2
  needs, and it runs in parallel with gap-closing work that feeds
  R8.1 telemetry.
- Unpause conditions:
  1. Initial Testing roadmap closes its active phases, OR
  2. R8.1 telemetry shows enough meaningful signal (several hundred
     real events per family) that 8.2 read models would produce
     non-overfit priors.
  Either gate alone is sufficient.
