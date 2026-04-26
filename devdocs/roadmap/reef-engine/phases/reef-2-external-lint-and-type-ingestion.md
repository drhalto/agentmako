# Reef 2 External Lint And Type Ingestion

Status: `Shipped`

## Goal

Fold existing project diagnostics into Reef instead of rebuilding every
lint/type rule inside Mako. ESLint, TypeScript, Biome, oxlint, and
framework checks should become source-labeled findings when configured.

## Scope

- ESLint JSON adapter
- TypeScript diagnostic adapter
- optional Biome/oxlint adapters when project config or scripts exist
- focused file-mode diagnostic runs for changed/staged files
- command metadata: cwd, command, config, duration, exit code
- normalized finding fingerprints and source labels
- source-run status rows: `unavailable`, `ran_with_error`, `succeeded`
- cache staleness metadata per diagnostic source

## Rules

- Do not run broad lint/type commands implicitly on every query.
- File-mode checks may run on explicit tool calls.
- Broad-mode checks run only on explicit operator request, configured
  precommit hook, or configured command invocation.
- Prefer configured project scripts when they exist.
- If a tool is missing, report unavailable rather than installing it.
- Preserve raw diagnostic codes and rule IDs.
- Keep external diagnostic findings separate from Reef-native rule
  findings while sharing the same finding lifecycle.
- Stale cached diagnostics are labeled as possibly stale instead of
  silently treated as fresh.

## Parked

- `tsserver`/LSP integration. Reef 2 uses `tsc --noEmit` or configured
  project scripts first. A long-lived TypeScript server is only opened
  later if profiling shows TypeScript diagnostic ingestion is the
  bottleneck.

## Done When

- lint/type adapters produce `ProjectFinding` rows
- missing-tool, failed-command, and successful-no-finding cases are
  represented distinctly
- staged/changed file mode is available without full-project lint by
  default
- broad lint/type runs require explicit operator intent
- cached diagnostics expose age and staleness policy
- smoke covers ESLint and TypeScript fixture diagnostics
- docs explain cost and command behavior

## Implementation Notes - 2026-04-25

Completed first bridge:

- `lint_files` persists its existing `AnswerSurfaceIssue` diagnostics
  into Reef as `source: "lint_files"` / `overlay: "indexed"` findings.
- Reef lint finding fingerprints are the existing
  `AnswerSurfaceIssue.identity.matchBasedId`, so `finding_ack`
  compatibility is preserved.
- `lint_files` persists the unfiltered diagnostic set before applying
  per-call ack filtering or response truncation.
- `lint_files` registers data-only rule descriptors for produced
  diagnostic codes.
- `lint_files` writes successful indexed diagnostic run rows with
  checked-file, finding, persisted-finding, requested-file, and
  unresolved-file metadata.
- Because `lint_files` now writes Reef findings and diagnostic run rows,
  its tool annotation is `mutation: true` / `advisoryOnly: true`; it is
  removed from the read-only `tool_batch` allowlist.
- `test/smoke/lint-files.ts` covers Reef persistence, descriptor
  registration, and diagnostic run status rows.
- `typescript_diagnostics` is an explicit mutation/advisory tool that
  reads `tsconfig.json`, runs the TypeScript compiler API with no emit,
  persists `source: "typescript"` / `overlay: "working_tree"` findings,
  and returns bounded `ProjectFinding` rows.
- TypeScript diagnostic fingerprints use source, rule ID, typed
  diagnostic subject, message, and file/line evidence refs.
- `test/smoke/typescript-diagnostics.ts` covers TS2322 persistence,
  rule descriptor registration, active -> resolved behavior after the
  file is fixed, and `unavailable` status when no `tsconfig.json`
  exists.
- Reef migration `0031_project_reef_diagnostic_runs` adds durable
  source-run rows for diagnostic producers.
- `project_diagnostic_runs` exposes those rows as a read-only Reef tool
  filterable by source and status, and is allowed in `tool_batch`.
- `typescript_diagnostics` writes `source: "typescript"` run rows with
  `status`, `cwd`, `configPath`, duration, checked-file count, finding
  count, persisted-finding count, requested-file metadata, and
  TypeScript version.
- `eslint_diagnostics` is an explicit mutation/advisory file-mode tool
  that runs the project's local ESLint executable from `node_modules`
  or a package JSON script (`eslint:json`, `lint:json`, `mako:eslint`,
  or caller-provided `scriptName`) with JSON output, persists
  `source: "eslint"` / `overlay: "working_tree"` findings, and records
  `unavailable`/`ran_with_error`/`succeeded` run rows.
- ESLint findings preserve native rule IDs, core-rule documentation URLs
  when applicable, file/line evidence refs, and source-labeled
  descriptors.
- `test/smoke/eslint-diagnostics.ts` covers successful lint findings,
  package-script fallback, Reef persistence, run rows, and unavailable
  local-ESLint status.
- Shared external diagnostic runner helpers now handle project-root path
  resolution, local `node_modules/.bin` discovery, direct JS entrypoint
  execution, and package-script fallback.
- `oxlint_diagnostics` is an explicit mutation/advisory file-mode tool
  that runs local Oxlint or a package JSON script (`oxlint:json`,
  `lint:oxlint`, `mako:oxlint`, or caller-provided `scriptName`) with
  `--format json`, persists `source: "oxlint"` /
  `overlay: "working_tree"` findings, and records
  `unavailable`/`ran_with_error`/`succeeded` run rows.
- Oxlint findings preserve native JSON fields: `code`, `severity`,
  `url`, `filename`, and primary label span line/column.
- `test/smoke/oxlint-diagnostics.ts` covers successful Oxlint findings,
  package-script fallback, Reef persistence, run rows, and unavailable
  local-Oxlint status.
- `biome_diagnostics` is an explicit mutation/advisory file-mode tool
  that runs local Biome or a package script (`biome:gitlab`,
  `lint:biome`, `mako:biome`, or caller-provided `scriptName`) with
  `check --reporter=gitlab`, persists `source: "biome"` /
  `overlay: "working_tree"` findings, and records
  `unavailable`/`ran_with_error`/`succeeded` run rows.
- Biome deliberately uses the documented GitLab reporter because
  Biome's JSON reporter is documented as experimental and patch-unstable.
- Biome findings preserve GitLab reporter fields:
  `description`, `check_name`, `severity`, `location.path`, and
  `location.lines.begin`.
- `test/smoke/biome-diagnostics.ts` covers successful Biome findings,
  package-script fallback, Reef persistence, run rows, reporter-choice
  warning, and unavailable local-Biome status.
- `project_diagnostic_runs` enriches each returned run with derived
  cache metadata: `cache.state`, `ageMs`, `staleAfterMs`, and a reason.
  The default policy is 30 minutes, with per-call override through
  `cacheStalenessMs`.
- `test/smoke/reef-tools.ts` covers fresh and stale diagnostic run cache
  state.

Reef 2 is considered shipped. Future external command adapters should
reuse `saveReefDiagnosticRun`, `project_diagnostic_runs`, and the shared
external diagnostic runner helpers added in this phase.
