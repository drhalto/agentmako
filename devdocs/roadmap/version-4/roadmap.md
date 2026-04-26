# Roadmap Version 4

This file is the canonical roadmap for the Roadmap 4 build cycle.

If another Roadmap 4 doc disagrees with this file about what shipped, what remains open, or what roadmap comes next, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-3/roadmap.md](../version-3/roadmap.md)
- [../version-3/handoff.md](../version-3/handoff.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Roadmap Contract

Roadmap 4 is the `Trust Layer` roadmap.

Its job was to make `mako-ai`:

- historically comparable instead of answer-of-the-moment only
- explicit about stale evidence, changed answers, contradiction, and drift
- better at proving whether frontend/backend/schema/type usage actually aligns
- measurable against real regression suites, not just ad hoc demos
- able to expose trust signals to agents and humans without inventing a second parallel answer system

Roadmap 4 did **not** rebuild the harness, provider layer, chat surface, or composer catalog. Those shipped in Roadmap 3. This roadmap sits on top of the shipped `AnswerPacket` / `AnswerResult` / `tool_runs` / benchmark substrate and makes it trustworthy over time.

## Roadmap 4 Status: Complete

Roadmaps 1, 2, and 3 are complete.

Roadmap 4 is now complete as well:

- Phase 4.0 (`Trust Backbone`) shipped the trust persistence substrate
- Phase 4.1 (`Evaluation Harness And Regression Suites`) shipped the trust-eval runner and real local suites
- Phase 4.2 (`Rerun And Compare`) shipped persisted compare artifacts and rerun flows
- Phase 4.3 (`Contradiction And Drift Engine`) shipped persisted trust-state classification and history reads
- Phase 4.4a (`TS-Aware Alignment Diagnostics`) shipped the first TS-aware drift diagnostics
- Phase 4.4b (`Structural And SQL Diagnostics`) shipped the first structural/relation drift diagnostics slice
- Phase 4.5 (`Trust Surfaces`) shipped additive trust/diagnostic fields and consumer rendering
- Phase 4.6 (`Ranking And Policy`) shipped narrow evidence-backed de-emphasis

## Shipped Roadmap 4 Outcomes

`mako-ai` now has:

- comparable answer history via:
  - `answer_comparable_targets`
  - `answer_trust_runs`
- rerun/compare history via:
  - `answer_comparisons`
- persisted trust-state history via:
  - `answer_trust_clusters`
  - `answer_trust_evaluations`
- explicit trust states:
  - `stable`
  - `changed`
  - `aging`
  - `stale`
  - `superseded`
  - `contradicted`
  - `insufficient_evidence`
- a standard local trust-eval runner with:
  - pinned or heuristic baselines
  - committed packet snapshots
  - trust-age controls
  - rerun fixtures
  - trust/ranking/diagnostic assertions
- first alignment diagnostics for real recurring bug families:
  - `producer.field_shape_drift`
  - `identity.boundary_mismatch`
  - `reuse.helper_bypass`
  - `auth.role_source_drift`
  - `sql.relation_alias_drift`
- additive trust surfaces on `AnswerResult`:
  - `trust`
  - `diagnostics`
  - `ranking`
- CLI and web presentation over that shared answer surface
- narrow evidence-backed ranking/de-emphasis:
  - stale / contradicted / insufficient / superseded histories are explicitly de-emphasized
  - high-confidence diagnostics can add a documented diagnostic penalty
  - no opaque aggregate score was introduced

## What Roadmap 4 Closed

Before Roadmap 4, `mako-ai` could often find the right files, routes, tables, and RPCs, but it could not reliably answer:

- is this answer still true?
- what changed since the last time we asked?
- is the newer answer actually better, or just different?
- is this older answer stale, superseded, or contradicted?
- is the frontend/backend/schema usage aligned, or just nearby?

Those gaps are now closed at the product-substrate level:

- answers are historically comparable
- reruns and compare artifacts are persisted
- trust state is explicit and queryable
- diagnostics can participate in trust interpretation
- trust can be evaluated locally with repeatable suites
- trust is exposed on normal answer surfaces instead of hidden store state

## Phase Sequence

1. `Phase 4.0` — trust backbone
2. `Phase 4.1` — evaluation harness and regression suites
3. `Phase 4.2` — rerun and compare
4. `Phase 4.3` — contradiction and drift engine
5. `Phase 4.4a` — TS-aware alignment diagnostics
6. `Phase 4.4b` — structural and SQL diagnostics
7. `Phase 4.5` — trust surfaces
8. `Phase 4.6` — ranking and policy

That sequence is now fully shipped.

## Constraint Set That Still Holds

Roadmap 4 shipped while preserving these rules:

1. **Trust attaches to typed answers, not freeform summaries.**
   - `AnswerPacket` / `AnswerResult` remain the backbone.
2. **Changed, stale, and contradicted are different states.**
3. **Trust remains evidence-based.**
   - no confidence theater
   - no opaque score
4. **Alignment diagnostics are part of trust, not a detached lint fantasy.**
5. **Evaluation and runtime trust share the same substrate.**
6. **Local-first remains non-negotiable.**

## Delivered Roadmap 4 Surfaces

### Trust Backbone

Shipped:

- structured comparable identities where deterministic
- stable fallback identity where not
- canonical and raw packet hashing
- environment fingerprint capture
- backward reconciliation for legacy answer traces

### Evaluation Harness

Shipped:

- local runner over the benchmark tables
- seeded defect, vague question, snapshot, freshness, sufficiency, scope-drift, and diagnostics suites
- explicit baseline selection and snapshot blessing
- trust/ranking/diagnostic assertion support
- real ForgeBench / ForgeBench Eval fixture execution

### Rerun And Compare

Shipped:

- manual reruns by `traceId` or `targetId`
- persisted comparison artifacts
- normalized compare summaries with meaningful-change detection

### Contradiction And Drift

Shipped:

- persisted trust-state evaluations and clusters
- TTL-based `aging` / `stale`
- conservative contradiction rules
- explicit distinction between `changed`, `superseded`, `contradicted`, and `insufficient_evidence`

### Alignment Diagnostics

Shipped:

- TS-aware diagnostics for producer/consumer and identity/key drift
- structural diagnostics for helper reuse and auth/role drift
- first relation-alias drift coverage

This is intentionally still a first slice. The 4.4b SQL side is heuristic/string-backed today rather than a full parser-heavy engine.

### Trust Surfaces

Shipped:

- additive machine-readable fields on `AnswerResult`
- CLI rendering for trust-aware answer output
- web `AnswerPacketCard` trust/diagnostic presentation
- API/MCP inheritance of the shared answer shape where `AnswerResult` already flows

### Ranking And Policy

Shipped:

- narrow evidence-backed de-emphasis
- ranking reasons exposed with the answer
- eval coverage proving stale/insufficient cases de-emphasize cleanly

## Post-Closeout Additions

After Phase 4.6 closed, two surface-level extensions shipped on top of the
closed substrate. Both are additive and documented:

- **SARIF 2.1.0 output** (`packages/tools/src/sarif.ts`) — emits
  `AnswerSurfaceIssue` findings in the industry-standard format for
  GitHub Code Scanning, VS Code Problems, GitLab Code Quality, and other
  downstreams. Identity triple maps onto SARIF `partialFingerprints` for
  cross-run dedup, and both SARIF entrypoints now dedupe repeated
  `matchBasedId` values consistently. Documented in `devdocs/sarif-output.md`.
- **YAML rule-pack loader** (`packages/tools/src/rule-packs/`) — teams
  can extend the structural diagnostic layer via
  `<projectRoot>/.mako/rules/**/*.yaml` without touching TypeScript.
  Rule-pack findings flow through the same trust / ranking / eval
  pipeline as built-ins with no format divergence. The shipped integration now
  caches compiled rule packs by project root and caches app-surface heuristic
  detection by latest index run. Documented in `devdocs/rule-packs.md`.

Neither changes the trust contract or storage substrate; both are
strictly surface-layer extensions.

## Post-Closeout Sidecars

One explicit sidecar now exists alongside the closed Roadmap 4 trust build.

It is **not** part of the original canonical trust sequence and does not
change the statement that Roadmap 4 is complete. They exist because there are
one narrow follow-on seam worth planning before or alongside later roadmap
work:

- **Phase 4.7 Workflow Context Bridge** — a compatibility/prep slice that
  makes the trust-aware answer surface easier to consume from Roadmap 5 typed
  workflow packets. It is now fully landed: shared `WorkflowContextItem`
  contracts, schemas, one shared `AnswerResult -> WorkflowContextBundle`
  extraction seam, cross-tool route/symbol normalization, and a minimal
  `WorkflowPacketRequest` / `WorkflowPacketInput` entry contract. See
  `phases/phase-4.7-workflow-context-bridge.md`.

The sidecar does not reopen trust storage, trust-state semantics, rerun/compare,
or evaluation policy. It exists to prevent later work from layering on top of
ad hoc seams.

## Candidate External Tools Still Worth Remembering

Roadmap 4 either directly used, or borrowed patterns from:

- `Promptfoo`
- `Vitest` snapshots
- `jsondiffpatch`
- `ast-grep`
- `ts-morph`
- `pgsql-parser`
- `ts-json-schema-generator`
- `Semgrep` — pattern DSL, identity-triple dedup (`matchBasedId` /
  `codeHash` / `patternHash`), SARIF output, severity taxonomy
- `SARIF 2.1.0` (OASIS) — external output format

Hosted systems like `Langfuse`, `Phoenix`, or `DeepEval` remain optional references, not required substrate.

## What Comes Next

Roadmap 5 should start from the trust-aware answer surface shipped here.

Roadmap 5 is the higher-order `Context And Workflow Assistance` roadmap, not another trust-backbone rewrite.

Its starting assumption should be:

- answer history exists
- trust state exists
- rerun/compare exists
- diagnostics exist
- trust is already consumable across CLI/API/MCP/web

If `4.7` is implemented first, Roadmap 5 should also assume:

- a typed workflow-context item contract exists beside the answer contract
- answer/trust/diagnostic/compare output can be extracted into packet-friendly
  context items without custom per-packet parsing
- primary/supporting context and open questions already come through one shared
  bridge bundle instead of bespoke packet-specific answer walking
- packet generation can start from one shared packet-input contract instead of
  inventing a per-packet entry shape

The next step should be typed workflow-context packets such as:

- implementation briefs
- impact packets
- precedent packs
- verification plans
- workflow recipes

Those packets should stay evidence-backed and should be requested explicitly or through watch-mode workflows, not through a required background worker or scheduler.

Hooks, cron jobs, and CI-scheduled runs are valid wrappers around stable packet generators later, but they should remain optional automation around the core product path rather than becoming a prerequisite for Roadmap 5 itself.

## Required Follow-Through

When Roadmap 5 opens, use these Roadmap 4 docs as the closure baseline:

- [./handoff.md](./handoff.md)
- [./phases/README.md](./phases/README.md)
- [../../master-plan.md](../../master-plan.md)
