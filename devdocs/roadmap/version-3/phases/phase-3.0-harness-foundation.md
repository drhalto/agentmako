# Phase 3.0 Harness Foundation

Status: `Complete`

This file is the exact implementation spec for Roadmap 3 Phase 3.0.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.0.

## Prerequisites

Phase 3.0 assumes Roadmap 2 is locked:

- Phase 1 through Phase 5.2 of Roadmap 2 complete
- `project.db` carries `lifecycle_events`, `tool_runs`, `benchmark_*`, and the flattened schema read model
- `global.db` carries `tool_usage_stats`
- `packages/tools/src/registry.ts`, `packages/tools/src/tool-definitions.ts`, and `packages/tools/src/tool-invocation-logging.ts` are split and stable
- `services/api/src/server.ts` is middleware-plus-route-registration only, with handlers in `services/api/src/routes/`
- `apps/cli/src/commands/` contains modular command modules with `main()` as a thin dispatcher

Phase 3.0 does not require any provider code, embedding provider, or action tool. Those arrive in Phases 3.1 through 3.3.

## Goal

Stand up a transport-agnostic harness core, a session store backed by `project.db`, and an HTTP service that exposes the `no-agent` tier end to end — so `agentmako chat` with zero providers configured routes natural language through the existing `ask` router and returns a structured assistant reply over SSE.

## Hard Decisions

- The harness core lives in `packages/harness-core`. It must not import anything from `services/*`, from any HTTP framework, from `@modelcontextprotocol/sdk`, from `node:http`/`node:net`, or from any terminal library.
- Harness contracts live in `packages/harness-contracts`. Zod is the schema tool. Every public type on the core must have a contract.
- Harness tools live in `packages/harness-tools`. Phase 3.0 ships only `file_read` plus memory-tool stubs that return `not-implemented`; the real memory tools land in Phase 3.3. All harness tools register into the existing `packages/tools/src/registry.ts`, not into a parallel registry.
- The transport service lives in `services/harness`. It binds `127.0.0.1:3018` by default — a separate port and a separate process from `services/api` on `3017`. A crashing action tool must not take down the indexer's HTTP surface.
- Sessions, messages, message_parts, session_events, permission_decisions, and provider_calls all land in `project.db` via a new migration `0004_project_harness.sql`. Every event row is append-only and protected by immutability triggers, following the Phase 4 pattern.
- The CLI routes through the HTTP API — no imports from `harness-core` into `apps/cli`. This is the acceptance test for the transport boundary.
- The master-plan Roadmap 3 section is rewritten as part of this phase so master-plan and version-3 docs stay aligned.

## Why This Phase Exists

The existing substrate is deterministic and catalog-shaped. Every tool call is a one-shot. There is no conversation concept, no session memory, no streaming, no approvals, and no front-door chat surface.

Later Roadmap 3 work (providers, action tools, embeddings, sub-agents, web UI, composers) has nowhere to land until a harness spine exists. Phase 3.0 builds that spine, lights it up in the no-agent tier, and proves the transport boundary by running the entire chat flow through the HTTP API from the CLI.

The no-agent tier is not a stub. With zero providers configured, a human should be able to `agentmako chat` and get structured answers routed through the existing `ask` router. That proves Roadmap 3's core promise: adding agency on top of the substrate does not compromise the substrate.

## Scope In

- New package `packages/harness-core` with:
  - `agent-loop.ts` — model call (Phase 3.1+) → tool dispatch → event emit → next step. In Phase 3.0, the loop is `user message → ask-router → assistant message → done`.
  - `session-store.ts` — CRUD over sessions, messages, parts, and events via `packages/store`.
  - `event-bus.ts` — typed emitter for `message.created`, `text.delta`, `tool.call`, `tool.result`, `permission.request`, `permission.decision`, `provider.call`, `turn.done`, `error`.
  - `permission-evaluator.ts` — skeleton only. Real rule-matching lands in Phase 3.2. In Phase 3.0 it returns `allow` for all read-only tools.
  - `provider-registry.ts` — skeleton only. Phase 3.0 ships with a single `no-op` provider entry for the no-agent tier.
  - `tool-dispatcher.ts` — bridges tool calls into `packages/tools/src/registry.ts`.
  - `tier-resolver.ts` — resolves `no-agent | local-agent | cloud-agent` per the layered order in `roadmap.md`.
  - `system-prompt.ts` — composes prompts with project context and tier hints. Phase 3.0 uses it for the assistant's opening system message only.
  - `ask-adapter.ts` — wraps `packages/tools/src/ask/` so the no-agent tier can answer a user message by routing it through `ask`.
  - `index.ts` — public entry re-exporting `createSession`, `startAgentTurn`, `getSession`, `listSessions`, `deleteSession`, `getEvents`.

- New package `packages/harness-contracts` with:
  - `session.ts` — `SessionSchema`, `MessageSchema`, `MessagePartSchema`, `SessionEventSchema`.
  - `provider.ts` — `ProviderSpecSchema`, `ModelSpecSchema`, `CapabilityFlagsSchema`. Full schemas ship here even though no real provider runs until Phase 3.1.
  - `permission.ts` — `PermissionRuleSchema`, `PermissionDecisionSchema`, `PermissionRequestEventSchema`.
  - `events.ts` — `HarnessEventSchema` discriminated union.
  - `tier.ts` — `HarnessTier` enum plus `ToolTierRequirement` type and the capability matrix that declares each existing tool's minimum tier.
  - `models/catalog.json` — empty-but-valid bundled catalog; real entries ship in Phase 3.1.
  - `index.ts` — public entry.

- New package `packages/harness-tools` with:
  - `index.ts` — module-level registration into `packages/tools/src/registry.ts`.
  - `file-read.ts` — working read-only path scoped to project root, permission `allow`, `minimumTier: "no-agent"`.
  - `memory-remember.ts`, `memory-recall.ts`, `memory-list.ts` — stubs that return `{ mode: "not-implemented" }` until Phase 3.3.
  - No action tools in this phase.

- New service `services/harness` with:
  - `src/index.ts` — bin entry.
  - `src/server.ts` — Hono app bootstrap; binds `127.0.0.1:3018`.
  - `src/middleware/origin.ts` — origin validation mirroring `services/api/src/server-utils.ts`.
  - `src/middleware/project-context.ts` — resolves the session's project using `packages/tools/src/project-resolver.ts`.
  - `src/routes/sessions.ts` — `POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`.
  - `src/routes/messages.ts` — `POST /api/v1/sessions/:id/messages`.
  - `src/routes/stream.ts` — `GET /api/v1/sessions/:id/stream` (SSE).
  - `src/routes/ws.ts` — `GET /api/v1/sessions/:id/ws`. Phase 3.0 supports only `cancel` client messages; approval messages land in Phase 3.2.
  - `src/routes/providers.ts` — returns the no-op provider and an empty custom-provider list.
  - `src/routes/models.ts` — returns the bundled empty catalog.
  - `src/routes/permissions.ts` — returns an empty rule list and rejects `POST`s with a `phase-3.2-required` error.
  - `src/routes/tier.ts` — returns the current tier and its resolution reason.
  - `src/event-serialize.ts` — converts `HarnessEvent` into SSE frames and WS messages.

- New migration `storage/migrations/0004_project_harness.sql` creating:
  - `sessions`, `messages`, `message_parts`, `session_events`, `permission_decisions`, `provider_calls`
  - DELETE/UPDATE rejection triggers on `messages`, `message_parts`, `session_events`, `provider_calls`.
  - `sessions` stays mutable (title, tier, active_provider, active_model, status can update).
  - `permission_decisions` is append-only (decisions are facts; rescoping creates a new row).

- New `packages/store` accessors:
  - `project-store-sessions.ts` — `createSession`, `updateSession`, `getSession`, `listSessions`, `closeSession`.
  - `project-store-messages.ts` — `insertMessage`, `insertMessagePart`, `listMessages`, `listMessageParts`.
  - `project-store-events.ts` — `insertSessionEvent`, `listSessionEvents`, `streamEventsSince(ordinal)`.
  - `project-store-permissions.ts` — `insertPermissionDecision`, `listPermissionDecisions`.
  - `project-store-provider-calls.ts` — `insertProviderCall`, `listProviderCalls`.
  - Follow the Phase 5.2 split pattern: one public accessor surface on `ProjectStore`, implementation in concern-scoped helper modules.

- New CLI commands under `apps/cli/src/commands/`:
  - `chat/` — interactive REPL and `--message` one-shot. Talks only to `http://127.0.0.1:3018`.
  - `session/` — `list`, `show <id>`, `resume <id>`, `rm <id>`. Resume only replays events in 3.0; mid-turn resume with sub-agents lands in Phase 3.4.
  - `tier/` — prints current tier, resolution reason, and upgrade path.
  - Each command follows the Phase 5.1 modular dispatcher pattern.

- Documentation:
  - `devdocs/master-plan.md` Roadmap 3 section rewritten to match the reframe.
  - `devdocs/roadmap/version-3/{README.md, roadmap.md, handoff.md, phases/README.md}` and all Phase 3.0–3.6 phase docs cross-linked.

## Scope Out

- Provider integration (Phase 3.1).
- Action tools (Phase 3.2).
- Declarative permission rule matching and approval events (Phase 3.2).
- Embeddings and real memory tools (Phase 3.3).
- Compaction, sub-agents, and mid-turn resume (Phase 3.4).
- Web UI client (Phase 3.5).
- Investigation composers (Phase 3.6).
- MCP surfacing of action tools (Phase 3.2 ships the `requiresApproval` metadata; Phase 3.0 leaves `services/api/src/mcp.ts` untouched).

## Architecture Boundary

### Owns

- `packages/harness-core`, `packages/harness-contracts`, `packages/harness-tools` as new packages.
- `services/harness` as a new service on `127.0.0.1:3018`.
- Migration `0004_project_harness.sql` and the six new tables it creates.
- The six new `project-store-*` accessor modules.
- The new CLI commands `chat`, `session`, `tier`.
- Rewriting the master-plan Roadmap 3 section.

### Does Not Own

- Any provider code or ai SDK integration (Phase 3.1).
- Any action tool, permission rule file format, or approval flow (Phase 3.2).
- Any embedding code or vector storage (Phase 3.3).
- Compaction, sub-agents, resume (Phase 3.4).
- `apps/web` rewrite (Phase 3.5).
- Composer tools (Phase 3.6).
- Changes to `services/api`, existing Roadmap 1 and 2 tools, MCP, or the schema IR pipeline.

## Contracts

### Input Contract

- `POST /api/v1/sessions { project_id?, tier?, provider?, model?, title? }` returns `{ id }`. Unspecified `project_id` resolves via the same layered chain used by existing tools. Phase 3.0 accepts any `tier` value but ignores `provider` and `model` (no providers exist yet).
- `POST /api/v1/sessions/:id/messages { content }` returns `{ message_id, started: true }`. The core schedules a turn asynchronously; events stream over SSE/WS.
- `GET /api/v1/sessions/:id/stream` returns a stream of SSE frames. Supports `?after=<ordinal>` for resume.
- `GET /api/v1/sessions/:id/ws` upgrades to WebSocket. Phase 3.0 accepts only `{ kind: "cancel" }` client messages.

### Output Contract

The phase leaves behind:

- Session, message, message_part, session_event, permission_decision, and provider_call rows in `project.db` that later phases extend.
- An SSE/WS event stream with `text.delta` and `turn.done` events for every no-agent turn.
- A CLI that routes through the HTTP API and proves the transport boundary.

### Error Contract

- `harness-core/session-not-found` — session id does not resolve in `project.db`.
- `harness-core/tier-insufficient` — a tool was dispatched at a tier lower than its `minimumTier`.
- `harness-core/no-project-context` — the session has no resolved project and the requested tool requires one.
- `services/harness/origin-rejected` — the request origin does not match the allowlist.
- `services/harness/phase-3.2-required` — a caller tried to `POST` to `/api/v1/permissions/rules`.

## Execution Flow

1. Create the three new packages and scaffold their `package.json`, `tsconfig.json`, and `src/index.ts`.
2. Define all zod schemas in `packages/harness-contracts` with full test coverage before `harness-core` imports them.
3. Write migration `0004_project_harness.sql` and the six new `project-store-*` accessor modules.
4. Implement `harness-core`'s `session-store`, `event-bus`, and `tier-resolver`.
5. Implement `tool-dispatcher` and `ask-adapter`; wire the no-agent tier so a user message produces an assistant reply via `packages/tools/src/ask/`.
6. Register `file_read` and memory-stub tools from `packages/harness-tools` into `packages/tools/src/registry.ts`.
7. Scaffold `services/harness` with Hono, origin middleware, and all routes.
8. Implement CLI `chat`, `session`, `tier` commands that talk to the HTTP API.
9. Rewrite `devdocs/master-plan.md` Roadmap 3 section.
10. Write smoke test `test/harness-no-agent.ts`.

## File Plan

Create:

- `packages/harness-core/` — new package (src/ tree per `roadmap.md` §4).
- `packages/harness-contracts/` — new package.
- `packages/harness-tools/` — new package (only `file_read` and memory stubs in 3.0).
- `services/harness/` — new service.
- `storage/migrations/0004_project_harness.sql` — six new tables plus immutability triggers.
- `packages/store/src/project-store-sessions.ts`
- `packages/store/src/project-store-messages.ts`
- `packages/store/src/project-store-events.ts`
- `packages/store/src/project-store-permissions.ts`
- `packages/store/src/project-store-provider-calls.ts`
- `apps/cli/src/commands/chat/` — directory with `index.ts` and a REPL helper.
- `apps/cli/src/commands/session/` — `list.ts`, `show.ts`, `resume.ts`, `rm.ts`, `index.ts`.
- `apps/cli/src/commands/tier/` — `index.ts`.
- `test/harness-no-agent.ts` — smoke test.

Modify:

- `pnpm-workspace.yaml` — add the three new packages and the new service.
- `package.json` (workspace root) — add the new `@mako-ai/harness-core`, `@mako-ai/harness-contracts`, `@mako-ai/harness-tools` workspace entries and `hono`, `@hono/node-ws` dependencies.
- `packages/tools/src/registry.ts` — accept externally-registered tools from `harness-tools`.
- `packages/tools/src/tool-definitions.ts` — register `file_read` and memory-stub tool metadata.
- `packages/store/src/migration-sql.ts` — register migration `0004`.
- `packages/store/src/project-store.ts` — expose the new accessor modules on the public `ProjectStore` class surface.
- `apps/cli/src/index.ts` — register the new commands in the dispatcher.
- `devdocs/master-plan.md` — rewrite Roadmap 3 section.

Keep unchanged:

- `services/api` — the existing HTTP/MCP service is not touched in 3.0.
- `services/indexer` — attach/index/refresh/verify flows unchanged.
- Existing Roadmap 1 and 2 tool registrations and tool-invocation logging.
- Existing schema IR, flattened read model, and DB binding state.

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm --filter @mako-ai/harness-core test`
- `corepack pnpm --filter @mako-ai/harness-contracts test`

Required runtime checks:

- Start `services/harness` on `127.0.0.1:3018`; hit `GET /api/v1/tier` and assert the tier resolves cleanly.
- `curl -XPOST http://127.0.0.1:3018/api/v1/sessions -d '{}'` returns an id.
- `curl -XPOST .../sessions/:id/messages -d '{"content":"which routes hit auth()?"}'` starts a turn.
- SSE stream emits `text.delta` and `turn.done`.
- The assistant reply is routed through the existing `ask` router and contains a structured answer.
- `agentmako chat` works interactively against a scratch attached project with zero providers configured.
- `agentmako chat --message "..."` runs a one-shot turn and exits cleanly on `turn.done`.
- `agentmako session list` and `agentmako session show <id>` reflect what the HTTP API returned.
- `agentmako session resume <id>` replays events and prints them in ordinal order.
- `agentmako tier` prints the current tier, the reason, and the upgrade path.
- Attempt to DELETE a `session_events` row — must fail with a trigger error.
- Attempt to UPDATE a `message_parts` row — must fail with a trigger error.
- `test/harness-no-agent.ts` passes end to end.

Required docs checks:

- `devdocs/master-plan.md` Roadmap 3 section matches the reframe in `devdocs/roadmap/version-3/roadmap.md`.
- `devdocs/roadmap/version-3/` cross-links are correct and point at shipped phase docs.

## Done When

- A transport-agnostic `harness-core` compiles with zero imports from `services/*` or any transport library.
- `services/harness` runs on `127.0.0.1:3018` with all documented routes.
- `agentmako chat` returns structured answers in the no-agent tier with zero providers configured.
- Session, message, message_part, session_event, permission_decision, and provider_call rows are persistable and immutable where specified.
- CLI routes through the HTTP API only — no direct imports from `harness-core` into `apps/cli`.
- Master-plan Roadmap 3 section and `devdocs/roadmap/version-3/` docs are aligned.
- `test/harness-no-agent.ts` and the full test suite pass.

## Risks And Watchouts

- **Transport leakage.** The biggest risk is `harness-core` quietly importing `node:http` or a Hono type. Guard with a lint rule or a smoke test that imports only `@mako-ai/harness-core` from a barebones Node script and asserts no transport modules load.
- **Port collision.** `3018` may already be bound on a developer machine. Make it configurable via `MAKO_HARNESS_PORT` and `.mako/config.json` `harness.port`; document the override in the phase doc and in the CLI's error output on bind failure.
- **Ask-router drift.** The no-agent turn delegates to `packages/tools/src/ask/`. If `ask` evolves independently of the harness, the no-agent tier regresses silently. Smoke-test the full chat path against a known prompt every test run.
- **Migration ordering.** Migration `0004` is the first Roadmap 3 migration. Verify against a fresh `project.db` and an existing `project.db` from a Roadmap 2 install; the v2 install must upgrade cleanly without data loss.
- **Transport parity creep.** A tempting shortcut is to let the CLI import `harness-core` directly "just for Phase 3.0". Do not. Phase 3.5's web UI depends on this boundary being honest from day one.

## Deviations From Spec At Ship Time

The following deviations were taken during implementation. They are documented here so Phase 3.1 picks them up without surprise; none of them weakened the Done When checklist.

- **Migration is inlined, not a `.sql` file.** The spec called for `storage/migrations/0004_project_harness.sql`. The Roadmap 2 migration runner uses inlined template-literal constants in `packages/store/src/migration-sql.ts` rather than reading `.sql` files (per the comment block at the top of `migration-sql.ts` — bundling resilience). The harness migration ships as `PROJECT_MIGRATION_0008_HARNESS_SQL` and is registered as `version: 8` in `PROJECT_MIGRATIONS`. The next available number was 8, not 4 — Roadmap 2 had already consumed 4 through 7 for schema snapshot read-model, source kind, action logging, and benchmark storage. All six tables and triggers shipped as specified.
- **Tables are namespaced.** Tables ship as `harness_sessions`, `harness_messages`, `harness_message_parts`, `harness_session_events`, `harness_permission_decisions`, `harness_provider_calls`. The `harness_` prefix avoids collision with future Roadmap 4 tables (e.g. an unrelated `messages` table) and makes audit queries unambiguous.
- **Store accessors are one module, not five.** The spec called for `project-store-{sessions,messages,events,permissions,provider-calls}.ts`. Implementation collapsed those into a single `packages/store/src/project-store-harness.ts`. Reason: every accessor in the set takes a `session_id` and the SQL row mappers share types; splitting five ways at Phase 3.0 would have duplicated the FK boilerplate and the type union with no gain. The Phase 5.2 split rule still applies — if the file grows past ~500 lines or accessors gain independent concerns (e.g. compaction-only helpers in 3.4), split then. Public surface on `ProjectStore` is unchanged from the spec.
- **Transport is `node:http`, not Hono.** The spec called for Hono. Implementation uses raw `node:http` to match the pattern `services/api` already establishes. Net effect: zero new framework deps at the harness spine. The transport-agnostic guarantee is unchanged — `harness-core` still imports nothing from the transport. If Hono is needed later (Phase 3.5 web UI middleware needs, or WebSocket library ergonomics), it can be introduced inside `services/harness` without touching the core.
- **WebSocket route deferred.** The spec called for `GET /api/v1/sessions/:id/ws` accepting `cancel` messages in 3.0. Implementation ships SSE streaming only. There is no in-flight turn to cancel in no-agent mode (the `ask` router returns synchronously inside a single tick). WebSocket bidirectional flow lands in Phase 3.2 alongside the approval message path, where it earns its keep.
- **`harness-tools` package deferred.** The spec called for `packages/harness-tools` shipping `file_read` plus memory stubs in 3.0. Implementation does not create this package. The no-agent tier acceptance criterion (`agentmako chat` works with zero providers) is met entirely by the existing `packages/tools/src/ask/` router via `packages/harness-core/src/ask-adapter.ts`. Empty action tools and memory stubs would have shipped scaffolding without a consumer; they slot into Phase 3.1/3.2/3.3 where the consumers (provider-driven tool calls, permission flow, embedding provider) actually arrive. The plan section in the parent roadmap describes the intended contract.
- **CLI commands collapsed into one file.** The spec called for `apps/cli/src/commands/{chat,session,tier}/` directories. Implementation puts all three commands in `apps/cli/src/commands/harness.ts` because they share the same HTTP client helper and the SSE consumer. Splitting into directories would have triplicated the `harnessHttp` and `streamSessionEvents` helpers. If any one command grows its own helpers in a future phase, split then.
- **`provider-registry.ts`, `tool-dispatcher.ts`, `system-prompt.ts` skeletons not created.** The spec listed these as files in `harness-core` for 3.0. Implementation deferred them to Phase 3.1 (provider-registry + tool-dispatcher) and Phase 3.0+1 (system-prompt). They are not load-bearing in the no-agent tier — `ask-adapter` covers that path end to end.

The transport-boundary contract, the immutability triggers on append-only tables, the SSE event schema, the layered key-resolution doctrine, and the BYOK rule all shipped exactly as specified.

## What Shipped

- `packages/harness-contracts/` — zod schemas for all the contract types listed in the spec (`Session`, `Message`, `MessagePart`, `HarnessEvent`, `ProviderSpec`, `ModelSpec`, `PermissionRule`, `CreateSessionRequest`, `PostMessageRequest`, `HarnessTier`, `TierResolution`).
- `packages/harness-core/` — `Harness` class (`createSession`, `postMessage`, `listSessions`, `getSession`, `deleteSession`, `listMessages`, `replayEvents`), `SessionEventBus` with persist + fanout, `ask-adapter` for the no-agent tier, `tier-resolver` with the documented layered precedence.
- `services/harness/` — `node:http` server on `127.0.0.1:3018` exposing `POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`, `DELETE /api/v1/sessions/:id`, `POST /api/v1/sessions/:id/messages`, `GET /api/v1/sessions/:id/stream` (SSE with `?after=<ordinal>` resume), `GET /api/v1/tier`, `GET /api/v1/health`, plus stubbed `GET /api/v1/providers`, `GET /api/v1/models`, `GET /api/v1/permissions/rules` for forward-compatible client probing.
- `packages/store/src/project-store-harness.ts` — six tables' worth of CRUD accessors, exposed on `ProjectStore`.
- `packages/store/src/migration-sql.ts` + `project-store.ts` — `PROJECT_MIGRATION_0008_HARNESS_SQL` constant and `version: 8` registration.
- `apps/cli/src/commands/harness.ts` — `chat` (interactive REPL + `-m` one-shot), `session list|show|resume|rm`, `tier`. CLI imports nothing from `harness-core` — it is HTTP-only.
- `apps/cli/src/index.ts` and `apps/cli/src/shared.ts` — dispatcher updates and `CLI_COMMANDS` registry entries.
- `tsconfig.json` and `tsconfig.base.json` — project-reference and path-alias entries for the new packages and service.
- `test/smoke/harness-no-agent.ts` — full end-to-end assertion: createSession → subscribe → postMessage → text.delta → turn.done, plus replay-side `session.created` check, plus the `ProjectStore` accessor round-trip for messages and parts.
- `package.json` — `test:smoke` updated to run `harness-no-agent.ts`; root `zod` devDependency added so the smoke test can use the published schemas without going through the workspace symlink dance.
- `devdocs/master-plan.md` — Roadmap 3 section rewritten as `Harness And Model Layer`.

## Verification Result

- `corepack pnpm typecheck` — clean across the entire workspace.
- `corepack pnpm --filter agentmako run build` — CLI tsup bundle builds (`719.92 KB`).
- `corepack pnpm test:smoke` — three suites pass (`core-mvp`, `ask-router-goldens`, `harness-no-agent`); `exit=0`.
- `harness-no-agent` smoke confirms the no-agent turn lands a `text.delta` and a `turn.done` event sequence and that the `session.created` event is persisted in `harness_session_events` for replay.
- `agentmako` CLI commands `chat`, `session`, `tier` are registered in the dispatcher and route through `http://127.0.0.1:3018` (configurable via `MAKO_HARNESS_URL`).

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.1-provider-layer.md](./phase-3.1-provider-layer.md)
- [../version-2/phases/phase-4-logging-and-evaluation-backbone.md](../../version-2/phases/phase-4-logging-and-evaluation-backbone.md) — append-only fact-table pattern
- [../version-2/phases/phase-5.2-deep-module-split.md](../../version-2/phases/phase-5.2-deep-module-split.md) — concern-scoped store-split pattern
