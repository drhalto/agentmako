# Phase 8.0 Docs And Telemetry Contract

Status: `Planned`

## Goal

Open Roadmap 8 with a clean documentation package and a typed runtime
telemetry contract that mirrors the shape the eval runner already
computes. This phase is docs + contract types only — no write paths,
no behavior change, no ranking / routing / exposure shifts.

## Hard Decisions

- docs ship first; contract types ship in the same phase but behind no
  runtime callers
- telemetry rows are append-only and local-first; no remote shipping
- the decision envelope is one shared shape across ranking / routing /
  exposure learned surfaces
  (`{ baseline, learned_delta, final_decision, rollback_reason? }`) —
  not three parallel shapes
- runtime usefulness events mirror `evaluateArtifactUsefulness` /
  `evaluatePowerWorkflowUsefulness` / `evaluateWorkflowPacketUsefulness`
  output shape; no new grading logic
- this phase does **not** add a `mako_usefulness_events` table — that
  lands in 8.1 alongside the write paths

## Why This Phase Exists

- R7 closed at 7.5 with static thresholds and a note that R8 should
  raise them. Raising them requires a capture path; capture requires a
  contract.
- The eval runner already produces the right shape
  (`TrustEvalRunSummary.artifactUsefulness`, `powerWorkflowUsefulness`);
  interactive flows drop the signal on the floor.
- Without a typed contract landing first, 8.1 write paths become one-off
  shapes per site and 8.2+ read models cannot be reused across them.

## Scope In

- create `devdocs/roadmap/version-8/{README.md, roadmap.md, handoff.md,
  phases/README.md, phases/phase-8.0...phase-8.6.md}`
- define `RuntimeUsefulnessEvent`, `RuntimeRankingDecision`,
  `RuntimeRoutingDecision`, `LearnedDecisionEnvelope` types in
  `packages/contracts/src/runtime-telemetry.ts`
- re-export from `packages/contracts/src/index.ts`
- add focused smoke that round-trips the contract through zod and
  asserts the envelope invariants

## Scope Out

- no table migration, no write path, no read path
- no ranking / routing / exposure behavior change
- no CLI / HTTP surface
- no experiment-flag registry (that lands in 8.3 / 8.4 alongside its
  first real consumer)

## Architecture Boundary

### Owns

- `devdocs/roadmap/version-8/` (the docs package)
- `packages/contracts/src/runtime-telemetry.ts` (new file)
- the telemetry barrel re-export in `packages/contracts/src/index.ts`

### Does Not Own

- any storage / migration / write path (`8.1`)
- any read model or aggregation (`8.2`)
- any experiment flag machinery (`8.3` / `8.4`)
- any CLI / inspection surface (`8.1`)

## Contracts

### `RuntimeUsefulnessEvent`

Runtime analogue of
`TrustEvalRunSummary.{artifactUsefulness, powerWorkflowUsefulness, packetUsefulness}`.
Emitted at the decision site when the typed output is still in scope.

```ts
type RuntimeUsefulnessEvent = {
  eventId: string;              // opaque; ULID-shaped
  projectId: string;
  requestId: string;            // binds to the originating API / MCP call
  traceId?: string;             // when the caller supplied one
  capturedAt: string;           // ISO-8601

  decisionKind:
    | "artifact_usefulness"
    | "power_workflow_usefulness"
    | "packet_usefulness"
    | "wrapper_usefulness";

  family: string;               // e.g. "task_preflight", "flow_map"
  toolName?: string;            // when the event came from a tool call

  grade: "full" | "partial" | "no";
  reasonCodes: string[];        // reuse the per-family enum from the
                                // shipped evaluator; not a new vocabulary

  observedFollowupLinked?: boolean;
  reason?: string;              // short human string from the evaluator
};
```

Rules:

- `grade` and `reasonCodes` must come from the shipped evaluator; no
  new grading in this phase
- `eventId` is opaque; callers do not join on it
- `requestId` + `traceId` are the join keys for correlation with
  `tool_runs` / benchmark runs
- `capturedAt` is ISO-8601 with explicit offset (enforced via
  `z.string().datetime({ offset: true })`). Downstream SQLite `ORDER BY`
  and `since` / `until` filters rely on ISO lexicographic ordering —
  accepting free-form strings would break those queries silently.

### `LearnedDecisionEnvelope`

The shared shape every learned surface emits.

```ts
type LearnedDecisionEnvelope<T> = {
  surface: string;              // which learned surface produced this
                                // envelope (e.g. "tool_search_rank",
                                // "packet_attachment", "artifact_promotion")
  policyVersion: string;        // version of the deterministic baseline
                                // policy this envelope reasoned against
  experimentId?: string;        // experiment-flag / rollout id when the
                                // delta came from an active experiment

  baseline: T;                  // what deterministic policy would have chosen
  learnedDelta: {
    applied: boolean;
    reason: string;             // why the delta was / was not applied
    boundedBy: string;          // name of the cap that constrained it
  };
  finalDecision: T;             // baseline or baseline + delta
  rollbackReason?: string;      // present when a demotion fired
};
```

Rules:

- `surface`, `policyVersion`, and `experimentId` (when present) are the
  audit triple — given any envelope, a reviewer must be able to trace
  back to exactly which learned policy produced the delta and under
  which experiment
- `policyVersion` bumps whenever the deterministic baseline or its
  declared caps change; stale envelopes referencing a retired
  `policyVersion` are still readable but do not inform new decisions
- `baseline === finalDecision` when `learnedDelta.applied === false`
  (enforced via `.superRefine`)
- `rollbackReason` may only be present when `learnedDelta.applied ===
  false` (enforced via `.superRefine`). This captures the "decision
  reverted to baseline after a demotion fired" state — a non-null
  `rollbackReason` alongside `applied === true` is schema-rejected
  because the delta is still active and there is nothing to roll back.
  The broader "demotion window" concept is a 8.3 / 8.4 policy concern
  on top of this contract, not a schema-level invariant.
- `boundedBy` names a declared cap (`"max-rank-shift=3"`,
  `"max-threshold-drift=0.02"`) so audits can trace why the delta was
  not larger

### `RuntimeRankingDecision` / `RuntimeRoutingDecision`

Sibling shapes that carry the envelope plus ranking / routing inputs.

```ts
type RuntimeRankingDecision = {
  eventId: string;
  projectId: string;
  requestId: string;
  capturedAt: string;
  // surface / policyVersion / experimentId live on envelope below;
  // they are not re-declared here to avoid drift between the two
  inputs: { candidateId: string; baselineRank: number }[];
  envelope: LearnedDecisionEnvelope<{ orderedCandidateIds: string[] }>;
};

type RuntimeRoutingDecision = {
  eventId: string;
  projectId: string;
  requestId: string;
  capturedAt: string;
  candidates: string[];
  envelope: LearnedDecisionEnvelope<{ chosenCandidate: string }>;
};
```

Rules:

- the envelope is the single source of truth for `surface` /
  `policyVersion` / `experimentId`; decision-type wrappers must not
  re-declare them
- `inputs` / `candidates` record what the deterministic baseline saw;
  the envelope's `baseline` records what the baseline chose from them

### Error Contract

- schema validation uses zod; parse errors surface at the write-path
  boundary in 8.1, not inside the evaluator
- the contract is internal to mako; no HTTP / MCP exposure in this phase

## Execution Flow

1. Create the V8 docs package — this doc plus the six sibling phase
   docs and the three package-level docs.
2. Add `packages/contracts/src/runtime-telemetry.ts` with the four types
   above plus zod schemas (`RuntimeUsefulnessEventSchema`,
   `LearnedDecisionEnvelopeSchema`, etc.).
3. Re-export from `packages/contracts/src/index.ts`.
4. Add `test/smoke/runtime-telemetry-contract.ts` — round-trip a fixture
   through each schema and assert:
   - `surface` and `policyVersion` are non-empty on every envelope
   - `baseline === finalDecision` when `applied=false`
   - `rollbackReason` only present when the envelope came from a
     demotion window
   - `boundedBy` is non-empty when `applied=true`
5. Register the smoke in `test:smoke`.
6. Run `pnpm typecheck` + `pnpm run test:smoke` green.

## File Plan

Create:

- `devdocs/roadmap/version-8/README.md`
- `devdocs/roadmap/version-8/roadmap.md`
- `devdocs/roadmap/version-8/handoff.md`
- `devdocs/roadmap/version-8/phases/README.md`
- `devdocs/roadmap/version-8/phases/phase-8.0-docs-and-telemetry-contract.md`
- `devdocs/roadmap/version-8/phases/phase-8.1-live-usefulness-telemetry.md`
- `devdocs/roadmap/version-8/phases/phase-8.2-learned-read-models.md`
- `devdocs/roadmap/version-8/phases/phase-8.3-bounded-learned-ranking-and-routing.md`
- `devdocs/roadmap/version-8/phases/phase-8.4-learned-promotion-attachment-and-rollout.md`
- `devdocs/roadmap/version-8/phases/phase-8.5-failure-clustering-and-optimization-experiments.md`
- `devdocs/roadmap/version-8/phases/phase-8.6-usefulness-evaluation-and-default-exposure.md`
- `packages/contracts/src/runtime-telemetry.ts`
- `test/smoke/runtime-telemetry-contract.ts`

Modify:

- `packages/contracts/src/index.ts` — re-export the new types
- root `package.json` or the smoke-runner manifest — register the new
  smoke
- `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added` once
  contract code lands

Keep unchanged:

- every existing evaluator, write path, or decision site
- every V7 doc (do not rewrite forward-looking references to Roadmap 8;
  add, do not mutate)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required docs checks:

- the V8 package reads cleanly from README → roadmap → handoff →
  phases/README → 8.0 → 8.1..8.6 without cross-reference breaks
- phase-8.0 cites real reference file paths and real shipped mako files
  (no hallucinated anchors)

## Done When

- the V8 docs package exists and renders without broken internal links
- `packages/contracts/src/runtime-telemetry.ts` exports the four types
  plus zod schemas and compiles
- `test/smoke/runtime-telemetry-contract.ts` passes under `test:smoke`
- `pnpm typecheck` green
- no runtime behavior change anywhere in the product
- CHANGELOG `## [Unreleased]` carries an 8.0 entry once contract code
  lands

## Risks And Watchouts

- **Over-designing the envelope.** Resist adding fields for cases 8.3 /
  8.4 have not identified yet. If a later phase needs more, extend then.
- **Forgetting the `reasonCodes` vocabulary constraint.** `reasonCodes`
  must come from the shipped per-family evaluator; inventing a parallel
  vocabulary here creates divergence that 8.2 read models will trip on.
- **Writing V8 docs that rewrite forward-looking V5 / V6 / V7
  references.** Docs evolution rule: add, don't mutate. Existing
  "Roadmap 8 is where telemetry…" lines in V7 are still accurate.

## References

- [../../../master-plan.md](../../../master-plan.md) — R8 contract
- [../roadmap.md](../roadmap.md) — V8 canonical roadmap
- [../handoff.md](../handoff.md) — V8 execution rules
- `packages/tools/src/artifact-evaluation.ts` — shipped evaluator shape
  this contract mirrors
- `packages/tools/src/workflow-evaluation.ts` — shipped power-workflow
  evaluator
- `packages/tools/src/evals/runner.ts:240-241` — where usefulness
  evaluations currently live (eval-only, not runtime)
- `codex-rs/features/src/lib.rs` (reference) — staged-rollout registry
- `codex-rs/network-proxy/src/network_policy.rs:229-256` (reference) —
  decision envelope shape
- `cody-public-snapshot-main/vscode/src/completions/analytics-logger.ts`
  (reference) — lifecycle capture pattern
