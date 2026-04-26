# Phase 1 CC — Client Adapters + Discoverability

Status: `Complete`

`AgentClient` adapter shipped in `packages/tools/src/agent-clients/`
with `ClaudeCodeClient`, `GenericAgentClient`, and
`selectAgentClient`. Every MCP-visible mako tool carries a curated
`_meta.anthropic/searchHint`; `tool_search`, `ask`, and `repo_map`
carry `_meta.anthropic/alwaysLoad`. `InitializeResult.instructions`
emits shared mako guidance under the 2048-char `MAX_MCP_DESCRIPTION_LENGTH`
cap. Three smokes green: `agent-client-selection.ts`,
`mcp-tool-metadata.ts`, `mcp-server-instructions.ts`.

## Deployment Observation

Three observations motivate this phase.

### 1. Discoverability inside Claude Code

Claude Code defers every MCP tool by default. `CC/tools/ToolSearchTool/prompt.ts:62` — `isDeferredTool` checks `tool.alwaysLoad === true` first (opt-out), then:

```ts
if (tool.isMcp === true) return true
```

The `alwaysLoad` check running first is exactly the mechanism Phase 1
exploits — setting `_meta['anthropic/alwaysLoad'] = true` on an MCP
tool bypasses the MCP-default-defer rule. (CC's own `isDeferredTool`
additionally has bypasses for `ToolSearchTool`, `AgentTool` under
`FORK_SUBAGENT`, and `BriefTool` / `SendUserFile` under `KAIROS` —
mako tools don't match any of those, so the `isMcp` rule governs.)

That means the first time an agent wants to use any mako tool in a CC
session, the model sees only the tool *name* in a `<system-reminder>`
/ `<available-deferred-tools>` block and has to call `ToolSearch` to
fetch the schema before it can call the tool.

`ToolSearch`'s scoring (`CC/tools/ToolSearchTool/ToolSearchTool.ts:244`)
weights matches as:

- exact tool-name-part match: `+10` (or `+12` for MCP server names)
- substring match within a tool-name part: `+5` (or `+6` for MCP)
- full-name fallback (only when score is still 0): `+3`
- `searchHint` regex match: `+4`
- description regex match: `+2`

**`searchHint` is rank-only, not prompt-visible.**
`formatDeferredToolLine` returns `tool.name` only — the hint never
appears in the `<available-deferred-tools>` / `<system-reminder>`
block the model sees. CC stopped rendering hints after an A/B
(`exp_xenhnnmn0smrx4`, stopped Mar 21) showed no benefit
(`CC/tools/ToolSearchTool/prompt.ts:114-115`). Hints are exclusively
keyword ammunition for `ToolSearchTool`'s own matcher; they do not
double as discoverability copy in the prompt.

Mako emits **zero** `searchHint` entries today. Every mako tool
competes on description-match alone against every other MCP tool in
the user's config. Agents looking for a capability by *intent* ("find
tables that leak across tenants", "trace a route to a schema object")
don't reliably land on the right mako tool — they fall back to grep.

Separately, CC supports `_meta["anthropic/alwaysLoad"]` to force a
tool into the initial prompt with its full schema, bypassing the
deferred-load dance (`CC/services/mcp/client.ts:1784`). Mako emits
none. Some mako tools are natural "turn-1" candidates —
`tool_search`, `ask`, `repo_map` — where paying the per-session token
cost of always-loaded beats paying a round-trip per first-use.

### 2. Server instructions channel

CC reads `InitializeResult.instructions` during the MCP handshake
(`CC/services/mcp/client.ts:~1157-1166` — `client.getInstructions()`,
truncated at `MAX_MCP_DESCRIPTION_LENGTH`) and injects every connected
server's instructions into the system prompt under
`# MCP Server Instructions` → `## <serverName>` blocks
(`CC/constants/prompts.ts:579-603`, `getMcpInstructions`).

Today mako's MCP server advertises only `{ name, version }` with
`capabilities: { tools: {} }` (`services/api/src/mcp.ts:73`) — no
instructions field. That means mako gets zero prompt-level real estate
to tell the agent things like:

- when to prefer mako's `ask` over built-in `Grep` for a code question
- that `tool_search` is the mako catalog gateway when the agent is
  not sure which mako tool fits
- that `repo_map` is the first-turn orientation tool for project
  shape and entry points
- that artifact tools (`review_bundle_artifact`,
  `verification_bundle_artifact`) are pre-ship summaries, not
  exploratory

This is a free first-turn discoverability win that sits alongside
`_meta` in the same initialization handshake. Goes in Phase 1 because
the `AgentClient` adapter pattern is the right place to own a per-
client `instructions` string.

### 3. Client modularity for Codex and future agents

Claude is the de-facto primary client, but it should not be the only
one mako serves well. Codex, OpenCode, and other agent harnesses
support MCP with their own convention layers on top. If mako hardcodes
`anthropic/*` keys and CC-specific budgets in shared tool code, adding
a second client becomes a sprawl of `if (client === ...)` branches
across `packages/tools` and `packages/contracts`.

The fix is a single-file adapter pattern: one class per client, all
implementing the same interface, selected by reading `clientInfo.name`
from the MCP `initialize` handshake. Phase 1 ships the pattern plus
two adapters — `ClaudeCodeClient` (full-featured) and `GenericClient`
(MCP-spec baseline, no per-client extras). Codex slots in later as a
new file; no code in Phases 2–8 has to change to accommodate it.

## Goal

1. Ship the `AgentClient` adapter pattern in
   `packages/tools/src/agent-clients/`.
2. Through `ClaudeCodeClient`, emit a curated `anthropic/searchHint`
   for every MCP-visible mako tool (registry tools plus MCP-local
   `tool_search`) and mark 3 turn-1 tools with
   `anthropic/alwaysLoad`. Through `GenericClient`, emit nothing
   client-specific.
3. Through `AgentClient.serverInstructions()`, emit a curated
   server-wide instructions string on `InitializeResult` so CC's
   `# MCP Server Instructions` block carries mako's when-to-use
   guidance. `GenericClient` returns the same spec-baseline string
   (instructions are spec, not CC-specific); only CC-specific
   framing would route through the adapter.
4. The MCP server starts with `GenericAgentClient`, captures
   `clientInfo` via the MCP initialize lifecycle, stores the selected
   adapter on the session, and updates registered tool metadata before
   `tools/list` is served.
5. Every subsequent phase that has client-specific behavior uses the
   adapter — never a hardcoded `anthropic/` key in shared code.

Tool metadata flows through MCP `_meta` on the `tools/list` response.
Server-wide instructions flow through `InitializeResult.instructions`.
Non-target clients ignore unknown `_meta` keys per MCP spec; clients
that don't render instructions (some do, some don't) simply drop them.

Implementation note: `InitializeResult.instructions` is fixed during
initialize. Because Phase 1 uses the same instructions for CC and
generic clients, pass the baseline string through `McpServer`
`ServerOptions` at construction. `_meta` is per-client; update the
registered tool metadata after initialize (or use the lower-level SDK
`Server` request handler) before first `tools/list`. Do not put
`instructions` inside server info.

## Hard Decisions

- **`AgentClient` is an interface, not a class with inheritance.**
  Each client is a plain object / class implementing the interface.
  No abstract base. Smaller blast radius for changes per client.

- **Client selection happens once, at `initialize`.**
  Read `clientInfo.name` from the MCP handshake and cache the selected
  adapter on the session. With the high-level SDK, use the initialized
  server lifecycle (for example `server.server.getClientVersion()`),
  or drop to the lower-level `Server` request handler if that is not
  early enough to update `tools/list` metadata. Do not invent an
  `mcp-stdio.ts` initialize hook that the current wrapper does not
  expose. No per-tool-call re-selection.

- **Client detection is best-effort.** If `clientInfo.name` is
  missing or unrecognized, fall through to `GenericClient`. Mako
  works correctly even against clients we've never heard of.

- **Client name matching is case-insensitive, substring-friendly.**
  `clientInfo.name` can be `"claude-code"`, `"Claude Code"`,
  `"claude-code-cli/1.2.3"`, etc. depending on version. Match on
  lowercase substring: `"claude"` → `ClaudeCodeClient`. Codex later
  will match `"codex"` similarly.

- **`searchHint` is required for every MCP-visible mako tool.**
  No registry tool ships without one, and MCP-local tools such as
  `tool_search` are explicitly covered even though they do not live
  in `TOOL_DEFINITIONS`. If the hint is hard to write, the description
  is probably also unclear — the work of writing it is a useful
  forcing function.

- **`searchHint` is 3–10 words, no trailing period, single line.**
  Matching CC's own guidance at `Tool.ts:371`. Repeats of tool-name
  tokens waste score.

- **`alwaysLoad` is reserved for turn-1 tools.**
  Initial selection: `tool_search`, `ask`, `repo_map`. Rationale:
  `tool_search` is the MCP-local gateway into mako's catalog, `ask`
  is the one-shot answer loop, and `repo_map` is the cheapest project
  orientation call. Every other mako tool, including `cross_search`,
  stays deferred until the model asks for it through ToolSearch.

- **Hints live in a single curated map, not scattered across
  `tool-definitions.ts`.**
  `packages/tools/src/agent-clients/claude-code-hints.ts` (or
  equivalent) holds the full `toolName → { searchHint, alwaysLoad? }`
  map. That keeps the curation surface in one file, so reviewing the
  coherence of all hints together is one page of diff instead of
  dozens.

- **MCP SDK version compatibility is verified in slice 1.**
  Before writing any hint, verify the installed
  `@modelcontextprotocol/sdk` version's `server.registerTool(...)`
  accepts `_meta` in the tool registration config, verify `McpServer`
  accepts `instructions` in `ServerOptions`, and verify registered
  tool metadata can be updated before first `tools/list`. If not, use
  the lower-level `Server` API or bump the SDK in a standalone commit.

- **Server instructions are a single curated block, not generated.**
  The instructions string is a short prose prompt (~500–1200 chars,
  comfortably under CC's `MAX_MCP_DESCRIPTION_LENGTH = 2048`
  truncation) that tells the agent when to reach for mako. Hand-
  written, version-controlled as a template string in the adapter.
  No templating engine, no per-project overrides in this phase. If
  the string gets long, trim — not every nuance belongs in the
  first-turn prompt. 2048 bytes leaves tight headroom, so target
  ~1200 chars and smoke-cap at 2000 so an accidental growth still
  breaks loud before CC silently truncates.

- **Instructions are not client-specific by default.**
  The same prose serves CC, Codex, Cursor, and arbitrary SDK
  consumers. The adapter pattern still owns the method so a future
  client can override (e.g. if Codex renders instructions
  differently), but `ClaudeCodeClient` and `GenericClient` return
  the same string today. This keeps the phase's client-walling
  rule intact without forcing spurious per-client branching.

## Scope In

- new directory `packages/tools/src/agent-clients/` with:
  - `types.ts` — `AgentClient` interface
  - `generic.ts` — `GenericAgentClient` (MCP-spec baseline)
  - `claude-code.ts` — `ClaudeCodeClient`
  - `claude-code-hints.ts` — curated `searchHint` / `alwaysLoad`
    map for every registry tool plus MCP-local `tool_search`
  - `index.ts` — `selectAgentClient(clientInfo)` + re-exports
- `services/api/src/mcp.ts` / `services/api/src/mcp-stdio.ts`
  capture `clientInfo` through the SDK server lifecycle, store the
  selected adapter on the session, and update registered tool metadata
  before `tools/list`
- `services/api/src/mcp.ts` routes `_meta` emission for registry tools
  and MCP-local `tool_search` through the selected adapter
- smoke: `test/smoke/agent-client-selection.ts` — verify
  `selectAgentClient` picks `ClaudeCodeClient` for CC-shaped names,
  `GenericClient` for everything else
- smoke: `test/smoke/mcp-tool-metadata.ts` — spawn the stdio MCP
  server emulating a CC client, run `tools/list`, assert every
  MCP-visible mako tool has `_meta["anthropic/searchHint"]` and the
  3 designated tools have
  `_meta["anthropic/alwaysLoad"] === true`
- smoke variant with a non-CC clientInfo: assert no `anthropic/*`
  keys leak through (GenericClient posture)
- smoke: `test/smoke/mcp-server-instructions.ts` — spawn stdio MCP
  server, read `InitializeResult.instructions`, assert non-empty,
  length under 2000 chars (CC's `MAX_MCP_DESCRIPTION_LENGTH` is
  2048 — assert 2000 so there's headroom before silent truncation),
  assert both CC and generic clients receive the same string

## Scope Out

- Codex adapter implementation (placeholder only — a one-line
  comment in `index.ts` pointing to where it would slot in)
- user-configurable / per-project hint overrides (follow-up if real
  users need different phrasings)
- automated hint generation from descriptions (curation invites
  less drift)
- additional `_meta` keys beyond `searchHint` / `alwaysLoad` in this
  phase (Phase 4 adds progress shape through `AgentClient`; any
  future per-client output-budget work would extend the adapter
  separately)
- changing existing MCP tool annotations (`readOnlyHint`,
  `openWorldHint`, etc.)
- `tools/call` output `_meta` path — this phase is discovery-only

## Architecture Boundary

### Owns

- `packages/tools/src/agent-clients/` (new directory, every file
  within)
- `services/api/src/mcp.ts` — pipe adapter-produced `_meta` into
  registration / metadata-update flow and include MCP-local
  `tool_search`
- `services/api/src/mcp-stdio.ts` — connect stdio transport while
  preserving the session adapter selected through the SDK lifecycle
- `packages/contracts/src/tool-registry.ts` — extend
  `ToolDefinitionSummary` with optional `searchHint` / `alwaysLoad`
  (non-breaking; consumers that want to render them can)
- `test/smoke/agent-client-selection.ts`,
  `test/smoke/mcp-tool-metadata.ts` (new)

### Does Not Own

- any tool input / output Zod schema — tools themselves don't
  change
- tool implementation bodies — `execute` functions are untouched
- CLI rendering of tool metadata (separate, cheap follow-up if
  wanted)
- HTTP API response shape — `listTools` forwards whatever's on
  `ToolDefinitionSummary`; the new fields ride along
- Claude Code-side behavior: we emit correct `_meta`; CC decides
  how to rank and display

## Contracts

### `AgentClient` interface

```ts
// packages/tools/src/agent-clients/types.ts
export interface AgentClientInitializeInfo {
  /** `clientInfo.name` from the MCP `initialize` handshake. */
  name?: string;
  /** `clientInfo.version` from the MCP `initialize` handshake. */
  version?: string;
}

export interface AgentClientToolInfo {
  /** MCP-visible tool name. Covers registry tools and MCP-local tools. */
  name: string;
  /** Optional description for future generic-client heuristics. */
  description?: string;
}

export interface AgentClient {
  /** Stable identifier for telemetry + logging. */
  readonly id: "claude-code" | "generic" | "codex" | (string & {});

  /**
   * Return the `_meta` object to emit for a given tool's
   * `tools/list` entry. Returning `undefined` or `{}` means the
   * client has no custom metadata for this tool.
   */
  toolMeta(tool: AgentClientToolInfo): Record<string, unknown> | undefined;

  /**
   * Return the server-wide instructions string for
   * `InitializeResult.instructions`. Single curated prose block
   * shared by every client today; the method exists so a future
   * client-specific override can land without touching shared
   * code. Phase 1 returns the same string for every client because
   * instructions are decided during initialize, before per-client
   * post-initialize metadata updates. Undefined means "no
   * instructions" (GenericClient may choose this if the server
   * should run silent).
   */
  serverInstructions(): string | undefined;
}

/**
 * Select the right adapter based on the MCP initialize handshake.
 * Case-insensitive substring match on `clientInfo.name`; falls
 * through to `GenericAgentClient` for unrecognized clients.
 */
export function selectAgentClient(
  info: AgentClientInitializeInfo | undefined,
): AgentClient;
```

Phase 4 extends `AgentClient` with `progressShape(event)`. Future
per-client budget work can extend the adapter later if it earns the
extra plumbing. Phase 1 ships the interface + `toolMeta` +
`serverInstructions` only.

### `ClaudeCodeClient` behavior

```ts
// packages/tools/src/agent-clients/claude-code.ts
import type { AgentClient } from "./types.js";
import { CLAUDE_CODE_TOOL_HINTS } from "./claude-code-hints.js";

export const ClaudeCodeClient: AgentClient = {
  id: "claude-code",
  toolMeta(tool) {
    const hint = CLAUDE_CODE_TOOL_HINTS[tool.name];
    if (!hint) return undefined;
    const meta: Record<string, unknown> = {
      "anthropic/searchHint": hint.searchHint,
    };
    if (hint.alwaysLoad) {
      meta["anthropic/alwaysLoad"] = true;
    }
    return meta;
  },
  serverInstructions() {
    return MAKO_SERVER_INSTRUCTIONS;
  },
};
```

### `GenericAgentClient` behavior

```ts
// packages/tools/src/agent-clients/generic.ts
export const GenericAgentClient: AgentClient = {
  id: "generic",
  toolMeta: () => undefined,
  serverInstructions: () => MAKO_SERVER_INSTRUCTIONS,
};
```

### `ToolDefinitionSummary` extension

```ts
// packages/contracts/src/tool-registry.ts
export interface ToolDefinitionSummary {
  // ...existing fields
  /** See `AgentClient.toolMeta`. Populated only when the registering
   *  client has a curated hint for this tool. */
  searchHint?: string;
  alwaysLoad?: boolean;
}
```

Both optional — default listings over non-MCP surfaces (CLI, HTTP)
see them populated only when the relevant adapter had something to
say.

### Server instructions template

```ts
// packages/tools/src/agent-clients/mako-server-instructions.ts
export const MAKO_SERVER_INSTRUCTIONS = `mako is a project-intelligence MCP server. Use it when the question is:

- structural ("what touches table X", "who calls function Y", "how is route Z authorized")
- cross-surface (code + schema + types + routes together)
- evidence-backed (answers carry basis + trust state + evidence refs)

Prefer mako over built-in Grep / file-reading when the question is
about relationships, not literal text. For free-text search inside
a single file, built-in tools are fine.

Starting points:
- tool_search — find the right mako tool when intent is clear but
  the tool name is not
- ask — one-shot answer loop for a single question
- repo_map — project orientation, entry points, centrality
- cross_search — unified search across code, types, schema, routes

Tools carry \`_meta.anthropic/searchHint\` for ToolSearch ranking and
\`_meta.anthropic/alwaysLoad\` to mark turn-1 candidates. Outputs
carry typed packets with evidence refs, not just prose.`;
```

Instructions text is owned by mako, not curated per-client. If CC
evolves the prompt surface such that different framing helps, the
adapter method is the seam to branch on.

### Hint map shape

```ts
// packages/tools/src/agent-clients/claude-code-hints.ts
export const CLAUDE_CODE_TOOL_HINTS: Record<
  string,
  { searchHint: string; alwaysLoad?: boolean }
> = {
  tool_search: {
    searchHint: "find mako tool by task intent",
    alwaysLoad: true,
  },
  ask: {
    searchHint: "answer question one round answer loop",
    alwaysLoad: true,
  },
  repo_map: {
    searchHint: "repo orientation outline aider centrality first turn",
    alwaysLoad: true,
  },
  cross_search: {
    searchHint: "cross stack unified search files types database schema",
  },
  // ... populated for every registry tool plus MCP-local tool_search
};
```

The full map is filled in during slice 3.

## Execution Flow (slices)

1. **SDK surface verification** — confirm the installed
   `@modelcontextprotocol/sdk` version's `server.registerTool` call
   shape (`services/api/src/mcp.ts:86`) accepts `_meta` in the tool
   registration config, confirm `McpServer` accepts `instructions` in
   `ServerOptions`, and confirm registered metadata can be changed
   before first `tools/list`. Document the exact call shape. If the
   version needs a bump, do that in a standalone commit before slice
   2.
2. **Adapter infrastructure** — create `packages/tools/src/agent-clients/`
   with `types.ts`, `generic.ts`, `index.ts`, and an empty
   `claude-code.ts` that returns `undefined` from `toolMeta`. Wire
   `selectAgentClient` into the MCP session using the SDK initialized
   lifecycle; start as generic and update the session adapter after
   `clientInfo` is available. Smoke:
   `agent-client-selection.ts` covers case-insensitive matching,
   generic fallback, missing clientInfo.
3. **Hint curation** — write `claude-code-hints.ts` with an entry
   for every tool in `TOOL_DEFINITIONS` plus MCP-local `tool_search`.
   Each hint: non-empty, single line, no trailing period, 3–10 words,
   prefers terms not in the tool name. `tool_search`, `ask`,
   `repo_map` get `alwaysLoad: true` with short comments justifying
   each.
4. **`ClaudeCodeClient.toolMeta` implementation** — populate to read
   from the hint map and emit `anthropic/searchHint` +
   `anthropic/alwaysLoad`.
5. **MCP wiring** — `services/api/src/mcp.ts` consults the session's
   adapter when registering or updating each tool and passes the
   adapter-produced `_meta` through. CC-shaped clients get metadata
   before `tools/list`; generic clients get no `anthropic/*` keys.
6. **Smoke** — `mcp-tool-metadata.ts` spawns the stdio server with a
   simulated `clientInfo: { name: "claude-code" }`, asserts
   `tools/list` carries correct `_meta`. A second run with
   `clientInfo: { name: "some-unknown-agent" }` asserts no
   `anthropic/*` keys leak.
7. **Server instructions** — implement
   `AgentClient.serverInstructions()` on both adapters; plumb the
   shared return value through to `McpServer` construction using the
   second `ServerOptions` argument
   (`new McpServer({ name, version }, { capabilities, instructions })`).
   Smoke:
   `mcp-server-instructions.ts` asserts non-empty string on
   `InitializeResult.instructions`, length under 2000 chars
   (CC's `MAX_MCP_DESCRIPTION_LENGTH` is 2048; 2000 leaves headroom
   before silent truncation), identical string for CC-shaped and
   unknown-client clientInfo.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/tools/src/agent-clients/types.ts`
- `packages/tools/src/agent-clients/generic.ts`
- `packages/tools/src/agent-clients/claude-code.ts`
- `packages/tools/src/agent-clients/claude-code-hints.ts`
- `packages/tools/src/agent-clients/mako-server-instructions.ts`
- `packages/tools/src/agent-clients/index.ts`
- `test/smoke/agent-client-selection.ts`
- `test/smoke/mcp-tool-metadata.ts`
- `test/smoke/mcp-server-instructions.ts`

Modify:

- `packages/contracts/src/tool-registry.ts` — extend
  `ToolDefinitionSummary` with optional `searchHint` / `alwaysLoad`
- `packages/tools/src/index.ts` — re-export adapter types / factory
- `services/api/src/mcp-stdio.ts` — keep stdio transport wiring while
  preserving the session adapter selected by the SDK server lifecycle
- `services/api/src/mcp.ts` — capture `clientInfo`, pipe adapter
  metadata through registry-tool and `tool_search` registration/update,
  and pass shared instructions through `McpServer` `ServerOptions`
- `package.json` — register three new smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Added`

Keep unchanged:

- every `tool-*-schemas.ts` under `packages/contracts/src`
- every tool implementation body in `packages/tools/src`
- every existing smoke
- `listToolDefinitions()` core output shape (fields ride along as
  optional)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `agent-client-selection.ts` passes: CC-like names → `ClaudeCodeClient`;
  `"Codex"`, `""`, missing → `GenericAgentClient` (placeholder
  until Codex adapter ships); case insensitivity works.
- `mcp-tool-metadata.ts` spawns `agentmako mcp`, round-trips the
  JSON-RPC `initialize` + `tools/list` handshake with a CC-shaped
  `clientInfo`, and asserts for every MCP-visible mako tool:
  - `_meta["anthropic/searchHint"]` is a non-empty string
  - no newlines in the hint
  - word count 3–10
- a second run with a non-CC `clientInfo` asserts zero `anthropic/*`
  keys in any tool's `_meta`
- `tools/list` continues to include every registered mako tool (no
  accidental drops during wiring)
- `mcp-server-instructions.ts` passes:
  `InitializeResult.instructions` is a non-empty string under
  2000 chars (CC's `MAX_MCP_DESCRIPTION_LENGTH` cap is 2048; 2000
  leaves headroom so an accidental growth breaks the smoke before
  CC silently truncates); same string emitted for CC and non-CC
  clientInfo; every backticked tool name in the string resolves
  against the live MCP-visible tool list
- existing `test/smoke/mcp-stdio.ts` continues to pass

## Done When

- `packages/tools/src/agent-clients/` directory shipped with
  `AgentClient` interface, `ClaudeCodeClient`, `GenericAgentClient`,
  `selectAgentClient`
- every registry tool plus MCP-local `tool_search` in
  `CLAUDE_CODE_TOOL_HINTS` has a curated `searchHint`
- `tool_search`, `ask`, `repo_map` carry `alwaysLoad: true`
- MCP `tools/list` carries adapter-produced `_meta` per client
- `InitializeResult.instructions` carries the mako instructions
  template through the adapter
- all three new smokes green; existing `mcp-stdio.ts` smoke still green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **SDK version doesn't accept `_meta` on `registerTool`.**
  The MCP SDK has evolved; older versions may require `_meta` on
  the tool definition object rather than as a separate parameter.
  Slice 1 is specifically the "which call shape actually works"
  verification.
- **`clientInfo.name` variability across CC versions.**
  The exact string CC sends is subject to change. Case-insensitive
  substring match on `"claude"` is robust against small variations
  but may false-positive a future unrelated client. Document the
  matching rule and accept the residual risk.
- **Hint curation drift.**
  Hints are prose and will fall out of sync with descriptions. The
  smoke asserts word count and shape, not content coherence. A
  lightweight follow-up lint could flag tools whose description
  changed without a hint review — not in this phase's scope.
- **`alwaysLoad` token cost underestimated.**
  Three schemas (`tool_search`, `ask`, `repo_map`) should fit under
  2 KB of initial prompt context. If actual token cost in CC turns out
  higher, narrow the list — the selection is recoverable in a one-line
  diff.
- **Other MCP clients render `_meta` differently.**
  Per MCP spec, they must ignore unknown keys. `GenericClient` emits
  nothing `anthropic/`-namespaced, so non-CC clients see empty
  `_meta` and behave exactly as they do today.

- **Server instructions drift from tool reality.**
  The instructions template names specific tools by name
  (`tool_search`, `ask`, `repo_map`, etc.). If a tool is renamed or
  removed, the instructions rot silently. Mitigation: the slice-7
  smoke asserts every backticked tool name resolves against the live
  MCP-visible tool list.

- **CC truncates instructions at `MAX_MCP_DESCRIPTION_LENGTH`.**
  Currently **2048 chars** (verified at
  `CC/services/mcp/client.ts:218` — same cap applies to both tool
  descriptions and `InitializeResult.instructions`). Target template
  is ~1200 chars, leaving >800 chars of headroom. If the template
  grows past 2048, CC silently truncates with `"… [truncated]"`
  appended. Slice 7 smoke asserts length < 2000 so any growth past
  the safety margin breaks loud before CC truncates.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- `CC/services/mcp/client.ts:1752-1789` — CC's `tools/list` handling
  and `_meta` read path (`anthropic/searchHint` at ~1779,
  `anthropic/alwaysLoad` at ~1785)
- `CC/services/mcp/client.ts:~1157-1166` — `client.getInstructions()`
  read; truncation at `MAX_MCP_DESCRIPTION_LENGTH`
- `CC/constants/prompts.ts:579-603` — `getMcpInstructions` builds
  the `# MCP Server Instructions` prompt block
- `CC/tools/ToolSearchTool/prompt.ts:62` — `isDeferredTool`
  (`alwaysLoad === true` check runs first, before `isMcp`)
- `CC/tools/ToolSearchTool/prompt.ts:114-115` — `formatDeferredToolLine`
  returns `tool.name` only; hints are not rendered in the prompt
- `CC/tools/ToolSearchTool/ToolSearchTool.ts:244` — ToolSearch
  scoring weights (exact part +10/+12, substring +5/+6, full-name
  fallback +3, searchHint +4, description +2)
- `CC/Tool.ts:367-370` — CC's own guidance on searchHint wording
  ("3–10 words, no trailing period")
- `packages/tools/src/tool-definitions.ts` — registration surface
- `services/api/src/mcp.ts:86` — `registerTool` call shape
- `services/api/src/mcp-stdio.ts` — MCP stdio session entry
