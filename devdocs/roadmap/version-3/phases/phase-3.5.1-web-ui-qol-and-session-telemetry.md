# Phase 3.5.1 Web UI QoL And Session Telemetry

Status: `Complete`

This file is the canonical planning record for Roadmap 3 Phase 3.5.1, a narrow follow-up to Phase 3.5 that closes the most visible chat-surface usability gaps without reopening the transport or provider scope.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design and shipped behavior of Phase 3.5.1.

## Prerequisites

Phase 3.5.1 requires Phases 3.1, 3.4, and 3.5 complete:

- Phase 3.1 provider calls already persist `prompt_tokens` and `completion_tokens` into `harness_provider_calls`.
- Phase 3.4 already ships the shared `estimateTokens(...)` heuristic used for compaction budgeting.
- Phase 3.5 already ships the React + Vite dashboard and the `GET /api/v1/sessions/:id` session-detail route the web client consumes.

## Goal

Make the alpha chat feel less blind:

- untitled sessions auto-name themselves from the first user message
- the session header shows session-level input/output token totals when providers report them
- the session header shows the current context estimate and, when known, how much of the model window is currently occupied
- recent-session ordering stays in step with actual chat activity

This phase is intentionally narrow. It does not add pricing, a tokenizer service, or a broader analytics surface.

## Hard Decisions

- **No new migration.** Phase 3.5.1 reuses the existing `harness_provider_calls.prompt_tokens` and `completion_tokens` columns from Phase 3.1. A read path is added; no schema change is needed.
- **No cost UI.** The phase surfaces input/output counts and context occupancy only. `cost_hint` remains out of scope until model pricing has a trustworthy source of truth.
- **Context occupancy is heuristic, not tokenizer-exact.** `contextTokens` is computed with the existing `estimateTokens(...)` helper over active, non-archived messages. This is close enough for UX and compaction awareness, but it is not a provider-native `countTokens` result.
- **Auto-title is first-message only.** The harness derives a title only when the session is still untitled. Explicit titles always win, and weak first prompts are not rewritten later in this phase.
- **Shared response shape lives in contracts.** The usage payload is defined once in `@mako-ai/harness-contracts` and re-exported into `apps/web`; the web app does not carry a duplicate local interface.

## Why This Phase Exists

Phase 3.5 proved transport parity, but the browser chat still felt rough in day-to-day use:

- new sessions stayed generically named unless the caller supplied a title up front
- the user had no visibility into provider-reported input/output token usage
- the user had no idea how close a session was to the active model's context limit
- recent-session freshness depended too heavily on initial creation time instead of ongoing conversation activity

Phase 3.5.1 fixes those rough edges with the smallest possible slice of code and no new transport surface.

## Aligning With Shipped Substrate

- **Provider usage is already persisted.** The provider layer writes `prompt_tokens` and `completion_tokens` into `harness_provider_calls`; Phase 3.5.1 reads those rows back out through `ProjectStore`.
- **The web already consumes session detail through REST.** This phase extends `GET /api/v1/sessions/:id`; it does not add a new route.
- **Context-window metadata is catalog-driven.** The denominator comes from the active provider's `ModelSpec.contextWindow` when the active model is known to the registry. Unknown custom model ids intentionally fall back to `contextWindow = null`.
- **No-agent remains first-class.** No-agent sessions still show a context estimate; input/output counts remain `null` because there are no provider calls.

## Scope In

- Add a `ProjectStore.listHarnessProviderCalls(sessionId)` read accessor.
- Add a shared `SessionUsageSnapshot` schema to `packages/harness-contracts`.
- Extend `GET /api/v1/sessions/:id` to return:
  - `inputTokens`
  - `outputTokens`
  - `contextTokens`
  - `contextWindow`
  - `contextUtilization`
- Render those values in the web session header.
- Auto-title untitled sessions from the first user message.
- Touch the session row on user post so `updated_at` reflects real activity and the session status returns to `active`.
- Cover the shipped behavior with focused no-agent and cloud-agent smokes.

## Scope Out

- Dollar-cost estimation or pricing display.
- Per-turn or per-tool usage charts.
- Provider-specific preflight token counting APIs.
- Automatic title rewriting after later turns.
- Manual title-edit UI.
- The read-only file tree deferred from Phase 3.5; that remains a separate 3.5.x backend + UI slice.

## Architecture Boundary

### Owns

- `packages/store` read access for persisted provider-call rows.
- `packages/harness-contracts` usage payload schema.
- `services/harness` session-detail assembly for the usage snapshot.
- `packages/harness-core` untitled-session auto-naming on first user post.
- `apps/web/src/pages/Session.tsx` header rendering for usage/context telemetry.

### Does Not Own

- Provider-side usage collection itself; Phase 3.1 already owns that write path.
- Pricing catalogs or spend estimation.
- A provider-native tokenizer abstraction.
- File-tree APIs.
- Session title editing UX.

## Contracts

### Input Contract

- `harness_provider_calls` rows for the current session.
- Active, non-archived session messages and parts.
- The active provider/model ids on the session row.
- Provider-registry model metadata for `contextWindow`.

### Output Contract

- `GET /api/v1/sessions/:id` now includes `usage?: SessionUsageSnapshot`.
- The web session header renders:
  - `session I/O in X / out Y` when provider usage exists
  - `context A / B` when the model window is known
  - `context A est` when the denominator is unknown
  - `usage Z%` when utilization can be computed
- Untitled sessions acquire a human-readable title from the first user prompt.

### Error Contract

- Missing provider usage is not an error; `inputTokens` and `outputTokens` are `null`.
- Unknown models are not an error; `contextWindow` and `contextUtilization` are `null`.
- Blank or whitespace-only first messages do not produce an auto-title.

## Execution Flow

1. Read provider-call rows back out of `project.db`.
2. Sum known `prompt_tokens` and `completion_tokens` for the session.
3. Estimate current active-context usage from the non-archived message list.
4. Resolve the model's context window from the active provider catalog when possible.
5. Return the assembled `usage` object from `GET /api/v1/sessions/:id`.
6. Render the snapshot in the web session header and invalidate the session/session-list queries on send and turn completion.
7. On the first user message of an untitled session, derive and persist the auto-title before the message insert proceeds.

## File Plan

Create:

- `devdocs/roadmap/version-3/phases/phase-3.5.1-web-ui-qol-and-session-telemetry.md`

Modify:

- `packages/store/src/project-store-harness.ts` — add provider-call row mapping + list accessor.
- `packages/store/src/project-store.ts` — expose `listHarnessProviderCalls(sessionId)`.
- `packages/harness-core/src/harness.ts` — derive and persist auto-title for untitled sessions on first user post.
- `packages/harness-contracts/src/schemas.ts` — add `SessionUsageSnapshot`.
- `services/harness/src/server.ts` — compute usage snapshot and attach it to session-detail responses.
- `apps/web/src/api-types.ts` — re-export the shared usage type.
- `apps/web/src/pages/Session.tsx` — render the usage snapshot and tighten query invalidation.
- `test/smoke/harness-no-agent.ts` — assert first-message auto-title behavior.
- `test/smoke/harness-cloud-agent.ts` — assert persisted provider token counts and auto-title behavior.

## Verification

Required commands:

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/harness-no-agent.ts`
- `node --import tsx test/smoke/harness-cloud-agent.ts`

Required runtime checks:

- Create an untitled no-agent session, post a first user message, and confirm the session title becomes the normalized prompt text.
- Create a cloud-agent session where the provider reports usage, then confirm the persisted provider call includes prompt/completion tokens and the session-detail response aggregates them.
- Confirm the session header renders context usage even when no provider counts exist.
- Confirm custom or unknown models degrade to `contextWindow = null` without failing the page.

## Done When

- Untitled sessions auto-name from the first user message.
- Explicit session titles remain untouched.
- `GET /api/v1/sessions/:id` returns a shared `SessionUsageSnapshot`.
- The web session header shows session I/O totals when present and context occupancy when known.
- No-agent sessions still work and simply omit provider I/O totals.
- No new migration is required.
- Typecheck plus the focused no-agent and cloud-agent smokes pass.

## Risks And Watchouts

- **Provider usage metadata is optional.** Some providers or adapters may not populate usage; the UI must tolerate `null`.
- **The context estimate is approximate.** It is useful for UX and compaction awareness, but it should not be treated as billing-grade truth.
- **Unknown custom models have no denominator.** The dashboard must handle `contextWindow = null` without implying a percentage.
- **Weak first prompts make weak titles.** Titles like `hi` are allowed in 3.5.1 because the rule is deterministic and cheap; smarter retitling is future work.

## QoL Backlog After 3.5.1

- Manual session rename from the UI.
- Re-title weak first-message names after a more descriptive later prompt.
- Turn-level usage and latency chips in the timeline.
- Context-threshold warnings as a session nears compaction.
- Draft autosave per session.
- Keyboard shortcuts for resend, interrupt, and session switching.
- The read-only file tree deferred from 3.5.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.1-provider-layer.md](./phase-3.1-provider-layer.md)
- [./phase-3.4-subagents-compaction-resume.md](./phase-3.4-subagents-compaction-resume.md)
- [./phase-3.5-web-ui-alpha.md](./phase-3.5-web-ui-alpha.md)
- [./phase-3.6-investigation-composers.md](./phase-3.6-investigation-composers.md)

## Deviations From Spec At Ship Time

This file was written against the shipped implementation rather than an earlier draft. The main intentional limits are part of the phase definition itself:

1. **No browser-specific golden was added for 3.5.1.** Verification rides on typecheck plus focused harness smokes because the web change is a pure consumer of the existing session-detail route.
2. **Context occupancy is estimate-based.** Phase 3.5.1 does not add a universal tokenizer or provider-specific `countTokens` abstraction.
3. **Auto-title is one-shot.** The first user message can name the session, but the phase does not attempt later title refinement.
