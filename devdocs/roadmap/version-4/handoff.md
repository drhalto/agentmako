# Roadmap Version 4 Handoff

This file is the execution handoff for the shipped Roadmap 4 trust layer.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-3/roadmap.md](../version-3/roadmap.md)
- [../version-3/handoff.md](../version-3/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Roadmap Intent

Roadmap 4 was the `trust layer` roadmap.

It turned `mako-ai` from a system that could produce useful answers into a system that can compare, question, and justify those answers over time.

The implementation goal was to leave the repo with:

- a stable trust backbone over the shipped answer layer
- comparable reruns and structured answer diffs
- explicit contradiction/drift state
- trust-oriented evaluation and regression suites
- alignment diagnostics for recurring frontend/backend/schema/type failure classes
- trust signals consumable through CLI, API, MCP, and web

That goal is now met.

## Final Roadmap 4 State

Roadmaps 1, 2, and 3 are complete.
Roadmap 4 is now complete as well.

The shipped trust substrate now includes:

- `answer_comparable_targets`
- `answer_trust_runs`
- `answer_comparisons`
- `answer_trust_clusters`
- `answer_trust_evaluations`

The shipped trust/eval/runtime layer now includes:

- explicit trust states and reason codes
- `evaluateTrustState(...)`
- `readTrustState(...)`
- `listTrustStateHistory(...)`
- `rerunAndCompare(...)`
- the local trust-eval runner and ForgeBench / ForgeBench Eval suites
- additive trust/diagnostic/ranking output on `AnswerResult`
- first trust-aware CLI and web presentation

## Phase Summary

### Phase 4.0 Trust Backbone

Shipped:

- structured and fallback comparable identities
- canonical and raw packet hashing
- environment fingerprint capture
- trust-run history over the answer layer
- legacy trace reconciliation

Primary files:

- `packages/contracts/src/answer.ts`
- `packages/store/src/project-store-trust.ts`
- `packages/store/src/project-store.ts`
- `packages/store/src/migration-sql.ts`
- `test/smoke/trust-backbone.ts`

### Phase 4.1 Evaluation Harness And Regression Suites

Shipped:

- standard local trust-eval runner
- seeded eval provenance through the normal save path
- baseline selection and blessing
- trust/ranking/diagnostic assertions
- real ForgeBench / ForgeBench Eval fixture execution

Primary files:

- `packages/tools/src/evals/types.ts`
- `packages/tools/src/evals/runner.ts`
- `packages/tools/src/evals/index.ts`
- `devdocs/test-project/trust-eval-fixtures.ts`
- `devdocs/test-project/run-trust-evals.ts`
- `test/smoke/eval-harness.ts`

### Phase 4.2 Rerun And Compare

Shipped:

- reruns by `traceId` / `targetId`
- persisted comparison artifacts
- normalized change summaries
- first compare-query seams

Primary files:

- `packages/tools/src/trust/rerun-and-compare.ts`
- `packages/store/src/project-store-trust.ts`
- `test/smoke/rerun-and-compare.ts`

### Phase 4.3 Contradiction And Drift Engine

Shipped:

- persisted trust evaluations and clusters
- TTL-driven freshness states
- conservative contradiction rules
- read-side trust-state/history APIs
- real eval coverage for freshness, insufficiency, and deterministic rerun-driven contradiction

Primary files:

- `packages/tools/src/trust/evaluate-trust-state.ts`
- `packages/tools/src/trust/read-trust-state.ts`
- `test/smoke/trust-state.ts`

### Phase 4.4a TS-Aware Alignment Diagnostics

Shipped:

- `producer.field_shape_drift`
- `identity.boundary_mismatch`

Primary files:

- `packages/tools/src/diagnostics/common.ts`
- `packages/tools/src/diagnostics/ts-aware.ts`
- `test/smoke/alignment-diagnostics.ts`

### Phase 4.4b Structural And SQL Diagnostics

Shipped as a narrow first slice:

- `reuse.helper_bypass`
- `auth.role_source_drift`
- `sql.relation_alias_drift`

Primary files:

- `packages/tools/src/diagnostics/structural.ts`
- `test/smoke/alignment-diagnostics.ts`

Important note:

- the SQL/relation side is still heuristic/string-backed today
- Roadmap 4 does **not** claim a full parser-backed SQL diagnostic engine shipped

### Phase 4.5 Trust Surfaces

Shipped:

- additive trust/diagnostic/ranking fields on `AnswerResult`
- CLI trust rendering
- web trust presentation in `AnswerPacketCard`
- API/MCP inheritance of the shared answer contract where `AnswerResult` already flows

Primary files:

- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tools.ts`
- `packages/tools/src/trust/enrich-answer-result.ts`
- `apps/cli/src/commands/tools.ts`
- `apps/web/src/components/AnswerPacketCard.tsx`

### Phase 4.6 Ranking And Policy

Shipped:

- narrow evidence-backed ranking surface
- explicit ranking reason codes
- de-emphasis for stale / contradicted / insufficient / superseded histories
- diagnostic penalty for high-confidence high-severity issues

Primary files:

- `packages/tools/src/trust/enrich-answer-result.ts`
- `packages/tools/src/evals/runner.ts`
- real eval suites under `devdocs/test-project/`

### Post-Closeout Extensions

Two additive surface-layer extensions shipped after Phase 4.6 closed.
Neither modifies the trust contract or storage substrate:

**SARIF 2.1.0 output.** `AnswerSurfaceIssue` values render as SARIF so mako
findings integrate with GitHub Code Scanning, VS Code Problems panel,
GitLab Code Quality, and every other SARIF-aware consumer. The identity
triple (`matchBasedId` / `codeHash` / `patternHash`) maps directly onto
SARIF `partialFingerprints` for cross-run dedup, and both SARIF export
entrypoints now dedupe repeated `matchBasedId` values consistently.

Primary files:

- `packages/tools/src/sarif.ts`
- `test/smoke/sarif-output.ts`
- `devdocs/sarif-output.md`

**YAML rule-pack loader.** Teams author project-specific structural rules
in `<projectRoot>/.mako/rules/**/*.yaml`. Rule packs use the same
`findAstMatches` primitive the composer layer uses and emit
`AnswerSurfaceIssue` through the identical `buildSurfaceIssue` factory —
so rule-pack findings flow through trust enrichment, SARIF output, eval
assertions, and CLI/web surfaces with no format divergence.

The shipped integration caches compiled rule packs by project root for the
process lifetime and caches the app-surface heuristic by latest index run, so
the diagnostic layer no longer repeats filesystem discovery and broad app
surface detection on every answer.

Rule packs intentionally scope to single-file structural shapes. Cross-file
joins and semantic analysis stay on the built-in TS-aware diagnostic path.

Primary files:

- `packages/tools/src/rule-packs/types.ts`
- `packages/tools/src/rule-packs/schema.ts`
- `packages/tools/src/rule-packs/loader.ts`
- `packages/tools/src/rule-packs/evaluator.ts`
- `packages/tools/src/diagnostics/index.ts` (integration point)
- `test/smoke/rule-packs.ts`
- `devdocs/rule-packs.md`

Depends on newly-added `yaml@^2.8.3` in `packages/tools`.

**Shared code-intel primitive.** `findAstMatches` was lifted from
`composers/_shared/ast-patterns.ts` to `packages/tools/src/code-intel/`
so diagnostics and rule packs both consume it from one canonical location.
`collectQueryUsages` was refactored off hand-walked TS AST onto the shared
primitive, removing a duplicated Supabase-call finder.

Primary files:

- `packages/tools/src/code-intel/ast-patterns.ts`
- `packages/tools/src/code-intel/index.ts`
- `packages/tools/src/diagnostics/common.ts` (refactored `collectQueryUsages`)

## Working Principle That Held

Roadmap 4 succeeded by keeping one rule intact:

Does this make answers more comparable, more falsifiable, or more explicitly trustworthy without rebuilding the already-shipped harness/model/tool substrate?

If the answer was no, it did not belong in Roadmap 4.

## Post-Closeout Sidecars

One explicit sidecar now sits beside the closed Roadmap 4 trust layer:

- `Phase 4.7 Workflow Context Bridge`

This is not a retroactive addition to the original trust sequence. It is a
targeted follow-on planning slice that avoids awkward layering later.

`4.7` is the workflow-context prep sidecar for Roadmap 5.

It should not reopen trust storage, contradiction policy, rerun semantics, or
evaluation contracts.

Its initial bridge slice is now landed:

- `packages/contracts/src/workflow-context.ts`
- `packages/contracts/src/tools.ts` (`WorkflowContextBundleSchema` /
  `WorkflowContextItemSchema`)
- `packages/tools/src/workflow-context/index.ts`
- `test/smoke/workflow-context-bridge.ts`

That means Roadmap 5 no longer needs to start by inventing its own raw
`AnswerResult` extraction seam.

The bridge run is now effectively complete as a sidecar:

- route identities normalize by method + pattern instead of raw route source ref
- symbol identities normalize by exported symbol identity where available
- one shared `WorkflowPacketRequest` / `WorkflowPacketInput` contract now sits
  between the bridge bundle and future packet generators

## Required References

Use these as the closure baseline for future work:

- [./roadmap.md](./roadmap.md)
- [./phases/README.md](./phases/README.md)
- [../../master-plan.md](../../master-plan.md)
- [../version-3/handoff.md](../version-3/handoff.md)

## What Comes Next

Roadmap 5 should now start from the trust-aware answer contract instead of reopening trust substrate work.

Roadmap 5 assumptions should be:

- trust history is already persisted
- rerun/compare is already available
- trust state is explicit
- diagnostics can already contribute to trust interpretation
- trust is already consumable through CLI, API/MCP, and web

If `4.7` lands first, Roadmap 5 should additionally assume:

- a typed workflow-context item seam exists in shared contracts
- `AnswerResult` can be converted into packet-friendly context items through
  one shared extraction path instead of bespoke per-packet parsing
- the bridge already classifies `primary` vs `supporting` context and carries
  `openQuestions`
- one shared packet-entry contract already exists for packet family + scope +
  focus + watch intent

Roadmap 5 should package those shipped signals into higher-order workflow-context packets:

- implementation briefs
- impact packets
- precedent packs
- verification plans
- workflow recipes

Those outputs should stay typed, evidence-backed, and explicitly requestable.

The preferred execution model is:

- on-demand packet generation first
- explicit watch-mode workflow assistance second
- optional git hook / CI scheduled automation later

Do not reopen the Fenrir mistake of making a scheduler or background worker a core dependency before the workflow packet layer exists and is trusted on its own.
