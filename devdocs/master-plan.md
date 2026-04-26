# Master Plan

This file is the master guide for the long-term development of `mako-ai`.

It is intentionally high-level.

Its job is to define:

- the end-state product we are trying to build
- the major roadmap arcs between here and there
- why those roadmaps should happen in that order
- what each roadmap is supposed to accomplish
- how the documentation should evolve when the project changes

This file is not a phase plan.

This file is not the place for implementation-level task lists.

Use this file as the backbone.
Use roadmap docs to define one concrete build cycle.
Use phase docs to define one concrete implementation slice inside a roadmap.

## How To Read This

Planning stack:

- `Master Plan` = long-term project guide across multiple roadmaps
- `Roadmap` = one bounded development arc with its own goals and phases
- `Phase` = one implementation slice inside a roadmap

The initial shipped rebuild was `Roadmap 1`.

This document describes what comes after that and how to think about the project from here forward.

## Flexibility Rule

This plan is directional, not rigid.

The order here is the best current structure based on:

- what `mako-ai` already ships
- what Fenrir proved was valuable
- what Fenrir got wrong
- what has to exist before later systems are trustworthy

If a better pattern emerges, or a major change in direction is justified, we do not pretend the old roadmap still fits.

Instead:

- create a new roadmap branch in the docs
- preserve the previous roadmap/history
- document the reason for the branch clearly
- continue using clean versioned documentation rather than mutating old planning history until it becomes misleading

Recommended doc pattern:

- roadmap branches live under clear versioned folders
- significant changes use an `x.x.x` documentation version pattern where helpful
- old roadmaps remain readable as historical planning records
- new work should not silently rewrite what older roadmap docs meant

This is not meant to be bureaucratic.

It is meant to keep the project legible as it grows.

## What `mako-ai` Is Ultimately Trying To Become

`mako-ai` should become a global local-first intelligence layer for coding agents and engineers.

The finished system should be able to:

- run as one local `mako` service
- connect to one or more real project roots
- understand each project's repo, schema, routes, symbols, imports, edge functions, and important metadata
- expose strong primitive tools for direct structural questions
- expose stronger composed investigation tools for high-value engineering questions
- persist what was asked, what ran, what was found, and whether the answer changed later
- support trust features like contradiction detection and benchmark-based evaluation
- later support AI and ML layers on top of the deterministic system, without those layers becoming the source of truth

The product should feel like:

- one local connection
- one project-aware knowledge layer
- one place for structured engineering investigation

Not:

- a random pile of tools
- a dashboard-first product
- an AI wrapper over weak internals

## What “Done” Means

This project should feel mature only when all of the following are true:

1. A coding agent can connect to a single local `mako` MCP server and work against attached projects cleanly.
2. Project attachment is explicit, stable, and discoverable.
3. Project metadata, schema shape, and local knowledge are stored coherently enough that `mako` does not need to rediscover everything every time.
4. Primitive tools are strong enough to answer direct structural questions reliably.
5. Investigation tools are strong enough to provide “one call, many sources, one structured answer” for the most valuable engineering question shapes.
6. Tool runs and investigations are logged and evaluable.
7. Contradictions, drift, and stale knowledge can be detected instead of hidden.
8. A controlled benchmark project can prove whether `mako` is actually accurate.
9. Later AI/ML layers improve the deterministic core instead of compensating for missing structure.

If those conditions are not met, the project is not truly done.

## What Roadmap 1 Already Achieved

Roadmap 1 delivered the clean local-first rebuild and the first real shipped surface.

It established:

- local-first repo indexing
- shared typed tool contracts
- MCP, HTTP, CLI, and thin web surfaces
- the first tool families
- read-only database schema tools
- a thin `ask` router
- public-facing install and tool docs

That means the next era is not about finishing a foundation from scratch.

It is about building the deeper product on top of that foundation.

## What Roadmap 2 Already Achieved

Roadmap 2 turned the rebuild into a durable project-aware substrate.

It established:

- explicit project attachment and per-project manifest/config
- a global project registry
- local schema snapshots plus live refresh flows
- append-only lifecycle/tool-run storage and benchmark tables
- the evaluation backbone the later agent/tooling work depends on

That means later roadmaps do not need to rebuild project identity, schema storage, or baseline evaluation plumbing.

## What Roadmap 3 Already Achieved

Roadmap 3 turned that substrate into a real local agent/product surface.

It established:

- a transport-agnostic harness with durable sessions and event replay
- a BYOK provider/model layer across local and cloud tiers
- permission-gated action tools with dry-run previews and snapshot-backed undo
- embeddings, semantic retrieval, and memory tools with local-first defaults
- sub-agents, compaction, and resume
- a real browser client and dashboard over the same transport boundary
- the full investigation composer family plus the later tool-surface hardening and cleanup passes

That means the next era is no longer “build the model layer” or “build the harness.” Those are shipped. The next work is about trust, usefulness, and higher-order context quality on top of the shipped agent/tool substrate.

## What Fenrir Actually Proved

Fenrir proved that the most valuable experience was not “many isolated tools.”

Fenrir proved:

### 1. Investigation-grade composition is real value

The compelling experience was:

- one call
- many sub-queries
- one useful answer packet

That is why its search, trace, and preflight flows felt strong.

### 2. Different question shapes deserve different investigation recipes

Fenrir was right to have distinct investigation shapes like:

- search
- trace-rpc
- trace-table
- trace-file
- trace-error
- trace-edge
- preflight

Those are not all the same question.

They should not be flattened into one vague mega-tool.

### 3. Trust features matter

Fenrir’s stored investigations and contradiction behavior proved that:

- memory matters
- re-run comparison matters
- noticing changed answers matters

That is not extra polish.
That is part of the product.

## What Fenrir Got Wrong

Fenrir’s failure was not that the product idea was bad.

Its failure was that it was built too fast and too sloppily around a strong core idea.

The main problems were:

- flat tool sprawl
- weak contracts
- text-heavy outputs instead of typed packets
- weak separation between primitives and composed investigations
- too little evaluation discipline
- too much coupling too early

So the lesson is:

- keep the valuable investigation patterns
- rebuild them modularly
- make the data layer and contracts stronger first

## The Architectural Spine

The project should be built and understood as a stack:

1. `Connection`
2. `Data`
3. `Primitives`
4. `Investigations`
5. `Trust`
6. `AI`
7. `ML`

That order is the backbone.

More explicitly:

### 1. Connection Layer

How `mako` knows what project it is attached to.

### 2. Data Layer

How `mako` stores project metadata, repo facts, schema snapshots, logs, and benchmark results.

### 3. Primitive Tool Layer

The direct, structural, deterministic tools.

### 4. Investigation Layer

The composed “one call, many sources, one packet” tools.

### 5. Trust Layer

Memory, contradiction detection, evaluation, ranking, and historical comparison.

### 6. AI Layer

Models that operate on the structured substrate.

### 7. ML Layer

Learning systems that improve routing, ranking, and retrieval after enough real history exists.

## Why This Order Is Correct

This is the core sequencing logic:

### Connection before data

If project attachment is weak, every later system targets the wrong thing or stores the wrong assumptions.

### Data before composition

If the local data layer is weak, investigation tools become brittle and overly dependent on live querying.

### Evaluation before optimization

If tool runs are not logged properly, there is no honest way to improve the system.

### Primitives before investigations

If the underlying deterministic capabilities are weak, the composed tools become theatrical rather than trustworthy.

### Trust before AI/ML

If the system cannot measure drift, contradiction, and historical quality, later AI/ML layers will just hide mistakes faster.

### AI before ML-heavy adaptation

AI assistance can be layered on once the substrate is stable.
ML should come only after there is enough structured history to learn from.

In short:

`connect -> store -> measure -> expand primitives -> compose investigations -> trust -> AI -> ML`

## Roadmap Sequence

This is the current recommended sequence of major roadmap arcs after Roadmap 1.

## Roadmap 2: Project And Data Backbone

Primary goal:

Turn `mako-ai` from a clean tool server into a durable project-aware system with a strong local knowledge backbone.

What this roadmap needs to accomplish:

- define the explicit project attachment contract
- decide how `mako` globally discovers and manages attached projects
- create the per-project manifest/config approach
- detect and store project metadata cleanly
- define where schema truth comes from locally
- define snapshot, refresh, and diff rules
- formalize logging of tool runs and investigation-related activity
- formalize evaluation storage
- strengthen the benchmark strategy

What should count as standalone deliverables inside this roadmap:

- global project registry
- per-project manifest/config
- schema snapshot system
- canonical logging schema
- benchmark/evaluation backbone

Why this roadmap comes next:

Because without it, later investigation tooling will be impressive but structurally unreliable.

## Roadmap 3: Harness And Model Layer

Primary goal:

Turn `mako-ai` from a catalog of deterministic tools into a drivable agent engine — without abandoning the deterministic substrate and without coupling the core to any one transport. Deliver the original composer family (`cross_search`, `trace_rpc`, etc.) as consumers of that engine rather than as the engine itself.

What this roadmap needs to accomplish:

- stand up a transport-agnostic agent harness with session state, event bus, permission evaluator, and tool dispatcher
- integrate a BYOK multi-provider layer through the Vercel `ai` SDK (Anthropic, OpenAI, Moonshot, Gemini, Mistral, DeepSeek, Groq, OpenRouter, Ollama, Ollama Cloud, LM Studio, arbitrary OpenAI-compatible endpoints)
- ship an action-tool surface (`file_edit`, `file_write`, `apply_patch`, `shell_run`, and more) with declarative permissions, dry-run previews, and snapshot-backed undo
- ship an embedding layer and semantic memory (`memory_remember` / `memory_recall` / `memory_list`) with local-first defaults and FTS5 fallback
- deliver sub-agents, compaction, and session resume so long agentic work is durable
- ship a browser client that drives the harness over the same transport the CLI uses, validating the architecture's promise that a web UI is a client, not a retrofit
- deliver the original composer family as deterministic tools that plug into the harness

Likely standalone deliverables:

- transport-agnostic harness core (`packages/harness-core`)
- BYOK provider layer with layered key resolution and fallback chains
- declarative permission model with UI-decoupled approval events
- embedding provider axis separate from chat, with raw Float32 BLOB vector storage and FTS fallback
- sub-agents, compaction, and resume
- HTTP + SSE transport service (`services/harness`)
- web UI alpha (`apps/web`) as a transport-parity proof point
- investigation composer family (`cross_search`, `trace_rpc`, `trace_table`, `trace_file`, `trace_error`, `trace_edge`, `preflight_table`) as deterministic tools

Three intelligence tiers are first-class and must stay supported for the life of the product:

- `no-agent` — deterministic tools only; fully useful with zero model configured; a product, not a fallback
- `local-agent` — local chat and local embeddings (Ollama, LM Studio, llama.cpp); zero network egress required
- `cloud-agent` — any BYOK cloud provider

BYOK-only is a permanent rule. `mako-ai` never hosts shared model keys and never proxies requests through a central billing surface.

Why this roadmap reframes the original plan:

The original Roadmap 3 framed the work as composer tools first. That framing predates the decision to ship a harness. Composers without a consumer are theatrical — they stay stuck behind one-shot CLI and MCP calls, and the AI layer gets bolted on ad hoc later, repeating Fenrir's `rebuild the magic before the backbone is ready` mistake. The harness is the consumer; composers slot in cleanly as its final phase.

Why this roadmap follows Roadmap 2:

Because the harness needs a real project contract, real schema snapshots, a real logging substrate, and real benchmark storage to be worth building on. Roadmap 2 shipped all of those. Roadmap 3 turns them into something an agent can drive and a human can edit code with.

Roadmap 3 is now complete. The shipped version differs from the early sketch in a few important ways:

- transport stayed `HTTP + SSE + REST mutations`; WebSocket did not ship
- embeddings shipped with raw Float32 BLOB storage plus Node-side cosine scoring and FTS fallback, not `sqlite-vec`
- the roadmap later closed with `3.9.2` planner-backed exposure, `3.9.3` live evaluation + retrieval hardening, and `3.9.4` cleanup/polish

## Roadmap 4: Trust, Memory, And Evaluation Maturity

Primary goal:

Make `mako`'s structured answers historically comparable, drift-aware, and explicitly trust-ranked.

What this roadmap needs to accomplish:

- persist answer packets and comparable investigation runs with stable identity
- compare current and previous answers for the same target/question shape
- detect contradictions, stale evidence, drift, and changed upstream facts
- expose trust signals to agents and humans across CLI, API, MCP, and web surfaces
- deepen benchmark-driven evaluation with seeded-defect and regression-style suites
- add targeted alignment diagnostics where trust actually depends on them, such as frontend/backend/schema/type consistency

Likely standalone deliverables:

- answer/investigation memory store
- rerun-and-compare engine
- contradiction/drift engine
- trust signal surface
- benchmark/regression evaluation summaries
- alignment diagnostic surfaces where they can be grounded in real evidence

Why this roadmap follows Roadmap 3:

Because trust features are only valuable once investigation outputs, session tooling, and the external-agent surface all exist in a mature form. Roadmap 3 shipped that substrate; Roadmap 4 makes it honest over time.

## Roadmap 5: Context And Workflow Assistance

Primary goal:

Turn the shipped primitives, composers, and trust signals into typed
workflow-context products that help real coding work.

What this roadmap needs to accomplish:

- package low-level evidence, trust state, diagnostics, and compare history into reusable context packets for common engineering tasks
- ship first-class packet families such as implementation briefs, impact packets, precedent packs, and verification plans
- make external-agent and harness callers better at “what should I read/change/check?” workflows through explicit loop-style guidance instead of vague chat wrappers
- keep these outputs typed and evidence-backed rather than collapsing into free-form summaries
- standardize how higher-order context products are requested, consumed, and refreshed
- prefer on-demand generation and explicit watch workflows before background automation
- allow git hooks and CI-scheduled runs as optional wrappers around stable packet generators, but do not make a scheduler/worker a core requirement
- separate packet exposure intentionally across tools, prompts, and resources
  instead of assuming every workflow product belongs behind a tool call
- keep wrapper rollout incremental: start with one narrow daily-friction
  workflow, prove value, then expand
- preserve strict workflow-state semantics under automation rather than
  auto-marking partial or failing work as complete
- make the workflow products materially influence the normal answer/composer
  path before declaring the roadmap done
- define an explicit, source-labeled reference-research process for broader
  precedent gathering without weakening local trust semantics

Research-informed shape to preserve:

- implementation briefs should stay compact and decision-oriented: summary, key changes, tests/verification, assumptions
- workflow assistance should prefer explicit loop recipes with clear stop conditions instead of fuzzy planner prose
- surfaced follow-up items should use small typed issue/action envelopes rather than ad hoc narrative blocks
- packet generators should consume the shipped `4.7` bridge (`WorkflowContextBundle`
  / `WorkflowPacketInput`) instead of reparsing raw `AnswerResult`
- prompts/resources may be the cleaner fit for some packet-consumption flows
  once the packet layer exists

Likely standalone deliverables:

- context-packet surfaces
- implementation-brief / impact / precedent / verification packet generators
- agent-facing workflow recipes with explicit stop conditions and verification rules
- watch-mode workflow assistance over the shipped deterministic substrate
- optional hook / CI automation surfaces that wrap the packet layer without owning it
- packet-family contracts, citation rules, and generator registry seams
- default-path packet recommendation and attachment policy
- workflow-state handoff inside the normal tool loop
- optional reference-backed precedent research that stays clearly separate from
  local project evidence

Why this roadmap comes after trust and evaluation:

Because these higher-order context products are only worth trusting once the
system can compare answers over time and surface confidence/drift honestly.
They also need to matter in the normal product path before later roadmaps
start generating broader workflow artifacts on top of them.

## Roadmap 6: Power Workflows And Operational Intelligence

Primary goal:

Turn the shipped primitives, composers, trust signals, and workflow packet
layer into Fenrir-class high-leverage workflows without reintroducing Fenrir's
tool sprawl or weak contracts.

What this roadmap needs to accomplish:

- answer cross-stack connection questions such as “how does X connect to Y?”
- ship graph/path and flow-map style tools over the existing local-first substrate
- turn the current auth, RLS, query, and schema evidence into operator-grade
  audits such as multi-tenant leak detection
- expose project-level queue and handoff surfaces so users and agents can ask
  “what should I work on next?” without manually assembling that view from
  file-level answers
- add one bounded multi-tool investigation mode that composes existing named
  tools under explicit step limits and typed outputs
- keep the new workflows typed, compositional, and eval-backed instead of
  bolting on a vague oracle layer

Boundary rules for this roadmap:

- graph edges must declare exact vs heuristic status and carry provenance
- `change_plan` must stay graph-derived instead of duplicating Roadmap 5 packet products
- tenant/auth audits must pin a tenant-boundary model before implementation
- project queue and handoff surfaces should derive from existing facts before introducing mutable queue state
- `suggest` must not become a second planner beside `ask` and packet handoff

Likely standalone deliverables:

- graph entity/edge contract
- `graph_neighbors` and `graph_path`
- `flow_map` and `change_plan`
- `tenant_leak_audit`
- project-level queue / handoff surfaces
- bounded `investigate` / `suggest` surfaces
- usefulness and noise evaluation for the new workflows

Why this roadmap comes here:

Because Roadmap 5 proved the trust and workflow substrate is real, but the
largest remaining product gap is still powerful deterministic workflows rather
than generated artifacts. This roadmap should cash out that substrate into the
small set of high-leverage capabilities Fenrir users actually remembered,
without reopening packet plumbing or lower trust layers.

## Roadmap 7: Generated Artifacts And Workflow Integration

Primary goal:

Use the trusted context and power-workflow layers from Roadmaps 5 and 6 to
produce generated artifacts and tighter day-to-day workflow integrations.

What this roadmap needs to accomplish:

- generate repo-aware technical docs and handoff artifacts from trusted packet
  and workflow outputs
- generate task preflight, review, and verification artifacts from stable
  workflow-context and power-workflow inputs
- improve integration with the main coding harness, CLI, and external-agent
  surfaces without turning artifact generation into a second planner
- expose optional hook / CI / editor / workflow integrations around those
  generated artifacts
- make `mako` more directly useful during build/change workflows without making
  background automation mandatory

Boundary rules for this roadmap:

- generated artifacts must declare their typed basis explicitly
- artifact renderers are projections of typed inputs, not the source of truth
- Roadmap 7 should package and compose Roadmap 5/6 outputs before inventing new
  packet families
- integrations stay opt-in wrappers unless later evidence proves they deserve
  broader exposure
- no ML or learned rollout logic belongs here

Likely standalone deliverables:

- generated artifact contract and render layer
- task preflight / implementation handoff artifacts
- review / verification / change-management artifacts
- deeper harness / CLI / external-agent integration surfaces
- optional workflow-integration surfaces (hooks, CI schedules, editor/export
  entrypoints)
- usefulness and exposure evaluation for generated artifacts and wrappers

Why this roadmap comes here:

Because this is where the system starts to produce broader workflow artifacts,
not just answers, packets, and high-leverage investigation workflows. That
should happen only after the assistance and power-workflow layers are stable.
Roadmaps 5 and 6 now shipped that stable basis:

- typed workflow packets
- handoff-driven packet actions
- graph / operator / project-intelligence workflows
- bounded investigation and explicit exposure posture

## Roadmap 8: ML, Learning, And Advanced Optimization

Primary goal:

Use accumulated structured history to improve the system intelligently and
measurably.

What this roadmap needs to accomplish:

- learn from tool and investigation history
- improve ranking and routing
- turn packet/usefulness/follow-up history into safe promotion and rollout
  decisions with explicit rollback discipline
- cluster failures and weak patterns
- explore stronger retrieval and optimization approaches
- mature the advanced intelligence layer without breaking the deterministic
  backbone

Likely standalone deliverables:

- learned ranking signals
- routing improvement logic
- attachment/promotion policy learned from observed history
- failure clustering
- advanced optimization experiments

Why this roadmap is last:

Because it only makes sense after the project has enough stable behavior and
enough accumulated data to justify it.

## Tracks Opened After This Plan

The following roadmap tracks were opened after the original Roadmap 1-8
sequence was written. They live alongside the numbered roadmaps, not
inside them, and each ships its own README / roadmap / handoff /
phases package under `devdocs/roadmap/`:

- **Initial Testing** (`devdocs/roadmap/version-initial-testing/`) —
  hardening pass after Roadmap 8.1 telemetry shipped. Covers finding
  acknowledgements, MCP perf and project-store lifetime, package-backed
  search and parsing, index freshness and auto-refresh, deterministic
  context packets, and parser/resolver hardening. Treat the six
  Initial Testing phases as the canonical post-roadmap-8 substrate.
- **Roadmap CC** (`devdocs/roadmap/version-cc/`) — Claude Code-native
  client ergonomics: client adapters, MCP discoverability, typed
  progress notifications, prepared statement cache, session recall,
  composed context bundles, agent feedback channel, and the Claude
  Code plugin package.
- **Reef Engine** (`devdocs/roadmap/reef-engine/`) — durable fact and
  active findings substrate. Six phases from fact model through tool
  view migration to a measured native-vs-TypeScript decision.
- **Mako Studio** (`devdocs/roadmap/mako-studio/`) — desktop packaging
  and operator surface. Wraps the existing `apps/web` dashboard and
  the two HTTP services in a Tauri 2 shell. Six phases from shell
  foundation through rule pack browser.

Each new track inherits the cross-roadmap rules below. None of them
override the rules; they extend them with track-specific contracts.

## Cross-Roadmap Rules

These rules should stay true unless a future documentation branch explicitly changes them.

- deterministic systems come before AI-heavy systems
- logging and evaluation come before ranking and learning
- primitive tools come before investigation composers
- composed investigations should return typed structured packets
- one helper does not automatically mean one public tool
- public tool families should stay intentional and understandable
- prefer on-demand and explicit watch workflows before background automation
- hooks / cron / workers may wrap stable capabilities, but should not be required for the core product path
- major direction changes should create a new roadmap documentation branch, not quietly rewrite older planning meaning

## Documentation Evolution Rule

The docs should evolve like a real engineering system, not like a single mutable note.

If the project changes materially:

- branch the roadmap docs cleanly
- preserve the older roadmap as history
- document why the new roadmap exists
- use an `x.x.x` documentation version pattern where it helps track meaningful planning changes

Examples:

- `roadmap/version-2/`
- `roadmap/version-3/`
- `master-plan v2.0.0`
- `phase docs v2.1.0`

The exact naming can stay lightweight.
The important thing is keeping the history understandable.

## What This Master Plan Does Not Do

This document does not:

- lock implementation details too early
- force every later roadmap to use the exact same internal structure
- prevent a better pattern from replacing the current idea
- replace roadmap docs
- replace phase docs

Its job is to keep the long-range shape coherent.

## Practical Reading Of This Plan

If someone asks:

- “What is `mako-ai` trying to become?”  
  Read this file.

- “What should we build next?”  
  Read the next roadmap doc derived from this file.

- “What exactly do we implement right now?”  
  Read the current roadmap’s phase docs.

## Current Recommendation

Roadmaps 1 through 7 are complete through their originally planned closures.

Roadmap 7 closed at `7.5` with the generated-artifact families, wrapper
posture, and exposure rules shipped.

Current branch state:

- the original Roadmap 7 goals are complete
- a narrow post-close `7.6` extension is reasonable only when it packages
  already-shipped internal code-intel primitives more cleanly on the shared
  tool plane
- otherwise the next major roadmap remains Roadmap 8

That means the recommended work split is:

- use Roadmap 7 only for small, bounded surface-polish extensions such as
  code-intel exposure, smoke coverage, and discovery/docs cleanup
- do not reopen the trust substrate, graph substrate, or artifact basis model
- reserve Roadmap 8 for telemetry-driven ranking, routing, and rollout changes
