# Roadmap Version 3

**Status:** COMPLETE — Roadmap 3 closed after Phase 3.9.4

**Most Recent Ship:** Phase 3.9.4 — Cleanup And Polish (2026-04-18)

**Current Planning Target:** Roadmap 4 — Trust Layer

**Next:** Roadmap 4 (Trust Layer)

## Purpose

This folder is the active roadmap package for Roadmap 3 of `mako-ai`.

Roadmap 3 builds on the shipped Roadmap 1 and Roadmap 2 foundations (see [../version-2/README.md](../version-2/README.md)) to add a transport-agnostic agent harness, a BYOK provider layer with local and cloud tiers, action tools with declarative permissions, embeddings and semantic memory, and a browser client — and finally delivers the original composer family (`cross_search`, `trace_rpc`, etc.) as consumers of that harness.

## Current Status

**Completed (shipped):**
- Phase 3.0: Harness Foundation
- Phase 3.1: Provider Layer
- Phase 3.2: Action Tools and Permission Model
- Phase 3.3: Embeddings and Semantic Memory
- Phase 3.4: Sub-agents, Compaction, and Resume
- Phase 3.5: Web UI Alpha
- Phase 3.5.1: Web UI QoL and Session Telemetry
- Phase 3.6.0: Substrate Lift
- Phase 3.6.1: Investigation Composers
- Phase 3.7: Semantic Retrieval Expansion
- Phase 3.8: Website Improvements (2026-04-17)
- Phase 3.9: Model Layer (2026-04-18)
- Phase 3.9.1: Web Dashboard Polish (2026-04-18)

**Final close-out follow-ups (shipped):**
- Phase 3.9.2: Tool Surface Planning
- Phase 3.9.3: Tool Surface Evaluation
- Phase 3.9.4: Cleanup And Polish

**Next roadmap:** Roadmap 4 (Trust Layer)

## Source Of Truth

- [./roadmap.md](./roadmap.md) — Canonical Roadmap 3
- [./handoff.md](./handoff.md) — Execution handoff
- [./phases/README.md](./phases/README.md) — Phase index
- [../../master-plan.md](../../master-plan.md) — Long-term vision

## Upstream References

- [../version-2/README.md](../version-2/README.md) — Roadmap 2 (locked)
- [../../architecture/overview.md](../../architecture/overview.md) — Consolidated architecture overview
- [../../architecture/database.md](../../architecture/database.md) — SQLite policy and database design
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md) — Predecessor project lessons carried forward

## Rules

- Roadmap 3 phase docs are the canonical implementation specs
- Always check [./roadmap.md](./roadmap.md) for current status
- Update roadmap, handoff, and phase docs together when a phase ships
