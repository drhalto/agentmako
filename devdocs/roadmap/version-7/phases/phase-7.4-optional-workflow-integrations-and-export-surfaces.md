# Phase 7.4 Optional Workflow Integrations And Export Surfaces

Status: `Complete`

## Goal

Wrap stable generated artifacts in optional delivery surfaces.

Surfaces, ordered by priority:

1. **file export** — default ship target; lowest cost, direct daily value
2. **editor / export entrypoints** — stretch; ship only if file export alone
   does not remove the friction
3. **CI** — stretch; ship only if a concrete repeating CI need is already
   proven in normal usage
4. **hooks** — stretch; same bar as CI

Default posture: ship file export, treat the other three as opt-in stretch
work justified by observed friction, not completeness.

## Rules

- wrappers stay secondary to the artifact generator
- opt-in first
- preserve basis and freshness metadata through export
- do not require a scheduler or daemon
- fewer high-value wrappers beats broader wrapper coverage

## Product Boundary

These wrappers should answer:

- how does an artifact leave the main runtime when a user wants it elsewhere?
- which exports or hooks are worth keeping because they remove real friction?

This phase should stay small. If a wrapper does not clearly reduce daily
friction, it should not ship.

## Non-Goals

- no mandatory background automation
- no wrapper for every artifact just because it is possible
- no learned rollout logic

## Success Criteria

- file export ships for at least one stable artifact family and preserves
  typed provenance (basis refs, `source_origin`, freshness markers)
- any stretch wrapper (editor / CI / hooks) ships only with a named friction
  it removes; otherwise it does not ship
- every shipped wrapper is evaluated independently in 7.5

## Current Shipped Slice

- File export ships across **all four** artifact families as a caller opt-in
  on the shared tool plane:
  - `task_preflight_artifact`
  - `implementation_handoff_artifact`
  - `review_bundle_artifact`
  - `verification_bundle_artifact`
- Shared `ArtifactExportRequest` / `ArtifactExportResult` contract lives in
  `packages/contracts/src/tool-artifact-schemas.ts`. Every artifact tool input
  accepts an optional `export: { file: { directory?, formats? } }` block; the
  matching output returns an optional `exported: { files: [...] }` pointer.
- Export helper lives in `packages/tools/src/artifacts/export.ts`:
  - default directory `.mako/artifacts/<kind>/`
  - default formats = every rendering the artifact produced
  - filename = `<artifactId>.{json,md,txt}` (basis-deterministic; idempotent
    overwrite when basis is unchanged)
  - project-root path guard rejects `..` traversal and absolute paths outside
    the project
  - atomic write (`tmp` + rename) so a partial write cannot leave half a
    file on disk
- Every artifact family now declares `file_export` as a consumer target, and
  the default `exportIntent` is `{ exportable: true, defaultTargets:
  ["file_export"] }`. The 7.0 `refineArtifactShape` subset rule enforces that
  `defaultTargets ⊆ consumerTargets`, so this flip is validated at the
  contract layer.
- Exported JSON is the artifact's canonical **projection** (every
  identity / basis / freshness / payload field except `renderings`).
  Renderings are the files on disk — reintroducing them into the JSON body
  would be self-referential.

## Intentionally Deferred

- editor / CI / hook wrappers are not shipped in 7.4. The phase rule
  (`fewer high-value wrappers beats broader wrapper coverage`) says these
  should ship only against a named friction proven in normal usage; 7.5 is
  the evaluation pass that produces that signal.
- no refresh / replay tool surface yet — artifact identity is
  basis-deterministic, so re-exporting with the same basis lands on the same
  paths without needing a dedicated refresh tool.
- no persistent artifact cache. Export remains on-demand and stateless.

## Verification

- `test/smoke/artifact-file-export.ts`
  - proves all four artifact tools accept `export: { file: ... }` and return
    a matching `exported: { files: [...] }` block
  - proves default directory is `.mako/artifacts/<kind>/` and default
    formats cover every available rendering
  - proves caller can override `directory` and restrict `formats`
  - proves omitting `export` writes nothing (no default directory created)
  - proves `..`-based path traversal through `directory` is rejected before
    any write hits disk
  - proves the written JSON body carries the canonical projection fields
    (`artifactId`, `basis`, `freshness`, `exportIntent`, `consumerTargets`,
    `payload`) and that `exportIntent.exportable === true` with
    `defaultTargets: ["file_export"]`
- `test/smoke/artifacts-contract.ts` still exercises the 7.0
  `refineArtifactShape` subset rule that gates this phase.
