# Phase 4.1 Evaluation Harness And Regression Suites

Status: `Completed`

This file is the canonical planning doc for Roadmap 4 Phase 4.1. It turns the existing benchmark/seeded-defect work into a trust-focused evaluation layer.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [./phase-4.0-trust-backbone.md](./phase-4.0-trust-backbone.md) as the substrate this phase depends on.

## Current Implementation Snapshot

The first 4.1 slice is now landed.

What shipped:

- `ToolServiceOptions.answerTraceOptions` so eval callers can reuse the normal answer/composer save path while tagging trust runs with explicit provenance
- provenance threading through:
  - `packages/tools/src/answers/index.ts`
  - `packages/tools/src/composers/_shared/define.ts`
- a standard typed eval runner in:
  - `packages/tools/src/evals/types.ts`
  - `packages/tools/src/evals/runner.ts`
  - `packages/tools/src/evals/index.ts`
- suite registration on top of the existing benchmark tables instead of a second eval database
- a narrow assertion set for the first suite families:
  - routed tool/family selection
  - answer query kind
  - positive and negative evidence file/source-ref checks
  - missing-information inclusion/exclusion
  - trust identity kind
  - full trust identity equality
  - trust provenance
  - trust state equality
  - trust reason-code inclusion/exclusion
  - error code equality
  - packet summary equality
- per-run regression comparison with per-family deltas against a stable baseline selection (prefers the last `passed` run, then `partial`, then `any`, then `none`) so a regression does not silently become the new baseline
- explicit pinned baseline support for suites that need a blessed run id instead of heuristic baseline selection
- assertion-level drift detection: same case outcome with a different failing-assertion set is surfaced as `assertionDriftCaseIds` distinct from `regressedCaseIds`
- per-case `failureReasons: TrustEvalAssertionType[]` persisted into `benchmark_case_results.actualValue` and hydrated as baseline signal on later runs
- structured error capture on invocation failure: `errorCode` is preserved from `MakoToolError.code` or `Error.name` alongside the message
- strict `tool_runs` lookup (no fallback across tool names) so routing mistakes are visible
- per-case relative trust-age controls (`trustAgeDays`) so suites can deterministically assert freshness states without mutating stored timestamps
- first suite fixtures under `devdocs/test-project/trust-eval-fixtures.ts`
- a manual runner script in `devdocs/test-project/run-trust-evals.ts`
- committed packet snapshots in `devdocs/test-project/trust-eval-snapshots.json` plus a `--bless` path in `run-trust-evals.ts`
- packet snapshots now pin:
  - packet/evidence structure
  - surfaced diagnostic codes
  - ranking de-emphasis state
- focused regression coverage in `test/smoke/eval-harness.ts`
- the initial vague-question, packet-snapshot, trust-freshness, trust-sufficiency, and seeded-defect suites now run cleanly against the real `forgebench` and `forgevench-eval` roots through `run-trust-evals.ts`
- the focused eval smoke now proves that trust-state assertions survive real history:
  - the initial run can still persist and assert a latest-run trust state inline
  - the same trace can later be observed as `superseded` once newer comparable runs exist
  - the current latest comparable run still exposes the current classifier output rather than a separate eval-only interpretation
  - freshness-specific cases can assert `aging` and `stale` through the normal suite path
  - insufficiency-specific cases can assert both:
    - no-hit search insufficiency
    - off-topic fallback/query-evidence mismatch insufficiency
  - scope-drift rerun cases can now assert a real older/newer state pair through a seeded rerun fixture:
    - the mutation runs against the in-memory `replaceIndexSnapshot(...)` store, not fixture files on disk
    - the current guardrail is explicit: a mutation-backed rerun should classify as historical `changed`, not `contradicted`, unless a future run explicitly back-tests the older scope

What this means:

- eval-triggered runs now land in trust history through the same `saveAnswerTrace(...)` path as normal product writes
- the benchmark tables can already hold named suites, stable case definitions, run results, and assertion results for trust work
- one standard local runner can execute:
  - vague-question suites
  - seeded-defect suites
  - packet snapshot suites
  - deterministic trust-freshness suites
  - baseline-to-baseline regression comparison
- packet snapshots no longer validate themselves from the same execution; they can be blessed once and then consumed as a committed regression source on later runs
- snapshot-only coverage now reaches the surfaced trust/diagnostic/ranking envelope, not just raw packet structure
- trust-state outcomes are no longer only a separate `4.3` concern; suites can assert them directly as part of normal eval coverage
- real fixture coverage now reaches beyond `stable` into `aging`, `stale`, `insufficient_evidence`, and deterministic rerun-based `contradicted` coverage, not only the synthetic trust-state smoke

What is still open inside 4.1:

- broaden the real fixture set beyond the initial smoke/manual cases
- decide whether Promptfoo or Vitest snapshot wrappers should sit on top of the current runner rather than replacing it
- add lightweight retired-fixture validation so archived cases stay schema-consistent with the current tool surface
- add more documented fixture hygiene and baseline-blessing workflow around the new `--bless` path
- decide whether any real contradiction fixture belongs in the devdocs suites beyond the focused rerun smoke:
  - the deterministic rerun smoke now proves a real same-target contradiction path end to end
  - only promote broader contradiction coverage if a case can prove the same-scope/back-tested disagreement against clean ForgeBench without becoming flaky

## Goal

Make trust-layer claims measurable through repeatable regression runs.

Specifically:

- formalize seeded-defect and vague-question eval suites
- add deterministic answer-packet regression checks
- make it easy to rerun suites and compare results across changes

## Phase Outcome

By the end of 4.1, the repo should have one standard evaluation shape for trust work:

- suites are named, versioned, and repeatable
- results are stored in a way later phases can compare
- trust regressions are visible without manual diff archaeology

This phase should convert the current “run a few scripts and inspect by hand” workflow into a real regression discipline.

## Why This Phase Exists

Roadmap 3 already proved that real and seeded evaluation changes product decisions.

Roadmap 4 needs that evaluation to stop being ad hoc and become the standard way to prove:

- trust got better
- trust got worse
- a change improved one bug family while regressing another

## Dependencies

- 4.0 trust backbone should already persist comparable run identity
- Roadmap 3 benchmark storage should already exist and remain reusable
- the seeded defect workflow from `forgebench-eval` should be treated as baseline input, not reinvented

## Explicit Non-Goals

This phase should not:

- invent contradiction semantics before 4.3
- replace the existing benchmark store with an unrelated eval platform
- make Promptfoo or any other external tool a hard runtime dependency
- add hosted observability requirements

## Hard Decisions

1. **Prefer local-first eval tooling.**
   - `Promptfoo`, `Vitest` snapshots, and in-repo fixtures are the default path
2. **Do not make trust scoring depend on external SaaS.**
3. **Use the same answer/trust substrate the product uses at runtime.**
   - eval runners reuse the normal answer save path
   - eval runners do not write parallel trust history directly
4. **Separate deterministic regression from model-behavior eval.**
   - packet snapshots and structural checks belong in-repo
   - broader question/answer eval can use Promptfoo-style runners or equivalent wrappers
5. **Measure real failure classes, not generic “looks good” scoring.**
   - frontend/backend drift, auth drift, RPC reuse misses, identity mismatches, and vague debug questions should all be first-class suite families

## Scope In

- regression suite definitions
- seeded-defect suite definitions
- vague-question suite definitions
- answer-packet/trust-output snapshot assertions
- suite run storage and comparison hooks where needed

This phase should cover at least four suite families:

### 1. Seeded defect suites

- known injected defects with ground truth
- pass/partial/miss scoring
- explicit expected tool/answer evidence

### 2. Vague question suites

- “what a real developer would ask first”
- measure whether the system gets to the right files/contracts/targets

### 3. Packet/trust snapshot suites

- deterministic structure checks for answer/trust outputs
- focused on shape and stable summaries, not incidental timestamps

### 4. Regression comparison suites

- compare current suite results against prior baselines
- highlight which bug families improved or regressed

## Scope Out

- contradiction engine semantics
- alignment diagnostics themselves
- hosted observability/eval platform integration as a requirement
- product UI for browsing eval history in detail

## Candidate Tools

- `Promptfoo`
- `Vitest` snapshots

These are implementation candidates, not mandatory lock-in.

## Proposed Suite Contract

The evaluation harness should standardize a suite record with fields like:

- suite id/name
- suite kind
- target repo/project
- case id
- prompt or request fixture
- expected target(s) and expected evidence
- scoring result
- linked trust run(s) where applicable

Suite/case lifecycle should also be explicit:

- `active`
- `retired`
- `fixed_and_archived`

This should let later phases answer:

- did the system still find the right file?
- did it still classify the trust state correctly?
- which bug families regressed?

## Workstreams

### Workstream A: suite taxonomy and fixture format

- define the allowed suite kinds
- define case fixture structure
- migrate existing benchmark/seeded data into that structure where feasible

### Workstream B: runner wiring

- decide what runs through Vitest directly
- decide what runs through Promptfoo or a local wrapper around it
- ensure results can be written back into the local benchmark/eval store
- ensure eval execution reuses `saveAnswerTrace(...)` instead of writing trust runs directly

### Workstream C: scoring and assertions

- add deterministic structural assertions for packet/trust outputs
- add case-level scoring for pass/partial/miss
- add narrow “why it failed” annotations that are machine- and human-readable

### Workstream D: regression comparison

- compare latest suite run against prior baseline
- report per-bug-family deltas, not just one aggregate score
- allow suites to pin a blessed baseline run when heuristic selection is not the right comparison contract
- make this easy to run locally before and after changes

### Workstream E: docs and fixture hygiene

- document how to add a new seeded defect case
- document how to update a packet snapshot intentionally
- document how to bless a new baseline versus catch a regression

## Storage And Result Shape

This phase should reuse the benchmark/eval store where possible, but it needs a clearer trust-oriented result shape:

- suite
- case
- run
- score/result
- linked trust run ids or answer run ids when present
- compact failure classification

Avoid a second one-off evaluation database.

Explicit invariant:

- eval runners may annotate provenance such as `seeded_eval`
- eval runners may record suite/case metadata in benchmark/eval tables
- eval runners must reuse the normal answer save path for trust runs
- eval runners must not create parallel trust-run rows directly

## Acceptance Criteria

- there is a repeatable trust-focused suite runner
- seeded-defect and vague-question suites are first-class, not one-off scripts
- answer/trust regressions are easy to spot in CI/local runs
- at least one seeded-defect suite and one vague-question suite are wired into the standard runner
- deterministic snapshots exist for trust-aware answer outputs where structure should remain stable

## Risks

- **Testing the wrong thing.** Suites must target real trust goals, not only pretty output shape.
- **Overfitting to one benchmark.** The suite set should stay diverse across bug families.
- **Brittle snapshots.** Snapshot coverage should pin the important structure, not every incidental field.
- **Evaluation drift.** If local scripts and canonical suites diverge, the phase has failed.
- **History pollution.** If eval creates trust runs through a separate write path, comparable history becomes misleading.

## Verification Plan

This phase should ship with proof that the harness itself works.

### Minimum checks

- run one seeded-defect suite end-to-end locally
- run one vague-question suite end-to-end locally
- prove snapshot failures are readable and intentional
- prove a changed baseline can be compared to a prior run
- prove eval-triggered runs land in trust history through the normal save path
- prove a retired or archived case is excluded from active suite scoring without being deleted

### Good stress cases

- one suite with known pass/partial/miss distribution
- one suite that links results back to comparable trust runs from 4.0
- one intentionally regressed fixture to prove the runner reports the regression cleanly

## Exit State For 4.2 And 4.3

When 4.1 is done, later phases should be able to assume:

- there is a standard way to run trust regressions
- rerun/compare work can be scored against seeded and vague cases
- contradiction/drift logic can be evaluated against stored suite baselines, not anecdotes

## Immediate Starting Files

- `packages/store/src/project-store-benchmarks.ts`
- `devdocs/test-project/`
- seeded-defect workflow docs/fixtures
- `devdocs/roadmap/version-4/phases/phase-4.0-trust-backbone.md`
