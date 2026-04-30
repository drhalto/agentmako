# Changelog

All notable changes to agentmako are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/) once
it reaches 1.0.

## [Unreleased]

## [0.3.1] - 2026-04-30

### Fixed

- `agentmako connect` now writes a project-local `.mako-ai/.gitignore` so
  local indexes, snapshots, and scratch DB files are ignored without changing
  the repository root `.gitignore`. If you previously committed `.mako-ai/`,
  run `git rm -r --cached .mako-ai/` once to untrack it; new installs are
  protected automatically.

## [0.3.0] - 2026-04-30

### Added

- `_hints` on tool results, with public schema support and contextual
  next-step guidance shared across MCP, API, and CLI tool calls.
- Complete MCP tool annotations from a centralized operational metadata matrix,
  including read-only, idempotent, open-world, destructive, and write-preview
  metadata.
- `context_packet` modes for `explore`, `plan`, `implement`, and `review`,
  with mode-specific provider policy, `modePolicy` output, expandable
  follow-ups, and confidence-filtered risk output.
- U-shaped `layoutZone` ordering for answer and workflow packet sections so
  the most actionable context is placed at the start and end of long packets.
- Generated plugin packs for Claude Code, Codex, Cursor, and Gemini, all synced
  from shared Mako skills and wired to the same `agentmako mcp` server.
- Background Reef daemon integration for MCP sessions, including lazy startup
  from `agentmako mcp`, watcher-backed incremental refresh, scoped diagnostic
  freshness, and daemon lifecycle coverage.
- `file_preflight(filePath)`, a one-call pre-edit gate with durable findings,
  file-scoped diagnostic freshness, recent runs, applicable conventions, and
  acknowledgement history.
- `reef_diff_impact(filePaths)`, a read-only mid-edit impact packet with
  changed-file overlay state, downstream import callers, active caller findings,
  and convention risks.
- `mako_help(task)`, a workflow orientation tool that returns ordered Mako tool
  sequences with suggested arguments for common audit, edit, review,
  diagnostic, and database tasks.
- Rule-pack authoring improvements, including hot-reloaded YAML rule packs,
  cross-file `canonicalHelper` checks, rule validation, and
  `extract_rule_template` for mining rule drafts from fix diffs.
- Preview-by-default flows for higher-impact local write tools such as finding
  acknowledgements and database review comments.
- Expanded Reef docs and agent instructions covering live watcher behavior,
  file preflight, diff impact, rule-pack authoring, and finding source filters.

### Changed

- `searchFiles()` now relies on FTS for content search and keeps only the cheap
  path-name fallback, removing the redundant chunk-content `LIKE` scan.
- `ask` preserves the full user question when dispatching to search-backed
  tools instead of reducing precise requests to short terms.
- `auth_path` returns structured fallback envelopes with suggested
  `cross_search` args when no exact match exists, keeping batches from
  dead-ending on no-match errors.
- `context_packet` risk handling now merges relevant active Reef findings into
  packet-level risks and supports `risksMinConfidence` for noise control.
- `reef_scout` ranks with lightweight request intent, keeping app-flow evidence
  ahead of schema facts for app questions and schema facts ahead for database
  questions.
- `project_conventions` now derives conventions from project profile,
  auth-like symbols, routes, generated-file markers, schema usage, explicit
  facts, and rules.
- `reef_where_used` now combines maintained import/symbol evidence with indexed
  identifier-text references and related durable findings, while labeling the
  coverage limits explicitly.
- `verification_state` and `file_preflight` now surface file-scoped diagnostic
  run coverage and watcher diagnostic state so agents can tell whether the
  daemon has not caught up or diagnostics are genuinely stale.
- `cross_search`, `lint_files`, and `project_index_status` default to more
  compact outputs, with verbose/full modes still available for debugging.

### Fixed

- TSX/JSX ambiguous `ast_find_pattern` snippets starting with `{`, `[`, or `<`
  retry with an auto-anchored parser context and report which form matched.
- Cross-search alignment diagnostics persist into Reef with stable finding
  identities so `file_findings`, `project_findings`, and acknowledgements see
  the same issues across reruns.
- `project_findings` source filters accept bare rule IDs and
  `rule_pack:<ruleId>` aliases.
- `file_findings` and `project_findings` can see persisted query-time
  alignment diagnostics instead of missing issues that only appeared in
  `cross_search`.
- Alignment-style finding identities strip runtime-only timestamp/run fields so
  acknowledgements remain stable across reruns.
- `agentmako version`, `agentmako --version`, and `agentmako -v` now print the
  CLI version without starting the API service.

## [0.2.2] - 2026-04-29

### Fixed

- MCP stdio tool calls now tolerate stringified non-string arguments
  before Zod validation, fixing boolean, number, and array inputs for
  tools such as `project_index_status`, `ast_find_pattern`, and
  `tool_batch`.
- `agentmako dashboard` now works from installed packages by serving
  bundled dashboard assets instead of requiring an `apps/web` source
  checkout next to the CLI binary.

### Changed

- CLI builds now package the web dashboard into `dist/web` and verify
  those assets before publishing.

## [0.2.0] - 2026-04-28

### Added

- Reef Engine v2 runtime with revisioned change sets, daemon lifecycle,
  root writer locking, catch-up cookies, recrawl reporting, calculation
  nodes, structural artifact backdating, and persisted operation logs.
- Durable Reef model-facing tools for agent loops, including
  `reef_agent_status`, `reef_known_issues`, `reef_where_used`,
  `reef_inspect`, `project_open_loops`, `verification_state`,
  `rule_memory`, `evidence_confidence`, and `evidence_conflicts`.
- Warm diagnostic ingestion and freshness tracking for TypeScript,
  ESLint, Oxlint, Biome, lint-file checks, schema-derived findings, and
  programmatic findings.
- Maintained structural/search knowledge for routes, imports, schema
  usage, RPC/table relationships, graph flows, change planning, and
  working-tree overlays.

### Changed

- `schema_usage` now fails closed to exact schema-object matches and
  documents that it reports direct app-code references only; use
  `trace_rpc`, `route_context`, `table_neighborhood`, or `flow_map` for
  RPC-mediated/transitive schema paths.
- `change_plan` now shares the same graph path behavior as `flow_map`
  for file-import-to-RPC-to-table paths and includes regression coverage.
- MCP/tool metadata and Claude guidance now describe the expanded
  Reef-backed workflow and direct-vs-transitive evidence semantics.

### Fixed

- Runtime telemetry smoke tests no longer register temporary projects in
  the real global project registry.
- Database refresh summaries now count indexes, foreign keys, triggers,
  RLS policies, enums, RPCs, and function table references consistently
  with the persisted facts.
- Stale diagnostic open loops are superseded by newer successful runs
  for the same source.

## [0.1.0] - 2026-04-25

Initial public release of `agentmako` under Apache-2.0.

### Added

- `agentmako` CLI with `connect`, `status`, `tool`, `dashboard`,
  `refresh`, `verify`, and `git precommit` commands.
- Stdio MCP server (`agentmako mcp`) exposing the Mako tool surface to
  Claude Code, Cursor, Codex, and other MCP clients.
- Reef Engine: durable local fact, finding, and rule layer backed by
  SQLite, with model-facing views and freshness tracking.
- Code intelligence tools: `context_packet`, `reef_scout`,
  `cross_search`, `live_text_search`, `ast_find_pattern`, `repo_map`,
  symbol/import/route/graph helpers, and composer traces.
- Diagnostic adapters for TypeScript, ESLint, Oxlint, Biome, and staged
  git pre-commit checks.
- Optional Postgres/Supabase awareness: schema snapshots, RLS/RPC
  inspection, and `db_review_comment` for local review notes.
- Local web dashboard (`agentmako dashboard`) and HTTP API/harness
  services.
- `mako-ai-claude-plugin` with Mako-specific Claude Code skills and
  bundled MCP wiring.

[Unreleased]: https://github.com/drhalto/agentmako/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/drhalto/agentmako/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/drhalto/agentmako/compare/v0.2.3...v0.3.0
[0.2.2]: https://github.com/drhalto/agentmako/compare/v0.2.1...v0.2.2
[0.2.0]: https://github.com/drhalto/agentmako/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/drhalto/agentmako/releases/tag/v0.1.0
