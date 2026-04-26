# Phase 5.2 Impact Packets And Verification Plans

Status: `Complete`

## Purpose

Ship the next two packet families:

- `impact_packet`
- `verification_plan`

These turn a useful answer into actionable downstream reasoning.

## Phase Outcome

By the end of `5.2`, `mako-ai` should be able to answer:

- what else moves if I touch this?
- how do I prove the change is correct?

## Workstreams

### A. Impact Packet

Build a packet that captures:

- directly affected files/components
- adjacent systems and interfaces
- uncertain but plausible impact zones
- schema/API/type surfaces touched
- likely regression zones
- trust/diagnostic caveats

The packet should distinguish:

- direct impact
- adjacent impact
- uncertain impact

so later consumers do not treat all reach as equally certain.

### B. Verification Plan

Build a packet that captures:

- baseline reproduction or current-state check
- focused checks
- regression checks
- edge-case checks
- stale/drift-sensitive checks
- what counts as done
- what should trigger rerun/recompare

The expected structure should be close to an implementation spec’s
verification section:

- baseline / reproduce
- main verification
- regression checks
- edge cases
- done criteria

### C. Trust Integration

Ensure these packets carry through:

- stale/changed/superseded context where relevant
- contradiction caveats where relevant
- diagnostic evidence where relevant

## Verification

- focused smokes for both families
- at least one real or semi-real packet case using compare/trust output
- explicit assertions for open questions and trust caveats
- one packet case proves done criteria and regression checks are explicit, not implied

## Shipped In This Slice

The next two packet families are now landed as built-in generators:

- `impact_packet`
- `verification_plan`

The shipped layer includes:

- built-in generators in `packages/tools/src/workflow-packets/generators.ts`
- registration in the default workflow-packet registry
- focused realistic generator coverage in `test/smoke/workflow-packet-generators.ts`

The impact packet now produces:

- direct impact items
- adjacent impact items
- uncertain/caveated impact items
- trust and diagnostic caveats
- preserved open questions

The verification plan now produces:

- explicit baseline/current-state checks
- focused verification and regression checks
- explicit done criteria
- rerun and refresh triggers tied to trust/compare state
- dedicated `baseline` and `rerun_triggers` section kinds
- machine-readable verification entry kinds for baseline, regression, done, and rerun-trigger entries

## Non-Goals

- no loop recipes yet
- no watch mode yet
- no CI/hook automation yet

## Exit State

The system can say not just what to change, but how far the change reaches and
how to verify it cleanly.
