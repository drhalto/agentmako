# Phase 4.3 Contradiction And Drift Engine

Status: `Completed`

This file is the canonical planning doc for Roadmap 4 Phase 4.3. It interprets comparable answer history into explicit freshness, drift, and contradiction trust states.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [./phase-4.2-rerun-and-compare.md](./phase-4.2-rerun-and-compare.md) for the comparison substrate this phase depends on.

## Current Snapshot

The first 4.3 slice is now landed.

What shipped:

- migration `0022` adding:
  - `answer_trust_clusters`
  - `answer_trust_evaluations`
- trust-state and reason contracts in `packages/contracts/src/answer.ts`
- store persistence and query helpers for:
  - ensure cluster
  - fetch cluster by id
  - list clusters for a target
  - insert trust evaluation
  - fetch latest trust evaluation by trace
  - fetch latest trust evaluation by target
  - list trust evaluations for a target
- an `evaluateTrustState(...)` tool-service path in `packages/tools/src/trust/evaluate-trust-state.ts`
- read-oriented tool-service paths in `packages/tools/src/trust/read-trust-state.ts`:
  - `readTrustState(...)`
  - `listTrustStateHistory(...)`
  - both only backfill by evaluating when persisted trust-state records are still missing
- explicit first-pass state classification for:
  - `stable`
  - `changed`
  - `aging`
  - `stale`
  - `superseded`
  - `contradicted`
  - `insufficient_evidence`
- explicit TTL defaults in code:
  - `AGING_DAYS = 30`
  - `STALE_DAYS = 90`
- conservative contradiction rules:
  - only older strong runs can become `contradicted`
  - contradiction now also requires an explicit core-conflict signal in the comparison artifact, not just a same-scope meaningful diff
  - latest runs classify as `stable` / `changed` / `aging` / `stale` / `insufficient_evidence`
- migration `0023` adding persisted trust-evaluation relation metadata:
  - `basis_trace_ids_json`
  - `conflicting_facets_json`
  - `scope_relation`
- trust evaluations now persist:
  - basis trace ids
  - conflicting facet categories
  - scope relation (`none` / `same_scope` / `changed_scope` / `backtested_old_scope`)
- insufficiency rules are now stricter:
  - any `partial` evidence run stays `insufficient_evidence`, even when some evidence exists
  - off-topic `free_form` evidence can now classify as `insufficient_evidence` through explicit query/evidence mismatch detection
- focused regression coverage in `test/smoke/trust-state.ts`
- initial 4.1 eval-harness integration:
  - trust-state assertions now exist in the suite contract
  - the focused eval smoke proves latest-run and superseded-history assertions against real eval-created trust runs
- the focused eval smoke now proves a deterministic contradiction path through a seeded rerun fixture:
  - the mutation runs against the in-memory `replaceIndexSnapshot(...)` store, not the filesystem
  - the comparison layer now emits an explicit `core_claim_conflict` when strong evidence disappears and only fallback/no-structure support remains
  - scope comparison no longer treats index-run churn alone as a changed validity scope
- real ForgeBench trust-eval fixtures now cover `stable`, `aging`, `stale`, and `insufficient_evidence` through the normal 4.1 runner instead of only the synthetic trust-state smoke
- focused read-surface coverage in `test/smoke/trust-state.ts` now proves:
  - latest-run trust snapshots read without creating duplicate history once evaluations exist
  - trust history reads return evaluations, clusters, and comparisons together
  - missing trust-state records backfill on first read for a target that only has trust runs
  - generic same-scope evidence drift now lands as `superseded`, not `contradicted`
- deterministic rerun-driven `core_claim_conflict` history now lands as `contradicted`

What is still open inside 4.3:

- broaden contradiction rules beyond the first conservative heuristic:
  - contradiction now requires same-scope overlap plus an explicit core-conflict signal, not just a meaningful newer diff
  - explicit back-test support is still missing if we want a later run to refute an older scope intentionally
- decide whether contradiction coverage should stay in focused trust-smoke or be promoted into the real 4.1 ForgeBench fixture set:
  - the focused rerun smoke already proves a real same-target contradiction path
  - only promote broader contradiction fixtures if they can prove same-scope or explicitly back-tested disagreement against clean ForgeBench
- refine sufficiency/freshness policy beyond the first partial-evidence and query/evidence-mismatch heuristics

## Goal

Turn historical comparisons into explicit trust semantics.

## Phase Outcome

By the end of 4.3, trust output should stop being vague. The system should be able to say, with evidence:

- this answer appears unchanged
- this answer changed, but the new evidence supports the change
- this answer may be stale because underlying evidence aged or disappeared
- this answer is contradicted by a comparable newer run
- this answer is still uncertain because evidence is incomplete

## Why This Phase Exists

Without clear semantics, trust output collapses into vague warnings.

This phase exists to separate:

- aging evidence
- stale evidence
- changed answer
- contradicted answer
- insufficient evidence

## Dependencies

- 4.0 trust-run history
- 4.1 eval suites capable of checking trust-state outcomes
- 4.2 structured comparison artifacts

## Explicit Non-Goals

This phase should not:

- add broad ranking or routing changes
- hide ambiguity behind one opaque score
- expand into all alignment diagnostics before 4.4
- treat every packet difference as a contradiction

## Scope In

- contradiction rules over comparable packets
- stale/drift interpretation over evidence freshness
- trust-state classification rules
- persisted contradiction/drift records or equivalent trust annotations

This phase should define a small, explicit trust-state vocabulary and the rules that map comparison artifacts into that vocabulary.

## Proposed Trust-State Vocabulary

The exact names can still change, but the phase should converge on something like:

- `stable`
- `changed`
- `aging`
- `stale`
- `superseded`
- `contradicted`
- `insufficient_evidence`

These states must be:

- mutually understandable
- queryable
- explainable from evidence

They do not all need to be mutually exclusive at storage level, but the surfaced result should stay simple.

## Interpretation Rules To Plan Explicitly

### Stable

- comparable rerun produced no meaningful change
- or only noise-level differences were detected

### Changed

- the answer or evidence changed in a meaningful way
- but the new evidence still supports the new state rather than negating the older one

### Aging

- freshness metadata suggests the answer should be reviewed soon
- evidence is not yet stale, but it is beyond the first warning threshold

### Stale

- freshness metadata suggests the answer may no longer be trustworthy
- or source evidence disappeared/aged without a direct contradiction yet

### Superseded

- a newer comparable run should replace the older run for normal consumption
- the older run is not necessarily contradicted, but it is no longer the preferred answer state

### Contradicted

- a newer comparable run conflicts with the prior answer on an explicit core facet
- the conflict is grounded in same-scope evidence or explicit back-test evidence, not just a packet diff

### Insufficient evidence

- the system cannot confidently classify the state because the evidence remains partial, missing, or too weak

## Workstreams

### Workstream A: trust-state contract

- define the trust-state enum/shape
- define the explanation fields each classification must carry
- keep the surfaced state compact while preserving supporting details

### Workstream B: freshness and evidence integration

- reuse existing freshness metadata from Roadmap 3 where available
- decide how freshness contributes to `aging` and `stale` without automatically forcing contradiction
- define explicit TTL constants instead of hidden call-site judgment
- define a stable per-query-kind decay policy, defaulting off until justified
- assess freshness from the freshest relevant supporting timestamps available, for example:
  - trust-run update time
  - evidence freshness timestamps
  - linked environment/source timestamps

### Workstream C: contradiction rules

- define what kinds of comparison deltas count as contradiction candidates
- define how evidence-level changes promote or suppress contradiction
- handle partial answers carefully so missing evidence does not over-trigger contradiction
- treat contradiction clusters as the primary historical primitive, not only pairwise diffs:
  - group comparable runs by target
  - detect clusters with materially distinct packets, states, or support levels
  - let `superseded` and `contradicted` emerge from cluster interpretation rather than one-off flags

### Workstream D: persistence/query

- persist trust-state outputs or annotations linked to comparison artifacts
- expose read APIs for latest trust state and trust-state history

### Workstream E: eval coverage

- create suite cases for stable, changed, aging, stale, superseded, contradicted, and insufficient-evidence outcomes
- include ambiguous edge cases that should not be over-classified

## Scope Out

- alignment diagnostics
- UI polish
- broad ranking logic
- policy beyond evidence-backed trust semantics

## Initial TTL Defaults To Decide Explicitly

4.3 should not hide freshness thresholds in implementation code. The phase should pick explicit defaults such as:

- `AGING_DAYS = 30`
- `STALE_DAYS = 90`

These may later become per-query-kind values, but the first shipped version should still expose concrete defaults.

## Acceptance Criteria

- the system can distinguish changed vs aging vs stale vs superseded vs contradicted
- trust state is explicit and queryable
- contradiction logic points back to comparable evidence, not hand-wavy text
- there is an explicit state for insufficient evidence instead of forcing false certainty
- eval cases exist for each trust-state class

## Risks

- **False contradiction.** Not every changed answer is a contradiction.
- **Ambiguous stale state.** Source freshness and answer correctness are related but not identical.
- **TTL confusion.** If stale policy is implicit, the same evidence age will be treated differently across call sites.
- **No cluster primitive.** Pairwise-only contradiction logic will get noisy and harder to summarize over long answer history.
- **Overloaded state model.** If too many trust labels are introduced, the feature becomes harder to trust.
- **Hidden reasoning.** If the classification cannot point back to evidence/diff inputs, it will feel arbitrary.

## Verification Plan

### Minimum checks

- classify at least one stable rerun correctly
- classify at least one changed-but-not-contradicted rerun correctly
- prove at least one same-scope strong diff lands as `superseded` rather than `contradicted` when no explicit core-conflict signal exists
- classify at least one aging case separately from stale
- classify at least one stale case driven by freshness/evidence age
- prove the same query kind can classify `stale` versus not-`stale` based on an explicit TTL/decay rule rather than hidden judgment
- classify at least one superseded case that is newer/preferred without being contradicted
- classify at least one contradicted case driven by a meaningful same-scope comparison delta
- prove mutation-backed reruns over the in-memory snapshot store classify as `changed` when the later run no longer overlaps the older scope
- classify at least one insufficient-evidence case without overcommitting

### Good stress cases

- changed evidence ordering that should remain `stable`
- evidence disappeared due to incomplete retrieval and should remain `insufficient_evidence`
- a seeded defect or schema change that should clearly produce `contradicted`
- an older run replaced by a strictly richer newer run that should be `superseded`, not `contradicted`
- a source freshness drop with no other answer change that should produce `stale`
- a source freshness drop within the warning threshold that should produce `aging`
- one query kind with stale policy disabled by default

## Exit State For 4.4 And 4.5

When 4.3 is done, later phases should be able to assume:

- every comparable answer history can be summarized into an explicit trust state
- the trust state is backed by stored comparison evidence
- contradiction clusters exist as a reusable trust primitive for later surfaces
- later diagnostics can contribute to trust interpretation without inventing a parallel state model
- UI/API/MCP surfaces can expose trust state directly instead of generating ad hoc warnings

## Immediate Starting Files

- trust-record store helpers
- rerun/compare outputs from 4.2
- existing freshness/drift metadata seams from prior roadmaps
