# Phase 6.5 Bounded Investigate And Suggest

Status: `Complete`

## Goal

Add one bounded multi-tool investigation workflow and one tool-chain suggestion
workflow:

- `investigate`
- `suggest`

## Rules

- call existing named tools only
- prefer the strongest shipped workflow first:
  - graph workflows before lower-level trace chains for connection / flow
    questions
  - operator and project-intelligence workflows before ad hoc project-summary
    chaining
  - packet handoff or one canonical tool before any multi-tool sequence
- keep an explicit step budget
- log tool choices and evidence
- return typed output with step history
- no vague oracle surface
- do not duplicate `ask` when one canonical tool already answers the question
- do not duplicate packet handoff when a shipped workflow packet already gives
  the next step cleanly
- do not call `ask` from inside `investigate`
- keep the first slice read-only over the shipped workflow and trace surfaces

## Budget

Bounded means numeric in this phase:

- `investigate`
  - default budget `3`
  - maximum 5 tool calls in one run unless the phase doc is amended explicitly
- `suggest`
  - default maximum `3` recommended steps
  - maximum 3 recommended steps in one returned sequence
  - if it executes tools to build that recommendation, the execution budget is
    maximum 3 tool calls

When the budget is exceeded, the workflow should stop cleanly and report that
the budget was exhausted rather than silently stretching the investigation.

## Current Shipped Context

`6.5` is no longer planning into a vague substrate. It starts after these
workflow families are already shipped:

- graph:
  - `graph_neighbors`
  - `graph_path`
  - `flow_map`
  - `change_plan`
- operator:
  - `tenant_leak_audit`
- project intelligence:
  - `session_handoff`
  - `health_trend`
  - `issues_next`
- workflow packets and packet handoff:
  - default-path `verification_plan` attachment
  - packet-guided next actions

That means the first job of `investigate` and `suggest` is to compose and
recommend those stronger surfaces where they already answer the question,
instead of dropping straight to low-level `trace_*` chains.

## Current Shipped Slice

`6.5` now ships both public tools:

- `suggest`
- `investigate`

First-slice behavior is intentionally narrow:

- graph-backed questions with both `startEntity` and `targetEntity` prefer:
  - `flow_map`
  - `change_plan`
  - graph primitives stay available as their own public tools, but `6.5`
    intentionally prefers the higher-level graph workflows over recommending
    `graph_neighbors` / `graph_path` directly
- tenant / RLS / cross-tenant review questions prefer:
  - `tenant_leak_audit`
- project-state questions prefer:
  - `session_handoff`
  - `issues_next`
  - `health_trend`
- when none of those stronger workflows match, `suggest` and `investigate`
  reuse the deterministic `ask` routing helper to point to one canonical named
  tool
  - this fallback is confidence-gated in the first slice
  - low-confidence ask routing stays `unsupported` instead of pretending it is
    a canonical recommendation
- neither tool calls `ask` as a public tool
- neither tool executes `workflow_packet` follow-ons in the first slice
- `investigate` remains read-only and sequential:
  - no hidden parallel branches
  - explicit per-step status
  - explicit terminal stop reason
- `investigate` now carries aggregated advisory follow-on hints discovered from
  executed results such as:
  - `change_plan`
  - `tenant_leak_audit`
- step records keep full raw `toolInput` for replay and a compact
  `inputSummary` for display

Known first-slice limits:

- keyword routing is still regex-based and may misclassify some natural-language
  phrasing
- planner selection favors `flow_map` / `change_plan` over the graph primitives
  when both graph endpoints are already known
- low-confidence ask-routed fallback is intentionally suppressed rather than
  guessed through

## Execution Contract

This phase should start by defining an explicit typed execution record rather
than returning a prose blob. At minimum:

- every executed step should record:
  - `toolName`
  - compact input summary
  - evidence or result references
  - one outcome state
- the run should record one terminal stop reason:
  - satisfied by one canonical tool
  - bounded investigation completed
  - budget exhausted
  - unsupported / unresolved

The step states should stay compatible with the strict workflow-state posture
already used elsewhere in Roadmap 5 and 6:

- one active step at a time
- no hidden parallel branch execution in the first slice
- no “done” while the investigation is still unresolved

## Product Boundary

`investigate` should be for bounded multi-tool questions that are too broad for
one current canonical tool but still narrow enough to stay typed and auditable.

Use it only when the stronger public workflows already shipped in `6.0`–`6.4`
do not answer the question directly in one call.

`suggest` should be narrower than that:

- recommend a multi-tool sequence only when one-tool routing is insufficient
- return tool-chain recommendations, not another planning document
- point back to the canonical tool or packet when that is already enough
- prefer recommending shipped graph / operator / project-intelligence workflows
  before recommending lower-level trace chains
- treat `issues_next` / `session_handoff` as recommendation surfaces already in
  the product, not as things `suggest` should restate

## Non-Goals

- no second planner beside `ask`
- no second handoff layer beside workflow packets
- no “oracle” answer that hides which tools ran
- no bypass around the shipped graph / operator / project-intelligence tools
  just because a trace chain is easier to compose
- no write-capable automation in the first slice

## Success Criteria

- mako can run a bounded investigation over its own substrate in one call
- users can ask “what tool flow should I use?” and get a canonical answer
- `suggest` does not overlap simple one-tool routing or existing packet handoff
- the first shipped investigate flow is visibly grounded in the `6.0`–`6.4`
  workflow families rather than recreating them behind a new label
