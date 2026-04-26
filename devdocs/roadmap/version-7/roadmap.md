# Roadmap Version 7

This file is the canonical roadmap for the Roadmap 7 build cycle.

If another Roadmap 7 doc disagrees with this file about what the roadmap is
for, what phases it contains, or what counts as done, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-5/roadmap.md](../version-5/roadmap.md)
- [../version-5/handoff.md](../version-5/handoff.md)
- [../version-6/roadmap.md](../version-6/roadmap.md)
- [../version-6/handoff.md](../version-6/handoff.md)

## Roadmap Contract

Roadmap 7 is the `Generated Artifacts And Workflow Integration` roadmap.

Its job is to turn the shipped packet and power-workflow substrate into a small
set of durable generated artifacts and tightly-scoped workflow integrations
without reintroducing vague planning layers or background automation sprawl.

Roadmap 7 should make `mako-ai` better at:

- turning trusted workflow context into reusable handoff artifacts
- generating task preflight / review / verification artifacts from typed basis
  data
- surfacing those artifacts directly in the harness, CLI, and external-agent
  loop
- exporting artifacts through optional CI / hook / editor surfaces when that is
  actually useful

Roadmap 7 does **not** rebuild:

- workflow packet contracts
- graph / operator / project-intelligence workflow families
- trust storage or exposure policy
- ML or learned rollout logic
- any required scheduler / daemon dependency

## Entry Assumptions

Roadmap 7 begins with all of these already shipped:

- strong primitive tools across code, schema, and DB
- trust, compare, rerun, and follow-up tracking
- typed workflow packets and packet handoff
- graph / flow / change-scope workflows
- operator-grade tenancy audit
- project-level handoff / health / queue surfaces
- bounded investigate / suggest workflows
- workflow usefulness and advisory exposure evaluation

That means the first Roadmap 7 phase should package and render those outputs,
not reopen the lower layers.

## Core Deliverables

Roadmap 7 should ship these artifact and integration families:

- a generated artifact contract and basis model
- generated task preflight artifacts
- generated implementation / review / handoff artifacts
- generated verification / change-management artifacts
- deeper harness / CLI / external-agent integration for those artifacts
- optional export and wrapper surfaces:
  - files
  - hooks
  - CI
  - editor/export entrypoints

Every new artifact should:

- declare its typed basis explicitly
- remain reproducible from packet/workflow inputs
- expose JSON-first canonical data with rendered projections as a convenience
- stay narrow and canonical for its workflow shape
- leave behind eval hooks that prove it is helpful instead of noisy

## Research-Grounded Shape

Roadmap 7 should preserve these design patterns:

1. **Typed basis before rendering**
   - artifact identity and freshness should come from typed basis refs, not
     only from markdown text

2. **One artifact, many trusted inputs**
   - Roadmap 7 should compose the strongest shipped packet/workflow families
     into one artifact when the user question is broader than one packet

3. **Explicit consumer surfaces**
   - artifact generation should say where it is meant to be consumed:
     - harness
     - CLI
     - external agent
     - hook / CI / file export

4. **Local-first provenance**
   - artifacts must preserve the local basis that generated them and may only
     include reference-second context as source-labeled input

5. **Optional wrappers, not mandatory automation**
   - hooks / CI / editor surfaces can wrap stable artifacts, but Roadmap 7
     should not require a background worker or daemon

## Roadmap Rules

1. One canonical artifact per workflow shape.
2. No free-form generated docs without typed basis refs.
3. No second planner beside `ask`, packet handoff, or `investigate`.
4. Prefer on-demand artifact generation before any persistent automation.
5. No ML / learned policy in this roadmap.
6. If an artifact cannot be evaluated, it is not ready to ship.
7. Do not treat wrapper count as product progress; the core value is the
   artifact itself.

## Evaluation Rule

Roadmap 7 must reuse the Roadmap 5 and 6 evaluation posture.

That means:

- add focused smokes for every new artifact family
- add at least one realistic usefulness check per family
- evaluate whether an artifact improves work compared with using the underlying
  packets/workflows directly
- keep explicit fallback states for integrations that do not earn broader
  exposure

Roadmap 7 should also make these boundaries explicit during implementation:

- which inputs are basis-critical vs optional enrichments
- which artifacts are generated-only vs generated-plus-exported
- which integrations are on-demand vs wrapper-driven
- which wrappers are default, opt-in, dark, or not promoted

## Phase Sequence

1. `Phase 7.0` — artifact contract and basis model
2. `Phase 7.1` — task preflight and implementation handoff artifacts
3. `Phase 7.2` — review, verification, and change-management artifacts
4. `Phase 7.3` — harness, CLI, and external-agent integration
5. `Phase 7.4` — optional workflow integrations and export surfaces
6. `Phase 7.4.1` — forgebench validation and regression cleanup
   (post-7.4 repair pass, not a new-feature phase)
7. `Phase 7.5` — usefulness evaluation and default exposure rules
8. `Phase 7.6` — code-intel tool surface expansion
   (post-7.5 narrow extension; code-intel primitives packaged on the shared tool plane)

## Phase Summary

### Phase 7.0 Artifact Contract And Basis Model

Define the shared artifact model that later generated outputs rely on.

This phase should establish:

- shared artifact kinds
- basis refs to packets / workflows / trust state / follow-up facts
- freshness and staleness rules
- canonical JSON shape plus rendered projections
- explicit consumer targets and export intent

This phase should start from Roadmap 5 and 6 outputs, not from free-form
markdown generation.

### Phase 7.1 Task Preflight And Implementation Handoff Artifacts

Ship the first day-to-day generated artifacts:

- `task_preflight`
- `implementation_handoff`

These should answer:

- what should I read, change, and verify before I start?
- what does another agent or reviewer need to know to continue this work?

These artifacts should compose the strongest existing inputs such as:

- `implementation_brief`
- `change_plan`
- `verification_plan`
- `flow_map`
- `session_handoff`

Current shipped slice:

- concrete payload contracts live in `packages/contracts/src/artifacts.ts`
- generator / refresh / replay helpers live in
  `packages/tools/src/artifacts/index.ts`
- `task_preflight` composes:
  - `implementation_brief`
  - `verification_plan`
  - `change_plan`
  - optional `flow_map`
- `implementation_handoff` composes:
  - `implementation_brief`
  - `session_handoff`
- harness / CLI / external-agent surfacing remains deferred to `7.3`

### Phase 7.2 Review, Verification, And Change-Management Artifacts

Ship broader generated artifacts around review and safe completion:

- `review_bundle`
- `verification_bundle`
- adjacent change-management artifacts where justified

These should answer:

- what should a reviewer inspect?
- what must be verified before or after this change?
- what risks or operator checks should not be missed?

These artifacts should stay distinct from the underlying packet/workflow
families:

- they package and project multiple trusted inputs together
- they do not replace `verification_plan`, `tenant_leak_audit`, or
  `change_plan`

Current shipped slice:

- `review_bundle`
  - lives in `packages/contracts/src/artifacts.ts`
  - generator / refresh / replay live in `packages/tools/src/artifacts/index.ts`
  - composes:
    - `implementation_brief`
    - `change_plan`
    - optional `flow_map`
    - optional `tenant_leak_audit`
  - keeps reviewer guidance, active risks, and direct / weak operator findings
    in separate typed sections
- `verification_bundle`
  - lives in `packages/contracts/src/artifacts.ts`
  - generator / refresh / replay live in `packages/tools/src/artifacts/index.ts`
  - composes:
    - `verification_plan`
    - optional `tenant_leak_audit`
    - optional `issues_next`
    - optional `session_handoff`
  - keeps stop conditions explicit and separates operator findings from
    change-management checks
- harness / CLI / external-agent surfacing remains deferred to `7.3`

### Phase 7.3 Harness, CLI, And External-Agent Integration

Surface the generated artifacts where users actually work:

- harness
- CLI
- external-agent flows

This phase should answer:

- how does a user request one of these artifacts in the main workflow loop?
- how should the harness or agent surface the artifact without adding a second
  planner?

The first slice should stay on-demand and explicit:

- user requests it
- or a bounded existing workflow recommends it
- but Roadmap 7 should not silently generate and persist artifacts in the
  background by default

Current shipped slice:

- four shared artifact entrypoints are now exposed:
  - `task_preflight_artifact`
  - `implementation_handoff_artifact`
  - `review_bundle_artifact`
  - `verification_bundle_artifact`
- those tools compose the corresponding shipped `7.1` / `7.2` generators over
  the existing workflow substrate
- the same artifact shapes are now reachable through:
  - harness / API tool calls
  - CLI `tool call`
  - external-agent / MCP tool discovery
- the answer loop stays singular in this slice:
  - answers that already attach a companion packet keep one primary
    `workflow_packet` follow-up action
  - artifact generation does not add a second competing handoff action beside
    it
- `task_preflight_artifact`, `review_bundle_artifact`, and
  `verification_bundle_artifact` remain intentionally tool-call-only in this
  integration slice because they require explicit caller intent and, for the
  graph-backed ones, explicit graph basis inputs

Not yet shipped:

- no refresh / replay integration tool surface yet
- no user-facing wrapper/export surfaces yet
- no new bounded answer-loop recommendation for the non-handoff artifact
  families

### Phase 7.4 Optional Workflow Integrations And Export Surfaces

Wrap stable artifacts in optional delivery surfaces:

- file export
- editor/export entrypoints
- CI
- hooks

These should answer:

- how does an artifact leave the main runtime when a user actually wants that?
- which integrations are worth keeping as wrappers around stable artifact
  generators?

This phase should stay disciplined:

- opt-in first
- no required scheduler
- no wrapper proliferation without clear daily-friction value

Current shipped slice:

- **file export** ships across all four artifact families as a caller opt-in
  on the shared tool plane
- shared `ArtifactExportRequest` / `ArtifactExportResult` contract lives in
  `packages/contracts/src/tool-artifact-schemas.ts`; every artifact tool
  accepts `export: { file: { directory?, formats? } }` and returns
  `exported: { files: [...] }`
- export helper lives in `packages/tools/src/artifacts/export.ts`:
  - default directory `.mako/artifacts/<kind>/`
  - default formats = every rendering the artifact produced
  - filename = `<artifactId>.{json,md,txt}` (basis-deterministic)
  - project-root path guard + atomic write
- all four families now declare `file_export` as a consumer target with
  `exportIntent = { exportable: true, defaultTargets: ["file_export"] }`; the
  7.0 `refineArtifactShape` subset rule enforces the flip
- **editor / CI / hooks are intentionally deferred** to post-7.5 evaluation —
  the phase rule "fewer high-value wrappers beats broader wrapper coverage"
  says these should only ship against a named friction proven in normal usage,
  and 7.5 is where that signal shows up
- smoke coverage: `test/smoke/artifact-file-export.ts`

### Phase 7.5 Usefulness Evaluation And Default Exposure Rules

Status: `Shipped`

Closed Roadmap 7 by proving the new artifact families and wrapper surfaces are
helpful enough to matter in normal usage.

Pre-eval contract reconciliations (both closed, not amended):

- `trust_run` / `trust_evaluation` basis kinds now emit from
  `verification_bundle` when a traceId is available; `workflow_followup` now
  emits from `implementation_handoff` over the N most recent follow-up results.
- `review_bundle` basis drift closed: `impact_packet` and diagnostics (rule-pack
  + alignment diagnostics from R4) wired into the generator. The 7.0
  disambiguation-table row now matches what ships.

Artifact exposure policy (see the phase doc for the full table):

- `task_preflight` → `default` (fallback `opt_in`)
- `implementation_handoff` → `opt_in` (fallback `dark`)
- `review_bundle` → `default` (fallback `opt_in`)
- `verification_bundle` → `opt_in` (fallback `dark`)

Wrapper exposure policy:

- `tool_plane` → `default` (fallback `opt_in`)
- `file_export` → `opt_in` (fallback `not_promoted`)
- editor / CI / hooks remain deferred per the 7.4 decision; no friction
  surfaced in 7.5 eval to justify shipping them.

Dismount outcome: every shipped family resolved to its target exposure. No
families removed. Thresholds are conservative first-slice picks; operators
should raise them in Roadmap 8 before relying on broader rollout decisions.

See [./phases/phase-7.5-usefulness-evaluation-and-default-exposure.md](./phases/phase-7.5-usefulness-evaluation-and-default-exposure.md)
for the full reconciliation outcomes, policy tables, and shipped-slice detail.

Roadmap 7 is complete at 7.5 for the original roadmap contract.

### Phase 7.6 Code-Intel Tool Surface Expansion

Status: `Shipped`

Opened after 7.5 closed under the 7.5 rule that allows a later phase only when
a truly separate operational packaging problem appears after evaluation. The
7.5 eval cycle surfaced that several code-intel primitives were already
shipping internally but not on the public tool plane, and that aider-style
repo orientation was a real gap for agents meeting forgebench cold. That is a
separable problem from 7.5's usefulness evaluation.

Goal: expose the code-intel primitives that already ship inside `@mako-ai/tools`
as public tools on the shared tool plane, and add one genuinely medium-effort
repo-orientation tool (`repo_map`) using the aider-style substrate already
present in the codebase.

Build:
- new `code_intel` tool category with three tools:
  - `ast_find_pattern` — read-only structural pattern search wrapping
    `@ast-grep/napi`; bounded `maxMatches` / `maxFiles`; typed captures
  - `lint_files` — exposes `collectDiagnosticsForFiles` as a public tool;
    bounded `maxFindings`; typed `AnswerSurfaceIssue[]` output
  - `repo_map` — aider-style token-budgeted compact outline; centrality scoring
    (`fanIn * 2 + fanOut + 0.1`); focus boost; aider visual formatter
- cookbook doc: `devdocs/ast-find-pattern-cookbook.md` (10 recipes)
- forgebench probes: `scripts/forgebench-ast-find.ts` +
  `scripts/forgebench-code-intel.ts`
- smokes: `test/smoke/ast-find-pattern.ts`, `test/smoke/lint-files.ts`,
  `test/smoke/repo-map.ts`

Done when: every new tool has contract + wrapper + smoke + registry entry;
`code_intel` is a coherent category; real-project forgebench probe produces
non-trivial output; `pnpm typecheck` + `pnpm run test:smoke` green.

See [./phases/phase-7.6-code-intel-tool-surface-expansion.md](./phases/phase-7.6-code-intel-tool-surface-expansion.md)
for the full shipped-slice detail, forgebench probe results, and placement
rationale.

## What Comes Next

Roadmap 8 should start only after the generated artifacts and wrapper surfaces
exist, are typed, and prove useful.

Roadmap 8 is where telemetry should start changing ranking, routing, and
rollout policy automatically.
