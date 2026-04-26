# Phase 6.6 Usefulness Evaluation And Default Exposure

Status: `Complete`

## Goal

Close Roadmap 6 by proving the new workflows are helpful enough to matter in
normal usage, and by deciding their exposure state deliberately instead of
letting every shipped tool drift into the same rollout posture.

## Rules

- evaluate usefulness and noise, not just schema validity
- do not auto-promote weak workflows just because they exist
- keep human-tuned policy in this roadmap; learned rollout stays out
- reuse the Roadmap 5 usefulness and promotion posture where it fits
- require explicit non-promotion / opt-in fallback for workflows that do not
  earn broader exposure
- evaluate the shipped workflow families that now exist in `6.0`-`6.4`, not an
  abstract future workflow set
- do not add a `6.7` closeout phase unless `6.6` proves too small for a truly
  separate operational packaging problem

## Reused Machinery

This phase should explicitly reuse the strongest Roadmap 5 patterns instead of
re-deriving them:

- usefulness grading structure from `WorkflowPacketUsefulnessEvaluation`
- observed follow-up facts and `actualFollowupRate` as operator-facing inputs
- promotion-gate discipline from `shouldPromoteWorkflowPacketAttachment(...)`
  adapted to workflow-level exposure decisions

These should be treated as reusable patterns, not copied blindly. Roadmap 6
workflows may need workflow-specific thresholds, but they should start from the
same evaluation posture.

## Shipped Workflow Families To Evaluate

By the time this phase starts, Roadmap 6 should be evaluating concrete shipped
workflow families, not placeholders:

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

Evaluation should happen at the workflow-family level first, then at the
individual tool level when a family mixes higher-risk and lower-risk members.

## Required Coverage

By the end of this phase, every Roadmap 6 public workflow family should have:

- typed contract coverage
- focused workflow smokes
- at least one realistic or real usefulness check
- an explicit exposure decision recorded in roadmap docs or operator-facing
  rollout notes
- an explicit non-promotion fallback when the workflow is not default

The strongest candidates for default exposure should also have:

- explicit usefulness/noise thresholds
- documented opt-in fallback if the thresholds are not met
- operator-facing knobs that make the promotion logic inspectable instead of
  magical

## Required Eval Classes

This phase should not stop at “tool works.” For each shipped workflow family,
the evaluation pass should answer all of these:

- does the workflow answer a real question better than the lower-level tools it
  composes?
- is the output narrow and typed enough to avoid Fenrir-style sprawl?
- does it stay low-noise under realistic project context?
- if it suggests or drives next actions, is there evidence that the suggested
  action was actually useful or followed?
- if it is not strong enough for broader exposure, what is its explicit
  fallback state?

## Exposure And Rollout

This phase should define exposure state per workflow, for example:

- `default`
- `opt_in`
- `dark`
- `not_promoted`

Exposure should be decided deliberately, not all-or-nothing across the roadmap.
For example, a high-risk audit workflow may stay opt-in while a low-risk graph
workflow becomes default.

The default starting expectations should be:

- `tenant_leak_audit`
  - starts and likely stays `opt_in` unless calibration says otherwise
- `graph_neighbors` / `graph_path`
  - strongest candidates for broader exposure if they clearly beat raw trace
    chains for graph-shaped questions
- `flow_map` / `change_plan`
  - must prove they are more useful than `graph_path` plus existing Roadmap 5
    packets; otherwise they should stay `opt_in` or `not_promoted`
- `session_handoff` / `health_trend` / `issues_next`
  - may earn broader exposure in operator-facing contexts, but should still
    carry an explicit fallback state if they are noisy
- `investigate` / `suggest`
  - should start from `dark` or `opt_in`, not `default`, unless the eval data
    clearly shows they outperform just calling one canonical workflow directly

All Roadmap 6 workflows should inherit the existing tool-registry / MCP tool
surface by default unless a later phase explicitly adds prompt or resource
registration. No phase in this roadmap should assume a separate MCP surface
model without saying so.

Optional reference-repo or codexref inputs remain local-first and advisory in
this roadmap. No Roadmap 6 workflow should require external reference research
to function.

## Roadmap Closeout Rule

Roadmap 6 should end at `6.6` unless a genuinely separate problem appears.

That means:

- no `6.7` is planned by default
- `6.6` is responsible for closing the roadmap by evaluating and classifying
  the shipped workflow families
- a new `6.7` should only be opened if there is a clearly separate scope such
  as operational packaging or MCP surface expansion that no longer fits inside
  evaluation and exposure
- “we still need to decide which workflows deserve default exposure” is not a
  reason to add another phase; it is the point of `6.6`

## Success Criteria

- every shipped Roadmap 6 workflow family has real or realistic eval coverage
- every shipped Roadmap 6 workflow family has an explicit exposure state
- default exposure rules are explicit and human-tuned
- non-promoted workflows have an explicit fallback state instead of silent
  abandonment
- Roadmap 7 can start from workflows that already proved useful enough to keep

## Current Shipped Slice

This phase now ships:

- shared typed workflow-evaluation contracts in the contracts package
- reusable power-workflow usefulness and exposure helpers in the tools package
- focused realistic smoke coverage over the shipped Roadmap 6 tool families
- eval-runner integration so Roadmap 6 workflow usefulness can appear on the
  shared eval surface instead of only in a sidecar smoke

The current exposure decisions are:

- these are advisory rollout decisions, not a runtime registry filter
- `dark` currently means "registered but not recommended or broadly exposed by
  default," not "hidden from the tool registry"
- the helper tracks:
  - target exposure
  - fallback exposure
  - resolved exposure for the current eval data
  - promotion path:
    - `target_met`
    - `threshold_failed`
    - `policy_capped`
- the current thresholds are intentionally first-slice and permissive:
  - `minEligibleCount: 1`
  - they are suitable for local calibration smokes
  - operators should raise them before relying on broader rollout decisions

- `graph_neighbors`
  - target: `default`
  - fallback: `opt_in`
- `graph_path`
  - target: `default`
  - fallback: `opt_in`
- `flow_map`
  - target: `default`
  - fallback: `opt_in`
- `change_plan`
  - target: `opt_in`
  - fallback: `not_promoted`
- `tenant_leak_audit`
  - target: `opt_in`
  - fallback: `dark`
- `session_handoff`
  - target: `opt_in`
  - fallback: `dark`
- `health_trend`
  - target: `opt_in`
  - fallback: `not_promoted`
- `issues_next`
  - target: `opt_in`
  - fallback: `dark`
- `investigate`
  - target: `opt_in`
  - fallback: `dark`
- `suggest`
  - target: `dark`
  - fallback: `not_promoted`

Under the focused shipped smoke, the resolved exposures are:

- `graph_neighbors`: `default`
- `graph_path`: `default`
- `flow_map`: `default`
- `change_plan`: `opt_in`
- `tenant_leak_audit`: `opt_in`
- `session_handoff`: `opt_in`
- `health_trend`: `opt_in`
- `issues_next`: `opt_in`
- `investigate`: `opt_in`
- `suggest`: `dark`

## Smoke Coverage

The shipped coverage now proves:

- focused power-workflow usefulness grading over all public Roadmap 6 tools
- explicit exposure decisions for every shipped Roadmap 6 tool
- shared eval-runner summary coverage for bounded-investigation tools
- Roadmap 5 workflow-packet usefulness and Roadmap 6 workflow usefulness can
  coexist on the same eval surface without inventing a second runner
- unsupported bounded-investigation outputs grade as `no` and resolve to their
  fallback exposure instead of accidentally promoting
