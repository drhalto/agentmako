# Roadmap Version 7

**Status:** IN PROGRESS

**Upstream Baseline:** Roadmaps 5 and 6 complete

**Primary Goal:** turn trusted packets and power workflows into generated
artifacts and tighter day-to-day workflow integrations

## Purpose

This folder is the canonical roadmap package for Roadmap 7 of `mako-ai`.

Roadmap 7 is the `Generated Artifacts And Workflow Integration` roadmap.

It is not:

- a redo of Roadmap 5 packet plumbing
- a redo of Roadmap 6 workflow composition
- a scheduler / daemon roadmap
- the ML / learned rollout roadmap

It is the roadmap that should make `mako-ai` stronger at:

- “turn this trusted workflow context into a usable artifact”
- “give me a preflight / handoff / review bundle I can actually use”
- “surface those artifacts in the main harness and agent loop”
- “export them into CI, hooks, editors, or files without making that mandatory”

## Starting Point

Roadmap 7 starts from shipped substrate, not from scratch:

- Roadmap 5 delivered:
  - typed workflow packets
  - packet handoff
  - packet follow-up tracking
- Roadmap 6 delivered:
  - graph / path / flow workflows
  - operator workflows
  - project-intelligence workflows
  - bounded investigation workflows
  - explicit usefulness and exposure posture

That means Roadmap 7 should package and compose those outputs into generated
artifacts before inventing new workflow families.

Current progress:

- Roadmap 7 docs are now opened and aligned with the shipped Roadmap 6 closeout
- `7.0` is shipped: artifact contract + basis model live in
  `packages/contracts/src/artifacts.ts` with smoke coverage
- `7.1` is shipped:
  - concrete `task_preflight` and `implementation_handoff` payload contracts
    live in `packages/contracts/src/artifacts.ts`
  - generator / refresh / replay helpers live in
    `packages/tools/src/artifacts/index.ts`
  - smoke coverage: `test/smoke/artifact-generators.ts`
- `7.2` is shipped:
  - concrete `review_bundle` and `verification_bundle` payload contracts live
    in `packages/contracts/src/artifacts.ts`
  - generator / refresh / replay helpers live in
    `packages/tools/src/artifacts/index.ts`
  - `review_bundle` packages reviewer guidance separately from direct / weak
    operator findings
  - `verification_bundle` keeps verification stop conditions explicit and keeps
    operator findings distinct from change-management checks
  - smoke coverage: `test/smoke/artifact-generators.ts`
- `7.3` is shipped:
  - all four artifact families are now reachable through the shared tool plane:
    - `task_preflight_artifact`
    - `implementation_handoff_artifact`
    - `review_bundle_artifact`
    - `verification_bundle_artifact`
  - CLI `tool call` and external-agent / MCP discovery surface the same four
    artifact tools
  - the answer loop keeps one primary workflow-packet follow-up action instead
    of showing a second competing artifact handoff action
  - smoke coverage: `test/smoke/api-answer-question.ts`
- `7.4` is shipped:
  - file export is the one wrapper surface that ships in 7.4; editor / CI /
    hooks are deferred to post-7.5 evaluation
  - every artifact tool accepts an optional `export: { file: { directory?,
    formats? } }` input and returns an `exported: { files: [...] }` pointer
  - export helper lives in `packages/tools/src/artifacts/export.ts`:
    - default directory `.mako/artifacts/<kind>/`, default formats = every
      rendering the artifact produced, filename = `<artifactId>.{json,md,txt}`
    - project-root path guard + atomic `tmp`+rename write
  - every artifact family now declares `file_export` as a consumer target and
    `exportIntent = { exportable: true, defaultTargets: ["file_export"] }`;
    the 7.0 `refineArtifactShape` subset rule validates the flip at the
    contract layer
  - smoke coverage: `test/smoke/artifact-file-export.ts`
- `7.4.1` is shipped (forgebench validation + regression cleanup):
  - closed every finding from the post-7.4 forgebench triage: graceful
    empty-surface rendering (3); session focus in implementation_handoff
    keyContext (5); graph entity resolution — route locator normalization,
    RPC locator normalization, RPC body extraction through two chained
    indexer bugs (1); operator finding dedup (A); RPC schema
    double-qualification (B); non-code RPC usage false positives (C)
  - also fixed a pre-existing `chunks.search_text` regression
    surfaced by the full smoke suite — symbol names now flow through
    camelCase-aware expansion so natural phrase search reaches
    identifiers like `loadUsers`
  - impact against forgebench: `change_plan` route→table went from
    `0/0/0` to `direct=4, dependent=6, steps=10`; `tenant_leak_audit`
    weak signals cleaned from 32 (mostly noise) to 20 genuine; all four
    artifact families now carry real structural content for realistic
    route→table queries
  - smoke coverage spans existing + new: `tenant-leak-audit.ts`,
    `graph-tools.ts`, `artifact-generators.ts`, `schema-scan-usage.ts`,
    `tool-call-legacy-chunk-fts.ts`
- the next clean move is `7.5`

## Package Contents

- [roadmap.md](./roadmap.md) — canonical roadmap contract and phase sequence
- [handoff.md](./handoff.md) — execution assumptions and working rules
- [phases/README.md](./phases/README.md) — phase index
- [future-ideas.md](./future-ideas.md) — parked design notes out of scope for
  the shipping phases but worth keeping before they have to be re-derived
- [forgebench-triage.md](./forgebench-triage.md) — findings from running the
  7.0–7.4 artifact stack against the real forgebench project; the scope
  input for what to fix next vs defer to 7.5

## Rules

- generated artifacts must declare their typed basis explicitly
- renderer output is a projection of typed state, not the source of truth
- one canonical artifact per question or workflow shape
- prefer composing Roadmap 5 and 6 outputs before inventing new packet families
- integrations stay opt-in wrappers unless later evidence proves they deserve
  broader exposure
- no second planner beside `ask`, packet handoff, or `investigate`
- no ML or self-modifying rollout in this roadmap
- no extra closeout phase by default if `7.5` can carry evaluation and
  exposure cleanly
