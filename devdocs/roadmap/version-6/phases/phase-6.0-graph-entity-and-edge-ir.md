# Phase 6.0 Graph Entity And Edge IR

Status: `Complete`

## Why This Phase Exists

The biggest missing capability after Roadmap 5 is not another packet. It is a
clean way to represent cross-stack relationships so later workflows can answer
path and flow questions directly.

## Goal

Define the shared graph node and edge model that later Roadmap 6 workflows
build on.

## Current Shipped Slice

Phase 6.0 now ships:

- shared graph contracts in `packages/contracts/src/graph.ts`
- a small explicit edge inventory covering all planned first-slice edge kinds
- a derived graph builder in `packages/tools/src/graph/index.ts`
- focused smoke coverage over seeded project-store and schema-snapshot state
- graph slice basis metadata carrying:
  - derivation strategy
  - latest index-run id when available
  - schema snapshot id and fingerprint when available
- a warning channel for missing schema state or large whole-project slices

The first emitted exact edge set is intentionally narrow:

- `imports`
- `exports`
- `declares_symbol`
- `serves_route`
- `touches_table`
- `has_rls_policy`
- `has_trigger`

The first emitted heuristic edge is also now present when indexed schema-usage
evidence exists:

- `calls_rpc`

The remaining first-slice inventory rows are present but still inventory-only:

- `invokes_edge`
- `references_auth_boundary`

The first materialized node set is also intentionally narrow:

- `file`
- `symbol`
- `route`
- `rpc`
- `table`
- `policy`
- `trigger`

The remaining node kinds are contract-only in 6.0:

- `edge_function`
- `auth_boundary`

## Requirements

- use existing mako entities where possible:
  - files
  - symbols
  - routes
  - RPCs
  - tables
  - triggers
  - edge functions
- keep edge kinds explicit and typed
- classify every edge kind as:
  - `exact`
  - `heuristic`
- record the provenance each edge carries:
  - source workflow/store
  - evidence refs or source object ids
  - confidence / exactness status
- decide derive-vs-persist for the first slice based on actual need, not
  preference

## First-Slice Contract

The first shipped graph IR should default to derived state built from current
stores and tool substrates unless real usefulness or latency data proves a
persisted cache is needed.

The derive-first rule should still pin granularity up front:

- the current shipped slice is a whole-project derived snapshot with explicit
  `basis.strategy = "whole_project"`
- rooted-subgraph derivation and caller-driven filtering are deferred to
  `6.1`, where public traversal workflows can actually use them
- if a later phase needs broader precomputation or persistence, that should be
  justified with measured usefulness or latency evidence
- first-slice outputs should carry enough basis and warning data that callers do
  not have to pretend a wall-clock timestamp is the graph provenance

It should leave behind a small explicit inventory covering at least:

- `imports`
- `exports`
- `declares_symbol`
- `serves_route`
- `calls_rpc`
- `touches_table`
- `has_rls_policy`
- `has_trigger`
- `invokes_edge`
- `references_auth_boundary`

Each inventory row should say whether the edge is exact or heuristic and what
evidence carries it.

## Contract Sketch

Phase 6.0 should land a concrete typed contract before traversal code ships.
A minimal first-slice sketch is enough, for example:

```ts
type GraphNodeKind =
  | "file"
  | "symbol"
  | "route"
  | "rpc"
  | "table"
  | "trigger"
  | "edge_function";

type GraphEdgeKind =
  | "imports"
  | "exports"
  | "declares_symbol"
  | "serves_route"
  | "calls_rpc"
  | "touches_table"
  | "has_rls_policy"
  | "has_trigger"
  | "invokes_edge"
  | "references_auth_boundary";

interface GraphNode {
  nodeId: string;
  kind: GraphNodeKind;
  label: string;
  sourceRef?: string;
}

interface GraphEdge {
  edgeId: string;
  kind: GraphEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  exactness: "exact" | "heuristic";
  provenance: {
    source: string;
    evidenceRefs: string[];
  };
}
```

The actual names may differ, but the first slice should be at least this
explicit.

## Non-Goals

- no public graph UI
- no graph database
- no broad new cache layer before the first graph workflows prove useful
- no silent mixing of exact and heuristic edges in one undifferentiated path

## Success Criteria

- later phases can ask for neighbors and shortest paths without inventing ad hoc
  cross-layer joins
- the model is small enough to stay legible and auditable
- the exact/heuristic edge boundary is visible in the contract, not buried in
  implementation
