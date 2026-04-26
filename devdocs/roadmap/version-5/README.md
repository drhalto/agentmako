# Roadmap Version 5

**Status:** COMPLETE

**Upstream Baseline:** Roadmap 4 complete, including the `4.7` workflow-context bridge

**Primary Goal:** turn the trust-aware answer surface into typed workflow-context products that help real coding work

## Purpose

This folder is the canonical roadmap package for Roadmap 5 of `mako-ai`.

Roadmap 5 is the `Context And Workflow Assistance` roadmap.

It is not:

- another trust-backbone roadmap
- another harness/model roadmap
- the generated-artifact roadmap
- a scheduler/background-worker roadmap

It is the roadmap that should make `mako-ai` useful for:

- “what should I read?”
- “what should I change?”
- “what already exists?”
- “what do I verify next?”
- “what loop should I follow until this is actually done?”

## Starting Point

Roadmap 5 starts from shipped substrate, not from scratch:

- Roadmap 4 trust/eval/diagnostic surfaces are complete
- `Phase 4.7` shipped the workflow-context bridge
- `WorkflowContextBundle`, `WorkflowPacketRequest`, and `WorkflowPacketInput` already exist
- `Phase 5.0` shipped the shared workflow-packet contract layer
- `Phase 5.1` shipped the first two built-in packet families
- `Phase 5.2` shipped impact and verification packet families
- `Phase 5.3` shipped workflow-recipe packets with explicit loop semantics
- `Phase 5.4` shipped packet surfaces and explicit watch metadata
- `Phase 5.5` shipped the original closing integration slice: `trace_file` /
  `file_health` now surface a companion `verification_plan` in the normal
  answer path, with optional wrappers left as follow-on work
- `Phase 5.6` is now shipped as the post-closeout extension that made the
  packet layer matter in the normal tool path before handing cleanly to
  Roadmap 6
- the first `5.6.1` slice is now shipped:
  - one shared attachment-policy seam
  - `ask` inheritance of that policy
  - surfaced attachment reasons
  - a deliberately promoted default-path set:
    - `route_trace`
    - `file_health`
    - `trace_file`
    - `trace_table`
    - `trace_rpc`
- the first `5.6.2` slice is now shipped:
  - compact `current / stopWhen / refreshWhen` handoff on workflow packet
    surfaces
  - concise companion rendering in the normal answer path
  - full packet views that still keep the detailed rendering available
- `5.6.3` is now shipped:
  - source-labeled `reference_precedent` workflow context items
  - reference-backed precedent selection that stays advisory and never rewrites
    local trust state
  - real packet coverage for strong-local-vs-external precedence
- `5.6.4` is now shipped:
  - workflow-packet usefulness grading (`full` / `partial` / `no`)
  - run-level promotion metrics in the shared eval runner
  - actual-followup count / rate when packet-guided actions are executed
  - real ForgeBench workflow-usefulness coverage in the trust-eval suite
- `5.6.5` is now shipped:
  - companion-packet handoff drives the first `candidateAction`
  - CLI/web render next actions in the normal answer path
- `5.6.6` is now shipped:
  - workflow-guided next actions now carry execution metadata
  - the first workflow action points at the real `workflow_packet` tool
  - execution input now includes canonical query text plus replay args for
    promoted flows
  - executing that guided action now writes a durable `workflow_followups` fact
    row keyed by the originating answer/action
  - focused smokes pin that execution target for promoted flows
- Roadmap 5 closes here:
  - actual-followup rate is now available as an operator-facing promotion knob
  - Roadmap 5 does not auto-expand or auto-retract attachment policy from
    telemetry alone
  - telemetry-driven rollout and learned promotion belong to Roadmap 8

That means Roadmap 5 should build packet generators on top of the bridge, not add new raw `AnswerResult` parsing seams.

## Package Contents

- [roadmap.md](./roadmap.md) — canonical roadmap contract and phase sequence
- [handoff.md](./handoff.md) — execution assumptions and working rules
- [phases/README.md](./phases/README.md) — phase index

## Rules

- packet generators consume `WorkflowPacketInput`, not raw `AnswerResult`
- outputs stay typed and evidence-backed
- workflow recipes must include explicit verification and stop conditions
- on-demand generation comes first
- watch mode is allowed after the packet layer exists
- hooks / CI / cron are optional wrappers, not prerequisites
- Roadmap 5 should close on default-path packet usefulness before wrapper breadth
- generated artifacts stay out of Roadmap 5 unless they are minimal packet renderings needed to consume the packet itself
- post-`5.5` work should make packets and reference-backed research materially
  influence the normal tool path before Roadmap 7 starts generating broader
  workflow artifacts
