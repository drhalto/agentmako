# Roadmap Version 4

**Status:** COMPLETE

**Most Recent Upstream Ship:** Roadmap 4 / Phase 4.6 — Ranking And Policy

**Next Roadmap:** Roadmap 5 — Context And Workflow Assistance

## Purpose

This folder is the locked roadmap package for Roadmap 4 of `mako-ai`.

Roadmap 4 made `mako-ai` historically comparable, drift-aware, and explicitly trustworthy across CLI, MCP, API, and web surfaces.

Roadmap 4 was not a new harness roadmap.
Roadmap 4 was not a new model-layer roadmap.
Roadmap 4 was the trust roadmap.

## Final Status

Roadmap 4 shipped:

- trust persistence and comparable answer history
- rerun and compare artifacts
- explicit trust-state evaluation
- real local trust-eval suites
- first alignment diagnostics
- additive trust surfaces
- narrow evidence-backed ranking/de-emphasis

## Post-Closeout Additions

After Phase 4.6 closed, two additive surface-layer extensions shipped:

- **SARIF 2.1.0 output** — [`devdocs/sarif-output.md`](../../sarif-output.md)
- **YAML rule-pack loader** — [`devdocs/rule-packs.md`](../../rule-packs.md)

Both reuse the existing trust/diagnostic substrate and ship through the
same `AnswerSurfaceIssue` contract. Neither modifies trust storage or
the trust-state classifier. Tracked inside the relevant phase docs
(`phase-4.5-trust-surfaces.md` for SARIF, `phase-4.4b-structural-and-sql-diagnostics.md`
for rule packs) under their respective Post-Closeout Additions sections.

One post-closeout sidecar is also tracked in this roadmap package:

- `phase-4.7-workflow-context-bridge.md`

It does not reopen the canonical trust sequence. It records a narrow follow-on
prep work that should stay anchored to the shipped Roadmap 4 substrate.
It is now fully landed as a small bridge run: contracts, extraction,
normalization, and a packet-entry contract for Roadmap 5.

## Source Of Truth

- [./roadmap.md](./roadmap.md) — Canonical Roadmap 4 summary
- [./handoff.md](./handoff.md) — Final execution handoff
- [./phases/README.md](./phases/README.md) — Phase index
- [../../master-plan.md](../../master-plan.md) — Long-term roadmap order

## Upstream References

- [../version-3/README.md](../version-3/README.md)
- [../version-3/roadmap.md](../version-3/roadmap.md)
- [../version-3/handoff.md](../version-3/handoff.md)
- [../../architecture/overview.md](../../architecture/overview.md)
- [../../architecture/database.md](../../architecture/database.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Rules

- Roadmap 4 phase docs are now a shipped historical record, not an active plan
- Always check [./roadmap.md](./roadmap.md) for the final shipped scope
- New trust-adjacent work should update Roadmap 5 unless it is fixing a Roadmap 4 regression
- Roadmap 5 should start with typed workflow-context packets and explicit watch workflows; optional hooks / CI automation can wrap that layer later, but background workers should not be treated as a prerequisite
- The `4.7` sidecar exists so Roadmap 5 packet generators can consume one shared workflow-context bridge instead of each reverse-engineering `AnswerResult`
