# Roadmap Version 5

This file is the canonical roadmap for the Roadmap 5 build cycle.

If another Roadmap 5 doc disagrees with this file about what the roadmap is for,
what phases it contains, or what counts as done, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-4/roadmap.md](../version-4/roadmap.md)
- [../version-4/handoff.md](../version-4/handoff.md)
- [../version-4/phases/phase-4.7-workflow-context-bridge.md](../version-4/phases/phase-4.7-workflow-context-bridge.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Roadmap Contract

Roadmap 5 is the `Context And Workflow Assistance` roadmap.

Its job is to turn the trust-aware answer surface into typed workflow-context
products that help real coding work.

Roadmap 5 should make `mako-ai` better at:

- packaging relevant context for a real task
- showing what to read/change/verify next
- finding precedent before new code is invented
- carrying trust, diagnostics, and compare history into workflow decisions
- expressing repair/review/verification loops with explicit stop conditions
- making those workflow products influence the normal answer/composer path
  instead of living only behind a separate packet surface
- using reference-backed research as an explicit secondary process when local
  repo evidence is not enough

Roadmap 5 does **not** rebuild:

- trust storage
- rerun/compare semantics
- contradiction policy
- the harness or provider layer
- the generated-artifact/product-integration layer from Roadmap 7

## Entry Assumptions

Roadmap 5 begins with all of these already shipped:

- `AnswerResult` with additive `trust`, `diagnostics`, and `ranking`
- comparable answer history and rerun/compare
- trust-state reads and history
- alignment diagnostics
- the local trust-eval runner and real ForgeBench suites
- `WorkflowContextBundle`
- `WorkflowPacketRequest`
- `WorkflowPacketInput`
- shared workflow-packet contracts
- shared workflow-packet citation / section envelope
- one workflow-packet registry / formatter seam
- built-in `implementation_brief`, `precedent_pack`, `impact_packet`, `verification_plan`, and `workflow_recipe` generators

That means the first Roadmap 5 phase should define packet contracts and
generators on top of the bridge, not reopen extraction or trust logic.

## Core Deliverables

Roadmap 5 should ship five packet families:

- `implementation_brief`
- `impact_packet`
- `precedent_pack`
- `verification_plan`
- `workflow_recipe`

Every packet family should:

- consume `WorkflowPacketInput`
- cite typed context items, not prose fragments
- preserve `openQuestions`
- expose the trust and diagnostic basis for its claims
- remain compact and decision-oriented
- be decision-complete enough that an implementer does not need to invent missing packet semantics at use time

Every workflow-oriented packet should also carry explicit loop semantics:

- current step or step list
- verification rule(s)
- stop condition(s)
- what should trigger a rerun or refresh

## Research-Grounded Shape

Roadmap 5 should preserve these design patterns:

1. **Typed context transport**
   - from the Cody-style context-item model
   - packets consume discriminated-union context items, not loose JSON blobs

2. **Compact plan structure**
   - from Codex/OpenCode plan/spec patterns
   - packets should prefer:
     - summary
     - key changes / risks / invariants
     - verification
     - assumptions

3. **Workflow loops with stop conditions**
   - from SWE-agent and OpenHands task/repair loops
   - recipes should explicitly say:
     - analyze
     - reproduce / verify
     - edit or inspect
     - re-verify
     - edge-case checks
     - stop
   - recipe step state should stay intentionally small:
     - `todo`
     - `in_progress`
     - `done`
   - one step should normally be active at a time
   - automated consumers should preserve the same discipline:
     - do not mark `done` while verification is still failing
     - keep blocked or partial work `in_progress`
     - remove obsolete steps instead of leaving dead workflow state behind

4. **Automation boundary**
   - from Continue’s maturity model
   - Roadmap 5 should stop at:
     - on-demand packet generation
     - watch-mode assistance
     - optional hook/CI wrappers
   - it should not require:
     - always-on daemon workers
     - zero-intervention automation

5. **Surface separation**
   - from MCP server reference patterns
   - Roadmap 5 should not assume every packet belongs only behind a tool call
   - likely split:
     - tools for packet generation
     - prompts for guided packet consumption or workflow handoff
     - resources where reusable/static packet-adjacent context makes sense

## Packet Rules

These rules should hold across the roadmap:

1. `WorkflowPacketInput` is the packet entry seam.
2. No packet generator reparses `AnswerResult` directly.
3. No packet generator invents unsupported claims.
4. Packet content must trace back to:
   - workflow context items
   - trust signals
   - diagnostics
   - compare summaries
   - open questions
5. Every packet should use one shared envelope with stable id, family, sections,
   citations, assumptions, and open questions.
6. Generated prose is allowed only as the final rendering of a typed packet, not
   as the canonical internal representation.
7. Do not add public packet-generation APIs without a real consumer/callsite.

## Automation Rules

Roadmap 5 should preserve this order:

1. on-demand packet generation
2. watch-mode refresh loops
3. optional git hook / CI / scheduled wrappers

Do not skip directly to background automation.

Do not make packet usefulness depend on a scheduler existing.

Start with one narrow workflow wrapper before expanding to many.

Only wrap packet families that already have stable contracts and acceptable
human intervention rates.

## Evaluation Rule

Roadmap 5 must reuse the Roadmap 4 evaluation posture.

That means:

- add packet-family-focused smokes and/or fixtures as packet families ship
- evaluate packet usefulness against real ForgeBench-style scenarios where possible
- keep packet regression checks local-first and repo-grounded

## Phase Sequence

1. `Phase 5.0` — packet contracts and citation rules
2. `Phase 5.1` — implementation briefs and precedent packs
3. `Phase 5.2` — impact packets and verification plans
4. `Phase 5.3` — workflow recipes and stop conditions
5. `Phase 5.4` — packet surfaces and watch mode
6. `Phase 5.5` — default consumers and optional wrappers
7. `Phase 5.6` — agent-power integration and reference-grounded processes

## Phase Summary

### Phase 5.0 Packet Contracts And Citation Rules

Define the shared packet contract layer on top of the shipped `4.7` bridge.

This phase should establish:

- the packet-family discriminated union
- shared citation/reference envelopes
- packet summary / assumptions / risks / verification sections
- packet registry/generator contract
- packet evaluation expectations

This phase is now shipped and should be treated as baseline for `5.1+`.

### Phase 5.1 Implementation Briefs And Precedent Packs

Ship the first two high-value packets:

- `implementation_brief`
- `precedent_pack`

These should answer:

- what should I change?
- what must I preserve?
- what already exists that I should reuse?

This phase is now shipped and should be treated as baseline for `5.2+`.

### Phase 5.2 Impact Packets And Verification Plans

Ship the next two packet families:

- `impact_packet`
- `verification_plan`

These should answer:

- what else moves if I touch this?
- how do I prove this change is correct?

This phase is now shipped and should be treated as baseline for `5.3+`.

### Phase 5.3 Workflow Recipes And Stop Conditions

Add loop-style workflow packets:

- `workflow_recipe`

This phase should make repair/review/verify loops explicit rather than leaving
them as vague next-step prose.

This phase is now shipped and should be treated as baseline for `5.4+`.

The shipped recipe layer keeps the loop contract intentionally tight:

- `todo` / `in_progress` / `done`
- one active step by default
- per-step verification
- per-step stop conditions
- per-step rerun/refresh triggers

### Phase 5.4 Packet Surfaces And Watch Mode

Expose packets cleanly through the product surfaces:

- tools
- prompts
- resources where justified
- CLI/web/API/MCP consumption
- watch-mode refresh of packet views

This phase is now shipped at the shared-surface layer.

What landed:

- one shared `WorkflowPacketSurface` contract
- built-in `workflow_packet` tool
- direct API route/service method for packet generation
- CLI packet command
- web tool-call rendering for workflow packets
- opt-in watch metadata with refresh reason and refresh triggers

Prompts/resources remain represented intentionally through `surfacePlan`, but
not yet registered as separate MCP surfaces in this phase.

### Phase 5.5 Default Consumers And Optional Wrappers

The closing slice ships one packet consumer in the default product path and
leaves narrow wrappers as optional follow-on work:

- additive packet use in an existing investigation flow
- git hooks
- CI jobs
- scheduled packet refresh/report generation

These remain additive, not prerequisites.

The shipped capstone for this phase is:

- a companion `verification_plan` in the existing `trace_file` /
  `file_health` answer flow
- additive rendering in the normal CLI/API/web answer path
- no new packet-generation seam beyond the shipped workflow-packet layer
- wrapper rollout deferred until this default-path consumer proves useful

The first wrapper should stay intentionally narrow:

- one daily friction point
- one stable packet family or tightly coupled pair
- explicit human review/approval boundaries

If MCP exposure expands in this phase, preserve the `tools` / `prompts` /
`resources` split and prefer shared server-level instructions for cross-surface
workflow guidance instead of duplicating the same rules in every tool or prompt.

### Phase 5.6 Agent-Power Integration And Reference-Grounded Processes

`5.0` through `5.5` shipped the packet layer and one real default-path
consumer. A post-closeout review found the remaining weakness clearly:

- the packet layer is real
- the packet layer is typed
- but the packet layer still influences too little of the normal agent/tool loop

`5.6` exists to fix that before Roadmap 7 starts generating broader workflow
artifacts.

This phase should make `mako-ai` stronger in the places users and agents
already work:

- the `ask` router
- high-signal answer and composer flows
- the existing answer-enrichment seam
- the CLI/API/web result path

It should also define one explicit research process for broader precedent
gathering that fits `mako-ai`'s local-first model:

- local project evidence remains primary
- external reference-repo research is secondary and source-labeled
- broad reference search should start with hybrid pattern search
- exact identifier confirmation should use literal or regex lookup
- final incorporation into a packet should use file-level grounding, not a loose
  search snippet

The subphases for `5.6` are:

1. `5.6.1` — packet recommendation and default-path expansion
2. `5.6.2` — workflow state and execution handoff in the main loop
3. `5.6.3` — reference-grounded precedent and research process
4. `5.6.4` — workflow usefulness evaluation and promotion rules
5. `5.6.5` — handoff-driven next actions
6. `5.6.6` — execution-ready workflow actions

The first `5.6.1` slice is now shipped:

- companion attachment uses one shared recommendation policy
- `ask` inherits that policy automatically through the shared enrichment seam
- the companion surface now explains why it attached
- the promoted default-path set is currently:
  - `route_trace`
  - `file_health`
  - `trace_file`
  - `trace_table`
  - `trace_rpc`

This is intentionally narrower than “all answer flows.” `auth_path` stays
available but is not auto-attached yet because real-repo runs did not justify
promoting it blindly. The current executable guard for that policy lives in
[test/smoke/ask-router-goldens.ts](../../../test/smoke/ask-router-goldens.ts).

The first `5.6.2` slice is also now shipped:

- `WorkflowPacketSurface` carries a compact workflow handoff:
  - `current`
  - `stopWhen`
  - optional `refreshWhen`
- `verification_plan` and `workflow_recipe` derive that handoff once in the
  shared surface layer
- `implementation_brief`, `impact_packet`, and `precedent_pack` intentionally
  do not emit a handoff
- the normal answer path now shows the compact handoff instead of dumping the
  full companion packet by default
- dedicated packet surfaces keep the full rendered packet, but lead with the
  compact handoff summary

`5.6.3` is now shipped:

- packets can carry source-labeled `reference_precedent` context items from
  reference repos
- `precedent_pack` keeps strong local precedents canonical, and only falls back
  to external precedents when local context is weak or missing
- external reference precedents stay explicitly advisory and do not affect local
  trust state
- runtime reference usage is still caller-supplied; mako does not yet make live
  `codexref` calls in the default product path

`5.6.4` is now shipped:

- the shared eval runner records companion packet family, handoff state, and a
  workflow usefulness grade
- usefulness is graded as `full`, `partial`, or `no`
- usefulness still uses packet-quality signals, but it now also recognizes
  actual packet-guided follow-up executions when they happen through mako
- run summaries now expose promotion metrics:
  - eligible packet count
  - attached packet count
  - helped-next-step rate
  - actual-followup count / rate
  - no-noise rate
- real ForgeBench workflow-usefulness coverage is now part of the trust-eval
  runner output

`5.6.5` is now shipped:

- companion-packet handoff now synthesizes the first `candidateAction` in the
  shared answer-enrichment path
- the normal answer path keeps native tool actions, but the workflow-derived
  action now leads the list when a real handoff exists
- CLI and web render candidate actions directly in the default answer view, so
  the packet guidance is part of the normal loop instead of packet-only detail

`5.6.6` is now shipped:

- workflow-guided candidate actions now carry optional execution metadata
- the first handoff-driven action points at the real `workflow_packet` tool
  with concrete packet input derived from the current answer
- execution input now carries canonical `queryText` plus structured
  `queryArgs` for exact replay of promoted composer/answer flows
- eval-visible actual values now record the first candidate action's execution
  target for future workflow-alignment assertions

True packet-guided follow-up tracking is now shipped on top of that execution
path:

- executing the synthesized `workflow_packet` candidate action now writes an
  append-only `workflow_followups` fact row keyed by the originating
  `queryId` and `actionId`
- the follow-up row records the origin packet family plus the resulting packet
  and rerun query ids, so usefulness/eval code can distinguish “action existed”
  from “action was actually taken”
- actual-followup rate is now available as an operator-facing promotion knob,
  but Roadmap 5 stops at surfacing and evaluating that signal
- autonomous attachment rollout based on telemetry is intentionally deferred to
  Roadmap 8, where learned ranking and failure-clustering scaffolding exist

## What Roadmap 5 Should Close

Before Roadmap 5, `mako-ai` can answer many direct questions and evaluate
their trust, but it still makes the user or external agent assemble workflow
guidance by hand.

Roadmap 5 should close that gap by making these first-class products:

- implementation context
- impact context
- precedent context
- verification context
- workflow-loop context
- packet guidance that shows up in normal answer/composer workflows
- an explicit reference-backed research process that helps precedent and plan
  quality without weakening local trust semantics

## What Comes Next

Roadmap 6 should start only after these typed packets exist, are stable, and
materially influence the normal tool path.

Roadmap 6 is where the system should cash the packet/trust substrate out into
stronger deterministic workflows and operational intelligence, not generated
artifacts.

Roadmap 7 is where the system should generate stronger workflow artifacts and
broader workflow integrations on top of those stable workflows.

Roadmap 8 is where telemetry should start changing policy automatically. That
is where learned ranking, promotion from observed history, and safe rollback
machinery belong.
