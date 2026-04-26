# Roadmap Version 7 Handoff

This file is the execution handoff for the Roadmap 7 build cycle.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-5/handoff.md](../version-5/handoff.md)
- [../version-6/roadmap.md](../version-6/roadmap.md)
- [../version-6/handoff.md](../version-6/handoff.md)

## Roadmap Intent

Roadmap 7 is the `Generated Artifacts And Workflow Integration` roadmap.

Its purpose is to turn the shipped packet and power-workflow substrate into a
small set of durable artifacts that are directly useful in day-to-day coding
flows.

The target outcome is:

- generated preflight artifacts
- generated implementation / review / handoff artifacts
- generated verification / change-management artifacts
- tighter harness / CLI / external-agent integration
- optional export wrappers that remain clearly secondary to the core artifact

## Mandatory Entry Assumptions

Treat these as already solved:

- packet generation and packet handoff
- graph / operator / project-intelligence workflows
- bounded investigate / suggest
- usefulness and exposure posture for packets and workflows

Do not reopen those just because the generated artifacts would be easier if the
lower layers changed.

## Working Rules

1. **Compose shipped packets and workflows first.**
   - Prefer using Roadmap 5 and 6 outputs before inventing new packet families
     or new planner layers.

2. **Keep artifacts typed.**
   - No free-form markdown blob should be the only canonical output.
   - Rendered markdown, file exports, or text snippets should be projections of
     typed state.

3. **Declare basis explicitly.**
   - Every artifact should say which packets, workflows, and trust/follow-up
     facts it depends on.
   - Freshness and staleness must be inspectable.

4. **One canonical artifact per workflow shape.**
   - `task_preflight` is enough; do not add three near-duplicate kickoff docs.
   - `implementation_handoff` is enough; do not recreate packet handoff under a
     different label.

5. **Keep wrappers opt-in.**
   - Hooks, CI, file export, and editor surfaces are wrappers around stable
     artifact generators.
   - They are not the source of truth and not required for the product path.

6. **No second planner.**
   - Roadmap 7 must not add a second planning layer beside:
     - `ask`
     - packet handoff
     - `investigate`

7. **No ML or learned rollout in this roadmap.**
   - Telemetry may inform human rollout decisions.
   - Telemetry must not silently rewrite ranking or exposure here.

8. **Close Roadmap 7 at `7.5` unless a separate problem actually appears.**
   - `7.5` should evaluate the shipped artifact and wrapper families.
   - Do not open `7.6` just because integration scope still feels expandable.

## Research-Derived Guidance

Roadmap 7 should preserve the patterns that the codebase already proved:

- typed basis before prose
- local-first evidence
- narrow canonical workflows
- explicit stop conditions and explicit follow-up

Carry these constraints through the phases:

- generated artifacts must stay inspectable back to their basis refs
- integrations should surface artifacts where users work, not generate them
  speculatively in the background
- packet/workflow outputs remain the substrate; artifact generation is a layer
  above them
- evaluation should decide exposure per artifact or wrapper family, not once at
  the roadmap level

## What To Avoid

- no scheduler requirement
- no ML / learned rollout
- no artifact sprawl that recreates Fenrir-style tool sprawl under a new label
- no artifact that cannot explain where it came from
- no wrapper proliferation just because an export is technically possible
- no hidden persistent automation state in the first slice

## Verification Posture

Each phase should leave behind:

- typed contract coverage
- focused artifact smokes
- at least one realistic usefulness check
- doc updates when artifact shape or integration scope changes

Concrete first-slice defaults to keep reviews honest:

- `task_preflight`
  - should start as a composition of existing implementation / verification
    context, not a new planning engine
- `implementation_handoff`
  - should preserve packet and workflow basis refs instead of flattening them
    into prose only
- wrapper surfaces
  - should begin as explicit opt-in entrypoints, not automatic background jobs

## Expected Completion State

Roadmap 7 is complete when:

- mako can generate a small set of typed artifacts that are clearly more useful
  than reading the raw packets/workflows directly
- at least one generated artifact is surfaced cleanly in the main harness or
  external-agent flow
- optional exports exist without becoming mandatory product infrastructure
- the artifact and wrapper families are eval-backed and narrow enough to avoid
  new sprawl

At that point, Roadmap 8 can learn from usage history instead of guessing about
rollout or artifact value.

## Current Status

- Roadmap 6 is complete.
- Roadmap 7 is now opened as the next roadmap package.
- `7.0` is shipped:
  - `ARTIFACT_KINDS`, `ArtifactBasisRef`, `ArtifactFreshness`,
    `ArtifactRefreshResult`, `ArtifactReplayResult` live in
    `packages/contracts/src/artifacts.ts`
  - default stale behavior is `warn_and_keep`
  - smoke coverage: `test/smoke/artifacts-contract.ts`
- `7.1` is shipped:
  - `task_preflight` and `implementation_handoff` payload schemas live in
    `packages/contracts/src/artifacts.ts`
  - generators, refresh, and replay helpers live in
    `packages/tools/src/artifacts/index.ts`
  - `task_preflight` composes:
    - `implementation_brief`
    - `verification_plan`
    - `change_plan`
    - optional `flow_map`
  - `implementation_handoff` composes:
    - `implementation_brief`
    - `session_handoff`
  - smoke coverage: `test/smoke/artifact-generators.ts`
- `7.3` is now shipped:
  - four artifact tools are registered on the shared tool plane:
    - `task_preflight_artifact`
    - `implementation_handoff_artifact`
    - `review_bundle_artifact`
    - `verification_bundle_artifact`
  - the same four artifact shapes are reachable through harness / API, CLI
    `tool call`, and external-agent / MCP discovery
  - the answer loop keeps one primary `workflow_packet` follow-up action
    instead of surfacing a second artifact handoff action beside it
  - the non-handoff artifact tools remain explicit tool-call surfaces
  - smoke coverage: `test/smoke/api-answer-question.ts`
- `7.2` is now shipped:
  - `review_bundle` and `verification_bundle` payload schemas live in
    `packages/contracts/src/artifacts.ts`
  - generators, refresh, and replay helpers live in
    `packages/tools/src/artifacts/index.ts`
  - `review_bundle` composes:
    - `implementation_brief`
    - `change_plan`
    - optional `flow_map`
    - optional `tenant_leak_audit`
  - `verification_bundle` composes:
    - `verification_plan`
    - optional `tenant_leak_audit`
    - optional `issues_next`
    - optional `session_handoff`
  - both preserve direct vs weak operator findings as separate typed sections
  - smoke coverage remains in `test/smoke/artifact-generators.ts`
- `7.4` is now shipped:
  - file export lands as the one wrapper surface in 7.4; editor / CI / hooks
    are deferred to post-7.5 evaluation
  - shared `ArtifactExportRequest` / `ArtifactExportResult` contract in
    `packages/contracts/src/tool-artifact-schemas.ts` extends every artifact
    tool input/output with optional `export` / `exported` blocks
  - export helper lives in `packages/tools/src/artifacts/export.ts`:
    - default directory `.mako/artifacts/<kind>/`, default formats = all
      renderings the artifact produced, filename = `<artifactId>.{json,md,txt}`
    - project-root path guard rejects `..` and absolute paths outside the
      project; atomic `tmp`+rename write
  - every artifact family declares `file_export` as a consumer target and
    `exportIntent = { exportable: true, defaultTargets: ["file_export"] }`;
    the 7.0 `refineArtifactShape` subset rule validates the flip
  - the exported JSON body is the canonical projection (every identity /
    basis / freshness / payload field except `renderings` — renderings are
    the files on disk)
  - smoke coverage: `test/smoke/artifact-file-export.ts`
- `7.4.1` is now shipped (forgebench validation + regression cleanup):
  - driven by running the shipped 7.0–7.4 stack against real forgebench
    and triaging what surfaced; see
    `devdocs/roadmap/version-7/forgebench-triage.md` and
    `devdocs/roadmap/version-7/phases/phase-7.4.1-forgebench-validation-and-regression-cleanup.md`
  - artifact-layer: graceful empty-surface rendering for
    `task_preflight` / `review_bundle`; session focus + momentum now
    surface in `implementation_handoff` keyContext
  - graph-layer: route locator accepts `"GET /api/events"` / `"/dashboard/admin"`
    forms; RPC locator prefix-matches bare `<schema>.<name>` against stored
    `(<argTypes>)` keys; indexer now extracts RPC bodies past `-- banner`
    comments and merges `bodyText` across schema sources
  - operator-layer: tenant-audit findings dedupe by message in artifact
    projection; `rpcSurfaceKey` single-qualified (fixes `public.public.`
    cosmetic bug); `collectSchemaUsages` skips non-code file languages
  - indexer-layer (pre-existing regression caught in the full sweep):
    `chunks.search_text` now folds per-file symbol names through the
    camelCase-aware splitter, so FTS phrase search reaches identifiers
    like `loadUsers` via `"load users"`
  - forgebench measured impact: `change_plan` route→table from
    `0/0/0` to `direct=4, dependent=6, steps=10`; `tenant_leak_audit`
    `32 noisy → 20 real` weak signals; all four artifacts carry
    non-empty graph-derived structural content for realistic queries
  - full `pnpm test:smoke` green after every fix
- `7.5` is now shipped (usefulness evaluation + default exposure):
  - pre-eval contract reconciliations closed (not amended): `trust_run` /
    `trust_evaluation` emit from `verification_bundle`; `workflow_followup`
    emits from `implementation_handoff`; `review_bundle` basis drift closed
    (`impact_packet` + diagnostics now wired)
  - new artifact usefulness evaluator contract at
    `packages/contracts/src/artifact-evaluation.ts` + implementation at
    `packages/tools/src/artifact-evaluation.ts`; mirrors R6 PowerWorkflow
    grading shape; per-family scoring for all four artifact kinds plus wrapper
    eval for `tool_plane` / `file_export`
  - eval-runner integration in `packages/tools/src/evals/runner.ts`:
    `TrustEvalRunSummary.artifactUsefulness` surfaces alongside
    `powerWorkflowUsefulness`
  - smoke coverage: `test/smoke/artifact-usefulness-evaluation.ts` (new) +
    extended `test/smoke/artifact-generators.ts` with close-path coverage
  - dismount outcome: every shipped family resolves to its target exposure; no
    families removed; thresholds conservative by design
  - editor / CI / hooks remain deferred; no friction surfaced in this eval cycle
- `7.6` is now shipped (code-intel tool surface expansion — post-7.5 narrow
  extension opened under the separate-problem exception):
  - new `code_intel` tool category with three tools registered on the shared
    tool plane: `ast_find_pattern` (wraps `@ast-grep/napi` structural search),
    `lint_files` (exposes `collectDiagnosticsForFiles`), `repo_map` (aider-style
    token-budgeted repo outline with centrality scoring + focus boost)
  - cookbook doc: `devdocs/ast-find-pattern-cookbook.md` (10 recipes)
  - forgebench probes: `scripts/forgebench-ast-find.ts` +
    `scripts/forgebench-code-intel.ts`; probe results recorded in the phase doc
  - smokes: `test/smoke/ast-find-pattern.ts`, `test/smoke/lint-files.ts`,
    `test/smoke/repo-map.ts` — all green
  - `pnpm typecheck` + `pnpm run test:smoke` green
- Roadmap 7 is complete. Roadmap 8 can begin.
