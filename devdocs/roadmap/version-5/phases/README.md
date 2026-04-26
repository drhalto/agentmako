# Roadmap Version 5 Phases

These are the phase specs for the Roadmap 5 workflow-context build.

Read in this order:

1. [phase-5.0-packet-contracts-and-citation-rules.md](./phase-5.0-packet-contracts-and-citation-rules.md)
2. [phase-5.1-implementation-briefs-and-precedent-packs.md](./phase-5.1-implementation-briefs-and-precedent-packs.md)
3. [phase-5.2-impact-packets-and-verification-plans.md](./phase-5.2-impact-packets-and-verification-plans.md)
4. [phase-5.3-workflow-recipes-and-stop-conditions.md](./phase-5.3-workflow-recipes-and-stop-conditions.md)
5. [phase-5.4-packet-surfaces-and-watch-mode.md](./phase-5.4-packet-surfaces-and-watch-mode.md)
6. [phase-5.5-default-consumers-and-optional-wrappers.md](./phase-5.5-default-consumers-and-optional-wrappers.md)
7. [phase-5.6-agent-power-integration-and-reference-processes.md](./phase-5.6-agent-power-integration-and-reference-processes.md)

Current state:

- `5.0` is shipped and should be treated as baseline
- `5.1` is shipped and should be treated as baseline
- `5.2` is shipped and should be treated as baseline
- `5.3` is shipped and should be treated as baseline
- `5.4` is shipped and should be treated as baseline
- `5.5` is shipped and should be treated as baseline
- `5.6` is now shipped as the post-closeout extension that makes the packet
  layer and reference-backed research matter more in the normal agent/tool loop
- `5.6.1` has a first shipped slice:
  - one shared companion attachment policy
  - `ask` inheritance
  - surfaced attachment reasons
  - promoted default-path flows for `route_trace`, `file_health`,
    `trace_file`, `trace_table`, and `trace_rpc`
- `5.6.2` has a first shipped slice:
  - compact workflow handoff on packet surfaces
  - concise companion rendering in the normal answer path
  - full packet views that still retain the detailed packet rendering
- `5.6.3` is now shipped:
  - source-labeled `reference_precedent` workflow context
  - advisory external precedent support in `precedent_pack`
  - real packet smoke coverage for local-vs-reference precedence
- `5.6.4` is now shipped:
  - usefulness grading in the shared eval runner
  - run-level promotion metrics
  - actual-followup count / rate when guided actions are executed
  - real ForgeBench workflow-usefulness suite coverage
- `5.6.5` is now shipped:
  - handoff-driven first `candidateAction`
  - next-action rendering in the normal answer path
- `5.6.6` is now shipped:
  - execution-ready workflow-guided candidate actions
  - `workflow_packet` execution targets for promoted companion flows
  - canonical query text plus replay args for exact round-trips on promoted
    flows
  - durable `workflow_followups` facts for executed packet-guided actions
- Roadmap 5 closes at the shipped `5.6` state:
  - actual-followup rate is an operator-tuned policy input
  - autonomous rollout adjustment is deferred to Roadmap 8

Rule:

- the roadmap file defines the canonical Roadmap 5 contract
- each phase file narrows one implementation slice
- packet generators must consume the shipped `4.7` bridge instead of parsing raw `AnswerResult`
