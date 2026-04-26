# Phase 6.4 Project Queue, Health Trend, And Session Handoff

Status: `Complete`

## Goal

Lift the current file-level and answer-level signals into project-level
surfaces:

- one queue-oriented “what next?” workflow
- `health_trend`
- `session_handoff`

## Rules

- keep queue semantics strict: one active focus by default
- reuse existing diagnostics, trust, and follow-up history
- do not add a scheduler or background worker
- derive project state from existing append-only facts first
- do not quietly introduce mutable queue state in the first slice

## Surface Split

This phase should treat these as different products:

- `health_trend`
  - derived trend summary over diagnostics, trust state, and follow-up facts
- `session_handoff`
  - derived current-state summary for the next working session
- one queue-oriented “what next?” workflow
  - a ranked recommendation surface, not automatically a persisted task board

For the first slice, “one active focus” should mean:

- one top-ranked current recommendation in the derived output
- clear reason it is active
- clear done / stop conditions

It should not imply hidden mutable task state unless that state is explicitly
introduced and justified in a later slice.

## Recommended Shipping Order

Do not treat all three surfaces as equal-risk in one undifferentiated drop.
The intended order is:

1. `session_handoff`
   - lowest-risk
   - pure current-state derivation
2. `health_trend`
   - only after history is sufficient to support a real trend
3. queue-oriented “what next?”
   - highest design risk
   - only after the first two prove the source facts are stable enough

## Current Shipped Slice

`6.4` is now fully shipped as three derived, read-only operator workflows over
the same recent-trace / trust / comparison / follow-up substrate:

1. `session_handoff`
   - summarizes recent answer traces with:
     - trust state
     - comparison state
     - recorded follow-up momentum
   - supports a caller-selected recent-trace window:
     - default `8`
     - max `32`
   - chooses at most one current focus from unresolved recent traces
   - returns explicit:
     - reason code
     - stop conditions
     - recent query summaries
     - basis provenance
   - does not let older traces inherit newer target-level trust or comparison
     state when those traces do not have their own direct evaluation
   - may return `currentFocus: null` when recent traces are stable,
     superseded, or have no active unresolved signal
   - currently applies a small completion bias:
     - unresolved traces with recorded follow-up momentum rank slightly above
       otherwise-equal unresolved traces with no recorded follow-up yet

2. `health_trend`
   - compares the most recent half of the chosen trace window against the prior
     half
   - reports:
     - full-window health counts
     - recent-window counts
     - prior-window counts
     - per-metric trend directions for:
       - unresolved queries
       - stable queries
       - changed queries
       - contradicted queries
       - insufficient-evidence queries
       - queries with follow-ups
   - uses the same recent-trace window contract:
     - default `8`
     - max `32`
   - does not fabricate a trend line when history is thin:
     - below four traces, metrics stay `insufficient_history`
     - a warning explains the missing history
   - keeps the first slice intentionally simple:
     - trend metrics are absolute counts, not normalized rates
     - metric families are independent indicators, not a partition of all
       recent traces

3. `issues_next`
   - ships the queue-oriented “what next?” surface as a ranked recommendation
     workflow
   - remains a recommendation list, not a mutable task board
   - derives:
     - one current issue
     - zero or more queued issues
   - each issue carries:
     - the underlying query summary
     - reason code
     - reason text
     - stop conditions
   - does not introduce mutable queue state:
     - the current issue is simply the top-ranked unresolved recent trace
     - queued issues are the remaining unresolved recent traces in rank order
   - currently keeps a small completion bias:
     - unresolved traces with recorded follow-up momentum rank slightly above
       otherwise-equal unresolved traces with no recorded follow-up yet
   - uses the same recent-trace window contract:
     - default `8`
     - max `32`
   - caps queued recommendations in the first slice:
     - max `10`
     - warnings make truncation explicit instead of silently dropping tail
       items

Across all three shipped surfaces:

- a stable trust state with a newer meaningful comparison change is still
  treated as active for handoff and queue purposes
- the first slice prefers making that changed comparison visible over
  collapsing it into “stable”

This phase remains derived-only:

- no mutable queue backing store
- no hidden active-task state
- no scheduler or background recomputation

## Non-Goals

- no hidden mutable queue backing store
- no fake trend line without enough history
- no handoff that only restates the last answer instead of project state

## Success Criteria

- a user or agent can ask what to work on next without manually assembling that
  view from many tool calls
- a session handoff can summarize real project state, not just the last answer
- the first shipped queue semantics are fully explainable from derived facts

## Smoke Coverage

The shipped `6.4` slice should prove:

- `session_handoff`
  - recent answer traces are ranked into one derived current focus when
    unresolved project state exists
  - stable recent traces do not inherit newer target-level comparison state
  - traces without their own trust evaluation do not inherit a newer
    target-level changed state
  - follow-up counts and last-follow-up timestamps are carried into the handoff
  - the caller can narrow the recent-trace window and that chosen limit appears
    in basis provenance
  - basis provenance reflects the current index/schema substrate
  - `currentFocus` can be absent when recent project state is stable
- `health_trend`
  - the same recent traces produce stable full-window, recent-window, and
    prior-window counts
  - metric directions are explicit instead of implied
  - thin history returns `insufficient_history` rather than fake movement
- `issues_next`
  - one current issue is derived from the same unresolved focus ranking as
    `session_handoff`
  - stable recent traces are suppressed from the queue-oriented output
  - the caller can narrow the recent-trace window and the derived queue follows
    that same limit
  - queued recommendations truncate explicitly instead of returning an
    unbounded list
