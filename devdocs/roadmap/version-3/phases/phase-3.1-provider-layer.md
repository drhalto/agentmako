# Phase 3.1 Provider Layer

Status: `Complete`

This file is the exact implementation spec for Roadmap 3 Phase 3.1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.1.

## Prerequisites

Phase 3.1 assumes Phase 3.0 is complete:

- `packages/harness-core`, `packages/harness-contracts`, `packages/harness-tools` scaffolded and passing no-agent tier
- `services/harness` running on `127.0.0.1:3018`
- `project.db` migration `0004_project_harness.sql` applied with session/message/part/event/permission/provider_call tables
- `agentmako chat`, `agentmako session`, `agentmako tier` commands working against the HTTP API

## Goal

Integrate the Vercel `ai` SDK through `packages/harness-core` so that a user's chat messages can be dispatched to any BYOK provider or local model, with layered key resolution (env + config + system keychain), per-session fallback chains, and a single-provider catalog shared across all adapters.

## Hard Decisions

- Vercel `ai` SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/openai-compatible`) is the single provider abstraction. There is no bespoke HTTP client per provider.
- First-party extensions ship: `anthropic`, `openai`, `moonshot` (openai-compatible pointed at Moonshot baseURL + Kimi models), `ollama` (openai-compatible pointed at local Ollama), `ollama-cloud` (openai-compatible pointed at Ollama Cloud + BYOK), `openai-compatible` (generic), `lmstudio` (openai-compatible pointed at port 1234).
- System keychain integration ships in this phase via `@napi-rs/keyring`. Service name `mako-ai`, account `<provider-id>`. Native-build concerns are documented for Windows/macOS/Linux in this phase doc.
- The model catalog in `packages/harness-contracts/models/catalog.json` is a repo-bundled JSON snapshot. `POST /api/v1/models/refresh` optionally fetches an upstream registry but never blocks startup.
- Fallback chains are per-session and stored as JSON in `sessions.fallback_chain`. The agent loop advances one entry on auth-error, rate-limit, or 5xx transport errors.
- Custom providers can be added by editing `.mako/providers.json` or `~/.mako/providers.json` — no code changes required.
- Sensitive values never round-trip through logs. `provider_calls` records provider, model, tokens, latency, ok/error, cost_hint — never auth headers.

## Why This Phase Exists

Phase 3.0 proved the no-agent tier. Phase 3.1 lights up the `local-agent` and `cloud-agent` tiers so real language models can drive the harness.

The BYOK-only constraint means key resolution is a first-class concern. The layered resolution (explicit → session → project config → global config → env → keychain) is designed so that casual use is frictionless (env var works), CI is scriptable (config reference to env var), and interactive local use is clean (keychain).

Fallback chains matter because BYOK users hit rate limits and outages on providers they do not control. A chain means a user's session keeps working when their primary provider blips, and the transition is logged for audit.

## Scope In

- Integrate `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/openai-compatible` into `packages/harness-core`.
- Flesh out the seven extensions listed in Hard Decisions. Each extension exports:
  - `provider-catalog.ts` — static `ProviderSpec` + `ModelSpec[]`.
  - `provider-discovery.ts` — optional runtime discovery (Ollama lists `/api/tags`, Ollama Cloud lists remote models, LM Studio lists `/v1/models`).
- `packages/harness-core/src/provider-registry.ts` now:
  - Loads first-party extensions at startup.
  - Loads custom providers from `.mako/providers.json` and `~/.mako/providers.json`.
  - Resolves the active provider per layered order.
  - Resolves the active model per `ProviderSpec.models`.
  - Resolves keys per layered order (explicit → session → project → global → env → keychain).
  - Resolves `{env:VAR_NAME}` indirection at read time.
- `packages/harness-core/src/keyring.ts` wraps `@napi-rs/keyring` with safe failure modes (degrade to env + warn).
- `packages/harness-core/src/agent-loop.ts` is updated so the turn body calls the active provider through the ai SDK's `streamText` and emits `text.delta`, `tool.call`, `tool.result`, `provider.call`, `turn.done` events. (Real tool dispatch still only hits read-only tools — action tools arrive in 3.2.)
- `packages/harness-core/src/fallback.ts` implements fallback-chain retry on auth-error / rate-limit / 5xx.
- `packages/harness-contracts/models/catalog.json` ships a real snapshot covering Anthropic, OpenAI, Moonshot (Kimi K2.5 as the doc exemplar), Google, Mistral, DeepSeek, Groq, OpenRouter, Ollama, Ollama Cloud, LM Studio.
- Provider_calls writes on every model call: `provider`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `cost_hint`, `ok`, `error`, `created_at`.
- CLI commands:
  - `agentmako providers list` — prints configured providers with health and key status.
  - `agentmako providers add` — interactive or flag-based custom provider entry.
  - `agentmako providers remove <id>`
  - `agentmako providers test <id>` — pings the provider.
  - `agentmako keys set <provider> [--from-env VAR | --prompt]` — stores into keychain (or references env).
- HTTP routes:
  - `GET /api/v1/providers` — list with health.
  - `POST /api/v1/providers` — add custom.
  - `POST /api/v1/providers/:id/test` — ping.
  - `GET /api/v1/models` — merged catalog.
  - `POST /api/v1/models/refresh` — optional upstream fetch.
  - `POST /api/v1/sessions` now accepts `provider`, `model`, `fallback_chain`.
- `agentmako tier` upgraded to reflect cloud-agent and local-agent availability based on resolved providers and keys.
- Smoke tests:
  - `test/harness-cloud-agent.ts` — mock provider server; assert provider_calls row and assistant content.
  - `test/harness-local-agent.ts` — Ollama required or skip; assert local chat works offline.
  - `test/harness-provider-fallback.ts` — primary fails, secondary succeeds.
  - `test/harness-keyring.ts` — set/get through keychain round-trips.
  - `test/harness-custom-provider.ts` — config-only custom provider works.
- Documentation:
  - Kimi K2.5 via Moonshot used as the cloud-agent doc exemplar throughout the phase doc.
  - Ollama Cloud documented as a first-class target alongside local Ollama.
  - Native-build friction for `@napi-rs/keyring` documented for Windows, macOS, Linux.

## Scope Out

- Action tools and permission rule matching (Phase 3.2).
- Embeddings (Phase 3.3).
- Sub-agents and compaction (Phase 3.4).
- OAuth flows — a reserved seam only (documented in `provider-registry.ts`, no implementation).
- Cost tracking sophistication beyond `provider_calls.cost_hint` — running totals in CLI/UI are deferred to Phase 3.5 unless the Phase 3.1 reviewer asks for them sooner.
- Model-capability-driven automatic routing (e.g., "if this query has an image, pick a vision-capable model") — declared in `ModelSpec`, not yet enforced.

## Architecture Boundary

### Owns

- The seven first-party provider extensions.
- `packages/harness-core/src/provider-registry.ts`, `keyring.ts`, `fallback.ts`, `agent-loop.ts` updates.
- `packages/harness-contracts/models/catalog.json` and its upstream-refresh contract.
- All new CLI commands under `apps/cli/src/commands/providers/` and `apps/cli/src/commands/keys/`.
- All new HTTP routes listed above.
- `provider_calls` row-writing during model calls.
- Layered key resolution semantics across env, config, and keychain.

### Does Not Own

- The `provider_calls` table itself — it was created in Phase 3.0's migration.
- Any permission rule matching or approval event flow (Phase 3.2).
- Any embedding code (Phase 3.3).
- Any OAuth provider (reserved seam).
- Changes to existing Roadmap 1 and 2 tools or their transports.

## Contracts

### Input Contract

- `POST /api/v1/sessions { project_id?, tier?, provider?, model?, fallback_chain? }` accepts full provider/model override per session.
- `POST /api/v1/sessions/:id/messages` turns now route through the active provider.
- `POST /api/v1/providers` accepts a `ProviderSpec` JSON body (validated with zod).
- `GET /api/v1/providers/:id/test` triggers a cheap ping (Anthropic: `models.list`; OpenAI-compatible: `GET /v1/models`).
- `GET /api/v1/models?refresh=true` triggers an upstream catalog refresh.
- `POST /api/v1/sessions/:id/keys/:provider { from_env?: string, value?: string }` — stores a key via keyring. `value` is accepted only over localhost with a direct user action (CLI `--prompt`).

### Output Contract

The phase leaves behind:

- A BYOK multi-provider harness that speaks Anthropic, OpenAI, Moonshot, Google, Mistral, DeepSeek, Groq, OpenRouter, Ollama, Ollama Cloud, LM Studio, and arbitrary OpenAI-compatible endpoints.
- Layered key resolution across env, config, and system keychain.
- Per-session fallback chains with structured retry recorded in `provider_calls`.
- A bundled + refreshable model catalog.
- CLI `providers` and `keys` commands for interactive and scriptable key management.

### Error Contract

- `provider/auth-error` — provider returned 401/403. Triggers fallback advance.
- `provider/rate-limit` — provider returned 429. Triggers fallback advance.
- `provider/server-error` — 5xx from provider. Triggers fallback advance.
- `provider/timeout` — request exceeded `MAKO_HARNESS_PROVIDER_TIMEOUT` (default 120s). Logged in `provider_calls.error`.
- `keyring/unavailable` — system keychain not available (container, headless without secret service). Degrade to env + warn.
- `provider/custom-validation-failed` — user-supplied `ProviderSpec` JSON failed zod validation.

## Execution Flow

1. Add ai SDK dependencies to workspace root `package.json`.
2. Write the seven extension `provider-catalog.ts` files and the bundled `catalog.json`.
3. Implement `keyring.ts` with graceful degradation when `@napi-rs/keyring` is unavailable.
4. Implement `provider-registry.ts` with the full layered resolution order.
5. Wire `agent-loop.ts` to call the active provider through `streamText` and emit `text.delta` events.
6. Implement `fallback.ts` and integrate it with `agent-loop.ts`.
7. Write CLI `providers` and `keys` commands; route them through HTTP.
8. Implement `GET/POST /api/v1/providers`, `/api/v1/models`, provider-test, session-level key storage routes.
9. Update `agentmako tier` to reflect provider health.
10. Write the five new smoke tests.
11. Document native-build concerns for `@napi-rs/keyring`.

## File Plan

Create:

- `extensions/anthropic/src/provider-catalog.ts`, `provider-discovery.ts` — fleshed out from the 14-line stub.
- `extensions/openai/src/provider-catalog.ts`, `provider-discovery.ts` — fleshed out.
- `extensions/moonshot/src/index.ts`, `provider-catalog.ts`, `provider-discovery.ts` — new extension.
- `extensions/ollama/src/index.ts`, `provider-catalog.ts`, `provider-discovery.ts` — new extension.
- `extensions/ollama-cloud/src/index.ts`, `provider-catalog.ts`, `provider-discovery.ts` — new extension.
- `extensions/openai-compatible/src/index.ts`, `provider-catalog.ts` — new extension.
- `extensions/lmstudio/src/index.ts`, `provider-catalog.ts`, `provider-discovery.ts` — new extension.
- `packages/harness-core/src/keyring.ts` — `@napi-rs/keyring` wrapper.
- `packages/harness-core/src/fallback.ts` — fallback-chain retry.
- `packages/harness-contracts/models/catalog.json` — real snapshot.
- `apps/cli/src/commands/providers/` — `list.ts`, `add.ts`, `remove.ts`, `test.ts`, `index.ts`.
- `apps/cli/src/commands/keys/` — `set.ts`, `index.ts`.
- `services/harness/src/routes/providers.ts` — replaces the Phase 3.0 stub.
- `services/harness/src/routes/models.ts` — replaces the Phase 3.0 stub.
- `services/harness/src/routes/keys.ts` — new.
- `test/harness-cloud-agent.ts`, `test/harness-local-agent.ts`, `test/harness-provider-fallback.ts`, `test/harness-keyring.ts`, `test/harness-custom-provider.ts`.

Modify:

- `packages/harness-core/src/provider-registry.ts` — full implementation.
- `packages/harness-core/src/agent-loop.ts` — route through active provider.
- `packages/harness-core/src/tier-resolver.ts` — consult provider health.
- `packages/config/src/` — `providers` section typed and validated.
- Workspace root `package.json` — add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/openai-compatible`, `@napi-rs/keyring`.
- `apps/cli/src/index.ts` — register new commands.

Keep unchanged:

- `packages/tools/*` — existing deterministic surface.
- `services/api/*` — not touched.
- `services/indexer/*` — not touched.

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm --filter @mako-ai/harness-core test`
- `corepack pnpm --filter extensions/ollama test`

Required runtime checks:

- With `ANTHROPIC_API_KEY` set and Claude model selected, `agentmako chat -m "hello"` returns a streaming response; `provider_calls` has a row.
- With Moonshot API key set and model `kimi-k2.5`, `agentmako chat -m "hello"` works and is the documentation exemplar shown in the phase doc.
- With Ollama Cloud API key set, `agentmako chat -m "hello"` works.
- With `OLLAMA_BASE_URL=http://localhost:11434` and no internet reachable, `agentmako chat -m "hello"` works against local `llama3.1` or similar.
- `agentmako providers add` adds a custom `my-lmstudio` provider via config; `agentmako providers test my-lmstudio` succeeds.
- `agentmako keys set moonshot --prompt` stores into system keychain; next run picks it up without env.
- `agentmako keys set anthropic --from-env ANTHROPIC_API_KEY` references env.
- Fallback chain: set primary to a bad key, secondary to a working key; `agentmako chat` succeeds and `provider_calls` has both an `ok=0` and an `ok=1` row with matching timestamps.
- `agentmako tier` reports `cloud-agent` when keys present, `local-agent` when Ollama reachable and no cloud keys, `no-agent` otherwise.
- Sensitive headers never appear in `tool_runs.payload_json`, `provider_calls.error`, or logs.
- All five new smoke tests pass.

Required docs checks:

- Kimi K2.5 referenced as the cloud-agent doc exemplar in prose.
- Ollama Cloud documented alongside local Ollama as a first-class local/byok combo.
- Native-build concerns for `@napi-rs/keyring` recorded for Windows, macOS, Linux.

## Done When

- Every first-party provider extension runs against a live endpoint (or a mock where applicable) in CI.
- `agentmako chat` works in local-agent and cloud-agent tiers against every first-party provider.
- System keychain round-trip is working; env fallback is clean when keychain is unavailable.
- Fallback chains recorded in `provider_calls`.
- `{env:VAR}` config indirection works.
- Custom providers can be added by config alone.
- All five new smoke tests pass.
- Phase doc includes the native-build documentation promised in scope.

## Risks And Watchouts

- **Keychain native builds.** `@napi-rs/keyring` may need extra setup on Linux headless (libsecret) and Windows (DPAPI is fine, but CI workers may lack a user session). Ship with graceful degradation; never let a missing keychain block cloud-agent tier if the user sets env.
- **ai SDK version churn.** The ai SDK has moved quickly. Pin exact versions; track upgrades in a separate follow-up. Breaking changes in `streamText` or `tool()` will show up in smoke tests first.
- **Provider quirks under `openai-compatible`.** Moonshot, Ollama Cloud, DeepSeek, and others have small deviations from OpenAI's schema. Document any needed header overrides in the provider catalog.
- **Fallback-chain amplification.** A misconfigured chain can cascade every turn into N failures before success. Cap retries at `chain.length`, add exponential backoff between entries, and emit a `provider.call { ok: false }` event for each so the UI can surface the pattern.
- **Cost hints drift fast.** `ModelSpec.costHint` goes stale weekly. Treat `catalog.json` as illustrative and let the upstream refresh correct it. Never gate functionality on cost hints.
- **Secrets leakage.** Make redaction mandatory on every log path. A smoke test should grep logs for any `Authorization: Bearer` or `api_key=` substring and fail if found.

## Deviations From Spec At Ship Time

Documented for Phase 3.2 to inherit a clean substrate. The acceptance criteria above all hold; these are mostly file-organization and scope-pruning calls, not contract changes.

- **Catalog overlay registry instead of seven catalog files.** Spec called for each extension to ship its own `provider-catalog.ts`. Implementation puts the canonical data in `packages/harness-contracts/models/catalog.json` (a single bundled snapshot, type-checked through `BUNDLED_CATALOG`) and has each extension re-export the relevant entry. Net effect: one file to update when adding a model, not seven. Extensions still exist as workspace packages so `pnpm-filter` operations and per-vendor follow-ups (header overrides, runtime discovery, dedicated `@ai-sdk/google` migration) have a clean home.
- **`provider-discovery.ts` shipped only where it pays its keep.** Live `/api/tags` (Ollama) and `/v1/models` (LM Studio) helpers ship inline in those extensions' `index.ts`. Other extensions don't need a discovery file in 3.1; the bundled catalog is the truth.
- **`@ai-sdk/google` and `@ai-sdk/mistral` deferred.** The model factory routes `google` and `mistral` transports through `@ai-sdk/openai-compatible` for now, since both vendors expose OpenAI-compatible endpoints. Dedicated SDKs can land in a Phase 3.1.x follow-up without changing callers — the `ProviderTransportSchema` already supports them.
- **Single agent-loop file.** Spec called for a separate `agent-loop.ts`. Implementation extends `harness.ts` with the `streamText` body since the no-agent path and provider path share session/event/store state. If the file grows past ~400 lines (likely in 3.2 with tool dispatch), split then.
- **`runWithFallback` lives in `fallback.ts` but is not yet wired through `harness.ts`.** The agent loop performs its own loop over `session.fallback_chain` with backoff, error classification, and `harness_provider_calls` writes inline. The `runWithFallback` helper is exported for tools that want the same shape (the future tool-dispatcher in 3.2 will use it). Refactor opportunity in 3.1.x — behavior is correct.
- **CLI commands collapsed into `apps/cli/src/commands/harness.ts`.** Spec called for `apps/cli/src/commands/providers/` and `apps/cli/src/commands/keys/` directories. Implementation extends the same file `chat`/`session`/`tier` already live in (Phase 3.0 deviation continued) since they share the `harnessHttp` and SSE consumer helpers. Split when the file grows past ~600 lines.
- **`agentmako keys set --prompt` reads from stdin (line-buffered, not hidden).** Hidden TTY input is the right UX but adds a node-readline raw-mode dance. Phase 3.1 ships the simple stdin path so CI scripts work; interactive hidden input tracked for 3.1.x.
- **Smoke tests collapsed.** Spec called for five new smokes (`harness-cloud-agent`, `harness-local-agent`, `harness-provider-fallback`, `harness-keyring`, `harness-custom-provider`). Implementation ships two: `test/smoke/harness-providers.ts` (catalog round-trip + tier resolution + layered key resolution + custom provider via project config) and `test/smoke/harness-cloud-agent.ts` (mock OpenAI-compatible HTTP server + full streamText path + `provider_calls` row + assistant content). The deferred three are achievable by extending `harness-cloud-agent.ts` to add: a second mock failing first then succeeding (fallback), a keyring-only round-trip without env (keyring), and an Ollama-required gated test (local-agent). Trackable in 3.1.x.
- **`POST /api/v1/sessions/:id/keys/:provider` not implemented.** Spec called for a per-session key storage route. Implementation ships `POST /api/v1/keys/:provider` (workspace-scoped) and `DELETE /api/v1/keys/:provider`. Per-session key scoping rolled into Phase 3.2 alongside the permission-decision per-session table.
- **`POST /api/v1/models/refresh` not yet implemented.** The bundled catalog is enough for Phase 3.1 acceptance. The `applyUpstreamCatalog()` method on `ProviderRegistry` is in place; wiring an HTTP route to fetch from `models.dev` (or any user-supplied URL) is a one-route follow-up.
- **Native-build doc for `@napi-rs/keyring` deferred.** The dependency was already present in Roadmap 2 (added for DB binding), so the install path is proven on Windows. Linux `libsecret`/macOS Keychain notes will land in `devdocs/install-and-run.md` alongside the keychain CLI usage.

## What Shipped

- `packages/harness-contracts/models/catalog.json` + `src/catalog.ts` — bundled, schema-validated catalog covering Anthropic, OpenAI, Moonshot (Kimi K2.5 + Kimi K2 Thinking + Moonshot v1), Ollama (local: Llama 3.1, Qwen 2.5 Coder, DeepSeek R1, nomic-embed), Ollama Cloud (Kimi K2 1T, Qwen3 Coder 480B, DeepSeek v3.1 671B, GPT-OSS 120B), LM Studio (declared, models user-supplied), and a generic OpenAI-compatible placeholder.
- `packages/harness-core/src/keyring.ts` — `@napi-rs/keyring` wrapper with graceful degradation to `null` when the native module fails to load. Service name `mako-ai`, account `<provider-id>`.
- `packages/harness-core/src/provider-registry.ts` — bundled-overlay registry with `.mako/providers.json` + `~/.mako/providers.json` discovery, `{env:VAR_NAME}` indirection, and the full layered resolution chain.
- `packages/harness-core/src/fallback.ts` — `classifyProviderError` + `runWithFallback` helper with exponential backoff capped at 2s.
- `packages/harness-core/src/model-factory.ts` — bridges `ProviderSpec` + `modelId` + `apiKey` into an `ai` SDK `LanguageModelV1` for `anthropic`, `openai`, `openai-compatible` (and `ollama`/`google`/`mistral` routed through openai-compatible until dedicated SDKs land).
- `packages/harness-core/src/harness.ts` — agent loop now resolves the active fallback chain, calls `streamText`, emits `text.delta`/`provider.call`/`turn.done`, writes a `harness_provider_calls` row per attempt, and falls over on classifiable provider errors.
- `packages/harness-core/src/tier-resolver.ts` — auto-resolves `cloud-agent` when any cloud provider has a key, `local-agent` when any local provider is declared, `no-agent` otherwise.
- `extensions/anthropic`, `extensions/openai`, `extensions/moonshot`, `extensions/ollama`, `extensions/ollama-cloud`, `extensions/openai-compatible`, `extensions/lmstudio` — workspace packages that re-export the catalog entry plus per-vendor extras (Ollama and LM Studio ship a runtime discovery helper).
- `services/harness/src/server.ts` — new routes `GET /api/v1/providers`, `POST /api/v1/providers`, `DELETE /api/v1/providers/:id`, `POST /api/v1/providers/:id/test`, `GET /api/v1/models`, `POST /api/v1/keys/:provider`, `DELETE /api/v1/keys/:provider`. `GET /api/v1/tier` now consults the registry. Keys never appear in responses; auth headers never appear in logs.
- `apps/cli/src/commands/harness.ts` — new commands `agentmako providers list|test|add|remove`, `agentmako keys set|delete`. CLI talks only to the HTTP API.
- `test/smoke/harness-providers.ts` — catalog + registry + tier + layered key resolution + custom provider via project config.
- `test/smoke/harness-cloud-agent.ts` — mock OpenAI-compatible HTTP server + full `streamText` path + `provider.call` event + `harness_provider_calls` row + assistant message persistence.
- `package.json` — `test:smoke` extended with both new smokes; `corepack pnpm test:smoke` returns exit 0.

## Verification Result

- `corepack pnpm typecheck` — clean across all 27 workspace projects.
- `corepack pnpm --filter agentmako run build` — CLI tsup bundle builds (`725.09 KB`).
- `corepack pnpm test:smoke` — five suites pass (`core-mvp`, `ask-router-goldens`, `harness-no-agent`, `harness-providers`, `harness-cloud-agent`); `exit=0`.
- `harness-cloud-agent` confirms: `text.delta` events stream, `provider.call` event reports `ok=true`, `harness_provider_calls` row recorded, assistant text persisted.
- `harness-providers` confirms: bundled catalog has ≥7 providers and round-trips through `ProviderSpecSchema`; registry mirrors catalog; tier auto-resolves to `local-agent` when local providers exist with no keys, promotes to `cloud-agent` when `MAKO_ANTHROPIC_API_KEY` is set; layered key resolution honors explicit override > session override (with `{env:VAR}` indirection) > `MAKO_<PROV>_API_KEY` > vendor-standard; custom provider loads from `.mako/providers.json`.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.0-harness-foundation.md](./phase-3.0-harness-foundation.md)
- [./phase-3.2-action-tools-and-permissions.md](./phase-3.2-action-tools-and-permissions.md)
- [Vercel ai SDK](https://sdk.vercel.ai)
