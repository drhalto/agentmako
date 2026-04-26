# Roadmap Version CC Handoff

This file is the execution handoff for the CC-Native roadmap.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [./roadmap.md](./roadmap.md)
- [../version-initial-testing/handoff.md](../version-initial-testing/handoff.md)

## Roadmap Intent

This roadmap exists because Initial Testing Phase 2 solved the biggest
latency cliff (per-call project-store open-close) and that changed the
question. With the structural waste gone, mako's remaining gaps split
into two frames:

1. **CC-side integration** (Phases 1–5) — fit mako into CC's existing
   affordances: `_meta` metadata, deferred tool loading, parallel
   execution, large-output handling, progress notifications, prepared
   statement reuse.
2. **Agent-side ergonomics** (Phases 6–8) — close pain points the agent
   feels directly, regardless of the MCP client: session-memory recall,
   composed neighborhood queries, an agent-to-mako feedback channel.
3. **Claude Code packaging** (Phase 9) — make the shipped tool surface
   easy to install and use consistently through one plugin containing
   category-scoped guidance skills (one per Mako tool cluster, plus a
   top-level `mako-guide` entry skill) that explain when to call each
   capability and when to log feedback.

Claude is the de-facto client; Codex and other agent harnesses slot
in later via the `AgentClient` adapter shipped in Phase 1. No
client-specific branching lives outside `packages/tools/src/agent-clients/`.

## Mandatory Entry Assumptions

Treat these as already shipped:

- every tool surface from Roadmaps 1–7
- R8 Phase 8.0 typed runtime telemetry contract
- R8 Phase 8.1 runtime capture + inspection pipeline
- Initial Testing Phase 1 (finding acknowledgements)
- Initial Testing Phase 2 (`ProjectStoreCache`,
  `ProjectStore.checkpoint`, MCP stdio flush-on-shutdown)
- `@modelcontextprotocol/sdk` version that supports `_meta` on tool
  registration (Phase 1 verifies)

Do not re-open those just because a phase would be easier if they were
different.

## Working Rules

1. **Every phase cites a concrete observation by file and line** (for
   CC-integration phases) or **by scenario** (for agent-ergonomics
   phases). The phase doc names the CC source
   (`CC/services/mcp/client.ts:NNNN`, etc.) or the agent-workflow
   scenario so reviewers can confirm the trigger before the change
   lands.

2. **No existing tool contract changes.** Input and output Zod schemas
   in `packages/contracts/src/tool-*-schemas.ts` for R1–R7 tools stay
   exactly as they are. Additions flow through MCP `_meta` or are
   shipped as *new* tools (Phases 6, 7, 8) with their own schemas.

3. **Client-specific code is walled off.** Every CC-specific /
   Codex-specific / other-client-specific concern lives in
   `packages/tools/src/agent-clients/`. No `if (client === 'claude-
   code')` branches in shared tool code. Adding a new client = drop
   a new adapter file; touch nothing else.

4. **Cross-client safety.** Every `_meta` key is namespaced
   (`anthropic/...`, `codex/...`, etc.) per MCP convention so non-
   target clients drop it gracefully. Progress notifications follow
   MCP spec, not client-specific extensions.

5. **Ship as slices.** A phase is a sequence of independently
   verifiable commits. Stopping between slices leaves the tree in a
   clean state — typecheck green, smokes green.

6. **Telemetry-aware.** Where a phase produces a natural decision
   signal (e.g. Phase 8's agent feedback, Phase 4's progress
   emission), emit `RuntimeUsefulnessEvent` through R8.1. Do not
   invent parallel telemetry plumbing.

7. **Phase 9 is packaging and guidance, not an SDK refactor.** Do not
   reopen in-process SDK work unless live-use measurements show the
   subprocess boundary is the dominant bottleneck.

## What To Avoid

- kitchen-sink phases that bundle unrelated CC mechanisms
- CC-specific branches in tool code (use MCP-spec mechanisms, emit
  them uniformly to every client)
- reopening R4 / R5 / R6 / R7 contracts for discoverability or
  formatting concerns — those are `_meta` / progress surface, not
  contract surface
- speculative features (e.g. per-project searchHint overrides) with no
  observed need

## Verification Posture

Each phase should leave behind:

- typed contract coverage (no `any` in the MakoToolDefinition surface
  or progress notification types)
- focused smokes per slice
- at least one realistic CC-side check (e.g. verify `tools/list`
  carries the `_meta` field; verify progress notifications reach the
  MCP transport)
- doc updates when posture changes

## Current Status

CC-side integration:

- **Phase 1** — Client Adapters + Discoverability — **Complete.**
  `AgentClient` adapter pattern ships `ClaudeCodeClient` +
  `GenericAgentClient` + `selectAgentClient`; every MCP-visible mako
  tool has a curated `_meta.anthropic/searchHint`; `tool_search`,
  `ask`, and `repo_map` carry `_meta.anthropic/alwaysLoad`; and the
  server emits shared `InitializeResult.instructions` through the
  adapter. Three smokes green (`agent-client-selection.ts`,
  `mcp-tool-metadata.ts`, `mcp-server-instructions.ts`).
- **Phase 2** — Parallel Execution Safety — **Complete.**
  `ProjectStoreCache` concurrency invariant documented in its JSDoc,
  store-layer audit for `async`/`await` boundaries shows zero
  violations, `test/smoke/mcp-parallel-tool-execution.ts` covers
  5 parallel identical `ast_find_pattern` calls, a heterogeneous
  5-tool mix, and a 20-call stress pass through one shared handle.
- **Phase 3** — Output Budget Alignment — **Complete.**
  Byte-cost defaults now align with CC large-output persistence:
  `ast_find_pattern.maxMatches` default `100 → 500` and
  `lint_files.maxFindings` default `200 → 500`; hard caps unchanged.
  Cap cost-class JSDoc documents byte / latency / shape rationale in
  the code-intel contracts, and
  `test/smoke/mcp-large-output-passthrough.ts` covers 300+ AST
  matches plus 300+ lint findings without mako-side truncation.
- **Phase 4** — Typed Progress Notifications — **Complete.**
  `ProgressReporter` and `createMcpProgressReporter` live under
  `packages/tools/src/progress/`; `AgentClient.progressShape` returns
  MCP-spec `{ progress, total?, message? }` payloads for Claude Code
  and generic clients; MCP `tools/call` binds a reporter only when
  `_meta.progressToken` is present. Instrumented tools:
  `review_bundle_artifact`, `verification_bundle_artifact`,
  `tenant_leak_audit`, and `investigate`. Smokes cover basic reporter
  swallowing behavior plus real stdio MCP `notifications/progress`
  ordering.
- **Phase 5** — Prepared Statement Cache — **Complete.**
  `ProjectStore` owns a per-instance `StatementSync` cache keyed by
  SQL text and clears it on `close()`. The cache is exposed to store
  mixins through `ProjectStoreContext.prepared`; migrated hot methods:
  `listFiles`, `getFileContent`, `findFile`, `listRoutes`, and
  `listSymbolsForFile`. `test/smoke/prepared-statement-cache.ts`
  verifies same-SQL reuse, distinct-SQL growth, migrated-method reuse,
  and close-time clearing. `mcp-perf-store-lifetime.ts` remains green
  against the Phase 2 store-cache ratio assertion.

Agent-side ergonomics:

- **Phase 6** — Session Recall — **Complete.**
  `recall_answers` and `recall_tool_runs` are registered read-only
  tools under the new `session_recall` category. `answer_traces_fts`
  migration `0028_project_answer_trace_recall_fts` backfills existing
  answer traces and keeps text recall in sync through INSERT / UPDATE /
  DELETE triggers while the store keeps a LIKE fallback for exact
  identifiers. Answer recall uses SQL-level result limits with
  pre-limit `matchCount`. Claude Code hints are present and not
  always-load.
  Smokes: `recall-answers.ts`, `recall-tool-runs.ts`,
  `mcp-tool-metadata.ts`.
- **Phase 7** — Composed Context Bundles — **Complete.**
  `table_neighborhood`, `route_context`, and `rpc_neighborhood` are
  registered read-only tools under the new `neighborhood` category.
  They compose deterministic persisted/indexed primitive surfaces:
  schema snapshot table/RLS/RPC data, indexed `schema_usage`, route
  and import indexes, and derived RPC-to-table refs. Outputs are
  bounded per section with `entries`, `totalCount`, `truncated`,
  `evidenceRefs`, `trust: null`, and warnings. `table_neighborhood`
  is Claude Code always-load; the other two carry deferred search
  hints.
  Smokes: `table-neighborhood.ts`, `route-context.ts`,
  `rpc-neighborhood.ts`, `mcp-tool-metadata.ts`.
- **Phase 8** — Agent Feedback Channel — **Complete.**
  `agent_feedback` is registered as an append-only feedback mutation
  tool under the new `feedback` category and writes
  `RuntimeUsefulnessEvent` rows with `decisionKind: "agent_feedback"`.
  Feedback requires both `referencedToolName` and
  `referencedRequestId`, preserving run-scoped signal quality.
  `agent_feedback_report` provides the read side with by-tool grade
  aggregates, bounded entries, filters, and truncation warnings. The
  widened runtime-telemetry decision kind is visible through
  `runtime_telemetry_report`; Claude Code hints and smoke coverage are
  in place.

Packaging:

- **Phase 9** — Claude Code Plugin Package — **Complete.** Packages Mako
  for Claude Code at `mako-ai-claude-plugin/` with one plugin
  (`mako-ai`) containing category-scoped guidance skills: `mako-guide`
  (entry + feedback / finding-ack policy), `mako-discovery`, `mako-trace`,
  `mako-neighborhoods`, `mako-graph`, `mako-database`, `mako-code-intel`,
  and `mako-workflow`. Each skill uses `description` strings written as
  user-intent triggers (CC auto-matches on turn 0) and
  `allowed-tools: mcp__mako-ai__*` to pre-approve Mako MCP calls. Keep
  typed MCP tools as the source of truth. Do not require a separate
  global skill in the final install path.

Parked future optimization:

- **SDK In-Process Mode** — re-evaluate only with concrete evidence
  that subprocess + pipe remains the dominant cost after live use.

Roadmap 8 Phase 8.2+ stays paused pending accumulated R8.1 telemetry.
Phase 8 (agent feedback) is the single biggest contributor this
roadmap makes to that future work. Initial Testing stays the reactive
surface for any fresh deployment pain that is not a CC-integration or
agent-ergonomics concern.
