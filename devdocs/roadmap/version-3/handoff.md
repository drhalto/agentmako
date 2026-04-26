# Roadmap Version 3 Handoff

This file is the execution handoff for Roadmap Version 3.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-2/roadmap.md](../version-2/roadmap.md)
- [../version-2/handoff.md](../version-2/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Roadmap Intent

Roadmap 3 is not the `many new tools` roadmap.

Roadmap 3 is the `agent layer` roadmap that turns mako from a catalog of deterministic tools into a drivable engine — without abandoning the deterministic substrate and without coupling the core to any one transport.

The implementation goal is to leave the repo with:

- a transport-agnostic agent harness in `packages/harness-core`
- session, message, part, event, permission, and provider-call persistence in `project.db`
- a BYOK multi-provider layer through the Vercel `ai` SDK
- action tools with declarative permissions, dry-run previews, and snapshot-backed undo
- a separate embedding provider axis with local-first defaults and FTS fallback
- sub-agents, compaction, and resume
- an HTTP + SSE transport service (WebSocket was scoped out at implementation time — SSE + REST mutations cover the same capabilities without the framework coupling; see Phase 3.5)
- a browser client that proves transport parity
- the original Roadmap 3 composer family as consumers of the harness

## Current Implementation Target

**Roadmap 3 is complete.** Phases 3.0–3.5.1, 3.6.0, 3.6.1, 3.7, 3.8, 3.9, 3.9.1, 3.9.2, 3.9.3, and 3.9.4 have all shipped. The next work should open under Roadmap 4 (Trust Layer), not as another Phase 3 tool-surface rewrite.

**Phases 3.0–3.5.1 are complete.** The harness core + no-agent tier + session-persistence spine (3.0); BYOK provider layer with seven extensions, keychain key resolution, and fallback chains (3.1); the six action tools + declarative permission engine + snapshot-backed undo (3.2); the separate embedding axis with `harness_memories` + `harness_embeddings`, Ollama / LM Studio / OpenAI adapters, hybrid FTS5 + vector search with RRF, and graceful FTS-only fallback (3.3); `sub_agent_spawn` + context-window-triggered compaction + event-replay resume with the `harness_version` fence (3.4); the React + Vite + Tailwind v4 browser client — dashboard, session chat with live SSE streaming, model picker, approval modal with unified-diff preview, memory + providers surfaces, Playwright shell smoke (3.5); and the narrow QoL follow-up for session auto-titles, session-level input/output token totals, and context-window occupancy in the web chat header (3.5.1) — all shipped.

**Phase 3.6 Investigation Composers has been split into 3.6.0 + 3.6.1.** An independent review (2026-04-16) against the shipped substrate identified three high-severity gaps: the harness did not bridge `TOOL_DEFINITIONS` to `streamText`, the indexer wrote one chunk per file (no line-level FTS evidence), and schema-snapshot bodies were not persisted. Rather than absorb a substrate lift into the composer phase, 3.6 now has two sub-phases.

**Phase 3.6.0 Substrate Lift ([./phases/phase-3.6.0-substrate-lift.md](./phases/phase-3.6.0-substrate-lift.md)) is complete.** It shipped the harness tool-registry bridge (Gap 1), indexer symbol-level chunking via `web-tree-sitter` (Gap 2), schema body persistence + overload-aware `schema_snapshot_function_refs` edges (Gap 3), the shared composer infrastructure (`_shared/context.ts`, `_shared/packet.ts`, `_shared/blocks.ts`, `_shared/ast-patterns.ts`, `_shared/define.ts`), the `AnswerPacketCard` web component with Shiki highlighting, and `trace_file` as the tracer-bullet composer. Phase close also folded in the 3.6.0.x follow-ups: structural repo-SQL DDL parsing for repo-only snapshots, bundled CLI WASM assets, camelCase-aware chunk search, `ProjectStore.getSchemaTableSnapshot(schema, table)`, and constructor backfill for the hardened function-ref read model. New runtime deps: `web-tree-sitter`, `tree-sitter-typescript`, `@ast-grep/napi`, `shiki`.

**Phase 3.6.1 Investigation Composers ([./phases/phase-3.6.1-investigation-composers.md](./phases/phase-3.6.1-investigation-composers.md)) is complete.** It shipped the remaining six composers — `preflight_table`, `cross_search`, `trace_edge`, `trace_error`, `trace_table`, `trace_rpc` — on top of 3.6.0 substrate, plus nine schema-IR / retrieval-layer evidence-block producers in `_shared/blocks.ts` and six input/output schemas in `@mako-ai/contracts`. All six composers follow the `TraceFileToolInput/Output` pattern and reuse shared contract types exclusively; no local shape redefinition. Each is ~40-130 LOC of pure orchestration. Ast-grep is the structural-proof layer (`$C.from('$TABLE')`, `$C.rpc('$FN')`, `throw new $ERR($MSG)`, etc.); FTS (plus `searchFiles` LIKE fallback on camelCase-heavy terms) is the retrieval layer. The phase later received correctness hardening around schema-scoped table refs, overload-aware `trace_rpc`, executable-body proof for trigger hits, and zod locality filtering. Verification remains `corepack pnpm typecheck` clean plus `corepack pnpm run test:smoke` green.

**Phase 3.7 Semantic Retrieval Expansion ([./phases/phase-3.7-semantic-retrieval-expansion.md](./phases/phase-3.7-semantic-retrieval-expansion.md)) is complete.** It shipped the semantic-unit read model (`harness_semantic_units` + FTS), `semantic_unit` embedding ownership in the existing `harness_embeddings` table, symbol/doc projection on `project index`, heading-aware markdown chunking, hybrid semantic retrieval over code/doc/memory units, and explicit `semantic search` / `embeddings reindex` surfaces through harness-core, HTTP, and CLI. Verification at ship time is `corepack pnpm run typecheck` clean plus `corepack pnpm run test:smoke` green.

**Phase 3.8 Website Improvements ([./phases/phase-3.8-website-improvements.md](./phases/phase-3.8-website-improvements.md)) is complete (shipped 2026-04-17).** It rebuilt the dashboard at `/` as a Vercel-style projects board (search + grid/list toggle + Add new menu), introduced a shell-wide `SelectedProjectProvider` hook that scopes Home, Memory, and Search to the active project, and added a new `/search` page hitting the shipped 3.7 `GET /api/v1/semantic/search` route plus an embeddings-maintenance card hitting `POST /api/v1/embeddings/reindex`. Per-project re-index / detach / "new session here" actions live on `ProjectCard`'s kebab menu. Memory got a project scope toggle and the top bar got a project chip. The dev front door moved off the Vite defaults to `127.0.0.1:3019` (preview `:3020`) with `MAKO_WEB_PORT` overrides and no `strictPort` claim. Two new web smokes ship: `test/smoke/web-project-dashboard.ts` and `test/smoke/web-semantic-search.ts`, both wired into `pnpm run test:smoke:web` alongside the updated `web-harness-shell.ts`. Verification at ship time is `corepack pnpm run typecheck` clean.

**Phase 3.9.1 Web Dashboard Polish ([./phases/phase-3.9.1-web-dashboard-polish.md](./phases/phase-3.9.1-web-dashboard-polish.md)) is complete (shipped 2026-04-18).** Same-day follow-up to 3.9 that lifts the web dashboard IA onto the 3.8 + 3.9 substrate. Project scope is now URL-first: routes mount under `/:slug/...` (e.g. `/forgebench/agent/<sessionId>`), with `computeSlugMap(projects)` deriving a kebab-case slug from `displayName` and disambiguating collisions with a 6-char id suffix. The reserved `all` slug stays available for unscoped aggregation. Machine-global routes (`/providers`, `/usage`) are hoisted out of the slug tree — a single layout `<Route>` wraps both, so a single `Shell` instance persists across global ↔ scoped navigation. `SelectedProjectProvider` is gone; `useSelectedProject` is now a route-aware hook exposing `effectiveSlug`, `scopedPath(path)` (respects the `GLOBAL_ROUTE_PREFIXES` allowlist), and `selectProject(id)` that preserves the sub-path on scoped routes and jumps to the new project's dashboard on global ones. `<ProjectRedirect />` mounts at `/` and `*` to resolve unslugged paths to `/<stored-or-first-slug>/...`. `localStorage` collapses to a one-shot seed for that redirect; no other surface reads it. The TopBar's former `<Link>` project chip becomes a portal-rendered picker with keyboard nav (`ArrowDown`/`Enter` open, `Escape` close, `ArrowUp`/`ArrowDown` navigate) and retains `data-testid="topbar-project"` so the smoke chain stays green. The Providers page Defaults cards got a searchable combobox (`ModelCombobox` in `apps/web/src/components/AxisDefaultsCard.tsx`) — portal-rendered via `createPortal(…, document.body)` with fixed positioning anchored to the trigger's `getBoundingClientRect`, filtered live by provider/model id + display name, with `ProviderIcon` annotations and inline `no api key` / `unreachable` chips. `ProjectCard` redesigned: dropped the printed UUID in favor of a subtle `/<slug>` hint, added a `supportTarget` mono chip, turned the canonical path into a `<button>` with a folder icon + hover-revealed external-link arrow, strengthened the selected state (`shadow-[inset_3px_0_0_var(--color-mk-signal)]` + tinted background + `current scope` label), and added an `Open folder` kebab entry alongside hover-revealed `open →` on non-selected cards. New `POST /api/v1/projects/:projectId/reveal` endpoint in `services/api/src/routes/projects.ts` spawns the OS file manager detached (`explorer.exe` / `open` / `xdg-open`) and returns; wired from the card's path click and kebab menu. Providers page IA collapsed three paragraph-length subtitles into `title` tooltips, dropped the redundant `BYOK · local + cloud` chip, tinted the `ADD API KEY` button with the signal color, and swapped `lmstudio` in `ProviderIcon` to the real glyph (`apps/web/public/ai-providers/lmstudio.svg`) instead of falling back to the OpenAI mark. Shell layout flipped from `rows-[52px_1fr]` to `cols-[224px_1fr]` with the `mako` wordmark + brand mark moved into a 52px block at the top of the full-height sidebar; the TopBar now occupies the right column only. No migration. No changes to `harness_provider_calls` or any harness-core telemetry. Verification at ship time is `corepack pnpm run typecheck` clean plus the existing Playwright smoke chain green.

**Phase 3.9.2 Tool Surface Planning ([./phases/phase-3.9.2-tool-surface-planning.md](./phases/phase-3.9.2-tool-surface-planning.md)) is complete (shipped 2026-04-18).** It introduced the shared exposure-planning seam over the shipped registry/native tool families. Harness chat, API, and MCP now consume the same immediate/deferred/blocked truth, `tool_search` is the discoverability seam for deferred/blocked MCP tools, and project-bound DB tools are blocked honestly when there is no usable live DB binding.

**Phase 3.9.3 Tool Surface Evaluation ([./phases/phase-3.9.3-tool-surface-evaluation.md](./phases/phase-3.9.3-tool-surface-evaluation.md)) is complete (shipped 2026-04-18).** It validated the live tool surface against real MCP/direct-tool and seeded-defect workflows, fixed the `auth_path` MCP schema contract, kept `ask` first-class on MCP/API, and hardened `cross_search` for symptom-style debugging questions with source-first ranking, natural-language identifier variants, exact schema-term gating, and lower-noise evidence. 3.9.3 closed the substantive tool-surface work and set up the final cleanup-only follow-up.

**Phase 3.9.4 Cleanup And Polish ([./phases/phase-3.9.4-cleanup-and-polish.md](./phases/phase-3.9.4-cleanup-and-polish.md)) is complete (shipped 2026-04-18).** It stayed intentionally narrow: shared the `tool_search` catalog-entry and reason-formatting helpers between harness and MCP, removed duplicated registry-to-search-catalog mapping, and cleaned temporary seeded-eval residue from the repo root. This is the actual Roadmap 3 close-out phase.

**Phase 3.9 Model Layer ([./phases/phase-3.9-model-layer.md](./phases/phase-3.9-model-layer.md)) is complete (shipped 2026-04-18).** It replaced the hand-curated `BUNDLED_CATALOG` with a `models.dev` fetch (four-tier composer: cache → fresh → snapshot → bundled; lift-and-adapt of opencode's pattern), wired the existing `discoverOllamaModels` / `discoverLmStudioModels` helpers in `extensions/{ollama,lmstudio}/src/index.ts` into `GET /api/v1/providers` (30s TTL cache, `localProbe` status field, daemon-installed model ids override `spec.models[]` on success), and extended `harness_provider_calls` with `reasoning_tokens / cache_read_tokens / cache_write_tokens / cost_usd_micro / caller_kind` (`"agent" | "chat"` meaning non-web agent/runtime origin vs Vite web-chat origin). New endpoints: `GET /api/v1/catalog/status`, `POST /api/v1/catalog/refresh`, `GET /api/v1/usage?since=&group_by=&project_id=`. New CLI commands: `agentmako catalog status|refresh`, `agentmako usage [--days N] [--project ID] [--group-by ...]`. New `/usage` web page; Providers page renders a "Catalog: <source> · refreshed Xm ago" line with a Refresh button; Session header shows a cost chip when known; project status responses carry `costUsdMicro30d`. Web session affordances shipped: per-session draft persistence (250ms-debounced localStorage write + `beforeunload` flush; clears on successful send), a compact context meter near the composer (colors at 70% / 90% pressure; now surfaces cache and reasoning tokens when present), an inline provider-health banner (cross-references the session's active provider against `/api/v1/providers` and surfaces unreachable-daemon / missing-key / vanished-model states), and latest-user-activity session sorting. Build-time `apps/cli/scripts/snapshot-models.ts` refreshes the committed `packages/harness-contracts/models/snapshot.json`; tsup's `onSuccess` hook copies the snapshot into `apps/cli/dist/models-snapshot.json` so the published CLI bundle ships with it. Migration 0017 is additive: existing rows default `caller_kind = 'chat'`. Verification at ship time is `corepack pnpm run typecheck` clean plus `corepack pnpm run test:smoke` green (four new deterministic smokes: `harness-catalog-source`, `harness-local-discovery`, `harness-cost-recording`, `harness-usage-aggregation`; `web-session-affordances` ships as a playwright smoke on the `test:smoke:web` chain).

Two load-bearing decisions carry through both sub-phases: composers **reuse `AnswerPacket`** (no parallel evidence contract — one shape across all tools, persisted via `saveAnswerTrace`), and composers are **snapshot-strict** (never open a live DB connection — the existing `db_*` tools stay in their own lane). Target AI SDK major is **v4** — the tool bridge uses `parameters:` naming, not v5's `inputSchema:`.

All subsequent phases plug into the 3.0–3.5.1 substrate. Each phase doc carries a `Deviations From Spec At Ship Time` section — Phase 3.6 should read 3.0-3.5.1's deviation lists before opening any file (they describe the actual current substrate, not the original drafts). Notable Phase 3.5 / 3.5.1 follow-ups: SSE-only transport (no WebSocket shipped); SSE envelope reshape from named events to unnamed `{ sessionId, ordinal, createdAt, event: {...} }`; `Harness.postMessage` now emits a `text.delta` for user messages so stream-first clients can render them; `GET /api/v1/sessions/:id` now returns a shared `usage` snapshot with input/output token totals and context occupancy; untitled sessions auto-name from the first user prompt; read-only file tree remains deferred because no backend route exists yet for enumerating a project's file tree in one call.

## Working Principle

Roadmap 3 should build the agent layer on top of the deterministic substrate, not alongside it.

The main question for each change should be:

Does this add agency over the existing substrate without breaking the no-agent tier, coupling the core to a transport, or compromising the BYOK rule?

If the answer is no, it probably does not belong in Roadmap 3.

## Required References

Read these before changing Roadmap 3 code:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [./phases/phase-3.0-harness-foundation.md](./phases/phase-3.0-harness-foundation.md)
- [./phases/phase-3.1-provider-layer.md](./phases/phase-3.1-provider-layer.md)
- [./phases/phase-3.2-action-tools-and-permissions.md](./phases/phase-3.2-action-tools-and-permissions.md)
- [./phases/phase-3.3-embeddings-and-memory.md](./phases/phase-3.3-embeddings-and-memory.md)
- [./phases/phase-3.4-subagents-compaction-resume.md](./phases/phase-3.4-subagents-compaction-resume.md)
- [./phases/phase-3.5-web-ui-alpha.md](./phases/phase-3.5-web-ui-alpha.md)
- [./phases/phase-3.5.1-web-ui-qol-and-session-telemetry.md](./phases/phase-3.5.1-web-ui-qol-and-session-telemetry.md)
- [./phases/phase-3.6.0-substrate-lift.md](./phases/phase-3.6.0-substrate-lift.md)
- [./phases/phase-3.6.1-investigation-composers.md](./phases/phase-3.6.1-investigation-composers.md)
- [./phases/phase-3.7-semantic-retrieval-expansion.md](./phases/phase-3.7-semantic-retrieval-expansion.md)
- [./phases/phase-3.8-website-improvements.md](./phases/phase-3.8-website-improvements.md)
- [./phases/phase-3.9-model-layer.md](./phases/phase-3.9-model-layer.md)
- [./phases/phase-3.9.1-web-dashboard-polish.md](./phases/phase-3.9.1-web-dashboard-polish.md)
- [./phases/phase-3.9.4-cleanup-and-polish.md](./phases/phase-3.9.4-cleanup-and-polish.md)
- [../version-2/handoff.md](../version-2/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Existing Surfaces To Reuse

Do not rebuild these from scratch:

- `packages/tools/src/ask/` — no-agent tier routing brain
- `packages/tools/src/registry.ts` — new tools register here, not in a parallel registry
- `packages/tools/src/tool-definitions.ts` — new tool definitions go here
- `packages/tools/src/tool-invocation-logging.ts` — reused for every harness-driven tool call
- `packages/tools/src/project-resolver.ts` — reused for session project binding
- `packages/store/src/project-store.ts` and split helpers (`project-store-tool-runs`, `project-store-lifecycle`, etc.) — reused for all new persistence
- `packages/store/src/global-store.ts` — reused for any global-scoped state
- `packages/store/src/migration-sql.ts` — reused for new migrations
- `packages/contracts/src/` — imported by harness contracts; session types extend existing tool-input/tool-output patterns
- `services/api/src/server-utils.ts` — origin validation pattern copied to `services/harness`
- `services/api/src/mcp.ts` — extended to surface `requiresApproval` metadata
- `apps/cli/src/commands/` — new commands follow the same modular dispatcher pattern
- existing Roadmap 1 and 2 MCP/HTTP/tool surfaces

Roadmap 3 should extend these seams rather than replace them casually.

## Constraint Set

### 1. Keep Roadmaps 1 And 2 Working

The shipped substrate still matters.

Do not break:

- `project attach` / `detach` / `status` / `index`
- `connect` cold-start flow and its keychain and env strategies
- schema snapshot and live DB refresh flows
- the MCP, HTTP, and CLI tool surfaces
- `lifecycle_events` / `tool_runs` / `tool_usage_stats` / benchmark tables and their immutability guarantees
- public docs unexpectedly

### 2. BYOK Only

`mako-ai` does not host model keys.

The harness:

- reads keys from explicit args, session overrides, project config, global config, env, and system keychain
- never embeds keys into committed files
- never proxies requests through a mako-operated service
- supports `{env:VAR_NAME}` indirection so config files reference env instead of holding secrets

If a design would require hosting keys, it does not belong in Roadmap 3.

### 3. No-Agent Tier Is A Product

The no-agent tier must stay fully valuable with zero model configured.

Every harness feature must declare which tiers it supports. Features that only work in local-agent or cloud-agent must still leave the no-agent tier functional — they degrade or surface a clear `TierInsufficientError` with an upgrade hint.

### 4. Transport-Agnostic Core

`packages/harness-core` must not import:

- anything from `services/*`
- Hono, Express, or any other HTTP framework
- `node:http`, `node:net`, or any transport-level API
- `@modelcontextprotocol/sdk`
- terminal libraries

The CLI, HTTP server, MCP extensions, and the Phase 3.5 web UI are adapters. If a capability exists in one adapter, it must be expressible in every other adapter that makes semantic sense.

### 5. Permission Model Is Declarative And UI-Decoupled

The permission evaluator does not know what UI is rendering it. It emits `permission.request { id, tool, args, preview }` events on the session bus. CLI prints a prompt. Web UI renders a modal. MCP returns `requiresApproval: true`. External MCP clients handle their own prompts.

Rules live in `.mako/permissions.json` (project) and `~/.mako/permissions.json` (global). `deny` always beats `allow`. More-specific rules beat more-general rules.

### 6. Action Tools Are Audited And Reversible

Every filesystem-mutating tool:

- attaches a dry-run preview (unified diff or proposed content) to the approval request
- writes a before-state snapshot under `storage/snapshots/<session_id>/<message_ordinal>/`
- records the snapshot id on the `tool_run`
- is reversible via `agentmako session undo <session> <ordinal>`

`shell_run` snapshots are best-effort — we capture stdout/stderr and the command/cwd/env, but we do not promise filesystem revert for arbitrary shell commands.

### 7. Provider Layer Is Pluggable By Config

Adding a new OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, any custom endpoint) must require only a config entry in `.mako/providers.json` or `~/.mako/providers.json`.

First-party extensions (`anthropic`, `openai`, `moonshot`, `ollama`, `ollama-cloud`, `openai-compatible`, `lmstudio`) live under `extensions/` and ride the ai SDK.

### 8. Embeddings Are Separate From Chat

`defaults.embedding.provider` resolves independently of `defaults.chat.provider`.

Changing embedding models must not corrupt stored vectors. Recall scopes by model. FTS-only fallback must always return something when a query matches — never a hard error because an embedding provider is down.

### 9. SQLite Stays Authoritative

All session, message, part, permission-decision, provider-call, memory, and embedding state lives in `project.db`. No new datastores.

Vectors are stored as raw Float32 BLOBs and scored in Node via cosine; Phase 3.3 did NOT load `sqlite-vec`. The BLOB layout leaves room for a future `vec0` virtual-table optimization without schema changes — still SQLite, still append-only.

## Phase Sequence

1. `Phase 3.0` — harness foundation
2. `Phase 3.1` — provider layer
3. `Phase 3.2` — action tools and permission model
4. `Phase 3.3` — embeddings and semantic memory
5. `Phase 3.4` — sub-agents, compaction, and resume
6. `Phase 3.5` — web UI alpha
7. `Phase 3.6` — investigation composers
8. `Phase 3.7` — semantic retrieval expansion
9. `Phase 3.8` — website improvements
10. `Phase 3.9` — model layer (models.dev catalog + local discovery + cost/usage telemetry)
11. `Phase 3.9.1` — web dashboard polish (URL-first scope, global/scoped route split, portal pickers, project reveal)
12. `Phase 3.9.2` — tool surface planning (planner-backed exposure truth for harness + MCP/API)
13. `Phase 3.9.3` — tool surface evaluation (live validation + final retrieval hardening)
14. `Phase 3.9.4` — cleanup and polish (shared planner/search-catalog cleanup + Roadmap 3 close-out)

Do not skip phase order without updating the roadmap docs.

## What The Implementation Agent Should Produce

By the end of Roadmap 3, the implementation should leave behind:

- `packages/harness-core`, `packages/harness-contracts`, and `packages/harness-tools` as stable TypeScript packages
- `services/harness` as a running service on `127.0.0.1:3018` with HTTP + SSE routes (no WebSocket — see Phase 3.5 decision)
- a session persistence layer in `project.db` with append-only event logs and immutability triggers
- a BYOK provider layer with keychain, env, and config resolution and fallback chains
- an action tool family with declarative permissions, dry-run previews, and snapshot-backed undo
- an embedding layer with local-first defaults and FTS fallback
- sub-agents, compaction, and resume
- a browser client that drives the harness over the transport service
- the investigation composer family consuming the harness
- an updated master-plan and aligned version-3 roadmap, handoff, and phase docs

## What The Implementation Agent Should Not Do

Do not pull these forward into Roadmap 3 unless the roadmap itself is revised:

- hosted shared model keys
- central billing or rate-limiting
- trust signal surfacing to agents (ranking, contradiction, drift notices)
- continuous live DB sync
- row-data ingestion
- multi-user collaborative editing
- browser extension or IDE extension frontends
- learned routing or ML-driven tool selection
- Roadmap 4 scope (persistent investigation packet memory with trust comparison)
- Roadmap 5 scope (AI layer that operates the substrate autonomously)

## Expected CLI Direction

Roadmap 3 adds these commands on top of the existing `agentmako` surface:

- `agentmako chat` — interactive REPL, auto-tier
- `agentmako chat --message "..."` — one-shot turn
- `agentmako session list|show|resume|rm`
- `agentmako providers list|add|remove|test`
- `agentmako keys set <provider> [--from-env VAR | --prompt]`
- `agentmako tier` — diagnose current tier and upgrade path
- `agentmako undo <session> <ordinal>` — restore snapshot
- `agentmako semantic search <query>` — semantic retrieval over code/doc/memory units (Phase 3.7)
- `agentmako embeddings reindex` — rebuild semantic embeddings for local state (Phase 3.7)

All new commands route through the HTTP API at `http://127.0.0.1:3018` (or the configured harness endpoint). CLI must not import `harness-core` directly — this is the acceptance test for the transport boundary.

## Expected Web UI Role

The Phase 3.5 web UI is the transport-parity proof point for Roadmap 3.

Every capability that exists in CLI must be reachable in the web UI through the same routes. No new harness routes are added for the web UI that do not also serve the CLI.

The web UI is shipped as an alpha in `apps/web`. It is not a public product in Roadmap 3 — it is an internal validation that the transport is honest.

## Documentation Rule

If implementation reveals a better pattern that materially changes Roadmap 3:

- update the Roadmap 3 docs deliberately
- keep the changes coherent across roadmap, handoff, and phase docs
- if the change is large enough, create a new documentation branch/version instead of silently reshaping the roadmap in place

## Immediate Starting Files

Roadmap 3 is fully closed. The next work should start in `devdocs/master-plan.md` and stand up `devdocs/roadmap/version-4/` mirroring the version-3 doc set.

**Final close-out state (read these first before opening Roadmap 4 work):**

- `devdocs/roadmap/version-3/phases/phase-3.9.4-cleanup-and-polish.md` (final cleanup/refactor pass and actual Roadmap 3 close-out)
- `devdocs/roadmap/version-3/phases/phase-3.9.3-tool-surface-evaluation.md` (final validation + retrieval hardening)
- `devdocs/roadmap/version-3/phases/phase-3.9.2-tool-surface-planning.md` (planner-backed exposure seam shipped immediately before 3.9.3)
- `devdocs/roadmap/version-3/phases/phase-3.9.1-web-dashboard-polish.md` (most recent large UI ship doc)
- `devdocs/roadmap/version-3/phases/phase-3.9-model-layer.md` (prior ship doc — 3.9.1 consumes 3.9's model-layer substrate)
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md` (this file)
- `devdocs/roadmap/version-3/phases/phase-3.8-website-improvements.md` (the projects-board + `SelectedProjectProvider` shipped here; 3.9.1 rebuilt the scope layer on top)
- `devdocs/roadmap/version-3/phases/phase-3.1-provider-layer.md` (the catalog + key-resolution substrate 3.9 extended)

**Primary web surfaces touched by 3.8 — last-modified context for the next phase:**

- `apps/web/src/App.tsx` (route table now mounts `/agent` + back-compat redirect from `/sessions/:id`)
- `apps/web/src/components/Shell.tsx` (single-column nav; session list moved out)
- `apps/web/src/components/TopBar.tsx` (project pill + slash-joined breadcrumb + right-edge tier)
- `apps/web/src/components/ProjectCard.tsx`
- `apps/web/src/components/AttachProjectModal.tsx`
- `apps/web/src/components/SessionListNav.tsx` (now lives inside `/agent` rail; links use `/agent/:id`)
- `apps/web/src/hooks/useSelectedProject.tsx`
- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Agent.tsx` (new — agent route shell with left rail + chat pane)
- `apps/web/src/pages/Session.tsx` (renders inside Agent when a `:sessionId` is present; delete navigates to `/agent`)
- `apps/web/src/pages/Search.tsx`
- `apps/web/src/pages/Memory.tsx`
- `apps/web/vite.config.ts`
- `apps/web/package.json`
- `apps/cli/src/commands/dashboard.ts` (new — `agentmako dashboard` launcher)
- `apps/cli/src/index.ts` and `apps/cli/src/shared.ts` (dispatch + help text)
- `apps/cli/package.json` (added `@mako-ai/harness`, `@ast-grep/napi`, `web-tree-sitter`, `tree-sitter-typescript` runtime deps)
- `apps/cli/tsconfig.json` (added `services/harness` project reference)
- `apps/cli/tsup.config.ts` (added native modules to externals)
- `services/harness/src/server.ts`
- `services/api/src/routes/projects.ts`

**Shipped retrieval surfaces 3.8 consumes (do not redesign blindly):**

- `packages/harness-core/src/semantic-search.ts`
- `packages/harness-core/src/semantic-tools.ts`
- `apps/cli/src/commands/semantic.ts`
- `apps/cli/src/commands/embeddings.ts`

**Surfaces 3.9 shipped (highest-traffic first):**

- `packages/store/src/migration-sql.ts` (migration `0017_provider_calls_usage`)
- `packages/store/src/project-store-harness.ts` (provider-call insert path accepts the new columns)
- `packages/harness-core/src/harness.ts` (`recordProviderCall` plumbs caller-kind + cost computation)
- `packages/harness-contracts/src/models-dev.ts` (typed catalog source)
- `packages/harness-contracts/models/snapshot.json` (committed snapshot fallback)
- `packages/harness-core/src/catalog-source.ts` (four-tier composer)
- `packages/harness-core/src/cost.ts` (rate lookup + micro-USD computation)
- `packages/harness-core/src/usage-aggregation.ts` (group-by rollups)
- `services/harness/src/server.ts` (`/api/v1/providers` local discovery, `/api/v1/catalog/*`, `/api/v1/usage`)
- `services/api/src/routes/projects.ts` (per-project 30d cost on status response)
- `services/api/src/service.ts` (catalog source visibility wiring)
- `apps/web/src/pages/Providers.tsx` (catalog source line + refresh button)
- `apps/web/src/pages/Session.tsx` (cost chip in header)
- `apps/web/src/pages/Usage.tsx` (`/usage` page)
- `apps/cli/src/commands/catalog.ts` / `apps/cli/src/commands/usage.ts`
- `apps/cli/scripts/snapshot-models.ts` (build-time snapshot fetcher)
- `apps/cli/tsup.config.ts` (snapshot copy step)

**Surfaces 3.9.1 shipped (highest-traffic first):**

- `apps/web/src/hooks/useSelectedProject.tsx` (rewritten as a route-aware hook; exposes `slug`, `effectiveSlug`, `scopedPath(path)`, `selectProject(id)`, `projectBySlug`, `slugByProjectId`; `computeSlugMap` + `GLOBAL_ROUTE_PREFIXES` exported for the redirect layer)
- `apps/web/src/App.tsx` (single layout route wrapping global + scoped pages; `/providers` + `/usage` top-level; `/:slug`, `/:slug/agent`, `/:slug/agent/:sessionId`, `/:slug/memory`, `/:slug/search` under the slug; `<ProjectRedirect />` at `/` and `*`; legacy `/sessions/:id` → `/agent/:id` preserved)
- `apps/web/src/components/TopBar.tsx` (portal-rendered `ProjectPicker` replaces the former `<Link>` chip; retains `data-testid="topbar-project"`)
- `apps/web/src/components/Shell.tsx` (grid flipped to `cols-[224px_1fr]`; `mako` wordmark + brand mark moved into a 52px block at the top of the sidebar)
- `apps/web/src/components/ProjectCard.tsx` (UUID dropped; slug hint + `supportTarget` chip + folder icon + clickable reveal-path button + stronger selected state + `Open folder` kebab entry)
- `apps/web/src/components/AxisDefaultsCard.tsx` (`ModelCombobox` with portal popover, live search, keyboard nav, provider-icon annotations, inline unavailable-reason chips)
- `apps/web/src/components/ProviderIcon.tsx` (`lmstudio` now points at the real glyph)
- `apps/web/src/components/SessionListNav.tsx` (links use `scopedPath`)
- `apps/web/src/pages/Providers.tsx` (three descriptive subtitles collapsed into `title` tooltips; redundant `BYOK · local + cloud` chip removed; `ADD API KEY` button tinted with the signal color)
- `apps/web/src/pages/Home.tsx`, `apps/web/src/pages/Agent.tsx`, `apps/web/src/pages/Session.tsx` (all internal links/navigates thread through `scopedPath`)
- `apps/web/public/ai-providers/lmstudio.svg` (new asset)
- `services/api/src/routes.ts` (`projectsReveal` definition)
- `services/api/src/routes/projects.ts` (`reveal` handler + `openInFileManager` spawn helper)
- `services/api/src/server.ts` (`reveal` route registration)

**Existing helpers 3.9 wires up (do not rewrite):**

- `extensions/ollama/src/index.ts` → `discoverOllamaModels()` (already pings `/api/tags`)
- `extensions/lmstudio/src/index.ts` → `discoverLmStudioModels()` (already pings `/v1/models`)
- `packages/harness-contracts/models/catalog.json` (still loaded as the bundled fallback)

When Roadmap 4 (Trust Layer) opens, start with [../../master-plan.md](../../master-plan.md) and stand up `devdocs/roadmap/version-4/` mirroring the version-3 doc set.
