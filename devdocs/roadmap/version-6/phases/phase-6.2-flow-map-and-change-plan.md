# Phase 6.2 Flow Map And Change Plan

Status: `Complete`

## Goal

Build the first whole-flow workflows on top of the graph and existing traces:

- `flow_map`
- `change_plan`

## Why This Matters

Fenrir felt powerful because it could answer full-stack “walk me through this”
questions in one call. Mako still lacks that explicit workflow.

## Current Shipped Slice

Phase 6.2 now ships:

- typed `flow_map` and `change_plan` tool contracts in
  `packages/contracts/src/tools.ts`
- shared flow/change result contracts in `packages/contracts/src/graph.ts`
- graph-native runtime in `packages/tools/src/graph/index.ts`
- public tool registration in `packages/tools/src/tool-definitions.ts`
- focused smoke coverage in `test/smoke/graph-workflows.ts`

The current shipped behavior is intentionally narrow:

- `flow_map` reuses one resolved graph path and turns it into:
  - ordered steps
  - typed transitions
  - major boundary kinds
- code-layer boundaries are now explicit in the first slice:
  - `file`
  - `symbol`
  - instead of collapsing every non-route/non-rpc/non-data hop into `generic`
- `change_plan` stays graph-derived by combining:
  - direct path surfaces
  - one-hop dependent surfaces
  - explicit step dependencies
- dependent surfaces are always collected as one-hop bidirectional adjacency
  around the direct path, even when the caller constrains the main path
  direction
- dependent-surface truncation is surfaced through `warnings` instead of
  silently widening the result shape
- `change_plan` now carries one advisory follow-on packet hint:
  - `workflow_packet`
  - family: `implementation_brief`
  - purpose: turn graph-derived scope into one bounded implementation brief
    with invariants, risks, and verification guidance
- `flow_map` still stays graph-only instead of recreating Roadmap 5 packet
  semantics
- both workflows reuse the `6.1` whole-project graph cache instead of
  rebuilding traversal state from scratch
- both workflows remain out of `ask` routing for now

## Rules

- compose `graph_path` plus existing `trace_*` / `auth_path` / DB evidence
- keep implementation order and affected surfaces explicit
- do not turn this into generated docs yet
- keep `change_plan` graph-derived and scope-oriented
- do not duplicate Roadmap 5 packet families:
  - not another `implementation_brief`
  - not another `impact_packet`
  - not another `verification_plan`

## Product Boundary

`flow_map` should answer:

- what path does the request/data/auth flow actually take?
- where are the major boundaries and transitions?

`change_plan` should answer:

- what concrete surfaces are likely to move?
- what dependencies block or order those changes?

It may reference existing workflow packets, but it should not recreate their
narrative sections or become a second planning surface. The current shipped
slice now exposes only one advisory follow-on packet hint for `change_plan`;
it does not auto-attach or render a packet itself.

Mechanical anti-overlap rule:

- if a proposed `change_plan` answer is reconstructible from an existing
  `impact_packet` plus `graph_path`, do not ship it as a separate public
  workflow

## Success Criteria

- a user can ask for an end-to-end flow and get an ordered, typed map
- a user can ask what changes for a feature and get a bounded affected-surface
  plan
- `change_plan` is meaningfully different from the Roadmap 5 packet layer
