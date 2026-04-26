# Phase 7.0 Artifact Contract And Basis Model

Status: `Shipped`

## Implementation Notes

- contract landed in `packages/contracts/src/artifacts.ts` and is re-exported
  from the contracts barrel
- `ARTIFACT_KINDS` matches the disambiguation table (4 kinds)
- `ArtifactBasisRef` carries `kind`, `sourceId`, `fingerprint`, `sourceOrigin`
- `ArtifactFreshness` defaults to `warn_and_keep`; `auto_refresh` is opt-in
  per family in 7.3+
- `ArtifactRefreshResult` and `ArtifactReplayResult` declare the operation
  shapes; generators land per family in 7.1 / 7.2
- `ArtifactBaseShape` is exported so 7.1 / 7.2 can extend it with a typed
  payload schema per family; run the extended schema through
  `refineArtifactShape` to keep basis / freshness / rendering invariants
  consistent across families
- enforced invariants:
  - `basis`, `consumerTargets`, `renderings` are non-empty
  - at least one rendering has `format: "json"` and its body must parse as JSON
  - `state: "fresh"` implies `staleBasisRefIds` is empty
  - `state: "stale"` implies `staleBasisRefIds` is non-empty and every id
    appears in `basis`
  - `metadata` is validated recursively as real JSON, not opaque `unknown`
- smoke coverage: `test/smoke/artifacts-contract.ts`

## Goal

Define the shared generated-artifact model that later Roadmap 7 outputs rely
on.

## Rules

- artifacts must declare their typed basis explicitly
- canonical output is JSON-first
- rendered markdown or file output is a projection, not the source of truth
- freshness and staleness must be inspectable
- start from Roadmap 5 and 6 outputs instead of reparsing raw traces when a
  packet/workflow basis already exists

## This Phase Should Establish

- shared artifact kinds
- artifact identity and basis refs
- freshness / staleness shape
- consumer target metadata
- render intent and export intent

## Artifact Disambiguation

Roadmap 7 artifacts must stay distinct from existing Roadmap 5 packets. Use
this table as the authority when a new kind is proposed; if a new artifact
overlaps an existing row, it probably does not need to exist.

| Artifact                | Phase | Audience             | Primary basis                                                  | Use when                                                       |
| ----------------------- | ----- | -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `implementation_brief`  | R5    | starter              | packet + trust state                                           | user wants the canonical "how do I change X" packet            |
| `verification_plan`     | R5    | starter / verifier   | packet + trust state                                           | user wants canonical verification for a scoped change          |
| `session_handoff`       | R5    | next agent           | packet + session state                                         | user hands a running session to someone else                   |
| `task_preflight`        | 7.1   | starter              | `implementation_brief` + `change_plan` + `verification_plan`   | user is about to start work and wants one read-before artifact |
| `implementation_handoff`| 7.1   | next agent / engineer| `implementation_brief` + `session_handoff` + follow-ups        | work is paused mid-flight and needs a typed continuation       |
| `review_bundle`         | 7.2   | reviewer             | `change_plan` + `impact_packet` + diagnostics                  | change is ready for review and reviewer needs a packaged view  |
| `verification_bundle`   | 7.2   | verifier / operator  | `verification_plan` + `tenant_leak_audit` + `issues_next`      | change is ready to verify / ship and needs operator coverage   |

Rules:

- if a proposed artifact fits an existing row, extend that row instead of
  adding a new kind
- if a proposed artifact cannot point at concrete basis inputs in this table,
  it is not ready for 7.0

## Basis Ref Shape

Every artifact must carry an ordered list of typed basis refs. A basis ref
records at minimum:

- `kind` — the packet / workflow / trust / follow-up family it points at
- `id` — the stable id of that source
- `fingerprint` — a hash of the relevant source state used for staleness
- `source_origin` — `"local"` for mako-derived evidence, `"reference"` for
  documentation / external context that is source-labeled input only

Reference-second basis refs must stay clearly marked; artifacts may use them
only as support, not as authoritative evidence.

## Freshness And Staleness

Artifacts are `fresh` when every basis-ref fingerprint still matches the
source. Otherwise they are `stale`.

Default behavior on stale:

- the artifact remains inspectable and keeps its basis refs
- consumers see an explicit `stale` marker plus which basis refs diverged
- artifacts are not silently auto-regenerated

Artifact families may opt into `auto-refresh` in 7.3+ only if a usefulness
check justifies it. In 7.0 the default is `warn-and-keep`.

## Refresh Vs Replay

Two operations must exist for every artifact family:

- `refresh` — regenerate using current basis state; produces a new artifact id
  and supersedes the stale one
- `replay` — rebuild the same artifact from its recorded basis refs without
  consulting current state; used for audit and handoff continuity

Callers must choose one explicitly. 7.0 defines both operations on the
contract so 7.1/7.2 artifacts do not each invent ad-hoc refresh semantics.

## Product Boundary

This phase is about the contract and rendering boundary, not about shipping a
large number of artifacts yet.

If a proposed feature is mostly “another artifact kind,” it probably belongs in
`7.1` or `7.2`, not here.

## Non-Goals

- no scheduler or background generation
- no artifact sprawl
- no new packet family just because rendering would be easier

## Success Criteria

- Roadmap 7 has one canonical artifact contract
- artifacts can point back to packet/workflow basis cleanly
- rendered outputs are clearly projections of typed state
- the disambiguation table is the authority for adding new artifact kinds
- every basis ref carries `source_origin`, `fingerprint`, and supports
  `refresh` and `replay`
- the default stale behavior is `warn-and-keep` unless a family proves it
  should auto-refresh
