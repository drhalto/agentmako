# Phase 8 CC — Agent Feedback Channel

Status: `Complete`

`agent_feedback` requires `referencedToolName` and
`referencedRequestId` so every feedback row is scoped to a specific
prior tool run, not a loose opinion about a tool.

## Deployment Observation

R8.1 ships four decision-kind telemetry rows automatically:
`artifact_usefulness`, `power_workflow_usefulness`,
`packet_usefulness`, `wrapper_usefulness`. Initial Testing Phase 1
added `finding_ack` as a fifth. All five are *inferred* — the grader
looks at a tool output and decides how useful it was, based on
shape-level heuristics.

What's missing is **the consumer's direct signal**: the agent calling
the tool. The agent knows exactly whether the tool call helped answer
the question at hand. That signal is the single most valuable input
to future learned routing (R8.2+), and mako has no way to receive it.

Concrete scenarios:

- Agent runs `cross_search` for "admin auth"; gets 40 hits; the
  useful one is at position 12. Today: nothing happens. With
  feedback: agent calls `agent_feedback { referencedToolName:
  "cross_search", referencedRequestId: "req_cross_1", grade:
  "partial", reasonCodes: ["too_many_hits", "top_not_useful"] }`.
  Telemetry row lands.
- Agent runs `table_neighborhood` (Phase 7) on `admin_audit_log`;
  the `dependentRpcs` section is empty but the agent knew `admin_
  ban_user` writes to it. Feedback includes `referencedToolName:
  "table_neighborhood"`, `referencedRequestId: "req_table_1"`,
  `grade: "partial"`, and `reasonCodes: ["missing_known_caller"]`.
  That's a concrete signal that either the indexer missed something
  or the graph walk underfires — worth investigating.
- Agent runs `ask` on a trust-unstable question; the answer is
  wrong but the agent corrected it by reading the right file
  directly. Feedback includes `referencedToolName: "ask"`, the
  failed call's `referencedRequestId`, `grade: "no"`, and
  `reasonCodes: ["answer_wrong", "low_support_level"]` with a
  free-text note.

Every one of these is training data mako doesn't collect today. The
closest proxy — `finding_ack` — only fires on AST / lint false-
positives, not on general tool-call usefulness.

## Goal

Ship `agent_feedback` as a first-class mutation tool. The agent calls
it with a reference to a prior tool run (by `requestId` + `toolName`)
and a typed grade + reason codes. Each call writes one
`RuntimeUsefulnessEvent` row with `decisionKind: "agent_feedback"`
so the existing R8.1 pipeline carries it straight into what R8.2+
will consume.

Also ship `agent_feedback_report` as the read-side: what feedback has
the agent submitted, grouped by tool, so operators (and future R8.5
failure-clustering) can see patterns.

## Hard Decisions

- **Feedback is scoped to tool runs, not open-ended.**
  Every `agent_feedback` call references a specific prior tool run
  by `referencedToolName` and `referencedRequestId`. No free-floating
  "mako is slow today" signals — those belong in a bug tracker, not
  the telemetry pipeline.

- **`reasonCodes` is a free `string[]` but with a recommended
  vocabulary.**
  Mirrors R8.1's existing reason-code convention: per-evaluator
  vocabularies that the grader owns. The agent supplies whatever
  codes make sense; the tool description recommends a starter
  vocabulary per grade. Over time, a real vocabulary will emerge
  from use — that's when R8.2+ can formalize.

- **`grade` reuses R8.1's `RuntimeUsefulnessGrade`
  (`full | partial | no`).**
  Same semantics: `full` = "this was exactly what I needed",
  `partial` = "useful but incomplete / noisy / wrong level",
  `no` = "this wasted the turn."

- **Widens `mako_usefulness_events.decision_kind` CHECK.**
  Same migration pattern as Initial Testing Phase 1's 0027 (which
  already added `finding_ack`). This one adds `agent_feedback` via
  the same create-new / copy / drop-old / rename dance. Each phase
  that adds a decision kind owns its own widening migration — no
  shared "all future kinds" enum.

- **Write path emits through the R8.1 emitter.**
  Reuses `createRuntimeTelemetryEmitter`. Feedback row has
  `decisionKind: "agent_feedback"`, `family: referencedToolName`,
  `toolName: "agent_feedback"`, `grade` + `reasonCodes` from the
  caller, optional free-text `reason`.

- **No automatic behavior change.**
  Feedback accumulates. It is not consumed by any runtime decision
  today. R8.2+ opens consumption paths; this phase is write-only
  plus the read-side inspection tool.

## Scope In

- new migration widening
  `mako_usefulness_events.decision_kind` CHECK to include
  `agent_feedback`
- new contract types: `AgentFeedbackToolInput/Output`,
  `AgentFeedbackReportToolInput/Output`
- new tool: `agent_feedback` (mutation), category `feedback`
- new tool: `agent_feedback_report` (read-only), category `feedback`
- register both in `tool-definitions.ts`
- `ClaudeCodeClient` hints:
  - `agent_feedback`: `"rate tool result usefulness feedback signal"`
  - `agent_feedback_report`: `"prior feedback history group tool"`
  - neither gets `alwaysLoad`
- smoke: `agent-feedback.ts` — round-trip; asserts R8.1 row lands
  with correct shape; asserts duplicate-reference handling
- extend the existing runtime-telemetry report tool to surface
  `agent_feedback` rows naturally (no change needed if it already
  lists all decision kinds — verify)

## Scope Out

- consuming feedback for learned routing (R8.2+)
- aggregating feedback into a "tool reliability" score (R8.5+)
- soliciting feedback from the agent proactively (that's a harness
  concern, not mako)
- UI for reviewing feedback (use `agent_feedback_report` over MCP /
  CLI)
- cross-project feedback surfaces (scoped per project by design)

## Architecture Boundary

### Owns

- migration `PROJECT_MIGRATION_XXXX_AGENT_FEEDBACK_DECISION_KIND_SQL`
- `packages/contracts/src/runtime-telemetry.ts` — extend
  `RUNTIME_USEFULNESS_DECISION_KINDS` with `"agent_feedback"`
- `packages/contracts/src/tool-agent-feedback-schemas.ts` (new)
- `packages/tools/src/agent-feedback/` (new directory)
- `packages/contracts/src/tool-registry.ts` — add tool names +
  `feedback` category
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — hints
- `test/smoke/agent-feedback.ts` (new)

### Does Not Own

- R8.1 emission pipeline itself (reuses, not replaces)
- runtime telemetry's existing decision kinds
- any consumer of the telemetry rows — this is write + inspect
  only

## Contracts

### `AgentFeedbackToolInput` / `Output`

```ts
// packages/contracts/src/tool-agent-feedback-schemas.ts
import { RuntimeUsefulnessGradeSchema } from "./runtime-telemetry.js";

export interface AgentFeedbackToolInput {
  projectId?: string;
  projectRef?: string;
  /**
   * The tool this feedback is about. Required — feedback is scoped
   * to a prior tool run, not open-ended.
   */
  referencedToolName: string;
  /**
   * The requestId the referenced tool call ran under. Required —
   * feedback is scoped to a specific prior tool run.
   */
  referencedRequestId: string;
  /**
   * `full` = exactly what I needed, `partial` = useful but
   * incomplete / noisy / wrong level, `no` = wasted the turn.
   */
  grade: RuntimeUsefulnessGrade;
  /**
   * Non-empty array of reason codes. Recommended vocabulary per
   * grade — see tool description. Free-form strings; future R8.2+
   * work may formalize.
   */
  reasonCodes: string[];
  /** Optional free-text explanation. Bounded to keep context small. */
  reason?: string;
}

export interface AgentFeedbackToolOutput {
  toolName: "agent_feedback";
  projectId: string;
  eventId: string;           // the RuntimeUsefulnessEvent row written
  capturedAt: string;
}
```

### `AgentFeedbackReportToolInput` / `Output`

```ts
export interface AgentFeedbackReportToolInput {
  projectId?: string;
  projectRef?: string;
  referencedToolName?: string;
  grade?: RuntimeUsefulnessGrade;
  since?: string;
  until?: string;
  limit?: number;            // default 50, cap 500
}

export interface AgentFeedbackAggregate {
  referencedToolName: string;
  full: number;
  partial: number;
  no: number;
  total: number;
}

export interface AgentFeedbackEntry {
  eventId: string;
  capturedAt: string;
  referencedToolName: string;
  referencedRequestId: string;
  grade: RuntimeUsefulnessGrade;
  reasonCodes: string[];
  reason?: string;
}

export interface AgentFeedbackReportToolOutput {
  toolName: "agent_feedback_report";
  projectId: string;
  feedbackInWindow: number;
  byTool: AgentFeedbackAggregate[];
  entries: AgentFeedbackEntry[];
  truncated: boolean;
  warnings: string[];
}
```

### Decision kind extension

```ts
// packages/contracts/src/runtime-telemetry.ts
export const RUNTIME_USEFULNESS_DECISION_KINDS = [
  "artifact_usefulness",
  "power_workflow_usefulness",
  "packet_usefulness",
  "wrapper_usefulness",
  "finding_ack",
  "agent_feedback",
] as const;
```

### Migration shape

Mirrors Initial Testing Phase 1's migration 0027: create new table
with widened CHECK, `INSERT ... SELECT`, `DROP`, `ALTER TABLE RENAME`,
recreate indexes + triggers.

## Execution Flow (slices)

1. **Migration + contract** — widen the CHECK; extend
   `RUNTIME_USEFULNESS_DECISION_KINDS`; ship the two tool contract
   files. Smoke: migration round-trips; new decision kind accepts
   on insert via `insertUsefulnessEventImpl`.
2. **Recommended-vocabulary documentation** — the tool description
   for `agent_feedback` names a starter vocabulary per grade. Example:
   - `full`: `answer_complete`, `evidence_sufficient`, `trust_matches`
   - `partial`: `partial_coverage`, `noisy`, `stale_evidence`,
     `missing_known_caller`, `top_not_useful`
   - `no`: `answer_wrong`, `wasted_turn`, `tool_did_nothing`,
     `schema_missing`
   Agents are free to invent codes; the starter set is a seed. Documented
   in the tool's description string itself so the model sees it.
3. **`agent_feedback` tool** — thin mutation tool that builds the
   `RuntimeUsefulnessEvent` row and emits through the R8.1
   `createRuntimeTelemetryEmitter` path. Smoke: assert row lands
   with correct shape; requestId link preserves; duplicate feedback
   on the same (referencedToolName, referencedRequestId) lands as
   distinct events (append-only by design).
4. **`agent_feedback_report` tool** — read-only over
   `mako_usefulness_events WHERE decision_kind = 'agent_feedback'`,
   with aggregates by referencedToolName + bounded entry list.
   Reuses existing aggregation patterns from
   `runtime-telemetry-report`.
5. **Verify R8.1 reporting tool picks up the new rows.** The
   existing `runtime_telemetry_report` tool lists events by
   `decisionKind`; confirm that filtering by
   `decisionKind: "agent_feedback"` returns rows written by this
   phase. If the tool currently hardcodes a decision-kind list in
   a way that excludes newcomers, patch it to use
   `RUNTIME_USEFULNESS_DECISION_KINDS` as source.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/contracts/src/tool-agent-feedback-schemas.ts`
- `packages/tools/src/agent-feedback/index.ts`
- `packages/tools/src/agent-feedback/feedback.ts`
- `packages/tools/src/agent-feedback/report.ts`
- `test/smoke/agent-feedback.ts`

Modify:

- `packages/store/src/migration-sql.ts` — new widening migration
- `packages/store/src/project-store.ts` — register migration
- `packages/contracts/src/runtime-telemetry.ts` — extend enum
- `packages/contracts/src/index.ts` — re-export
- `packages/contracts/src/tools.ts` — extend unions
- `packages/contracts/src/tool-registry.ts` — add tool names +
  `feedback` category
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — hints
- `package.json` — register smoke
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Added`

Keep unchanged:

- R8.1 telemetry emission pipeline (reused unchanged)
- existing decision kinds' behavior
- `finding_ack` tool (different purpose — false-positive ack vs
  tool usefulness feedback)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `agent-feedback.ts`:
  - migration applies cleanly on a fresh store
  - calling `agent_feedback` writes one
    `RuntimeUsefulnessEvent` with `decisionKind: "agent_feedback"`
  - `referencedToolName` → `family`, `referencedRequestId` →
    `requestId` mapping correct
  - `reasonCodes` round-trips faithfully
  - calling `agent_feedback_report` returns the row; aggregates by
    tool are correct
  - two feedbacks on the same tool+requestId persist as distinct
    events (append-only)
- existing `runtime-telemetry-*.ts` smokes still pass with the
  widened CHECK (update their hardcoded decision-kind assertions
  in the same commit)
- MCP `tools/list` carries both new tools with expected metadata; the
  tool-search catalog carries category `feedback`

## Done When

- migration widening the CHECK applied and registered
- `RUNTIME_USEFULNESS_DECISION_KINDS` extended with
  `agent_feedback`
- both contract schemas shipped
- both tools registered; MCP tools/list correct
- new smoke green; existing telemetry smokes updated + green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **`runtime_telemetry_report` hardcodes decision-kind list.**
  Check existing report tool — if it hardcodes the pre-Phase-1
  four-kind enum anywhere, update to consume
  `RUNTIME_USEFULNESS_DECISION_KINDS` as source. Same caveat surfaced
  during Initial Testing Phase 1; probably fine but worth verifying.
- **Agent over-reports feedback.**
  If the agent is told "submit feedback after every tool call,"
  the telemetry volume balloons and the per-call token cost adds
  up. Mitigation: tool description explicitly says *"use when the
  tool's result was notably good / notably bad / obviously wrong
  — don't submit routine 'worked fine' feedback."* Keeping signal
  sparse keeps it valuable for R8.2+ consumers.
- **Low-quality reason codes.**
  If every `no` grade carries `reasonCodes: ["bad"]`, the signal
  is useless. Recommended-vocabulary in the tool description helps;
  post-R8.2+ learning loop will surface which codes the model
  actually picks and whether they cluster meaningfully.
- **Migration interaction with Initial Testing 0027.**
  That migration also widens the CHECK. We ship a separate
  migration here to add `agent_feedback`. Two widening migrations
  in a row works fine because each is a full table-recreate that
  redefines the CHECK. If both are unapplied on a legacy DB, they
  run in order — the later one wins. Verified by typecheck of the
  migration registration.
- **Feedback on `agent_feedback` itself.**
  The tool allows `referencedToolName: "agent_feedback"`. Harmless
  but cyclical; log analytics to watch for it. If agents start
  meta-feedbacking, address in description ("don't self-reference").

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [../../version-initial-testing/phases/phase-1-finding-acknowledgements.md](../../version-initial-testing/phases/phase-1-finding-acknowledgements.md)
  — telemetry-emitting tool pattern to mirror
- `packages/contracts/src/runtime-telemetry.ts` —
  `RUNTIME_USEFULNESS_DECISION_KINDS` + `RuntimeUsefulnessEventSchema`
- `packages/tools/src/runtime-telemetry/emit.ts` — emitter reused
  here
- `packages/store/src/migration-sql.ts:PROJECT_MIGRATION_0027_*` —
  CHECK-widening migration pattern
- `packages/tools/src/runtime-telemetry/report.ts` — potentially
  needs update for Phase 8 (verify)
