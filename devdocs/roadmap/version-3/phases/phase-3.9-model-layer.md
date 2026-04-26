# Phase 3.9 Model Layer

Status: `Complete` (shipped 2026-04-18)

This file is the canonical planning doc for Roadmap 3 Phase 3.9. Phase 3.8 closed the website-improvements arc; 3.9 is the follow-up arc that turns the model layer from a hand-curated catalog into a live, cost-aware, locally-discoverable surface.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use [../handoff.md](../handoff.md) for the current execution target. Use [./phase-3.1-provider-layer.md](./phase-3.1-provider-layer.md) and [./phase-3.8-website-improvements.md](./phase-3.8-website-improvements.md) as the shipped substrate this phase builds on.

## Prerequisites

Phase 3.9 requires these earlier phases complete:

- **Phase 3.1 - Provider Layer.** BYOK providers, layered key resolution, fallback chains, and the bundled `BUNDLED_CATALOG` in `packages/harness-contracts/models/`.
- **Phase 3.8 - Website Improvements.** The Providers page Defaults section (`AxisDefaultsCard`), the `GET / PUT /api/v1/defaults` endpoint, and the persistent agent/embedding axis system 3.9 will write into.

If either is not in place, this phase should not start.

## Goal

Make the model layer self-maintaining and cost-aware:

- replace the hand-curated `BUNDLED_CATALOG` with a live fetch from `models.dev` plus a built-in snapshot for offline mode
- discover locally-installed Ollama and LM Studio models at request time so the Providers UI dropdowns reflect what the operator actually has, not what mako shipped knowing about
- plumb provider cost metadata through `provider_calls` so per-session spend is queryable and surfaceable
- record full per-call telemetry (input / output / reasoning / cache.read / cache.write tokens + cost + caller-kind) and surface a usage rollup grouped by model and by agent-vs-chat
- fold in a few narrow operator affordances that directly support the model/provider work: per-session draft persistence, a compact context meter near the composer, an inline provider-health banner, and latest-user-activity session sorting
- keep the BYOK rule, the no-agent tier, and the transport-agnostic core intact

This is primarily a model-layer phase, not a chat redesign. The Providers page and TopBar agent chip already exist; 3.9 mostly feeds them better data, plus a few small reliability/clarity affordances in the shipped web session surface.

## Why This Phase Exists

Three independent pain points point at the same fix:

1. **Catalog drift.** `BUNDLED_CATALOG` ships frozen with each mako release. New models (GPT-5.5, Claude 4.x, Gemini 3, Kimi-K2, etc.) appear constantly; the catalog goes stale within weeks of a release. opencode solved the same problem by pulling from [models.dev](https://models.dev/api.json) — a community-maintained registry with provider, model, context window, cost, capability flags. Cache + ship a snapshot for offline.
2. **Local model dropdowns are wrong.** The Providers page Defaults section's "Local" picker shows whatever `BUNDLED_CATALOG` declares for ollama / lmstudio, not whatever the operator has installed. `extensions/ollama/src/index.ts::discoverOllamaModels()` and `extensions/lmstudio/src/index.ts::discoverLmStudioModels()` already exist and call `/api/tags` and `/v1/models` respectively — they just aren't wired into `GET /api/v1/providers`.
3. **No cost telemetry.** Provider calls are persisted in `harness_provider_calls` (rows include prompt/completion tokens) but mako doesn't record cost-per-token alongside them. With models.dev metadata in hand, we can compute and persist per-call cost and surface session-level + project-level totals.

3.9 lands all three together because they share the same metadata source.

## Hard Decisions

1. **models.dev for cloud, runtime discovery for local.**
   Different providers want different sources of truth. Cloud providers ship known model lists with stable metadata that's valuable to know in advance (cost, context window, modalities, tool-call support). Local daemons ship whatever the operator pulled. The hybrid is: cloud providers get their `models[]` from the merged catalog (models.dev → snapshot → bundled fallback); local providers (ollama, lmstudio, and any openai-compatible provider explicitly marked `tier: "local"`) get `models[]` overridden at request time from the live daemon endpoint, falling back to whatever the catalog has when the daemon is down.

2. **Bundled snapshot is the floor, not the ceiling.**
   The CLI ships a `models-snapshot.json` baked at build time. At runtime mako tries to refresh from models.dev with a 5-minute TTL; if the fetch fails, the snapshot answers. If the snapshot is missing too, the bundled `BUNDLED_CATALOG` is the last fallback. Three tiers; never errors at the user.

3. **Cost is metadata, not a billing surface.**
   3.9 records cost per `provider_calls` row and surfaces it as a session/project read-only summary. mako does NOT host a billing layer, NOT push cost to a server, NOT proxy provider calls. The cost number is a local telemetry feature so the operator can see "this session spent $0.42" — that's it.

4. **`caller_kind` tracks origin, not model-selection strategy.**
   `chat` means a turn originated from the Vite web chat surface. `agent` means a turn originated from a non-web agent client/runtime (Codex, Claude Code, OpenCode, MCP-style callers, future backend automation). Defaults-vs-explicit-model selection is a separate concern and is not encoded in `caller_kind`.

5. **The Defaults system stays unchanged.**
   No schema changes to `defaults.{agent,embedding}.{cloud,local,prefer}`. The ResolveAxis logic from 3.8 keeps working. 3.9 just feeds richer model lists into the dropdowns it already renders.

6. **Steal small affordances, not architecture.**
   3.9 may fold in a few small, high-signal web affordances from adjacent tools where they directly improve operator clarity: per-session draft persistence, a compact context meter near the composer, an inline provider-health banner, and latest-user-activity sorting in the session list. Do not import another product's chat architecture wholesale, and do not add sidebar project grouping — mako already has explicit project scoping.

7. **Snapshot ships in-bundle, not as a downloaded asset.**
   The CLI is currently a single `dist/index.js` from tsup. We add `models-snapshot.json` as a sibling asset (like the `tree-sitter-typescript.wasm` files already shipped) and resolve it via `import.meta.url`. Keeps the install story unchanged.

## Scope In

### 1. models.dev catalog fetch

Build:

- `packages/harness-contracts/src/models-dev.ts` (or similar) with:
  - typed schema for the models.dev API response (provider + model objects, cost, limits, modalities, tool_call, etc.)
  - `fetchCatalog(url, signal): Promise<ParsedCatalog>` with 10s timeout
  - `loadCachedCatalog(cachePath): ParsedCatalog | null` with 5-minute TTL freshness check
  - `loadSnapshotCatalog(): ParsedCatalog | null` reading the bundled JSON
  - `loadBundledCatalog(): ParsedCatalog` reading the existing `BUNDLED_CATALOG` (always succeeds)
- composer in `packages/harness-core` (`catalog-source.ts`) that returns the best available catalog: cache → fresh fetch → snapshot → bundled, with a `source: "cache" | "fresh" | "snapshot" | "bundled"` tag
- env override `MAKO_MODELS_DEV_URL` (default `https://models.dev`) and `MAKO_DISABLE_MODELS_FETCH=true` (offline mode short-circuit, snapshot/bundled only)
- cache file at `~/.mako-ai/cache/models-dev.json`
- build-time script `apps/cli/scripts/snapshot-models.ts` that fetches the latest models.dev payload and refreshes `packages/harness-contracts/models/snapshot.json`; the CLI build then copies that snapshot into `apps/cli/dist/models-snapshot.json`

Result:

- Cloud provider model lists update without a mako release, while offline / first-install operators get a working catalog from the bundled snapshot.

### 2. Local model discovery wiring

Build:

- `services/harness/src/server.ts` GET /api/v1/providers handler:
  - for each provider entry, if `spec.id` is `ollama` or `ollama-cloud`, call `discoverOllamaModels(baseURL)` and override the response's `spec.models[]` with `{ id, displayName: id, contextWindow: 0, supportsTools: true }` entries when discovery succeeds
  - same for `lmstudio` via `discoverLmStudioModels(baseURL)`
  - for any provider with `spec.transport === "openai-compatible"` and `spec.tier === "local"`, attempt the `/v1/models` probe and merge results in
  - cache discovery results for 30 seconds to keep dashboard polls (they fire every 15s) cheap
  - on discovery failure, leave `spec.models[]` as the catalog has it — never blank out the dropdown
- new `discovered: true` flag on each model entry the UI can render as a small dot ("installed") so operators distinguish discovered-from-daemon vs catalog entries
- a probe-status field on the provider response (`localProbe: { ok: boolean, models: number, error?: string }`) so the operator can see "ollama is up but you haven't pulled any models yet"

Result:

- The Providers page Defaults section's Local dropdown shows real installed models. New `ollama pull qwen3:32b` appears on the next dashboard poll without a restart.

### 3. Cost telemetry + usage table

Pattern lifted from opencode (`packages/opencode/src/cli/cmd/stats.ts` + `session/message.ts`): persist per-call token + cost detail at write time, then aggregate group-by-model on read. mako adds one dimension opencode doesn't need: `caller_kind: "agent" | "chat"` to distinguish turns initiated from the Vite web chat surface from turns initiated by non-web agent clients/runtimes. opencode collapses these because opencode IS the agent; mako has both a browser chat surface and external agent callers, so the origin split is load-bearing.

Build:

- migration `0017_provider_calls_usage.sql` adding columns to `harness_provider_calls`:
  - `reasoning_tokens INTEGER DEFAULT NULL` — for reasoning-capable models (Claude 3.7, GPT-o-series)
  - `cache_read_tokens INTEGER DEFAULT NULL`
  - `cache_write_tokens INTEGER DEFAULT NULL`
  - `cost_usd_micro INTEGER DEFAULT NULL` — micro-USD (1 USD = 1_000_000) to avoid float drift
  - `caller_kind TEXT DEFAULT 'chat' CHECK(caller_kind IN ('agent','chat'))` — `chat` for turns initiated from the Vite web chat UI; `agent` for non-web agent clients/runtimes (Codex, Claude Code, OpenCode, MCP-style callers, backend automation). Default `chat` keeps existing rows safely classified.
- `packages/harness-core/src/cost.ts`:
  - `lookupModelCost(catalog, providerId, modelId): { input?: number, output?: number, cacheRead?: number, cacheWrite?: number } | null` (per-million-token rates from models.dev)
  - `computeCallCostMicro({ promptTokens, completionTokens, cacheReadTokens?, cacheWriteTokens? }, rates): number | null`
- `Harness.recordProviderCall(...)` updated to:
  - accept `caller: { kind: "agent" | "chat" }` from the call site (`chat` from the web session UI; `agent` from agent clients/runtimes and backend automation)
  - compute cost from the active catalog at write time and persist in `cost_usd_micro` (rate at-write-time, never backfilled — keeps history accurate to what was true when the call happened)
- `services/harness/src/server.ts`:
  - `/api/v1/sessions/:id` response augmented with `usage.costUsdMicro` + the broader token breakdown (reasoning, cache.read, cache.write)
  - new `GET /api/v1/usage` endpoint — accepts `?since=<iso>` (default: 30 days), `?project_id=<id>`, `?group_by=model|kind|model+kind` (default: model+kind). Returns rolled-up rows of `{ providerId, modelId, callerKind, calls, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, costUsdMicro }`.
- `services/api/src/routes/projects.ts` per-project status response augmented with `costUsdMicro30d` (30-day rolling sum) so the dashboard can show project-level spend
- `apps/web/src/pages/Session.tsx` header chip rendering `$0.42` next to the existing in/out token counts when cost is known
- `apps/web/src/pages/Usage.tsx` (new route `/usage`) — renders the `/api/v1/usage` rollup as a table with model + agent/chat columns + token breakdown + cost; date-range picker (24h / 7d / 30d / all-time); optional project filter; sortable columns. Mirrors opencode's `agentmako stats` output but as a web surface.
- `apps/cli/src/commands/usage.ts` — `agentmako usage [--days N] [--project PATH]` CLI mirror of the same data, formatted as a table.

Result:

- Per-session cost visible in the session header.
- Per-project rolling cost visible on the dashboard.
- `/usage` page (and `agentmako usage`) shows the full breakdown: which models are running, agent vs chat split, token volume, dollar spend.
- No external billing surface; everything stays local to `project.db`.

### 6. Narrow web affordances that support operator clarity

Build:

- `apps/web/src/components/PromptInput.tsx` persists unsent draft text per session with a debounced browser-store write (~250-300ms) plus a final `beforeunload` flush; successful send clears the draft
- `apps/web/src/pages/Session.tsx` replaces the text-only context utilization readout with a compact meter near the composer while keeping raw totals available as secondary text or a tooltip/popover
- `apps/web/src/pages/Session.tsx` shows an inline provider-health banner when the active session provider/model is degraded, unreachable, or no longer present in the current provider state
- `apps/web/src/components/SessionListNav.tsx` sorts sessions by latest user activity instead of trusting raw API order

Result:

- Reloading or route changes no longer drop an unsent prompt.
- Context pressure is easier to read during composition.
- Provider/model degradation is obvious in the chat where it matters.
- The session list reflects where the user actually worked most recently.

### 4. Catalog source visibility

Build:

- `GET /api/v1/catalog/status` returning `{ source: "cache" | "fresh" | "snapshot" | "bundled", lastFetchAt: ISO | null, modelCount: number, providerCount: number, ttlSecondsRemaining: number | null }`
- a small "Catalog: <source> · refreshed Xm ago" line on the Providers page so operators know whether the dropdown reflects yesterday's snapshot or today's models.dev fetch
- a `Refresh` button next to that line that POSTs `/api/v1/catalog/refresh` to force a re-fetch

Result:

- The catalog source isn't a black box — operators see what version of the truth they're looking at and can force a refresh.

### 5. CLI surface

Build:

- `agentmako catalog status` — same JSON as the GET endpoint
- `agentmako catalog refresh [--force]` — wraps the refresh endpoint
- `agentmako providers list` already exists; extend its output to include the per-provider local-discovery probe status

## Scope Out

- billing or cost-aggregation across users (mako is single-user)
- provider auto-keying (mako stays BYOK)
- writing refreshed catalog data back to git at runtime; the committed snapshot is updated only by the explicit snapshot script and then copied into the CLI build
- changing the `defaults.{agent,embedding}` schema (3.8's data model stays as-is)
- model RECOMMENDATIONS — mako doesn't tell the operator which model to pick, just shows what's available
- per-token cost prediction before a call fires (post-hoc accounting only)
- sidebar project grouping; project scope already lives in the explicit selected-project model from 3.8

## Architecture Boundary

### Owns

- `packages/harness-contracts/src/models-dev.ts` (new — typed catalog source)
- `packages/harness-core/src/catalog-source.ts` (new — fetch/cache/snapshot/bundled composer)
- `packages/harness-core/src/cost.ts` (new — cost lookup + computation)
- `apps/cli/scripts/snapshot-models.ts` (new — build-time snapshot writer)
- `apps/cli/dist/models-snapshot.json` (build artifact)
- `services/harness/src/server.ts` (extends `/api/v1/providers`, adds `/api/v1/catalog/*`)
- `services/api/src/routes/projects.ts` (adds rolling cost field to status)
- `packages/store/src/migration-sql.ts` (new migration for `cost_usd_micro`)
- `apps/web/src/pages/Providers.tsx` (catalog source line)
- `apps/web/src/pages/Session.tsx` (session-level cost chip)
- `apps/web/src/components/PromptInput.tsx` (per-session draft persistence)
- `apps/web/src/components/SessionListNav.tsx` (latest-user-activity sort)

### Does Not Own

- the existing Defaults system (`AxisDefaultsCard`, `defaults-store.ts`, `resolveAxis`) from 3.8
- the BYOK key resolution chain from 3.1
- composer evidence contracts or any agent loop changes
- any UI redesign or sidebar project grouping

## Execution Flow

1. Schema: new migration adding `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd_micro`, `caller_kind` to `harness_provider_calls`. All additive.
2. Catalog source layer in `packages/harness-contracts` + `packages/harness-core`. Pure functions; no transport. Unit testable.
3. Build-time snapshot script + tsup integration.
4. `/api/v1/providers` updated to discover local models with TTL cache.
5. `/api/v1/catalog/status` + `/api/v1/catalog/refresh` endpoints.
6. Cost + token-breakdown computation hook into `Harness.recordProviderCall(...)`. Caller-kind threaded through every call site (`chat` from the web session UI; `agent` from non-web agent clients/runtimes and backend automation).
7. Session usage response carries cost; web Session header renders it.
8. Project status carries 30d cost; dashboard renders it.
9. New `GET /api/v1/usage` endpoint with model / kind / model+kind groupings.
10. New `/usage` web route + `agentmako usage` CLI command rendering the rollup.
11. Web session affordances land: per-session draft persistence, compact context meter, provider-health banner, latest-user-activity sort.
12. Providers page renders catalog source line + refresh button.
13. CLI commands: `agentmako catalog status / refresh`.
14. Smokes: catalog-source-fallback, local-discovery, cost-recording, usage-aggregation, web-session-affordances.

## File Plan

### Modify

- `services/harness/src/server.ts`
- `services/api/src/routes/projects.ts`
- `services/api/src/service.ts`
- `packages/harness-core/src/harness.ts` (provider-call recording)
- `packages/harness-core/src/index.ts` (re-exports)
- `packages/store/src/migration-sql.ts`
- `packages/store/src/project-store-harness.ts`
- `apps/web/src/pages/Providers.tsx`
- `apps/web/src/pages/Session.tsx`
- `apps/web/src/pages/Home.tsx` (project cards show 30d cost)
- `apps/web/src/components/PromptInput.tsx`
- `apps/web/src/components/SessionListNav.tsx`
- `apps/cli/src/index.ts`
- `apps/cli/src/shared.ts`
- `apps/cli/tsup.config.ts` (snapshot copy step)
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md`
- `devdocs/roadmap/version-3/phases/README.md`

### Create

- `packages/harness-contracts/src/models-dev.ts`
- `packages/harness-contracts/models/snapshot.json` (committed snapshot for source-tree consumers)
- `packages/harness-core/src/catalog-source.ts`
- `packages/harness-core/src/cost.ts`
- `packages/harness-core/src/usage-aggregation.ts`
- `apps/cli/scripts/snapshot-models.ts`
- `apps/cli/src/commands/catalog.ts`
- `apps/cli/src/commands/usage.ts`
- `apps/web/src/pages/Usage.tsx`
- `test/smoke/harness-catalog-source.ts`
- `test/smoke/harness-local-discovery.ts`
- `test/smoke/harness-cost-recording.ts`
- `test/smoke/harness-usage-aggregation.ts`
- `test/smoke/web-session-affordances.ts`

### Reuse As-Is Unless Forced

- `extensions/ollama/src/index.ts` (`discoverOllamaModels` already exists)
- `extensions/lmstudio/src/index.ts` (`discoverLmStudioModels` already exists)
- `packages/harness-contracts/models/catalog.json` (still loaded as the bundled fallback)
- `packages/config/src/defaults-store.ts` (3.8 axis system, untouched)
- `apps/web/src/components/AxisDefaultsCard.tsx` (consumes whatever models the API returns)

## Verification

Required:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke` (existing chain stays green)

New required smokes:

- `harness-catalog-source` — verify the four-tier fallback returns a non-empty catalog under each scenario (cache present, cache stale + fetch ok, cache stale + fetch fails + snapshot present, all sources gone except bundled)
- `harness-local-discovery` — when ollama is reachable, `GET /api/v1/providers` returns the daemon's `/api/tags` model list; when down, returns the catalog list and `localProbe.ok === false`
- `harness-cost-recording` — a no-agent or live provider call writes non-null `cost_usd_micro` and `caller_kind` for known cloud models; verify the web chat path tags `chat` and the agent-client path tags `agent`
- `harness-usage-aggregation` — seeded `harness_provider_calls` with a mix of agent + chat + multi-model rows produces correct rollups under each `group_by` mode
- `web-session-affordances` — draft text survives reload for the active session, clears on successful send, provider degradation renders an inline banner, and the session list reorders by latest user activity

Manual acceptance:

1. With ollama running and `qwen3:8b` pulled, the Providers page Defaults Local dropdown for the Agent axis shows `qwen3:8b` (and not whatever the bundled catalog had).
2. Pull a brand-new model (`ollama pull mistral-small`) → it appears within ~30s without restarting mako.
3. Stop ollama → Local dropdown still works (shows catalog list with a "daemon offline" indicator).
4. Toggle `prefer: cloud` with a configured Anthropic key → session header shows `$0.0X` after a Claude turn completes.
5. The Providers page footer reads `Catalog: fresh · refreshed 2m ago` (or `snapshot` when offline). Click `Refresh` → re-fetches and the line updates.
6. Open `/usage` → see a table with one row per (provider/model, agent|chat) combination, summing input/output/reasoning/cache tokens + cost across the chosen window. Date-range chips (24h / 7d / 30d / all) reshape the rollup live.
7. Run `agentmako usage --days 7` → CLI mirror of the same rollup as a sortable text table.
8. Type into a session composer, reload the page, and confirm the unsent draft is restored only for that session. Send successfully → the draft clears.
9. Drive the active provider into a degraded/unreachable state → the session chat renders an inline provider-health banner rather than silently failing later.
10. Trigger a composer (`agentmako answer ask …` or a future backend agent path) → its provider call appears under `caller_kind: agent`. Send a turn from the Vite web chat surface → that call appears under `caller_kind: chat`.

## Done When

- the Providers page Local dropdowns reflect what the local daemon has installed, not the bundled catalog
- new model releases on models.dev appear in mako within 5 minutes (or after `agentmako catalog refresh`)
- per-session and per-project costs render in the dashboard from `cost_usd_micro` records
- `/usage` page and `agentmako usage` show per-model, per-(agent|chat) rollups of tokens + cost
- every `harness_provider_calls` row written by 3.9+ carries a `caller_kind` value
- offline mode (no network on first run) still works because of the bundled snapshot
- the session surface keeps unsent drafts, shows provider degradation inline, renders a compact context meter near the composer, and the session list sorts by latest user activity
- new smokes pass; existing smoke chain stays green

## Risks And Watchouts

- **Catalog source ambiguity.** If three sources can answer the catalog query, surface which one did. The `/api/v1/catalog/status` endpoint and the Providers page line exist precisely to keep the source visible.
- **Local-discovery flakiness.** Probing the daemon every dashboard poll (~15s) could thrash on slow machines. The 30s discovery cache exists for that; verify it under realistic poll cadence.
- **Cost rate drift.** models.dev's costs occasionally update (Anthropic recently moved Claude 4.x rates). Cost recording uses the catalog rate at write time, so old `provider_calls` rows stay accurate to what was true when the call happened. Don't backfill.
- **Snapshot bloat.** models.dev's payload is ~200KB+ and growing. Watch the CLI bundle size — the existing budget is ~1.5MB. If the snapshot pushes us past 2MB, switch to gzip + decompress at startup.
- **Privacy.** Cost telemetry stays local. Never POST cost data anywhere off the operator's machine. Same BYOK guarantee as the rest of mako.

## Deviations From Spec At Ship Time

1. **Catalog fetch + cache helpers live in `harness-core`, not `harness-contracts`.** The plan placed `fetchCatalog` / `loadCachedCatalog` / `loadSnapshotCatalog` in `packages/harness-contracts/src/models-dev.ts`. Shipped split: `harness-contracts/src/models-dev.ts` owns only the zod wire schema + pure coercers (`coerceModelsDevPayload`, `parsedCatalogFromProviders`); `harness-core/src/catalog-source.ts` owns the fs/network loaders and the composer. Reason: the contracts package is consumed by the web app for types, and keeping it free of `node:fs` / `node:os` imports preserves that browser-safety property without relying on tree-shaking.

2. **Local discovery probes live in `services/harness`, reusing the extension helpers.** `services/harness/package.json` gained two workspace deps (`@mako-ai/extension-ollama`, `@mako-ai/extension-lmstudio`) so `GET /api/v1/providers` imports `discoverOllamaModels` / `discoverLmStudioModels` directly. The `openai-compatible` + `tier: "local"` case ships as a generic `/v1/models` probe inline in the server (no separate extension helper existed to reuse).

3. **`discovered: true` is a structural extra field on model entries, not a schema change.** `ModelSpecSchema` wasn't tightened to include it; the field rides through as a structural extra on the wire response and the web renders it as-is. Keeps the bundled-catalog + custom-provider rows round-trip-safe with the existing Zod parsing path.

4. **Snapshot composer writes a round-tripped payload on fresh-fetch success, not the raw upstream body.** The implementation chose to re-serialize the parsed `ParsedCatalog` back into a models.dev-shaped payload via `toRawPayload(...)` before writing the cache file, rather than teeing the response stream twice. Lossy on upstream passthrough fields we don't consume, but round-trips every field the composer reads on the next load. If the list of consumed fields grows, switch the cache write to store the raw response body.

5. **Snapshot file ships as an empty placeholder; the build-time script is the way to populate it.** `packages/harness-contracts/models/snapshot.json` at ship time contains only a `__comment` field, so the loader correctly falls through to `BUNDLED_CATALOG`. Running `node --import tsx apps/cli/scripts/snapshot-models.ts` against `https://models.dev/api.json` populates it before `corepack pnpm build`; the tsup `onSuccess` hook then copies it into `apps/cli/dist/models-snapshot.json`. This keeps source-tree state small and makes snapshot refresh an explicit operator action rather than a build-network dependency.

6. **Cost fallback multipliers mirror opencode's convention when cache rates aren't listed.** When a model's catalog entry has `cost.input` but no explicit `cache_read` / `cache_write` rate, `computeCallCostMicro` falls back to `input * 0.1` for cache-read and `input * 1.25` for cache-write — the ratios most providers advertise in practice. Explicit catalog rates always win.

7. **`caller_kind` defaults to `"chat"` at the server boundary, not at the harness boundary.** `PostMessageRequestSchema` accepts an optional `caller.kind` and defaults to `"chat"` when omitted; the harness's `postMessage(sessionId, content, options?)` signature is what the public API contract says. Non-web callers (Codex, Claude Code, sub-agent spawns) set `{ caller: { kind: "agent" } }`. The sub-agent tool path inside `harness-core` hardcodes `"agent"` so a web-originated chat that spawns a sub-agent still classifies its inner calls as agent-origin.

8. **Token breakdown extraction is best-effort across ai SDK v4 providerMetadata shapes.** `extractTokenBreakdown(...)` defensively reads `reasoningTokens`, `cachedInputTokens`, `providerMetadata.*.cacheReadInputTokens`, `providerMetadata.*.cacheCreationInputTokens`, and `providerMetadata.*.cachedPromptTokens` — the union of names Anthropic, OpenAI, and the ai SDK v4 core expose. Fields that aren't present stay null rather than defaulting to 0, so the `/usage` UI can distinguish "no data" from "actually zero."

9. **Project 30-day cost is read directly from `harness_provider_calls` on every `GET /api/v1/projects/status`.** No cache. The query is `SUM(cost_usd_micro) JOIN harness_sessions WHERE project_id = ? AND created_at >= ?` which is O(rows) in a 30-day window — trivial at expected volume. If the dashboard ever starts polling hot, introduce a 60s status cache in `services/api` rather than caching at the store layer.

10. **`/usage` rollup excludes failed calls from totals.** `listHarnessProviderCallsForUsageImpl` filters on `ok = 1`. Errored rows are still persisted on the session detail view and remain inspectable through direct session queries; they just don't distort the "how much am I spending on Anthropic" number.

11. **Web affordances: context meter is merged with the existing usage readout rather than placed separately.** The plan described a "compact context meter near the composer while keeping raw totals available as secondary text or a tooltip." Shipped: a 1px colored bar on top of the existing secondary-text readout, color-coded at 70% / 90% utilization (signal → warn → danger). The cache-read/write and reasoning tokens also surface here when non-zero so operators can see what's actually being charged for.

12. **Provider-health banner fires on three conditions.** Not present in providers list → error-level ("no longer registered"). Local + reachable=false → warn-level ("daemon offline"). Cloud + keyResolved=false → error-level ("no API key"). Known-provider + unknown-active-model → warn-level ("model no longer listed"). The banner cross-references `/api/v1/providers` (refetching every 30s) so transient daemon blips self-heal without a page reload.

13. **Session list sort uses `updatedAt` (not a new column).** The plan framed this as "latest user activity." Shipped implementation sorts by the existing `harness_sessions.updated_at` column, which gets touched on every `postMessage(...)` and on status transitions. Close enough to "where the user actually worked most recently" without a new migration.

14. **New workspace dependency chain stays small.** `services/harness` gained `@mako-ai/extension-ollama` + `@mako-ai/extension-lmstudio` as workspace deps; those extensions already depended only on `@mako-ai/harness-contracts` + `@mako-ai/sdk`, so no cycle. Root `tsconfig.json` already referenced both extensions from prior phases.

15. **Four deterministic smokes shipped, one playwright smoke.** The plan called for five new smokes. Four (`harness-catalog-source`, `harness-local-discovery`, `harness-cost-recording`, `harness-usage-aggregation`) wire into `pnpm run test:smoke` as deterministic Node smokes. `web-session-affordances` wires into `pnpm run test:smoke:web` and follows the existing pattern of skipping cleanly when the API + harness + web aren't all reachable — the same model `web-harness-shell` and `web-semantic-search` use.
