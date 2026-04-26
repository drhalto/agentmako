# Phase 7.3 Harness, CLI, And External-Agent Integration

Status: `Complete`

## Goal

Surface generated artifacts where users and agents actually work:

- harness
- CLI
- external-agent flows

## Rules

- stay on-demand and explicit in the first slice
- do not add a second planner
- prefer one canonical entrypoint per artifact family
- keep generation read-only and reproducible

## Product Boundary

This phase should answer:

- how does a user ask for an artifact during normal work?
- how should the harness or external agent receive it?
- how should artifacts be refreshed or replayed when basis inputs change?

This is an integration phase, not a wrapper sprawl phase.

## Non-Goals

- no background auto-generation by default
- no required file export just to use an artifact
- no hidden persistence loop

## Success Criteria

- generated artifact families are surfaced cleanly on the shared tool plane
- CLI or external-agent callers can request the same artifact shapes cleanly
- integrations do not duplicate `ask`, packet handoff, or `investigate`

## Current Shipped Slice

- four generated artifact families are now shared tool-registry entrypoints:
  - `task_preflight_artifact`
  - `implementation_handoff_artifact`
  - `review_bundle_artifact`
  - `verification_bundle_artifact`
- those tools compose the already-shipped `7.1` / `7.2` generators and `6.x`
  workflow substrate:
  - `task_preflight_artifact`
    - `implementation_brief`
    - `verification_plan`
    - `change_plan`
    - `flow_map`
  - `implementation_handoff_artifact`
    - `implementation_brief`
    - `session_handoff`
  - `review_bundle_artifact`
    - `implementation_brief`
    - `change_plan`
    - optional `flow_map`
    - optional `tenant_leak_audit`
  - `verification_bundle_artifact`
    - `verification_plan`
    - optional `tenant_leak_audit`
    - optional `session_handoff`
    - optional `issues_next`
- all four are exposed through the existing:
  - harness / API tool surface
  - CLI `tool call`
  - external-agent / MCP tool plane
- the answer loop stays singular in this slice:
  - answers that already attach a companion packet keep one primary next action
  - artifact generation does not add a second competing handoff-shaped action
  - no background generation or hidden persistence loop was added
- CLI interactive rendering now recognizes all four shipped artifact families
  and prints their markdown projection instead of dumping raw JSON by default
- `task_preflight_artifact` and `review_bundle_artifact` remain intentionally
  tool-call-only in this slice:
  - no bounded answer-loop recommendation is attached
  - callers must provide the explicit graph start / target basis that
    `change_plan` and `flow_map` already require
- `verification_bundle_artifact` also remains tool-call-only in this slice:
  - no answer-loop recommendation is attached
  - it composes project-intelligence and optional operator context only when the
    caller asks for that artifact explicitly

## Not Yet Shipped

- no refresh / replay user-facing tool surface yet
- no wrapper/export surfaces yet
- no new bounded answer-loop recommendation for `task_preflight_artifact`,
  `review_bundle_artifact`, or `verification_bundle_artifact`

## Verification

- `test/smoke/api-answer-question.ts`
  - proves all four artifact tools are listed on the shared API/tool surface
  - proves `task_preflight_artifact`, `implementation_handoff_artifact`,
    `review_bundle_artifact`, and `verification_bundle_artifact` are callable
    through the shared tool plane
  - proves a normal answer keeps one primary `workflow_packet` follow-up action
    instead of also attaching a second artifact handoff action
  - proves `implementation_handoff_artifact` remains callable directly through
    the shared tool plane
  - proves the shared tool plane returns real `task_preflight`,
    `review_bundle`, and `verification_bundle` artifacts
  - proves the artifact tool input contracts reject typo fields
  - proves artifact tool schemas emit shared root refs while non-artifact tool
    schemas stay inlined
- `test/smoke/artifact-generators.ts`
  - still proves the underlying `7.1` artifact generation / refresh / replay
    helpers, now across all four shipped artifact families
