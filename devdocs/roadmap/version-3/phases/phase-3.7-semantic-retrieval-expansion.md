# Phase 3.7 Semantic Retrieval Expansion

Status: `Complete` (shipped 2026-04-17)

Follow-on planning note (2026-04-17): Roadmap 3 remains open for Phase 3.8 website improvements before Roadmap 4 begins. This file remains the canonical ship record for 3.7 itself.

This file is the canonical planning and ship record for Roadmap 3 Phase 3.7. It expands the Phase 3.3 embedding substrate from memory-only recall into a broader semantic retrieval layer that agents can use against repo-local code and docs before Roadmap 4 trust work begins. The detailed plan below is preserved as planning history; read `Shipped Outcome` and `Deviations From Spec At Ship Time` first for the actual landed state.

Use [../roadmap.md](../roadmap.md) for roadmap order. Use [../handoff.md](../handoff.md) for the current execution target. Use [./phase-3.3-embeddings-and-memory.md](./phase-3.3-embeddings-and-memory.md), [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md), and [./phase-3.6.1-investigation-composers.md](./phase-3.6.1-investigation-composers.md) as the shipped substrate this phase builds on.

## Shipped Outcome

Phase 3.7 shipped a retrieval-focused semantic embedding layer over repo-local code, docs, and memories without changing the deterministic composer contracts.

What shipped:

- **Semantic-unit read model** in `packages/store/src/project-store-semantic-units.ts` plus migration `0016` for `harness_semantic_units` and `harness_semantic_units_fts`.
- **Embedding owner-kind expansion** so `harness_embeddings` now stores both `memory` and `semantic_unit` vectors under the existing Float32 BLOB model-scoped storage.
- **Projection on `project index`** via `services/indexer/src/semantic-unit-scan.ts`, deriving:
  - `code_symbol` units from existing `symbol` chunks
  - `doc_chunk` units from repo-local markdown under `devdocs/**`, `docs/**`, and `README*.md`
- **Heading-aware markdown chunking** in `services/indexer/src/doc-chunker.ts`, preserving heading path and bounded body windows instead of embedding whole docs.
- **Hybrid semantic retrieval** in `packages/harness-core/src/semantic-search.ts`:
  - semantic-unit FTS
  - optional memory FTS
  - exact cosine over stored embeddings when an embedding provider is available
  - reciprocal-rank fusion across lexical and vector ranks
  - explicit `fts-fallback` mode with a structured reason when embeddings are unavailable
- **Operator surfaces**:
  - harness-core `semantic_search` tool
  - `GET /api/v1/semantic/search`
  - `POST /api/v1/embeddings/reindex`
  - `agentmako semantic search <query>`
  - `agentmako embeddings reindex`
- **Deterministic verification**:
  - `harness-semantic-search-fts-fallback`
  - `harness-semantic-search-hybrid`
  - `harness-embeddings-reindex`

Verification at ship time:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke`

## Deviations From Spec At Ship Time

- **No dedicated web-UI retrieval surface shipped in 3.7.** The phase shipped harness/CLI/API parity and store/index substrate only. Website-specific presentation remains Phase 3.8 work.
- **No second vector table shipped.** The original hard decision held: semantic-unit vectors reuse `harness_embeddings` under `owner_kind = 'semantic_unit'`.
- **No ANN/vector extension shipped.** Retrieval remains exact cosine in Node over BLOB-stored vectors, fused with FTS. `sqlite-vec` / ANN work stays deferred.
- **No background auto-embed worker shipped.** `project index` rebuilds semantic units only. Embedding refresh is still an explicit operator action through `embeddings reindex`.
- **No schema-body or route embeddings shipped.** 3.7 stayed within the repo-local code/doc/memory scope that was planned.

## Prerequisites

Phase 3.7 requires these earlier phases complete:

- **Phase 3.3 — Embeddings and Semantic Memory.** `harness_embeddings`, provider resolution, Float32 BLOB storage, and hybrid memory recall already ship.
- **Phase 3.6.0 — Substrate Lift.** Symbol-level code chunks, chunk search, and the shared retrieval-oriented evidence pipeline already exist.
- **Phase 3.6.1 — Investigation Composers.** The lexical/AST baseline is now real, which makes the retrieval gaps visible and gives 3.7 a concrete consumer shape to improve against later.

If any of those are not in place, this phase should not start.

## Goal

Expand embeddings from **memory-only** into a deterministic, provenance-preserving semantic retrieval layer over:

- symbol-level code chunks
- repo-local markdown docs
- existing memory rows

and ship a harness-consumable search surface plus a maintenance path for re-embedding those corpora when the active embedding model changes.

This is a retrieval phase, not a trust/ranking phase.

## Hard Decisions

- **3.7 is retrieval-focused, not trust-focused.** No contradiction engine, answer comparison, ranking memory, or trust scoring belongs here.
- **Repo-local only.** This phase embeds markdown already in the repo. No web crawling, no remote docs ingestion, no vendor-doc fetcher.
- **Semantic units, not whole files.** Code is embedded at symbol-chunk granularity. Docs are embedded as heading-bounded chunks. Whole-file vectors are too coarse to be useful.
- **Derived read model, not append-only history.** Semantic units are rebuildable projection data like the index snapshot and schema snapshot read models. They do not need append-only semantics.
- **Reuse `harness_embeddings`; do not add a second vector table.** Extend the owner-kind surface so semantic units can reuse the existing Float32 BLOB storage and provider/model scoping.
- **Keep Node-side cosine in 3.7.** Do not introduce `sqlite-vec` or another ANN index in this phase. The unit set stays intentionally bounded: symbol chunks + repo-local docs + memories. If that proves too slow, it becomes a follow-up with measured evidence.
- **Add an explicit reindex/re-embed path.** Do not hide semantic embedding refresh inside every normal `project index` run. Rebuilding units and re-embedding them are separate operations.
- **Do not use embeddings for tool routing in 3.7.** Tool selection remains symbolic/heuristic. Semantic retrieval is exposed as a tool/input surface the agent can call, not as a hidden router.

## Why This Phase Exists

Phase 3.3 shipped a real embedding layer, but it only powers `memory_recall`. That leaves a clear gap:

- investigation tools still depend on lexical retrieval plus ast-grep proof
- repo-local docs are not semantically searchable
- there is no semantic search surface for symbol chunks
- changing embedding models has no first-class re-embed path beyond manual repair

Roadmap 4 trust work should start from a stronger retrieval substrate than that. Phase 3.7 closes the gap by making embeddings useful to the agent/tool layer before trust and comparison features begin.

## Scope In

### 1. Semantic unit projection

Add a new derived read model for repo-local semantic units:

- `code_symbol` units from existing `chunks` rows where `chunk_kind = 'symbol'`
- `doc_chunk` units from markdown files under:
  - `devdocs/**`
  - `docs/**`
  - `README*.md` anywhere under the repo except ignored/generated paths

Each unit carries:

- `unit_id`
- `project_id`
- `unit_kind`
- `title`
- `text`
- `file_path`
- `line_start` / `line_end` when available
- `owner_ref`
- `metadata_json`
- `source_hash`
- `indexed_at`

Markdown chunking is heading-aware. A chunk should preserve the heading path plus a bounded body window so results render as useful evidence instead of arbitrary paragraphs.

### 2. Semantic unit storage + FTS

Add migration `0016` for:

- `harness_semantic_units`
- `harness_semantic_units_fts`

This table is a rebuildable projection. A full replace/rebuild path is acceptable.

### 3. Embedding owner-kind expansion

Extend the embedding owner-kind surface so `harness_embeddings` can store vectors for semantic units:

- existing: `memory`
- new: `semantic_unit`

No second vector store ships in this phase.

### 4. Rebuild + re-embed pipeline

Ship two distinct operations:

- **unit rebuild** — derive semantic units from current chunks + markdown docs
- **embedding reindex** — embed semantic units and/or memories under the active embedding model

`project index` should rebuild semantic units. It should **not** automatically embed every unit.

### 5. Hybrid semantic retrieval

Add a new harness-core retrieval module that:

- runs FTS over semantic units
- embeds the query when an embedding provider is available
- scores semantic-unit vectors via exact cosine
- optionally includes memory hits in the same result set
- fuses lexical + vector ranks with RRF
- returns `fts-fallback` with a structured reason when embeddings are unavailable

Result rows must keep provenance:

- source kind (`code_symbol`, `doc_chunk`, `memory`)
- path + line range when available
- title
- excerpt
- fused score
- lexical rank / vector score breakdown

### 6. Tool / CLI / HTTP surface

Ship a new harness tool:

- `semantic_search(query, k?, kinds?, includeMemories?)`

Ship matching operator surfaces:

- `agentmako semantic search <query> [--k N] [--kind code|doc|memory]`
- `agentmako embeddings reindex [--kind semantic-unit|memory|all]`
- `GET /api/v1/semantic/search`
- `POST /api/v1/embeddings/reindex`

`semantic_search` is read-only and does not require approval.

`embeddings reindex` is maintenance work over local state only. It should not be model-exposed as a chat tool in 3.7.

## Scope Out

- remote docs or vendor-doc ingestion
- semantic tool routing / learned tool selection
- trust signals, contradiction detection, ranking memory
- `sqlite-vec`, ANN indexes, or any native vector extension
- schema-body embeddings
- route embeddings
- automatic background workers that continuously re-embed changed units
- web-UI redesign work beyond minimal visibility for the new search/reindex surfaces

## Architecture Boundary

### Owns

- semantic-unit projection and storage
- markdown doc chunking
- semantic-unit embedding/reindex maintenance
- hybrid semantic retrieval over code/doc/memory units
- the `semantic_search` harness tool
- CLI + HTTP parity for semantic search and embedding reindex

### Does Not Own

- trust-layer comparison or contradiction logic
- investigation-packet memory
- changes to the deterministic composer contracts
- external documentation ingestion
- full-scale vector indexing optimization

## Contracts

### `semantic_search`

Input:

- `query: string`
- `k?: number`
- `kinds?: Array<"code" | "doc" | "memory">`
- `includeMemories?: boolean`

Output:

- `mode: "hybrid" | "fts-fallback"`
- `reason?: string`
- `results[]`, where each row carries:
  - `kind`
  - `title`
  - `filePath?`
  - `lineStart?`
  - `lineEnd?`
  - `excerpt`
  - `score`
  - `ftsRank`
  - `vectorScore`

### `embeddings reindex`

Input:

- target owner kinds (`memory`, `semantic_unit`, or both)
- optional project scope

Output:

- counts for scanned / embedded / skipped / failed rows
- active provider/model
- failure summary when the provider is unavailable

## Execution Flow

1. Add migration `0016` and store accessors for semantic units.
2. Extend the embedding owner-kind surface for `semantic_unit`.
3. Build markdown chunking and semantic-unit projection from symbol chunks + docs.
4. Wire semantic-unit rebuild into `project index`.
5. Add embedding reindex codepath for semantic units and existing memories.
6. Implement hybrid semantic retrieval over semantic units (+ optional memories).
7. Expose `semantic_search` as a harness tool and ship CLI/API parity.
8. Add deterministic and live-provider smokes.

## File Plan

### Create

- `packages/store/src/project-store-semantic-units.ts`
- `packages/harness-core/src/semantic-search.ts`
- `packages/harness-core/src/semantic-tools.ts`
- `services/indexer/src/doc-chunker.ts`
- `services/indexer/src/semantic-unit-scan.ts`
- `apps/cli/src/commands/semantic.ts`
- `apps/cli/src/commands/embeddings.ts`
- `test/smoke/harness-semantic-search-fts-fallback.ts`
- `test/smoke/harness-semantic-search-hybrid.ts`
- `test/smoke/harness-embeddings-reindex.ts`

### Modify

- `packages/store/src/migration-sql.ts`
- `packages/store/src/project-store.ts`
- `packages/store/src/index.ts`
- `packages/store/src/project-store-embeddings.ts`
- `packages/harness-core/src/index.ts`
- `packages/harness-core/src/harness.ts`
- `packages/harness-core/src/tool-dispatch.ts`
- `services/indexer/src/index-project.ts`
- `services/harness/src/server.ts`
- `apps/cli/src/index.ts`
- root `package.json`

### Keep unchanged

- `packages/tools/src/composers/*` in 3.7 — existing composers stay lexical/AST-driven in this phase
- action tools and permission model
- provider-resolution rules and BYOK policy

## Verification

Required:

- `corepack pnpm typecheck`
- `corepack pnpm run test:smoke`

New required smokes:

- `harness-semantic-search-fts-fallback`
- `harness-semantic-search-hybrid`
- `harness-embeddings-reindex`

Manual acceptance:

1. Index a project with markdown docs and symbol chunks.
2. Run `agentmako embeddings reindex --kind all`.
3. Run `agentmako semantic search "..."` and confirm mixed code/doc/memory results with provenance.
4. Disable the embedding provider and confirm the same search returns `fts-fallback` with a clear reason.

## Done When

- repo-local docs and symbol chunks rebuild into semantic units on `project index`
- a maintenance command can embed/re-embed semantic units and memories under the active model
- `semantic_search` returns provenance-preserving code/doc/memory hits
- embeddings remain optional; retrieval degrades to `fts-fallback`, not hard failure
- the new surfaces are available through harness tool, CLI, and HTTP

## Risks And Watchouts

- **Vector scan cost.** Node-side cosine is still linear. Keep the 3.7 corpus bounded and measure before inventing an ANN system.
- **Doc chunk quality.** Heading-aware chunking must avoid both giant blobs and tiny orphan paragraphs.
- **Staleness.** Semantic units rebuild on index; embeddings do not. That split is intentional, but the UI/CLI must make stale embeddings obvious enough that operators know to reindex.
- **Duplicate evidence.** The same fact may appear in docs, code, and memories. Retrieval should surface provenance, not deduplicate aggressively by guesswork.
- **Scope creep into trust work.** The minute this phase starts storing evaluations, contradictions, or comparative judgments, it has become Roadmap 4.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.3-embeddings-and-memory.md](./phase-3.3-embeddings-and-memory.md)
- [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md)
- [./phase-3.6.1-investigation-composers.md](./phase-3.6.1-investigation-composers.md)
- [../../../master-plan.md](../../../master-plan.md)
