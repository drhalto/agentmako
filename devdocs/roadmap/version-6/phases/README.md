# Roadmap Version 6 Phases

These are the phase specs for the Roadmap 6 power-workflow build.

Read in this order:

1. [phase-6.0-graph-entity-and-edge-ir.md](./phase-6.0-graph-entity-and-edge-ir.md)
2. [phase-6.1-graph-neighbors-and-graph-path.md](./phase-6.1-graph-neighbors-and-graph-path.md)
3. [phase-6.2-flow-map-and-change-plan.md](./phase-6.2-flow-map-and-change-plan.md)
4. [phase-6.3-tenant-leak-audit-and-auth-operators.md](./phase-6.3-tenant-leak-audit-and-auth-operators.md)
5. [phase-6.4-project-queue-health-trend-and-session-handoff.md](./phase-6.4-project-queue-health-trend-and-session-handoff.md)
6. [phase-6.5-bounded-investigate-and-suggest.md](./phase-6.5-bounded-investigate-and-suggest.md)
7. [phase-6.6-usefulness-evaluation-and-default-exposure.md](./phase-6.6-usefulness-evaluation-and-default-exposure.md)

Current state:

- `6.0` is complete
- `6.1` is complete
- `6.2` is complete
- `6.3` is complete
- `6.4` is complete
- `6.5` is complete
- `6.6` is complete
- the roadmap file defines the canonical Roadmap 6 contract
- each phase file narrows one implementation slice

Rule:

- no phase should reintroduce Fenrir-style tool sprawl
- new workflows should compose the shipped substrate before adding new
  persistence or automation
