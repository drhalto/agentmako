# Phase 8.4 Learned Promotion, Attachment, And Rollout

Status: `Gated on 8.2`

## Goal

Replace R7.5's conservative static promotion thresholds with
telemetry-backed percentile thresholds. Move companion-packet
attachment and R6 / R7 exposure decisions from fixed rules to rules
sourced from 8.2 read models, keeping policy caps and one-switch
rollback.

## Hard Decisions

- thresholds are percentile-derived (deepeval pattern) with operator
  overrides
- every promotion / demotion emits a `LearnedDecisionEnvelope`
- demotion is automatic on eval regression; promotion requires an
  evaluator-positive window plus operator confirmation
- R7.5's exposure state machine
  (`default / opt_in / dark / not_promoted`) stays canonical — this
  phase only changes how thresholds are sourced

## Gate

Do not open until 8.2 produces stable aggregates.

## Scope In

- telemetry-backed threshold computer in
  `packages/tools/src/runtime-telemetry/promotion-thresholds.ts`
- integration with `packages/tools/src/artifact-evaluation.ts` and
  `packages/tools/src/workflow-evaluation.ts`
- companion-packet attachment rewrite behind the learned-surface flag
- decision-envelope emission on every promotion / demotion
- operator CLI for manual exposure override. Proposed shape:
  `agentmako exposure set <family> <state> --reason <string>` — final
  namespace is a decision at implementation time and must be reconciled
  against `CLI_COMMANDS` in `apps/cli/src/shared.ts`

## Scope Out

- no new artifact / wrapper / workflow family
- no exposure-state-machine shape change — still four states
- no failure clustering — that is 8.5

## Done When

- every family shipped under R6 / R7 exposure has a telemetry-backed
  threshold with explicit fallback
- the demotion trigger fires against a reproducible eval regression
- the rollback envelope is populated for every demotion
- `packages/tools/src/workflow-packets/attachment-policy.ts` sources
  attachment decisions from learned-surface output

## References

- `packages/tools/src/artifact-evaluation.ts` —
  `ARTIFACT_DEFAULT_THRESHOLDS` / `ARTIFACT_OPT_IN_THRESHOLDS`
- `packages/tools/src/workflow-packets/attachment-policy.ts`
- `deepeval-main/docs/guides/guides-answer-correctness-metric.mdx:214-228`
  (reference — percentile threshold)
- `cody-public-snapshot-main/vscode/src/services/utils/enrollment-event.ts`
  (reference — treatment / control gate)
