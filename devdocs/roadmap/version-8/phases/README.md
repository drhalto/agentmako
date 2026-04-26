# Roadmap Version 8 Phases

These are the phase specs for the Roadmap 8 learning-and-optimization
build.

Read in this order:

1. [phase-8.0-docs-and-telemetry-contract.md](./phase-8.0-docs-and-telemetry-contract.md)
2. [phase-8.1-live-usefulness-telemetry.md](./phase-8.1-live-usefulness-telemetry.md)
3. [phase-8.2-learned-read-models.md](./phase-8.2-learned-read-models.md)
4. [phase-8.3-bounded-learned-ranking-and-routing.md](./phase-8.3-bounded-learned-ranking-and-routing.md)
5. [phase-8.4-learned-promotion-attachment-and-rollout.md](./phase-8.4-learned-promotion-attachment-and-rollout.md)
6. [phase-8.5-failure-clustering-and-optimization-experiments.md](./phase-8.5-failure-clustering-and-optimization-experiments.md)
7. [phase-8.6-usefulness-evaluation-and-default-exposure.md](./phase-8.6-usefulness-evaluation-and-default-exposure.md)

Current state:

- `8.0` is shipped (docs + telemetry contract; behavior-neutral)
- `8.1` is shipped (storage substrate + write-path adapters +
  inspection surface; `runtime_telemetry_report` tool and
  `agentmako telemetry show` CLI live)
- `8.2`–`8.6` are gated on accumulated real-world telemetry — stubs only
  until Stage 2 opens
- the roadmap file defines the canonical Roadmap 8 contract
- each phase file narrows one implementation slice

Rules:

- no phase should reopen R5 / R6 / R7 lower-layer contracts
- learned surfaces must declare baseline + delta + rollback envelope
- Stage 2 phases (8.2–8.6) do not start against fixture data
