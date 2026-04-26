# Phase 4.4a TS-Aware Alignment Diagnostics

Status: `Completed`

This file is the canonical shipped record for Roadmap 4 Phase 4.4a. It delivered the first TS-aware alignment diagnostics over the trust-aware answer surface.

Use [../roadmap.md](../roadmap.md) for final roadmap status. Use [./phase-4.3-contradiction-and-drift-engine.md](./phase-4.3-contradiction-and-drift-engine.md) for the trust semantics these diagnostics now feed.

## Shipped Outcome

By the end of 4.4a, mako can now surface explicit diagnostics for the highest-ROI TS-aware bug families:

- `producer.field_shape_drift`
- `identity.boundary_mismatch`

These diagnostics now participate in:

- answer enrichment
- trust/ranking output
- eval assertions
- real ForgeBench Eval suites

## What Shipped

- a diagnostics substrate under:
  - `packages/tools/src/diagnostics/common.ts`
  - `packages/tools/src/diagnostics/ts-aware.ts`
  - `packages/tools/src/diagnostics/index.ts`
- TS-aware producer/consumer analysis over indexed file content
- TS-aware identity/key boundary checks over indexed file content
- issue identities with stable logical/code/pattern hashes
- one additive surface contract shared with later phases:
  - `severity`
  - `category`
  - `code`
  - `message`
  - `path`
  - `line`
  - `identity`
  - `evidenceRefs`
  - `confidence`

## Diagnostic Families

### 1. Producer/consumer shape drift

Examples now surfaced:

- producer returns `attendance_window`, consumer expects `attendanceWindow`
- consumer expects a field that is no longer produced
- relation/helper shape drift that is visible from TS/object-return boundaries

### 2. Identity/key mismatch

Examples now surfaced:

- `profile.id` used where `profile.user_id` is required
- wrong identity passed across helper boundaries
- caller/consumer identity flow drifts from the expected boundary

## Integration Points

The shipped 4.4a slice is already wired into:

- `packages/tools/src/trust/enrich-answer-result.ts`
- `packages/tools/src/evals/runner.ts`
- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tools.ts`

That means TS-aware diagnostics are now visible on normal `AnswerResult` output instead of hiding behind a separate lint path.

## Real Coverage

Shipped verification includes:

- deterministic smoke coverage in:
  - `test/smoke/alignment-diagnostics.ts`
- real fixture coverage in:
  - `devdocs/test-project/trust-eval-fixtures.ts`
  - `devdocs/test-project/run-trust-evals.ts`

The real `forgebench-eval` suite now proves that tracing the dashboard helper and admin page surfaces TS-aware drift findings explicitly instead of only finding nearby files.

## Intentional Limits

4.4a intentionally did **not** become a generic lint platform.

It remains:

- local-first
- answer/trust-integrated
- focused on recurring high-value mismatch classes

It also intentionally stops short of full whole-program proof. Findings stay evidence-backed, but partial confidence remains allowed where proof is incomplete.

## Acceptance Criteria Met

- the system can surface producer/consumer drift explicitly
- the system can surface identity/key mismatches explicitly
- diagnostics are grounded in indexed code facts, not heuristic prose only
- the hardest seeded TS-side mismatch cases now produce explicit findings
- those findings can already feed trust explanations and ranking policy

## Primary Files

- `packages/tools/src/diagnostics/common.ts`
- `packages/tools/src/diagnostics/ts-aware.ts`
- `packages/tools/src/diagnostics/index.ts`
- `packages/tools/src/trust/enrich-answer-result.ts`
- `test/smoke/alignment-diagnostics.ts`
- `devdocs/test-project/trust-eval-fixtures.ts`
