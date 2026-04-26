# Phase 8.1 Live Usefulness Telemetry

Status: `Shipped`

## Shipped Slice

All four execution slices (8.1a–8.1d) landed:

- **8.1a — Storage substrate**: migration `0025_project_runtime_telemetry`
  adds `mako_usefulness_events` with `no-update` / `no-delete` triggers and
  three indices (`project_id + captured_at DESC`,
  `decision_kind + family + captured_at DESC`, `request_id`). Store
  accessor `insertUsefulnessEventImpl` / `queryUsefulnessEventsImpl` in
  `packages/store/src/project-store-runtime-telemetry.ts`; the insert
  parses the fully-formed event through `RuntimeUsefulnessEventSchema`
  before running SQL, so contract invariants (ISO-8601 `capturedAt`,
  non-empty `projectId` / `requestId` / `family`, non-empty
  `reasonCodes` entries, enum values for `decisionKind` / `grade`) are
  enforced at the single write-path boundary — direct store callers
  and emitter callers get the same rejection. SQL CHECK constraints
  stay as a defense-in-depth layer on `decision_kind` and `grade`. Thin
  `createRuntimeTelemetryEmitter` + `NOOP_RUNTIME_TELEMETRY_EMITTER`
  helpers in `packages/tools/src/runtime-telemetry/emit.ts`; the emitter
  catches the parse failure, logs via its configured logger, and never
  propagates to the user-facing call. Smoke:
  `test/smoke/runtime-telemetry-storage.ts` (six negative cases covering
  malformed ISO, empty strings, and unknown enum values).
- **8.1b — Write-path adapters**:
  `captureRuntimeUsefulnessForToolInvocation` emits from the `invokeTool`
  finally hook for every power-workflow + artifact tool (including
  `tool_plane` wrapper grade on every artifact call and `file_export`
  wrapper grade when export is requested).
  `captureRuntimePacketUsefulnessForAnswerResult` emits packet
  usefulness from `enrich-answer-result.ts` after enrichment.
  `captureRuntimeUsefulnessForToolInvocation` borrows
  `ProjectStoreCache` when present and otherwise opens/closes its own
  project store. Both entry points swallow every failure. Smoke:
  `test/smoke/runtime-telemetry-capture.ts`.
- **8.1c — Inspection surface**: `runtime_telemetry_report` read-only
  tool on the shared tool plane (new `runtime_telemetry` category).
  Aggregates are computed via SQL `GROUP BY` in the store layer
  (`countUsefulnessEvents`, `aggregateUsefulnessEventsBy{DecisionKind,Family,Grade}`)
  so they stay accurate regardless of table size — the event list is
  the only shape that pages, and `eventsInWindow` is the true matching
  count, not a page size. `agentmako telemetry show <project>
  [--kind K] [--family F] [--request-id R] [--since ISO] [--until ISO]
  [--limit N]` wraps the tool; the CLI validates the same `limit`
  cap (500) locally so callers get a clean error rather than a late
  schema rejection. Smoke: `test/smoke/runtime-telemetry-report.ts`
  (drives capture → store → report end-to-end through `invokeTool`,
  and asserts aggregates are consistent when the event list is truncated).
- **8.1d — Docs + CHANGELOG**: phase doc flipped to `Shipped`; roadmap
  `phase-summary` + `current status` updates; `CHANGELOG` entry under
  `## [Unreleased]` → `### Added`.

Behavior impact: every interactive answer / tool / artifact call now
persists typed usefulness telemetry to `mako_usefulness_events`. No
ranking / routing / exposure behavior changed. 8.2+ read models and
8.3+ learned deltas are the natural next step, gated on accumulated
real-world history.


## Goal

Persist append-only runtime telemetry rows from every interactive
answer / tool / artifact call using the 8.0 contract. Reuse the shipped
evaluators rather than inventing new grading. No ranking / routing /
exposure behavior change in this phase — read paths land later.

## Hard Decisions

- the telemetry table is append-only with `no-update` / `no-delete`
  triggers, matching the `tool_runs` / `lifecycle_events` /
  `benchmark_*` pattern already in `project.db`. Rows are immutable
  once written; compaction is an operator action, not a default TTL
- one row per eligible decision; no batching / buffering in this phase
- a write failure is fatal for the write, not for the decision — a
  failed telemetry write must never fail the user-facing answer or tool
  call
- the inspection surface is one read-only tool plus one CLI reader; no
  web UI

## Why This Phase Exists

- `evaluateArtifactUsefulness` / `evaluatePowerWorkflowUsefulness` /
  `evaluateWorkflowPacketUsefulness` run only inside
  `packages/tools/src/evals/runner.ts`; interactive flows drop the
  signal on the floor.
- 8.2+ read models need a real table of typed events; the 8.0 contract
  alone is not enough to build on.
- An inspection surface prevents "we have the data but cannot see it."

## Scope In

- new migration adding `mako_usefulness_events` plus any related tables
- write adapters at every `RuntimeUsefulnessEvent` decision site:
  - `packages/tools/src/trust/enrich-answer-result.ts` — packet /
    power-workflow usefulness at answer time
  - artifact tool handlers (`task_preflight_artifact`,
    `implementation_handoff_artifact`, `review_bundle_artifact`,
    `verification_bundle_artifact`)
  - workflow-packet composer outputs
- one read-only inspection tool (`runtime_telemetry_report`) on the
  shared tool plane
- a CLI subcommand that wraps the inspection tool. Proposed shape:
  `agentmako telemetry show` — must be reconciled against the
  `CLI_COMMANDS` taxonomy in `apps/cli/src/shared.ts` at implementation
  time (existing precedents: `memory ...`, `semantic ...`,
  `workflow packet`). The exact namespace is a decision, not a
  commitment
- smoke coverage per write site plus an end-to-end replay smoke

## Scope Out

- no ranking / routing / exposure behavior change
- no aggregated read models (8.2)
- no learned decision envelope production (8.3 / 8.4)
- no `RuntimeRoutingDecision` or `RuntimeRankingDecision` write paths
  in this phase. Routing pre-observation at
  `packages/tools/src/workflow-packets/attachment-policy.ts` and ranking
  pre-observation at `tool_search` / answer-rank sites are deferred to
  8.3, where they land alongside their first learned-delta consumer.
  `enrich-answer-result.ts` already captures whether an attached packet
  earned its grade — that is the 8.1 signal for attachment outcomes.
- no remote telemetry shipping — local only

## Done When

- every eligible interactive decision site emits a typed telemetry row
- the inspection tool returns a stable, typed view of recent events
  filterable by `projectId`, `family`, `decisionKind`, and time window
- smoke coverage green: per-site writes + inspection replay
- `pnpm typecheck` + `pnpm run test:smoke` green
- no ranking / routing / exposure behavior has shifted

## Risks And Watchouts

- **Write-path coupling.** A naive adapter turns every decision site
  into a dependency on the telemetry writer. Keep adapters behind a
  thin `emitRuntimeTelemetry(...)` helper so the writer can be swapped
  or silenced without editing every call site.
- **Row volume.** Production usage will produce thousands of rows per
  session. The table is append-only with no-update / no-delete triggers,
  matching the `tool_runs` / `lifecycle_events` audit pattern in
  `packages/store/src/migration-sql.ts`. If volume becomes a real
  problem, solve it through operator-managed compaction (rollup
  extraction into derived tables and `VACUUM` after) or archival
  export — not through a default TTL / delete policy. Index
  `projectId + capturedAt` so range scans stay cheap regardless of
  total row count.
- **Privacy.** No `reason` string that might contain user query text
  should land in a telemetry row without the same safe-vs-private split
  that cody's `splitSafeMetadata` uses. If the evaluator's `reason`
  field is sensitive, hash or drop it.

## Natural Pause

Roadmap 8 pauses between this phase and 8.2. See
[../README.md#natural-pause](../README.md#natural-pause).

## Phase Execution Slices

The phase ships in four independently verifiable slices. Stopping
between any two is safe — no slice leaves behind partial state.

- **8.1a — Storage substrate.** Migration adding
  `mako_usefulness_events` with `no-update` / `no-delete` triggers and
  the `projectId + capturedAt` index; store accessor module with
  `insertUsefulnessEvent` / `queryUsefulnessEvents`; thin
  `emitRuntimeTelemetry(...)` helper so adapters can be silenced
  uniformly. Smoke: write + query round-trip.
- **8.1b — Write-path adapters.** Wire `emitRuntimeTelemetry` into the
  three `RuntimeUsefulnessEvent` sites (enrich-answer-result + four
  artifact handlers + workflow-packet composers). Smoke per site.
- **8.1c — Inspection surface.** `runtime_telemetry_report` read-only
  tool on the shared tool plane plus the CLI wrapper. End-to-end replay
  smoke drives the full write → query → report path.
- **8.1d — CHANGELOG + phase doc close.** Flip `Status: Shipped`,
  record the shipped slice, add the `## [Unreleased] → ### Added`
  entry.

## References

- `packages/tools/src/evals/runner.ts:240-241`
- `packages/tools/src/artifact-evaluation.ts`
- `packages/tools/src/workflow-evaluation.ts`
- `packages/tools/src/trust/enrich-answer-result.ts`
- `packages/store/src/migration-sql.ts` — append-only audit-table pattern
- `packages/tools/src/workflow-packets/attachment-policy.ts` — deferred
  to 8.3 per Scope Out
- `continue-main/core/data/devdataSqlite.ts` (reference)
- `cody-public-snapshot-main/vscode/src/completions/analytics-logger.ts`
  (reference)
