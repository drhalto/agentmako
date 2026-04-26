# Phase 4.5 Trust Surfaces

Status: `Completed`

This file is the canonical shipped record for Roadmap 4 Phase 4.5. It exposed the trust layer to real consumers without inventing a second answer system.

Use [../roadmap.md](../roadmap.md) for final roadmap status. Use [./phase-4.3-contradiction-and-drift-engine.md](./phase-4.3-contradiction-and-drift-engine.md) plus [./phase-4.4a-ts-aware-alignment-diagnostics.md](./phase-4.4a-ts-aware-alignment-diagnostics.md) / [./phase-4.4b-structural-and-sql-diagnostics.md](./phase-4.4b-structural-and-sql-diagnostics.md) for the shipped trust outputs this phase consumes.

## Shipped Outcome

Trust is no longer store-only state.

Agents and humans can now consume, from the normal answer surface:

- latest trust state
- trust reason codes
- diagnostics
- de-emphasis/ranking explanation

## What Shipped

### Shared contract

`AnswerResult` now carries additive trust-layer fields:

- `trust`
- `diagnostics`
- `ranking`

Those fields ship from the same shared contracts used by CLI, API, MCP, and web consumers:

- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tools.ts`

### Runtime enrichment

Answer and composer paths now enrich normal results through:

- `packages/tools/src/trust/enrich-answer-result.ts`

This keeps trust presentation attached to the typed answer instead of inventing a parallel UI-only layer.

### CLI

Interactive CLI output now renders trust-aware summaries for:

- `ask`
- direct tool-call flows that return answer-shaped results

Primary file:

- `apps/cli/src/commands/tools.ts`

### Web

The web answer card now renders:

- trust-state badge/section
- compare summary
- ranking/de-emphasis badge
- diagnostics list

Primary file:

- `apps/web/src/components/AnswerPacketCard.tsx`

### API and MCP

No separate trust-specific transport was introduced.

Instead, API/MCP consumers inherit the additive machine-readable fields wherever `AnswerResult` already flows through the shared schema.

## Surface Contract

The shipped surface keeps one consistent envelope:

- trust state and reasons live under `answerResult.trust`
- diagnostics live under `answerResult.diagnostics`
- policy/ranking lives under `answerResult.ranking`

That prevents CLI, MCP/API, and web from inventing different trust languages.

## Acceptance Criteria Met

- trust state is visible from CLI, API/MCP, and web through the shared answer contract
- no opaque score was introduced
- compare and trust summaries are consumable without reading raw diff JSON
- surfaced diagnostics use one consistent contract instead of ad hoc rendering shapes
- programmatic consumers can tell whether trust is `stable`, `changed`, `aging`, `stale`, `superseded`, `contradicted`, or `insufficient_evidence`

## Intentional Limits

4.5 intentionally did **not**:

- build a separate trust dashboard
- mix ranking policy into the surface contract
- invent surface-only trust semantics

Trust surfaces remain a view over the underlying trust substrate, not a second system.

## Primary Files

- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tools.ts`
- `packages/tools/src/trust/enrich-answer-result.ts`
- `packages/tools/src/answers/index.ts`
- `packages/tools/src/composers/_shared/define.ts`
- `apps/cli/src/commands/tools.ts`
- `apps/web/src/components/AnswerPacketCard.tsx`

## Post-Closeout Additions

### SARIF 2.1.0 output

`AnswerSurfaceIssue` now emits directly as SARIF 2.1.0 so mako findings flow
into GitHub Code Scanning, VS Code Problems, GitLab Code Quality, and any
other SARIF-aware consumer without bespoke ingest code. The identity triple
(`matchBasedId` / `codeHash` / `patternHash`) maps onto SARIF
`partialFingerprints` for cross-run dedup in GitHub's Security tab.

Shipped artifacts:

- `packages/tools/src/sarif.ts` — zero-dependency SARIF emitter with typed
  subset of the 2.1.0 spec covering the fields we populate
- `formatAnswerResultAsSarif(result, options?)` — merges
  `trust.issues` / `diagnostics` / `ranking.reasons`, dedupes by
  `matchBasedId`, attaches `trustState` / `trustScopeRelation` /
  `rankingOrderKey` / `rankingDeEmphasized` as result-level properties
- `formatSurfaceIssuesAsSarif(issues, options?)` — lower-level entry for
  flat issue lists that now follows the same `matchBasedId` dedupe semantics
  as the answer-surface exporter
- `test/smoke/sarif-output.ts` — full shape verification + JSON round-trip
- `devdocs/sarif-output.md` — API reference, severity mapping, GitHub Code
  Scanning wiring example

SARIF output is available from the `@mako-ai/tools` package root; consumers
do not need to touch any internal module to emit it.

Severity mapping: `critical` / `high` → `error`, `medium` → `warning`,
`low` → `note`. The fourth SARIF level (`none`) is intentionally unused —
mako does not emit findings that would be `none`-worthy.
