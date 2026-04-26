# Phase 7.2 Review, Verification, And Change-Management Artifacts

Status: `Shipped`

## Goal

Ship broader generated artifacts around review and safe completion:

- `review_bundle`
- `verification_bundle`
- adjacent change-management artifacts where justified

## Rules

- package multiple trusted inputs together, do not replace them
- preserve operator or audit findings distinctly from coding guidance
- keep verification artifacts explicit about stop conditions
- do not flatten direct evidence and weak-signal warnings into one prose block

## Current Shipped Slice

`7.2` now ships generator-only artifact support for:

- `review_bundle`
- `verification_bundle`

The concrete payload contracts live in:

- `packages/contracts/src/artifacts.ts`

The generator / refresh / replay helpers live in:

- `packages/tools/src/artifacts/index.ts`

The first shipped basis composition is:

- `review_bundle`
  - `implementation_brief`
  - `change_plan`
  - optional `flow_map`
  - optional `tenant_leak_audit`
- `verification_bundle`
  - `verification_plan`
  - optional `tenant_leak_audit`
  - optional `issues_next`
  - optional `session_handoff`

This slice is intentionally still artifact-focused:

- no shared tool-registry entrypoint yet
- no CLI or harness surfacing yet
- no external-agent wrapper yet
- no automatic persistence layer

## Basis Inputs

- `verification_plan`
- `impact_packet`
- `change_plan`
- `tenant_leak_audit`
- `issues_next`
- `session_handoff`

## Product Boundary

These artifacts should answer:

- what should a reviewer inspect?
- what must be verified before and after the change?
- what operator or tenancy checks should not be missed?

This phase should stay artifact-focused. If the work starts reopening review or
verification packet generation directly, narrow it.

## Non-Goals

- no generic release-management platform
- no hidden policy engine
- no replacement for direct audit tools

## Success Criteria

- a reviewer-facing generated artifact exists
- a verification/change-management artifact exists
- both preserve typed basis and evidence distinctions

## Smoke Coverage

Focused verification lives in:

- `test/smoke/artifact-generators.ts`

That smoke proves:

- both `7.2` artifact families parse against the shipped contract
- `review_bundle` keeps reviewer guidance separate from operator findings
- `verification_bundle` keeps stop conditions explicit instead of flattening
  them into summary prose
- refreshed artifacts supersede the prior artifact cleanly
- replay rebuilds from the recorded artifact state instead of consulting fresh
  workflow inputs
