# Reef 7 Model-Facing Tool Views

Status: `Shipped`

## Goal

Make Reef easy for Codex, Claude Code, and other coding agents to query
without forcing them to browse raw facts. Reef should expose
task-shaped views that answer "what should I inspect first?" and "what
does Reef know about this thing?" with ranked, sourced, fresh evidence.

## Problem

Reef now stores useful facts and findings, but agents can still burn tool
calls deciding which surface to use. Raw fact tools are useful for
inspection, but they are not the best first interaction for a vague task.

The model-facing layer should make the default interaction obvious:

```text
vague task -> scout view -> ranked files/facts/findings -> normal harness loop
precise subject -> inspect view -> exact Reef facts/findings/freshness
```

## Tooling Shape

Add or extend model-facing views around two modes:

- **Scout mode:** given a natural task/query, return ranked files,
  symbols, routes, schema objects, active findings, freshness, and
  suggested next tools.
- **Inspect mode:** given a concrete subject such as a file, route,
  symbol, table, or finding fingerprint, return the relevant Reef facts
  and active findings.

Candidate surfaces:

- extend `context_packet` as the default scout view
- add `reef_inspect` for precise subject inspection
- add `reef_related` for "what is connected to this file/symbol/table?"
- keep `project_facts` and `file_facts` as raw escape hatches, not the
  primary model path

## Contract Rules

- No raw SQL or store-shaped responses in model-facing tools.
- Every returned candidate has `source`, `overlay`, `freshness`,
  `confidence`, `whyIncluded`, and a stable subject/fingerprint.
- Output is budgeted and ranked. Large raw fact dumps require explicit
  pagination or raw fact tools.
- The tool recommends normal harness actions such as read, search,
  typecheck, or refresh; it does not perform edits.
- Deterministic retrieval runs before embeddings or any future learned
  reranker.

## Ranking Inputs

Initial ranking should use:

- direct file/symbol/route/schema matches
- import and route graph proximity
- active findings severity and freshness
- working-tree/staged overlay relevance
- recent tool-run and ack signals
- exact text/AST hits when available
- embedding candidates only as a fallback or rerank signal

## Done When

- `context_packet` or a new scout tool can answer a vague task with a
  compact ranked packet backed by Reef facts.
- a precise inspect tool can return file/route/symbol/table/finding
  state without exposing raw database internals.
- every candidate has provenance, freshness, and a reason.
- smoke coverage proves changed working-tree facts affect the scout view
  without a full reindex.
- docs explain the intended agent interaction pattern: scout first,
  inspect when precise, raw fact tools only when needed.

## Shipped Implementation Notes

- `reef_scout` is the model-facing scout view. It ranks Reef facts,
  findings, rule descriptors, diagnostic runs, and focus-file hints into
  candidates with source, overlay, freshness, confidence,
  `whyIncluded`, and suggested next harness actions.
- `reef_inspect` is the precise inspection view for a file or
  subject fingerprint. It returns the scoped Reef facts, findings,
  diagnostic runs, and counts without exposing store internals.
- `context_packet` now also consumes accepted/candidate convention facts
  through `source: "reef_convention"` and
  `strategy: "convention_memory"` candidates.
- `context_packet` candidate metadata now carries deterministic
  `evidenceConfidenceLabel` hints for working-tree and indexed evidence.
- `reef_scout` is included in Claude Code always-load metadata; all new
  Reef views are read-only and batchable through `tool_batch`.
- `test/smoke/reef-model-facing-views.ts` covers scout, inspect,
  convention-backed `context_packet` candidates, and batch execution.
