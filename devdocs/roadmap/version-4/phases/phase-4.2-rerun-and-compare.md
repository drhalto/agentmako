# Phase 4.2 Rerun And Compare

Status: `Completed`

This file is the canonical planning doc for Roadmap 4 Phase 4.2. It adds a first-class rerun flow and structured diffs over comparable answers.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [./phase-4.0-trust-backbone.md](./phase-4.0-trust-backbone.md) as the storage substrate this phase depends on.

## Current Snapshot

The first 4.2 slice is now landed.

What shipped:

- migration `0021` adding `answer_comparisons`
- comparison contracts in `packages/contracts/src/answer.ts`
- store persistence and query helpers for:
  - insert comparison
  - fetch by id
  - fetch by run pair
  - fetch latest comparison for a target
  - list comparison history for a target
- a `rerunAndCompare(...)` tool-service path in `packages/tools/src/trust/rerun-and-compare.ts`
- manual reruns keyed by:
  - `traceId`
  - `targetId`
- reruns that go through the normal answer/tool path with `provenance: "manual_rerun"`
- support for deterministic reruns across:
  - answer-engine families
  - `trace_file`
  - `file_health`
  - `trace_table`
  - `preflight_table`
  - `trace_rpc`
  - `trace_edge`
  - `trace_error`
  - `cross_search`
- persisted compare artifacts carrying:
  - run-pair linkage
  - summary changes
  - raw delta
  - meaningful-change flag
  - provenance
- focused regression coverage in `test/smoke/rerun-and-compare.ts`

What is still open inside 4.2:

- broaden compare coverage beyond the initial rerun families
- decide whether any compare summaries need more change codes before 4.3 consumes them
- add more eval-driven rerun/compare cases on top of the 4.1 harness
- decide whether compare artifacts need additional query/filter seams before trust surfaces arrive

## Goal

Let `mako-ai` rerun a comparable question/target and explain how the result changed.

## Phase Outcome

By the end of 4.2, the system should be able to:

- intentionally rerun a previously comparable target
- link the new run to the previous trust history
- persist a structured comparison artifact
- summarize what changed in answer status, evidence, and missing-information shape without dumping unreadable raw JSON

## Why This Phase Exists

Trust requires more than “store answers.” It requires:

- rerunning the same question shape
- comparing current and prior packets
- surfacing meaningful changes instead of raw JSON noise

## Dependencies

- 4.0 must already provide comparable target identity and trust-run history
- 4.1 should already provide repeatable eval cases that can exercise rerun/compare behavior

## Explicit Non-Goals

This phase should not:

- decide final contradiction semantics
- add broad ranking logic
- add cross-repo or cross-project comparison
- optimize for every possible packet field before a simple compare path exists

## Scope In

- rerun flow for comparable answer targets
- structured packet diffs
- evidence gained/lost summaries
- persisted comparison results

### Rerun flow

This should include:

- a rerun request shape keyed by trust run id or comparable target id
- resolution of the original tool/query family plus normalized target
- execution through the existing answer path rather than a bespoke evaluator
- explicit rerun provenance on the new trust run

### Structured diffing

This should include:

- packet-level structural diff
- answer-aware summary entries shaped as `Array<{ code, detail }>` rather than a fixed boolean grid
- stable change codes for:
  - status change
  - confidence change
  - evidence added/removed
  - missing-information added/removed
  - candidate-actions change where relevant

### Persisted comparison artifact

Later phases should be able to query:

- prior run
- new run
- raw structural delta
- answer-aware summaries
- meaningful-change flag without replaying the diff engine

## Scope Out

- contradiction policy
- alignment diagnostics
- ranking
- deep UX polish for compare browsing

## Candidate Tools

- `jsondiffpatch`
- RFC 6902-style patch/diff libraries where they fit the normalized comparison model better

The critical decision is not the library first. The critical decision is the normalization contract the library runs on top of.

## Workstreams

### Workstream A: rerun request and execution contract

- define how a rerun is requested
- resolve the comparable target back into an executable answer request
- preserve provenance so the run is clearly marked as a rerun
- lock the first supported entrypoints to:
  - `traceId`
  - `targetId`
- defer fuzzy comparable locators until there is a concrete need beyond those two stable ids

### Workstream B: comparison storage

- persist run-pair linkage
- persist raw structured delta
- persist compact summary fields derived from that delta
- persist the comparison artifact as a first-class store record in 4.2 rather than leaving it as an in-memory helper

### Workstream C: answer-aware diff summarization

- collapse noisy packet deltas into evidence/status summaries
- treat array-like evidence carefully so reordering does not look like semantic change
- preserve exact raw diff for debugging while exposing cleaner summaries for later phases
- use a forward-compatible summary shape:
  - `Array<{ code, detail }>`
  - where `code` is stable and `detail` stays human-readable

### Workstream F: normalization contract

- define set-like comparison rules before locking the diff engine
- define stable keys for evidence and missing-information comparisons
- inherit the volatile-field strip list from 4.0 canonicalization instead of reinventing it here
- compare answer markdown separately from packet structure instead of letting prose churn dominate packet change reporting

### Workstream D: store/query APIs

- fetch latest comparison for a trust target
- fetch comparison by run pair
- list comparison history for a target

### Workstream E: evaluation coverage

- add rerun/compare cases to the trust-focused suite harness from 4.1
- prove readable diffs on known-changed and known-unchanged cases

## Proposed Comparison Artifact

The exact table names can still move, but the logical artifact should contain:

- prior trust run id
- current trust run id
- comparison target id
- raw structural diff payload
- normalized summary entries
- `meaningfulChangeDetected`
- rerun provenance
- timestamps

The summary entries should be narrow and interpretable, for example:

- `{ code: "status_change", detail: "packet status moved from partial to complete" }`
- `{ code: "evidence_added", detail: "1 new evidence block appeared for public.support_tickets" }`
- `{ code: "evidence_removed", detail: "learner dashboard page no longer appears in evidence" }`
- `{ code: "missing_info_added", detail: "result now reports missing schema context" }`
- `{ code: "confidence_change", detail: "support level moved from moderate to strong" }`
- `{ code: "candidate_actions_change", detail: "next-check suggestions changed materially" }`

This shape is preferable to hard-coded booleans because:

- new change codes can be added without schema churn
- CLI/web surfaces can render one row per change without remapping fields
- programmatic consumers still get stable machine-readable categories

Recommended logical fields for the persisted artifact:

- `comparisonId`
- `targetId`
- `priorTraceId`
- `currentTraceId`
- `summaryChanges: Array<{ code, detail }>`
- `rawDeltaJson`
- `meaningfulChangeDetected`
- `createdAt`
- `provenance`

## Summary Rules

This phase should define the first answer-aware summarization rules explicitly.

### Changes that should usually count as meaningful

- answer status changed
- evidence block added or removed
- missing-information state changed
- primary conclusion changed

### Changes that should usually be down-ranked as noise

- reordered equivalent evidence
- timestamp-only changes
- request/provenance metadata differences
- packet formatting or serialization differences
- answer markdown wording changes when the packet meaning is otherwise unchanged

## Normalization Contract To Lock Before Engine Choice

4.2 should explicitly define these rules up front:

- evidence arrays compare as sets keyed by stable evidence identity/ref where available
- missing-information compares by stable reason codes or normalized categories, not prose phrasing
- volatile packet fields are stripped according to the 4.0 canonicalization rules
- tool/evidence digests should be sorted before hashing or comparison when order is not semantically meaningful
- answer markdown is diffed separately from packet structure
- library choice is implementation detail after those rules are fixed

## Rerun Provenance Rule

This phase should not invent a second answer-save path.

- reruns execute through the normal answer path
- the new trust run should be written with `provenance: "manual_rerun"` when the rerun is explicitly requested
- comparison artifacts should reference those persisted trust runs instead of carrying shadow copies of answer state

## Acceptance Criteria

- a comparable trust record can be rerun intentionally
- old/new answer packets can be diffed structurally
- comparison output is stored and queryable
- the comparison output includes a human-usable summary, not only raw JSON delta
- at least one unchanged rerun and one changed rerun are covered by tests/eval cases

## Risks

- **Diff noise.** Raw structural diffs can be unreadable without answer-aware summaries.
- **Engine-first design.** If the diff library is chosen before normalization rules are fixed, the roadmap will optimize for the wrong artifact shape.
- **Unstable identities.** Weak comparison identity will make reruns meaningless.
- **Execution drift.** If reruns do not go through the real answer path, trust history becomes unrepresentative.

## Verification Plan

### Minimum checks

- rerun a prior trust target intentionally and persist the new run
- compare unchanged output and prove the summary stays quiet
- compare changed output and prove the summary surfaces real evidence/status change
- query a stored comparison through the public store seam

### Good stress cases

- a rerun where evidence ordering changes but meaning should not
- a rerun where evidence wording changes but missing-information reason codes do not
- a rerun where one evidence block disappears
- a rerun where the packet status moves from `partial` to `complete`
- a rerun driven from an eval/seeded case rather than only manual interactive use

## Exit State For 4.3 And 4.5

When 4.2 is done, later phases should be able to assume:

- every comparable target can produce a run-to-run diff
- comparisons are persisted and queryable
- contradiction/drift logic can classify real comparison artifacts
- trust surfaces can render readable change summaries without reimplementing diff logic

## Immediate Starting Files

- trust-record store helpers from 4.0
- `packages/contracts/src/answer.ts`
- candidate diff helper integration point(s)
