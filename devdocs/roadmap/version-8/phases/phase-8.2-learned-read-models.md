# Phase 8.2 Learned Read Models

Status: `Gated on accumulated history`

## Goal

Build derived aggregations over 8.1 telemetry: per-tool / per-query-kind
/ per-project / per-surface priors for helpfulness, no-noise,
follow-up rate, contradiction rate, and staleness. Reuse the history
windowing pattern already present in
`packages/tools/src/project-intelligence/`.

## Hard Decisions

- aggregates are derived, not persisted as first-class state — on-demand
  computation over the append-only event table, with a small cache only
  where query cost justifies it
- default window = rolling 30 days; shorter windows are caller-selected
- windows and aggregates are operator-inspectable, same shape as
  project-intelligence
- no opaque learned model; aggregates are plain per-family priors

## Gate

Do not open until 8.1 has been shipping long enough to accumulate
non-fixture history in at least one real project. Use operator
judgment — a minimum of several hundred real events per family is a
reasonable floor.

## Decisions This Phase Must Settle

These are deliberately deferred from 8.0 / 8.1 and must be decided
before implementation; they are called out here so 8.2 does not
silently reopen lower-layer contracts:

- **Aggregate schema shape.** What fields make up an aggregate row
  (numerator / denominator counts, windowed rates, per-family vs
  per-decisionKind breakdown, confidence interval or n-size guard).
  Aggregate rows must be serializable under the 8.0 telemetry contract
  style, not ad-hoc.
- **Invalidation / update rules.** Are aggregates derived on demand
  from the event table, cached with a TTL, or persisted as first-class
  state? Default position: on-demand computation with a thin cache
  only where query cost justifies it — but the cache shape must be
  declared, not improvised.
- **Project-vs-global precedence.** When a project-scoped aggregate
  and a global aggregate disagree on the same family × decisionKind,
  which wins by default? Does the caller get both, or one with an
  explicit override? 8.3 / 8.4 cannot consume these without a rule.
- **Minimum-sample gate.** At what n-size does an aggregate become
  eligible to inform a learned delta? Below that threshold the
  aggregate still reports but 8.3 / 8.4 must treat it as baseline-only.

## Scope In

- read-model functions in `packages/tools/src/runtime-telemetry/` (or
  adjacent) that compute rollups from the event table
- exposure surface behind the inspection tool from 8.1
- smoke coverage using a captured fixture dataset distinct from the
  smoke-suite synthesized data

## Scope Out

- no ranking / routing / exposure behavior change
- no learned-delta production — that lives in 8.3 / 8.4
- no model training

## Done When

- rollups are computable on demand for every `decisionKind` × `family`
- replay against a recorded fixture matches expected aggregates within
  tolerance
- project-intelligence-style windowing is exposed to operators

## References

- `packages/tools/src/project-intelligence/index.ts`
- `continue-main/core/data/devdataSqlite.ts:46-75` (reference)
