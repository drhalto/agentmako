# Roadmap Version 6

This file is the canonical roadmap for the Roadmap 6 build cycle.

If another Roadmap 6 doc disagrees with this file about what the roadmap is
for, what phases it contains, or what counts as done, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-5/handoff.md](../version-5/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)
- [../../scratch/fenrir_tools.md](../../scratch/fenrir_tools.md)

## Roadmap Contract

Roadmap 6 is the `Power Workflows And Operational Intelligence` roadmap.

Its job is to turn the strong deterministic substrate into the small set of
high-leverage workflows Fenrir users actually remembered, without reintroducing
Fenrir's sprawl or weak contracts.

Roadmap 6 should make `mako-ai` better at:

- tracing cross-stack connections between files, symbols, routes, RPCs, tables,
  triggers, and edge functions
- answering whole-flow questions in one structured call
- surfacing operator-grade security and tenancy gaps from the existing auth/RLS
  substrate
- telling users and agents what to work on next at the project level, not only
  at the file level
- running bounded multi-tool investigations that stay typed, auditable, and
  evaluable

Roadmap 6 does **not** rebuild:

- workflow packet contracts
- trust storage or contradiction policy
- generated docs / handoff artifact pipelines
- ML or learned rollout logic
- any scheduler / daemon dependency

## Entry Assumptions

Roadmap 6 begins with all of these already shipped:

- strong primitive tools across code, imports, schema, and DB
- the investigation composer family (`trace_*`, `preflight_table`,
  `cross_search`)
- trust, compare, rerun, and diagnostics
- workflow packets and follow-up tracking
- default-path workflow packet consumers and handoff-driven next actions
- a local-first eval harness with real ForgeBench coverage

That means the first Roadmap 6 phase should build new workflows by composing
the shipped substrate, not by reopening the lower layers.

## Core Deliverables

Roadmap 6 should ship these workflow families:

- `graph_neighbors`
- `graph_path`
- `flow_map`
- `change_plan`
- `tenant_leak_audit`
- one project-level queue / handoff surface
- one bounded investigation / suggestion surface

Every new workflow should:

- return typed structured output
- cite or reference the underlying evidence sources
- stay narrow and canonical for its question shape
- compose existing named tools or indexed data instead of inventing a
  monolithic script
- leave behind eval hooks that prove whether it is helpful or noisy

## Research-Grounded Shape

Roadmap 6 should preserve these design patterns:

1. **Typed graph traversal**
   - from OpenHands ACI's traversal interface
   - start entities, direction, depth, entity filters, and edge filters should
     be explicit instead of hidden in prose

2. **One call, many sources, one typed answer**
   - from Fenrir's best investigation tools
   - keep the composition pattern, not the text-blob output shape

3. **Strict workflow-state semantics**
   - from OpenHands task-tracker discipline
   - project queue / handoff surfaces should keep one active focus, clear done
     criteria, and no stale dead items

4. **Local-first, reference-second**
   - broader repo/reference research remains optional and source-labeled
   - no external reference hit should rewrite local truth or local trust state

5. **Bounded investigation instead of vague oracle**
   - if a deep investigation surface exists, it should use existing named tools,
     step limits, and logged execution

6. **Derived project state before mutable workflow state**
   - project-level queue and handoff surfaces should derive from shipped
     diagnostics, trust, compare, and follow-up facts first
   - do not introduce mutable queue state unless the derived slice proves
     insufficient in real usage

## Roadmap Rules

1. One canonical tool per question shape.
2. No Fenrir-style near-duplicate variants.
3. No text-blob public outputs when a typed schema is possible.
4. No broad autonomous workflow engine.
5. No ML / learned policy in this roadmap.
6. Prefer deriving from the current substrate before introducing new persisted
   caches.
7. If a new workflow cannot be evaluated, it is not ready to ship.

## Evaluation Rule

Roadmap 6 must reuse the Roadmap 4 and 5 evaluation posture.

That means:

- add focused smokes for every new workflow family
- add at least one real ForgeBench-style evaluation where the workflow is meant
  to be used against real repo context
- evaluate usefulness and noise, not just schema validity

Roadmap 6 should also make these boundaries explicit during implementation:

- which graph edges are exact vs heuristic
- which workflows are graph-derived vs packet-derived
- which project-level states are derived vs persisted
- which audit findings are direct-evidence vs weak-signal warnings

## Phase Sequence

1. `Phase 6.0` — graph entity and edge IR
2. `Phase 6.1` — graph neighbors and graph path
3. `Phase 6.2` — flow map and change plan
4. `Phase 6.3` — tenant leak audit and auth operators
5. `Phase 6.4` — project queue, health trend, and session handoff
6. `Phase 6.5` — bounded investigate and suggest
7. `Phase 6.6` — usefulness evaluation and default exposure rules

## Phase Summary

### Phase 6.0 Graph Entity And Edge IR

Define the shared graph model that later power workflows rely on.

Current status:

- complete
- shipped as a derived-first graph slice with shared contracts and a seeded
  smoke
- emitted exact edges:
  - `imports`
  - `exports`
  - `declares_symbol`
  - `serves_route`
  - `touches_table`
  - `has_rls_policy`
  - `has_trigger`
- emitted heuristic edge:
  - `calls_rpc`
- inventory-only rows remain for:
  - `invokes_edge`
  - `references_auth_boundary`

This phase should establish:

- graph node kinds shared across code and DB surfaces
- graph edge kinds that capture imports, calls, data access, routing, trigger,
  and auth-adjacent relations
- resolution rules from existing mako entities into graph nodes
- an explicit inventory of:
  - edge kinds
  - exact vs heuristic status
  - provenance carried on each edge
- a derive-first rule for the first shipped slice unless usefulness or latency
  proves a persisted cache is necessary

### Phase 6.1 Graph Neighbors And Graph Path

Ship the first graph-native workflows:

- `graph_neighbors`
- `graph_path`

These should answer:

- what is directly connected to this?
- how does this connect to that?

Current status:

- complete
- ships explicit direction/depth/filter traversal over the `6.0` graph slice
- keeps graph construction whole-project, but reuses a cached slice per project
  basis during traversal
- ships `calls_rpc` as an opt-in heuristic edge so route/file to RPC to table
  paths can be expressed honestly

### Phase 6.2 Flow Map And Change Plan

Ship the first whole-flow and change-scope workflows:

- `flow_map`
- `change_plan`

These should answer:

- show me the full path through the stack
- what surfaces move if I implement this feature/change?

`change_plan` must stay distinct from the Roadmap 5 packet layer:

- it is a graph-derived affected-surface and dependency-order workflow
- it is not a second `implementation_brief`
- it is not a replacement for `impact_packet` or `verification_plan`

Current status:

- complete
- `flow_map` now ships as a typed graph workflow built directly on the
  `graph_path` substrate
- `change_plan` now ships as a graph-derived change-scope workflow with:
  - direct path surfaces
  - one-hop dependent surfaces
  - explicit dependency-ordered steps
- neither workflow is routed through `ask` by default

### Phase 6.3 Tenant Leak Audit And Auth Operators

Turn the existing auth, query, RLS, and schema substrate into operator-grade
audits:

- `tenant_leak_audit`
- adjacent auth/operator surfaces where justified

These should answer:

- where are the real tenancy / auth gaps?
- which tables, RPCs, or routes are underprotected?

Current status:

- complete
- shipped as an advisory / opt-in operator tool
- first slice is intentionally narrow:
  - tenant-keyed tables
  - RLS posture
  - RPCs touching protected tables
  - indexed route/file RPC usage sites
- direct findings stay limited to missing table-level RLS protection
- policy / RPC / usage gaps without tenant signals stay weak-signal warnings

This phase must define the audit model before implementation:

- protected surface kinds
- tenant-principal evidence patterns
- direct-evidence vs weak-signal findings
- the difference between:
  - missing protection
  - unclear protection
  - non-tenant-auth behavior that should not be labeled a leak

### Phase 6.4 Project Queue, Health Trend, And Session Handoff

Lift current diagnostics, trust, and follow-up history into project-level
surfaces:

- one queue-oriented “what next?” surface
- `health_trend`
- `session_handoff`

These should answer:

- what should I tackle next?
- is the project getting healthier or worse?
- what does the next session need to know?

The first slice should derive these surfaces from append-only facts rather than
introducing hidden mutable queue state. If a persisted queue is ever needed, it
should be justified explicitly after the derived slice proves insufficient.

Current status:

- complete
- `session_handoff` ships as a derived operator workflow over:
  - recent answer traces
  - trust state
  - comparison state
  - recorded workflow follow-ups
- `health_trend` now ships over that same substrate and compares the most
  recent half of the chosen trace window against the prior half without
  fabricating trend lines when history is thin
- `issues_next` now ships as the queue-oriented “what next?” surface:
  - one current issue
  - ranked queued issues
  - no hidden mutable queue state
- all three surfaces share the same recent-trace window contract:
  - default `8`
  - max `32`

### Phase 6.5 Bounded Investigate And Suggest

Add one bounded deep-investigation surface and one tool-chain suggestion
surface:

- `investigate`
- `suggest`

These should:

- compose existing named tools
- prefer the strongest already-shipped workflow first:
  - graph workflows for connection / flow / scope questions
  - operator and project-intelligence workflows for project-state questions
  - packet handoff or one canonical tool before any multi-tool chain
- stay within explicit step budgets
- log tool choices and evidence
- avoid Fenrir's vague “oracle” shape

`suggest` must stay narrow:

- it is only for multi-tool question shapes that are not already answered by
  `ask` selecting one canonical tool
- it should recommend tool sequences, not generate another planning document
- it should not restate `issues_next`, `session_handoff`, or packet handoff as
  a second recommendation layer
- it should usually point to the shipped graph / operator / project-level
  workflows before falling back to lower-level `trace_*` chains

Current status:

- complete
- `suggest` now ships as a typed recommendation surface that:
  - prefers shipped graph / operator / project-intelligence workflows first
  - falls back to one canonical deterministic named tool only when those
    stronger workflows do not match
  - never calls `ask` as a public tool
- `investigate` now ships as a typed, read-only, bounded execution surface
  with:
  - explicit per-step tool records
  - explicit terminal stop reason
  - sequential execution only
  - aggregated advisory follow-on hints from executed results
- the first slice stays intentionally narrow:
  - no hidden packet execution
  - no write-capable automation
  - no vague oracle output

### Phase 6.6 Usefulness Evaluation And Default Exposure Rules

Close the roadmap by proving the new workflows are helpful enough to matter in
normal usage.

This phase should establish:

- workflow-level usefulness metrics
- default exposure rules for the strongest new workflows
- explicit non-promotion of noisy or weak workflows
- explicit exposure decisions for the shipped workflow families:
  - graph traversal:
    - `graph_neighbors`
    - `graph_path`
  - graph workflows:
    - `flow_map`
    - `change_plan`
  - operator workflow:
    - `tenant_leak_audit`
  - project-intelligence workflows:
    - `session_handoff`
    - `health_trend`
    - `issues_next`
  - bounded investigation workflows:
    - `investigate`
    - `suggest`
    - once `6.5` ships them
- reuse of the Roadmap 5 usefulness / promotion posture instead of inventing a
  second evaluation model
- an explicit fallback state for every workflow family that does not earn
  broader exposure

Current status:

- complete
- shared power-workflow usefulness contracts and helpers are landed
- focused realistic smoke coverage now exercises every shipped Roadmap 6 public
  workflow
- the shared eval runner now reports Roadmap 6 power-workflow usefulness and
  exposure decisions alongside the existing workflow-packet usefulness summary
- current target exposure policies are:
  - `graph_neighbors`: target `default`, fallback `opt_in`
  - `graph_path`: target `default`, fallback `opt_in`
  - `flow_map`: target `default`, fallback `opt_in`
  - `change_plan`: target `opt_in`, fallback `not_promoted`
  - `tenant_leak_audit`: target `opt_in`, fallback `dark`
  - `session_handoff`: target `opt_in`, fallback `dark`
  - `health_trend`: target `opt_in`, fallback `not_promoted`
  - `issues_next`: target `opt_in`, fallback `dark`
  - `investigate`: target `opt_in`, fallback `dark`
  - `suggest`: target `dark`, fallback `not_promoted`
- resolved exposure is data-dependent and advisory:
  - it depends on the current eval metrics
  - it does not currently hide tools from the registry or MCP listing

Roadmap 6 is expected to end at `6.6`.

No `6.7` is planned by default. A later phase should only be added if a truly
separate operational packaging problem appears after evaluation, not because
`6.6` stayed underspecified.

## What Comes Next

Roadmap 7 should start only after these workflows exist, are typed, and prove
useful.

Post-`6.6` internal cleanup may continue without opening a new Roadmap 6 phase
when all of these stay true:

- no new public workflow family is introduced
- the refactor is behavior-preserving
- the work reduces internal complexity rather than expanding scope

Roadmap 7 is where the system should generate stronger artifacts and workflow
integrations on top of these workflows.

Roadmap 8 is where telemetry should start changing ranking, routing, and
rollout policy automatically.
