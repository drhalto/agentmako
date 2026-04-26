# Phase 8.5 Failure Clustering And Optimization Experiments

Status: `Gated on 8.2`

## Goal

Cluster repeated reason-code patterns from 8.1 telemetry into named
failure families. Expose them as an operator-facing report. Optionally
run dark retrieval / ranking experiments behind an experiment flag,
replay-only.

## Hard Decisions

- clustering is descriptive, not prescriptive — no auto-fix, no
  auto-issue
- experiments are dark by default; promotion to `opt_in` requires the
  same eval + operator confirmation path as 8.3 / 8.4
- clustering output is typed (`FailureCluster` in
  `packages/contracts/src/runtime-telemetry.ts` or an extension), not
  a free-form report

## Gate

Do not open until 8.2 produces stable aggregates.

## Decisions This Phase Must Settle

These are deliberately deferred from 8.0 / 8.1 / 8.2 and must be
decided before implementation so 8.5 does not silently reopen lower
contracts:

- **Cluster identity.** What inputs derive a stable cluster ID —
  sorted reason-code set? reason-code set + family? + query-kind?
  + surface? Two reports over overlapping windows must produce the
  same ID for "the same" cluster, or historical comparison is
  meaningless.
- **Cluster stability across windows.** When a cluster loses or
  gains a reason code between runs, is it the same cluster with
  drift, or a new cluster? Default position: identity is set at
  first observation and becomes stale rather than morphing — but
  the staleness rule must be explicit.
- **Cluster lifecycle.** When do clusters age out, merge, or split?
  Age-out by minimum occurrence count per window; merge / split
  only by explicit operator action, not automatic.
- **Cluster output contract.** Extends the 8.0 telemetry contract
  as a typed `FailureCluster` shape with `clusterId`, `firstSeenAt`,
  `lastSeenAt`, `reasonCodeSet`, `occurrenceCount`, `familyBreakdown`
  — the exact fields are a decision, but the shape is typed, not
  free-form.

## Scope In

- cluster computer over the event table — reason-code co-occurrence
  plus family plus query-kind
- operator-facing report tool plus CLI surface
- at least one dark retrieval / ranking experiment scaffold (may ship
  without a winning result; the scaffold is the deliverable)

## Scope Out

- no auto-fix, auto-issue, or auto-suppression
- no opaque clustering — operators must be able to read the cluster
  definition in the contract

## Done When

- operators can pull a typed report of top-N failure clusters per window
- at least one dark experiment is wired up, feature-flagged,
  replay-only, and emits decision envelopes
- smoke coverage against a captured reason-code fixture

## References

- `packages/contracts/src/runtime-telemetry.ts` — 8.0 contract,
  extended here
- `packages/tools/src/evals/runner.ts` — reason-code sources
