# Roadmap Version 4 Phases

These are the concrete phase specs for the shipped Roadmap 4 trust layer.

Final status:

- `Phase 4.0` shipped the trust substrate
- `Phase 4.1` shipped the trust-eval runner and real local suites
- `Phase 4.2` shipped rerun-and-compare
- `Phase 4.3` shipped trust-state evaluation and history
- `Phase 4.4a` shipped TS-aware alignment diagnostics
- `Phase 4.4b` shipped the first structural/relation diagnostics slice
- `Phase 4.5` shipped trust surfaces
- `Phase 4.6` shipped narrow ranking/de-emphasis policy

Post-closeout sidecars:

- `Phase 4.7` workflow context bridge
  - complete bridge run landed

Read in this order:

1. [phase-4.0-trust-backbone.md](./phase-4.0-trust-backbone.md)
2. [phase-4.1-evaluation-harness-and-regression-suites.md](./phase-4.1-evaluation-harness-and-regression-suites.md)
3. [phase-4.2-rerun-and-compare.md](./phase-4.2-rerun-and-compare.md)
4. [phase-4.3-contradiction-and-drift-engine.md](./phase-4.3-contradiction-and-drift-engine.md)
5. [phase-4.4a-ts-aware-alignment-diagnostics.md](./phase-4.4a-ts-aware-alignment-diagnostics.md)
6. [phase-4.4b-structural-and-sql-diagnostics.md](./phase-4.4b-structural-and-sql-diagnostics.md)
7. [phase-4.5-trust-surfaces.md](./phase-4.5-trust-surfaces.md)
8. [phase-4.6-ranking-and-policy.md](./phase-4.6-ranking-and-policy.md)

Sidecars:

- [phase-4.7-workflow-context-bridge.md](./phase-4.7-workflow-context-bridge.md)

Rule:

- the roadmap file defines the final Roadmap 4 contract
- each phase file records what shipped and what intentional limits remain
- future work should update Roadmap 5 unless it is fixing a Roadmap 4 regression
- sidecars may exist for narrow follow-on planning, but they do not rewrite the
  shipped canonical trust sequence
