# Roadmap 7 — Future Ideas

Parked design notes that are out of scope for the shipping Roadmap 7 phases
but worth keeping in one place so they are not re-derived from scratch later.

Rule: an entry lives here if it is (a) a real observation from reference
research or a concrete gap we hit, and (b) not load-bearing for 7.5
evaluation. Anything 7.5 depends on belongs in the phase docs, not here.

## Live freshness check via If-Match-on-read

**Pattern source.** `openclaw-main/src/gateway/server-methods/exec-approvals.ts`
uses an If-Match style optimistic-concurrency check: the caller presents the
content hash from the last read; the server rejects the request with
`"changed since last load; re-run ... and retry"` if the hash no longer
matches current state.

**Application to artifacts.** A future `verify_artifact_freshness` tool could
take a caller-held artifact projection (or just its `basis` array), re-derive
each basis ref's fingerprint from the current project, and return a
`{ state: "fresh" | "stale", changedBasisRefIds: [...] }` response. No new
persistence required — the projection already carries the fingerprints, and
the generators already know how to re-derive basis from current state.

**Why this is parked, not shipped.** Roadmap 7.4 shipped
`changedBasisRefIds` on `refreshArtifact`, which covers the
"refresh-time diff" half of the reference patterns (continue-main's
`RefreshIndexResults`, aider's `force_refresh`). The openclaw
If-Match-on-read flavor only becomes useful once there is a concrete consumer
of exported artifact files that wants to ask "is this still valid?" without
rebuilding the whole artifact. 7.5 evaluation should surface whether that
consumer actually exists — if it does, this is the natural follow-on shape.

**Shape to consider when picking it up later.**

- Input: either the full artifact, or just `{ basis, projectId }`.
- Output: `{ state: "fresh" | "stale", changedBasisRefIds: [...] }`.
- No mutation, no persistence. Read-only.
- Should reuse the same basis-builders (`buildWorkflowPacketBasisRef`,
  `buildChangePlanBasisRef`, etc.) so freshness checks cannot drift from
  how artifacts are generated in the first place.
- The `staleBasisRefIds` field on `ArtifactFreshness` already exists for
  this — the tool just needs to populate it against current state instead
  of against the prior artifact.

## Projection round-trip (load exported JSON back as a live artifact)

**Context.** The exported `<artifactId>.json` is a projection that omits
`renderings` — including them inside the JSON body would be circular. So
parsing an exported file through `ArtifactBaseSchema` fails, because the
schema requires `renderings: array.min(1)`.

**Why this is parked.** No current consumer loads exported artifacts back
into memory as live `ArtifactBase` objects. If one shows up (an editor
plugin that renders `.mako/artifacts/`, or a CI tool that compares today's
artifact against yesterday's), the options are:

1. Add an `ArtifactProjectionSchema` that matches the projection shape and
   have callers reconstruct `renderings` by reading the sibling `.md`/`.txt`
   files from disk.
2. Change the serialization so the `.json` body includes non-JSON renderings
   (markdown, text) but not the JSON-rendering of itself.

Either is a clean fix. Neither is needed until a real consumer drives it.

## Per-caller override of `consumerTargets`

**Context.** All four artifact generators hardcode
`DEFAULT_ARTIFACT_CONSUMER_TARGETS = ["harness", "cli", "external_agent",
"file_export"]`. Callers cannot narrow this (e.g., "I only want this
artifact for file export, do not claim harness consumption").

**Why this is parked.** No current consumer asks for this. The
`consumerTargets` field declares *capability*, not *this-call intent*. If
7.5 evaluation shows a wrapper family whose artifacts should deliberately
omit some targets (e.g., CI-only artifacts that should not be surfaced in
the harness answer loop), add a caller override then — not speculatively.

## Split `packages/tools/src/artifacts/index.ts`

**Context.** The file is now ~1,620 lines and covers basis-ref builders,
payload builders, markdown renderers, JSON projection, generate / refresh /
replay helpers, export wiring, and four tool handlers. The graph and
workflow modules got a similar cleanup pass in the post-Roadmap 6 refactor.

**Why this is parked.** Pure maintenance; no user-visible change. Worth
doing before adding another artifact family or another delivery surface.
Good candidate for a cleanup pass alongside 7.5 eval plumbing.
