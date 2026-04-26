# Roadmap Version 6 Handoff

This file is the execution handoff for the Roadmap 6 build cycle.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-5/handoff.md](../version-5/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)
- [../../scratch/fenrir_tools.md](../../scratch/fenrir_tools.md)

## Roadmap Intent

Roadmap 6 is the `Power Workflows And Operational Intelligence` roadmap.

Its purpose is to turn the shipped deterministic substrate into a small set of
high-leverage workflows that feel powerful in day-to-day use.

The target outcome is:

- graph/path answers over the existing code + DB substrate
- whole-flow and change-scope answers
- operator-grade tenancy/auth audits
- project-level queue and handoff surfaces
- one bounded investigation mode over existing named tools

## Mandatory Entry Assumptions

Treat these as already solved:

- code/database/index primitives
- the investigation composer family
- trust, diagnostics, compare, and follow-up tracking
- workflow packets and handoff-driven next actions

Do not reopen those just because the new workflows would be easier if the
lower layers changed.

## Working Rules

1. **Compose existing substrate first.**
   - Prefer using current named tools, snapshots, and stores before adding new
     persistence or new primitive families.

2. **Keep outputs typed.**
   - No Fenrir-style decorative text blobs.
   - Human rendering is a projection of typed data, not the canonical form.

3. **One canonical workflow per question shape.**
   - `graph_path` is enough; do not also add three near-duplicate path tools.
   - `session_handoff` is enough; do not add multiple overlapping summary tools
     without proof they answer different questions.

4. **Stay local-first.**
   - Local project evidence remains the primary source of truth.
   - Optional reference-repo research stays clearly source-labeled and
     secondary.

5. **Bound investigation tightly.**
   - If `investigate` lands, it must:
     - call existing named tools
     - keep an explicit step budget
     - log what it did
     - return typed output
     - prefer the strongest shipped workflow first instead of jumping straight
       to low-level trace chains
     - avoid calling `ask` internally as a second router
   - Do not ship a vague oracle wrapper.

6. **Keep project queue semantics strict.**
   - One active focus by default.
   - Do not mark work done when verification is still failing.
   - Remove obsolete tasks instead of leaving stale queue items behind.
   - For the first shipped slice, prefer deriving that active focus from
     existing project facts rather than introducing mutable queue state.

7. **No ML or learned rollout in this roadmap.**
   - Telemetry may inform human decisions.
   - Telemetry must not silently rewrite ranking or policy here.

8. **Do not duplicate Roadmap 5 packet products.**
   - `change_plan` must stay graph-derived and scope-oriented.
   - `suggest` must stay a bounded multi-tool recommendation surface.
   - If a workflow starts recreating `implementation_brief`,
     `impact_packet`, or `verification_plan`, stop and narrow it.

9. **Close Roadmap 6 at `6.6` unless a separate problem actually appears.**
   - `6.6` should evaluate the shipped workflow families and decide exposure.
   - Do not open `6.7` just because rollout decisions are still vague.
   - Only add another phase if there is a clearly separate operational or MCP
     packaging scope that does not fit inside evaluation and default exposure.

## Research-Derived Guidance

Keep these patterns in mind:

- **Fenrir:** one call, many sources, one structured answer
- **Fenrir lessons:** no tool sprawl, no scheduler coupling, no ML before
  heuristics
- **OpenHands ACI:** typed graph traversal parameters
- **OpenHands task tracker:** one active task, explicit done criteria
- **Roadmap 5 reference process:** local-first, codexref/reference-second

Carry these implementation constraints through the phases:

- graph edges must declare exact vs heuristic status
- graph hops must carry evidence/provenance, not just labels
- tenant/auth audits must classify findings as direct evidence vs weak signal
- project queue state is derived-first in this roadmap
- Roadmap 5 usefulness and follow-up machinery should be reused where exposure
  policy is needed
- exposure should be decided per workflow family, not only once at the roadmap
  level

## What To Avoid

- no new scheduler dependency
- no ML / learned policy
- no generated artifacts that belong in Roadmap 7
- no giant graph platform before the first graph workflows prove useful
- no public workflow tool without a real user question it answers better than
  current traces and packets
- no queue semantics that quietly depend on hidden mutable state
- no tenant-leak claims without a pinned tenant-boundary model

## Verification Posture

Each phase should leave behind:

- typed contract coverage
- focused workflow smokes
- at least one real or realistic usefulness check
- doc updates when behavior or scope changes

Concrete first-slice defaults to keep reviews honest:

- `graph_neighbors`
  - start with shallow default depth and explicit opt-in for deeper traversal
- `tenant_leak_audit`
  - never emit a finding without a pinned evidence ref
  - first rollout should be advisory / opt-in
- `session_handoff`
  - derive from project facts, not just the last answer
- `investigate`
  - keep a hard numeric step budget

Closeout defaults for `6.6`:

- graph traversal and graph workflow tools should earn broader exposure only if
  they prove more useful than the lower-level traces and packets they compose
- `tenant_leak_audit` should remain `opt_in` unless calibration proves the
  false-positive posture is strong enough for anything broader
- project-intelligence surfaces should carry explicit fallback states even if
  they are eventually shown more broadly
- `investigate` / `suggest` should start from `dark` or `opt_in`, not
  `default`, unless the eval data is unusually strong

## Expected Completion State

Roadmap 6 is complete when:

- mako can answer path/flow/operator questions it could not answer cleanly
  before
- at least one project-level queue / handoff surface exists
- one bounded investigation mode exists without turning into a vague oracle
- the new workflows are eval-backed and narrow enough to avoid Fenrir-style
  sprawl

At that point, Roadmap 7 can generate artifacts and deeper workflow
integrations on top of workflows that already matter.

## Current Status

- Roadmap 6 is complete.
- Post-close cleanup also landed after `6.6`.
- That cleanup was internal and behavior-preserving:
  - no new public workflows
  - no new roadmap phase
  - no exposure-policy change
- The main internal cleanup splits were:
  - tool schema/contracts monolith reduction
  - ask-router helper extraction
  - workflow-packet generator module splits
  - graph traversal / workflow extraction
  - eval-runner helper extraction
  - store facade and trust/query module splits
  - harness server route-family extraction
  - engine answer-handler helper extraction
- `6.0` is complete.
- The shipped graph slice is still intentionally exact-first and derived-first.
- `6.1` is complete.
- Traversal now lives at the tool layer:
  - `graph_neighbors`
  - `graph_path`
- graph traversal still starts from a whole-project derived slice, but tool
  calls now reuse a cached slice per project basis instead of rebuilding
  adjacency state on every traversal
- `calls_rpc` now exists as an opt-in heuristic edge built from indexed
  schema-usage evidence.
- `6.2` is complete.
- Whole-flow and change-scope answers now live at the graph layer:
  - `flow_map`
  - `change_plan`
- `flow_map` is path-native, not packet-shaped.
- `change_plan` stays graph-derived by returning direct path surfaces plus
  one-hop dependent surfaces instead of recreating Roadmap 5 briefs.
- `6.3` is complete.
- `tenant_leak_audit` now ships as an advisory / opt-in operator workflow over:
  - tenant-keyed tables
  - RLS posture
  - RPCs touching protected tables
  - indexed route/file RPC usage sites
- direct findings remain narrow and evidence-backed.
- weaker policy / RPC / usage signals stay weak warnings, not leak claims.
- `6.4` is complete.
- `session_handoff` is derived-only and summarizes:
  - recent answer traces
  - trust/comparison state
  - recorded follow-up facts
- `health_trend` is derived-only and compares the most recent half of the
  chosen trace window against the prior half.
- `issues_next` is the queue-oriented “what next?” surface and remains
  derived-only:
  - one current issue
  - ranked queued issues
  - no hidden mutable queue backing store
  - recommendation list, not a persisted task board
  - current ranking still carries a small completion bias for unresolved traces
    that already have recorded follow-up momentum
- all `6.4` surfaces share the same recent-trace window contract:
  - default `8`
  - max `32`
- `6.5` should now compose against those shipped surfaces directly:
  - complete
  - `suggest` now recommends:
    - shipped graph workflows first
    - shipped operator / project-intelligence workflows next
    - one ask-routed canonical tool only when those stronger workflows do not
      match
  - `investigate` now executes a bounded sequential read-only chain over the
    same surfaces and returns typed step history
  - neither surface calls `ask` as a public tool
  - neither surface auto-executes packet follow-ons in the first slice
- `6.6` is complete.
- the shipped Roadmap 6 workflow families now have explicit target exposure
  policies:
  - `graph_neighbors`: target `default`
  - `graph_path`: target `default`
  - `flow_map`: target `default`
  - `change_plan`: target `opt_in`
  - `tenant_leak_audit`: target `opt_in`
  - `session_handoff`: target `opt_in`
  - `health_trend`: target `opt_in`
  - `issues_next`: target `opt_in`
  - `investigate`: target `opt_in`
  - `suggest`: target `dark`
- fallback states are now explicit instead of implied:
  - graph traversal / `flow_map`: `opt_in`
  - `change_plan`: `not_promoted`
  - `tenant_leak_audit`: `dark`
  - `session_handoff`: `dark`
  - `health_trend`: `not_promoted`
  - `issues_next`: `dark`
  - `investigate`: `dark`
  - `suggest`: `not_promoted`
- resolved exposure remains advisory/operator-facing in this roadmap:
  - it depends on current eval metrics
  - it does not currently hide tools from the registry or MCP tool listing
- No additional phase is planned after `6.6` right now.
