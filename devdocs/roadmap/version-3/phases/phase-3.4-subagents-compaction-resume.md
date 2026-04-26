# Phase 3.4 Sub-agents, Compaction, And Resume

Status: `Complete`

This file is the canonical planning record for Roadmap 3 Phase 3.4. It captures the shape intended at implementation-time, corrected against the substrate Phases 3.0–3.3 actually shipped. A closing `Deviations From Spec At Ship Time` section will be added when the phase ships — exactly as Phase 3.3 records its own pivots.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.4.

## Prerequisites

Phase 3.4 requires Phases 3.0, 3.1, 3.2, and 3.3 complete:

- **3.0** — `ProjectStore`, `harness_*` tables (`harness_sessions`, `harness_messages`, `harness_message_parts`, `harness_session_events`, `harness_provider_calls`, `harness_permission_decisions`), the `SessionEventBus`, and `services/harness` SSE transport.
- **3.1** — `ProviderRegistry` with layered key resolution and fallback chains; `createLanguageModel` for per-turn provider invocation.
- **3.2** — `PermissionEngine`, the pending-approvals registry on `ToolDispatch`, and the `/permissions/requests` resolve path. Sub-agent permission inheritance rides this engine.
- **3.3** — `EmbeddingProvider` and `recallMemories`; compaction's optional "archive summary into memory" integration uses these (see Scope Out for why auto-archive is deferred).

## Aligning With Shipped Substrate

Every file plan and table/column reference below has been reconciled with the shipped Phase 3.0-3.3 codebase. The corrections from the original planning draft:

- **Migration number is `0012`, not `0007`.** Phases 3.0-3.3 consumed `0004` through `0011`. The new migration is inline template-literal constants in `packages/store/src/migration-sql.ts` + an entry in `project-store.ts`'s `PROJECT_MIGRATIONS` array — no `.sql` file (bundling pattern established in Phase 3.0).
- **Tables are `harness_`-prefixed.** `messages` → `harness_messages`; `session_events` → `harness_session_events`. Phase 3.4 adds `archived INTEGER NOT NULL DEFAULT 0` to `harness_messages` with a `(session_id, archived)` index.
- **Harness orchestration lives in `harness.ts`, not `agent-loop.ts` or `session-store.ts`.** `runTurn` fires compaction after `turn.done`; `buildHistory` filters `archived=1` messages. Neither `agent-loop.ts` nor `session-store.ts` exists as a file.
- **`sub_agent_spawn` lives in `packages/harness-core/src/sub-agent-tools.ts`, not `packages/harness-tools/`.** Same circular-dep reason Phase 3.3 had for memory tools: `sub_agent_spawn` needs `Harness` itself to create and run the child session, and `Harness` lives in harness-core. `harness-tools` stays scoped to pure filesystem action tools. `SUB_AGENT_TOOLS` registers into `ToolDispatch.tools` alongside `ACTION_TOOLS` and `MEMORY_TOOLS`.
- **CLI uses single-file command modules.** There is no `apps/cli/src/commands/session/` or `commands/tier/` subdirectory. `runSessionCommand`, `runTierCommand`, etc. are exported functions in `apps/cli/src/commands/harness.ts`. Phase 3.4 extends those functions in place (or splits `harness.ts` if it crosses the ~600-line threshold — at implementation time's discretion).
- **Service routes are inline in `services/harness/src/server.ts`.** No `routes/stream.ts`, `routes/sessions.ts`, etc. Phase 3.4 adds new cases to the inline dispatcher: `POST /api/v1/sessions/:id/resume`, and extends `GET /api/v1/sessions/:id/stream` to honor the already-scaffolded `?after=<ordinal>` query.
- **The Phase 3.0 `agentmako session resume` "stub" does not exist as a separately addressable file.** `runSessionCommand` in `apps/cli/src/commands/harness.ts` currently handles `session list|show|rm` (and prints events for `show`). Phase 3.4 adds a `resume` subcommand to that same function.
- **New event kinds need registration in `@mako-ai/harness-contracts`.** `HarnessEventSchema` in `packages/harness-contracts/src/schemas.ts` must be extended with `sub_agent.started`, `sub_agent.finished`, `compaction.started`, `compaction.summary_inserted`, and (for resume) `resume.pending_approvals` before any producer emits them.
- **Smoke tests live under `test/smoke/`.** Paths are `test/smoke/harness-sub-agent.ts`, etc. The root `package.json` `test:smoke` chain is `&&`-joined; deterministic tests append there, live-provider tests get their own `test:smoke:*` script.
- **No `session_events` direct writes from new code paths.** All writes go through `SessionEventBus.emit(sessionId, event)` (which `ProjectStore` persists via `insertHarnessSessionEvent`) — the same pattern Phases 3.0-3.3 use.

## Goal

Make sessions durable enough for long agentic work: ship `sub_agent_spawn` for child-session delegation, implement token-budget-driven compaction that summarizes old turns while preserving originals, and deliver `agentmako session resume <id>` that replays `harness_session_events` deterministically to restore state after a restart.

## Hard Decisions

- Child sessions are real `harness_sessions` rows with `parent_id` set (the column already exists from Phase 3.0). Child results surface as `tool_result` parts in the parent. A child's event stream is separate; parent SSE emits `sub_agent.started`, `sub_agent.finished` events referencing the child's id. Each event carries `{ childSessionId, parentCallId }` for correlation.
- Compaction triggers at a configurable fraction of the active model's `contextWindow` (default `0.6`). When it triggers, the oldest N turns are summarized into a single `system` message and marked `archived=1` on their originals. Originals stay in `harness_messages` for audit; archived parts are simply excluded from the history `harness.ts:buildHistory` assembles.
- Compaction summaries are produced by the same active provider that is running the session. On provider failure, compaction backs off (no summarization attempted) and the session keeps all turns visible; a `compaction.failed` event is emitted carrying the upstream error.
- Resume is event-replay, not tool re-execution. `agentmako session resume <id>` reads `harness_session_events` in ordinal order. No tools are re-invoked; nothing is re-approved. Pending approvals that were mid-flight when the process died are *abandoned* — the `Promise<decision>` that `ToolDispatch` was awaiting died with the process, and `ToolDispatch.pendingBySession` is intentionally **not** re-populated on resume. Abandoned approvals are surfaced through (a) a `resume.pending_approvals` event emitted on the bus and persisted to `harness_session_events`, and (b) the `pendingApprovals` array in the resume response body. Callers re-trigger those tool calls by posting a new user message that prompts the agent to retry.
- Sub-agent permission inheritance (default): the child inherits the parent's `allow` decisions for the current turn only. Decisions with `scope: session | project | global` always carry over (they are matched by pattern, independent of session id, except `session` which is parent-session-scoped and therefore does not cross). This can be overridden per-call via `sub_agent_spawn { inheritPermissions: "none" | "turn" | "full" }`.
- A child session's provider/model/fallback chain is inherited from the parent by default and can be overridden per-call.
- Sub-agent recursion depth cap: default 3. Enforced in `sub_agent_spawn` by walking `parent_id` at spawn time; exceeds throws `sub-agent/recursion-cap`.
- Harness-version fencing on resume: every `harness_sessions` row stamps the harness version at creation (`harness_version TEXT`, added in the `0012` migration alongside `archived`). Resume refuses on major-version mismatch to keep event semantics stable.

## Why This Phase Exists

Long agentic work dies under three weights: context exhaustion, loss on restart, and impossible task decomposition. This phase makes sessions durable:

- Compaction keeps long sessions coherent instead of forcing the user to restart when context fills.
- Resume means a CLI crash, VS Code reload, or `agentmako` process kill does not lose the chat.
- Sub-agents let the agent partition big tasks into smaller turns with their own budgets.

All three build on the Phase 3.0 event log. No new persistence concepts are needed — just new readers and writers over the existing `harness_session_events` spine.

## Scope In

- `packages/harness-core/src/sub-agent-tools.ts`:
  - Exports a `SUB_AGENT_TOOLS` array and a `subAgentSpawnTool` definition, mirroring the `MEMORY_TOOLS` pattern Phase 3.3 established.
  - Input: `{ prompt, budget?: { maxTurns?, maxTokens? }, provider?, model?, fallbackChain?, inheritPermissions?: "none" | "turn" | "full" }`.
  - Creates a child `harness_sessions` row with `parent_id` set via `ProjectStore.createHarnessSession`.
  - Runs the child's turns through the existing `Harness.postMessage` + `runTurn` path (or a narrower `Harness.runChildTurn` helper if needed). Budget enforcement caps turn count and monitors the child's `provider_call` tokens.
  - Returns the child's final assistant text plus a structured `{ childSessionId, messages, provider_calls }` summary as the `tool_result`.
  - Registered into `ToolDispatch.tools` via a new `executeSubAgentTool` path (bypasses permission flow by default; parent-scoped approval already gates the parent's spawn call).
- `packages/harness-core/src/sub-agent.ts` — orchestration helpers: recursion-depth walk, budget enforcement, permission-inheritance snapshot.
- `packages/harness-core/src/compaction.ts`:
  - `maybeCompact(sessionId, harness)` invoked from `Harness.runTurn` after `turn.done` fires and before the SSE emit.
  - Checks total-token estimate (sum across the session's `harness_messages` content + `harness_provider_calls.prompt_tokens`) against `activeModel.contextWindow * threshold`.
  - When above threshold, produces a summary via the active provider (same `createLanguageModel` path chat uses, with a dedicated system prompt) and inserts a `system`-role `harness_messages` row holding the summary; marks originals `archived=1` through a new `markMessagesArchived` store accessor.
  - Emits `compaction.started` (with archived message ids) and `compaction.summary_inserted` (with the new synthetic message id) events through `SessionEventBus`. On failure: emits `compaction.failed` and leaves the session untouched.
- Migration `PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL` (inline in `packages/store/src/migration-sql.ts`):
  - `ALTER TABLE harness_messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));`
  - `CREATE INDEX idx_harness_messages_archived ON harness_messages(session_id, archived);`
  - `ALTER TABLE harness_sessions ADD COLUMN harness_version TEXT;` (used for the resume-safety fence.)
  - Registered in `PROJECT_MIGRATIONS` as version 12, name `0012_project_harness_messages_archived`.
- `packages/harness-core/src/resume.ts`:
  - Reads `harness_session_events` for a session via `ProjectStore.listHarnessSessionEvents`.
  - Asserts monotonic contiguous ordinals; throws `resume/event-ordering-violation` on a gap.
  - Scans for `permission.request` events that have no matching `permission.decision` and treats them as *abandoned* — their in-memory tool-call Promises died with the previous process, so `ToolDispatch.pendingBySession` is **not** re-populated. Callers re-trigger by posting a new user message.
  - Emits a `resume.pending_approvals` event listing the abandoned request ids so UIs can render them distinctly from live approvals.
  - Returns `{ sessionId, resumedFromOrdinal, eventCount, pendingApprovals: [...] }` so the HTTP route can hand the client a well-formed resume result.
- `buildHistory` in `packages/harness-core/src/harness.ts` updated to `WHERE archived = 0` when selecting messages for model context assembly.
- `runSessionCommand` in `apps/cli/src/commands/harness.ts` extended:
  - `session resume <id>` — calls `POST /api/v1/sessions/:id/resume`, then starts SSE from the last event ordinal.
  - `session show <id>` — appends "archived turn count" and any compaction events (already a single-function command).
- `runTierCommand` in `apps/cli/src/commands/harness.ts` extended to print the current compaction threshold (read from `defaults.compaction` in `.mako/config.json`, falling back to the hard-coded default).
- HTTP routes added inline to `services/harness/src/server.ts`:
  - `POST /api/v1/sessions/:id/resume` — re-hydrates state, returns `{ resumedFromOrdinal, pendingApprovals: [...] }`.
  - `GET /api/v1/sessions/:id/stream?after=<ordinal>` — the handler currently reads `?after=` but the replay-from-ordinal semantics need auditing; Phase 3.4 confirms and pins them.
- `HarnessEventSchema` in `packages/harness-contracts/src/schemas.ts` extended with `sub_agent.started`, `sub_agent.finished`, `compaction.started`, `compaction.summary_inserted`, `compaction.failed`, `resume.pending_approvals`. Discriminator is already `kind`; adding variants is additive.
- Smoke tests (four files; two in CI, two live-provider/manual):
  - `test/smoke/harness-sub-agent.ts` (CI) — deterministic: parent spawns a child that runs one no-agent turn, child's result folds back into parent's `tool_result`. Validates event ordering and the `inheritPermissions: "none"` case.
  - `test/smoke/harness-resume.ts` (CI) — deterministic: write a fixture of `harness_session_events` to disk, invoke the resume path against a cold harness, assert in-memory state equals the replay. No live model.
  - `test/smoke/harness-compaction.ts` (manual; `pnpm test:smoke:compaction`) — drives a live session past threshold; requires a provider. Asserts archival + summary insertion + coherent follow-up turn.
  - `test/smoke/harness-resume-pending-approval.ts` (CI) — deterministic: seed a session where `permission.request` has no `permission.decision`; call `harness.resume()`; assert the request id surfaces in the response's `pendingApprovals` array, that a `resume.pending_approvals` event is emitted + persisted, and that decided requests never appear in the pending list. The in-memory `ToolDispatch.pendingBySession` is NOT touched — the test explicitly verifies the abandoned-approval contract.

## Scope Out

- Web UI rendering of sub-agents or compaction (Phase 3.5).
- Investigation composers (Phase 3.6).
- `memory_forget` or memory compaction — separate from session compaction.
- Cross-session inference ("remember from last week's session") — out of scope; handled by memory tools.
- Session sharding across machines.
- Provider-aware summarization (using a cheap model for summaries while a strong model drives the agent) — a good optimization, explicitly deferred.

## Architecture Boundary

### Owns

- `sub_agent_spawn` tool family (`packages/harness-core/src/sub-agent-tools.ts` + `sub-agent.ts`).
- `compaction.ts` threshold check + summarization + event emission.
- `resume.ts` event-replay + pending-approval re-registration.
- Migration `0012_project_harness_messages_archived` (inline constant + registration).
- `runSessionCommand` extensions for `resume`; `runTierCommand` compaction-threshold readout.
- New inline routes in `services/harness/src/server.ts` for `POST /sessions/:id/resume`.
- Event-kind additions to `HarnessEventSchema`.

### Does Not Own

- `harness_session_events` / `harness_sessions` / `harness_messages` table schemas — created in Phase 3.0 migration `0008`; 3.4 only ALTERs `harness_messages`+`harness_sessions`.
- `SessionEventBus` — created in Phase 3.0 and consumed unchanged.
- Permission evaluator — created in Phase 3.2 and consumed unchanged; Phase 3.4 only reads inherited decisions, never mutates rules.
- `ToolDispatch.pendingBySession` — Phase 3.2 defined it; Phase 3.4 reads no part of it during resume (abandoned approvals are listed in the response + emitted as a `resume.pending_approvals` event, not re-wired into a new live Promise).
- Chat provider code and key resolution — consumed unchanged.
- Memory tools — consumed unchanged (compaction summaries do not automatically become memories; that is a user decision and a future `memory.archive_compaction_summary` tool).

## Contracts

### Input Contract

- `sub_agent_spawn { prompt, budget?, provider?, model?, fallbackChain?, inheritPermissions? }` — tool call from within a session.
- `POST /api/v1/sessions/:id/resume { }` — resume a session. Response body: `{ sessionId, resumedFromOrdinal, eventCount, pendingApprovals: Array<{ requestId, tool, requestOrdinal }> }`. Each pending entry describes an abandoned `permission.request` whose live `Promise<decision>` died with the previous process; the callers renders it as "outstanding when session ended", not as a live prompt.
- `GET /api/v1/sessions/:id/stream?after=<ordinal>` — stream from a specific event ordinal.

### Output Contract

- Child sessions visible via `GET /api/v1/sessions` with `parent_id` populated.
- Compacted messages still present in `harness_messages` but flagged `archived=1`; excluded from `buildHistory`'s model context but queryable via `listHarnessMessages({ includeArchived: true })`.
- `harness_session_events` contains `compaction.started`, `compaction.summary_inserted`, `compaction.failed`, `sub_agent.started`, `sub_agent.finished`, and `resume.pending_approvals` entries.
- Resume restores SSE from a given ordinal exactly; duplicate events are impossible because ordinals are session-primary-keyed.

### Error Contract

- `sub-agent/budget-exhausted` — child session hit `maxTurns` or `maxTokens`; the `tool_result` returns the partial state with an `ok: false` flag.
- `sub-agent/recursion-cap` — depth walk in `sub_agent_spawn` exceeds `MAX_SUB_AGENT_DEPTH` (default 3, override via `MAKO_HARNESS_MAX_SUB_AGENT_DEPTH`).
- `compaction/provider-unavailable` — summarization attempt failed; session keeps running with all turns visible. `compaction.failed` event carries the reason.
- `resume/event-ordering-violation` — if `harness_session_events` is out of order (migration bug, corrupted row), surface clearly and refuse to resume.
- `resume/version-mismatch` — stored `harness_sessions.harness_version` major component differs from the running binary; resume refuses with an upgrade hint.
- `resume/pending-approvals` — resume has re-surfaced pending requests; returned in the API response body for the client to handle.

## Execution Flow

1. Write migration `0012` (`archived` + `harness_version`) as an inline constant in `migration-sql.ts` and register it in `project-store.ts`. Add the `markMessagesArchived` / `listHarnessMessages({ includeArchived })` store accessors.
2. Extend `HarnessEventSchema` in `packages/harness-contracts/src/schemas.ts` with the six new event kinds.
3. Implement `compaction.ts`; unit-test the threshold-math decision without a real provider.
4. Wire compaction into `Harness.runTurn` — runs after the `turn.done` emit. Update `buildHistory` to `WHERE archived = 0`.
5. Implement `sub-agent.ts` (orchestration helpers) and `sub-agent-tools.ts` (`subAgentSpawnTool`). Register `SUB_AGENT_TOOLS` into `ToolDispatch.buildTools`.
6. Implement `resume.ts` event replay + pending-approval re-registration.
7. Add the `POST /sessions/:id/resume` inline handler in `services/harness/src/server.ts`; confirm `GET /sessions/:id/stream?after=<ordinal>` semantics.
8. Extend `runSessionCommand` / `runTierCommand` in `apps/cli/src/commands/harness.ts`; update `CLI_COMMANDS` in `shared.ts`.
9. Write the four smoke tests (three deterministic for CI, one live-provider manual).

## File Plan

Create:

- `packages/harness-core/src/compaction.ts`
- `packages/harness-core/src/sub-agent.ts`
- `packages/harness-core/src/sub-agent-tools.ts`
- `packages/harness-core/src/resume.ts`
- `test/smoke/harness-sub-agent.ts`
- `test/smoke/harness-compaction.ts`
- `test/smoke/harness-resume.ts`
- `test/smoke/harness-resume-pending-approval.ts`

Modify:

- `packages/store/src/migration-sql.ts` — append `PROJECT_MIGRATION_0012_*` constant.
- `packages/store/src/project-store.ts` — migration entry + `markMessagesArchived` + `listHarnessMessages({ includeArchived })` + `harness_version` on session rows.
- `packages/store/src/project-store-harness.ts` — add `archived` field to `HarnessMessageRecord` + `harness_version` to `HarnessSessionRecord`.
- `packages/harness-contracts/src/schemas.ts` — extend `HarnessEventSchema` with sub-agent / compaction / resume event kinds.
- `packages/harness-core/src/harness.ts` — fire compaction after `turn.done`; filter `archived=1` in `buildHistory`; stamp `harness_version` on session creation; wire `resume()` public method.
- `packages/harness-core/src/tool-dispatch.ts` — register `SUB_AGENT_TOOLS` alongside `ACTION_TOOLS` and `MEMORY_TOOLS`; add `executeSubAgentTool` path.
- `packages/harness-core/src/index.ts` — re-export new modules.
- `services/harness/src/server.ts` — inline handler for `POST /api/v1/sessions/:id/resume`; verify `?after=<ordinal>` semantics.
- `apps/cli/src/commands/harness.ts` — `session resume` subcommand; `session show` archived-count line; `tier` compaction-threshold line.
- `apps/cli/src/shared.ts` — `session resume` added to `CLI_COMMANDS`.
- Root `package.json` — CI smoke chain picks up the three deterministic tests; `test:smoke:compaction` script for the live-provider one.

Keep unchanged:

- Embeddings and memory tools.
- Permission model and evaluator.
- Chat provider layer and fallback chains.
- Existing Roadmap 1 and 2 surfaces.
- `harness-tools` package (filesystem action tools stay pure; sub-agent does not belong there).

## Verification

Required commands:

- `corepack pnpm typecheck` — clean across the workspace.
- `corepack pnpm run test:smoke` — existing smoke chain + the three new deterministic tests pass.

Optional live-provider check (run manually with a provider reachable):

- `corepack pnpm run test:smoke:compaction` — drives a session past threshold against a real chat provider; asserts archival + coherent follow-up.

Manual contract checks (for phase acceptance review):

- Parent chat session calls `sub_agent_spawn` with a small prompt; child runs to completion; parent's SSE shows `sub_agent.started` then `sub_agent.finished`; parent receives a `tool_result` part with the child's final text.
- Drive a session past 60% of the model's context window. `compaction.started` event fires; oldest `harness_messages` become `archived=1`; a synthetic summary system message is inserted; next assistant turn stays coherent across the boundary.
- Kill `services/harness` mid-stream during a long response. Restart. `agentmako session resume <id>` replays events and prints the full previously-streamed text without calling the model again (no new `provider.call` event emitted during replay).
- Kill during a pending `permission.request`. Resume surfaces the request in `pendingApprovals` in the resume response and emits a `resume.pending_approvals` event visible in replay. The request is NOT re-populated into `ToolDispatch.pendingBySession` — `GET /api/v1/sessions/:id/permissions/requests` returns an empty list (no live Promise), which is the correct reflection of abandoned state. The CLI / UI renders the abandoned requests from the resume response; to proceed on a task that was waiting on approval, the operator posts a new user message that re-prompts the agent to retry the tool call.
- Sub-agent with `inheritPermissions: "none"` does not carry parent's turn-scope `allow` decisions; re-prompts at the matching tool call.
- `agentmako session show <id>` reports archived turn count and any compaction events.
- `agentmako tier` prints the active compaction threshold.
- Version-fence: manually edit a `harness_sessions.harness_version` to a prior major; `session resume` refuses with `resume/version-mismatch`.

## Done When

- Migration `0012` applies cleanly on fresh and existing `project.db` files. Pre-existing `harness_sessions` rows get `harness_version = NULL` — resume treats NULL as "legacy (pre-3.4)" and **allows it through** (refusing would orphan every session created before the upgrade). Only sessions whose stored `harness_version` has a *different major* than the running binary are refused with `resume/version-mismatch`.
- `sub_agent_spawn` works end-to-end with:
  - **Inheritance modes honored** — `"none"` / `"turn"` / `"full"` each produce the expected `harness_permission_decisions` rows on the child.
  - **Recursion cap honored** — depth walk via `parent_id` blocks spawns past `MAX_SUB_AGENT_DEPTH` (default 3, override via `MAKO_HARNESS_MAX_SUB_AGENT_DEPTH`).
  - **`maxTurns` honored up to its 3.4 ceiling of 1.** The zod schema accepts `maxTurns` values 1–10 so the wire contract is stable, but child execution is single-turn only in 3.4. Multi-turn continuation is deferred to a 3.4.x follow-up.
  - **`maxTokens` accepted but not enforced in 3.4.** The field is in the schema so callers can plumb it through today; enforcement requires token counts on `provider.call` event payloads, which is a 3.4.x follow-up. Treat `maxTokens` as a hint the harness will start enforcing later, not a guarantee in 3.4.
- Compaction archives old turns without deleting them, excludes them from `buildHistory`, and emits the three compaction event kinds.
- Resume replays events deterministically with no tool re-invocation. Unresolved `permission.request` events (those with no matching `permission.decision`) are surfaced as abandoned approvals via the `resume.pending_approvals` event and the `pendingApprovals` array in the resume response — they are NOT re-wired into live Promises (the originating Promises died with the previous process).
- `harness_session_events` carries machine-readable compaction, sub-agent, and resume markers.
- `HarnessEventSchema` in harness-contracts enumerates every new event kind.
- The three deterministic smoke tests pass in CI; the live-provider compaction smoke passes when run manually against a provider.

## Risks And Watchouts

- **Summarization cost.** Every compaction call hits the provider. Cap total compactions per session; document the cost in `provider_calls` rows.
- **Summary quality drift.** A bad summary can silently degrade subsequent turns. Ship the original turns as `archived=1` so a human can always recover context by querying `messages` directly.
- **Replay against changed code.** If `packages/harness-core` changes between the original run and resume, event semantics may shift. Store a `harness_version` on every session; fail resume if the major version does not match.
- **Sub-agent spawn explosion.** An agent could nest spawns infinitely. Cap recursion depth (default 3); document the cap.
- **Inherited permissions vs. narrower scope.** A child session granted `allow` at `session` scope could exceed the parent's intent. Document that session-scope `allow` is literally per-session, and a child is its own session — parent's session-scope decisions do not carry unless `inheritPermissions: "full"` is explicit.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.3-embeddings-and-memory.md](./phase-3.3-embeddings-and-memory.md)
- [./phase-3.5-web-ui-alpha.md](./phase-3.5-web-ui-alpha.md)

## Deviations From Spec At Ship Time

The sections above describe the shipped contract. This section records the handful of intentional pivots from the original planning draft — the *why* behind each delta, for future phases reading back.

1. **Approval re-wiring rejected; abandoned-approval contract shipped instead.** The planning draft called for `resume` to re-populate `ToolDispatch.pendingBySession` so approvals from a pre-crash session could be re-approved live. That's not physically possible — the `Promise<decision>` that `streamText` was awaiting inside the previous process is gone with the process; we cannot reconstruct the tool-call continuation from event data alone. Shipped behavior is the explicit *abandoned-approval* contract captured above: resume lists them in `pendingApprovals`, emits `resume.pending_approvals`, and the operator retriggers by posting a new user message. The event log is complete; no state is lost — only the mid-flight tool call is cancelled.
2. **Migration 0008's blanket `harness_messages_no_update` trigger had to be swapped.** The original trigger rejected every UPDATE on `harness_messages`. Compaction needs to flip `archived` from 0→1, so migration 0012 drops the blanket trigger and installs `harness_messages_no_update_except_archived`, which uses `OLD.col IS NOT NEW.col` (NULL-safe) checks on every other column. This preserves the append-only audit guarantee for message content while letting the `archived` bit move.
3. **`sub_agent.started` / `sub_agent.finished` moved from the dispatcher to `spawnChildSession`.** The original plan had `ToolDispatch.executeSubAgentTool` emit both events. Problem: `sub_agent.started` can't include a real `childSessionId` at dispatcher-time (the child hasn't been created yet). Moving emission into `spawnChildSession` means both events carry the real id and correlate through a `parentCallId` that the dispatcher pipes in via the tool context.
4. **Budget behavior matches schema shape, not the spec's "end-to-end limits" language.** `maxTurns` is capped at 1 in 3.4 (single-turn child); `maxTokens` is accepted in schema but not enforced (requires token counts on `provider.call` event payloads, deferred to 3.4.x). The Done-When section above now documents this explicitly — this deviation exists so the gap between the schema surface and the enforcement depth is not misread as a bug.
5. **`HARNESS_VERSION` as a `const` in `harness.ts`** rather than a package.json semver lookup — simpler and testable. Bump the major explicitly when event semantics break replay compatibility.
6. **`sub_agent_spawn` placed in `packages/harness-core/src/sub-agent-tools.ts`**, not `packages/harness-tools/`. Same circular-dep reason memory tools shipped in harness-core: the tool needs `Harness` + `ProjectStore`. The dispatcher receives a `subAgentContext` at construction time, mirroring the Phase 3.3 `memoryContext` pattern.
7. **`session cancel` is out of 3.4 scope.** The planning draft mentioned it in passing; Phase 3.5 will add `DELETE /api/v1/sessions/:id/current-turn` + the matching `agentmako session cancel` CLI subcommand if and when cancel is needed in the web UI flow.
8. **Live-provider compaction smoke skips cleanly on catalog-mismatch.** Bundled `ollama` catalog entry declares `llama3.1`, `llama3.1:70b`, `qwen2.5-coder:32b`, `deepseek-r1:70b` (plus the embedding-only `nomic-embed-text` / `mxbai-embed-large`). Users who pulled a different model see a SKIP with instructions to either pull a catalog-declared model or add their model to `packages/harness-contracts/models/catalog.json`. Not a CI blocker.
