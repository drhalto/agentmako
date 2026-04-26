# Reef Engine Phases

These are the phase specs for the Reef Engine roadmap.

Read in this order:

1. [reef-1-fact-model-and-active-findings-store.md](./reef-1-fact-model-and-active-findings-store.md)
2. [reef-2-external-lint-and-type-ingestion.md](./reef-2-external-lint-and-type-ingestion.md)
3. [reef-3-working-tree-and-staged-overlays.md](./reef-3-working-tree-and-staged-overlays.md)
4. [reef-4-incremental-watch-engine.md](./reef-4-incremental-watch-engine.md)
5. [reef-5-tool-view-migration.md](./reef-5-tool-view-migration.md)
6. [reef-6-performance-boundary-and-native-engine-decision.md](./reef-6-performance-boundary-and-native-engine-decision.md)
7. [reef-7-model-facing-tool-views.md](./reef-7-model-facing-tool-views.md)
8. [reef-8-open-loops-and-verification-state.md](./reef-8-open-loops-and-verification-state.md)
9. [reef-9-project-conventions-and-rule-memory.md](./reef-9-project-conventions-and-rule-memory.md)
10. [reef-10-evidence-confidence-and-contradictions.md](./reef-10-evidence-confidence-and-contradictions.md)

Current state:

- `Reef 1` - shipped. Durable fact model, typed subjects, rule
  descriptors, active findings store, read tools, migration/baseline
  smoke coverage, and `git_precommit_check` producer.
- `Reef 2` - shipped. `lint_files` now persists indexed diagnostics
  into Reef plus successful diagnostic run rows, and
  `typescript_diagnostics` persists TypeScript compiler diagnostics plus
  durable TypeScript diagnostic run status rows. `eslint_diagnostics`
  runs local ESLint or discovered JSON package scripts in explicit file
  mode and persists working-tree Reef findings/run rows.
  `oxlint_diagnostics` does the same for Oxlint's `--format json`
  output. `biome_diagnostics` uses Biome's GitLab reporter instead of
  its experimental JSON reporter. `project_diagnostic_runs` exposes
  derived cache state and age for diagnostic runs.
- `Reef 3` - shipped. `git_precommit_check` reports structured staged
  change status, resolves deleted/renamed staged findings, and keeps
  staged blob reads separate from working-tree content.
  `working_tree_overlay` snapshots live file facts without full reindex,
  `project_facts` / `file_facts` expose Reef facts, and
  `context_packet` consumes working-tree overlay facts with indexed
  fallback.
- `Reef 4` - shipped. The existing Phase 4 watcher now writes
  `working_tree_overlay` file snapshot facts for dirty paths before the
  path-scoped refresh, and watch state reports the last overlay fact
  update/count/resolved-finding-count/duration/error plus the last
  refresh decision (`paths` vs `full`) and fallback reason. Watcher
  deletes resolve active file-scoped indexed/working-tree Reef findings.
  Smokes cover restart hot-cache rebuild and the changed-file fact
  replacement duration budget on the watch fixture.
- `Reef 5` - shipped. `context_packet`, `ast_find_pattern`,
  `project_index_status`, and `git_precommit_check` now use Reef-backed
  views where safe, with additive output fields and `MAKO_REEF_BACKED`
  rollback.
- `Reef 6` - shipped. A 5k indexed-file performance smoke and checked-in
  report keep Reef TypeScript-only for now; no native package boundary is
  justified by the measured thresholds.
- `Reef 7` - shipped. `reef_scout` and `reef_inspect` expose model-facing
  scout/inspect views, and `context_packet` consumes Reef convention
  candidates with evidence-confidence metadata.
- `Reef 8` - shipped. `project_open_loops` and `verification_state`
  report stale facts, active findings, failed/stale diagnostics, and
  files changed after successful checks.
- `Reef 9` - shipped. `project_conventions` and `rule_memory` expose
  convention facts/candidates and rule usefulness counts; accepted
  convention facts feed `context_packet`.
- `Reef 10` - shipped. `evidence_confidence` and `evidence_conflicts`
  surface confidence labels, stale indexed evidence, explicit
  contradictions, and conflict follow-up actions.

The sequence stays conservative. Reef should become the substrate under
Mako tools one phase at a time, with stable public tool contracts and a
working fallback after every phase.
