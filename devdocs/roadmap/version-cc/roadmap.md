# Roadmap Version CC (Claude Code Native)

This file is the canonical roadmap for the CC-Native build cycle.

If another doc in this package disagrees with this file about what the
roadmap is for, what phases it contains, or what counts as done, this
roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../version-initial-testing/roadmap.md](../version-initial-testing/roadmap.md)
- [../version-initial-testing/handoff.md](../version-initial-testing/handoff.md)
- Claude Code MCP client source (`CC/services/mcp/client.ts`,
  `CC/services/mcp/useManageMCPConnections.ts`,
  `CC/services/mcp/elicitationHandler.ts`,
  `CC/tools/ToolSearchTool/prompt.ts`,
  `CC/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`,
  `CC/constants/toolLimits.ts`, `CC/constants/prompts.ts`,
  `CC/services/tools/toolOrchestration.ts`, `CC/commands.ts`,
  `CC/components/skills/SkillsMenu.tsx`) — indexed via codexref.

## Roadmap Contract

This is the `CC-Native` roadmap.

Its job is two-sided:

1. **CC-side integration.** Fit mako's tool surface into Claude Code's
   existing mechanisms: `_meta` channels, deferred tool loading,
   parallel execution, large-output handling, progress notifications.
2. **Agent-side ergonomics.** Close the pain points the agent feels
   directly — no visibility into prior-session memory, atomic-vs-
   composed queries, no way to signal "that tool call was useless" —
   regardless of which client is on the other end of the pipe.

The goal is that using mako inside Claude Code feels native — not "a
generic MCP server attached to Claude Code" — while keeping the door
open for Codex and other agent harnesses to slot in later without
forking the plumbing. The **client adapter pattern** shipped in Phase 1
is what keeps that door open.

It should make `mako-ai` better at:

- being *found* by Claude Code's ToolSearch when the agent is looking
  for a capability rather than a tool name
- letting CC render and deliver mako outputs in the same shape other
  first-party CC tools do
- giving the agent real-time signal during multi-stage mako work so
  the UI has something better than a 30-second "still running"
  heartbeat
- keeping end-to-end latency in line with comparable MCP servers after
  Initial Testing Phase 2's structural fix
- *surfacing mako's own memory* — answer traces, prior tool runs,
  finding acks — as first-class recall tools for the agent
- *composing context neighborhoods* so common investigative questions
  return in one call instead of four
- *accepting feedback from the agent* — "that was useless," "that was
  perfect" — so future learned routing has training data

It does **not**:

- change any tool input or output schema already in R1–R7. Agents see
  the same `tools/list` shape for existing tools; new tools are added
  in their own schemas. Metadata additions flow via MCP `_meta`.
- hardcode `anthropic/*` keys or CC-specific budgets in shared code.
  Per-client concerns route through the `AgentClient` adapter shipped
  in Phase 1.
- replace Roadmap 8. R8.2+ still waits for R8.1 telemetry to mature.
  This roadmap *feeds* that future work by closing the agent-feedback
  loop (Phase 8).

## Surface Choice: Tools vs Resources vs MCP Skills

MCP has three model-visible surfaces beyond `tools`. CC consumes all
three. This roadmap makes an explicit decision on which to use for
the new capabilities in Phases 6, 7, and 8.

**CC's surfaces:**

- **Tools** — `tools/list` + `tools/call`. Typed input + output;
  model invokes by name with structured args. CC's default assumption
  about how servers expose behavior.
- **Resources** — `resources/list` + `resources/read`. URI-keyed
  static-ish fetches. Read via `ListMcpResourcesTool` /
  `ReadMcpResourceTool`
  (`CC/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`,
  `CC/services/mcp/client.ts:~2000-2028`). No structured input beyond
  the URI.
- **MCP skills** — `prompts/list`-sourced slash-commands surfaced in
  `CC/commands.ts:~525` (`getMcpSkillCommands`) and
  `CC/components/skills/SkillsMenu.tsx:24-45`. Prose skills the agent
  can invoke via `/mcp__server__skill`; each yields a prompt, not a
  structured result.

**Decision for this roadmap:** every capability in Phases 6–8 ships
as a **tool**.

Rationale per phase:

- **Phase 6 (`recall_answers`, `recall_tool_runs`)** — needs
  structured input (text query, `queryKind`, time window, `limit`),
  structured output (packet summaries, trust state), and a truncation
  flag. Resources give you URI-keyed fetches — no filter surface.
  Skills give you prose prompts — wrong shape for a typed recall
  result. Tools are the only surface that fits.
- **Phase 7 (`table_neighborhood`, `route_context`,
  `rpc_neighborhood`)** — needs structured input (`tableName`,
  `schemaName?`, `maxPerSection`) and structured output (typed
  sections, evidence refs, trust surface). Same constraint.
- **Phase 8 (`agent_feedback`, `agent_feedback_report`)** — a
  mutation (writes a `RuntimeUsefulnessEvent`) plus structured read.
  Not a natural fit for resources (URIs are for resource identity,
  not RPC) or skills (prompts, not mutations).

**What this roadmap does not rule out:** a future phase exposing a
*browsable catalog* of mako's persistent memory via MCP resources —
e.g. `mako://answer-traces/<projectId>/<traceId>` for direct URI
fetch. That complements recall-tools (which are the search /
structured-query surface) rather than replacing them. Opens with
evidence of an agent or human asking to browse rather than query.

**Server-provided MCP skills remain parked as a capability surface.**
A future `prompts/list` slash-command package is plausible, but it
needs a concrete usage pattern to earn its slot. Slash-commands are a
different ergonomic from tool invocation, and mixing them into the MCP
server would muddy the "one capability per surface" contract.

Phase 9 is different: it packages Mako for Claude Code as one plugin
(`mako-ai`) that ships a set of category-scoped guidance skills — one
per Mako tool cluster (discovery, trace, neighborhoods, graph, database,
code-intel, workflow) plus a top-level `mako-guide` entry skill that
carries cross-cutting feedback and finding-ack policy. The split maps
to Claude Code's turn-0 skill-match pattern: only the skill whose
`description` matches the user's intent loads its body, keeping the
always-loaded context cost minimal. A standalone/global skill may be
used while authoring the instructions, but it is not a second
user-facing install path. The plugin is distribution / orchestration
guidance; it does not replace tool schemas, mutate server behavior, or
move Mako capabilities onto the MCP skills surface.

## Entry Assumptions

Roadmap CC begins with these already shipped:

- every primitive, composer, artifact, graph, operator, and
  project-intelligence surface from Roadmaps 1–7
- R8 Phase 8.0 contract (`RuntimeUsefulnessEvent` etc.) and R8 Phase
  8.1 capture + inspection pipeline
- Initial Testing Phase 1 — finding acknowledgements
- Initial Testing Phase 2 — `ProjectStore.checkpoint` + `ProjectStoreCache`
  + MCP stdio entry flushing on shutdown
- stdio MCP transport (`agentmako mcp`) as the primary CC integration
- `@modelcontextprotocol/sdk` at a version that supports passing `_meta`
  through on tool registration (verify in Phase 1)

That means each phase here composes on top of shipped substrate; it does
not rebuild it.

## Roadmap Rules

1. **Every phase cites a concrete observation** — either a CC mechanism
   with file+line reference, or an agent-ergonomics pain with a
   scenario. No vague "performance" or "polish" phases.
2. **No existing tool contract changes.** Input and output schemas in
   `packages/contracts/src/tool-*-schemas.ts` for R1–R7 tools stay
   untouched. Per-client metadata flows via `_meta`. New tools (Phases
   6, 7, 8) ship their own schemas, additive.
3. **Client-specific code lives in `packages/tools/src/agent-clients/`.**
   No `if (client === 'claude-code')` branches scattered through tool
   implementations. Every client concern is a method on the
   `AgentClient` interface; adding Codex later = drop `codex.ts` in.
4. **Cross-client safety.** Every `_meta` key is namespaced
   (`anthropic/...`, later `codex/...`, etc.). Non-target clients ignore
   keys they don't understand, per MCP spec.
5. **Phases ship as independently verifiable slices.** Stopping between
   any two slices leaves mako in a working state.
6. **Phase 1's adapter is the enabler.** Phases 3, 4 depend on it to
   route client-specific decisions. Phases 2, 5, 6, 7, 8 are
   client-agnostic and can ship in any order after Phase 1.
7. **Phase 5 (prepared-statement cache) compounds on Phase 2 (project
   store cache).** Phases 6–8 are independent of 5.
8. **Phase 9 is the Claude Code plugin package.** It may add local
   plugin files and skill guidance for tool routing / feedback logging.
   The in-process SDK remains parked unless live use leaves a measured
   subprocess-vs-in-process gap. Real refactor; only open with evidence.

## Evaluation Rule

Same posture as Initial Testing:

- typed contract coverage per phase (no `any` in public surfaces)
- focused smokes per slice
- at least one realistic usefulness check (e.g. "does CC's ToolSearch
  actually rank mako tools higher after Phase 1?")
- doc updates when exposure posture changes

## Phase Sequence

**CC-side integration:**

1. `Phase 1` — Client Adapters + Discoverability (the `AgentClient`
   infrastructure; `ClaudeCodeClient` emits `_meta.anthropic/*`;
   `GenericClient` stays minimal; Codex slot opens for later)
2. `Phase 2` — Parallel Execution Safety (concurrency smoke over
   `ProjectStoreCache`; document serialization model)
3. `Phase 3` — Output Budget Alignment (let CC's 200KB disk-persist
   handle overflow; raise mako-side caps where cost is bytes not
   computation; no per-client budget plumbing in this phase)
4. `Phase 4` — Typed Progress Notifications (multi-stage tools emit
   MCP `notifications/progress` via adapter)
5. `Phase 5` — Prepared Statement Cache (`StatementSync` reuse per
   `ProjectStore`; measure delta on perf smoke)

**Agent-side ergonomics:**

6. `Phase 6` — Session Recall (`recall_answers`, `recall_tool_runs`
   tools exposing mako's own persistent memory)
7. `Phase 7` — Composed Context Bundles (neighborhood tools that
   fuse primitives: `table_neighborhood`, `route_context`,
   `rpc_neighborhood`)
8. `Phase 8` — Agent Feedback Channel (`agent_feedback` tool emitting
   `RuntimeUsefulnessEvent` with `decisionKind: "agent_feedback"` —
   closes the loop; feeds R8.2+)

**Packaging:**

9. `Phase 9` — Claude Code Plugin Package (complete; one installable Claude Code
   plugin containing category-scoped guidance skills — `mako-guide` plus
   one skill per Mako tool cluster — and `.mcp.json` at the plugin root,
   covering all tools, capabilities, and feedback policy)

**Parked future optimization:**

- SDK In-Process Mode — reopen only with concrete evidence that
  subprocess + pipe remains the dominant cost.

Phase 1 shipped first as the enabler. Phases 2, 5 build on
Initial Testing Phase 2's store cache. Phases 6–8 are agent-side
ergonomics additions. Phase 9 is a packaging / guidance phase, not an
SDK rewrite.

## What Comes Next

After this roadmap closes:

- Initial Testing gets any new observation-driven fixes that surface
  in live use.
- Roadmap 8 Phase 8.2+ opens once R8.1 telemetry has non-fixture
  signal from real multi-project use.
- Phase 9 can ship the Claude Code plugin package so users get Mako's
  tool-routing and feedback policy without reading roadmap docs.
- If later live use still leaves a measurable CC-latency gap, SDK
  in-process work opens with a concrete subprocess-vs-in-process
  target.

None of those gates is on a schedule.
