# Phase 3.5 Web UI Alpha

Status: `Complete`

This file is the canonical planning record for Roadmap 3 Phase 3.5, reconciled with the substrate Phases 3.0–3.4 actually shipped. A closing `Deviations From Spec At Ship Time` section will be added when the phase ships.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.5.

## Prerequisites

Phase 3.5 requires Phases 3.0–3.4 complete:

- Harness core, `harness_*` session persistence, `SessionEventBus` + SSE transport.
- BYOK provider layer with ai SDK and fallback chains.
- Action tools with declarative permissions, dry-run previews, snapshot-backed undo.
- Embedding provider axis and memory tools (for the optional memory panel).
- Sub-agents, compaction, and resume (for resume UX and archived-turn rendering).

## Goal

Replace the current minimal `apps/web` (a plain-TS API client plus static `public/` assets, self-served by `serve.mjs` on port 4173) with a real React browser client that drives the harness entirely over the HTTP + SSE transport, rendering a single-pane chat, streaming deltas, an approval modal with unified-diff preview, a session list, and a read-only project file tree — and ship a Playwright golden-path test that replaces the existing `test/smoke/web-golden-path.ts`.

## Hard Decisions

- The web client is an alpha, not a public product in this roadmap. It ships to prove transport parity: every capability that exists in the CLI must be reachable in the web UI through the same HTTP routes. No new harness routes are added for the web UI that do not also serve the CLI.
- Framework: React + Vite. Tailwind for styling. React Query (`@tanstack/react-query`) for server state. `react-markdown` + `prism-react-renderer` for assistant rendering. `react-diff-viewer-continued` (or a thin custom diff) for approval previews. Zustand (or plain React context) for UI-only state — if the client state fits cleanly in Query + context, drop Zustand to keep the dep count minimal.
- **Transport is SSE + REST only.** The Phase 3.5 spec originally listed WebSocket for approvals/cancel; shipped `services/harness` uses raw `node:http` with SSE and does not implement WS. Adding WS would be new-scope work with its own risks (framework coupling, reconnect semantics, origin checks). Phase 3.5 instead uses the already-shipped REST approve/deny path (`POST /api/v1/sessions/:id/permissions/requests/:requestId`). Cancel is likewise REST-driven (e.g. a future `DELETE /api/v1/sessions/:id/current-turn` — see Scope In).
- The client never imports `harness-core` or `harness-tools`. `harness-contracts` exports the zod types we need; the client either consumes them through workspace-dep resolution (`@mako-ai/harness-contracts`) or a lightweight `apps/web/src/api-types.ts` barrel re-export. No generator script is required — the shapes are already TypeScript.
- The client loads project context only through HTTP; no filesystem access from the browser.
- Authentication: localhost-only, same-origin. Default binding stays `127.0.0.1`. CORS allowlist matches the existing `services/harness` origin check (see `server.ts:isLoopback`).
- The existing `apps/web/scripts/{copy-static,serve}.mjs` and `apps/web/src/index.ts` (static-fallback client) are deleted in 3.5. Production serving moves to Vite's `build` output at `apps/web/dist/` and either (a) a rewritten `serve.mjs` that static-serves Vite output on port 4173, or (b) a static-mount in `services/harness` behind the existing origin check. Final call at implementation time — prefer (a) to keep harness service scoped to API responsibilities.

## Why This Phase Exists

The transport-agnostic core promise only pays off when a non-terminal client proves it works. Every design decision in Phases 3.0 through 3.4 — events, streaming, approval flow, permission requests, sub-agents, resume — was made to be renderable by any UI. Phase 3.5 verifies that.

It also unlocks the long-term product goal: a web-based code-editing UI for mako. The alpha in this phase is not the finished product but it is the one that proves the routes, events, and approval model are right. A future roadmap can harden, polish, and ship it publicly.

## Aligning With Shipped Substrate

- **`apps/web` is not a pure static shell.** It has `src/index.ts` (a plain-TS API client against `services/api` on port 3017), `public/{index.html, styles.css, favicon.svg}`, and a `scripts/serve.mjs` that boots a minimal `node:http` static file server on port 4173. Phase 3.5 deletes all of that in favor of Vite + React. Callers that today run `pnpm --filter @mako-ai/web start` must switch to `pnpm --filter @mako-ai/web dev` (Vite dev) or `... build && ... preview`.
- **Two service endpoints to target**: `services/api` on `127.0.0.1:3017` (projects, tools) and `services/harness` on `127.0.0.1:3018` (sessions, tier, providers, permissions, undo, memory, resume). The UI talks to both; it does not pretend the two are one surface.
- **WebSocket transport is not shipped.** See Hard Decisions. Approval responses go through `POST /api/v1/sessions/:id/permissions/requests/:requestId`. Cancel is currently not a route — Phase 3.5 either adds one or documents the absence.
- **Playwright is already set up.** `test/smoke/web-golden-path.ts` exists (from Roadmap 2) and `playwright` + `@playwright/test` are in root devDependencies. Phase 3.5 replaces that file with a real harness-driven golden and adds the two new files under `test/smoke/`.
- **Project awareness comes from `services/api`**, which already surfaces attached projects and their status through `apps/cli/src/commands/project.ts`'s HTTP paths. The web UI consumes those directly — nothing new to build server-side for the Home view.

## Scope In

- Full rewrite of `apps/web`: delete `src/index.ts`, `public/`, and `scripts/{copy-static,serve}.mjs`. Add Vite + React + TS scaffolding under `apps/web/`.
- Pages / views:
  - **Home** — list attached projects (via `services/api`'s existing project endpoints; same ones `apps/cli/src/commands/project.ts` consumes).
  - **Session view** — chat with streaming assistant messages, rendered markdown, code blocks, tool calls shown as collapsible cards. Archived turns (from Phase 3.4 compaction) rendered in a folded "n archived" affordance.
  - **Approval modal** — triggered by `permission.request` events; renders unified-diff for edits, proposed content for writes, command + cwd for shell; buttons map to the existing REST shape: `POST /api/v1/sessions/:id/permissions/requests/:requestId { action: "allow" | "deny", scope: "turn" | "session" | "project" | "global" }`.
  - **Session list** — per-project session index (via `GET /api/v1/sessions?project_id=...`) with resume button (calls `POST /api/v1/sessions/:id/resume` from Phase 3.4).
  - **Project file tree** — read-only, scoped to active project root. Data source: `services/api`'s existing file listing routes.
  - **Providers panel** — read-only view of configured providers and keys status via `GET /api/v1/providers` (no key entry in the UI — keys are env or keychain only).
  - **Tier banner** — persistent indicator of current tier and upgrade hint; consumes the embedding-health-extended `GET /api/v1/tier` response shape Phase 3.3 shipped.
- State management:
  - React Query for session list, messages, providers, rules, tier.
  - A custom hook `useHarnessStream(sessionId, { afterOrdinal })` that opens SSE against `GET /api/v1/sessions/:id/stream?after=<ordinal>` and appends events; auto-reconnects from last seen ordinal on drop.
  - Approval and cancel are plain React Query mutations against the REST endpoints — no WS client required.
- Build pipeline:
  - Vite dev server on `http://localhost:5173`, configured with an API proxy so fetch calls can stay relative (avoids CORS in dev).
  - Production build emits to `apps/web/dist/` (Vite default). `apps/web/package.json`'s `build` script runs Vite; `start` / `preview` either boots `vite preview` or a rewritten `serve.mjs` on port 4173.
- Additive harness routes (Phase 3.5 owns these because the UI is the reason they exist, and they maintain CLI parity):
  - `DELETE /api/v1/sessions/:id/current-turn` — cancel an in-progress turn. Mirrors the `agentmako` CLI's current kill-the-process behavior and makes it an HTTP capability. Optional if cancel is deferred; flagged explicitly in Scope Out otherwise.
- Smoke tests:
  - `test/smoke/web-harness-golden.ts` (Playwright) — full end-to-end: open web UI, create a session against cloud-agent, send a message, receive streaming response, propose a file edit, approve in the modal, assert file is modified, undo. Replaces the existing `test/smoke/web-golden-path.ts` or is added alongside and the old one is deleted.
  - `test/smoke/web-harness-no-agent.ts` — no-agent tier works entirely without providers.
  - `test/smoke/web-harness-resume.ts` — resume a session from the UI after a server restart. Requires Phase 3.4 resume to have shipped.
- Documentation:
  - `apps/web/README.md` rewritten to cover dev, build, serving, and alpha scope.
  - Screenshots optional.

## Scope Out

- Polish beyond functional alpha — no animations, no themes, no accessibility audit, no mobile layouts.
- Key entry in the UI — keys are env or keychain only.
- Multi-user or auth flows — localhost-only.
- Public deployment — the web UI does not ship outside the local machine.
- Investigation composer UI — composers ship in 3.6 as tools; a dedicated composer UX belongs in a later roadmap.
- Collaborative editing, presence, sharing — not in Roadmap 3.

## Architecture Boundary

### Owns

- `apps/web` as a real React + Vite app.
- `apps/web/src/api-types.ts` (thin barrel re-exporting types from `@mako-ai/harness-contracts` and `@mako-ai/contracts`).
- Playwright smoke tests under `test/smoke/web-harness-*.ts`.
- A cancel-turn HTTP route if included in scope (see Scope In).

### Does Not Own

- Any new routes in `services/harness` *purely* for the UI. CLI parity is the acceptance test: if a route is added, the CLI must also consume it (new `agentmako session cancel <id>` command, for example).
- Any code in `packages/harness-core`, `packages/harness-contracts`, `packages/harness-tools`.
- Provider credential entry flows — env and keychain only.
- Running service orchestration — `services/harness` and `services/api` are launched out-of-band by the user (via `agentmako serve` or equivalents).

## Contracts

### Input Contract

- All data flows through existing `services/harness` routes and `services/api` project endpoints.
- SSE consumption of `text.delta`, `tool.call`, `tool.result`, `permission.request`, `permission.decision`, `provider.call`, `turn.done`, `error`, plus the Phase 3.4 additions (`sub_agent.started`, `sub_agent.finished`, `compaction.started`, `compaction.summary_inserted`, `compaction.failed`, `resume.pending_approvals`).
- Approval / deny is a plain REST mutation: `POST /api/v1/sessions/:id/permissions/requests/:requestId { action, scope }` (already shipped in Phase 3.2).
- Cancel is a REST mutation: `DELETE /api/v1/sessions/:id/current-turn` (Phase 3.5 adds if in scope).

### Output Contract

- A functioning browser client that exercises every transport route in real use.
- Playwright smoke tests that prove the transport boundary end-to-end.
- A documented build output under `apps/web/dist/`.

### Error Contract

- UI surfaces provider/model errors from `provider.call { ok: false }` events.
- UI surfaces permission denials with rule source (project / global).
- UI surfaces embedding `fts-fallback` mode on memory recall views.

## Execution Flow

1. Delete `apps/web/src/index.ts`, `apps/web/public/`, and `apps/web/scripts/{copy-static,serve}.mjs`. Replace `apps/web/package.json` and `tsconfig.json` with Vite + React + TS versions.
2. Scaffold the React app tree (`src/main.tsx`, `src/App.tsx`, router).
3. Add `src/api-types.ts` as a thin re-export barrel from `@mako-ai/harness-contracts` and `@mako-ai/contracts`.
4. Implement `useHarnessStream` (SSE with afterOrdinal reconnect). Approval/cancel are Query mutations — no separate WS hook.
5. Implement core views against running `services/api` (3017) and `services/harness` (3018).
6. Implement the approval modal with unified-diff rendering.
7. Implement tier banner (consuming the embedding-health-extended `/tier` response) and providers panel.
8. Write the three Playwright smoke tests under `test/smoke/`; delete the old `test/smoke/web-golden-path.ts` once the new golden is green.
9. Document dev, build, serve, and alpha scope in `apps/web/README.md`.
10. If cancel is in scope: add `DELETE /api/v1/sessions/:id/current-turn` inline handler to `services/harness/src/server.ts` and a matching `agentmako session cancel <id>` CLI subcommand.

## File Plan

Create:

- `apps/web/vite.config.ts`
- `apps/web/index.html` (Vite entry)
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/api-types.ts` (re-exports from workspace deps)
- `apps/web/src/hooks/useHarnessStream.ts`
- `apps/web/src/hooks/useApprove.ts` (Query mutation)
- `apps/web/src/components/ApprovalModal.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/SessionList.tsx`
- `apps/web/src/components/FileTree.tsx`
- `apps/web/src/components/ProvidersPanel.tsx`
- `apps/web/src/components/TierBanner.tsx`
- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Session.tsx`
- `test/smoke/web-harness-golden.ts`
- `test/smoke/web-harness-no-agent.ts`
- `test/smoke/web-harness-resume.ts`

Modify:

- `apps/web/package.json` — replace scripts (`dev`, `build`, `preview`), add React / Vite / Tailwind / React Query / diff-viewer deps.
- `apps/web/tsconfig.json` — Vite-compatible config with `jsx: react-jsx`.
- `apps/web/README.md` — rewrite for Vite + React alpha scope.
- Root `package.json` — keep existing Playwright devDeps; add `test:smoke:web` orchestration if cancel route lands (or keep unchanged otherwise).
- `services/harness/src/server.ts` — add `DELETE /api/v1/sessions/:id/current-turn` inline if cancel is in scope.
- `apps/cli/src/commands/harness.ts` — add `session cancel <id>` if the cancel route lands (CLI-parity rule).
- `apps/cli/src/shared.ts` — `session cancel` in `CLI_COMMANDS` if applicable.

Delete:

- `apps/web/src/index.ts`
- `apps/web/public/` (tree)
- `apps/web/scripts/copy-static.mjs`
- `apps/web/scripts/serve.mjs` (replaced by `vite preview` or a new minimal static server)
- `test/smoke/web-golden-path.ts` (replaced by `web-harness-golden.ts`)

Keep unchanged:

- `services/api` — only its existing project endpoints are consumed.
- `packages/harness-*` packages.
- `services/harness` routes other than the optional cancel endpoint.

## Verification

Required commands:

- `corepack pnpm typecheck` — clean across the workspace.
- `corepack pnpm --filter @mako-ai/web build` — Vite build emits `apps/web/dist/`.
- `corepack pnpm run test:smoke:web` — existing root script wraps the Playwright runner; extended to cover the three new files.

Required runtime checks:

- `apps/web` dev server loads at `http://localhost:5173`.
- Create a session against a cloud-agent provider from the UI; streaming deltas render in real time via SSE; `text.delta` events update the assistant message without flicker.
- Agent proposes `file_edit`; modal renders unified diff from the `permission.request` event's `preview.dryRun` payload; click `allow-turn`; REST call hits `POST /api/v1/sessions/:id/permissions/requests/:requestId { action: "allow", scope: "turn" }`; file is edited; tool result appears; `agentmako undo` from CLI restores cleanly.
- No-agent tier works end-to-end with zero providers configured.
- Kill `services/harness`, restart, click resume in the UI, and confirm identical final state — SSE picks up from the stored ordinal.
- Tier banner reflects embedding-health status from Phase 3.3 (`hybrid` vs. `fts-fallback`).
- If cancel ships: click cancel mid-stream; `DELETE /api/v1/sessions/:id/current-turn` fires; turn ends with a `turn.cancelled` event; UI surfaces it cleanly.
- All three Playwright tests pass.

Required docs checks:

- `apps/web/README.md` clearly marks the UI as alpha and not a public product.
- No new harness routes shipped purely for the UI — every new route has a CLI counterpart.

## Done When

- `apps/web` loads in a browser against a running `services/harness` + `services/api`.
- Streaming chat, approval modal with diff, session list, file tree, providers panel, and tier banner all work.
- No harness route is UI-only (cancel, if added, has an `agentmako session cancel` counterpart).
- The three Playwright smoke tests pass.
- `apps/web/README.md` documents alpha scope.
- The old static `apps/web/src/index.ts` / `public/` / `serve.mjs` are fully deleted; `test/smoke/web-golden-path.ts` is replaced by the new harness-driven version.

## Risks And Watchouts

- **SSE stability over localhost.** Browsers sometimes drop long-lived SSE connections. The UI must auto-reconnect on close, resume from the last seen ordinal via `?after=`, and rely on `harness_session_events` being append-only so replay is free of duplicates.
- **Scope creep.** A working web UI invites feature requests. Resist — this is an alpha to validate transport parity. New UX features belong in a later roadmap.
- **Type drift.** `apps/web/src/api-types.ts` is a barrel over `@mako-ai/harness-contracts` workspace deps, so `pnpm typecheck` catches shape changes automatically. Resist the urge to copy types — re-export them.
- **Tailwind vs. Shadcn vs. raw CSS.** Keep the alpha ugly. Tailwind + minimal components. No component library that adds build complexity.
- **Approval UX.** The approval modal is the most important UX surface in the UI. Test it with both small diffs (one-line change) and large ones (full-file rewrite). Never render more than a screen without scrolling.
- **Dropping the existing static shell.** The current `apps/web/src/index.ts` is used by some documentation and smoke flows; confirm no external consumer imports it before deletion. `@mako-ai/web`'s `package.json` `main` pointer becomes Vite's build output or is dropped entirely (the package is an app, not a library).
- **Serving strategy.** If `vite preview` is sufficient for alpha, skip the custom `serve.mjs` replacement. If the final shape calls for static-mount inside `services/harness`, keep it behind the existing loopback origin check and document the path.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.4-subagents-compaction-resume.md](./phase-3.4-subagents-compaction-resume.md)
- [./phase-3.6-investigation-composers.md](./phase-3.6-investigation-composers.md)

## Deviations From Spec At Ship Time

The sections above describe the shipped state. These are the intentional pivots from the original planning draft.

1. **SSE-only, no WebSocket.** The planning doc specified a `GET /api/v1/sessions/:id/ws` route for bidirectional control. The shipped harness never implemented WS; SSE + REST mutations cover the same capabilities without the framework coupling. `packages/harness-contracts` has no WS schemas, `services/harness` uses raw `node:http`, and the dashboard talks to approvals via `POST /permissions/requests/:id`. This decision is codified in the phase doc's Hard Decisions section.
2. **SSE wire format reshaped.** The original format emitted named events: `id: N\nevent: text.delta\ndata: {...}`. The browser `EventSource` API dispatches named events to per-name listeners, not the default `onmessage`, which broke stream consumption. Switched to an unnamed envelope: `id: N\ndata: { sessionId, ordinal, createdAt, event: { kind, ... } }`. CLI SSE parsers + smoke tests (`apps/cli/src/commands/harness.ts`, `test/smoke/harness-immutability-and-multiturn.ts`) were updated to unwrap the envelope. A minor ship-time fallout: the dashboard's `useHarnessStream` hook handles clean server-side close on `turn.done` by silently reopening from `?after=<lastOrdinal>`, so the UI never flickers "reconnecting" between turns.
3. **User-message `text.delta` is now emitted in the event stream.** Before Phase 3.5, `Harness.postMessage` persisted the user text to `harness_message_parts` but only emitted `message.created(user)` on the bus. A stream-first client (the dashboard) couldn't render the user's message from SSE alone. Fix: emit a `text.delta` carrying the full content right after `message.created(user)`. The reducer short-circuits user-message deltas into a text part (no streamingText accumulation) since user text arrives as one chunk, not token-by-token.
4. **Model picker + custom model id input (scope addition).** The original plan had the new-session button default to a hardcoded provider; users asked for a visible picker. Shipped: a compound `[New session · <model>][▾]` button on the dashboard with a popover listing every chat-capable model per reachable provider, plus a free-text "custom model id" input per provider so any Ollama/LM Studio pull works without a catalog edit. `localStorage` persists the last choice.
5. **Delete sessions from the sidebar + session header (scope addition).** Not in the original plan. Shipped: hover-reveal × on each session row in the left nav, plus a × in the session header. Both confirm via `window.confirm` and redirect home when the active session is the one being deleted. The harness `DELETE /api/v1/sessions/:id` route already existed.
6. **Classic chat layout: user right, assistant left.** Original plan was timeline-agnostic. Ship: user messages right-aligned in a compact `--mk-ridge` bubble with a "YOU" label; assistant messages left-aligned with no bubble (MAKO label + raw text) to preserve the dev-tool aesthetic and contrast the two speakers.
7. **Bigger prompt input (3-line default, breathing room).** The original draft had a 1-line input. Shipped: 3-line autosize minimum, generous padding, bindings hint line (`/` focus · `⌘↵` send · `Esc` blur).
8. **`web-harness-shell.ts` smoke replaces `web-golden-path.ts`.** The legacy Roadmap-2 Playwright smoke exercised the static HTML client that Phase 3.5 deleted. New smoke boots against the live harness + API + Vite dev; skips cleanly if any of the three isn't reachable. Runs as `pnpm test:smoke:web`. Covers dashboard shell, providers page, memory page, and a no-agent send→receive end-to-end.
9. **Read-only file tree deferred to 3.5.x.** The planning document listed a file tree scoped to the active project. Phase 3.5 did NOT ship it because `services/api` exposes no route for enumerating a project's file tree in a single call — current endpoints focus on per-file lookups (`file_find`, `file_imports`, etc.), not directory listings. Adding one requires a new `GET /api/v1/projects/:id/files?prefix=<path>` endpoint backed by the existing indexed file table. Flagged as a 3.5.x follow-up because it's a separable piece of backend work that doesn't block Phase 3.6.
10. **Alpha product surface.** Per Hard Decisions: this is a visual / transport-parity proof, not a hardened product. No public deployment story, no multi-user auth, no IDE/browser extension path. The `apps/web/README.md` calls that out. `services/harness` stays bound to `127.0.0.1` by default and so does Vite.
