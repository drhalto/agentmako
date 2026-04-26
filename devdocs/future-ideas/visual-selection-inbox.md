# Visual Selection Router

Status: `Future idea`

This note scopes a possible click-to-prompt surface for `mako-ai`.

It is not active roadmap work yet.

The original name was "Visual Selection Inbox". The inbox is still the durable
substrate, but the product shape should be a router: capture a visual task once,
store it, then deliver it to the right execution target.

## Intent

Let a user open their app in a local dev server, point at a broken or confusing element, attach a prompt such as "fix this spacing", "why is this disabled?", or "make this mobile-safe", and have that UI task reach the coding agent that should act on it.

Concrete example:

- user opens their app on a local dev URL such as `http://localhost:3000` or `http://localhost:5173`
- user clicks a toolbar icon
- user types `remove this`
- mako stores the visual task, then either sends it to an active mako harness session, leaves it for the current external agent to pull through MCP, or holds it as a draft for review

The picker is not the thing that edits code. It captures user intent plus UI evidence so an execution target can make the right code change.

The product value is simple:

- less prose from the user
- faster UI debugging and polish work
- works with mako's own harness agent and external agents like Claude Code, Codex, OpenCode, or a raw MCP client
- stays local-first

This is not specific to Next.js or port 3000. The target is any local dev app mako can safely recognize as a development origin.

## User Flow

1. user runs their app locally and runs `mako-ai`
2. user enables a dev-only picker in the app
3. user arms the picker, clicks an element, and types a prompt such as `remove this`
4. user chooses a delivery target, or mako uses their default target
5. the browser sends the captured element context to mako
6. mako stores it in the attached project's `project.db`
7. mako routes the stored task:
   - auto-send to an active mako harness session
   - queue for an external agent to pull through MCP
   - hold as a draft/review item in the web UI
   - later: dispatch to a headless agent runner adapter
8. the target agent uses the selector, DOM snippet, text, and optional source hint to explain or fix the issue in code

The important product distinction: the scoped inbox is implementation substrate,
not the only user-facing behavior. Pull-model is still valuable for external
agents, but auto-send to mako should be possible when a harness session is the
chosen target.

## Core Idea

Four pieces:

- a dev-only picker asset or helper the user adds to their app
- a per-project visual task table in `project.db`
- routing policy for delivery targets
- one or more target adapters

The picker should be useful even when source mapping is absent. The database row
is the durable handoff boundary. Routing is policy layered above that row.

Initial delivery targets:

- `mako-session`: format the visual task and post it to an active harness session
- `external-inbox`: leave it pending for `visual_selection_pull(limit?)`
- `draft`: store it without sending so the user can review it later

Future delivery targets:

- `headless-codex`
- `headless-claude-code`
- `headless-opencode`

Those future targets imply an agent-runner adapter layer with process lifecycle,
auth, streaming output, approvals, cancellation, and workspace locking. Do not
make that a prerequisite for the first useful version.

## Non-Goals

- the picker does not directly mutate source files
- mako does not silently remove or rewrite UI on its own
- the browser snippet is not a replacement for the external coding agent
- v1 does not need to launch or supervise headless Codex / Claude Code / OpenCode

The feature is a precision handoff layer for UI-directed prompts.

## Design Principles

- project-scoped, not harness-only
- dev-only, never production-facing
- useful without screenshots
- useful without framework-specific source hints
- explicit delivery semantics
- routing should be visible and reversible enough that accidental clicks are not catastrophic
- secure by default on loopback
- minimal runtime footprint in the target app

## Confirmed Design Choices

- target agent can be mako's internal harness, an external MCP agent, or a later headless runner
- capture happens from the running dev app, not from a browser extension or bookmarklet
- first cut is DOM-context-first, not screenshot-first
- source hints are optional enrichment, not a requirement for the feature to work
- every captured task should be stored before any delivery attempt
- auto-send is allowed, but it must be explicit via a target choice or saved preference

## Minimum Scope

At minimum:

- dev-only picker asset served by the API server, e.g. `GET /inspector.js`
- one-line install, e.g. `<script src="..." data-mako-project="..."></script>`
- `Alt+Click` armed picker with overlay and small prompt popup
- token-mint route for the picker
- `POST /api/v1/visual-selections` ingestion route
- per-project SQLite inbox table in `project.db`
- delivery target in the submitted payload or a server-side project/user preference
- mako-session delivery path that formats the selection and calls the existing harness message path when a session is active
- one MCP tool, `visual_selection_pull(limit?)`
- basic `apps/web` receipt surface or toast so the user can tell whether the click was stored, sent, or queued

Do not require screenshots, iframes, embedded browsers, or browser extensions for the first useful version.

## Routing And Delivery Semantics

V1 should be simple and explicit:

- mako always writes the visual task row first
- `mako-session` delivery formats a normal text prompt and posts it to `POST /api/v1/sessions/:id/messages`
- `external-inbox` delivery leaves the row pending for `visual_selection_pull(limit?)`
- `draft` delivery stores the row without sending or claiming it
- `visual_selection_pull(limit?)` reads pending rows for the active MCP session's project and marks those rows claimed in the same database transaction
- external-agent delivery is therefore simple `read-and-claim`, with at-most-once semantics

Do not promise "claim only after the caller definitely received the payload". MCP/HTTP cannot prove that. If that guarantee matters later, add a lease-plus-ack flow in a later phase.

If a mako session is already running a turn, v1 should either reject auto-send
with a clear "turn in flight" status or store as `draft` / `external-inbox`.
Do not silently append to an active turn.

## Security Model

This feature should not rely on "valid attached project id" alone.

V1 should require all of:

- loopback-only mako API host
- explicit allowlist for dev origins, or loopback-only origins by default
- short-lived token minted by mako and bound to `projectId`, request origin, and expiry
- token echoed back on `POST /api/v1/visual-selections`
- no cookie-based auth requirement

Optional belt-and-braces behavior:

- picker refuses to start on obviously non-dev hostnames unless explicitly overridden

## Captured Fields

Per click:

- `projectId`
- `pageUrl`
- `pageTitle`
- `viewport` as `{ w, h, dpr }`
- `selector` as a stable CSS path using `nth-of-type` when needed
- `outerHtml` trimmed to a reasonable cap, e.g. ~4 KB
- `textContent` trimmed to a reasonable cap, e.g. ~1 KB
- `boundingRect` as `{ x, y, w, h }`
- `prompt`
- `sourceHint` optional as `{ framework, file, line, column }`
- `deliveryTarget` as `mako-session | external-inbox | draft`
- `sessionId` optional, required only for `mako-session`

Server-generated fields:

- `id`
- `createdAt`
- `deliveryStatus`
- `deliveredAt`
- `deliveryError`
- `claimedAt`
- optional `claimSessionId` for debugging and auditability

## Source Hints

Source hints should be optional and adapter-driven.

V1 source-hint rule:

1. read `data-source-file`, `data-source-line`, `data-source-column`, and optional `data-source-framework` from the clicked node or ancestors
2. stop at the first valid hit
3. if absent, return no source hint

Do not make React, Vue, or Svelte internals part of the base picker contract.

That means:

- no React fiber or `_debugSource` dependency in the core design
- no server-side guessing of source locations
- no assumption that framework internals are stable enough for v1

Framework-specific enrichment can come later through opt-in dev adapters that stamp `data-source-*` attributes into the DOM.

## Candidate Table

In `project.db`:

- `visual_selections`
  - `id`
  - `page_url`
  - `page_title`
  - `viewport_json`
  - `selector`
  - `outer_html`
  - `text_content`
  - `bounding_rect_json`
  - `source_hint_json`
  - `prompt`
  - `delivery_target`
  - `delivery_status`
  - `delivery_error`
  - `target_session_id` nullable
  - `created_at`
  - `delivered_at`
  - `claimed_at`
  - `claim_session_id` nullable
- index: `(delivery_target, delivery_status, created_at)` for queued work
- index: `(claimed_at, created_at)` for fast MCP pending lookup

No second database. No global queue. Visual selections are always tied to one attached project.

## Product Surface

Picker target options:

- `Send to Mako`
- `Queue for external agent`
- `Save draft`

Settings:

- default delivery target per project
- optional "auto-send last target" toggle
- active mako session picker when `Send to Mako` is selected

Mako-session delivery:

- formats the visual task into a normal user message
- sends through the existing harness message route
- records success/failure on the visual task row

MCP tool:

- `visual_selection_pull(limit?)`
  - resolves the active project from the MCP session
  - returns pending selections for that project
  - marks them claimed in the same transaction

Expected agent behavior:

- agent notices the tool and calls it when the user likely selected something in the running app
- agent receives prompts like `remove this`, `align this with the button below`, or `why is this disabled?`
- agent maps the selection back to code using DOM evidence and any available source hint
- agent makes the code change through its normal filesystem or action tools

Optional later:

- `visual_selection_peek` for debugging
- `apps/web` pane showing recent selections so the user can confirm mako received the click
- headless agent runner targets such as Codex or Claude Code

The tool description matters. It should make clear that this is for "recent UI elements the user explicitly selected in their running app".

## Prompt Formatting

Mako-session and headless-runner delivery should send a plain text prompt,
not a new harness message part kind in v1.

Example:

```text
The user selected a UI element and asked: "remove this"

Page: http://localhost:5173/settings
Selector: main > div:nth-of-type(2) > button
Element text: "Export"
Element HTML:
<button class="...">Export</button>

Source hint:
src/components/SettingsToolbar.tsx:42

Please make the requested UI change. Prefer the source hint if valid; otherwise use the selector, HTML, and text to locate the source.
```

Keep the formatted prompt deterministic and bounded. Truncate `outerHtml`,
`textContent`, and parent context before storing and before sending.

## Headless Agent Runner

A future headless runner is plausible, but it is a separate layer from visual
capture.

Runner responsibilities:

- launch or connect to Codex / Claude Code / OpenCode
- bind to a project root and active model/auth context
- stream logs and final output back into mako
- enforce permissions and workspace locking
- handle cancellation and process cleanup
- record diffs, tool calls, and failures

Do not block the visual selection substrate on this. The substrate should be
usable by mako-session delivery and MCP pull first.

## Strong Constraints

- do not ship the picker as anything other than a dev-only asset or helper
- do not accept selections without a valid attached `projectId`
- do not rely on wildcard CORS alone for protection
- do not add a second database
- do not make this a harness-only feature
- do not guess element identity server-side
- do not require source hints for the feature to be useful
- do not auto-send unless the user selected that target or enabled an explicit preference
- do not skip persistence when delivery succeeds; the row is the audit trail and retry record

## Suggested Phasing

1. Visual task substrate
   - migration, store API, JS asset route carve-out, token route, POST route, picker
   - capture target/delivery metadata but allow `draft` only if needed to ship safely
2. Mako-session and MCP delivery
   - formatter, session auto-send path, delivery status writes, MCP pull tool
   - simple transactional read-and-claim semantics for external agents
3. Source adapters
   - documented `data-source-*` contract
   - examples or helpers for React, Vue, and Svelte dev builds
4. Confirmation UI
   - recent selections pane in `apps/web`
   - polling or a dedicated project-scoped stream if needed
5. Fidelity upgrades
   - optional screenshot crop
   - optional lease-plus-ack delivery
   - optional Playwright-driven picker for users who do not want to edit their dev build
6. Headless runner adapters
   - Codex / Claude Code / OpenCode adapter contracts
   - process lifecycle, streaming, cancellation, approvals, and diff capture

## Open Questions

- should the picker stay as a static asset only, or also ship as an npm helper for easier framework integration?
- is project-scoped queueing sufficient, or does this eventually need session-scoped queueing?
- is simple read-and-claim good enough, or will multi-agent users need lease-plus-ack sooner?
- should the picker refuse to run unless the page hostname looks local?
- should mako define a tiny standard for `data-source-*` attributes so adapters across frameworks look the same?
- should `Send to Mako` be the default when an active harness session exists?
- should auto-send queue behind an active turn, or should it always fall back to draft?
- what is the minimum runner contract before headless Codex / Claude Code is worth exposing?
