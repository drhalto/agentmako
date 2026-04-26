# Phase 5.1 Implementation Briefs And Precedent Packs

Status: `Complete`

## Purpose

Ship the first two high-value packet families:

- `implementation_brief`
- `precedent_pack`

These are the packets most likely to save real user and agent time immediately.

## Phase Outcome

By the end of `5.1`, `mako-ai` should be able to answer:

- what should I change?
- what must I preserve?
- what already exists that I should reuse before inventing new code?

## Workstreams

### A. Implementation Brief

Build a packet that summarizes:

- target area
- likely change zones
- invariants / interfaces to preserve
- risks
- acceptance criteria
- verification suggestions
- open questions

It should stay compact and decision-oriented.

The expected shape is a brief, not a report:

- summary
- likely change zones
- invariants / touched interfaces
- risks and assumptions
- acceptance / verification
- open questions

### B. Precedent Pack

Build a packet that summarizes:

- the canonical nearest precedent
- other relevant helpers / routes / tables / RPCs / patterns
- why they are relevant
- whether reuse looks safe, partial, or weak
- what is still missing even after precedent search

This phase should avoid “top 20 similar things” output.

The packet should clearly separate:

- the best precedent to start from
- secondary precedents
- why each one matches
- what cannot be reused directly

### C. Consumer Fit

Prove both packet families are useful from:

- real `trace_*`/`ask` outputs
- trust-aware answers with diagnostics
- both engineer-facing and agent-facing consumers using the same typed packet

## Verification

- focused packet smokes
- at least one realistic packet case for each family
- real ForgeBench packet-eval coverage may follow in `5.2+` once more packet families share the same seam
- citations and open questions preserved
- at least one case proves the packet stays compact instead of degenerating into a long blob

## Shipped In This Slice

The first two packet families are now landed as built-in generators:

- `implementation_brief`
- `precedent_pack`

The shipped layer includes:

- built-in generators in `packages/tools/src/workflow-packets/generators.ts`
- one default registry / high-level generation entrypoint
- focused realistic generator coverage in `test/smoke/workflow-packet-generators.ts`

The implementation brief now produces:

- compact summary
- change areas
- invariants
- risks
- acceptance / verification guidance
- preserved open questions

The precedent pack now produces:

- one canonical precedent
- ranked secondary precedents
- reuse-strength guidance
- gaps / caveats when precedent is weak or not fully followed

## Non-Goals

- no workflow loops yet
- no watch mode yet
- no automation wrappers

## Exit State

The system can produce trustworthy “change this safely” and “reuse this first”
packets without custom per-call reasoning outside the packet layer.
