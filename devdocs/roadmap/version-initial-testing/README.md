# Roadmap Version Initial Testing

**Status:** IN PROGRESS

**Upstream Baseline:** Roadmaps 1–7 complete, Roadmap 8 Phases 8.0 + 8.1 shipped,
R8 Phase 8.2+ paused during initial-testing hardening.

**Primary Goal:** capture and ship the fixes, gaps, and small features that
real-world initial-testing of mako surfaces — driven by concrete pain,
not by speculative scope.

## Purpose

This roadmap is different from Roadmaps 1–8. Those were architectural arcs
derived from the master plan. This one is **reactive**: it exists because
actually using mako on real projects (`courseconnect`, `forgebench`)
revealed gaps that did not surface during smoke tests or in earlier
phases.

Each phase here:

- ties back to a specific observed pain point during deployment
- stays narrow and bounded; no speculative features
- ships independently so the fix lands the moment it is needed
- may be a code change, a contract change, or a documentation fix

It is not:

- a replacement for master-plan sequencing — Roadmap 8 stays the next
  major arc
- a dumping ground for every small idea — each phase has to cite the
  deployment observation that motivated it
- a place to reopen lower-layer contracts without cause

## Pre-phase-1 fixes already shipped

Three deployment-surfaced fixes landed before this roadmap was formalized.
They are listed for history:

- **stdio MCP transport** (`agentmako mcp`). Triggered by the "need to
  run `agentmako serve` in a separate terminal every time" friction.
  Added `runMcpStdioServer` so MCP clients (Claude Code, Codex, Cursor)
  can spawn mako per session. See `services/api/src/mcp-stdio.ts`.
- **Prompt-secret paste-truncation fix**. Triggered by
  `agentmako connect`'s hidden-input prompt capturing only a 16-char
  substring of a pasted Supabase connection URL on Windows. Replaced a
  readline-based custom implementation with `@inquirer/password` so mako
  owns none of the paste-handling logic. See `apps/cli/src/shared.ts`.
- **Supabase pooler connection-string documentation**. Triggered by
  IPv6-only resolution failures on `db.<ref>.supabase.co`. Documented
  pooler vs direct vs session-pooler options explicitly in the
  connection-string flow guidance.

## Phases

- [Phase 1 — Finding Acknowledgements](./phases/phase-1-finding-acknowledgements.md)
- [Phase 2 — MCP Perf: Project Store Lifetime](./phases/phase-2-mcp-perf-store-lifetime.md)
- [Phase 3 — Package-Backed Search And Parsing Hardening](./phases/phase-3-package-backed-search-and-parsing.md)
- [Phase 4 — Index Freshness And Auto-Refresh](./phases/phase-4-index-freshness-and-auto-refresh.md)
- [Phase 5 — Deterministic Context Packet And Hot Retrieval](./phases/phase-5-deterministic-context-packet-and-hot-retrieval.md)

## Package Contents

- [roadmap.md](./roadmap.md) — canonical contract for this roadmap
- [handoff.md](./handoff.md) — execution rules
- [phases/README.md](./phases/README.md) — phase index

## Relationship to Roadmap 8

Roadmap 8 is **paused** during this hardening work. R8 Phases 8.0 and 8.1
shipped. R8 Phase 8.2+ opens after initial-testing pain is addressed and
accumulated telemetry from 8.1 has meaningful signal. Fixes shipped in
this roadmap may emit `RuntimeUsefulnessEvent` rows through the 8.1
pipeline — that wiring is intentional; it feeds the future R8.5 failure
clustering with pre-labelled signal.
