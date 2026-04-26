# Reef Engine Roadmap

This file is the canonical roadmap for the Reef Engine build cycle.

If another Reef Engine doc disagrees with this file about what the
roadmap is for, what phases it contains, or what counts as done, this
roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-initial-testing/roadmap.md](../version-initial-testing/roadmap.md)
- [../version-initial-testing/handoff.md](../version-initial-testing/handoff.md)
- [../version-initial-testing/phases/phase-4-index-freshness-and-auto-refresh.md](../version-initial-testing/phases/phase-4-index-freshness-and-auto-refresh.md)
- [../version-initial-testing/phases/phase-5-deterministic-context-packet-and-hot-retrieval.md](../version-initial-testing/phases/phase-5-deterministic-context-packet-and-hot-retrieval.md)
- [../version-initial-testing/phases/phase-6-parser-and-resolver-hardening.md](../version-initial-testing/phases/phase-6-parser-and-resolver-hardening.md)
- [../version-8/roadmap.md](../version-8/roadmap.md)
- [../version-cc/roadmap.md](../version-cc/roadmap.md)

## Repository Status

As of 2026-04-25, Reef Engine phases 1 through 10 are shipped on
`main`. A DB-native Reef follow-up is also shipped: `db_reef_refresh`
materializes database schema snapshot/read-model state into indexed Reef
facts for schema objects, columns, indexes, constraints, RLS, triggers,
RPC references, and indexed schema usages.

The Mako Studio desktop shell, Tauri app, MSI/MSIX packaging, and related
release scripts are not part of this shipped Reef merge. That work is
parked on the separate `reef/studio` branch and should be treated as an
optional Studio track until it is deliberately reintroduced.

## Roadmap Contract

Reef Engine is Mako's live project-state engine.

Its job is to unify the programmatic calculations Mako already performs:
search hits, AST matches, route traces, schema usage, freshness checks,
lint-like rule findings, precommit checks, context packets, finding
acks, and runtime telemetry. Instead of each tool doing isolated work,
tools should increasingly query a shared, source-grounded state model.

The desired product behavior is:

```text
user or agent asks a coding question
  -> Mako already knows the current project facts and active findings
  -> the selected MCP tool returns a focused view
  -> the coding agent uses normal read/search/edit/verify harness tools
```

Reef should make Mako better at:

- answering "what is true about this repo right now?"
- maintaining active lint/type/security/boundary findings without making
  the agent rerun broad commands for every question
- respecting indexed, live, staged, and working-tree views of the same
  project
- letting `context_packet`, `ast_find_pattern`, `route_context`,
  `schema_usage`, `git_precommit_check`, and future lint tools share one
  fact substrate
- making freshness and provenance visible per fact, not just per answer
- supporting future embeddings and learned ranking over a durable,
  deterministic backbone

It does **not**:

- replace Codex, Claude Code, or another coding harness
- autonomously edit or repair code
- require a background daemon for the basic path
- require a GPU
- rewrite Mako in another language up front
- replace TypeScript, ESLint, tsserver, or package-backed parsers where
  they are already the right tool
- ship remote telemetry or hosted analysis

## Engine Model

Reef is a set of durable facts plus incremental calculations:

```text
ProjectEvent
  -> FactSource
  -> ProjectFact
  -> DerivedFact
  -> ProjectFinding
  -> ToolView
```

### ProjectEvent

Examples:

- file added, changed, deleted, or renamed
- git staged snapshot changed
- index run completed
- ESLint or TypeScript diagnostic run completed
- `finding_ack` recorded
- agent feedback or tool usefulness event recorded

### FactSource

A fact source is a typed producer namespace. Source names should be
stable and specific enough to dedupe across tools:

- `reef_rule:auth.unprotected_route`
- `reef_rule:boundary.client_server`
- `git_precommit_check:boundary`
- `eslint:no-unused-vars`
- `typescript:TS2322`
- `schema_scan:table_usage`
- `agent_feedback:incorrect_evidence`

External adapters also write source-run status rows. Source status is:
`unavailable`, `ran_with_error`, or `succeeded`. Consumers must never
interpret "source unavailable" or "source errored" as "no findings."

### ProjectFact

A fact is a typed observation with:

- `projectId`
- `kind`
- `subject`
- `subjectFingerprint`
- `source`
- `scope`
- `overlay`
- `confidence`
- `provenance`
- `freshness`
- `fingerprint`
- `createdAt`
- `updatedAt`

Facts should be concrete and auditable. "File has a `use client`
directive" is a fact. "This component is probably broken" is not a
fact; it may become a finding if a rule can explain it.

`subject` is not a free-form string. Reef 1 should ship a discriminated
union like:

```ts
type FactSubject =
  | { kind: "file"; path: string }
  | { kind: "symbol"; path: string; symbolName: string; line?: number }
  | { kind: "route"; routeKey: string }
  | { kind: "schema_object"; schemaName: string; objectName: string }
  | { kind: "import_edge"; sourcePath: string; targetPath: string }
  | { kind: "diagnostic"; path: string; ruleId?: string; code?: string };
```

`subjectFingerprint` is derived from the typed subject with the same
canonical JSON hashing discipline used elsewhere in Mako. String content
used in fingerprints must be Unicode NFC-normalized before hashing so
cross-platform diagnostics and source snippets do not drift.

Fact lifecycle is replace-not-append. For a given
`{ projectId, overlay, source, kind, subjectFingerprint }`, a recompute
replaces the current fact row. Durable history lives in index/source-run
rows and telemetry events, not in unbounded fact row retention. Findings
may retain `factFingerprints[]` after underlying facts are replaced.

Calculation dependency declarations ship as a contract in Reef 1 even
though the runtime consumer does not arrive until Reef 4:

```ts
type ReefCalculationDependency =
  | { kind: "file"; path: string }
  | { kind: "glob"; pattern: string }
  | { kind: "fact_kind"; factKind: string }
  | { kind: "config"; path: string };
```

### ProjectFinding

A finding is an actionable issue/risk with:

- stable fingerprint
- source fact references
- severity
- freshness / captured-at timestamp so consumers can show age and stale
  status
- status: `active`, `resolved`, `acknowledged`, `suppressed`
- source: `reef_rule`, `eslint`, `typescript`, `git_precommit_check`,
  `schema_scan`, `agent_feedback`, or another typed source
- optional `ruleId`, `documentationUrl`, `suggestedFix`, and
  `evidenceRefs`
- optional ack link and reason

Findings are how Reef answers "what problems does Mako already know
about?"

The existing `finding_acks` table remains the source of truth for
acknowledgements. Reef does not introduce a second ack ledger. New acks
still write to `finding_acks`; `project_findings.status =
"acknowledged"` is a derived view over matching fingerprints and ack
state. Any future "unack," snooze, or revocation feature is modeled as a
new append-only ack event/category, not by deleting or mutating prior ack
rows.

Fingerprint rules must be source-specific and documented in Reef 1:

- AST/search-like findings keep the existing match fingerprint discipline
  derived from normalized file path, range, and match text.
- ESLint findings derive from `{ source, ruleId, filePath, line, column,
  messageFingerprint }`.
- TypeScript findings derive from `{ source, code, filePath, line,
  column, messageFingerprint }`.
- `git_precommit_check` findings derive from `{ source, checkId,
  filePath, subjectFingerprint, messageFingerprint }`.
- Reef rule findings derive from `{ source, ruleId, subjectFingerprint,
  evidenceFingerprints }`.

### Telemetry Boundary

Roadmap 8.1 remains the owner of append-only usefulness telemetry. Reef
does not copy every telemetry event into facts.

Reef may ingest agent feedback as a finding only when the feedback names
a concrete project subject and claim, for example:
`agent_feedback:incorrect_evidence` against a stale
`context_packet` candidate or `agent_feedback:false_positive` against a
rule finding. General "this was useful/useless" feedback remains
Roadmap 8 telemetry and can later influence learned ranking.

### Studio Surface Boundary

Mako Studio is a Reef consumer, not a Reef engine. Studio may display
facts, findings, freshness, rules, overlays, and ack state, but it does
not execute Reef rules or write a second finding lifecycle.

Studio writes acknowledgements through the existing `finding_acks`
ledger. Studio UI/performance/operator audit events belong to a
Studio-owned local event stream unless a later telemetry roadmap widens
Roadmap 8.1. Reef may ingest Studio-originated events only when they
name a concrete project subject and can become a normal
`ProjectFinding`.

Rule execution contracts and public rule descriptors are separate: Reef
rules are code modules; Studio consumes descriptor/query surfaces that
expose rule identity, descriptor version, source, severity, sanitized
inline docs, optional external documentation URL, fact inputs, and finding
counts.

### Overlay

Reef must distinguish at least four project views:

- `indexed` - last durable index snapshot
- `working_tree` - current files on disk
- `staged` - git index blobs for precommit checks
- `preview` - optional future agent-edit preview state

The same tool may choose different overlays. `git_precommit_check`
should default to `staged`. `context_packet` should usually use
`working_tree` with indexed fallback. `project_index_status` should
compare `indexed` to `working_tree`.

`preview` is contract-reserved only until Reef 5 or later. It must stay
in-memory unless a later phase defines persistence and project-root
safety rules for agent-edit previews.

Renames are modeled conservatively: delete old path facts, insert new
path facts, and emit warning facts for inbound import edges that cannot
be re-resolved safely. Rename detection can be heuristic; correctness
comes from delete+insert semantics, not trusting a rename score.

### Reef Rule Contract

Reef-native rules are typed code modules, not ad-hoc string checks.
Reef 1 should ship the rule contract even if it only has one or two
rules at first:

```ts
interface ReefRule {
  id: string;
  source: `reef_rule:${string}`;
  severity: "info" | "warning" | "error";
  dependsOnFactKinds: string[];
  detect(input: {
    facts: ProjectFact[];
    overlay: ProjectOverlay;
    projectId: string;
  }): ProjectFinding[];
}
```

JSON rule definitions may come later for simple pattern checks. The
initial contract should be code-first so typed facts can be consumed
without inventing a mini language too early.

## Hard Decisions

1. **Reef is not a planner.**
   It calculates project state and exposes views. The coding agent still
   plans, reads, edits, and verifies.

2. **Facts beat prose.**
   Reef outputs should be structured and source-labeled. Narrative is a
   presentation layer.

3. **Deterministic before learned.**
   ML can rank or cluster later. It cannot replace source-grounded facts.

4. **TypeScript is the control plane.**
   Keep the main engine in TypeScript while the rest of Mako is
   TypeScript. Add Rust/NAPI/WASM only after profiling proves a specific
   loop is too slow.

5. **No mandatory daemon in the first slice.**
   A long-running watcher may accelerate Reef, but every important state
   view must be rebuildable from the store and project files.

6. **One durable truth, many caches.**
   SQLite stores canonical facts and findings. Hot indexes, in-memory
   tries, and symbol maps are rebuildable hints.

7. **Invalidation is a contract.**
   Every calculation node declares what invalidates it. Unknown
   invalidation falls back to a conservative broader refresh.

8. **Freshness is per fact.**
   Answer-level freshness is useful, but Reef must know which underlying
   facts are stale, live, deleted, unindexed, or unknown.

9. **Tool contracts migrate gradually.**
   Existing tools keep their public schemas unless a separate roadmap
   explicitly changes them. Reef enters as a backend first.

10. **Project-root safety is non-negotiable.**
    Watchers, staged readers, git blobs, glob matchers, and parser inputs
    never read outside the project root.

11. **Phase 4 watcher is absorbed, not duplicated.**
    Reef 4 extends the existing Initial Testing Phase 4
    `index-refresh-coordinator` watcher with Reef event hooks. It must
    not run a second independent chokidar watcher over the same project
    root.

12. **Migration is feature-flagged per tool.**
    Reef-backed tool views ship with a one-release rollback switch, such
    as `MAKO_REEF_BACKED=context_packet,ast_find_pattern` or an
    equivalent per-tool flag. Legacy paths are deleted only after the
    Reef path has production signal.

## Phase Sequence

1. `Reef 1` - Fact Model And Active Findings Store
2. `Reef 2` - External Lint And Type Ingestion
3. `Reef 3` - Working Tree And Staged Overlays
4. `Reef 4` - Incremental Watch Engine
5. `Reef 5` - Tool View Migration
6. `Reef 6` - Performance Boundary And Native Engine Decision
7. `Reef 7` - Model-Facing Tool Views
8. `Reef 8` - Open Loops And Verification State
9. `Reef 9` - Project Conventions And Rule Memory
10. `Reef 10` - Evidence Confidence And Contradictions

## Phase Summary

### Reef 1 Fact Model And Active Findings Store

Status: `Shipped`

Introduce the durable contracts and store tables for facts, derived
facts, and findings. Normalize existing Mako-originated findings from
`git_precommit_check`, boundary/auth checks, parser scans, and future
rule packs into one active findings surface.

Ships:

- `ProjectFact`, `ProjectFinding`, `FactProvenance`, `FactFreshness`,
  `FactSubject`, `ReefRule`, `ReefCalculationDependency`, and
  `ProjectOverlay` contracts
- store migrations and query helpers
- active finding read tools such as `project_findings` and
  `file_findings`
- fingerprinting rules compatible with `finding_ack`
- replace-not-append fact lifecycle
- smoke coverage for active -> resolved -> acknowledged lifecycle

Shipped implementation notes:

- contracts, migrations, store helpers, read tools, batch allowlisting,
  shared fixture helpers, and `git_precommit_check` staged finding
  persistence are implemented
- `test/smoke/reef-migration-baseline.ts` records the current 500-finding
  fixture baseline: project p95 6.65 ms, one-file p95 0.31 ms, and
  1,572,864 bytes after checkpoint

### Reef 2 External Lint And Type Ingestion

Status: `Shipped`

Make Reef ingest existing project diagnostics instead of competing with
them. ESLint, TypeScript, Biome, oxlint, and framework checks should
become normalized findings when configured, not replacement engines Mako
reimplements.

Current implementation notes:

- `lint_files` now writes its existing indexed diagnostics into Reef
  using `source: "lint_files"` and `AnswerSurfaceIssue.identity.matchBasedId`
  as the finding fingerprint
- `lint_files` writes successful indexed diagnostic run rows with
  checked-file and finding-count metadata
- `typescript_diagnostics` now explicitly runs the TypeScript compiler
  API and writes working-tree `source: "typescript"` findings
- `typescript_diagnostics` writes durable diagnostic run rows with
  `unavailable`, `ran_with_error`, and `succeeded` status
- `project_diagnostic_runs` exposes durable diagnostic run rows so
  agents can distinguish "no findings" from "source did not run"
- `eslint_diagnostics` now runs local ESLint or discovered JSON package
  scripts in explicit file mode, normalizes JSON diagnostics into
  working-tree Reef findings, and writes durable diagnostic run rows
- `oxlint_diagnostics` now runs local Oxlint or discovered JSON package
  scripts in explicit file mode with `--format json`, normalizes JSON
  diagnostics into working-tree Reef findings, and writes durable
  diagnostic run rows
- `biome_diagnostics` now runs local Biome or discovered GitLab-reporter
  package scripts in explicit file mode, normalizes GitLab reporter
  diagnostics into working-tree Reef findings, and writes durable
  diagnostic run rows
- `project_diagnostic_runs` enriches each returned run with derived
  cache state, age, staleness threshold, and reason so agents can tell
  when cached diagnostics are stale without rerunning the source
- future external command adapters should reuse the shared runner helpers
  and `saveReefDiagnosticRun`

Ships:

- adapters for ESLint JSON and TypeScript diagnostics
- optional adapters for Biome/oxlint when project config or package
  scripts exist
- source-labeled findings with command, config, cwd, duration, and exit
  metadata
- cost controls so broad lint/type runs are explicit
- focused file-mode checks for changed/staged files
- source-run status rows: `unavailable`, `ran_with_error`, `succeeded`

Default cost policy:

- file-mode checks may run on explicit tool calls
- broad-mode checks run only on explicit operator request, precommit
  hook, or configured command invocation
- external diagnostic cache entries carry `cacheStalenessMs`; stale
  diagnostics are degraded in confidence rather than silently treated as
  fresh

`tsc --noEmit` ingestion ships first. `tsserver` integration is parked
until profiling shows TypeScript diagnostics are the bottleneck.

### Reef 3 Working Tree And Staged Overlays

Status: `Shipped`

Let Mako answer against the right version of the project. The same file
can have an indexed version, a live working-tree version, and a staged
git-blob version. Reef should make that distinction explicit.

Ships:

- overlay contracts and store shape
- git staged blob reader scoped to project root
- staged-mode boundary/auth/precommit checks
- working-tree overlay for changed files without requiring full reindex
- tool input policy for `overlay?: "indexed" | "working_tree" | "staged"`
  where appropriate
- conservative rename handling: delete old facts, insert new facts,
  warn on unresolved inbound edges

Current implementation notes:

- `git_precommit_check` reports structured `stagedChanges` with
  added/copied/modified/renamed/deleted status
- deleted staged paths resolve prior staged Reef findings without
  reading deleted content
- renamed staged paths resolve the old path and check the new path when
  it is project-root scoped
- smoke coverage proves staged blob content can differ from the working
  tree and still drive the precommit finding, and covers staged
  delete/rename finding resolution
- `working_tree_overlay` snapshots live `working_tree` `file_snapshot`
  facts for changed files without running a full index refresh
- `project_facts` and `file_facts` expose durable Reef fact rows through
  read-only MCP tools and are batchable through `tool_batch`
- `context_packet` consumes existing working-tree overlay facts, labels
  candidates with working-tree vs indexed overlay metadata, and
  recommends `working_tree_overlay` when changed files lack overlay facts
- smoke coverage proves changed-file fact replacement, deletion facts,
  fact read tools, batch access, and context packet overlay wiring

### Reef 4 Incremental Watch Engine

Status: `Shipped`

Turn file changes into fact invalidation and targeted recomputation. This
is the "live engine" slice, but it should still be conservative:
changed-file facts first, graph-wide repair only when safe, full refresh
fallback when dependency correctness is uncertain.

Ships:

- Reef event hook on the existing Phase 4 project-local watcher
- runtime consumer for calculation-node dependency declarations
- changed-file fact replacement with orphan cleanup
- single-follow-up queueing under bursty edits
- status tool exposing dirty paths, pending calculations, and last run
- restart recovery that rebuilds hot caches from durable facts

Current implementation notes:

- `services/api/src/index-refresh-coordinator.ts` now absorbs the first
  Reef event hook by writing `working_tree_overlay` `file_snapshot` facts
  for dirty paths before the existing path-scoped index refresh runs
- `ProjectIndexWatchState` exposes last overlay fact update time, fact
  count, resolved finding count, duration, and non-blocking overlay error
- `ProjectIndexWatchState` exposes the last refresh decision (`paths` vs
  `full`), fallback reason, refreshed path count, and deleted path count
- watcher deletes resolve active file-scoped Reef findings for
  `indexed` and `working_tree` overlays while leaving staged findings to
  the staged/git flow
- overlay fact update failures are logged and reported in watch state,
  but do not block the conservative index refresh fallback
- watcher smoke coverage now asserts edits produce one replacement
  `working_tree` file snapshot fact and deletes produce a `deleted`
  snapshot fact plus resolved file findings for the changed file
- context-packet smoke coverage proves a fresh hot-index cache rebuilds
  from durable indexed facts after the original process-local cache is
  absent
- watcher smoke coverage asserts changed-file overlay fact replacement
  reports a duration under the current 500 ms Reef budget on the smoke
  fixture; the 5k-file p95 threshold remains a Reef 6 profiling gate

### Reef 5 Tool View Migration

Status: `Shipped`

Move high-value tools to query Reef state where it is correct to do so.
The goal is not a giant rewrite. Each migrated tool should become thinner
and more consistent without changing its public contract.

Candidate migrations:

- `context_packet` uses Reef candidates, findings, risks, and overlays
- `ast_find_pattern` reads fresh per-file facts/chunks and refuses stale
  phantom rows
- `schema_usage` uses structured SQL/TS facts before word matching
- `route_context` and route traces read derived route facts
- `git_precommit_check` writes and reads staged findings
- `project_index_status` reports fact freshness alongside file freshness
- future `lint_files` and `project_findings` become first-class tool
  views
- findings-management CLI/API surfaces such as list, ack, resolve,
  dismiss, and export are added here unless Reef 1 implementation proves
  they are needed earlier

`context_packet` gets an explicit boundary decision before migration:
Reef facts/findings are the canonical substrate, and
`ContextPacketCandidate` remains a consumer view. The adapter from Reef
subjects/findings to packet candidates must preserve existing packet
fingerprints and source labels.

Current implementation notes:

- `context_packet` returns additive `activeFindings` from active Reef
  findings relevant to primary/related/focus/changed files while
  preserving existing candidate fingerprints and source labels
- `context_packet` continues to enrich candidates with
  `working_tree_overlay` metadata and freshness
- `ast_find_pattern` now skips non-fresh indexed files through a Reef
  freshness guard so stale indexed rows cannot surface phantom matches
- `project_index_status` reports additive `reefFacts` for
  `working_tree_overlay` `file_snapshot` facts alongside file-index
  freshness
- `git_precommit_check` keeps persisting staged Reef findings and rule
  descriptors, with delete/rename resolution through the Reef finding
  lifecycle
- migrated views have one-release rollback through `MAKO_REEF_BACKED`
  (`legacy` disables, comma-delimited values allow only selected tools)
- findings-management API/MCP path is shipped through `project_findings`,
  `file_findings`, `finding_ack`, and `finding_acks_report`; a dedicated
  CLI facade is UI ergonomics, not a Reef storage blocker

### Reef 6 Performance Boundary And Native Engine Decision

Status: `Shipped`

Profile the engine after it has real work. Only then decide whether a
native component is justified.

Acceptable outcomes:

- stay TypeScript-only because bottlenecks are SQLite queries, parser
  calls, or bad invalidation
- add Rust/NAPI/WASM for specific hot loops such as tokenization, graph
  traversal, diffing, or fact fingerprinting
- keep Python limited to offline ML/embedding experiments
- use GPU only for optional embeddings/reranking, never as a requirement
  for deterministic correctness

This phase must include a written keep-or-native decision with measured
evidence.

Escalation thresholds:

- any single Reef query over the 5k-file fixture consumes more than
  100 ms p95 after query/index tuning
- active findings for one file exceed 30 ms p95 cached or 200 ms p95
  cold
- `context_packet` through Reef-backed candidates exceeds 1500 ms p95
  cold
- edit -> changed-file fact replacement exceeds 500 ms p95 on the
  5k-file fixture

If none of those thresholds are crossed, stay TypeScript-only.

Shipped decision:

- see [./ReefPerformanceReport.md](./ReefPerformanceReport.md)
- `test/smoke/reef-performance-boundary.ts` seeds a 5k indexed-file /
  5k finding fixture and measures the Reef thresholds
- current smoke results: project active findings p95 `58.82 ms`,
  one-file active findings p95 `0.54 ms`, cold Reef-backed
  `context_packet` p95 `240.38 ms`, changed-file overlay replacement
  p95 `11.09 ms`
- no threshold crossed; Reef stays TypeScript-only
- no native prototype shipped, so package/install impact remains zero
- next consuming track is Mako Studio over Reef's public contracts and
  tool views

### Reef 7 Model-Facing Tool Views

Status: `Shipped`

Make Reef easy for coding agents to query. Reef should expose scout and
inspect views over its facts instead of forcing models to browse raw
fact rows.

Ships:

- a task-shaped scout view through `context_packet` or a dedicated Reef
  scout tool
- a precise inspect view for files, symbols, routes, schema objects, and
  finding fingerprints
- ranked candidates with `source`, `overlay`, `freshness`,
  `confidence`, `whyIncluded`, and stable subject fingerprints
- suggested next harness actions without performing edits
- smoke coverage proving working-tree fact changes affect the scout view

Current implementation notes:

- `reef_scout` ranks durable Reef facts, findings, rules, diagnostic
  runs, and focus-file hints into model-facing candidates with source,
  overlay, freshness, confidence, reason, and next harness actions
- `reef_inspect` returns scoped facts, findings, diagnostic runs, and
  counts for a file or subject fingerprint
- `context_packet` consumes convention facts as `reef_convention`
  candidates and labels candidate metadata with deterministic
  `evidenceConfidenceLabel`
- all new views are read-only, Claude-search hinted, and batchable

### Reef 8 Open Loops And Verification State

Status: `Shipped`

Teach Reef about unfinished work. Reef should remember stale evidence,
changed-after-check files, unresolved investigations, evidence conflicts,
and verification gaps as source-grounded work state.

Ships:

- open-loop contracts and read views such as `project_open_loops`,
  `file_open_loops`, `verification_state`, or `verification_gaps`
- derived loops from tool runs, diagnostic runs, watcher state,
  freshness, and agent feedback
- changed-after-check reporting for relevant diagnostics
- integration into `context_packet` so high-priority open loops appear
  beside candidate files
- smokes for edit -> stale verification state -> rerun diagnostic ->
  resolved verification gap

Current implementation notes:

- `project_open_loops` derives active-finding, stale-fact,
  unknown-fact, stale-diagnostic, and failed-diagnostic loops
- `verification_state` reports diagnostic source freshness and files
  modified after the latest successful diagnostic run
- `context_packet` recommends `project_open_loops` and
  `verification_state` as follow-up expansion tools

### Reef 9 Project Conventions And Rule Memory

Status: `Shipped`

Discover and persist project-specific conventions before using ML. Reef
should learn local auth guards, public routes, tenant helpers,
server/client boundaries, generated paths, and false-positive patterns as
reviewable convention facts.

Ships:

- convention fact kinds with candidate/accepted/rejected state
- deterministic discovery for auth guards, public routes, generated
  paths, and server/client boundary conventions
- rule usefulness stats: emitted, acknowledged, resolved,
  contradicted, and verification-linked counts
- `project_conventions`, `convention_candidates`, and `rule_memory`
  views
- accepted convention consumption by at least one existing tool view

Current implementation notes:

- `project_conventions` returns explicit `convention:*` facts and
  rule-derived convention candidates
- `rule_memory` aggregates descriptors and finding history into total,
  active, acknowledged, resolved, and suppressed counts
- accepted convention facts now feed `context_packet` through the
  `reef_convention` provider

### Reef 10 Evidence Confidence And Contradictions

Status: `Shipped`

Make evidence quality explicit. Reef should distinguish live verified
evidence, fresh indexed facts, stale indexed facts, fuzzy semantic hits,
historical feedback, unknown evidence, and contradicted evidence.

Ships:

- heuristic confidence labels across major tool views
- contradiction ledger for source disagreements such as index-vs-live
  AST/search conflicts
- confidence decay when files, dependencies, or diagnostic runs become
  stale
- `evidence_conflicts` / `evidence_confidence` views or equivalent
  additive tool output
- smoke coverage reproducing stale indexed evidence, recording the
  conflict, surfacing it, and clearing it after refresh

Current implementation notes:

- `evidence_confidence` labels facts/findings as `verified_live`,
  `fresh_indexed`, `stale_indexed`, `fuzzy_semantic`, `historical`,
  `contradicted`, or `unknown`
- `evidence_conflicts` surfaces explicit conflict facts, contradictory
  findings, and stale indexed facts as conflict records
- `context_packet` emits `evidenceConfidenceLabel` metadata for
  working-tree, indexed, and convention-backed candidates

## Budget Targets

These targets exist before Reef 6 so implementation reviews have a
shared definition of "slow":

- active findings query for one file: p95 < 30 ms cached, p95 < 200 ms
  cold
- active findings query for a project: p95 < 500 ms cold on a 5k-file
  fixture
- Reef-backed `context_packet`: p95 < 1 s warm, p95 < 1500 ms cold on a
  5k-file fixture
- database size after one full 5k-file index and finding ingest:
  documented and reviewed, with a target ceiling set in Reef 1 after the
  fixture is chosen

## Verification Rule

Every Reef phase should leave behind:

- typed contract coverage
- store migration coverage
- at least one smoke using a real fixture project
- freshness/invalidation assertions
- project-root safety checks
- docs updated in this roadmap package

Reef is not working until it can survive:

- edit file -> finding changes without full reindex
- stage file -> staged finding differs from working-tree finding
- ack finding -> future matching finding is suppressed or labeled
- restart process -> hot caches rebuild from durable facts
- stale indexed chunk -> tool view refuses or refreshes it

## Parked Until Evidence

- learned provider weights
- embedding-first retrieval
- GPU-required local analysis
- daemon-only architecture
- full Rust rewrite
- cross-repo Reef state
- autonomous fix generation
- remote telemetry aggregation
- LLM analyst sidecar that proposes conventions, rules, summaries, or
  task tags

These are not bad ideas. They need evidence from the deterministic Reef
substrate before they earn roadmap space.
