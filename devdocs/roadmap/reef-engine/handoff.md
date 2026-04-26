# Reef Engine Handoff

This file is the execution handoff for the Reef Engine roadmap.

Source inputs:

- [./roadmap.md](./roadmap.md)
- [./README.md](./README.md)
- [./ReefPublicAPI.md](./ReefPublicAPI.md)
- [./ReefPerformanceReport.md](./ReefPerformanceReport.md)
- [./FindingAckContract.md](./FindingAckContract.md)
- [./RuleDescriptorSpec.md](./RuleDescriptorSpec.md)
- [../version-initial-testing/roadmap.md](../version-initial-testing/roadmap.md)
- [../version-8/roadmap.md](../version-8/roadmap.md)
- [../version-cc/roadmap.md](../version-cc/roadmap.md)

## Current Repository Status

Reef Engine phases 1 through 10 are shipped on `main` (2026-04-25).
This handoff now describes the shipped Reef substrate and model-facing
tooling views.

DB-native Reef fact refresh is shipped as a post-Reef-10 follow-up.
`db_reef_refresh` reads the existing schema snapshot/read model and
replaces indexed Reef facts for schemas, tables, columns, indexes,
foreign keys, RLS policies, triggers, enums, RPCs, RPC-to-table refs,
and indexed schema usages. It is intentionally source-backed by the
schema snapshot/indexer, not a second SQL parser.

Database review comments are shipped as a post-Reef-10 follow-up.
`db_review_comment` writes append-only local notes on database objects
and topics such as Supabase replication, while `db_review_comments` reads
them by object, category, tag, target fingerprint, or text. Comments live
in the Mako project store only; they do not mutate Supabase/Postgres.
`reef_scout` surfaces matching comments as historical candidates.

The separate Mako Studio desktop shell and installer work remains parked
on `reef/studio`. Reef must stay usable through the CLI, MCP stdio, and
existing web dashboard without requiring Studio.

Reef 7 through Reef 10 are additive tool/view improvements over the
shipped Reef substrate, not a rewrite or new engine.

## Roadmap Intent

Reef Engine should make Mako feel like it has a live model of the repo.
Not because an AI is constantly thinking in the background, but because
the deterministic calculations Mako already performs are persisted,
invalidated, recomputed, and exposed through consistent tool views.

The core promise:

```text
Mako already calculated that.
Mako knows whether it is still fresh.
Mako can show why it believes it.
```

## Mandatory Entry Assumptions

Treat these as already shipped:

- file freshness and MCP refresh from Initial Testing Phase 4
- deterministic `context_packet`, `tool_batch`, hot hints, risks, and
  scoped instructions from Initial Testing Phase 5
- parser/resolver hardening from Initial Testing Phase 6
- runtime telemetry capture from Roadmap 8.1
- CC-native client ergonomics from Roadmap CC
- finding acknowledgements and ack filtering
- git precommit check foundation

Do not rebuild those surfaces. Reef should absorb and unify them.

## Working Rules

1. **Start with facts and findings.**
   The first slice should make active findings durable and queryable.
   Do not start with a watcher, daemon, GPU, or native rewrite.

2. **Keep tool contracts stable.**
   Existing MCP tools can move behind Reef internally. Public schema
   changes need their own explicit contract work.

3. **Prefer adapters over replacement.**
   ESLint, TypeScript, Biome, oxlint, ast-grep, pgsql-parser, and
   tsserver already know their domains. Reef should ingest and normalize
   their outputs before reimplementing them.

4. **Every fact has provenance.**
   A tool result should be able to say whether it came from indexed
   source, live disk, staged git blob, ESLint, TypeScript, AST parser,
   SQL parser, ack ledger, or telemetry.

5. **Every derived result has invalidation rules.**
   If a calculation cannot name what invalidates it, it is not ready for
   incremental mode.

6. **Prefer model-facing views over raw fact browsing.**
   Agents should usually start with a scout or inspect view. Raw fact
   tools remain escape hatches for precise debugging.

7. **Open loops are work state, not task management.**
   Reef can track stale evidence, changed-after-check files, and
   verification gaps. It should not become an autonomous planner.

8. **Conventions are candidate-first.**
   Discovered project conventions must be reviewable and reversible.
   Do not silently turn a guessed convention into an enforcement rule.

9. **Confidence is heuristic.**
   Confidence labels help agents decide when to verify. They are not
   calibrated probabilities and must not hide provenance/freshness.

6. **Use broad refresh as the safety valve.**
   The engine may be incremental, but correctness wins. Unknown graph
   repair, changed exports, deleted files, alias changes, schema source
   changes, and config changes can fall back to full refresh.

7. **Watch mode is an accelerator.**
   The project must still work when the watcher is disabled, over the
   large-repo cap, or restarted.

8. **Measure before changing languages.**
   Rust/Go/WASM are valid if profiling identifies a specific hot path.
   They are not valid as aesthetic rewrites.

9. **No hidden autonomy.**
   Reef may calculate findings and recommendations. It does not edit
   files, run repair plans, or silently mutate project code.

10. **Local-first stays intact.**
    Facts, findings, telemetry, and embeddings remain local unless a
    separate explicit export feature is built.

11. **Telemetry has a boundary.**
    Roadmap 8.1 owns general usefulness events. Reef may ingest agent
    feedback only when it names a concrete file/symbol/route/schema
    subject and a checkable claim.

12. **Studio is a consumer.**
    Mako Studio surfaces Reef state through public contracts and writes
    acknowledgements through `finding_acks`. It does not run Reef rules,
    mutate `project_findings` directly, or store Studio UI telemetry in
    Reef tables.

## Initial Architecture Bias

Use the existing Mako layering:

- contracts in `packages/contracts`
- durable project data in `packages/store`
- engine/query helpers in `packages/tools` or a focused internal package
- indexer adapters in `services/indexer`
- MCP/CLI exposure through the existing tool registry and CLI commands

Avoid a new service boundary until the in-process implementation proves
that the boundary is needed.

## Language Guidance

Default to TypeScript.

Use Rust/NAPI/WASM only when all of these are true:

- a profiling fixture identifies the hot path
- the TypeScript implementation is correct and has tests
- the native boundary has a small input/output contract
- the native component is optional or has a clear build story
- the performance win is large enough to justify package complexity

Use Python only for experiments around embeddings, clustering, or model
evaluation. Do not put the core live project engine behind Python.

GPU work is parked until the deterministic store can provide clean
training/retrieval inputs. A GPU can accelerate embeddings or reranking;
it should not be required for lint, type, AST, route, or schema facts.

## Suggested First PR

The first PR should be Reef 1 only:

- add `ReefPublicAPI.md`, `FindingAckContract.md`, and
  `RuleDescriptorSpec.md` to the Reef docs package before consumer code
  depends on them
- define contracts for typed fact subjects, source namespaces, facts,
  freshness, overlays, findings, rules, and calculation dependencies
- add store tables and accessors
- implement replace-not-append fact lifecycle
- normalize `git_precommit_check` findings into the new store
- add `project_findings` and `file_findings`
- wire `finding_ack` compatibility through fingerprints
- keep `finding_acks` as the only ack write target; Reef finding status
  is derived from it
- add a smoke covering active, resolved, and acknowledged findings

Do not add a watcher in the first PR.

## What To Avoid

- no daemon-first architecture
- no full native rewrite
- no ML-first retrieval
- no GPU requirement
- no hidden background edits
- no second planner beside the coding agent
- no global filesystem watcher outside project roots
- no broad lint/type command running implicitly on every tool call
- no isolated tool-specific findings stores
- no second ack ledger beside `finding_acks`
- no persisted `preview` overlay until a later phase defines its safety
  model

## Verification Posture

Each phase should include:

- schema/contract tests
- migration tests or smoke coverage
- at least one real fixture project scenario
- project-root safety coverage
- stale/changed/deleted file coverage where relevant
- docs and handoff status update
- fingerprint stability coverage with Unicode NFC-normalized strings

For watch or incremental work, include:

- burst edits queue exactly one follow-up
- deleted file removes owned facts/findings
- changed export either repairs dependents or falls back to full refresh
- restart rebuilds hot state from durable facts

## Performance Budgets

Use these as review guardrails from Reef 1 onward:

- one-file active findings query: p95 < 30 ms cached, p95 < 200 ms cold
- project active findings query: p95 < 500 ms cold on a 5k-file fixture
- Reef-backed `context_packet`: p95 < 1 s warm, p95 < 1500 ms cold on a
  5k-file fixture
- edit -> changed-file fact replacement: p95 < 500 ms on a 5k-file
  fixture

If these are missed, profile and fix the TypeScript/store path first.
Native code is a Reef 6 decision, not a Reef 1 escape hatch.

## Current Status

- Reef Engine roadmap opened.
- Reef 1 is shipped.
- Shipped in Reef 1:
  - exported Reef contracts for facts, typed subjects, findings,
    overlays, rule descriptors, dependencies, and freshness
  - project-store migrations and helpers for Reef facts/findings/rules
  - replace-not-append fact lifecycle
  - derived `acknowledged` status from the existing `finding_acks`
    ledger
  - `project_findings`, `file_findings`, and `list_reef_rules` read
    tools, including `tool_batch` allowlisting
  - `git_precommit_check` writes staged-overlay Reef findings and rule
    descriptors
  - shared `seedReefProject` smoke fixture used by Reef and Studio smoke
    coverage
- Reef 1 baseline fixture:
  - 500 active findings across 50 files
  - project active findings p95: 6.65 ms
  - one-file active findings p95: 0.31 ms
  - project DB size after checkpoint: 1,572,864 bytes
- Reef 2 is shipped:
  - `lint_files` now persists its existing diagnostics into Reef as
    `source: "lint_files"` / `overlay: "indexed"` findings
  - persisted lint fingerprints reuse
    `AnswerSurfaceIssue.identity.matchBasedId`, preserving
    `finding_ack` compatibility
  - `lint_files` records successful indexed diagnostic run rows with
    checked-file and finding-count metadata
  - `lint_files` is now annotated as an advisory mutation and is removed
    from the read-only `tool_batch` allowlist
  - `typescript_diagnostics` explicitly runs the TypeScript compiler API
    with no emit and persists `source: "typescript"` /
    `overlay: "working_tree"` findings
  - `typescript_diagnostics` writes durable Reef diagnostic run rows for
    `unavailable`, `ran_with_error`, and `succeeded`
  - `project_diagnostic_runs` exposes diagnostic run rows by source and
    status, enriches each row with derived cache state/age, and is
    batchable
  - `eslint_diagnostics` runs local ESLint or discovered JSON package
    scripts in explicit file mode, normalizes diagnostics into
    `source: "eslint"` / `overlay: "working_tree"` findings, and writes
    durable run rows
  - `oxlint_diagnostics` runs local Oxlint or discovered JSON package
    scripts in explicit file mode with `--format json`, normalizes
    diagnostics into `source: "oxlint"` / `overlay: "working_tree"`
    findings, and writes durable run rows
  - `biome_diagnostics` runs local Biome or discovered GitLab-reporter
    package scripts in explicit file mode, normalizes diagnostics into
    `source: "biome"` / `overlay: "working_tree"` findings, and writes
    durable run rows
  - future external command adapters should reuse the shared external
    runner helpers plus `saveReefDiagnosticRun`
- Reef 3 is shipped:
  - `git_precommit_check` returns structured staged change records for
    added/copied/modified/renamed/deleted paths
  - deleted staged paths resolve prior staged Reef findings for that
    file without reading deleted content
  - renamed staged paths are treated as old-path resolution plus
    new-path checking when scoped inside the project root
  - smoke coverage proves staged blob content can differ from the
    working tree and still drive findings, and covers staged
    delete/rename finding resolution
  - `working_tree_overlay` persists live working-tree `file_snapshot`
    facts for changed files without a full reindex
  - `project_facts` and `file_facts` expose durable Reef facts through
    read-only, batchable MCP tools
  - `context_packet` consumes existing working-tree overlay facts,
    labels candidates with working-tree/indexed overlay metadata, and
    recommends `working_tree_overlay` when changed files lack overlay
    facts
- Reef 4 is shipped:
  - the existing `index-refresh-coordinator` watcher writes
    `working_tree_overlay` file snapshot facts for dirty paths before
    running the path-scoped index refresh
  - `ProjectIndexWatchState` now reports the last overlay fact update
    time, fact count, resolved finding count, duration, and non-blocking
    overlay error
  - `ProjectIndexWatchState` also reports the last refresh decision:
    `paths` vs `full`, fallback reason, refreshed path count, and deleted
    path count
  - watcher deletes resolve active file-scoped Reef findings for
    `indexed` and `working_tree` overlays while leaving staged findings
    to the staged/git flow
  - watcher smoke coverage asserts edits produce one replacement
    `working_tree` file snapshot fact and deletes produce a `deleted`
    snapshot fact plus resolved file findings for the changed file
  - context-packet smoke coverage proves a fresh hot-index cache rebuilds
    from durable indexed facts after the original process-local cache is
    absent
  - watcher smoke coverage asserts changed-file overlay fact replacement
    reports a duration under the current 500 ms Reef budget on the smoke
    fixture
- Reef 5 is shipped:
  - `context_packet` returns additive active Reef findings relevant to
    returned/focus/changed files
  - `ast_find_pattern` skips non-fresh indexed files through the Reef
    freshness guard to avoid stale phantom matches
  - `project_index_status` reports additive `reefFacts` for
    working-tree `file_snapshot` freshness
  - `git_precommit_check` remains a staged Reef finding producer
  - migrated views can be rolled back for one release with
    `MAKO_REEF_BACKED=legacy` or narrowed with a comma-delimited allowlist
  - findings-management API/MCP path is `project_findings`,
    `file_findings`, `finding_ack`, and `finding_acks_report`
- Reef 6 is shipped:
  - `test/smoke/reef-performance-boundary.ts` seeds a 5k indexed-file /
    5k finding fixture and measures Reef's escalation thresholds
  - current measured p95s: project findings `58.82 ms`, one-file
    findings `0.54 ms`, cold Reef-backed `context_packet` `240.38 ms`,
    changed-file overlay replacement `11.09 ms`
  - no threshold crossed, so Reef stays TypeScript-only and no native
    package/install impact ships
- Reef 7 is shipped:
  - `reef_scout` ranks facts, findings, rules, diagnostic runs, and
    focus-file hints into model-facing candidates
  - `reef_inspect` returns scoped facts, findings, and diagnostic runs
    for a file or subject fingerprint
  - `context_packet` consumes `reef_convention` candidates and labels
    candidate metadata with `evidenceConfidenceLabel`
- Reef 8 is shipped:
  - `project_open_loops` reports active findings, stale/unknown facts,
    stale diagnostics, and failed diagnostics
  - `verification_state` reports diagnostic source freshness and files
    changed after successful checks
- Reef 9 is shipped:
  - `project_conventions` exposes convention facts and rule-derived
    convention candidates
  - `rule_memory` aggregates rule descriptor/finding history counts
  - accepted convention facts feed the existing `context_packet` view
- Reef 10 is shipped:
  - `evidence_confidence` labels facts/findings by trust posture
  - `evidence_conflicts` surfaces explicit conflict facts,
    contradiction findings, and stale indexed evidence
  - `test/smoke/reef-model-facing-views.ts` covers Reef 7 through Reef
    10 plus `tool_batch` and `context_packet` integration
