# Roadmap Version 5 Handoff

This file is the execution handoff for the Roadmap 5 build cycle.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-4/roadmap.md](../version-4/roadmap.md)
- [../version-4/handoff.md](../version-4/handoff.md)
- [../version-4/phases/phase-4.7-workflow-context-bridge.md](../version-4/phases/phase-4.7-workflow-context-bridge.md)

## Roadmap Intent

Roadmap 5 is the `Context And Workflow Assistance` roadmap.

Its purpose is to package the already-shipped answer/trust/diagnostic substrate
into typed workflow-context products that are directly useful during coding
tasks.

The target outcome is:

- packet generators that consume the bridge layer
- workflow-ready outputs for common engineering tasks
- explicit loop/verification semantics
- usable surfaces across CLI/API/MCP/web
- optional automation wrappers only after the packet layer is stable
- packet outputs and workflow state influencing the normal tool path instead of
  staying a separate lane
- one explicit, source-labeled research process for broader precedent gathering

## Mandatory Entry Assumptions

Treat these as already solved:

- answer history and trust state
- rerun/compare
- diagnostics and ranking
- local evaluation harness
- `WorkflowContextBundle`
- `WorkflowPacketRequest`
- `WorkflowPacketInput`
- shared workflow-packet contracts and schemas
- shared citation / section envelope
- one workflow-packet registry / formatter seam
- built-in `implementation_brief`, `precedent_pack`, `impact_packet`, `verification_plan`, and `workflow_recipe` generators

Do not reopen any of those just because packet generation would be easier if
the lower layers changed.

## Working Rules

1. **Consume the bridge, not raw answers.**
   - Packet generators should start from `WorkflowPacketInput`.

2. **Keep packets typed.**
   - Internal packet representation stays structured.
   - Final human-readable rendering is a projection of typed packet data.
   - Every packet should use one shared envelope with stable id, family,
     sections, citations, assumptions, and open questions.
   - Reuse the shipped registry / formatter seam instead of adding family-local
     packet infrastructure.

3. **Use compact packet structure.**
   - Prefer summary, changes, risks, verification, assumptions.
   - Avoid sprawling “AI report” blobs.
   - Keep packets decision-complete, not just descriptive.

4. **Make workflow loops explicit.**
   - Recipes must say:
     - what to do
     - how to verify it
     - when to continue
     - when to stop
   - Recipe step state should stay intentionally small:
     - `todo`
     - `in_progress`
     - `done`
   - Only one step should normally be active at a time.
   - Automated refreshes should not relax that rule.
   - Do not mark steps `done` while tests are failing, implementation is
     incomplete, or unresolved errors remain.
   - Remove obsolete steps instead of leaving stale workflow state behind.

5. **Do not require automation to make packets useful.**
   - On-demand first.
   - Watch mode second.
   - Hooks/CI later.
   - Do not wrap unstable packet families just because automation is possible.
   - Start with one narrow daily-friction workflow before expanding wrappers.

6. **Separate surfaces intentionally.**
   - Tools are not the only output path.
   - Prompts/resources may be the cleaner fit for some packet-consumption flows.
   - Where MCP exposure needs shared workflow guidance, prefer server-level
     instructions over repeating the same guidance in every tool.
   - If MCP-facing wrappers appear, keep them modular:
     - `registerTools(...)`
     - `registerPrompts(...)`
     - `registerResources(...)`
     rather than one mixed registration seam.

7. **Keep local evidence primary.**
   - `mako-ai` is still a local-first repo intelligence engine.
   - External reference-repo research is secondary.
   - Do not let external repo hits rewrite local trust state or local answer
     truth.
   - If broader precedent research is used, label it explicitly as reference
     evidence rather than local project evidence.

8. **Use the reference process deliberately.**
   - Broad pattern mining should start with hybrid repo search (`ref_ask`-style
     search).
   - Exact identifier or API confirmation should use literal/regex lookup
     (`ref_search`-style search).
   - Final incorporation should use file-level grounding (`ref_file`-style
     reads), not loose snippets.
   - Keep this process optional and explicit; do not make Roadmap 5 depend on
     external reference repos being present.

## Packet Families To Ship

Roadmap 5 should deliver:

- `implementation_brief`
- `precedent_pack`
- `impact_packet`
- `verification_plan`
- `workflow_recipe`

The first five families are now present in the shared generator layer.

Remaining practical order after the original packet closeout:

1. deepen default-path packet consumption
2. make workflow state visible in the main loop
3. add source-labeled broader precedent research only where it is truly useful
4. keep wrappers narrow and optional on top of that

The default-path consumer from `5.5` is now shipped:

- `trace_file` and `file_health` attach a companion `verification_plan`
- the companion packet is additive in the normal CLI/API/web answer path
- the implementation reuses the shipped workflow-packet seam rather than
  introducing a new packet-generation path

`5.6` is now the shipped closeout state for Roadmap 5. The packet layer no
longer lives only in a separate lane; it now shapes enough of the normal
agent/tool loop to hand cleanly to Roadmap 6's power-workflow build.

## Research-Derived Guidance

Keep these patterns in mind:

- **Cody:** typed context-item transport and explicit source labeling
- **Codex/OpenCode:** compact, decision-complete plan/spec format
- **SWE-agent/OpenHands:** explicit analyze/reproduce/edit/verify/edge-case loops
- **Continue:** Level 2 automation boundary only
- **MCP server references:** tools/prompts/resources are separate surfaces
- **OpenHands:** one active step, strict `done` criteria, remove obsolete tasks
- **codexref:** hybrid pattern search first, exact lookup second, file grounding
  before reuse

## What To Avoid

- no new raw-answer extraction seams
- no workflow engine before packet families exist
- no scheduler or daemon dependency
- no generated artifacts that belong in Roadmap 7
- no giant packet taxonomy before the first packet families prove useful
- no public packet API without a real consumer that needs it
- no external-reference behavior that blurs local truth with reference patterns

## Verification Posture

Each phase should leave behind:

- typed contract coverage
- focused packet-generation smokes
- at least one real or synthetic consumer-fit check
- usefulness-oriented checks once the workflow layer reaches `5.6`
- doc updates when behavior or phase scope changes

## Expected Completion State

Roadmap 5 is complete when:

- the main packet families exist
- they consume the shared bridge contract
- workflow recipes have explicit stop conditions
- packets are available through the main surfaces
- watch mode exists for packet refresh
- hooks/CI wrappers are optional and non-blocking
- packet guidance materially affects the normal answer/composer loop
- broader precedent research has an explicit, source-labeled process

The main surface layer is now present:

- tool generation
- direct API generation
- CLI packet command
- web tool-call rendering
- watch metadata with stable packet id, refresh reason, and refresh triggers

Prompts/resources are still intentional future consumption targets, not separate
registrations yet.

The shipped `5.5` landing is:

- one packet appears in a main workflow users already use
- wrappers remain optional and can be added on the existing packet seam later
- no new scheduler dependency

The `5.6` target completion state is stronger:

- packet recommendations influence more than one narrow answer flow
- workflow state and “what next” guidance appear in the normal tool loop, not
  only in separate packet calls
- reference-backed precedent research is available as an explicit secondary
  process with clear source separation
- the roadmap has at least one real usefulness evaluation beyond packet-shape
  smokes

At that point, Roadmap 6 can build deterministic power workflows on top of
packet products that already matter in the default experience, and Roadmap 7
can later generate broader workflow artifacts on top of those workflows.

Current `5.6.1` landing:

- one shared attachment-policy seam decides whether a companion packet should
  attach
- `ask` inherits the same decision automatically instead of owning separate
  packet logic
- CLI and web show *why* a packet attached through `attachmentReason`
- current promoted default-path flows are:
  - `route_trace`
  - `file_health`
  - `trace_file`
  - `trace_table`
  - `trace_rpc`

Keep the promotion bar here: only auto-attach when real runs show the packet is
strong enough to help by default. Do not broaden the set just because a query
kind sounds workflow-shaped.

Current `5.6.2` landing:

- `WorkflowPacketSurface` now includes a compact handoff summary:
  - `current`
  - `stopWhen`
  - optional `refreshWhen`
- `verification_plan` and `workflow_recipe` compute that handoff in the shared
  surface layer, not in CLI/web
- `implementation_brief`, `impact_packet`, and `precedent_pack` intentionally
  do not emit a handoff
- the normal answer path uses that compact handoff as the primary companion
  rendering
- dedicated workflow-packet views keep the full packet available, but show the
  compact handoff first

Current `5.6.3` landing:

- workflow context can now carry explicit `reference_precedent` items with
  `source: "reference_repo"`
- `precedent_pack` now treats external precedents as advisory secondary context
  and preserves strong local precedents as canonical when they exist
- external reference precedents are visible in packet rendering through
  `via reference repo: <repo>` labels
- real packet smokes now pin the local-vs-reference precedence rule
- runtime reference usage is still caller-supplied; mako does not yet make live
  `codexref` calls in the default product path

Current `5.6.4` landing:

- the shared workflow packet layer now has a usefulness evaluator with grades:
  - `full`
  - `partial`
  - `no`
- the usefulness evaluator still uses packet-quality signals, but it now also
  recognizes actual packet-guided follow-up executions when mako observes them
- observed follow-up is now treated as a stronger usefulness signal than packet
  shape alone, and promotion can optionally require an actual-followup rate
  once enough observations exist
- the trust-eval runner now records companion packet family, handoff presence,
  usefulness grade, and usefulness reason codes in each case result
- trust-eval run summaries now include promotion metrics:
  - eligible packet count
  - attached packet count
  - packet-helped-next-step rate
  - actual-followup count / rate
  - no-noise rate
- real ForgeBench trust-eval runs now include workflow-usefulness coverage, not
  only packet-shape and trust-state checks

Current `5.6.5` landing:

- a companion packet handoff now becomes the first `candidateAction` in the
  shared answer-enrichment layer when a real handoff exists
- the workflow-derived action is additive; original tool/composer actions remain
  in the result after it
- CLI and web now render candidate actions in the default answer path, so the
  packet guidance changes the visible next step instead of living only inside
  packet views

Current `5.6.6` landing:

- the workflow-guided first `candidateAction` now carries optional execution
  metadata instead of being prose-only
- the current execution target is the existing `workflow_packet` tool with
  concrete input derived from the answer/query that produced the companion
  packet
- execution input now carries canonical `queryText` plus structured
  `queryArgs` where exact replay needs more than one raw string
- eval actual values now capture the first candidate action's execution target,
  so future workflow-usefulness assertions can reason about routable next-step
  guidance without scraping UI text
- executing that guided `workflow_packet` action now records an append-only
  `workflow_followups` fact row keyed by the originating answer/action, so the
  workflow layer can distinguish “suggested next step” from “taken next step”
- actual-followup rate is now available as a human-tuned promotion input, but
  Roadmap 5 stops at exposing and evaluating that signal
- do not add autonomous attachment rollout in this roadmap; Roadmap 8 owns
  telemetry-driven promotion once rollback and history-based safeguards exist
