# Phase 7.5 Usefulness Evaluation And Default Exposure

Status: `Shipped`

## Goal

Close Roadmap 7 by proving the new artifact families and wrapper surfaces are
helpful enough to matter in normal usage.

## Rules

- evaluate usefulness and noise, not just schema validity
- do not auto-promote weak artifacts or wrappers just because they exist
- keep human-tuned policy in this roadmap; learned rollout stays out
- reuse the strongest Roadmap 5 and 6 evaluation posture where it fits
- require explicit fallback states for integrations that do not earn broader
  exposure
- do not add a `7.6` closeout phase unless a genuinely separate packaging
  problem appears

## Required Coverage

By the end of this phase, every Roadmap 7 public artifact or wrapper family
should have:

- typed contract coverage
- focused artifact smokes
- at least one realistic usefulness check
- an explicit exposure decision
- an explicit fallback state when it is not default

## Pre-Eval Contract Reconciliation

Two scope gaps carried over from 7.0–7.2 must be resolved before usefulness
evaluation can be honest. Close each one (wire it up) or amend the contract /
disambiguation table (admit it was not shipped). Leaving them unresolved makes
reason codes like `missing_basis_ref` incoherent and lets `review_bundle`
eval grade against a basis the artifact never receives.

1. **Unused basis kinds in `ARTIFACT_BASIS_KINDS`.**
   - `packages/contracts/src/artifacts.ts` declares `trust_run`,
     `trust_evaluation`, and `workflow_followup` as valid
     `ArtifactBasisKind` values
   - no generator in `packages/tools/src/artifacts/` emits a basis ref of
     any of those three kinds
   - 7.5 decision: either have at least one family emit each kind (trust
     state and follow-ups are natural for `review_bundle` /
     `implementation_handoff`) or remove the unused kinds from the
     contract. Do not ship 7.5 with the contract advertising basis kinds
     the generators never produce.

2. **`review_bundle` basis drift vs. the 7.0 disambiguation table.**
   - 7.0 (`phase-7.0-artifact-contract-and-basis-model.md`) lists
     `review_bundle` primary basis as
     `change_plan + impact_packet + diagnostics`
   - 7.2 shipped `review_bundle` composing
     `implementation_brief + change_plan + flow_map? + tenant_leak_audit?`
   - neither `impact_packet` nor `diagnostics` (rule-pack / SARIF findings
     from R4) are wired in
   - 7.5 decision: either add `impact_packet` and diagnostics as real
     basis inputs in the `review_bundle` generator, or amend the 7.0
     disambiguation-table row to reflect what actually shipped. Whichever
     path, the `review_bundle` usefulness eval and exposure decision must
     grade the real basis, not the advertised one.

Both resolutions land in this phase so eval results reflect the contract as
shipped, not as imagined.

## Usefulness Evaluation Shape

Reuse the Roadmap 6 usefulness shape — do not invent a parallel grading
system. Concretely:

- artifact usefulness grades are `full` / `partial` / `no`, same as
  `PowerWorkflowUsefulnessEvaluation`
- reason codes live per-family and are emitted from the typed basis (for
  example, `missing_basis_ref`, `stale_basis_ref`, `no_diagnostic_signal`)
- promotion thresholds mirror the Roadmap 6 `OPT_IN_THRESHOLDS` /
  `GRAPH_DEFAULT_THRESHOLDS` pattern — numbers may differ, but the shape is
  the same table-per-family exposure policy
- artifact and wrapper families evaluate independently; one useful artifact
  does not earn exposure for a wrapper around it

## Dismount Rule

Code costs accrue even when exposure is hidden. If a wrapper or artifact
family fails its usefulness check and lands at `dark` or `not_promoted`:

- it is removed on the next phase unless a concrete reason to keep it is
  recorded in the phase doc
- `not_promoted` is a terminal state, not a park-forever state
- `dark` may persist only when the family is a known safety-gated surface
  (for example, tenancy / audit) that should stay callable but hidden

## Exposure And Rollout

This phase should decide exposure per family, for example:

- `default`
- `opt_in`
- `dark`
- `not_promoted`

Artifact generation and wrapper/export surfaces should be evaluated
independently. A useful artifact does not automatically mean every wrapper
around it deserves broad exposure.

## Success Criteria

- every shipped Roadmap 7 artifact family has real or realistic eval coverage
- every shipped Roadmap 7 wrapper family has an explicit exposure state
- every `not_promoted` family is either removed or carries a documented
  reason to keep
- Roadmap 8 can start from artifact and wrapper families that already proved
  useful enough to keep

## Reconciliation Outcomes

Both pre-eval gaps closed (not amended):

1. **Unused basis kinds closed.**
   - `trust_run` / `trust_evaluation` now emit from `verification_bundle`
     when the tool layer (or explicit input) supplies a traceId. Resolution
     order: explicit `input.traceId` → `sessionHandoff.currentFocus.traceId`
     → `issuesNext.currentIssue.traceId`. Both basis refs emit together or
     not at all; the payload carries a typed `trustState` snapshot.
   - `workflow_followup` now emits from `implementation_handoff` as a
     single aggregate basis ref over the `N` most recent
     `projectStore.queryWorkflowFollowups` results (default `N=3`, capped
     at 32). Payload surfaces them as typed `priorFollowups` entries.
   - new `buildTrustRunBasisRef`, `buildTrustEvaluationBasisRef`, and
     `buildWorkflowFollowupBasisRef` helpers in
     `packages/tools/src/artifacts/index.ts`.

2. **`review_bundle` basis drift closed.**
   - `impact_packet` is now fetched alongside `implementation_brief` in
     `reviewBundleArtifactTool` (caller opt-out via `includeImpactPacket:
     false`); the generator emits a `workflow_packet` basis ref and
     projects impact-zone entries into the payload.
   - diagnostics (rule-pack + alignment diagnostics from R4) now run
     scoped to `change_plan.directSurfaces + dependentSurfaces` via a new
     `collectDiagnosticsForFiles` helper in
     `packages/tools/src/diagnostics/index.ts` (extracted from the
     existing `collectAnswerDiagnostics` so both paths share the engine).
     Generator emits a `workflow_result`-kind basis ref labeled
     `diagnostics` and projects findings into the payload.

The 7.0 disambiguation-table row for `review_bundle` now matches what
ships. No amend was needed.

## Artifact Exposure Policy Table

Initial policy lives in
`packages/tools/src/artifact-evaluation.ts` and maps exactly to the table
below. Thresholds are conservative first-slice picks —
`ARTIFACT_DEFAULT_THRESHOLDS` (`minHelpedRate 0.75`, `minNoNoiseRate 0.75`)
for default-target families, `ARTIFACT_OPT_IN_THRESHOLDS` (`0.5` / `0.5`)
for opt-in-target families. Tune against real eval data in a later phase
rather than in this closeout.

| Family                   | Target     | Fallback       | Thresholds | Rationale                                                                          |
| ------------------------ | ---------- | -------------- | ---------- | ---------------------------------------------------------------------------------- |
| `task_preflight`         | `default`  | `opt_in`       | default    | Low-risk composition of shipped packets + change_plan + verification_plan.         |
| `implementation_handoff` | `opt_in`   | `dark`         | opt_in     | Best at explicit session boundaries; needs proven continuation value.              |
| `review_bundle`          | `default`  | `opt_in`       | default    | After 7.5 close, strictly stronger than raw impact_packet + diagnostics calls.     |
| `verification_bundle`    | `opt_in`   | `dark`         | opt_in     | Reviewer-facing + now trust-aware; opt-in until trust + stop conditions gate cleanly. |

## Wrapper Exposure Policy Table

| Family        | Target    | Fallback         | Thresholds | Rationale                                                                      |
| ------------- | --------- | ---------------- | ---------- | ------------------------------------------------------------------------------ |
| `tool_plane`  | `default` | `opt_in`         | default    | Canonical delivery surface; default when artifact tools return schema-valid, basis-complete results. |
| `file_export` | `opt_in`  | `not_promoted`   | opt_in     | 7.4's only shipped wrapper; opt-in unless eval data shows low-noise writes on real usage. |

Editor / CI / hooks stay **deferred** per the 7.4 decision "fewer
high-value wrappers beats broader wrapper coverage." Nothing in the 7.5
eval surfaced a named friction that justifies shipping them; they remain
post-roadmap candidates only, gated on concrete daily-usage pain.

## Current Shipped Slice

- **Contract**: `packages/contracts/src/artifact-evaluation.ts` defines
  `ArtifactUsefulnessGrade`, `ArtifactUsefulnessReasonCode`,
  `ArtifactUsefulnessEvaluation`, `ArtifactPromotionMetrics`,
  `ArtifactPromotionThresholds`, `ArtifactExposureState`,
  `ArtifactExposureDecision`, plus `ArtifactWrapperFamily` (`tool_plane`,
  `file_export`) and the wrapper-level parallels. Grades and codes mirror
  the Roadmap 6 `PowerWorkflowUsefulnessEvaluation` shape exactly.
- **Evaluator**: `packages/tools/src/artifact-evaluation.ts` implements
  `evaluateArtifactUsefulness`, `summarizeArtifactPromotionMetrics`,
  `shouldPromoteArtifactExposure`, `decideArtifactExposure`,
  `evaluateArtifactWrapperUsefulness`,
  `summarizeArtifactWrapperPromotionMetrics`, and
  `decideArtifactWrapperExposure`. Per-family scoring lives in
  `scoreTaskPreflight` / `scoreImplementationHandoff` /
  `scoreReviewBundle` / `scoreVerificationBundle` — each picks from the
  shared reason-code enum and contributes to a `score` summed against the
  Roadmap 6 grade table (`full` ≥ 3 or (≥ 2 AND observed follow-up);
  `partial` ≥ 1; else `no`). Each evaluation carries a short human
  `reason` string alongside the codes (borrowed from the `deepeval`
  `BaseMetric { reason, success }` idiom).
- **Runner wireup**: `packages/tools/src/evals/runner.ts` now collects
  `ArtifactUsefulnessEvaluation[]` via `extractArtifactFromToolOutput`
  whenever a case runs one of the four artifact tools. Summaries attach
  to `TrustEvalRunSummary.artifactUsefulness` alongside
  `powerWorkflowUsefulness`, matching the R4 benchmark-table reuse
  pattern.
- **Smoke coverage**: `test/smoke/artifact-usefulness-evaluation.ts`
  exercises grading for all four artifact families (full-grade and
  degraded paths), confirms basis-close reason codes (`impact_zones`,
  `diagnostic_findings`, `trust_state`, `prior_followups`) only emit
  when the respective closes are wired, and exercises wrapper eval for
  `tool_plane` (delivered / failed) and `file_export`
  (succeeded / rejected). Extended `test/smoke/artifact-generators.ts`
  also asserts the close-path basis kinds land on real artifacts. Both
  are registered in `test:smoke`.
- **Dismount outcome**: under the focused realistic smoke, every shipped
  family resolves to its target exposure (no family landed at
  `not_promoted` or `dark`). No families are removed in this closeout.
  Thresholds are permissive by design — operators should raise them in
  Roadmap 8 before relying on broader rollout decisions.
- **Deferred wrappers (editor / CI / hooks)**: stay deferred. No
  concrete friction surfaced in this eval cycle that justifies shipping
  them. Revisit only if a named daily-usage pain appears in Roadmap 8.
