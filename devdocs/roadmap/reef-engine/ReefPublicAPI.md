# Reef Public API

Status: `Reef 1 shipped - Reef 2 shipped - Reef 3 shipped - Reef 4 shipped - Reef 5 shipped - Reef 6 shipped - Reef 7 shipped - Reef 8 shipped - Reef 9 shipped - Reef 10 shipped - DB Reef refresh shipped - DB review comments shipped`

This document names the Reef public surface that Studio, MCP tools,
and future CLI views may consume. Reef tables are implementation detail;
callers should use contracts and tools.

## Contracts

Exported from `@mako-ai/contracts`:

- `ProjectOverlay`: `indexed | working_tree | staged | preview`
- `FactSubject`: typed file, symbol, route, schema object, import edge,
  and diagnostic subjects
- `ReefCalculationDependency`: file, glob, fact kind, and config
  dependencies
- `ProjectFact`: durable replace-not-append fact row
- `ProjectFinding`: durable finding row with derived ack status
- `ReefRuleDescriptor`: data-only rule metadata for UI/tool consumers
- `ReefDiagnosticRun`: durable source-run status row for diagnostic
  adapters, optionally enriched by read tools with derived cache state
- `ProjectIndexWatchState`: existing watcher state plus Reef 4 overlay
  fact update time/count/resolved-finding-count/duration/error fields
  and the last refresh decision (`paths` vs `full`), fallback reason, and
  path counters
- `ContextPacketToolOutput.activeFindings`: additive Reef 5 field with
  active Reef findings relevant to returned context/focus/changed files
- `ProjectIndexStatusToolOutput.reefFacts`: additive Reef 5 summary of
  working-tree `file_snapshot` fact freshness
- `ReefCandidate`, `ReefOpenLoop`, `ProjectConvention`,
  `RuleMemoryEntry`, `EvidenceConfidenceItem`, and `EvidenceConflict`:
  model-facing Reef view contracts for scout/inspect, open-loop,
  convention, rule-memory, confidence, and contradiction surfaces
- `DbReviewTarget` and `DbReviewComment`: append-only local review-note
  contracts for database objects and database topics such as replication
- `ContextPacketReadableCandidate.metadata.evidenceConfidenceLabel`:
  additive Reef 10 metadata for working-tree, indexed, and
  convention-backed candidates

`preview` is contract-reserved only. It must not be persisted until a
later phase defines an in-memory safety model.

## Store API

`ProjectStore` exposes the Reef foundation helpers:

- `computeReefSubjectFingerprint(subject)`
- `computeReefFactFingerprint(input)`
- `computeReefFindingFingerprint(input)`
- `upsertReefFacts(facts)`
- `replaceReefFactsForSource(input)`
- `queryReefFacts(options)`
- `replaceReefFindingsForSource(input)`
- `queryReefFindings(options)`
- `saveReefRuleDescriptors(descriptors)`
- `listReefRuleDescriptors()`
- `saveReefDiagnosticRun(input)`
- `queryReefDiagnosticRuns(options)`
- `computeDbReviewTargetFingerprint(target)`
- `insertDbReviewComment(input)`
- `queryDbReviewComments(options)`

Facts replace by `(projectId, overlay, source, kind,
subjectFingerprint)`. Findings replace by `(projectId, fingerprint)`;
source-scoped reruns may resolve previously active rows when the same
subject scope no longer produces the finding.

`replaceReefFactsForSource` is the preferred writer for recomputable
source snapshots. It deletes existing facts for the supplied
`projectId`, `overlay`, `source`, and optional `kinds` before inserting
the new fact set, so deleted source objects do not survive as stale Reef
facts.

## MCP Tools

Reef adds read-only tools:

- `project_findings`: query project findings by overlay, source, status,
  and resolved inclusion.
- `file_findings`: query findings for one project-relative file.
- `project_facts`: query durable Reef facts by overlay, source, kind,
  and subject fingerprint.
- `file_facts`: query durable Reef facts for one project-relative file.
- `list_reef_rules`: list public rule descriptors, optionally filtered
  by source namespace or enabled-by-default status.
- `project_diagnostic_runs`: query recent diagnostic source runs by
  source and status. The tool adds `cache.state`, `ageMs`,
  `staleAfterMs`, and a reason to each returned run. The default
  diagnostic cache policy is 30 minutes and can be overridden with
  `cacheStalenessMs`.
- `reef_scout`: task-shaped model-facing scout view that ranks Reef
  facts, findings, rules, diagnostic runs, and focus-file hints.
- `reef_inspect`: precise inspect view for one file or subject
  fingerprint, returning scoped facts/findings/diagnostic runs.
- `project_open_loops`: read view over active findings, stale/unknown
  facts, stale diagnostic runs, and failed diagnostic runs.
- `verification_state`: read view that reports diagnostic freshness and
  files changed after successful checks.
- `project_conventions`: convention facts and rule-derived convention
  candidates.
- `rule_memory`: rule descriptor plus finding-history counts by status.
- `evidence_confidence`: confidence labels for facts/findings.
- `evidence_conflicts`: explicit conflict facts, contradiction findings,
  and stale indexed evidence.
- `db_review_comments`: read local database review notes by object,
  category, tag, target fingerprint, or free-text query.

These tools are batchable through `tool_batch`.

Reef DB refresh adds `db_reef_refresh`, an advisory mutation tool. It
reads the existing schema snapshot/read model and replaces
`overlay: "indexed"`, `source: "db_reef_refresh"` facts for:

- `db_schema`
- `db_table`
- `db_view`
- `db_column`
- `db_index`
- `db_foreign_key`
- `db_rls_policy`
- `db_trigger`
- `db_enum`
- `db_rpc`
- `db_rpc_table_ref`
- `db_usage`

The tool does not parse SQL itself. It trusts the current Mako schema
snapshot, `schema_snapshot_*` read-model tables, `function_table_refs`,
and indexed `schema_usage` rows. If the schema snapshot is stale or
missing, callers should run `project_index_refresh` first.

Database review comments add `db_review_comment`, an advisory mutation
tool that writes append-only local review notes to Mako's project store.
It can target concrete database objects such as schemas, tables, columns,
indexes, RLS policies, triggers, publications, subscriptions, and
replication slots, or broader topics such as `replication`. It never
mutates the live database. Matching comments are available through
`db_review_comments` and are included as historical candidates in
`reef_scout` when the query matches their object, tag, or comment text.

Reef 3 adds `working_tree_overlay`, an advisory mutation tool. It
persists `overlay: "working_tree"`, `source: "working_tree_overlay"`,
`kind: "file_snapshot"` facts for explicit files, watcher-dirty paths,
or non-fresh indexed paths. It records present/deleted state plus file
size, mtime, line count, and sha256 for present files. It does not
reparse AST, imports, routes, schema, or semantic units.

In Reef 4, the existing index refresh coordinator invokes
`working_tree_overlay` for watcher dirty paths before the path-scoped
index refresh. Watch state exposes the last overlay fact update time,
fact count, resolved finding count, duration, and non-blocking overlay
error. It also exposes the last refresh decision (`paths` vs `full`),
fallback reason, refreshed path count, and deleted path count. Watcher
deletes resolve active file-scoped Reef findings for `indexed` and
`working_tree` overlays; staged findings remain owned by the staged/git
flow.

`git_precommit_check` is the first producer. It writes staged-overlay
findings with `source: "git_precommit_check"` and registers rule
descriptors for its auth/boundary checks. In Reef 3 it also returns
structured `stagedChanges` with added/copied/modified/renamed/deleted
status, resolves deleted staged-path findings, and treats renames as
old-path resolution plus new-path checking.

`lint_files` writes indexed findings with `source: "lint_files"` and
records successful diagnostic run rows for each invocation.

`typescript_diagnostics` is the first Reef 2 diagnostic producer. It
writes working-tree findings with `source: "typescript"` and records a
diagnostic run row for `unavailable`, `ran_with_error`, or `succeeded`
tool outcomes.

`eslint_diagnostics` writes working-tree findings with `source:
"eslint"` by running the project's local ESLint executable or discovered
JSON package script in explicit file mode. It records the same
diagnostic run status states as `typescript_diagnostics`.

`oxlint_diagnostics` writes working-tree findings with `source:
"oxlint"` by running the project's local Oxlint executable or discovered
JSON package script with `--format json` in explicit file mode.

`biome_diagnostics` writes working-tree findings with `source:
"biome"` by running the project's local Biome executable or discovered
GitLab-reporter package script in explicit file mode. It intentionally
uses `--reporter=gitlab` instead of Biome's experimental JSON reporter.

`context_packet` remains read-only. When existing `working_tree_overlay`
facts are present for returned file candidates, it labels those
candidates with `metadata.overlay: "working_tree"` and includes the
overlay fact fingerprint/state. When changed files are supplied without
overlay facts, it warns that indexed fallback is being used and
recommends the `working_tree_overlay` mutation tool. In Reef 5 it also
returns relevant active Reef findings in `activeFindings`.

`ast_find_pattern` remains read-only and indexed-snapshot scoped. In
Reef 5 it skips non-fresh indexed files using the same file freshness
model as `project_index_status`, preventing stale indexed rows from
returning phantom AST matches.

`project_index_status` remains read-only. In Reef 5 it adds `reefFacts`
for working-tree `file_snapshot` fact freshness alongside the existing
file-index freshness summary.

`MAKO_REEF_BACKED` is the one-release rollback switch for migrated
views. Unset means the shipped Reef-backed views are enabled.
`legacy`, `off`, `false`, `0`, or `none` disables them. `all` enables
all, and a comma-delimited list enables only named tools.

## Safety Rules

- All paths are project-root scoped and stored as project-relative paths.
- Reef does not edit project files.
- Reef does not create a second acknowledgement ledger.
- Acknowledged status is derived from `finding_acks`.
- Public descriptors are data-only; executable rule code is not exposed
  to Studio or MCP clients.
- Database review comments are local, append-only Mako memory. They do
  not update Supabase/Postgres schema objects, policies, publications, or
  replication settings.
