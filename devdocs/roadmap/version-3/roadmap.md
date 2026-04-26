# Roadmap Version 3

This file is the canonical roadmap for the next `mako-ai` build cycle after Roadmap 2.

If another Roadmap 3 doc disagrees with this file about what the roadmap is for, what phase is current, or what is deferred, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-2/roadmap.md](../version-2/roadmap.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Roadmap Contract

Roadmap 3 is the `Harness And Model Layer` roadmap.

Its job is to make `mako-ai`:

- drivable as an agent, not just a catalog of deterministic tools
- capable of editing code through structured, logged, permission-gated action tools
- model-agnostic and BYOK-only, with local-model and cloud-model tiers
- transport-agnostic at the core so CLI, MCP, and a future web UI drive the same engine
- still fully usable with zero model configured through a first-class no-agent tier
- ready for trust/memory work in Roadmap 4 and composed investigations as its final phases

This roadmap is explicitly a reframe of the original master-plan Roadmap 3 (`Deterministic Intelligence And Investigation Composition`). The master-plan framing is not wrong — it simply predates the decision to ship a harness. Composers land in this roadmap, but as Phase 3.6+ consumers of the harness spine, not as the spine itself.

## Roadmap 3 Status: Complete

Phases 3.0 (Harness Foundation), 3.1 (Provider Layer), 3.2 (Action Tools and Permission Model), 3.3 (Embeddings and Semantic Memory), 3.4 (Sub-agents, Compaction, and Resume), 3.5 (Web UI Alpha), 3.5.1 (Web UI QoL and Session Telemetry), 3.6.0 (Substrate Lift), 3.6.1 (Investigation Composers), 3.7 (Semantic Retrieval Expansion), 3.8 (Website Improvements), 3.9 (Model Layer), 3.9.1 (Web Dashboard Polish), 3.9.2 (Tool Surface Planning), 3.9.3 (Tool Surface Evaluation), and 3.9.4 (Cleanup And Polish) are all closed.

Roadmap 3 is complete. The next roadmap is Roadmap 4 (Trust Layer).

## Current Status

Roadmaps 1 and 2 are complete and shipped.

`mako-ai` already has:

- a first-class project contract with `.mako/` manifest and explicit attach/detach
- one canonical local schema IR with repo-derived and live-refresh source modes
- project-scoped live DB binding with keychain and env-var strategies
- append-only `lifecycle_events`, `tool_runs`, and benchmark tables in `project.db`
- `tool_usage_stats` rollup in `global.db`
- a deterministic registry plus the composer family reachable over CLI, HTTP, and MCP
- a thin `ask` router
- a publishable `agentmako connect` cold-start path
- a CLI dispatcher split into command modules under `apps/cli/src/commands/`
- a split `services/api` with route modules under `services/api/src/routes/`
- a transport-agnostic harness with BYOK providers, action tools, memory recall, sub-agents, and a working web client

The final Roadmap 3 gaps were tool-surface quality, evidence-backed validation of the current surface, and a last cleanup/refactor pass before handing off to Roadmap 4. Phases 3.9.2, 3.9.3, and 3.9.4 closed those:

- 3.9.2 shipped one planner-backed exposure truth for harness chat and MCP/API callers
- 3.9.3 validated the live product against real and seeded workflows, then shipped the last narrow retrieval hardening fixes instead of inventing another speculative tool family
- 3.9.4 cleaned the remaining planner/search-catalog duplication and removed temporary eval residue so Roadmap 4 starts from a cleaner base

The remaining open questions are now trust/ranking/usefulness questions and belong in Roadmap 4.

## Why This Roadmap Comes Next

Roadmap 2 built the substrate. Roadmap 3 turns that substrate into something an agent can drive and a human can edit code with, without abandoning the deterministic guarantees that make mako trustworthy.

If we skip straight to the original Roadmap 3 scope (composer tools like `trace_rpc`, `trace_table`, `cross_search`) without the harness:

- composers have no consumer beyond one-shot CLI and MCP calls
- the AI layer gets bolted on ad hoc later, repeating Fenrir's `rebuild the magic before the backbone is ready` mistake
- the web-UI goal stays blocked on retrofit work after every decision is already coupled to terminal UX
- users with zero model configured lose nothing today, but also gain nothing from the harness work when it eventually lands

Roadmap 3 exists so that:

- composers are built against a real consumer that exercises them
- the AI layer is designed before being implemented, not after
- the web UI is a client of a transport-agnostic core, not a retrofit
- the no-agent tier keeps mako valuable with zero network egress

## Core Product Decision

Roadmap 3 adopts this rule:

`mako` is a three-tier system. The `no-agent` tier is a product, not a fallback. The `local-agent` and `cloud-agent` tiers add agency on top of the same deterministic substrate, through BYOK only, with a transport-agnostic core.

That means:

- the no-agent tier must stay fully useful with zero model configured
- the local-agent tier must work with zero network egress against Ollama, LM Studio, llama.cpp, or any OpenAI-compatible local endpoint
- the cloud-agent tier runs against any BYOK provider (Anthropic, OpenAI, Moonshot, Gemini, Groq, DeepSeek, Mistral, OpenRouter, Ollama Cloud, and arbitrary OpenAI-compatible endpoints)
- `mako-ai` never hosts shared model keys and never routes through a central billing surface
- the harness core in `packages/harness-core` never imports transport code, so CLI, HTTP, MCP, and a future web UI are all adapters
- action tools are audited, dry-run-by-default, permission-gated, and snapshot-backed for undo
- embeddings are a separate provider axis from chat and default to local with FTS5 fallback

## Human Interaction Model

Roadmap 3 adds an interactive surface on top of the existing explicit `project attach` / `connect` / `index` / `status` model. The existing contracts do not change.

### Chat Surface

Chat is a first-class CLI and HTTP surface.

The human can:

- `agentmako chat` for an interactive REPL against the currently attached project
- `agentmako chat --message "..."` for a one-shot turn that exits on `turn.done`
- hit `POST /api/v1/sessions` + `/api/v1/sessions/:id/messages` from any HTTP client
- subscribe to `GET /api/v1/sessions/:id/stream` (SSE) for streaming deltas — honors `?after=<ordinal>` for resume-from-ordinal replay
- issue approval / deny via REST (`POST /api/v1/sessions/:id/permissions/requests/:requestId`) — no WebSocket transport; cancel is REST as well once Phase 3.5 adds it

Rules:

- chat may read, recall, and reason without approval
- chat must request approval before any action tool mutates the filesystem or runs a shell command
- chat results are durable — every turn, tool call, provider call, and approval is logged

### Tier Resolution

Tier resolution is automatic but explicit. The human can always override.

Recommended order:

1. explicit session override (`POST /sessions { tier: "..." }`)
2. project `.mako/config.json` `defaults.tier`
3. user `~/.mako/config.json` `defaults.tier`
4. auto: `cloud-agent` if a cloud provider has a usable key → `local-agent` if a local endpoint responds → else `no-agent`

Rule:

- tier resolution may be automatic
- provider key binding is never automatic
- the CLI exposes `agentmako tier` to print the current tier, what resolved it, and what to add to unlock the next tier

### Approval Model

Approvals are declarative, scoped, and decoupled from UI.

`mako` should prompt the human when:

- a tool is configured with `action: "ask"` in `.mako/permissions.json`
- no matching `action: "allow"` rule has been remembered in a narrower scope

`mako` should never prompt when:

- the tool is read-only (existing 16 tools and composers)
- a matching `action: "allow"` rule exists at the current turn, session, project, or global scope

`mako` should refuse when:

- a matching `action: "deny"` rule exists at any scope
- the target is outside the active project root
- the target matches a reserved-sensitive pattern (`.env*`, `~/.ssh/*`) unless overridden project-locally

### Tool Surface Evolution

Roadmap 3 adds two tool families:

- **Action tools** — `file_read`, `file_write`, `file_edit`, `apply_patch`, `create_file`, `delete_file`, `shell_run`, `sub_agent_spawn`, `memory_remember`, `memory_recall`, `memory_list`.
- **Investigation composers** — `cross_search`, `trace_rpc`, `trace_table`, `trace_file`, `trace_error`, `trace_edge`, `preflight_table` (Phase 3.6+).

All new tools register into the existing tool registry at `packages/tools/src/registry.ts`. There is no parallel registry for harness tools.

Existing Roadmap 1 tools stay as-is and remain reachable from CLI, HTTP, and MCP.

## Roadmap 3 Standalone Deliverables

Roadmap 3 should leave behind seven major deliverables.

### 1. Harness Core

A transport-agnostic agent loop with session state, event bus, permission evaluator, provider registry, and tool dispatcher.

It should include:

- `packages/harness-core` with zero transport dependencies
- `packages/harness-contracts` with zod schemas for sessions, messages, parts, permissions, providers, models, events, tiers
- session persistence in `project.db` through `packages/store`
- append-only `harness_session_events` as the spine of the SSE stream (WebSocket transport was scoped out at implementation time — SSE + REST mutations cover the same capabilities with less framework coupling; see Phase 3.5)

### 2. Provider Layer

A BYOK multi-provider integration through the Vercel `ai` SDK.

It should include:

- `ProviderSpec` / `ModelSpec` schemas and a bundled model catalog
- first-party extensions for `anthropic`, `openai`, `moonshot`, `ollama`, `ollama-cloud`, `openai-compatible`, `lmstudio`
- layered key resolution (explicit → session → project config → global config → env → system keychain)
- system keychain integration via `@napi-rs/keyring`
- provider fallback chains with structured retry on auth-error / rate-limit / 5xx

### 3. Action Tool Surface With Permission Model

A set of mutation tools, every one of them gated, previewed, logged, and reversible.

It should include:

- `file_write`, `file_edit`, `apply_patch`, `create_file`, `delete_file`, `shell_run`
- declarative permission rules in `.mako/permissions.json` and `~/.mako/permissions.json`
- dry-run + unified-diff preview attached to every approval request
- filesystem snapshots under `storage/snapshots/<session_id>/<message_ordinal>/` and `agentmako undo`

### 4. Embeddings And Semantic Memory

A separate provider axis for embeddings with hybrid FTS5 + vector search and graceful FTS-only fallback.

It should include:

- `EmbeddingProvider` interface layered over ai SDK embedding primitives and direct Ollama HTTP
- Float32 BLOB vector storage in `harness_embeddings` with Node-side cosine similarity (3.3 shipping path — `sqlite-vec` virtual-table indexing is a future optimization the BLOB layout leaves room for)
- `memory_remember`, `memory_recall`, `memory_list` tools
- dimension-mismatch safe recall scoped by embedding model

### 5. Sub-agents, Compaction, And Resume

A durable session model strong enough for long-running agentic work.

It should include:

- `harness_sessions.parent_id` and `sub_agent_spawn` for child sessions
- token-budget-driven compaction that archives old turns and inserts a summary system message
- `agentmako session resume <id>` that replays `harness_session_events` to restore mid-turn state after a restart

### 6. Transport Service

An HTTP + SSE server that mounts harness-core on its own port and its own process.

It should include:

- `services/harness` on `127.0.0.1:3018` (separate from `services/api` on `3017`)
- `node:http` with SSE (Phase 3.0 shipped the raw-http path — Hono was considered in the plan but `node:http` matched `services/api`'s pattern and avoided a framework dep at the spine)
- origin validation mirroring `services/api/src/server-utils.ts`
- pure parity with CLI — any CLI command must be expressible as an HTTP request

### 7. Web UI Alpha

A browser client that drives the harness entirely over the transport service.

It should include:

- `apps/web` replaced by a real web client (React + Vite, pending Phase 3.5 confirmation)
- single-pane chat with streaming deltas
- approval modal with rendered unified diff for mutations
- read-only project file tree scoped to the attached project

### 8. Investigation Composers

The original Roadmap 3 scope, delivered as consumers of the harness spine.

It should include:

- `cross_search`
- `trace_rpc`
- `trace_table`
- `trace_file`
- `trace_error`
- `trace_edge`
- `preflight_table`

Each composer is a deterministic tool in `packages/tools` — it runs with no-agent tier and becomes more useful when a model is driving it.

## Key Decisions

### 1. Harness Is The Spine, Composers Come Last

Roadmap 3 inverts the master-plan's original order. The harness foundation is Phase 3.0; composers are Phase 3.6+.

The reason is that composers without a consumer are theatrical. Phase 3.0 through 3.5 build the consumer. Phase 3.6 builds the investigations that plug into it.

### 2. BYOK Only, Forever

`mako-ai` never hosts shared model keys. There is no billing layer, no central secrets store, no proxy provider.

Users run local models or bring their own API keys. Every provider adapter assumes the key is provided by the operator through env, config, or keychain.

### 3. Three Intelligence Tiers With Capability Declarations

Every tool declares its `minimumTier`. The evaluator blocks invocations the current tier cannot support and returns a structured `TierInsufficientError` with an upgrade hint.

Illustrative tiers:

- `no-agent` — deterministic tools only; `ask` router handles natural-language routing without a model
- `local-agent` — local chat and local embeddings; zero network egress required
- `cloud-agent` — any BYOK cloud provider

The no-agent tier is a product, not a fallback. Mako with zero model configured must still be useful.

### 4. Vercel `ai` SDK Is The Single Provider Abstraction

Providers ride on `@ai-sdk/*` packages. OpenAI-compatible adapters (Ollama, LM Studio, OpenRouter, custom endpoints) route through `@ai-sdk/openai-compatible` with `baseURL` overrides.

There is no parallel provider interface.

### 5. Embeddings Are A Separate Provider Axis

`defaults.chat.provider` and `defaults.embedding.provider` are resolved independently. Users can pair local embeddings with a cloud chat model or vice versa.

Default resolution is local Ollama `nomic-embed-text` → BYOK cloud → FTS5-only graceful mode.

### 6. Declarative Permission Rules

Permissions are declarative `{ permission, pattern, action }` rules evaluated before every tool invocation. `deny` beats `allow`; more-specific rules beat more-general rules.

Rules live in `.mako/permissions.json` and `~/.mako/permissions.json`.

Action-tool defaults are `ask` with a dry-run preview attached to the approval request. The preview is part of the emitted event — UIs render it, the core does not.

### 7. Action Tools Are Audited And Reversible

Every mutation tool writes a before-state snapshot under `storage/snapshots/<session_id>/<message_ordinal>/` and records the snapshot id on the `tool_run`.

`agentmako session undo <session> <ordinal>` restores from snapshot.

### 8. Transport-Agnostic Core

`packages/harness-core` has no HTTP, no SSE, no stdio, no terminal assumptions. The CLI is an adapter. The web UI is an adapter. MCP stays tool-surface-only and does not expose session state.

If a capability exists in the CLI, it must also exist in the HTTP API. This is an acceptance test.

### 9. SQLite Stays Authoritative

Session, message, part, permission-decision, provider-call, memory, and embedding state all land in `project.db` through `packages/store`. No new datastores.

Vectors are stored as raw Float32 BLOBs; hybrid search uses FTS5 + Node-side cosine + RRF fusion. `sqlite-vec` is *not* loaded in Phase 3.3 (platform-binding risk); the BLOB layout is a clean swap-in point for `vec0`-backed indexing in a later phase if the no-index path starts to matter for larger owner kinds (e.g. `file`, `symbol`).

## Phases

### Phase 3.0: Harness Foundation

Status: `Complete`

Goal:

Stand up a transport-agnostic harness core, a session store backed by `project.db`, and an HTTP service that exposes the no-agent tier end to end.

Build:

- `packages/harness-core` with agent loop, session store, event bus, permission evaluator skeleton, provider registry skeleton, tool dispatcher, tier resolver, system prompt composer, `ask`-adapter
- `packages/harness-contracts` with zod schemas for sessions, messages, parts, provider specs, permission rules, events, tiers
- `packages/harness-tools` with the filesystem action-tool scaffold (`file_read` ships in Phase 3.2; memory tools ship in 3.3 under `harness-core`, not here)
- `services/harness` on `127.0.0.1:3018` with `/sessions`, `/messages`, `/stream` (SSE), `/providers`, `/models`, `/permissions`, `/tier`. No `/ws` route — SSE + REST mutations replaced the original WebSocket plan at implementation time; Phase 3.5 codifies the decision.
- migration `0008_project_harness` (inline constant in `packages/store/src/migration-sql.ts`) with `harness_sessions`, `harness_messages`, `harness_message_parts`, `harness_session_events`, `harness_permission_decisions`, `harness_provider_calls`. Discrete `.sql` files were retired at 3.0 ship time to sidestep a bundling hazard.
- CLI commands: `chat`, `session`, `tier`
- master-plan Roadmap 3 section rewritten to match this reframe

Rules:

- no provider code in this phase — chat must work in `no-agent` tier using the existing `ask` router
- `harness-core` must not import anything from `services/*`
- CLI must route through the HTTP API; no direct imports from `harness-core`
- all harness writes go through `packages/store`; no new SQLite code paths

Done when:

- `agentmako chat` works end-to-end with zero providers configured
- SSE stream emits `text.delta` and `turn.done`
- `devdocs/roadmap/version-3/` and `devdocs/master-plan.md` are aligned
- `test/harness-no-agent.ts` passes

### Phase 3.1: Provider Layer

Status: `Complete`

Goal:

Integrate the Vercel `ai` SDK and light up the `local-agent` and `cloud-agent` tiers against BYOK providers.

Build:

- extensions filled in: `anthropic`, `openai`, `moonshot`, `ollama`, `ollama-cloud`, `openai-compatible`, `lmstudio`
- bundled `packages/harness-contracts/models/catalog.json`
- layered key resolution through explicit → session → project → global → env → keychain
- `@napi-rs/keyring` integration with service name `mako-ai` and account `<provider-id>`
- provider fallback chains with structured retry on auth-error / rate-limit / 5xx
- CLI commands: `providers` (list/add/remove/test), `keys` (set)
- `{env:VAR_NAME}` indirection resolved at read time

Rules:

- every provider rides the ai SDK; no bespoke HTTP clients per provider
- keychain failures degrade to env; env failures surface clearly
- custom providers can be added by config alone, without code changes
- sensitive fields never round-trip through logs

Done when:

- `agentmako chat` works offline with Ollama local
- `agentmako chat` works against Kimi K2.5 via Moonshot with a BYOK key (doc exemplar)
- `agentmako chat` works against Ollama Cloud with a BYOK key
- `agentmako keys set <provider> --prompt` stores into system keychain
- fallback chain proven end-to-end with `provider_calls` rows recording both primary and fallback
- `test/harness-cloud-agent.ts`, `test/harness-local-agent.ts`, `test/harness-provider-fallback.ts`, `test/harness-keyring.ts` pass

### Phase 3.2: Action Tools And Permission Model

Status: `Complete`

Goal:

Ship the action tool family and the declarative permission model, with dry-run previews, approval events, snapshot-backed undo, and MCP-compatible approval metadata.

Build:

- `packages/harness-tools` action tools: `file_write`, `file_edit`, `apply_patch`, `create_file`, `delete_file`, `shell_run`
- `permission-evaluator` with most-specific-wins rule matching
- approval event flow through the session bus with `permission.request` / `permission.decision` events
- rule files: `.mako/permissions.json` and `~/.mako/permissions.json`
- snapshot system under `storage/snapshots/<session_id>/<message_ordinal>/`
- CLI command: `undo`
- MCP metadata: action tools return `requiresApproval: true` so external MCP clients can prompt

Rules:

- every mutation tool attaches a dry-run preview to the approval request
- `deny` always beats `allow`
- `.env*`, `~/.ssh/*`, and paths outside project root deny by convention
- approval scope is stored: `turn`, `session`, `project`, or `global`

Done when:

- a cloud-agent session can propose and apply a `file_edit` after approval
- a deny rule blocks a mutation with a structured `PermissionDeniedError`
- a pattern rule bypasses prompts for matching commands
- `agentmako undo` restores files from snapshot
- `test/harness-action-approval.ts`, `test/harness-action-deny.ts` pass

### Phase 3.3: Embeddings And Semantic Memory

Status: `Complete`

Goal:

Ship a separate embedding provider axis and build `memory_remember` / `memory_recall` / `memory_list` with hybrid FTS5 + vector search, RRF fusion, and graceful FTS-only fallback.

Build:

- migrations `0010_project_harness_memories` (+ `harness_memories_fts`) and `0011_project_harness_embeddings`, inline in `packages/store/src/migration-sql.ts`
- `EmbeddingProvider` interface with Ollama direct HTTP, LM Studio + OpenAI + generic `openai-compatible` via the ai SDK
- `nomic-embed-text` as the default local embedding model; LM Studio as an alternate local provider
- vectors stored as Float32 BLOBs with Node-side cosine similarity (no `sqlite-vec` dependency in 3.3)
- hybrid search (FTS5 + vector cosine, RRF-fused with `k=60`) with dimension-safe model scoping
- FTS-only fallback mode with `{ mode: "fts-fallback", reason }` signal

Rules:

- embedding provider is independent of chat provider
- changing embedding models never corrupts old vectors; recall scopes by model, mismatched-dim rows are silently skipped
- killing the embedding provider never breaks recall — FTS kicks in with a populated `reason`

Done when:

- `memory_remember` and `memory_recall` work end-to-end against a local Ollama or LM Studio embedding model
- with no embedding provider configured, recall still returns via FTS with a clear mode signal
- `test/smoke/harness-memory-fts-fallback.ts` and `test/smoke/harness-memory-model-scope.ts` run in the CI smoke chain
- `test/smoke/harness-memory.ts` (Ollama) and `test/smoke/harness-memory-lmstudio.ts` (LM Studio) pass when their respective local endpoints are available

### Phase 3.4: Sub-agents, Compaction, And Resume

Status: `Complete`

Goal:

Make sessions durable enough for long agentic work through sub-agent spawning, token-budget compaction, and mid-turn resume.

Build:

- `sub_agent_spawn` tool (in `packages/harness-core/src/sub-agent-tools.ts`, following the memory-tools placement pattern) that opens a child `harness_sessions` row with an inherited permission scope
- `packages/harness-core/src/compaction.ts` that summarizes old turns at a configurable token fraction (default 60%) and archives originals
- `agentmako session resume <id>` that replays `harness_session_events` to restore state after a restart
- `archived=1` flag on `harness_messages` to mark compacted turns without deleting them (added by migration `0012`)

Rules:

- child results surface as `tool_result` parts in the parent
- compaction never deletes originals; it only archives and summarizes
- resume replays events deterministically; no re-invocation of tools during replay

Done when:

- a parent spawns a child (single-turn in 3.4) and the child's assistant text folds back to the parent as a `tool_result`; `sub_agent.started` and `sub_agent.finished` events correlate on the parent's event log
- a long session crosses the compaction threshold and stays coherent — oldest turns are archived (`archived=1`), a synthetic summary system message is inserted, subsequent turns read through `buildHistory` which skips archived rows
- mid-stream kill + `session resume` replays events deterministically and produces identical final state; no tool is re-invoked; any `permission.request` events with no matching `permission.decision` surface as abandoned pending approvals via the `resume.pending_approvals` event and the resume response body (the original Promises are gone with the process — callers re-trigger by posting a new user message)
- version fence: sessions stamp `harness_version` on creation; resume compares the stored major against the running binary. Sessions created *before* 3.4 (pre-migration-0012 rows with `harness_version = NULL`) are allowed through as legacy. Explicit major mismatches throw `resume/version-mismatch`
- three deterministic CI smokes pass: `test/smoke/harness-sub-agent.ts`, `test/smoke/harness-resume.ts`, `test/smoke/harness-resume-pending-approval.ts`. One live-provider smoke (`test/smoke/harness-compaction.ts`) runs manually via `pnpm test:smoke:compaction` when a catalog-declared chat model is pulled

### Phase 3.5: Web UI Alpha

Status: `Complete`

Goal:

Prove transport parity and unlock the long-term web-UI goal by shipping a real browser client that drives the harness entirely over HTTP + SSE + REST (no WebSocket — see Phase 3.5 Hard Decisions).

Build:

- `apps/web` rewritten as a React + Vite + Tailwind v4 app with the "mako" design system (OKLCH depth-ramp palette, IBM Plex Sans + Mono, depth-line active indicator, sonar ping)
- Dashboard / Session / Providers / Memory routes under a single left-nav shell
- Model picker on the dashboard with `localStorage` persistence and a free-text custom-model-id input
- Single-pane chat with user-right / assistant-left bubbles and live text.delta streaming
- Approval modal with unified-diff rendering for file edits, content preview for writes, and command preview for shell_run; scope chips for turn/session/project/global
- Session list with hover-reveal delete × in the sidebar; duplicate × + resume button in the session header
- Playwright smoke (`web-harness-shell.ts`) driving dashboard + providers + memory + a no-agent send→receive round-trip

Rules:

- no new routes in `services/harness` beyond what the CLI uses — pure parity
- web UI never imports `harness-core` directly; it is an HTTP client like CLI
- approval modal renders dry-run previews from the `permission.request` event payload
- SSE is the only streaming transport; mutations (approve/deny/cancel) go through the existing REST routes

Done when:

- `apps/web` loads against a running harness + API, creates a session (no-agent or local/cloud agent via the model picker), streams deltas into right/left chat bubbles, prompts for approval on an action tool, and applies the change
- `pnpm test:smoke:web` passes against a running harness + API + Vite dev
- Typecheck + full `pnpm run test:smoke` chain stay green (12/12 passing through Phase 3.4 + the new `web-harness-shell.ts`)

Deferred to 3.5.x:

- Read-only file tree scoped to the active project — no backend route exists yet for enumerating a project's file tree in one call; see the phase doc's Deviations section.

### Phase 3.5.1: Web UI QoL And Session Telemetry

Status: `Complete`

Goal:

Close the most visible alpha chat-surface rough edges without reopening transport or provider scope.

Build:

- untitled sessions auto-name from the first user message
- `GET /api/v1/sessions/:id` returns a `usage` snapshot with `inputTokens`, `outputTokens`, `contextTokens`, `contextWindow`, and `contextUtilization`
- `apps/web` renders session-level I/O totals and context occupancy in the session header
- the usage payload shape lives in `packages/harness-contracts`, not duplicated in the web app
- posting a message touches the session row so `updated_at` tracks actual chat activity

Rules:

- no new migration; reuse `harness_provider_calls.prompt_tokens` / `completion_tokens`
- no cost UI; pricing remains a later concern
- context occupancy is estimate-based via the existing `estimateTokens(...)` helper, not a provider-native tokenizer API
- explicit titles always win; auto-title only runs for untitled sessions

Done when:

- an untitled session acquires a normalized title from the first user message
- the session-detail route returns the shared usage snapshot
- the web session header shows I/O totals when available and context occupancy when known
- no-agent sessions still work cleanly with `inputTokens` / `outputTokens = null`
- `corepack pnpm run typecheck`, `test/smoke/harness-no-agent.ts`, and `test/smoke/harness-cloud-agent.ts` pass

Still deferred after 3.5.1:

- manual session rename UX
- turn-level usage/cost breakdowns
- read-only file tree scoped to the active project

### Phase 3.6: Investigation Composers (split into 3.6.0 + 3.6.1)

Phase 3.6 is the original master-plan composer scope — `cross_search`, `trace_rpc`, `trace_table`, `trace_file`, `trace_error`, `trace_edge`, `preflight_table`. An independent review (2026-04-16) against the shipped state of Roadmap 3 surfaced three high-severity substrate gaps. Rather than hide a substrate lift inside the composer phase, 3.6 splits into two sub-phases:

#### Phase 3.6.0: Substrate Lift

Status: `Complete` (shipped 2026-04-17)

Substrate work required to ship composers at full fidelity, plus the shared composer infrastructure and one tracer-bullet composer (`trace_file`) that proved the stack end-to-end.

Load-bearing decisions (see [./phases/phase-3.6.0-substrate-lift.md](./phases/phase-3.6.0-substrate-lift.md)):

- Composers **reuse `AnswerPacket`** — no parallel evidence contract.
- Composers are **snapshot-strict** — never touch the live DB.
- Composers follow a **five-layer architecture** (accessors / producers / composers / packet helpers / `defineComposer` factory).
- **AI SDK v4** is the current target (`ai: ^4.0.0` in `packages/harness-core`). Tool bridge uses `parameters:` naming.

Build:

- **Gap 1 - Harness tool-registry bridge.** `packages/harness-core/src/tool-bridge.ts` exposes `TOOL_DEFINITIONS` to `streamText` so agent turns can call any registered tool. Single-writer logging rule (bridge does not re-log).
- **Gap 2 - Indexer symbol chunking.** `web-tree-sitter` WASM + `tree-sitter-typescript`. Recursive AST chunker emits `symbol` chunks with file-level fallback, SQL-side `symbolOnly` filtering, and camelCase-aware `chunks.search_text` indexing.
- **Gap 3 - Schema body persistence.** Home-grown dollar-quote-aware extractor (~80 LOC, no library). Migration adds `body_text` to `schema_snapshot_rpcs` + `schema_snapshot_triggers` and creates `schema_snapshot_function_refs` edge table.
- **Shared composer infrastructure** - `_shared/context.ts`, `_shared/packet.ts`, `_shared/blocks.ts`, `_shared/ast-patterns.ts`, `_shared/define.ts`. Uses `@ast-grep/napi` for structural pattern matching.
- **Web UI** - `AnswerPacketCard.tsx` with Shiki syntax highlighting; `ToolCallCard` dispatches on answer-result shape.
- **`trace_file` tracer-bullet composer** - ships end-to-end to prove the stack.
- **Type surface** - `MAKO_TOOL_NAMES`, `ToolInput`, `ToolOutput`, `QueryKind` opened for composer extensions.
- **3.6.0.x follow-ups folded into phase close** - structural repo-SQL DDL parsing for repo-only snapshots, bundled CLI WASM assets, camelCase chunk search, and one-call table snapshot access via `ProjectStore.getSchemaTableSnapshot(schema, table)`.

New runtime deps (3.6.0 introduces all): `web-tree-sitter`, `tree-sitter-typescript`, `@ast-grep/napi`, `shiki`.

Done when:

- Agent turn can call `trace_file` mid-chat through `streamText` tool-calling.
- Web UI renders `trace_file` output as a styled evidence panel, not a JSON dump.
- `searchCodeChunks(term)` returns symbol-accurate line ranges.
- `listFunctionTableRefs({ tableName })` returns non-empty results on a real Supabase fixture.
- Four new smokes pass: `harness-calls-registry-tool`, `indexer-symbol-chunking`, `schema-snapshot-bodies`, `composer-trace-file`.

#### Phase 3.6.1: Investigation Composers (the remaining six)

Status: `Complete` (shipped 2026-04-17)

The six remaining composers - `preflight_table`, `cross_search`, `trace_edge`, `trace_error`, `trace_table`, `trace_rpc` - shipped on top of 3.6.0's substrate.

See [./phases/phase-3.6.1-investigation-composers.md](./phases/phase-3.6.1-investigation-composers.md) for the per-composer catalog (accessors used, ast-grep patterns, size estimates).

Per-composer sub-phase docs are written **only** when an algorithm outgrows the parent doc (likely: `trace_rpc`, `trace_table`).

Done when:

- All seven composers (trace_file from 3.6.0 + six from 3.6.1) register in `TOOL_DEFINITIONS` and return `AnswerPacket`s that pass `AnswerPacketSchema.parse`.
- Composer smokes pass end-to-end across CLI/HTTP/MCP/harness/web surfaces.
- Retrieval/correctness hardening lands for schema scoping, overload identity, trigger proof, and zod locality.

#### Phase 3.7: Semantic Retrieval Expansion

Status: `Complete` (shipped 2026-04-17)

Phase 3.7 expanded the Phase 3.3 embedding substrate from memory-only recall into semantic retrieval over repo-local docs, symbol-level code chunks, and existing memories.

Build:

- semantic-unit projection for symbol chunks and repo-local markdown docs
- `harness_semantic_units` + FTS read model
- semantic-unit embeddings stored through the existing `harness_embeddings` table
- explicit re-embed / reindex maintenance path
- new harness tool + CLI/API parity for semantic search

Done when:

- code/doc semantic units rebuild on project index
- semantic-unit and memory embeddings can be reindexed under the active model
- agents can run a provenance-preserving semantic search with `hybrid` / `fts-fallback` semantics
- Roadmap 3 has a real retrieval layer for code/docs before Roadmap 4 trust work begins

See [./phases/phase-3.7-semantic-retrieval-expansion.md](./phases/phase-3.7-semantic-retrieval-expansion.md).

#### Phase 3.8: Website Improvements

Status: `Complete` (shipped 2026-04-17)

Phase 3.8 turned the shipped web alpha into a project-aware operator surface. The dashboard at `/` now renders every attached project as a card or row (Vercel-style projects board with search, view toggle, and an Add new menu) rather than picking the first project as "the" project. A new `SelectedProjectProvider` hook owns the active project across `Home`, `Memory`, and `Search` and persists to `localStorage`. A new `/search` page exposes the shipped 3.7 retrieval surface (`GET /api/v1/semantic/search`) with kind chips, an optional project scope filter, and a mode banner labelling `hybrid` vs `fts-fallback`. The same page hosts the embeddings maintenance card (`POST /api/v1/embeddings/reindex`) for memory / semantic-unit / all reindexes. Memory got an explicit project scope toggle; the top bar got a project chip; the dev front door moved off the Vite defaults to `127.0.0.1:3019` (preview `:3020`) with `MAKO_WEB_PORT` overrides and no `strictPort` claim. Two new web smokes (`test/smoke/web-project-dashboard.ts`, `test/smoke/web-semantic-search.ts`) wire into `pnpm run test:smoke:web`.

See [./phases/phase-3.8-website-improvements.md](./phases/phase-3.8-website-improvements.md).

#### Phase 3.9: Model Layer

Status: `Complete` (shipped 2026-04-18)

See also: [Phase 3.9.1 Web Dashboard Polish](#phase-391-web-dashboard-polish) — the same-day follow-up that rebuilt the web dashboard's information architecture on top of 3.9's substrate.

Phase 3.9 turned the model layer from a hand-curated catalog into a live, cost-aware, locally-discoverable surface. Four pain points shared one fix: the bundled `BUNDLED_CATALOG` went stale within weeks of every mako release; the Providers page Local dropdowns showed what mako shipped knowing about, not what `ollama pull` actually installed; `provider_calls` rows recorded token counts but no cost; and there was no rollup view of which models the operator actually used. 3.9 landed a `models.dev` fetch with a bundled snapshot fallback (four-tier cache → fresh → snapshot → bundled composer; pattern lifted from opencode), wired `discoverOllamaModels` / `discoverLmStudioModels` into `GET /api/v1/providers` with a 30s cache and a `localProbe` status field, and extended `harness_provider_calls` with `reasoning_tokens / cache_read_tokens / cache_write_tokens / cost_usd_micro / caller_kind` (`"agent" | "chat"` meaning non-web agent/runtime origin vs Vite web-chat origin). New `GET /api/v1/catalog/{status,refresh}` and `GET /api/v1/usage` endpoints, a `/usage` web page + CLI mirror (`agentmako usage`, `agentmako catalog status|refresh`), and per-session cost chips + a 30-day project rolling cost surface the rollup. The phase also folded in four small web affordances that directly support operator clarity: per-session draft persistence with 250ms-debounced localStorage writes + `beforeunload` flush, a compact context meter near the composer with color-coded pressure, an inline provider-health banner, and latest-user-activity sorting in the session list. The 3.8 Defaults system, BYOK rule, and transport-agnostic core stayed untouched.

See [./phases/phase-3.9-model-layer.md](./phases/phase-3.9-model-layer.md).

#### Phase 3.9.1: Web Dashboard Polish

Status: `Complete` (shipped 2026-04-18)

Phase 3.9.1 is the same-day follow-up to 3.9 that lifts the web dashboard's information architecture to match the capability 3.8 + 3.9 already exposed. Same pattern as 3.5.1 after 3.5: close the most visible operator-surface rough edges without reopening transport, provider, or model-layer scope. Project scope is now URL-first (`/:slug/...`) with the URL as the single source of truth; `localStorage` collapses to a one-shot seed for the root redirect. Machine-global routes (`/providers`, `/usage`) are hoisted out of the slug tree so the route tree itself says which surfaces are per-project. A real portal-rendered project picker replaces the former TopBar link-and-chevron. The Providers page Defaults cards got a searchable combobox (portal-rendered so the card's `overflow-hidden` can't clip it) with keyboard nav, provider-icon annotations, and inline `no api key` / `unreachable` warnings. `ProjectCard` dropped the printed UUID in favor of the deep-link slug, added a `supportTarget` chip, and turned the canonical path into a clickable button backed by a new `POST /api/v1/projects/:id/reveal` endpoint that spawns the OS file manager (`explorer.exe` / `open` / `xdg-open`). The Providers page collapsed three paragraph-length subtitles into `title` tooltips and gained a signal-tinted `ADD API KEY` button. The mako wordmark moved from the top bar into the top of a full-height sidebar so the header no longer spans across the sidebar column. No schema changes; no harness-core or transport changes; the existing smoke chain stays green because `data-testid="topbar-project"` is retained on the new picker button.

See [./phases/phase-3.9.1-web-dashboard-polish.md](./phases/phase-3.9.1-web-dashboard-polish.md).

## Why These Phases Are In This Order

### Phase 3.0 before Phase 3.1

Because the harness spine must exist before provider integration has anywhere to land. A provider adapter without an agent loop is a dead letter.

### Phase 3.1 before Phase 3.2

Because action tools are most valuable in the cloud-agent and local-agent tiers — an LLM proposing edits with dry-run previews is the target UX. The permission model also gets stress-tested by real tool-calling traffic, not just synthetic calls.

### Phase 3.2 before Phase 3.3

Because embeddings are an optimization, not a prerequisite for editing. The mutation-and-approval story must be trustworthy before adding memory and semantic recall on top.

### Phase 3.3 before Phase 3.4

Because compaction is more valuable when memory exists — the summary of archived turns can be recalled semantically. Compaction against raw FTS alone works but degrades faster.

### Phase 3.4 before Phase 3.5

Because the web UI should be built against a session model that already supports resume and sub-agents. Shipping the UI on a thinner session model would lock in UX assumptions that later phases would have to retrofit.

### Phase 3.5 before Phase 3.6

Because transport parity is an acceptance test for the whole roadmap. Composers built after the web UI exists can be validated from day one in two transports (CLI and web) plus MCP. Composers built before the web UI would only be validated in CLI and MCP and would risk assumptions the web UI then has to work around.

### Phase 3.6 before Phase 3.7

Because semantic retrieval should build on top of the shipped lexical/AST composer baseline, not race it. We need the composer family working first so 3.7 improves a real substrate instead of an imagined one.

### Phase 3.7 before Roadmap 4

Because trust features are only as good as the retrieval surface they compare. If repo-local docs and symbol chunks are still invisible to embeddings, Roadmap 4 starts from a weaker evidence base than it needs to.

## Dependencies And Co-Development

- Phase 3.0 and Phase 3.1 can overlap at the contract level (ProviderSpec / ModelSpec schemas can be defined alongside the session schemas), but implementation is sequential.
- Phase 3.2 depends on both 3.0 and 3.1 landing — the permission model is defined against a live agent loop, not a planned one.
- Phase 3.3 depends on 3.0 (session substrate, store, tool registration seam), 3.1 (provider registry and layered key resolution — the embedding resolver reuses this pattern verbatim), and 3.2 (`ToolDispatch` — memory tools register into the same tools map that action tools use, though they bypass the permission flow by design).
- Phase 3.4 depends on 3.0 (session substrate, `harness_session_events`, `SessionEventBus`), 3.1 (the summarization call rides the active provider through `createLanguageModel` + layered key resolution), 3.2 (permission decisions are inherited across parent → child via the engine; `SUB_AGENT_TOOLS` registers into the same `ToolDispatch.tools` map), and optionally 3.3 (compaction summaries may later be promoted to memories via `recallMemories`, though auto-promotion is out of scope in 3.4).
- Phase 3.5 depends on 3.4 for the session UX it renders.
- Phase 3.5.1 depends on 3.1 (persisted provider usage), 3.4 (`estimateTokens(...)`), and 3.5 (the web client and session-detail route it refines).
- Phase 3.6 depends on 3.0–3.5.1 being real enough that composers plug into a fully proven harness.
- Phase 3.7 depends on 3.3 (embedding substrate), 3.6.0 (symbol chunks), and 3.6.1 (lexical/AST investigation baseline).

Rule:

- be strict about coupling, not artificially waterfall by default

## Guardrails

- keep Roadmap 1 and Roadmap 2 public surfaces working while this roadmap lands
- do not host shared model keys under any circumstance
- do not ship any harness feature that only works in one tier when the no-agent tier can reasonably support it
- do not couple `packages/harness-core` to HTTP, SSE, stdio, or any transport
- do not mutate the filesystem outside the active project root without an explicit project-local override
- do not store plaintext secret values in `project.db` or `global.db`
- do not bypass the tool registry or its logging hook
- do not introduce ranking, contradiction detection, or learned routing in this roadmap — that is Roadmap 4

## Concrete Non-Goals

- shared key hosting or billing
- contradiction engine and ranking engine
- trust signal surfacing to agents
- continuous live DB sync
- row-data ingestion
- publishing the web UI publicly in Phase 3.5 (it is an alpha)
- multi-user collaborative editing
- browser extension or IDE extension front-ends

## Verification Matrix

- `agentmako chat` works in no-agent, local-agent, and cloud-agent tiers
- `agentmako tier` accurately reports current tier and upgrade path
- `agentmako providers test <id>` succeeds against every first-party provider when its key is present
- `agentmako keys set <provider> --prompt` round-trips through the system keychain
- provider fallback chain recorded in `provider_calls` when primary fails
- cloud-agent session can propose a mutation, emit a permission request with dry-run preview, receive a decision, apply the change, and log it to `tool_runs`
- `agentmako undo` restores from snapshot
- `memory_recall` returns results via embeddings when the embedding provider is healthy and via FTS when it is not
- parent session can spawn a child and receive the result as a `tool_result`
- mid-stream kill + `agentmako session resume` produces identical final state
- `apps/web` renders an end-to-end chat-plus-edit flow through the same routes the CLI uses
- each Phase 3.6 composer ships with a smoke test
- semantic search can return repo-local code/doc/memory hits with provenance and FTS fallback
- semantic-unit / memory reindex works under the active embedding model

## Where To Begin

Roadmap 3 is complete. If you need the final ship state before opening Roadmap 4, start with:

- [./handoff.md](./handoff.md) — Roadmap 3 ship state and what carries forward
- [./phases/phase-3.9.4-cleanup-and-polish.md](./phases/phase-3.9.4-cleanup-and-polish.md) — final cleanup/refactor pass and actual Roadmap 3 close-out
- [./phases/phase-3.9.3-tool-surface-evaluation.md](./phases/phase-3.9.3-tool-surface-evaluation.md) — final validation and retrieval hardening that 3.9.4 cleaned up after
- [./phases/phase-3.9.2-tool-surface-planning.md](./phases/phase-3.9.2-tool-surface-planning.md) — planner-backed exposure seam that 3.9.3 validated
- [./phases/phase-3.9.1-web-dashboard-polish.md](./phases/phase-3.9.1-web-dashboard-polish.md) — most recent large UI ship doc before the close-out slices
- [./phases/phase-3.9-model-layer.md](./phases/phase-3.9-model-layer.md) — prior ship doc (model-layer substrate 3.9.1 consumes)
- [../../master-plan.md](../../master-plan.md) — Roadmap 4 (Trust Layer) framing lives here until a `version-4/` doc set opens

Reuse the shipped:

- `packages/tools/src/ask/` — verbatim as the no-agent tier routing brain
- `packages/tools/src/registry.ts` — new tools register into this
- `packages/tools/src/tool-invocation-logging.ts` — reused for all harness-driven tool calls
- `packages/store/src/project-store-tool-runs.ts` — `tool_runs` writes reused
- `packages/store/src/project-store-lifecycle.ts` — `lifecycle_events` reused with new event kinds
- `packages/store/src/migration-sql.ts` — migration runner reused
- `services/api/src/server-utils.ts` — origin validation pattern copied to `services/harness`
- `packages/tools/src/project-resolver.ts` — layered project resolution reused for session project binding
- the existing MCP/HTTP/tool surface from Roadmaps 1 and 2
