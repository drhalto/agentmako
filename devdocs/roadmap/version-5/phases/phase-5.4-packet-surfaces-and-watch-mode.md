# Phase 5.4 Packet Surfaces And Watch Mode

Status: `Complete`

## Purpose

Expose the packet layer cleanly and add explicit refresh/watch behavior.

## Phase Outcome

By the end of `5.4`, workflow packets are cleanly consumable through the main
product surfaces, and selected packets support explicit watch-mode refresh.

## Workstreams

## Shipped Outcome

`5.4` shipped one shared `WorkflowPacketSurface` seam on top of the existing
packet layer.

That surface now exists in four concrete product paths:

- built-in `workflow_packet` tool for tool/MCP generation
- direct API generation route and service method
- CLI `agentmako workflow packet ...`
- web tool-call rendering via `WorkflowPacketCard`

The surface shape is intentionally shared across those paths:

- `packet`
- `rendered`
- `surfacePlan`
- `watch`

## Workstreams

### A. Surface Strategy

The shipped strategy is:

- tools generate packets now
- prompts/resources are represented intentionally through `surfacePlan`
- prompt/resource-specific registrations are deferred until a later slice

This keeps tools as the real generation surface without pretending every packet
should only ever be consumed through a tool call.

#### MCP-native bindings shipped in this phase

`workflow_packet` (and the other MCP-visible registry tools) now carry the
MCP SDK's native tool-annotation hints:

- `readOnlyHint: true` — no side effects
- `openWorldHint: false` — the tool's domain is a closed indexed project,
  not an open world of external entities
- top-level tool `title` is set separately from `annotations.title` so SDK v2
  clients read the display name from the right slot

`idempotentHint` is intentionally not set on read-only tools because the MCP
spec defines it as meaningful only when `readOnlyHint == false`. Read-only
already implies no additional effect on repeated calls.

#### SDK patterns the deferred prompt/resource slice should use

When prompts/resources actually register, they should follow the MCP SDK's
canonical shapes instead of inventing custom ones. Named here so 5.5+ does
not re-derive them:

- **`ResourceTemplate('workflow-packet://{projectId}/{packetId}', ...)`**
  for packet-as-resource reads. `stablePacketId` is already the content-hashed
  anchor such a template would cite, so this is the natural pairing for
  `surfacePlan.reusableContext: "resource"`.
- **`registerPrompt` with `argsSchema`** returning
  `{ messages: [{ role, content: { type: "text", text } }] }` that wraps the
  rendered packet. This is what `surfacePlan.guidedConsumption: "prompt"`
  should compile into.
- **`completable(schema, () => suggestions)`** for `family`, `queryKind`,
  `queryText` autocomplete on registered prompts.
- **Capabilities expansion.** Today the server declares
  `{ capabilities: { tools: {} } }`. When prompt/resource registrations
  land, the capabilities object must grow `prompts: {}` and
  `resources: { subscribe: true, listChanged: true }` so clients negotiate
  the right surfaces.
- **`resource_link` content items** as the zero-cost bridge between
  tool-now and resource-later. A tool result can include
  `{ type: "resource_link", uri: "workflow-packet://...", name, mimeType }`
  alongside `structuredContent` without needing a resource handler to exist
  yet. Clients that understand resource links surface them; others ignore
  them.
- **`notifications/resources/updated`** after `resources/subscribe` is the
  MCP-native watch primitive. Once packets are addressable resources, the
  server emits an updated notification whenever `stablePacketId` changes
  for a subscribed URI — no poll, no daemon. That replaces the manual
  `refreshReason: "watch_refresh"` threading the current contract documents.

### B. CLI/API/MCP/Web Consumption

Packets are now readable and useful from:

- CLI
- API
- MCP
- web

The CLI surface supports both kind-based and id-based focus narrowing:

- `--focus-kind file,symbol`
- `--focus-item item_a,item_b`

### C. Watch Mode

`5.4` shipped opt-in watch metadata instead of a background loop.

The shipped watch behavior:

- is opt-in through `watchMode: "watch"`
- reuses the same packet contracts
- exposes `refreshReason`
- exposes `refreshTriggers`
- keeps one `stablePacketId` field on the surface
- does not require a daemon or autonomous scheduler

`stablePacketId` is derived from normalized workflow context rather than raw
packet ids, so repeated identical watch calls stay stable even when the
underlying answer run generates fresh query ids, action ids, or additional
same-target trust-history bookkeeping.

Current refresh reasons:

- `initial`
- `manual`
- `watch_refresh`

`watch_refresh` is caller-threaded rather than auto-derived inside the shared
surface helper. The surface layer is intentionally stateless in `5.4`; later
watch wrappers can pass refresh reasons forward explicitly.

## Verification

- `test/smoke/workflow-packet-surfaces.ts`
- `test/smoke/workflow-packet-generators.ts`
- `test/smoke/workflow-packets.ts`
- typecheck clean
- API/tool surface contract parity verified at the shape level
- at least one packet family proves tool/prompt/resource separation is intentional through `surfacePlan`

## Non-Goals

- no CI/hook automation dependency
- no background daemon requirement

## Exit State

Packets are no longer just internal objects; they are first-class product
surfaces and can refresh intentionally while the user is working.

What remains intentionally deferred (with the SDK shape each should take when
it lands — see `Workstream A → SDK patterns the deferred prompt/resource slice
should use`):

- prompt/resource registration as separate MCP surfaces
  (`ResourceTemplate` + `registerPrompt` with `completable()`; capabilities
  extended to `{ tools, prompts, resources: { subscribe, listChanged } }`)
- packet-specific watch executors beyond explicit refresh metadata
  (`resources/subscribe` + `notifications/resources/updated` keyed by
  `stablePacketId`)
- any CI/hook wrapper work from `5.5`
