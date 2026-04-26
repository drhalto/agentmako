# Phase 4.6 Ranking And Policy

Status: `Completed`

This file is the canonical shipped record for Roadmap 4 Phase 4.6. It added only the narrow ranking/policy layer justified after trust semantics, diagnostics, and trust surfaces were already real.

Use [../roadmap.md](../roadmap.md) for final roadmap status. Use [./phase-4.5-trust-surfaces.md](./phase-4.5-trust-surfaces.md) for the already-shipped trust presentation layer this phase builds on.

## Shipped Outcome

Ranking shipped as a narrow, evidence-backed surface, not an opaque score.

The delivered behavior is:

- explicit `deEmphasized` output on `answerResult.ranking`
- explicit ranking reason codes
- policy driven by trust state and diagnostics, not prettiness or hidden heuristics

## What Shipped

Ranking/de-emphasis is now derived in:

- `packages/tools/src/trust/enrich-answer-result.ts`

The current shipped policy is intentionally small:

- `stable` answers remain normal
- `changed` answers remain normal
- `aging` answers remain normal unless a high-confidence high-severity diagnostic also applies
- `stale` answers are de-emphasized
- `contradicted` answers are de-emphasized
- `insufficient_evidence` answers are de-emphasized
- `superseded` answers are de-emphasized
- high-confidence high/critical diagnostics can add a documented diagnostic penalty

## Why This Counts As Roadmap 4 Ranking

This phase succeeded because it obeyed the roadmap constraint:

- ranking is additive to visible trust state
- ranking is explained where it appears
- ranking is backed by explicit evidence already present in the answer surface

No hidden aggregate score and no learned ranking model were introduced.

## Eval Integration

The eval runner now exposes and asserts ranking behavior using the same answer/trust substrate.

That includes:

- `ranking_deemphasized_equals`
- `ranking_reason_code_includes`

Real suites now prove at least:

- stale answers de-emphasize
- insufficient-evidence answers de-emphasize
- trust-aware diagnostic cases can carry an explicit diagnostic penalty reason

Primary files:

- `packages/tools/src/evals/types.ts`
- `packages/tools/src/evals/runner.ts`
- `devdocs/test-project/trust-eval-fixtures.ts`
- `devdocs/test-project/run-trust-evals.ts`

## Acceptance Criteria Met

- ranking/de-emphasis is tied to explicit evidence/trust state
- no opaque score was introduced without explanation
- ranking remains additive to the trust layer rather than redefining it
- at least one ranking/de-emphasis behavior is proven in eval

## Intentional Limits

4.6 intentionally did **not**:

- introduce a black-box aggregate score
- add learned/adaptive routing
- add vendor-dependent evaluation signals
- hide stale/contradicted answers instead of de-emphasizing them visibly

## Primary Files

- `packages/tools/src/trust/enrich-answer-result.ts`
- `packages/tools/src/evals/types.ts`
- `packages/tools/src/evals/runner.ts`
- `devdocs/test-project/trust-eval-fixtures.ts`
