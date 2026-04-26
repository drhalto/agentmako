# Phase 5.5 Default Consumers And Optional Wrappers

Status: `Complete`

## Purpose

Land one real consumer for the shipped packet layer in the default product path,
then optionally add one narrow wrapper around that consumer.

This was the original closeout phase because Roadmap 5 was supposed to close on
packet usefulness in the normal workflow, not on wrapper plumbing in isolation.
`5.6` now exists as the deliberate extension after product review showed the
packet layer still needed deeper default-path integration.

## Phase Outcome

By the end of `5.5`, the packet layer should be used in at least one place
users already look during normal work, and may also be wrapped later by:

- git hooks
- CI jobs
- scheduled local/team runs

without becoming part of the core runtime contract.

The implementation should stay intentionally narrow:

- pick one daily-friction workflow
- integrate one stable packet family or one tightly coupled pair into the
  default path
- keep human approval/review boundaries explicit
- expand only after the first consumer proves useful

The recommended first consumer is:

- a companion `verification_plan` attached to an existing high-signal
  investigation flow such as `trace_file` or `file_health`
- surfaced where the user already sees the answer/tool result, not only in a
  separate packet command
- defaulting to additive display rather than replacing the answer packet

This is the safest fit for the current repo because:

- `verification_plan` already carries baseline, regression, done criteria, and
  rerun triggers
- `trace_file` / `file_health` already answer “what do I check next?” style
  questions
- the workflow packet surface already exists through CLI, API, web, and
  MCP-visible tool calls
- it proves packet usefulness before any wrapper rollout

Shipped default consumer:

- `trace_file` and `file_health` now attach a companion `verification_plan`
  directly onto the enriched `AnswerResult`
- the packet is additive and rendered in the normal CLI/API/web answer path,
  not only behind the dedicated `workflow_packet` tool
- the packet is generated from the existing workflow-packet seam using the same
  trust/diagnostic basis as the answer itself

## Workstreams

### A. Default Consumer Integration

Add one packet family to one place users already work.

Recommended first target:

- `trace_file` / `file_health` emit a companion `verification_plan`

Rules for the first consumer:

- additive, not replacing the underlying answer packet
- grounded in the same trust/diagnostic/compare basis as the answer
- visible in the normal CLI/API/web result path
- no packet-family guessing by the user for the chosen flow

The point of this workstream is to prove:

- packets help without an extra command
- packet rendering is understandable in the main workflow
- users actually consume the packet when it is placed in context

### B. Narrow Wrapper On Top

Only after the first consumer is real, add a narrowly scoped wrapper around an
already-useful packet.

Examples:

- `verification_plan` generation in CI
- local watch helper around an already-integrated packet flow

Only wrap packet families that already have:

- stable packet contracts
- at least one useful real consumer
- acceptable intervention rate when humans review the output

When choosing the first wrapper, prefer the Continue-style rule:

- do not automate everything at once
- pick one recurring workflow where packet output already saves time
- measure intervention rate and actual time saved before adding another wrapper

Recommended wrapper order:

1. a non-mutating `verification_plan` CI artifact wrapper
   - trigger with `workflow_dispatch` first
   - optionally add `pull_request` after noise is acceptable
   - upload rendered markdown/text plus packet JSON as artifacts
   - avoid posting comments automatically in the first cut

2. local developer wrapper around CLI watch mode
   - a thin script or documented command flow around
     `agentmako workflow packet ... --watch`
   - intended for explicit human use, not background polling

3. only then consider brief/precedent review wrappers
   - these are more interpretation-heavy
   - they should follow only after the first verification wrapper proves stable

If wrappers are exposed through MCP rather than only local scripts/CI glue,
keep the surface modular:

- register tools separately
- register prompts separately
- register resources separately
- keep shared workflow guidance in server-level instructions instead of
  duplicating it in every tool/prompt description

### C. Scheduling Rules

If any scheduled behavior exists, it should remain:

- optional
- explicit
- replaceable
- non-blocking to the core product path

Scheduled wrappers should refresh packets, not own packet semantics.

They must continue to use the shipped packet-generation seam rather than adding
wrapper-local packet logic.

If a scheduled wrapper is added at all in `5.5`, it should remain secondary to
the manual/CI wrapper path.

Do not make scheduled refresh the first or only automation surface.

### D. Workflow-State Discipline

Wrappers that consume `workflow_recipe` packets must preserve the packet's task
discipline rather than weakening it for convenience.

Keep these rules:

- only one step is normally `in_progress`
- do not mark a step `done` while verification is still failing
- keep blocked or partial work `in_progress`
- remove obsolete steps instead of leaving dead workflow state behind

### E. Safety And Metrics

Keep the same safety discipline:

- human oversight where needed
- clear permissions
- progressive permissions
- measure usefulness, not vanity output volume

Primary measures should be things like:

- intervention rate
- whether users actually consumed the default-path packet
- whether the wrapper saved real workflow time
- whether the wrapper caused avoidable rework
- whether the wrapper remained narrow enough to stay understandable

For the first wrapper, also track:

- whether the generated packet was actually opened/read
- whether humans reused the suggested verification sequence
- whether the wrapper avoided noisy duplicate output on unchanged workflow state

## Verification

- consumer-specific checks
- wrapper-specific checks
- no dependency from packet generation onto wrapper presence
- at least one default-path flow proves packet generation still works normally
  when no wrapper is present
- at least one wrapper proves repeated refreshes keep the same packet semantics
  when the underlying workflow context has not changed
- if a wrapper exposes MCP prompts/resources, verify those registrations stay
  separate from tool registration
- if the first wrapper is CI-based, verify it can run from the existing
  workspace install/build path without adding wrapper-local bootstrap logic
- verify repeated wrapper runs on unchanged packet context keep the same stable
  packet id and do not create duplicate artifact meaning

## Non-Goals

- no mandatory daemon
- no zero-intervention autonomous workflows as a core Roadmap 5 claim

## Exit State

`5.5` ends with a strong packet layer that shows up in the normal product path
and can also be wrapped by automation, not a product that only works when
automation is turned on.

The clean completion state for `5.5` is:

- one useful default-path consumer is shipped
- packet usefulness is proven before broad wrapper rollout
- optional wrappers are clearly trivial on top of the integrated packet seam,
  but not required for Roadmap 5 completion
- wrapper behavior is measured and reversible
- the wrapper consumes the existing packet seam without new packet logic
- the core packet surfaces remain fully usable when the wrapper is absent
