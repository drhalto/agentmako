# Phase 8.3 Bounded Learned Ranking And Routing

Status: `Gated on 8.2`

## Goal

Apply learned signals from 8.2 read models as bounded deltas to existing
deterministic ranking and routing. First targets:

- `tool_search` ranking
- answer-result tie-breaks
- packet-attachment routing

Every learned output emits a `LearnedDecisionEnvelope` (8.0 contract)
declaring baseline, bounded delta, final decision, and rollback reason
when relevant.

## Hard Decisions

- hard guards are absolute: blocked tools stay blocked, trust
  de-emphasis stays authoritative, learned logic cannot invent new tool
  families or reinstate `not_promoted` families
- delta caps are declared in the contract, not the implementation
  (e.g. `max-rank-shift=3`, `max-threshold-drift=0.02`)
- every learned surface ships behind an experiment flag with a named
  stage (mirrors the codex `Feature` / `Stage` registry)
- rollback is a single toggle; automatic demotion fires when an eval
  suite regresses past a declared floor

## Gate

Do not open until 8.2 read models produce stable, inspectable aggregates
over real usage.

## Scope In

- experiment-flag registry (shared with 8.4) in
  `packages/contracts/src/learned-surface-registry.ts`
- learned reorder adapter at each first-target site
- decision-envelope emission at each site
- one usefulness check per learned surface, comparing baseline vs final
  against a held-out benchmark suite
- feature-flag CLI for learned surfaces. Proposed shape:
  `agentmako learned list|enable|disable` — final namespace is a
  decision at implementation time and must be reconciled against
  `CLI_COMMANDS` in `apps/cli/src/shared.ts`

## Scope Out

- no ranking / routing change outside the first-target sites
- no threshold tuning — that is 8.4
- no failure clustering — that is 8.5

## Done When

- each first-target surface has an active learned delta gated behind a
  named experiment flag
- every surface emits decision envelopes that parse against the 8.0
  contract
- held-out benchmark comparison shows non-regression within the declared
  floor
- the rollback toggle demotes any surface in one call

## References

- `packages/tools/src/ask/` — router site
- `packages/tools/src/workflow-packets/attachment-policy.ts`
- `codex-rs/features/src/lib.rs` (reference — registry + stage)
- `codex-rs/network-proxy/src/network_policy.rs:229-256` (reference —
  decision envelope)
