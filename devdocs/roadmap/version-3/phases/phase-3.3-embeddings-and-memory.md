# Phase 3.3 Embeddings And Semantic Memory

Status: `Complete`

This file is the canonical record of Roadmap 3 Phase 3.3 as shipped — goal, scope, contracts, file plan, acceptance criteria. Every section below reflects the shipped state. The short `Deviations From Spec At Ship Time` section at the bottom calls out the handful of intentional pivots from the original planning document so future phases can see *why* the shipped shape differs from earlier drafts they may encounter in git history.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.3.

## Prerequisites

Phase 3.3 requires Phases 3.0, 3.1, and 3.2 complete:

- **3.0 — Session substrate.** `ProjectStore`, `harness_*` tables, and the SSE event bus are reused verbatim for memory persistence and tier-health reporting. (The Phase 3.0 memory stubs mentioned in earlier drafts were never actually shipped; 3.3 creates the memory tools fresh.)
- **3.1 — Provider registry + layered key resolution.** The embedding resolver reuses `ProviderRegistry.resolveApiKey(...)` and the layered explicit → session → project → global → env → keychain order. A new `defaults.embedding` key in `.mako/config.json` lets users pick an embedding provider independent of their chat provider.
- **3.2 — Tool dispatch.** Memory tools register into the same `ToolDispatch.tools` map that `streamText` consumes, alongside the six action tools. They bypass the permission flow by design (read/append-only) but use the same call-id / event-bus / `tool_call`+`tool_result` persistence path.

If any of these is not in place, Phase 3.3 will not build.

## Goal

Ship a separate embedding provider axis, build the `memory_remember` / `memory_recall` / `memory_list` tools on hybrid FTS5 + vector search with Reciprocal Rank Fusion, and guarantee graceful FTS-only fallback when no embedding provider is available.

## Hard Decisions

- Embedding provider is independent of chat provider. `defaults.embedding.provider` resolves through the same layered order as chat but from its own config section.
- Default is `local Ollama nomic-embed-text`. If Ollama is unreachable, fall through to a local LM Studio embedding model if reachable; then to the first configured BYOK cloud embedding provider; otherwise enter `fts-fallback` mode.
- Vector storage is a Node-side `Float32Array` BLOB column (`harness_embeddings.vector`); cosine similarity is computed in Node at query time. `sqlite-vec` is NOT loaded in 3.3 — the BLOB layout ships on every platform (including Windows x64) without native-binding risk and gives a clean swap-in point for a future `vec0` virtual-table optimization without reshaping the schema.
- Hybrid search is FTS5 match + vector cosine, rank-fused (Reciprocal Rank Fusion with default `k=60`).
- Every embedding row stores its `provider` and `model`. Recall queries scope by `model` so mixing providers never causes dimension mismatches. Vectors with mismatched dim relative to the active query are skipped, not raised.
- Memory entries are append-only facts with `memory_id`, `project_id`, `text`, `category`, `tags[]`, `created_at`. A `memory_forget` companion tool is out of scope (memories can be archived via a future maintenance path; this phase ships creation and recall only).
- The embedding layer is ai-SDK-first where the SDK covers the endpoint shape. Ollama is reached via direct HTTP (`POST /api/embed` with fallback to `/api/embeddings` for older servers) because `@ai-sdk/openai-compatible` does not cover the Ollama embedding endpoint shape. LM Studio rides `@ai-sdk/openai-compatible`'s `textEmbeddingModel(...)` — its `/v1/embeddings` is pure OpenAI wire format. OpenAI rides `@ai-sdk/openai`'s `.textEmbeddingModel(...)`. Google and Mistral adapters are deferred to a 3.3.x follow-up; the current code returns a structured `embedding/unsupported-transport` error for those transports.

## Why This Phase Exists

The harness without memory is a chat over a catalog. The harness with memory is an agent that accumulates project understanding over time — which is what makes Roadmap 4's trust layer possible later.

Local-first matters here because embeddings are the one component that can silently leak arbitrary code into third-party APIs. Defaulting to local Ollama means a user's source code stays on their machine unless they explicitly opt into cloud embeddings. The BYOK tenet is preserved in exactly the same shape as for chat providers.

Graceful FTS fallback matters because `memory_recall` must never return a hard error for an ops reason. A user who kills Ollama mid-session must still get answers — just without semantic ranking.

## Scope In

- Two new migrations added as inline template-literal constants in `packages/store/src/migration-sql.ts` and registered in `project-store.ts` (the Phase 3.0 inline-SQL pattern; `.sql` files were retired to sidestep bundling):
  - `PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL` — `harness_memories(memory_rowid, memory_id, project_id, text, category, tags_json, created_at)` + `harness_memories_fts` FTS5 virtual table with `content='harness_memories'` / `content_rowid='memory_rowid'` + sync trigger + append-only UPDATE/DELETE triggers.
  - `PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL` — `harness_embeddings(embedding_id, owner_kind, owner_id, provider, model, dim, vector BLOB, created_at)` + `(owner_kind, model, owner_id)` index + append-only triggers.
- `EmbeddingProvider` interface and adapters consolidated into one file, `packages/harness-core/src/embedding-provider.ts`:
  - `embed(text)` / `embedMany(texts)` / `probe()` with `dim` discovered on first call.
  - Concrete adapters: `OllamaEmbeddingProvider` (direct HTTP) and a shared `AiSdkEmbeddingProvider` (rides `@ai-sdk/openai-compatible` for LM Studio and custom endpoints, `@ai-sdk/openai` for OpenAI).
  - `cosineSimilarity(a, b)` for the Node-side vector scoring path.
- Embedding provider resolution in `packages/harness-core/src/embedding-resolver.ts`:
  - Layered order: explicit → env (`MAKO_EMBEDDING_PROVIDER` / `MAKO_EMBEDDING_MODEL`) → project config → global config → auto-local (Ollama, LM Studio) → auto-cloud (first cloud provider with a BYOK key).
  - Returns a structured `{ ok, reason, attempted[] }` when no path resolves; callers treat that as `fts-fallback`.
- Hybrid search in `packages/harness-core/src/memory-search.ts`:
  - FTS5 match against `harness_memories_fts` scoped by project_id (if provided).
  - Vector cosine against `harness_embeddings` filtered by `owner_kind='memory' AND model=<active>`.
  - RRF fusion with `k=60`.
  - FTS-only fallback returns `{ mode: "fts-fallback", reason }` when the embedding provider is null, unreachable, or has produced no vectors under the active model yet.
- Memory tools in `packages/harness-core/src/memory-tools.ts` (moved from `packages/harness-tools` — see Deviations):
  - `memory_remember(text, category?, tags?)` — inserts a row, embeds if a provider is available, stores the vector. Embedding failure is non-fatal; the row is still FTS-indexed.
  - `memory_recall(query, k?)` — hybrid search; returns ranked results with `mode` signal.
  - `memory_list(category?, tag?, since?, limit?)` — append-order listing with optional filters.
- `MEMORY_TOOLS` registers into `tool-dispatch.ts`'s `tools` map alongside `ACTION_TOOLS` so the agent loop sees a unified tool surface.
- Store accessors split per-concern: `project-store-memories.ts` and `project-store-embeddings.ts`, both exposed through the main `ProjectStore` facade and the `@mako-ai/store` barrel.
- CLI commands in a new `apps/cli/src/commands/memory.ts` file (single file, following the one-file-per-command-family pattern):
  - `agentmako memory remember <text> [--category X] [--tag t]`
  - `agentmako memory recall <query> [--k N]` — prints ranked results with their `mode` signal.
  - `agentmako memory list [--category X] [--tag T] [--since ISO] [--limit N]`
- HTTP routes inlined in `services/harness/src/server.ts` (matches existing harness server pattern — there is no `routes/` subdirectory under `services/harness`):
  - `POST /api/v1/memory/remember { text, category?, tags?, project_id? }`
  - `GET /api/v1/memory/recall?q=...&k=...&project_id=...`
  - `GET /api/v1/memory?category=...&tag=...&since=...&limit=...&project_id=...`
- `Harness.resolveEmbeddingProvider()` exposes the resolved provider (or failure) and `GET /api/v1/tier` includes an `embedding` field carrying `{ ok, providerId, modelId, source, reason }` on success or `{ ok: false, reason, attempted[] }` on failure.
- Catalog additions in `packages/harness-contracts/models/catalog.json`:
  - `ollama.kind` → `both`; `mxbai-embed-large` added alongside the existing `nomic-embed-text`. `ollama.transport` → `ollama` (enables the direct-HTTP embedding path; chat still works because `model-factory.ts` routes both `ollama` and `openai-compatible` through `createOpenAICompatible`).
  - `lmstudio.kind` → `both`; `text-embedding-nomic-embed-text-v1.5` added as a representative default (LM Studio users load their own model by id).
  - `openai.kind` → `both`; `text-embedding-3-small` and `text-embedding-3-large` added.
- Smoke tests (four files; two in CI):
  - `test/smoke/harness-memory-fts-fallback.ts` (CI) — no embedding provider; asserts `mode: "fts-fallback"`, structured `reason`, and correct FTS ranking.
  - `test/smoke/harness-memory-model-scope.ts` (CI) — synthetic vectors under two models; asserts old-model vectors are preserved on disk but never surface when the active model differs; dimension-mismatched rows are silently skipped.
  - `test/smoke/harness-memory.ts` (manual; `pnpm test:smoke:memory:ollama`) — live Ollama hybrid path; skips cleanly when `localhost:11434` is unreachable.
  - `test/smoke/harness-memory-lmstudio.ts` (manual; `pnpm test:smoke:memory:lmstudio`) — live LM Studio hybrid path; skips cleanly when `localhost:1234` is unreachable.
- Documentation:
  - `nomic-embed-text` recommended as the default local embedding model; Ollama install prerequisite noted.
  - LM Studio usage note: load both chat and embedding models via the LM Studio UI; override `MAKO_EMBEDDING_MODEL` if your loaded embedding id differs from the catalog default.

## Scope Out

- Embedding-driven project-wide code search (`owner_kind='file' | 'symbol'`) — the schema supports it but Phase 3.3 ships only `owner_kind='memory'`.
- Sub-agent spawning (Phase 3.4).
- Compaction uses embeddings in Phase 3.4 but that implementation lives in 3.4.
- A `memory_forget` or deletion tool — memories are append-only in 3.3.
- A memory-export tool — deferred until there is a real use case.

## Architecture Boundary

### Owns

- Migrations `0010` (`harness_memories` + FTS5) and `0011` (`harness_embeddings` Float32 BLOB table).
- The `EmbeddingProvider` interface, the Ollama direct-HTTP adapter, and the shared ai-SDK adapter (used by LM Studio, OpenAI, and generic `openai-compatible`).
- The embedding resolver with layered precedence.
- The hybrid search implementation and RRF fusion.
- The memory tool family (`memory_remember`, `memory_recall`, `memory_list`).
- `agentmako tier`'s embedding-health reporting.
- New CLI `memory` subcommands and HTTP `/memory/*` routes.
- Catalog edits that declare Ollama, LM Studio, and OpenAI as `kind: "both"`.

### Does Not Own

- Any chat provider code (Phase 3.1).
- Action tools or permission model (Phase 3.2).
- Compaction (Phase 3.4 — though Phase 3.4 calls `memory_recall`).
- Web UI memory browser (implicitly covered by Phase 3.5 if time permits; otherwise deferred).

## Contracts

### Input Contract

- `POST /api/v1/memory/remember { text, category?, tags? }` returns `{ id }`.
- `GET /api/v1/memory/recall?q=...&k=...&filter=...` returns `{ results[], mode: "hybrid" | "fts-fallback", reason? }`.
- `GET /api/v1/memory?category=...&tag=...&since=...` returns a list of rows.

### Output Contract

The phase leaves behind:

- A separate embedding provider axis with local-first defaults (Ollama, LM Studio) and BYOK cloud fallback (OpenAI).
- Hybrid FTS5 + Node-side cosine search over Float32 BLOB vectors with RRF fusion.
- Three real memory tools plus CLI and HTTP surfaces.
- Graceful FTS-only fallback when embeddings are unavailable.

### Error Contract

- `embedding/provider-unavailable` — logged, not raised; recall enters `fts-fallback` with a populated `reason`.
- `embedding/dimension-mismatch` — raised by `cosineSimilarity` if two equal-model vectors ever disagree on dim (construction prevents this). Recall itself never surfaces this: vectors whose dim differs from the active query vector are silently skipped.
- `embedding/unsupported-transport` — thrown by `createEmbeddingProvider` for Google / Mistral / Anthropic transports (deferred to 3.3.x).
- `embedding/missing-api-key` / `embedding/missing-base-url` — thrown when a provider spec is underspecified.
- Memory-model change has no explicit error — old vectors simply stop appearing in recall once the active model differs. A future `memory_reindex` tool will re-embed them on demand.

## Execution Flow

1. Write migrations `0010` and `0011` as inline constants in `migration-sql.ts`; register them in `project-store.ts`.
2. Add store accessors in `project-store-memories.ts` and `project-store-embeddings.ts`; expose through the `ProjectStore` facade and the `@mako-ai/store` barrel.
3. Define the `EmbeddingProvider` interface; implement Ollama (direct HTTP) and the shared ai-SDK adapter (for LM Studio, OpenAI, custom `openai-compatible`).
4. Write the embedding resolver with layered precedence; extend `local-config.ts` to carry `defaults.embedding`.
5. Implement hybrid search with RRF in `memory-search.ts`.
6. Create the three memory tools in `packages/harness-core/src/memory-tools.ts`; register them into `tool-dispatch.ts`'s `tools` map; pipe `memoryContext` through `Harness.runTurn`.
7. Add CLI (`apps/cli/src/commands/memory.ts`) and inline HTTP handlers in `services/harness/src/server.ts`.
8. Extend `GET /api/v1/tier` to report embedding health and update `agentmako tier` to print it.
9. Write the four smoke tests (two deterministic for CI, two live-provider manual).

## File Plan

Created:

- `packages/store/src/project-store-memories.ts`
- `packages/store/src/project-store-embeddings.ts`
- `packages/harness-core/src/embedding-provider.ts` (interface + Ollama direct-HTTP adapter + shared ai-SDK adapter + `cosineSimilarity`)
- `packages/harness-core/src/embedding-resolver.ts`
- `packages/harness-core/src/memory-search.ts`
- `packages/harness-core/src/memory-tools.ts`
- `apps/cli/src/commands/memory.ts`
- `test/smoke/harness-memory-fts-fallback.ts`
- `test/smoke/harness-memory-model-scope.ts`
- `test/smoke/harness-memory.ts`
- `test/smoke/harness-memory-lmstudio.ts`

Modified:

- `packages/store/src/migration-sql.ts` — two new `PROJECT_MIGRATION_0010_*` / `PROJECT_MIGRATION_0011_*` constants appended.
- `packages/store/src/project-store.ts` — migration entries + delegating accessors.
- `packages/store/src/index.ts` — re-export the two new modules.
- `packages/harness-core/src/index.ts` — re-export embedding + memory modules.
- `packages/harness-core/src/local-config.ts` — `defaults.embedding` support + `EmbeddingDefaults` export.
- `packages/harness-core/src/harness.ts` — `resolveEmbeddingProvider()` accessor, cached resolution, `memoryContext` wiring.
- `packages/harness-core/src/tool-dispatch.ts` — `MEMORY_TOOLS` registration + `executeMemoryTool()` path (bypasses permission flow).
- `packages/harness-contracts/models/catalog.json` — `ollama` / `lmstudio` / `openai` kind → `both`, embedding models added, `ollama.transport` → `ollama`.
- `services/harness/src/server.ts` — inline handlers for `POST /memory/remember`, `GET /memory/recall`, `GET /memory`; `GET /tier` extended.
- `apps/cli/src/index.ts` — `memory` dispatch.
- `apps/cli/src/commands/harness.ts` — `runTierCommand` prints embedding status.
- `apps/cli/src/shared.ts` — `memory remember|recall|list` added to `CLI_COMMANDS`.
- Root `package.json` — CI smoke chain extended; `test:smoke:memory:ollama` and `test:smoke:memory:lmstudio` scripts added.

Kept unchanged:

- Chat provider layer from 3.1.
- Permission model from 3.2.
- Existing schema IR, flattened read model, Roadmap 2 tooling.
- Existing action-tool family and snapshot/undo machinery from 3.2.

## Verification

Required commands:

- `corepack pnpm typecheck` — clean across the workspace.
- `corepack pnpm run test:smoke` — 9 smoke tests pass (7 pre-existing + `harness-memory-fts-fallback` + `harness-memory-model-scope`).

Optional live-provider checks (run manually when the local endpoint is available):

- `corepack pnpm run test:smoke:memory:ollama` — with Ollama running and `nomic-embed-text` pulled, asserts hybrid mode and a positive cosine on the top hit.
- `corepack pnpm run test:smoke:memory:lmstudio` — with LM Studio running and an embedding model loaded, asserts hybrid mode end-to-end through the ai-SDK `openai-compatible` adapter.

Manual contract checks (for phase acceptance review):

- `memory_remember "this project uses pgvector for audit logs"` stores a row; `memory_recall "audit"` returns it with `mode: "hybrid"` when an embedding provider is healthy.
- Stop the embedding provider. `memory_recall "audit"` still returns with `mode: "fts-fallback"` and a populated `reason`.
- Swap embedding model (e.g. `nomic-embed-text` → `mxbai-embed-large`): `memory_recall` for the same query returns only vectors produced under the new model; old vectors remain in `harness_embeddings` but are not surfaced. `harness-memory-model-scope.ts` is the automated version of this assertion.
- `agentmako tier` prints the embedding provider, model, and resolution source on success, or `fts-fallback` with the attempted-provider list on failure.

Deferred (out of Phase 3.3 scope, tracked as follow-ups):

- Import a 500-memory fixture and assert recall latency under 50ms on a typical laptop. The Node-side cosine path over a BLOB column is linear in the row count; the latency target is realistic for this scale but has not been measured. Revisit when either (a) `owner_kind='file' | 'symbol'` embeddings land or (b) a user reports perceptible lag.

## Done When

- Migrations `0010` and `0011` apply cleanly on fresh and existing `project.db` files.
- Embedding provider resolves independently from chat through the documented layered precedence.
- Local-first default works with zero network egress against a local Ollama (`nomic-embed-text`) or LM Studio embedding model.
- FTS-only fallback engages cleanly — with a structured `reason` and no thrown error — when no embedding provider is available.
- Three memory tools ship with a unified CLI surface (`agentmako memory remember|recall|list`) and HTTP surface (`/api/v1/memory/remember`, `/recall`, `/`).
- Dimension mismatches are impossible by construction: recall scopes by `(owner_kind, model)` and mismatched-dim vectors are silently skipped.
- `GET /api/v1/tier` reports embedding health; `agentmako tier` renders it.
- The two deterministic smoke tests (`harness-memory-fts-fallback`, `harness-memory-model-scope`) pass in CI. The two live-provider smoke tests pass when run against their respective local endpoints.

## Risks And Watchouts

- **Node-side cosine scales linearly.** Fine for the memory-only scope in 3.3 (hundreds to low thousands of rows) but will need indexing when `owner_kind='file' | 'symbol'` embeddings land. The BLOB layout is a clean swap-in point for `sqlite-vec`'s `vec0` virtual table — no schema change required, just a re-pointing of the search path.
- **Embedding latency on CPU-only laptops.** `nomic-embed-text` is small but can still be slow. Memories are never re-embedded unless text changes (rows are append-only; there is no UPDATE path).
- **FTS5 tokenizer choice.** Default `unicode61` is usually fine; non-English projects may need `trigram`. A future migration can rebuild the FTS index with `INSERT INTO harness_memories_fts(harness_memories_fts) VALUES('rebuild');` without touching the content table.
- **Memory bloat.** Memories are append-only in 3.3. Cleanup is manual until `memory_forget` ships in a later phase — do not let users think they can prune today.
- **Embedding secrets.** Do not log text that went into the embedding call if it contains secrets. Apply redaction rules consistently with provider call logging.
- **Catalog `lmstudio` embedding default is illustrative.** LM Studio users load arbitrary model ids in the UI; the catalog entry (`text-embedding-nomic-embed-text-v1.5`) is a placeholder, not a guarantee. Users can override via `MAKO_EMBEDDING_MODEL` or a project-level config default.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.2-action-tools-and-permissions.md](./phase-3.2-action-tools-and-permissions.md)
- [./phase-3.4-subagents-compaction-resume.md](./phase-3.4-subagents-compaction-resume.md)
- [`sqlite-vec`](https://github.com/asg017/sqlite-vec)

## Deviations From Spec At Ship Time

The sections above describe the shipped state. This section records the
handful of intentional pivots from the original planning document — the
*why* behind each delta, for future phases that want context on how the
shape evolved.

1. **`sqlite-vec` was not loaded; Node-side cosine over Float32 BLOBs ships instead.** The planning document made the `sqlite-vec` virtual table the primary path and `node-side cosine over BLOB columns` the documented fallback. In practice the BLOB path runs on every target platform (notably Windows x64) with zero native-binding risk, and the memory-only scope in 3.3 is small enough that linear scan is fine. The schema (`harness_embeddings.vector` as raw Float32 BLOB) is the physical layout a future `vec0` virtual-table optimization would mirror, so the swap-in cost is low when it's needed.
2. **LM Studio is a first-class embedding provider (user-requested scope addition).** The planning document listed Ollama + OpenAI + Google + Mistral. LM Studio was added at implementation time because it's a common local setup for users who prefer its UI over Ollama's CLI. It rides `@ai-sdk/openai-compatible`'s `textEmbeddingModel(...)` with no new code path — the existing `openai-compatible` transport case handles it alongside generic custom endpoints.
3. **Google and Mistral adapters were deferred to 3.3.x.** The Ollama + LM Studio + OpenAI + `openai-compatible` set already covers the BYOK local+cloud story. `createEmbeddingProvider` returns a structured `embedding/unsupported-transport` error for those transports so callers see a clean signal, not a silent miss.
4. **Memory tools moved from `packages/harness-tools` to `packages/harness-core`.** The planning document placed them under `harness-tools` alongside the filesystem action tools. That would have forced a circular dependency — memory tools need `EmbeddingProvider` and `recallMemories` (both in harness-core), and harness-core already depends on harness-tools. `packages/harness-core/src/memory-tools.ts` is the shipped home. This also keeps `harness-tools` scoped to pure filesystem mutation tools with no DB/embedding dependencies — a cleaner package boundary.
5. **Ollama catalog `transport` flipped from `openai-compatible` to `ollama`.** Necessary so `createEmbeddingProvider` can pick the direct-HTTP Ollama adapter (the ai-SDK openai-compatible path doesn't cover Ollama's `/api/embed` endpoint shape). Chat behavior is unchanged because `model-factory.ts` already routes both transports through `createOpenAICompatible`. All Phase 3.1 provider and cloud-agent smoke tests still pass.
6. **Migrations renumbered `0005`/`0006` → `0010`/`0011`.** The planning document was written before Phases 3.0-3.2 consumed migration numbers through `0009`. Bookkeeping only — no behavioral impact.
7. **Deferred: 500-memory latency benchmark.** The planning document promised a p50-under-50ms target over a 500-memory fixture. Not measured at ship time because the Node-side cosine path is linear and the target is realistic for this scale. Revisit when either (a) `owner_kind='file' | 'symbol'` embeddings land or (b) a user reports perceptible lag.
