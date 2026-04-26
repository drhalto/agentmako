# Phase 4.7 Workflow Context Bridge

Status: `Complete`

This file is the canonical plan for the explicit `4.7` sidecar requested after
Roadmap 4 closed.

It is **not** part of the original canonical Roadmap 4 trust sequence.
Roadmap 4 remains complete. Roadmap 5 remains the next canonical roadmap.

`4.7` exists because the trust-aware answer surface shipped in Roadmap 4 is
good enough to build on, but still too blob-shaped to be the clean long-term
input for typed workflow packets.

The correct move is not “start Roadmap 5 and let each packet generator parse
`AnswerResult` its own way.” The correct move is to add one narrow bridge seam
so Roadmap 5 starts from packet-friendly contracts instead of ad hoc extraction.

## Why This Exists

Roadmap 4 intentionally made the answer layer trustworthy:

- `AnswerPacket`
- `AnswerResult`
- trust state
- comparison summaries
- diagnostics
- ranking / de-emphasis

That gives Roadmap 5 strong raw material.

What it does **not** yet give Roadmap 5 is a compact typed transport for:

- “these are the context items attached to this answer”
- “these are the primary files / routes / RPCs / tables involved”
- “these are the trust and diagnostic artifacts worth carrying into a workflow
  packet”

If we skip that bridge, every future packet generator will have to:

- walk raw `AnswerResult`
- peel apart trust/diagnostic/comparison fields by hand
- invent its own citation/attachment model

That is the wrong layer to duplicate logic.

This sidecar should therefore do one thing well:

- turn the shipped answer/trust/diagnostic surface into a reusable typed
  context layer that later packet generators can consume directly

It should not try to deliver the full Roadmap 5 packet catalog by itself.

## Verified Repo Constraints

The current repo shape already gives us most of what we need:

1. The shared answer contract is real and stable.
   - `packages/contracts/src/answer.ts`
   - `packages/contracts/src/tools.ts`

2. Trust, diagnostics, and ranking already flow additively through
   `AnswerResult`.
   - `packages/tools/src/trust/enrich-answer-result.ts`

3. Comparison and trust reads are already explicit.
   - `packages/tools/src/trust/read-trust-state.ts`
   - `packages/tools/src/trust/rerun-and-compare.ts`

4. The eval runner already knows how to normalize answer surfaces into a
   compact machine-facing summary.
   - `packages/tools/src/evals/runner.ts`

So the missing piece is not data. The missing piece is a reusable,
packet-friendly context seam.

## Reference Patterns To Reuse

The expanded indexed codebase research gives us the right patterns:

- **Cody typed context items**
  - discriminated-union context transport instead of loose blobs
  - good model for file/symbol/repository/selection-style attachments
- **SWE-agent workflow loops**
  - explicit analyze -> reproduce/verify -> edit -> re-verify -> edge-case loop
  - useful downstream for workflow packet design
- **Continue planning boundary**
  - exploration / analysis / planning / verification / execution
  - confirms that packet generation should prepare work, not collapse into a
    hidden automation engine
- **Codex plan template**
  - compact plan structure: title, summary, key changes, test/verification,
    assumptions
  - useful as the default shape for packet families like implementation briefs
- **OpenCode spec structure**
  - rationale, acceptance criteria, verification, regression checks, done
  - useful as the richer structure for verification-oriented packets
- **OpenClaw compact digest envelopes**
  - grouped, typed summaries instead of one giant prose blob
  - useful for contradiction/open-question/issue sections inside later packets

`4.7` should borrow the transport and boundary ideas now so Roadmap 5 starts
cleanly.

## Derived Design Rules

Based on those references, `4.7` should lock in these rules for Roadmap 5:

1. **Context is a discriminated union, not a loose JSON blob.**
   - follow the Cody-style typed item model
   - packet generators should consume `kind`ed items, not parse arbitrary
     nested answer objects

2. **Workflow guidance must carry explicit verify/loop/stop semantics.**
   - follow the SWE-agent-style repair/verify/edge-case loop
   - later workflow packets should not just say “next steps”; they should say
     how to know a step is done and when to continue or stop

3. **Automation is layered, not assumed.**
   - follow the Continue-style boundary:
     - on-demand generation first
     - watch-mode workflows second
     - optional hooks / CI wrappers later

4. **Packet structure should stay compact and decision-oriented by default.**
   - prefer Codex/OpenCode-style summary + key changes + verification +
     assumptions over sprawling taxonomies

5. **Packet generators cite typed context items, not prose summaries.**
   - citations should come from the bridge layer
   - later roadmap work should not need to scrape text out of `answer` or
     infer references from markdown

## Correctness Rule

`4.7` should **not**:

- reopen trust storage or migrations
- rewrite trust-state classification
- invent a workflow engine
- add a scheduler, daemon, or required background worker
- create packet-specific extraction logic in multiple places

`4.7` **should**:

- define one typed workflow-context contract in shared contracts
- define one shared answer-to-context extraction seam
- normalize the references Roadmap 5 packets will need
- leave Roadmap 5 packet generators with less parsing and less guesswork

## Planned Outcome

By the end of `4.7`, the repo should have:

- a typed `WorkflowContextItem` contract in shared contracts
- one extraction path that derives workflow-context items from the shipped
  answer/trust/diagnostic surface
- stable attachment/reference shapes for files, symbols, routes, RPCs, tables,
  diagnostics, trust evaluations, and comparisons
- a documented rule that Roadmap 5 packets consume these context items instead
  of reverse-engineering `AnswerResult` ad hoc

It should also leave Roadmap 5 with a clear packet-consumption contract for the
first expected packet families:

- `implementation_brief`
- `impact_packet`
- `precedent_pack`
- `verification_plan`
- `workflow_recipe`

`4.7` does not need to implement those packet generators. It does need to make
their inputs obvious and shared.

## Shipped Initial Slice

The first implementation slice is now in the repo:

- shared workflow-context contracts in
  `packages/contracts/src/workflow-context.ts`
- shared schemas in `packages/contracts/src/tools.ts`
- one shared extraction seam in `packages/tools/src/workflow-context/index.ts`
- package exports from `packages/contracts/src/index.ts` and
  `packages/tools/src/index.ts`
- focused smoke coverage in `test/smoke/workflow-context-bridge.ts`
- shared packet-entry contract:
  - `WorkflowPacketRequest`
  - `WorkflowPacketInput`
- shared packet-input builder in
  `packages/tools/src/workflow-context/index.ts`

The shipped bridge currently provides:

- typed context items for:
  - `answer_packet`
  - `file`
  - `symbol`
  - `route`
  - `rpc`
  - `table`
  - `diagnostic`
  - `trust_evaluation`
  - `comparison`
- a `WorkflowContextBundle` with:
  - stable `items`
  - `primaryItemIds`
  - `supportingItemIds`
  - `openQuestions`
- a minimal Roadmap 5 entry seam with:
  - packet family
  - scope
  - optional focus by item id or item kind
  - watch intent
- normalized extraction from the existing trust-aware `AnswerResult` surface
  without parsing answer markdown
- normalized route and symbol identities across equivalent evidence shapes

That means `4.7a` through `4.7d` are now shipped as the intended bridge run.

## Phase Breakdown

### 4.7a Workflow Context Contracts

Add a discriminated-union contract in shared contracts.

Initial kinds should stay narrow and useful:

- `answer_packet`
- `file`
- `symbol`
- `route`
- `rpc`
- `table`
- `diagnostic`
- `trust_evaluation`
- `comparison`

This should be enough for Roadmap 5 packet families without pretending we need
a universal ontology on day one.

Each item should carry a compact common envelope, for example:

- stable `kind`
- stable `id`
- compact `title` or `label`
- optional `summary`
- source/provenance metadata where relevant
- attachment/reference payload specific to the item kind

The bridge should prefer stable references and explicit source metadata over
trying to be exhaustively descriptive.

### 4.7b Answer-To-Context Extraction

Add one shared extraction seam that converts a shipped `AnswerResult` into a
packet-friendly context bundle.

The extractor should be able to surface:

- primary file references
- evidence file/source refs
- trust summary
- comparison summary
- diagnostics
- ranking reasons where relevant

It should prefer the existing typed answer/trust/diagnostic outputs, not parse
human prose.

The extractor should also expose a small notion of packet intent:

- primary context items
- supporting context items
- open questions / missing information

That keeps later packet generators from having to rediscover “what matters
most” from raw arrays every time.

### 4.7c Reference Normalization

Normalize the references Roadmap 5 will cite repeatedly:

- identity kinds
- file paths
- reason codes
- evidence refs
- comparison ids / trust ids where relevant

The goal is not new semantics. The goal is packet-friendly stability.

One concrete rule to lock now:

- if two answer paths point to the same underlying file / route / RPC / table,
  they should normalize to the same bridge identity shape before Roadmap 5
  starts building packet citations on top

Shipped baseline:

- file paths are normalized to `/`
- schema / rpc synthetic refs no longer misclassify as file refs
- route-shaped source refs (`"METHOD /path"`) never fall back into the file
  item path — the `sourceRef`-to-file fallback is gated to `kind === "file"`
  evidence only, so a route block without an explicit `filePath` now produces
  a route item and nothing else
- trust / comparison / diagnostic items already carry stable bridge ids
- equivalent route evidence now normalizes to one route identity via method +
  pattern instead of raw `sourceRef`
- equivalent symbol evidence now normalizes through exported symbol identity when
  available instead of title-only parsing
- when two evidences collapse to the same bridge identity, the merge step now
  fills unset fields from the later-seen evidence (e.g. a bare route followed
  by a richer route with a parsed `handlerName`) instead of silently dropping
  the complementary data

### 4.7d Roadmap 5 Entry Contract

Document the rule that Roadmap 5 packet generators consume:

- `WorkflowContextItem[]`
- plus a small packet-specific request shape

and do **not** each invent their own `AnswerResult` parser.

That packet-specific request shape should be allowed to ask for:

- a packet family
- optional target emphasis or scope
- optional watch/refresh behavior

but should not reopen trust, compare, or diagnostic parsing rules.

The bridge smoke now proves that one implementation-brief-like consumer input
and one verification-plan-like consumer input can be built from the bundle
without touching raw `AnswerResult` again, and the packet-entry contract is now
explicit in shared contracts instead of deferred prose only.

## Verification

`4.7` should verify the bridge itself before Roadmap 5 builds on it:

1. schema coverage
   - the shared contract can represent the initial item kinds cleanly
2. extraction coverage
   - a trust-enriched `AnswerResult` can be converted into context items without
     relying on markdown parsing
3. identity stability
   - repeated extraction of the same answer surface yields stable item
     identities for files, diagnostics, trust evaluations, and comparisons
4. packet-consumer fit
   - a small spike or smoke can prove the bridge is sufficient to draft one
     implementation-brief-like packet and one verification-plan-like packet
     without bespoke answer parsing

Shipped verification:

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/workflow-context-bridge.ts`
- `node --import tsx test/smoke/api-answer-question.ts`
- `node --import tsx test/smoke/trust-state.ts`

The bridge smoke now additionally asserts:

- a route evidence block with no `filePath` never produces a `file:` item whose
  path is the route string (no more `file:DELETE /api/events/[id]/...` leaks
  into the bundle)
- equivalent route evidences that collide on the same method + pattern identity
  merge complementary fields — the final route item carries the parsed
  `handlerName` from whichever evidence supplied it, not only the first-seen
  copy

## Intentional Non-Goals

`4.7` should not:

- finalize the full Roadmap 5 packet taxonomy
- implement watch-mode orchestration
- implement hook / CI automation
- generate final user-facing workflow documents
- replace `AnswerResult` as the runtime answer surface

It is a bridge, not a new top-level product layer.

## Immediate Acceptance Criteria

`4.7` should only be considered correctly started when:

- the repo has an explicit workflow-context bridge plan recorded
- the sidecar is clearly separated from the canonical trust roadmap
- the bridge is scoped as contracts + extraction, not as a workflow engine
- the dependency on Roadmap 4 shipped signals is explicit

## First Implementation Slice

The first implementation slice should be:

1. define `WorkflowContextItem` in shared contracts
2. add one shared `AnswerResult -> WorkflowContextItem[]` extraction seam
3. add a small smoke or spike proving one workflow packet can consume the seam
4. update docs so Roadmap 5 starts from that seam

That order is important.

If we skip it, Roadmap 5 packet generators will immediately duplicate parsing
logic and create incompatible attachment shapes.

That bridge run is now landed. The next clean continuation is Roadmap 5 packet
generation on top of this seam instead of any new raw-answer parsing layer.
