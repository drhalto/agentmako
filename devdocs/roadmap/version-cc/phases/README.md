# Roadmap Version CC Phases

These are the phase specs for the CC-Native roadmap.

Read in this order:

**CC-side integration:**

1. [phase-1-tool-discoverability.md](./phase-1-tool-discoverability.md) —
   Client Adapters + Discoverability
2. [phase-2-parallel-execution-safety.md](./phase-2-parallel-execution-safety.md)
3. [phase-3-output-budget-alignment.md](./phase-3-output-budget-alignment.md)
4. [phase-4-typed-progress-notifications.md](./phase-4-typed-progress-notifications.md)
5. [phase-5-prepared-statement-cache.md](./phase-5-prepared-statement-cache.md)

**Agent-side ergonomics:**

6. [phase-6-session-recall.md](./phase-6-session-recall.md)
7. [phase-7-composed-context-bundles.md](./phase-7-composed-context-bundles.md)
8. [phase-8-agent-feedback-channel.md](./phase-8-agent-feedback-channel.md)

**Packaging:**

9. [phase-9-claude-code-plugin-package.md](./phase-9-claude-code-plugin-package.md) —
   Claude Code Plugin Package

Current state:

- `Phase 1` — **Complete.** `AgentClient` adapter pattern shipped
  (`ClaudeCodeClient`, `GenericAgentClient`, `selectAgentClient`),
  every MCP-visible mako tool carries a curated
  `_meta.anthropic/searchHint`, `tool_search` / `ask` / `repo_map`
  carry `_meta.anthropic/alwaysLoad`, and the MCP server emits
  `InitializeResult.instructions` for Claude Code's
  `# MCP Server Instructions` block. This is the enabler Phases 3
  and 4 route through.
- `Phase 2` — **Complete.** `ProjectStoreCache` concurrency
  invariant documented, store-layer `async`/`await` audit shows zero
  violations, `test/smoke/mcp-parallel-tool-execution.ts` covers
  5 parallel identical calls, a heterogeneous mix, and a 20-call
  stress pass through one shared handle.
- `Phase 3` — **Complete.** Byte-cost defaults raised for
  `ast_find_pattern.maxMatches` (`100 → 500`) and
  `lint_files.maxFindings` (`200 → 500`), cap cost classes
  documented, and `test/smoke/mcp-large-output-passthrough.ts`
  proves 300+ match/finding outputs pass through without mako-side
  truncation.
- `Phase 4` — **Complete.** `ProgressReporter` shipped,
  `AgentClient.progressShape` routes MCP progress payload shaping,
  MCP `tools/call` handlers bind reporters from `_meta.progressToken`,
  and `review_bundle_artifact`, `verification_bundle_artifact`,
  `tenant_leak_audit`, and `investigate` emit named stage progress.
  `test/smoke/progress-reporter-basic.ts` covers no-op/capture/failure
  behavior; `test/smoke/mcp-progress-notifications.ts` proves
  `notifications/progress` frames arrive before the final tool response
  and no-token calls stay silent.
- `Phase 5` — **Complete.** `ProjectStore` now owns a per-instance
  prepared statement cache keyed by static SQL text, exposed internally
  as `ProjectStoreContext.prepared`. The five hot query methods
  (`listFiles`, `getFileContent`, `findFile`, `listRoutes`,
  `listSymbolsForFile`) reuse `StatementSync` objects, `close()` clears
  the cache before closing the SQLite handle, and
  `test/smoke/prepared-statement-cache.ts` verifies reuse and cleanup.
- `Phase 6` — **Complete.** Session recall tools shipped:
  `recall_answers` searches persisted `answer_traces` through
  `answer_traces_fts` plus LIKE fallback and filters by text,
  `queryKind`, `supportLevel`, `trustState`, and ISO window;
  answer rows are SQL-limited while `matchCount` remains pre-limit.
  `recall_tool_runs` lists persisted `tool_runs` by tool, outcome,
  requestId, and ISO window with payload opt-in. Both are read-only,
  category `session_recall`, and covered by focused smokes plus MCP
  metadata verification.
- `Phase 7` — **Complete.** Composed context bundle tools shipped:
  `table_neighborhood`, `route_context`, and `rpc_neighborhood`.
  They compose schema snapshot, indexed `schema_usage`, route/import
  indexes, and derived RPC-to-table refs into bounded typed sections
  with evidence refs and truncation flags. `table_neighborhood` is
  Claude Code always-load; `route_context` and `rpc_neighborhood`
  remain deferred behind search hints. Smokes cover all three tools
  plus MCP metadata verification.
- `Phase 8` — **Complete.** Agent feedback channel shipped:
  `agent_feedback` writes append-only `RuntimeUsefulnessEvent` rows
  with `decisionKind: "agent_feedback"` tied to a required
  `referencedRequestId`; `agent_feedback_report` groups feedback by
  referenced tool with bounded entries and truncation warnings. The
  runtime telemetry report naturally includes the new decision kind,
  Claude Code hints are present, and `test/smoke/agent-feedback.ts`
  covers capture, duplicates, filters, and report visibility.
- `Phase 9` — **Complete.** Packages Mako for Claude Code at
  `mako-ai-claude-plugin/` as one plugin (`mako-ai`) containing
  8 category-scoped guidance skills —
  `mako-guide` (entry + feedback / finding-ack policy) plus one skill
  per tool cluster: `mako-discovery`, `mako-trace`, `mako-neighborhoods`,
  `mako-graph`, `mako-database`, `mako-code-intel`, `mako-workflow`.
  Skills auto-invoke on turn-0 user intent via their `description`
  fields and pre-approve Mako MCP calls via
  `allowed-tools: mcp__mako-ai__*`. A standalone/global skill is only
  an authoring shortcut, not a second install path. The SDK in-process
  mode remains parked as a future optimization.

Phases 1–9 are complete. Reopen SDK in-process work only with concrete
performance evidence.
