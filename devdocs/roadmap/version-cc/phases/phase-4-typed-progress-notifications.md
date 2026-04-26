# Phase 4 CC — Typed Progress Notifications

Status: `Complete`

## Implementation Notes

Phase 4 shipped the progress path without changing any tool input or
output schema. `ProgressReporter.report()` is typed as
`void | Promise<void>`: no-op and direct-capture reporters can stay
sync, while MCP reporters await `extra.sendNotification` so progress
frames are flushed before the final `tools/call` result. Emission
failures are still swallowed and logged.

The shipped MCP shape is the MCP-spec baseline:
`{ progressToken, progress, total?, message? }`. The typed stage is
preserved in `message` as `<stage>: <detail>` because MCP progress
params do not have a dedicated `stage` field. Future client adapters
can alter this through `AgentClient.progressShape` without touching
tool code.

Completed coverage:

- `review_bundle_artifact`: `impact`, `diagnostics`, `composing`
- `verification_bundle_artifact`: `verification_plan`,
  `trust_state`, `tenant_audit`, `composing`
- `tenant_leak_audit`: `table_iteration`, `finding_collect`
- `investigate`: one event per executed sub-tool; message includes
  the current sub-tool name

Smokes:

- `test/smoke/progress-reporter-basic.ts`
- `test/smoke/mcp-progress-notifications.ts`

## Deployment Observation

Multi-stage mako tools routinely take 2–10 seconds on real projects.
The answer loop composes evidence; `review_bundle_artifact` pulls
diagnostics + impact + operator findings; `verification_bundle_artifact`
reruns trust state + tenant audit; `tenant_leak_audit` scans every
protected table. None of them emit any intermediate signal.

Claude Code's side of this is `CC/services/mcp/client.ts:3054-3070` —
a 30-second progress interval logs `"still running (Xs elapsed)"` to
debug logs. Useful for survival; useless for the user watching a
spinner or the agent trying to decide whether to keep waiting.

CC also supports receiving typed progress via MCP
`notifications/progress` (MCP spec §Progress Notifications;
`CC/services/mcp/client.ts:~1846-1895` registers a `progressToken` on
the outgoing request and wires incoming progress to `onProgress({
type: 'mcp_progress', status, serverName, toolName, elapsedTimeMs })`).
Mako emits zero progress notifications today. There is no wiring
between mako's multi-stage tool implementations and the MCP transport
layer.

While we're in this plumbing: CC also sends `_meta` *to* the MCP
server on every `tools/call`, currently carrying `{ 'claudecode/toolUseId': toolUseId }`
(`services/mcp/client.ts:~1842-1844`). That's the reverse direction
of Phase 1's `anthropic/*` namespacing. Phase 4 does not consume this,
but `AgentClient` extends naturally to expose incoming per-call meta
if a future phase wants tool-use-ID-scoped telemetry (e.g. tying
Phase 8's `agent_feedback` event back to a specific CC tool invocation).
Left as a note, not wired here.

The concrete scenario this unblocks: an agent invokes
`review_bundle_artifact` on a medium-sized project. Today the call
just blocks for 4–6 seconds. With progress notifications, CC's UI can
show "indexing → linting → composing review bundle" and the agent
has a visible timeline. No behavior change; all upside.

## Goal

Ship a typed `ProgressReporter` in `packages/tools/src` that multi-
stage tools invoke at natural stage boundaries. The reporter emits
MCP `notifications/progress` frames through the SDK tool-call
handler's `extra.sendNotification` when `extra._meta.progressToken`
is present, shaped via the `AgentClient` adapter from Phase 1 so CC
gets the frame shape it expects and generic clients get
MCP-spec-baseline.

Wire the reporter into the 4–5 tools that actually take long enough
for progress to matter: `review_bundle_artifact`,
`verification_bundle_artifact`, `tenant_leak_audit`, heavy
`investigate` runs, and (optionally) the answer loop itself.

## Hard Decisions

- **Progress is opt-in per tool, not a runtime wrapper.**
  A tool decides what its natural stages are and invokes the
  reporter explicitly. No magic timer-based heartbeat — the tool
  knows better than the harness which boundaries are meaningful.

- **Stages are named, not percentaged.**
  `progressReporter.stage("indexing")` is more useful than
  `progressReporter.progress(0.3)`. The agent (and CC's UI) can
  render stage names directly. Optional `{ current, total }` pair
  for tools that naturally iterate (e.g. "3 of 8 files scanned").

- **Progress routing goes through the `AgentClient` adapter.**
  `AgentClient` gains a `progressShape(event): unknown` method.
  `ClaudeCodeClient` emits MCP-spec
  `notifications/progress` frames (which is what CC expects).
  `GenericAgentClient` emits the same spec shape — no client-
  specific extras. If a future adapter wants to add `_meta` onto
  progress frames, that's the extension point.

- **Reporter is threadable through `ToolServiceOptions`, not
  global state.**
  `ToolServiceOptions.progressReporter?: ProgressReporter`.
  `withProjectContext` and the tool `execute` function receive the
  reporter via context. Unit-level tools (via direct `invokeTool`
  in smokes) can pass a no-op or capturing reporter.

- **Emit failures never throw.**
  Mirrors the runtime-telemetry emitter pattern. A progress
  emission that fails (transport closed, client disconnected) is
  logged but never thrown. Tools keep running.

- **No progress for fast tools.**
  Tools that reliably return under ~500 ms don't instrument. The
  cost of emitting a notification is small but non-zero, and
  cluttering CC's progress stream with sub-half-second tools
  dilutes the signal for tools where it matters.

## Scope In

- new `ProgressReporter` interface in
  `packages/tools/src/progress/index.ts`
- extend `AgentClient` (Phase 1) with
  `progressShape(event: ProgressEvent): unknown`
- extend `ToolServiceOptions` with optional `progressReporter`
- implement reporter factory that emits through the MCP server's
  tool-call `extra.sendNotification` callback (via the session's
  active `AgentClient`)
- wire the reporter into:
  - `review_bundle_artifact` (stages: `impact`, `diagnostics`,
    `composing`)
  - `verification_bundle_artifact` (stages: `verification_plan`,
    `trust_state`, `tenant_audit`, `composing`)
  - `tenant_leak_audit` (stages: `table_iteration`, `finding_collect`)
  - `investigate` (stages: one per sub-tool in the chain)
- smoke: `test/smoke/mcp-progress-notifications.ts` intercepts MCP
  notifications during a `review_bundle_artifact` call; asserts
  stages fire in order; asserts no emission failures block the
  tool
- optional: connect the reporter into `runAnswerPacket` (answer
  loop) — separate slice, can defer

## Scope Out

- streaming partial results (different feature; tools still return
  one final response)
- progress for every tool (only for multi-stage tools that take
  real time)
- UI changes in any downstream client — emission only
- rate limiting or debouncing — emit at natural boundaries; if a
  tool has too many stages, that's a tool problem

## Architecture Boundary

### Owns

- `packages/tools/src/progress/` (new directory)
- `packages/tools/src/agent-clients/claude-code.ts` — add
  `progressShape`
- `packages/tools/src/agent-clients/generic.ts` — add
  `progressShape`
- `packages/tools/src/runtime.ts` — extend `ToolServiceOptions`
- `services/api/src/mcp.ts` — build the reporter from the tool-call
  handler's `extra` object and thread it into `callTool`
- affected tool implementations listed above
- `test/smoke/mcp-progress-notifications.ts` (new)

### Does Not Own

- any tool's input / output schema
- fast tools (answer loop's primary path, most graph / db tools)
- the underlying MCP transport — we emit through the SDK-provided
  request handler callback, not by reaching into the transport

## Contracts

### `ProgressEvent`

```ts
// packages/tools/src/progress/types.ts
export interface ProgressEvent {
  /** Named stage — what the tool is working on right now. */
  stage: string;
  /** Human-readable message (optional but encouraged). */
  message?: string;
  /** For naturally-iterating stages: current / total. */
  current?: number;
  total?: number;
}
```

### `ProgressReporter`

```ts
// packages/tools/src/progress/types.ts
export interface ProgressReporter {
  /** Emit a progress event. Never throws; failures are logged. */
  report(event: ProgressEvent): void | Promise<void>;
}

/** No-op reporter for tests + non-MCP invocation paths. */
export const NOOP_PROGRESS_REPORTER: ProgressReporter;

/**
 * Build a reporter that routes through the SDK tool-call handler's
 * notification callback, shaping frames via the current session's
 * `AgentClient`.
 */
export function createMcpProgressReporter(options: {
  sendNotification: (notification: unknown) => Promise<void> | void;
  progressToken: string | number;
  client: AgentClient;
  logger?: (msg: string, err?: unknown) => void;
}): ProgressReporter;
```

### `AgentClient.progressShape`

```ts
// packages/tools/src/agent-clients/types.ts
export interface AgentClient {
  // ...existing fields
  /**
   * Return the frame payload to include in the MCP
   * `notifications/progress` notification. Default: MCP-spec shape
   * (`{ progress, total?, message? }`). CC adapter may add
   * `_meta` or other extensions here.
   */
  progressShape(event: ProgressEvent): unknown;
}
```

## Execution Flow (slices)

1. **Reporter infrastructure** — create
   `packages/tools/src/progress/` with `types.ts`, a `NOOP_PROGRESS_REPORTER`,
   and `createMcpProgressReporter`. Extend `AgentClient` with
   `progressShape`. Default implementation on both adapters emits
   MCP-spec baseline. Smoke: reporter swallows emission failures.
2. **Runtime plumbing** — add `progressReporter` to
   `ToolServiceOptions`. `services/api/src/mcp.ts` builds a reporter
   when the SDK tool-call handler's `extra._meta.progressToken`
   exists; otherwise uses the noop.
3. **Wire `review_bundle_artifact`** — emit stages: `impact`,
   `diagnostics`, `composing`. Smoke with a capturing reporter
   asserts all three fire in order.
4. **Wire `verification_bundle_artifact` + `tenant_leak_audit`** —
   same pattern, stages documented in scope.
5. **Wire `investigate`** — emit one stage per sub-tool in the
   bounded chain. Progress event's `message` includes the current
   sub-tool name.
6. **End-to-end smoke** — spawn MCP server, issue a tool call with
   a `progressToken`, collect the `notifications/progress` frames,
   assert stages + order. Separate variant: tool call without a
   token; assert no notifications emitted.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/tools/src/progress/types.ts`
- `packages/tools/src/progress/mcp-reporter.ts`
- `packages/tools/src/progress/noop.ts`
- `packages/tools/src/progress/index.ts`
- `test/smoke/progress-reporter-basic.ts`
- `test/smoke/mcp-progress-notifications.ts`

Modify:

- `packages/tools/src/agent-clients/types.ts` — add
  `progressShape`
- `packages/tools/src/agent-clients/claude-code.ts` — implement
  `progressShape`
- `packages/tools/src/agent-clients/generic.ts` — implement
  `progressShape`
- `packages/tools/src/runtime.ts` — extend `ToolServiceOptions`
- `services/api/src/mcp.ts` — build reporter per call
- `packages/tools/src/artifacts/index.ts` — instrument
  review_bundle, verification_bundle
- `packages/tools/src/operators/index.ts` — instrument
  tenant_leak_audit
- `packages/tools/src/investigation/index.ts` — instrument
  investigate chain
- `package.json` — register smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Added`

Keep unchanged:

- every tool input / output schema
- fast tools (no progress instrumentation)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `progress-reporter-basic.ts`: noop reporter safely drops every
  event; capturing reporter records every event; emit-failure
  doesn't throw out of `report()`.
- `mcp-progress-notifications.ts`: spawn `agentmako mcp`, issue a
  `review_bundle_artifact` call with a `progressToken`, collect
  `notifications/progress` frames from the JSON-RPC stream. Assert
  `impact` fires before `diagnostics` fires before `composing`;
  final tool response arrives after the last progress frame.
- repeat without a `progressToken`: zero progress frames; tool
  response identical.
- existing artifact smokes (`artifact-generators.ts`) still pass.

## Done When

- `ProgressReporter` + `createMcpProgressReporter` shipped
- `AgentClient.progressShape` implemented on both adapters
- 4 tools instrumented (review_bundle, verification_bundle,
  tenant_leak_audit, investigate)
- both smokes green; existing artifact smokes green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **CC's progress format has quirks at the MCP SDK version level.**
  The MCP spec's `notifications/progress` shape has evolved; some
  SDK versions treat `progress` as a monotonic counter, others
  accept a floating-point `0..1`. Slice 1 verifies the exact
  shape the installed SDK expects before any tool wires up.
- **Progress emitted after tool response is dropped by CC.**
  If a tool emits a final "done" progress event *after* its
  response, CC may ignore it. Implementation emits all progress
  strictly before the return value, never after.
- **Instrumentation creep.**
  Every future multi-stage tool will want progress. Fine. Resist
  adding progress to fast tools (< 500 ms) — the noise outweighs
  the signal.
- **Reporter scope leaks across parallel tool calls.**
  If two concurrent tool calls share a reporter, their progress
  frames interleave in CC's notification stream. MCP's
  `progressToken` is the disambiguator — every
  `createMcpProgressReporter` binds to exactly one token. Verify
  in the concurrency smoke (cross-phase with Phase 2).

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [./phase-1-tool-discoverability.md](./phase-1-tool-discoverability.md)
  — `AgentClient` adapter the progress shape routes through
- `CC/services/mcp/client.ts:~1846-1895` — progress token
  registration + delivery (`mcp_progress` event shape)
- `CC/services/mcp/client.ts:~1842-1844` — reverse-direction
  `claudecode/toolUseId` meta sent TO the MCP server on each
  `tools/call`
- `CC/services/mcp/client.ts:~3053-3065` — CC's 30s default
  heartbeat (what we're replacing)
- `packages/tools/src/runtime-telemetry/emit.ts` — emission-
  swallowing pattern to mirror
