# Phase 3.9.2 Tool Surface Planning

Status: `Complete` (shipped 2026-04-18)

This file is the canonical planning and ship doc for Roadmap 3 Phase 3.9.2. It is the follow-up after 3.9.1 focused on tool-surface quality for the operator-facing chat/product layer, not a new model-layer or trust-layer arc. The detailed plan below is preserved as planning history; read `Shipped Outcome` first for what actually landed.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [../handoff.md](../handoff.md) for the current execution target. Use [./phase-3.6.0-substrate-lift.md](./phase-3.6.0-substrate-lift.md), [./phase-3.6.1-investigation-composers.md](./phase-3.6.1-investigation-composers.md), [./phase-3.8-website-improvements.md](./phase-3.8-website-improvements.md), and [./phase-3.9.1-web-dashboard-polish.md](./phase-3.9.1-web-dashboard-polish.md) as the shipped substrate this phase builds on.

## Shipped Outcome

3.9.2 shipped the shared exposure-planning seam that had been missing across chat, API, and MCP:

- `packages/tools/src/tool-exposure.ts` is now the registry exposure planner:
  - immediate / deferred / blocked exposure states
  - capability metadata (`handlerKind`, `requiresProject`, `requiresSession`, `requiresDbBinding`, `parallelSafe`, `deferEligible`)
- `packages/harness-core/src/tool-exposure-plan.ts` is the harness-native overlay that combines registry exposure with native action/memory/semantic/sub-agent families
- harness chat now consumes planner output instead of bridge-local ad hoc guards
- MCP/API now consume the same planner truth for registry tools
- `tool_search` is the discoverability seam for deferred and blocked tools on MCP
- `ask` stays deferred on harness chat and immediate on MCP/API, which preserves chat-tool-bag quality without hiding the capability from external callers
- project-bound DB tools are blocked honestly when the current session/project has no live DB binding

This phase did not add a new tool catalog. It changed how the shipped catalog is exposed.

## Verification At Ship Time

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/harness-calls-registry-tool.ts`
- `node --import tsx test/smoke/harness-no-agent.ts`
- `node --import tsx test/smoke/core-mvp.ts`

## Prerequisites

Phase 3.9.2 requires these earlier phases complete:

- **Phase 3.6.0 - Substrate Lift.** Registry tools are already bridged into `streamText`; `tool_runs` logging and `AnswerPacket` surfaces already ship.
- **Phase 3.6.1 - Investigation Composers.** The core composer family exists and is reachable from CLI, HTTP, MCP, and harness-driven turns.
- **Phase 3.8 - Website Improvements.** The browser chat/operator surface is real and project-scoped.
- **Phase 3.9.1 - Web Dashboard Polish.** URL-first project scope and the current `/agent` information architecture already ship.

If any of those are not in place, this phase should not start.

## Goal

Raise tool-selection quality by adding one explicit tool-exposure planning layer that serves both:

- **mako chat / harness turns** as the primary target
- **agent -> mako-agent surfaces** (`/mcp`, API tool listing, future external agent clients) as the secondary target

Specifically:

- stop treating the model-facing tool bag as a flat dump of every eligible tool
- make exposure decisions session-aware and project-aware
- separate immediately-exposed tools from discoverable/deferred tools
- standardize runtime handler metadata so bridge, MCP, and future external callers stop special-casing tool families ad hoc

This is a tool-surface phase, not a new tools phase. It should improve how existing tools are exposed and orchestrated, not add a fresh batch of tool implementations.

## Why This Phase Exists

The current tool substrate works, but it has three structural weaknesses:

1. **Harness chat still exposes tools too bluntly.** [tool-bridge.ts](../../../../packages/harness-core/src/tool-bridge.ts) wraps every registry tool in `TOOL_DEFINITIONS` and exposes it unless a small local guard filters it out. That was the right 3.6.0 ship move, but it does not scale.
2. **Tool-family orchestration is split.** [tool-dispatch.ts](../../../../packages/harness-core/src/tool-dispatch.ts) owns action/memory/semantic/sub-agent tools; [tool-bridge.ts](../../../../packages/harness-core/src/tool-bridge.ts) owns registry tools; [registry.ts](../../../../packages/tools/src/registry.ts) owns registry execution and logging. There is no single planning seam that decides what the model should see.
3. **External agent surfaces list tools statically.** [services/api/src/mcp.ts](../../../../services/api/src/mcp.ts) registers every API-listed tool into MCP up front. That is workable for today's core set, but it leaves no seam for deferred discovery once more optional/external integrations arrive.

The chat surface feels this first. External agents will feel it next. This phase exists to fix the seam once, with chat as the first-class consumer and MCP/external agents reusing the same plan.

## Hard Decisions

1. **Chat/harness is the first-class target.**
   The primary acceptance bar is better tool exposure during `/agent` and harness-driven turns. External agent callers reuse the same planning substrate after that.

2. **No new parallel registry.**
   Existing tools still register through [packages/tools/src/tool-definitions.ts](../../../../packages/tools/src/tool-definitions.ts) and [packages/tools/src/registry.ts](../../../../packages/tools/src/registry.ts). 3.9.2 adds a planner over the existing registry and native harness families; it does not replace them.

3. **Do not copy Codex's full sandbox/approval stack.**
   The useful steal is the shape: planner + handler kind + deferred discovery. Mako should not import a large guardian/sandbox/orchestrator concept just to get that shape.

4. **Core mako tools remain immediately exposed.**
   The current core set — action tools, memory tools, semantic tools, sub-agents, answer tools, composers, project-bound DB tools when available — should still be visible directly when the session can actually use them. Deferred discovery is for optional or future external/integration tools, not for hiding the main product.

5. **Exposure planning is data, not policy scattered through `if` chains.**
   Tool availability should stop living in bridge-local and MCP-local conditionals. The output of the phase should be one planner result that says what is immediate, what is deferred, and why.

6. **One audit surface stays intact.**
   `tool_runs` remains the normalized audit trail. This phase should not fork logging or invent a second execution history model.

## Scope In

### 1. Tool exposure plan

Build one planner that takes the active session/project/runtime context and returns:

- `immediateTools` — safe to expose directly to the model now
- `deferredTools` — discoverable/searchable but not in the initial bag
- `blockedTools` — known tools that are unavailable in this session, with a reason code

The planner should understand at least:

- current project binding
- whether a live DB binding exists
- whether memory/semantic/sub-agent contexts are bound
- whether the caller is harness chat vs MCP/external agent surface

### 2. Tool capability metadata

Extend tool definitions with small capability metadata instead of hard-coded family knowledge spread through adapters.

Minimum metadata target:

- `handlerKind`
- `requiresProject`
- `requiresSession`
- `requiresDbBinding`
- `parallelSafe`
- `deferEligible`

This should be narrow and real. Do not add speculative knobs with no consumer.

### 3. Harness bridge consumes the planner

Replace the current "bridge everything eligible" behavior in [tool-bridge.ts](../../../../packages/harness-core/src/tool-bridge.ts) with planner output.

Result:

- `/agent` turns get the right immediate tool set for that session
- unavailable tools stop appearing just to fail at call time
- family-specific guards move out of the bridge and into the planner

### 4. MCP/API tool listing consumes the same planner

Update the MCP/API listing path so external agent callers stop getting a static all-tools export.

For this phase:

- immediate tools should register normally
- deferred tools should be discoverable through a small `tool_search`-style surface or equivalent planner-backed discovery response
- blocked tools should not be registered as normal callable tools

The goal is not to build a marketplace. The goal is to give agent callers the same honest tool surface that chat gets.

### 5. Small orchestration seam

Add one narrow orchestration layer around execution planning, not a system rewrite.

It should own:

- planner lookup
- runtime handler routing by `handlerKind`
- one consistent place for availability checks before execution

It should not replace:

- permission evaluation
- `invokeTool(...)`
- `tool_runs`
- existing session-event emission

### 6. Verification coverage

Add focused smokes for the actual risky seams:

- harness turn with and without DB binding exposes the right DB-tool surface
- MCP session tool listing reflects planner output rather than a static dump
- deferred/discoverable tools are returned by discovery, not by default listing
- core chat path still sees the expected composer + memory + semantic tools

## Scope Out

- new composer tools
- new DB tools
- UI redesign of `/agent`
- changing `AnswerPacket`
- changing provider resolution, defaults, or model catalog logic
- replacing the current permission system
- building a generic plugin/marketplace architecture

## Architecture Boundary

### Owns

- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/registry.ts`
- new planner/orchestration files under `packages/harness-core/src/`
- `packages/harness-core/src/tool-bridge.ts`
- `packages/harness-core/src/tool-dispatch.ts`
- `services/api/src/mcp.ts`
- any small API/service layer used only to expose planner-backed tool discovery
- focused smoke coverage for harness + MCP tool exposure

### Does Not Own

- chat UI redesign
- composer logic
- trust-layer ranking
- provider/model defaults
- the underlying `tool_runs` schema

## Execution Flow

1. Define the planner output shape and the minimum capability metadata.
2. Move current bridge/MCP gating logic into the planner.
3. Route harness chat through planner-backed immediate tools.
4. Route MCP/API tool listing through the same planner.
5. Add one small deferred-discovery surface for tools that should not be initially exposed.
6. Add focused smokes proving the chat path and external-agent path both reflect the same planning truth.

## File Plan

### Modify

- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/registry.ts`
- `packages/harness-core/src/tool-bridge.ts`
- `packages/harness-core/src/tool-dispatch.ts`
- `services/api/src/mcp.ts`
- relevant API/service tool-list surfaces

### Add

- `packages/harness-core/src/tool-exposure-plan.ts`
- `packages/harness-core/src/tool-exposure-types.ts`
- optional narrow discovery helper if needed (`tool_search` equivalent)
- focused smoke files for harness and MCP tool exposure

## Acceptance Criteria

This phase is complete when:

- chat/harness turns no longer expose a broad flat tool bag by default
- tool exposure is derived from one planner result, not duplicated bridge/MCP conditionals
- external agent callers (`/mcp` and any API tool-list surface) reflect the same immediate/deferred/blocked truth as chat
- blocked tools are hidden rather than advertised and failing later
- core mako tools remain directly callable without adding a discovery tax to normal chat use
- `tool_runs` logging still works unchanged across the execution paths this phase touches

## Risks

- **Overdesign.** The right answer is a small planner and a few real metadata fields, not a new framework.
- **Hiding too much.** Deferred discovery is useful for optional/external tools; if it hides core investigation tools, chat quality will get worse, not better.
- **Surface drift between chat and MCP.** The whole point of the phase is one exposure truth. If chat and MCP still compute different answers, the phase failed.
- **Reopening old tool-family fragmentation.** A planner that still special-cases everything through ad hoc callbacks will look cleaner in the diff but will not actually improve the architecture.

## Immediate Starting Files

- `packages/harness-core/src/tool-bridge.ts`
- `packages/harness-core/src/tool-dispatch.ts`
- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/registry.ts`
- `services/api/src/mcp.ts`
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md`
