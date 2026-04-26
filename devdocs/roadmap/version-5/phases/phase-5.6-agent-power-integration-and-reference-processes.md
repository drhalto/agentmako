# Phase 5.6 Agent-Power Integration And Reference-Grounded Processes

Status: `Complete`

## Why This Phase Exists

`5.0` through `5.5` shipped real packet infrastructure:

- typed workflow context
- packet families
- packet surfaces
- one real default-path consumer

That work was real, but the product review was also right:

- packets still live too much in a separate lane
- the main tool path still does too much “answer first, workflow second”
- broader precedent research is still mostly a manual operator behavior rather
  than an explicit product process

`5.6` exists to make the shipped workflow layer materially strengthen the normal
agent/tool loop before Roadmap 7 starts generating broader workflow artifacts.

## Current Product Reality

Today `mako-ai` is already strong at:

- local-first repo and schema intelligence
- deterministic named tools
- investigation composers
- a thin `ask` router over those named tools
- trust, compare, diagnostics, and ranking on answer-backed flows
- explicit workflow packets through the packet seam

The normal product path still centers on:

- `ask`
- named answer tools such as `file_health`
- composer tools such as `trace_file`
- additive enrichment through the shared answer-enrichment seam

That means `5.6` should not invent a parallel planner or a new packet stack.
It should make the existing path more workflow-aware and more research-aware.

## Phase Outcome

By the end of `5.6`, Roadmap 5 should no longer end at “packets exist and can
be rendered.”

It should end with:

- packet recommendation and attachment policy in the normal tool path
- workflow state that is visible and actionable in the main loop
- a deliberate, source-labeled precedent research process
- usefulness evaluation that measures workflow value, not only packet shape

## Core Rules

1. Local project evidence remains primary.
2. External reference-repo research is secondary and must stay source-labeled.
3. `ask`, answer tools, and composers stay the main product path.
4. `5.6` may deepen integration, but it does not add a new workflow engine.
5. Roadmap 7 still owns generated artifacts and broader workflow integrations.

## Subphases

### 5.6.1 Packet Recommendation And Default-Path Expansion

**Goal:** make workflow packets show up where the normal tool path already has
high signal, instead of requiring a separate packet request.

Primary seams to use:

- [packages/tools/src/ask/index.ts](../../../../packages/tools/src/ask/index.ts)
- [packages/tools/src/trust/enrich-answer-result.ts](../../../../packages/tools/src/trust/enrich-answer-result.ts)
- [packages/tools/src/service.ts](../../../../packages/tools/src/service.ts)

Rules:

- expand from one-off companion attachment to an intentional policy
- keep attachment additive
- keep packet-family choice deterministic and explainable
- do not attach multiple packets just because they exist

Recommended first expansion order:

1. `ask` should inherit the same companion-packet policy when it selects a
   high-signal named tool or composer.
2. A small number of additional high-signal flows should gain packet
   recommendation:
   - `trace_table`
   - `trace_rpc`
   - selected `route_trace` cases
3. Surface why a packet was attached, not just the packet content itself.

First shipped slice:

- companion attachment now runs through one shared policy function instead of a
  hardcoded query-kind check in enrichment
- `ask` inherits the same policy automatically because the decision stays in the
  shared answer-enrichment seam
- `attachmentReason` now appears on the companion surface and renders in CLI/web
- companion surfaces now also carry a structured `attachmentDecision`
  (`family` + trigger fields) so usefulness evaluation and future promotion
  analysis do not need to regex the prose reason string
- the current promoted default-path set is:
  - `route_trace`
  - `file_health`
  - `trace_file`
  - `trace_table`
  - `trace_rpc`
- `auth_path` is intentionally **not** auto-attached yet; real-repo runs did
  not prove that it was a strong enough default fit to promote blindly. The
  current executable guard for that policy lives in
  [test/smoke/ask-router-goldens.ts](../../../../test/smoke/ask-router-goldens.ts).

Success criteria:

- more than one normal answer/composer flow attaches the right packet
- attachment policy is readable in code and testable
- packet display remains compact in CLI/web/API

Implementation anchors:

- Current companion attachment lives at
  [packages/tools/src/trust/enrich-answer-result.ts](../../../../packages/tools/src/trust/enrich-answer-result.ts)
  as a hardcoded `Set<QueryKind>` check (`COMPANION_PACKET_QUERY_KINDS`).
  Generalize to a pure policy function
  `(queryKind, trustState, evidenceStatus) → packetFamily | null` so new
  query kinds opt in by adding a row, not by editing enrichment code.
- Record policy inputs + decision in the audit log so attachment is
  debuggable end-to-end.
- Expose `attachmentReason: string` on the companion surface metadata,
  borrowing Continue's per-tool vocabulary pattern
  (`core/tools/definitions/globSearchTool.ts` uses `displayTitle`,
  `wouldLikeTo`, `isCurrently`, `hasAlready`). Example:
  `"attached verification_plan because queryKind=trace_file produced
  high-confidence native evidence"`. Satisfies the "surface why a packet
  was attached" success criterion without leaking policy internals.
- Non-proliferation rule: at most one companion packet per answer in
  `5.6.1` scope. Multi-companion attachment is a later subphase.

### 5.6.2 Workflow State And Execution Handoff In The Main Loop

**Goal:** make workflow state influence what happens next in the normal loop,
not only exist inside a packet payload.

Reference pattern:

- OpenHands task discipline:
  - `todo`
  - `in_progress`
  - `done`
  - one active step
  - do not mark `done` while verification is still failing

Primary seams to use:

- workflow packet generators and formatter
- current answer rendering paths in CLI/web
- existing answer/trust enrichment path

Rules:

- expose a compact “current step / next verification / stop when” handoff in
  the normal result path
- do not build a second planner
- do not add mutable session task state unless a real consumer needs it
- keep step ids and active-step semantics stable

Current shipped slice:

- `WorkflowPacketSurface` now carries a compact `handoff` object:
  - `current`
  - `stopWhen`
  - optional `refreshWhen`
- `verification_plan` and `workflow_recipe` surfaces derive that handoff once in
  the shared surface layer instead of asking CLI/web to reconstruct it
- `implementation_brief`, `impact_packet`, and `precedent_pack` intentionally do
  **not** emit a handoff because they are guidance/context packets rather than
  step-state packets
- the normal answer path now prefers the compact handoff over dumping the full
  packet when a companion packet is attached
- dedicated packet views still render the full packet, but now also show the
  compact handoff first

Success criteria:

- a user or external agent can see the current workflow step and stop
  condition without opening a separate packet view
- workflow state stays aligned with packet rules instead of diverging into
  client-local heuristics

Implementation anchors:

- Mako's `WorkflowRecipeStepStatus` (`todo | in_progress | done`) matches
  OpenHands exactly — same names, same semantics
  (`openhands/agenthub/codeact_agent/tools/task_tracker.py:115-119`,
  `frontend/src/types/v1/core/base/common.ts:1-14`). Codex uses a
  different vocabulary: `pending | in_progress | completed`
  (`codex-rs/tools/src/plan_tool.rs:11`). External MCP consumers that
  bridge mako packets into Codex's `update_plan` tool need a translation
  layer at the boundary — document the mapping before the first bridge
  lands so it is not re-derived.
- Render the default-path handoff following Codex's brevity rule
  (`codex-rs/core/gpt_5_2_prompt.md:40-55` — "do not repeat the full
  contents of the plan; summarize the change"). Emit a single compact
  line in the normal answer surface:

  ```
  CURRENT: <active step title> | STOP WHEN: <first stop condition>
  ```

  Consumers that want the full recipe pull it through the existing
  `workflow_packet` tool. This satisfies the "do not build a second
  planner" rule while still giving users actionable state.
- Upgrade OpenHands completion criteria
  (`openhands/agenthub/codeact_agent/tools/task_tracker.py:128-134`) from
  doc guidance to testable smoke assertions when step transitions become
  observable in the main loop:

  - never mark `done` while verification is still failing
  - never mark `done` while implementation is incomplete
  - never mark `done` while unresolved errors persist
  - never mark `done` while required resources are unavailable

  The existing integrity check at
  [packages/tools/src/workflow-packets/index.ts](../../../../packages/tools/src/workflow-packets/index.ts)
  already enforces "exactly one `in_progress` step." The four rules above
  are the missing companions.
- Do NOT attach a recipe-step handoff for queries that resolve in one
  hop, mirroring OpenHands counter-examples
  (`task_tracker.py:87-106` — "simple informational inquiries" and
  "minor modifications"). The attachment-policy function from `5.6.1`
  is the right gate; handoff rendering should be conditional on a
  recipe actually being attached.

### 5.6.3 Reference-Grounded Precedent And Research Process

**Goal:** define how broader reference-repo research should improve precedent
and implementation guidance without weakening local trust semantics.

Reference pattern:

- `codexref` hybrid repo search:
  - `ref_ask` for broad pattern mining
  - `ref_search` for exact identifier or API confirmation
  - `ref_file` for final grounding before reuse

Process rules:

1. Search the local project first.
2. Use reference-repo research only when:
   - the local repo lacks a strong precedent
   - the user explicitly wants a broader pattern
   - a workflow packet is otherwise too weak to be useful
3. Keep reference findings separate from local evidence:
   - separate context item kind or source marker
   - separate citation rationale
   - no local trust-state inference from external reference hits
4. Never let search snippets stand in for grounded file reads.

Likely product fits:

- stronger `precedent_pack`
- stronger `implementation_brief`
- explicit “external reference precedent” sections when configured

Success criteria:

- external precedent can appear in packets without looking like local project
  truth
- the reference process is explicit and repeatable
- the feature still degrades cleanly when no external reference inputs are
  provided

Current shipped slice:

- `WorkflowContextItem` now supports:
  - `kind: "reference_precedent"`
  - `source: "reference_repo"`
- packet requests can carry caller-supplied reference precedents without
  reopening raw answer parsing
- `precedent_pack` now keeps strong local precedents canonical and uses
  external precedents only when local context is weak or missing
- external precedent rendering is explicitly source-labeled with
  `via reference repo: <repo>`
- runtime packet generation still remains local-first: mako accepts
  caller-supplied reference precedents but does not yet make live `codexref`
  calls inside the normal product path
- the packet generator smoke now proves:
  - reference precedents survive `scope: "primary"` selection
  - strong local precedents still outrank external ones
  - local trust/comparison context stays bit-identical with and without
    reference precedents
  - sparse local context can fall back to an external precedent cleanly

Implementation anchors:

- Extend `WorkflowContextItemSource` (currently `answer_result | evidence
  | trust | diagnostic | comparison` in
  [packages/contracts/src/workflow-context.ts](../../../../packages/contracts/src/workflow-context.ts))
  with a new value `reference_repo`. Mirrors Cody's
  `ContextItemSource.Unified`
  (`lib/shared/src/codebase-context/messages.ts:96-131`) for remote
  search results, keeping local vs external provenance at the source
  level instead of buried in payload.
- Add a new `WorkflowContextItemKind` `reference_precedent` with payload
  fields mirroring codexref's native output shape
  (`src/codexref/mcp_server.py:52-110`):

  ```ts
  {
    kind: "reference_precedent",
    source: "reference_repo",
    data: {
      repoName: string,
      path: string,
      startLine: number,
      endLine: number,
      excerpt: string,
      searchKind: "ref_ask" | "ref_search" | "ref_file",
      score?: number,
      vecRank?: number | null,
      ftsRank?: number | null,
    }
  }
  ```

  `searchKind` is load-bearing: it records HOW the reference was obtained
  (semantic match vs identifier confirmed vs grounded file read) so
  downstream consumers can reason about confidence without re-running
  the query.
- Renderer provenance labels borrowed from Cody
  (`vscode/webviews/components/FileLink.tsx:40-52`): every external ref
  renders with `"via reference repo: ${repoName}"` so provenance is
  visible without opening the raw packet. Parallels Cody's
  `unified: 'via remote repository search'` / `search: 'via local
  repository index (symf)'` label model.
- Elevate the three-tier research cadence from background pattern to
  enforceable rule:

  1. `ref_ask` for broad semantic + FTS pattern mining.
  2. `ref_search` for exact identifier or API shape confirmation before
     citing.
  3. `ref_file` for the final grounded read — `ref_ask` snippets never
     stand alone as grounded evidence.

  Mirrors mako's existing `AnswerPacket` evidence discipline (snippets
  → confirmed refs → grounded file reads) applied to external repos.
- Trust boundary as a testable invariant. `5.6.3` already states "no
  local trust-state inference from external reference hits." Back it
  with a smoke: generate a packet with and without a reference-repo hit
  on identical local evidence and assert `AnswerTrustState`,
  `trustRun.basisTraceIds`, and `comparisonSummary` are bit-identical.
  External refs may appear in
  `precedent_pack.payload.canonicalPrecedentItemIds` /
  `secondaryPrecedentItemIds` but must never touch the `trust` field.
- Runtime `codexref` integration is intentionally deferred. The current
  `5.6.3` contract accepts caller-supplied reference precedents and must degrade
  cleanly to local-only packets when that input is absent. A future wrapper may
  probe `ref_list` and populate those reference items explicitly, but Roadmap 5
  does not make the core runtime depend on that MCP surface.

### 5.6.4 Workflow Usefulness Evaluation And Promotion Rules

**Goal:** stop judging the workflow layer mainly by shape and smoke coverage.

This subphase should add usefulness checks such as:

- did the packet change what the next step was?
- did verification guidance reduce missed checks?
- did precedent guidance increase reuse instead of fresh invention?
- did packet attachment stay low-noise?
- did reference-backed research actually improve the result?

Recommended evaluation targets:

- real ForgeBench-style packet scenarios
- selected seeded-defect flows
- at least one packet + research process evaluation

Promotion rule:

- do not broaden packet attachment or external research usage unless the
  narrower version proved helpful and low-noise first

Current shipped slice:

- workflow packet usefulness is now graded in the shared packet layer as:
  - `full`
  - `partial`
  - `no`
- the shared eval runner now records:
  - companion packet family
  - companion handoff fields
  - usefulness grade
  - usefulness reason codes
- run summaries now include promotion metrics:
  - eligible packet count
  - attached packet count
  - packet-helped-next-step rate
  - actual-followup count / rate
  - no-noise rate
- the local eval harness now asserts usefulness behavior directly
- the real ForgeBench trust-eval runner now includes a workflow-usefulness suite
- usefulness still includes packet-quality and actionability signals, but mako
  now records real packet-guided follow-up executions through an append-only
  `workflow_followups` fact table when the suggested action is actually run
- recorded follow-up execution is folded back into usefulness evaluation as the
  strongest signal currently available (`followup_action_taken`)
- promotion can now optionally require an actual-followup rate threshold, but
  null followup-rate stays non-blocking so early rollout is not gated on data
  mako has not observed yet
- actual-followup thresholds are operator-facing knobs in `5.6`, not an
  autonomous policy loop; humans tune them, telemetry informs them

### 5.6.5 Handoff-Driven Next Actions

**Goal:** make the packet handoff affect the existing next-step loop instead of
living only in packet rendering.

Primary seams to use:

- [packages/tools/src/trust/enrich-answer-result.ts](../../../../packages/tools/src/trust/enrich-answer-result.ts)
- [apps/cli/src/commands/tools.ts](../../../../apps/cli/src/commands/tools.ts)
- [apps/web/src/components/AnswerPacketCard.tsx](../../../../apps/web/src/components/AnswerPacketCard.tsx)

Rules:

- reuse the existing `candidateActions` surface instead of inventing a second
  “recommended next step” contract
- only synthesize a workflow action when a companion packet exposes a real
  handoff
- prepend the workflow action; do not erase the tool's original actions
- keep the workflow action compact and explicitly tied to
  `current / stopWhen / refreshWhen`

Current shipped slice:

- answers with a companion packet handoff now synthesize a first
  `CandidateAction` from that handoff in the shared enrichment layer
- the workflow-derived action is prepended ahead of the tool's existing actions,
  so the normal loop sees the packet guidance first without losing native tool
  suggestions
- CLI and web now render candidate actions in the normal answer path, so the
  packet guidance is visible without opening the packet view
- focused answer/composer smokes now pin that the first action for promoted
  flows comes from the companion handoff

Success criteria:

- a default-path answer with an attached `verification_plan` changes the first
  visible next action
- existing candidate actions remain available after the workflow action is added
- no new planner/session state is introduced

### 5.6.6 Execution-Ready Workflow Actions

**Goal:** make the handoff-driven next action point to a real tool invocation
instead of existing only as display text.

Primary seams to use:

- [packages/contracts/src/answer.ts](../../../../packages/contracts/src/answer.ts)
- [packages/tools/src/trust/enrich-answer-result.ts](../../../../packages/tools/src/trust/enrich-answer-result.ts)
- [packages/tools/src/evals/runner.ts](../../../../packages/tools/src/evals/runner.ts)

Rules:

- extend the existing `CandidateAction` contract instead of adding a second
  executable-action surface
- only attach execution metadata when the suggested next step is actually
  routable through an existing tool
- prefer the existing `workflow_packet` tool as the execution target for
  workflow-guided actions
- keep native tool actions intact; this slice only upgrades the workflow action

Current shipped slice:

- `CandidateAction` now supports optional execution metadata:
  - `toolName`
  - `input`
- the synthesized workflow-guided first action now points at the real
  `workflow_packet` tool with concrete packet input derived from the current
  answer
- execution input now carries:
  - canonical `queryText` for display / packet identity
  - structured `queryArgs` when the originating flow needs exact replay
    (`trace_file`, `trace_table`, `trace_rpc`, `file_health`)
- CLI and web now surface that the action executes `workflow_packet`
- eval actual values now capture the first candidate action label and execution
  target so future workflow-eval assertions do not need to parse prose

Success criteria:

- the first workflow-guided action is not only visible, but structurally
  executable through the existing tool layer
- focused answer/composer smokes prove the execution target matches the
  attached companion packet family and originating query
- no new executor or planner command is introduced just to make this work

Implementation anchors:

- Borrow SWE-bench's resolution trichotomy
  (`swebench/harness/grading.py:184-234`) as the packet-usefulness
  grading shape instead of a binary helped/didn't flag:

  - **FULL** — packet guidance was followed and the next action
    succeeded on the verification criteria named in the packet.
  - **PARTIAL** — packet guidance was partially followed, or the outcome
    succeeded with a scope change relative to the packet's primary
    target.
  - **NO** — packet was ignored, misleading, or the next action
    contradicted it.

- Define two metrics analogous to SWE-bench's fail-to-pass and
  pass-to-pass measures:

  - **Fail-to-pass analog** (`packet-helped-next-step` rate): of cases
    where a packet was attached, fraction where the next action aligned
    with the packet's primary verification or stop condition. Headline
    "packet helped" metric. In the current shipped slice this still blends
    packet quality with workflow guidance, but it is no longer blind to actual
    follow-up: observed packet-guided execution is recorded and counted
    separately through the shared `workflow_followups` fact table.
  - **Pass-to-pass analog** (`no-noise` rate): of cases where a packet
    was attached, fraction where the packet did NOT introduce rework or
    mislead vs the baseline no-packet answer. Guards against "packets
    degrade clean answers."

- Make the promotion threshold explicit instead of opinion-based:
  broaden attachment or external research only when F2P-analog ≥
  baseline + δ AND P2P-analog ≥ 1 − ε over at least N fixtures. Document
  concrete δ / ε / N once the eval harness lands; leave as placeholders
  until then. The shipped follow-up-aware policy now supports a third,
  optional `actual-followup` threshold and treats null followup-rate as
  non-blocking until real follow-up observations exist.
- Reuse the existing eval substrate at
  [packages/tools/src/evals/runner.ts](../../../../packages/tools/src/evals/runner.ts)
  and ForgeBench fixtures — do not invent a parallel eval loop.

## Non-Goals

- no scheduler or daemon dependency
- no generated docs/handoff artifacts beyond packet rendering
- no broad autonomous workflow execution engine
- no autonomous attachment rollout or silent policy expansion from telemetry
- no rewriting Roadmap 4 trust semantics
- no hand-wavy “AI planning” layer with weak grounding

## Verification

- policy-level tests for packet attachment expansion
- rendering checks for current-step / stop-condition handoff in normal answer
  surfaces
- focused coverage for source-labeled external precedent flows
- at least one usefulness-oriented evaluation beyond schema/smoke checks
- focused smokes proving that executing a packet-guided action writes a durable
  follow-up record keyed by the originating answer/action
- doc sync whenever `5.6` materially changes the Roadmap 5 closeout story

## Exit State

Roadmap 5 is truly complete when:

- packets are not only generated, but matter in the default experience
- workflow state influences the normal answer/composer loop in a compact,
  understandable way
- broader precedent research has a deliberate, source-labeled process
- Roadmap 6 can start from workflow products that already affect real work,
  rather than from packet infrastructure that still feels optional
- telemetry now informs operators about usefulness and actual follow-up, but
  automatic rollout changes remain deferred to Roadmap 8
