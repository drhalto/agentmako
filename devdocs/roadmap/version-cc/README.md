# Roadmap Version CC (Claude Code Native)

**Status:** COMPLETE

**Upstream Baseline:** Roadmaps 1–7 complete, Roadmap 8 Phases 8.0 + 8.1
shipped, Initial Testing Phases 1–2 shipped (finding acknowledgements +
MCP perf / project-store lifetime).

**Primary Goal:** make mako feel like an extension of the agent's own
cognition inside Claude Code — not a generic MCP server that happens
to be attached. Every CC-side mechanism is leveraged where it buys
latency, discoverability, or ergonomics; every agent-side pain point
(context loss between sessions, atomic-vs-composed queries, no way to
signal "that tool call was useless") gets a first-class surface.

Claude is the de-facto client. Codex and other agent harnesses slot
in later via a **client adapter** pattern shipped in Phase 1 — not by
forking code paths or rebuilding the plumbing.

## Purpose

Initial Testing Phase 2 closed the biggest single latency source
(per-tool-call open-close of the project SQLite). That phase confirmed
the mental model: CC keeps the mako stdio subprocess alive for the
whole session, memoizes the client, and treats every tool call as a
plain JSON-RPC message over an open pipe. CC is not the bottleneck —
mako is.

With the structural latency cliff removed, two categories of work
remain: **CC-side integration** (fitting mako into CC's existing
affordances) and **agent-side ergonomics** (closing pain points the
agent actually feels that have nothing to do with CC's protocol).

### CC-side integration gaps

Research of `CC/services/mcp/client.ts` + `constants/prompts.ts` +
`useManageMCPConnections.ts` + `elicitationHandler.ts` surfaced
specific mechanisms where mako underinvests today:

**Closed in this roadmap:**

- `_meta["anthropic/searchHint"]` — curated capability phrases feed
  CC's ToolSearch ranking at `+4`. Mako emits none today; search relies
  on description tokens (`+2`) and tool-name parts only. (Phase 1)
- `_meta["anthropic/alwaysLoad"]` — force a tool's full schema into
  the initial prompt instead of the default deferred-load-behind-
  ToolSearch posture. Mako emits none today. (Phase 1)
- `InitializeResult.instructions` — CC injects each connected server's
  instructions string into the system prompt under
  `# MCP Server Instructions` (`constants/prompts.ts:579-603`). Mako
  advertises `capabilities: { tools: {} }` only
  (`services/api/src/mcp.ts:73`), emitting no instructions — zero
  first-turn guidance about when to prefer mako over built-ins. (Phase 1)
- Parallel tool execution via `isConcurrencySafe` + `ProjectStoreCache`
  — CC fans out up to 10 concurrent tool calls per turn; mako's cached
  store handle is shared across all of them. Works today but has no
  smoke coverage. (Phase 2)
- Large-output handling (`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000`)
  — CC auto-persists large results to disk with a preview + schema
  description. Mako's aggressive per-tool truncation caps (`maxMatches`,
  `maxFindings`, `maxFiles`) truncate *before* CC's handler, so agents
  get less detail than CC would have happily persisted. (Phase 3)
- MCP `notifications/progress` — CC emits progress events for long
  tools. Multi-stage artifact and operator tools in mako take real time
  and emit nothing. (Phase 4)
- Prepared statement lifecycle — hot-path tools like `ast_find_pattern`
  re-prepare ~50 SQL statements per invocation on top of the already-
  open store. Prior art (t3code `NodeSqliteClient.ts`) caches
  `StatementSync` per handle. (Phase 5)

**CC-native mechanisms explicitly not wired here (status per each):**

- MCP resources (`resources/list` + `resources/read`,
  `CC/services/mcp/client.ts:~2000-2028`, surfaced through
  `ListMcpResourcesTool`). A browsable catalog of mako's persistent
  memory (answer traces, tool runs) is a plausible future phase.
  Current Phases 6–8 ship as tools because they need structured
  input / output — see the roadmap's **Surface Choice** section.
  Status: **parked, pending concrete browse-over-query demand.**
- MCP skills (`prompts/list`-sourced slash-commands,
  `CC/commands.ts:~525` / `CC/components/skills/SkillsMenu.tsx:24-45`).
  Server-provided slash commands remain parked as a capability surface.
  Phase 9 instead packages one Claude Code plugin containing
  category-scoped Mako guidance skills that teach use of the existing
  typed Mako tools and feedback surfaces. A standalone/global skill can
  be used for authoring only; it is not a second user-facing install
  path. Status: **server-side MCP skills parked; plugin-skill package
  shipped in Phase 9.**
- MCP elicitation (`CC/services/mcp/elicitationHandler.ts:~129-170`).
  CC supports form and URL elicitation modes and retries tool calls
  after URL completion. Real mechanism, real use cases (auth setup,
  project-root disambiguation, ambiguous-entity prompts), but nothing
  in Phases 1–8 needs it. Named here so future auth / setup /
  disambiguation work has a planned home. Status: **parked.**
- In-process MCP — CC supports running MCP servers in the same process
  via `createLinkedTransportPair`. Ceiling-raiser for mako if
  subprocess + pipe ever becomes load-bearing.
  Status: **parked as a future optimization; Phase 9 keeps SDK
  in-process mode parked.**

### Agent-side ergonomics gaps

Thinking from the agent's perspective rather than the protocol's, three
more categories surfaced:

- **Session memory invisible.** Mako persists `answer_traces`,
  `tool_runs`, `finding_acks` per project — but an agent in a fresh
  CC session can't ask "what did we figure out about X last time?"
  The memory exists; no tool surfaces it.
- **Atomic-vs-composed queries.** To answer "what touches
  `admin_audit_log`?" today takes four tool calls (`db_table_schema`,
  `schema_usage`, `trace_table`, `graph_neighbors`). One composed
  neighborhood tool would save turns.
- **No feedback channel from agent to mako.** `finding_ack` lets the
  agent mark false positives on AST / lint matches. There's no
  analogous "this tool call wasted the turn" signal. That's missing
  training data for future R8.2+ learned routing.

### Client modularity

Claude is the de-facto client, but mako should not bake that in.
Phase 1 ships an `AgentClient` adapter pattern — `ClaudeCodeClient`
+ `GenericClient` at first, with `CodexClient` and others slotting
in later by dropping a new file in. Every subsequent phase that has
client-specific behavior (output budgets, progress shape, `_meta`
emission) routes through the adapter rather than hardcoding `anthropic/`
keys or CC-specific budgets.

This roadmap closes each gap above in independently-verifiable phases.

## What this roadmap is not

- A place to reopen tool contracts from R1–R7. Tool shapes stay
  identical on the input and output sides. Additions are via MCP
  `_meta`, progress notifications, and internal lifecycle — not by
  changing what agents see in `tools/list` schemas.
- A Claude Code-only roadmap. Every change here is visible to other
  MCP clients (Codex, Cursor, arbitrary SDK consumers) — they just
  ignore fields they do not understand. Where a field is CC-specific
  (`anthropic/searchHint`), it is namespaced under `anthropic/` per
  MCP convention.
- A replacement for Roadmap 8. R8.2+ still opens after accumulated
  R8.1 telemetry has non-fixture signal. This roadmap is lateral to
  that — it makes the daily mako-in-CC experience feel right while R8
  waits.

## Pre-roadmap work already shipped

- **Initial Testing Phase 1** — Finding Acknowledgements. The ledger
  that lets operators mark false-positive AST / lint findings as
  verified-safe so they stop resurfacing. See
  `../version-initial-testing/phases/phase-1-finding-acknowledgements.md`.
- **Initial Testing Phase 2** — MCP Perf: Project Store Lifetime.
  Removed the forced `PRAGMA wal_checkpoint(TRUNCATE)` from every
  `ProjectStore.close()`; introduced `ProjectStoreCache` so the MCP
  stdio server borrows a persistent handle per project. See
  `../version-initial-testing/phases/phase-2-mcp-perf-store-lifetime.md`.

This roadmap builds on both.

## Phases

CC-side integration (Phases 1–5):

- [Phase 1 — Client Adapters + Discoverability](./phases/phase-1-tool-discoverability.md)
- [Phase 2 — Parallel Execution Safety](./phases/phase-2-parallel-execution-safety.md)
- [Phase 3 — Output Budget Alignment](./phases/phase-3-output-budget-alignment.md)
- [Phase 4 — Typed Progress Notifications](./phases/phase-4-typed-progress-notifications.md)
- [Phase 5 — Prepared Statement Cache](./phases/phase-5-prepared-statement-cache.md)

Agent-side ergonomics (Phases 6–8):

- [Phase 6 — Session Recall](./phases/phase-6-session-recall.md)
- [Phase 7 — Composed Context Bundles](./phases/phase-7-composed-context-bundles.md)
- [Phase 8 — Agent Feedback Channel](./phases/phase-8-agent-feedback-channel.md)

Packaging:

- [Phase 9 — Claude Code Plugin Package](./phases/phase-9-claude-code-plugin-package.md) *(complete; one plugin containing category-scoped guidance skills — `mako-guide` + 7 tool-cluster skills — plus `.mcp.json`; SDK in-process mode remains parked inside the spec)*

## Package Contents

- [roadmap.md](./roadmap.md) — canonical contract for this roadmap
- [handoff.md](./handoff.md) — execution rules + current status
- [phases/README.md](./phases/README.md) — phase index

## Relationship to other roadmaps

- **Initial Testing** — this roadmap is the natural follow-on. Every
  phase here depends on Initial Testing Phase 2's `ProjectStoreCache`
  being in place.
- **Roadmap 8** — orthogonal. R8.2+ stays paused pending real-use
  telemetry volume. Phases in this roadmap that emit telemetry
  (e.g. progress notifications, concurrency signals) feed into the
  existing R8.1 pipeline rather than building parallel infrastructure.
