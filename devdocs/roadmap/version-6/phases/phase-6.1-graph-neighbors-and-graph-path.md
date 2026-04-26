# Phase 6.1 Graph Neighbors And Graph Path

Status: `Complete`

## Goal

Ship the first graph-native workflows:

- `graph_neighbors`
- `graph_path`

## Current Shipped Slice

Phase 6.1 now ships:

- typed graph traversal contracts in `packages/contracts/src/graph.ts`
- public tool contracts in `packages/contracts/src/tools.ts`
- rooted traversal over the derived `6.0` graph slice in
  `packages/tools/src/graph/index.ts`
- read-only public tools:
  - `graph_neighbors`
  - `graph_path`
- focused smoke coverage in `test/smoke/graph-tools.ts`

The current traversal surface is intentionally narrow:

- file locators are normalized through indexed-path resolution
- all other locators are explicit `kind + key`
- heuristic edges remain opt-in
- traversal stays rooted, but still starts from a cached whole-project graph
  slice instead of rooted graph derivation
- the shared whole-project graph cache is bounded in memory instead of growing
  without limit across projects
- `graph_neighbors` defaults shallow and supports explicit depth, node filters,
  edge filters, and result limits
- when every requested `graph_neighbors` start entity misses, the tool returns
  same-kind suggested start entities instead of only an empty traversal
- `graph_path` returns one shortest typed path with ordered hop explanations
  plus a typed `noPathReason` when no path is found

`calls_rpc` is now materialized as the first heuristic graph edge:

- source: indexed schema-object usage hits
- shape: `file -> rpc`
- status: heuristic and opt-in
- granularity: file-level for now; symbol-level call resolution is deferred
- overloads stay explicit by linking to all matching RPC signatures when usage
  evidence cannot resolve one exact target

## Reference Shape

Borrow the traversal interface shape from OpenHands ACI:

- `start_entities`
- `direction`
- `traversal_depth`
- entity filters
- edge filters

This phase is also responsible for taking the `6.0` whole-project first slice
and adding the rooted traversal/filtering surface that public graph workflows
actually need.

## Rules

- keep node and edge filters explicit
- return ordered paths with hop explanations
- do not hide traversal rules behind prose
- expose hop provenance and exact/heuristic status on the typed output
- do not silently cross heuristic edges unless the caller allows them or the
  output marks them clearly
- land `calls_rpc` here as an explicit early dependency, even if the first
  shipped form is heuristic, because `flow_map` in `6.2` needs route/file to
  RPC connectivity to be useful

## Output Expectations

`graph_neighbors` should answer adjacency questions directly:

- what nodes are connected?
- by which edge kinds?
- with what provenance?

`graph_path` should answer connection questions without pretending certainty:

- ordered hops
- hop explanations
- edge exactness
- any heuristic leap called out explicitly

## Success Criteria

- “what directly connects to this?” has one canonical tool
- “how does X connect to Y?” has one canonical tool
- both are typed, local-first, and evaluable
- both can distinguish exact-path answers from heuristic-path answers
