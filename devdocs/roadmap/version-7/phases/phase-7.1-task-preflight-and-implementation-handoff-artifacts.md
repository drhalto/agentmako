# Phase 7.1 Task Preflight And Implementation Handoff Artifacts

Status: `Shipped`

## Goal

Ship the first day-to-day generated artifacts:

- `task_preflight`
- `implementation_handoff`

## Rules

- compose existing trusted packet/workflow inputs first
- do not recreate packet handoff under a new label
- artifacts must stay narrower than a generic “project summary”
- preserve basis refs for replay and refresh

## Likely Basis Inputs

- `implementation_brief`
- `change_plan`
- `verification_plan`
- `flow_map`
- `session_handoff`

## Current Shipped Slice

`7.1` now ships generator-only artifact support for:

- `task_preflight`
- `implementation_handoff`

The concrete payload contracts live in:

- `packages/contracts/src/artifacts.ts`

The generator / refresh / replay helpers live in:

- `packages/tools/src/artifacts/index.ts`

The first shipped basis composition is:

- `task_preflight`
  - `implementation_brief`
  - `verification_plan`
  - `change_plan`
  - optional `flow_map`
- `implementation_handoff`
  - `implementation_brief`
  - `session_handoff`

This slice is intentionally generation-only:

- no harness surfacing yet
- no CLI surfacing yet
- no external-agent wrapper yet
- no automatic persistence layer

Declared `consumerTargets` in the artifact body are intended future consumers
for `7.3` wiring, not proof that those surfaces are already active in `7.1`.

## Product Boundary

`task_preflight` should answer:

- what should I read first?
- what surfaces likely move?
- what should I verify before I start?

`implementation_handoff` should answer:

- what does the next agent or engineer need to continue this work?
- what decisions, risks, and follow-ups matter right now?

These are generated artifacts over multiple trusted inputs.
They are not replacements for the individual packet/workflow families.

## Non-Goals

- no generic “one doc for everything”
- no automatic artifact persistence by default
- no write-capable automation

## Success Criteria

- `task_preflight` ships as a generated artifact that is more useful than
  reading the raw packet/workflow outputs directly
- `implementation_handoff` ships as a generated artifact with explicit typed
  basis and preserved packet/workflow basis refs
- both implement the 7.0 contract (`refresh`/`replay`, `source_origin`,
  stale markers) rather than inventing ad-hoc metadata
- both stay narrow and reproducible
- 7.1 ships the generators only; harness / CLI / agent surfacing lives in 7.3

## Smoke Coverage

Focused verification lives in:

- `test/smoke/artifact-generators.ts`

That smoke proves:

- both artifact families parse against the shipped `7.1` contract
- canonical JSON renderings are present and parseable
- canonical JSON renderings include artifact identity and project ownership
- unchanged refresh returns `outcome: "unchanged"`
- basis changes produce `outcome: "refreshed"` and supersede the prior artifact
- replay rebuilds from the recorded artifact state instead of consulting fresh
  workflow inputs
