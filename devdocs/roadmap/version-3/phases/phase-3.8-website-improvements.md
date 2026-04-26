# Phase 3.8 Website Improvements

Status: `Complete` (shipped 2026-04-17)

This file is the canonical planning doc for Roadmap 3 Phase 3.8. It replaces the stale dashboard draft that was copied into this filename from an earlier 3.5.x idea and never reconciled with the app that actually shipped.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use [../handoff.md](../handoff.md) for the current execution target. Use [./phase-3.5-web-ui-alpha.md](./phase-3.5-web-ui-alpha.md), [./phase-3.5.1-web-ui-qol-and-session-telemetry.md](./phase-3.5.1-web-ui-qol-and-session-telemetry.md), and [./phase-3.7-semantic-retrieval-expansion.md](./phase-3.7-semantic-retrieval-expansion.md) as the shipped substrate this phase builds on.

## Prerequisites

Phase 3.8 requires these earlier phases complete:

- **Phase 3.5 - Web UI Alpha.** React + Vite app, `Shell`, session chat, providers page, memory page, SSE streaming.
- **Phase 3.5.1 - Web UI QoL and Session Telemetry.** Session auto-titles and usage/context telemetry in the session header.
- **Phase 3.6.0 / 3.6.1 - Investigation surfaces.** `AnswerPacketCard`, composer tool results, and the richer tool-result timeline already ship.
- **Phase 3.7 - Semantic Retrieval Expansion.** `semantic_search` and `embeddings reindex` ship through harness-core, HTTP, and CLI, but have no dedicated web surface yet.

If any of those are not in place, this phase should not start.

## Goal

Turn the current web alpha into a real project-aware operator surface by:

- making attached projects first-class instead of treating the first project as "the" project
- exposing 3.7 semantic retrieval and embedding maintenance in the browser
- tightening project scoping across dashboard, sessions, memory, and semantic search
- improving the information architecture without rewriting the transport or inventing speculative backend settings

This is a web product phase, not a backend architecture phase.

One operator-quality requirement is now explicit: the dashboard should present as one browser-facing origin and should not claim the normal Vite default ports used by unrelated local projects.

## Why This Phase Exists

The current web app is functional, but the shipped surface still has three obvious gaps:

- **Dashboard is single-project biased.** [Home.tsx](../../../../apps/web/src/pages/Home.tsx) pulls `projects.data?.[0]` as the primary project and builds most of the page around that one record. Multi-project use is weak even though `services/api` already exposes the attached-project list.
- **3.7 shipped without a web surface.** `GET /api/v1/semantic/search` and `POST /api/v1/embeddings/reindex` exist in [services/harness/src/server.ts](../../../../services/harness/src/server.ts), but there is no browser UI for them.
- **The current 3.8 doc is stale.** It still talks about a 3.5.2 route split to `/code`, references a nonexistent `apps/web/src/routes/` directory, and assumes agent-settings routes that do not exist.

Phase 3.8 exists to fix the website around the app that actually shipped, not around an obsolete draft.

## Aligning With Shipped Substrate

- **Route structure is already simple and real.** [App.tsx](../../../../apps/web/src/App.tsx) ships:
  - `/`
  - `/sessions/:sessionId`
  - `/providers`
  - `/memory`

  There is no `/code` split today, and 3.8 should not invent one unless there is a strong reason.

- **App structure is `App.tsx` + `pages/*`, not `src/routes/`.** The real page entry points live under:
  - [pages/Home.tsx](../../../../apps/web/src/pages/Home.tsx)
  - [pages/Session.tsx](../../../../apps/web/src/pages/Session.tsx)
  - [pages/Providers.tsx](../../../../apps/web/src/pages/Providers.tsx)
  - [pages/Memory.tsx](../../../../apps/web/src/pages/Memory.tsx)

- **Project transport already exists through `services/api`.** The UI can already call:
  - `GET /api/v1/projects`
  - `GET /api/v1/projects/status?ref=...`
  - `POST /api/v1/projects/attach`
  - `POST /api/v1/projects/detach`
  - `POST /api/v1/projects/index`

  These are implemented in [services/api/src/routes/projects.ts](../../../../services/api/src/routes/projects.ts).

- **Harness transport already exists for the new semantic surfaces.** The browser can already call:
  - `GET /api/v1/tier`
  - `GET /api/v1/providers`
  - `GET /api/v1/memory`
  - `GET /api/v1/semantic/search`
  - `POST /api/v1/embeddings/reindex`
  - `GET /api/v1/sessions`
  - `GET /api/v1/sessions/:id`
  - `POST /api/v1/sessions/:id/messages`
  - `GET /api/v1/sessions/:id/stream`

- **Tool-result rendering is already better than the stale doc assumed.** [MessageTimeline.tsx](../../../../apps/web/src/components/MessageTimeline.tsx), [ToolCallCard.tsx](../../../../apps/web/src/components/ToolCallCard.tsx), and [AnswerPacketCard.tsx](../../../../apps/web/src/components/AnswerPacketCard.tsx) already render tool activity and answer/composer packets inline.

- **The current dev front door is still Vite-default-biased.** [apps/web/vite.config.ts](../../../../apps/web/vite.config.ts) hardcodes `127.0.0.1:5173` with `strictPort: true` and proxies `/api/v1/projects`, `/api/v1/tools`, `/api/v1/answers`, and `/api/v1/health` to `services/api` while sending the remaining `/api/v1/*` traffic to `services/harness`. [apps/web/package.json](../../../../apps/web/package.json) hardcodes preview to `4173` with `--strictPort`.

- **That internal split is acceptable.** 3.8 does not need to merge `services/api` and `services/harness` into one backend process. The requirement is one stable browser-facing origin, with proxying behind it if needed.

## Hard Decisions

1. **No `/code` reparenting in 3.8.**
   The shipped app already uses `/` as a dashboard-style home and `/sessions/:id` as the chat workspace. Reparenting everything to `/code/*` would create churn without solving the actual current gap.

2. **No speculative agent-settings page in 3.8.**
   The stale draft proposed embedding / summarizer / router settings, but no such backend config surface ships today. 3.8 should focus on real transport surfaces (`semantic_search`, `embeddings reindex`, attached projects) instead of inventing settings that do not yet map to behavior.

3. **Project scoping becomes explicit across the app.**
   Pages that can scope by project should do so:
   - dashboard session lists
   - memory listing
   - semantic search
   - new-session creation from the dashboard

4. **Reuse existing routes by default.**
   Do not add a new backend dashboard roll-up route unless the existing project list + project status + sessions list prove too chatty in practice. Local tooling can tolerate a few more read requests; speculative aggregation is not the default.

5. **3.8 is an information-architecture and operator-surface phase, not a visual redesign.**
   Keep the current visual language (`Shell`, top bar, monochrome cards, existing typography and tokens). Improve structure and capability before restyling.

6. **One browser-facing port; split backends can remain split.**
   The dashboard should feel like one local app origin. Keeping `services/api` and `services/harness` as separate processes is fine as long as the browser only needs one front door.

7. **Do not force the standard Vite ports.**
   3.8 should stop claiming `5173` / `4173` with `strictPort` by default. Use a mako-specific port or an auto-assigned/configurable port instead.

## Scope In

### 1. Projects-first dashboard

Upgrade the dashboard at `/` so it treats attached projects as the top-level entity instead of centering the first project only.

Build:

- replace the current `primaryProject = projects.data?.[0]` assumption in [Home.tsx](../../../../apps/web/src/pages/Home.tsx)
- render all attached projects as cards or rows
- attach-project affordance in the UI using the existing `POST /api/v1/projects/attach`
- per-project actions:
  - open / focus project
  - re-index
  - detach
- project status visibility from existing project status transport (`status`, `lastIndexedAt`, path, support level)

Result:

- multiple attached projects become a supported browser workflow instead of a hidden API capability

### 2. Project-scoped navigation state

Introduce one explicit project-selection model in the web app and carry it through the surfaces that already support it.

Build:

- selected-project state in the dashboard/shell
- dashboard recent-sessions list scoped to the selected project when one is active
- memory page optionally filtered by `project_id`
- semantic search page optionally filtered by `project_id`
- creating a new session from the dashboard uses the selected project when present

Result:

- the browser behaves like a project-aware console instead of four unrelated pages

### 3. Semantic Search page

Add a dedicated browser surface for the 3.7 retrieval layer.

Build:

- new page at `/search`
- query input
- `kind` filters (`code`, `doc`, `memory`)
- optional project filter tied to the selected project
- result cards showing:
  - kind
  - title
  - file path
  - line range when present
  - excerpt
  - fused score / lexical vs vector signal as appropriate
- mode banner:
  - `hybrid`
  - `fts-fallback`
  - fallback reason when present

Use the shipped `GET /api/v1/semantic/search` route directly. Do not add a second search backend just for the web UI.

### 4. Embeddings maintenance card

Expose the 3.7 maintenance path in the browser.

Build:

- a small operator card on the new semantic-search page or dashboard
- actions:
  - reindex semantic units
  - reindex memories
  - reindex all
- show the last returned counts:
  - scanned
  - embedded
  - skipped
  - failed
  - provider/model used

Use the shipped `POST /api/v1/embeddings/reindex` route directly.

### 5. Shell/navigation polish for the real phase scope

Update the shell to reflect the actual surface area after 3.8.

Build:

- keep the existing `Shell` and `TopBar`
- add navigation entry for semantic search
- make project context visible in the shell or page header
- keep session navigation intact; do not redesign the chat surface as part of this phase

### 6. Single front-door browser origin

Make the local dashboard operationally clean.

Build:

- stop forcing `5173` / `4173` for web dev and preview
- allow a mako-specific configured port or an automatically chosen open port
- keep the browser-facing app on one origin even if it still proxies to `services/api` and `services/harness` underneath
- document the intended local launch story clearly in the 3.8 ship docs

Result:

- the mako dashboard no longer collides with a normal Vite project by default
- operators open one browser origin and do not need to care that two backend services still exist

## Scope Out

- any `/code` route split
- agent settings for summarizer/router/embedding defaults unless a real backend config surface ships first
- full visual redesign, theming pass, animation work, or typography overhaul
- websocket transport
- IDE-style file tree / editor workspace
- deployment, analytics, billing, or team/workspace concepts
- changes to composer contracts or trust-layer work

## Architecture Boundary

### Owns

- `apps/web/src/App.tsx`
- `apps/web/src/components/Shell.tsx`
- `apps/web/src/pages/Home.tsx`
- new web pages/components required for project browsing and semantic search
- web-only state management for selected project and semantic-search filters
- web smoke coverage for the new pages and flows

### Does Not Own

- new speculative configuration models for providers or internal agent settings
- any redesign of `packages/harness-core`
- semantic-retrieval algorithm changes from 3.7
- composer evidence contracts or `AnswerPacket`
- backend route fan-out beyond what is needed for actual web parity

## Execution Flow

1. Reconcile the shell and dashboard with explicit selected-project state.
2. Make the dashboard render all attached projects and wire attach / detach / index actions.
3. Make the local web front door stop forcing the standard Vite ports while preserving the existing proxy split to `services/api` and `services/harness`.
4. Add the semantic-search page using the shipped 3.7 transport surface.
5. Add embeddings-reindex controls to the browser.
6. Extend web smokes to prove project actions and semantic retrieval end to end.

## File Plan

### Modify

- `apps/web/src/App.tsx`
- `apps/web/src/components/Shell.tsx`
- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Memory.tsx`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/vite.config.ts`
- `apps/web/package.json`
- `apps/web/src/api-types.ts`
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md`

### Create

- `apps/web/src/pages/Search.tsx`
- `apps/web/src/components/ProjectCard.tsx`
- `apps/web/src/components/AttachProjectModal.tsx`
- `test/smoke/web-project-dashboard.ts`
- `test/smoke/web-semantic-search.ts`

### Reuse As-Is Unless Forced

- `apps/web/src/components/MessageTimeline.tsx`
- `apps/web/src/components/ToolCallCard.tsx`
- `apps/web/src/components/AnswerPacketCard.tsx`
- `packages/harness-core/src/semantic-search.ts`
- `services/harness/src/server.ts`
- `services/api/src/routes/projects.ts`

## Verification

Required:

- `corepack pnpm run typecheck`
- existing web smoke stays green

New required web smokes:

- `web-project-dashboard`
- `web-semantic-search`

Manual acceptance:

1. Open `/` and see every attached project, not only the first one.
2. Attach a project from the browser.
3. Re-index and detach a project from the browser.
4. Open `/search`, run a semantic query, and see provenance-bearing code/doc/memory hits.
5. Trigger `embeddings reindex` from the browser and see the returned counts.

## Done When

- dashboard is genuinely multi-project
- project selection is coherent across dashboard, memory, sessions, and semantic search
- the browser has a first-class surface for `semantic_search`
- the browser has a first-class surface for `embeddings reindex`
- no stale references to `/code`, `3.5.2`, or `apps/web/src/routes/` remain in the 3.8 planning docs

## Risks And Watchouts

- **Scope creep into backend settings.** If 3.8 starts inventing agent settings without a real config surface, it turns into a backend feature phase.
- **Accidental route churn.** Reparenting routes would create avoidable breakage and should stay out unless there is a strong, concrete reason.
- **Project scoping drift.** If dashboard, memory, and search each invent their own project-selection behavior, the phase will ship with a more confusing app than it started with.
- **UI overreach.** The current web app already works; 3.8 should improve operator workflow, not restart the design system.
- **Confusing one-port with one-process.** The requirement is one browser-facing origin. Merging `services/api` and `services/harness` into one service process is not required for 3.8 and should not become accidental scope.
- **Port conflicts left unresolved.** If 3.8 keeps hard-forcing `5173` / `4173`, the docs and product story stay out of sync with the actual operator experience.

## Deviations From Spec At Ship Time

- **Selected-project state is shell-wide context, not per-page state.** A
  `SelectedProjectProvider` hook in `apps/web/src/hooks/useSelectedProject.tsx`
  owns the active project id, persists it to `localStorage`, and reconciles
  it against the live `/api/v1/projects` list (auto-select the first
  attached project on first load, clear when the stored id is no longer
  attached). `Home`, `Memory`, and `Search` all read from the same hook so
  scope choices survive navigation and a refresh.
- **Per-project actions live on `ProjectCard`, not on a separate
  `ProjectDetail` view.** The dashboard renders one card per attached
  project with a kebab menu carrying "New session here" / "Re-index" /
  "Detach". Re-index hits `POST /api/v1/projects/index`; detach hits
  `POST /api/v1/projects/detach`. There is no project drilldown route in
  3.8.
- **Dashboard layout takes its IA from the Vercel projects board.** The
  page is now a two-column grid: a left "Harness / Alerts / Recent
  sessions" rail and a right projects board with search, view toggle,
  and an "Add new" menu (Project → attach modal, Session → no-agent
  session). The earlier hero strip + dense-grid layout was removed.
- **Search page lives at `/search`.** It hits `GET /api/v1/semantic/search`
  directly with `q`, `kind`, `k`, and an optional `project_id` derived
  from the shell-wide selection. The mode banner labels `hybrid` vs
  `fts-fallback` and surfaces the fallback reason verbatim.
- **Embeddings maintenance card lives on the search page, not the
  dashboard.** It exposes "Re-index semantic units", "Re-index memories",
  and "Re-index all" against `POST /api/v1/embeddings/reindex`. The
  returned `{ scanned, embedded, skipped, failed, providerId/modelId }`
  counts render below the buttons.
- **Local web ports moved to the mako 30xx range.** `vite.config.ts`
  defaults the dev server to `127.0.0.1:3019` and preview to `:3020`,
  honoring `MAKO_WEB_PORT` and `MAKO_WEB_PREVIEW_PORT` env overrides.
  `strictPort` is no longer forced anywhere — the dev server picks the
  next free port if `3019` is already taken. The earlier hardcoded
  `5173` / `4173` claims are gone.
- **TopBar now exposes the selected project chip.** The earlier
  `local harness · 127.0.0.1:3018` literal was replaced with a project
  scope chip (`<displayName>` or `all projects`) carrying a stable
  `data-testid="topbar-project"` for smoke coverage.
- **Memory page got an explicit project-scope toggle.** When a project is
  selected the list, recall, and remember calls all carry `project_id`;
  unchecking the toggle returns to all-project scope without losing the
  shell-wide selection.
- **`web-harness-shell` smoke updated, not retired.** The smoke now
  asserts on the new "Projects" header and uses the Add new → Session
  path to spin up the no-agent round-trip; the old "Project" article
  header and standalone "No-agent query" button assertions are gone.
- **Two new web smokes shipped:** `test/smoke/web-project-dashboard.ts`
  verifies multi-project rendering, the attach modal, project selection
  lifting into the top bar, and the grid/list view toggle.
  `test/smoke/web-semantic-search.ts` verifies the search input + kind
  chips + reindex card and that submitting a query reaches
  `/api/v1/semantic/search` with a non-5xx response and a mode banner.
  Both are wired into `pnpm run test:smoke:web`.
- **Chat surface moved from `/sessions/:id` to `/agent` + `/agent/:id`.**
  This walks back the original phase decision ("No `/code` reparenting in
  3.8.") at user direction during ship: the chat workspace was renamed to
  `/agent` because that's how operators talk about it, not `/code` and
  not `/sessions`. `/agent` (no id) shows an empty state with a "start
  no-agent session" affordance; `/agent/:sessionId` renders the existing
  `SessionPage` in the right pane. A back-compat redirect from
  `/sessions/:id` → `/agent/:id` lives in `App.tsx` so old deep links
  don't 404. Internal navigation in `Home.tsx`, `Session.tsx`, and
  `SessionListNav.tsx` was updated to the new path.
- **Sessions list moved out of the global sidebar into `/agent`.** Before
  3.8 the Shell sidebar carried a 3-row grid (Sessions label / scrollable
  session list / Surfaces nav) so session navigation was always present.
  After 3.8 the Shell is a single nav column (Dashboard / Agent / Search
  / Memory / Providers) with a small harness-version footer; the session
  list lives as a 280px left rail inside `AgentPage` and is scoped by
  the active project. Reasoning: sessions are an agent-page concern, not
  a global one, and the dashboard, search, memory, and providers pages
  do not benefit from carrying the session-list nav weight.
- **`AgentPage` is a new route shell, not a rewrite of `SessionPage`.**
  `apps/web/src/pages/Agent.tsx` owns the layout (left rail + main pane)
  and the session-list query / delete mutation; `SessionPage` stays the
  chat surface and is rendered as a child when a `:sessionId` is present.
  The session-creation affordance in the rail uses no-agent tier; the
  model picker stays on the dashboard's Quick Session row.
- **TopBar polish.** The earlier `127.0.0.1:3018` literal next to the
  wordmark was replaced with a project pill (mako depth-glyph + display
  name + chevron) that links back to the dashboard. The breadcrumb is
  now a slash-joined path (`agent / session · …`). Tier and harness
  version moved to the right edge with their own divider so they stop
  competing with the project pill for attention.
- **`agentmako dashboard` is the launch entry point.** New CLI subcommand
  in `apps/cli/src/commands/dashboard.ts` boots `services/api` (3017) and
  `services/harness` (3018) in-process via `startHttpApiServer` /
  `startHarnessServer`, spawns Vite from `apps/web` with the
  `MAKO_API_URL` / `MAKO_HARNESS_URL` / `MAKO_WEB_PORT` env vars wired,
  polls `http://127.0.0.1:3019` until reachable, and opens the browser.
  Ctrl+C cleanly tears down all three. Flags: `--port`, `--api-port`,
  `--harness-port`, `--no-open`, and a positional project path
  (defaults to `process.cwd()`). The CLI now declares
  `@mako-ai/harness` as a workspace dep and adds `@ast-grep/napi`,
  `web-tree-sitter`, and `tree-sitter-typescript` as direct runtime
  deps so the bundled CLI can resolve them after the harness pulls
  them in transitively; the same trio is added to `tsup.config.ts`
  externals so esbuild doesn't trip on their platform-specific `.node`
  shims at bundle time. Wired into `CLI_COMMANDS` and `printUsage`
  (new "Dashboard" section) in `apps/cli/src/shared.ts`. The
  published-CLI case (no `apps/web` next to the binary) is a follow-up:
  the launcher errors with a clear monorepo-checkout message when
  `apps/web` can't be located by walking up from `import.meta.url`.
- **Vite is spawned via `node <vite-bin>`, not `pnpm exec vite`.** The
  dashboard launcher resolves `vite/package.json` through `createRequire`
  rooted at `apps/web`, derives `bin/vite.js`, and spawns
  `process.execPath` directly. This avoids the Windows `pnpm.cmd` shim
  hazard (Node's `spawn` with `shell: false` is unreliable for `.cmd`
  files) and keeps stderr/stdout cleanly piped through. Without this,
  Vite never bound to 3019 on Windows and the operator would land on
  the harness's "No route for GET /" JSON when they navigated to 3018.
- **Removed direct-invocation guard from `services/harness/src/index.ts`.**
  Same bundling hazard `services/api/src/server.ts` documented earlier:
  when tsup inlined the harness module into the CLI bundle,
  `import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`
  resolved truthy and the harness auto-fired with `process.cwd()` as
  projectRoot before the CLI's main could route to the requested
  command. That stole port 3018 from the dashboard launcher's later
  `startHarnessServer` call and produced an opaque "mako-harness failed
  to start: SQL logic error" because the bundled stderr line raced
  with a real bind error from the second start. The standalone-server
  launch path stays available — re-add a separate `bin.ts` if it's
  ever needed.
- **Light + dark theme repaint.** Replaced the cyan-on-near-black
  "deep ocean" palette with a neutral slate ramp and a restrained
  indigo accent. Light is the default to match operator expectations
  of a code-inspection console; dark is opt-in via the TopBar toggle
  (sun/moon icon) or `prefers-color-scheme`. New `ThemeProvider` hook
  in `apps/web/src/hooks/useTheme.tsx` persists the choice to
  `localStorage["mako.theme"]` (`light` / `dark` / `system`) and
  mirrors the resolved value to `<html data-theme="…">`. An inline
  pre-paint script in `index.html` sets the attribute before React
  mounts so first paint matches the user's preference. Tailwind v4
  utilities continue to work because the same `--color-mk-*` token
  names drive both themes; only the values move under
  `:root[data-theme="dark"]`. Primary action buttons now use the
  inversion pattern `bg-mk-crest text-mk-abyss` so they read as
  black-on-white in light and white-on-black in dark — matching the
  Vercel "Add new…" treatment instead of bright-cyan-on-dark.
- **Sidebar and TopBar simplified to Vercel density.** The Shell
  sidebar lost the harness/version footer and is now a single column
  of text+icon nav rows with a subtle hover bg, no nested boxes. The
  TopBar lost its dividers and the depth-mark glyph in favor of a
  small chevron brand mark; project chip became a bare hover-bg row;
  the breadcrumb is centered ("Overview" / "Agent · …"); the right
  edge carries the theme toggle plus the harness sonar dot + tier
  label.
- **`Start a session` lives under the Harness card.** The earlier
  dashed-outline `QuickSessionBar` between the projects toolbar and
  the projects board was removed; the model picker and a secondary
  "No-agent" button now render in the footer of the Harness/Usage
  card on the dashboard's left rail. The dashboard's "Add new" menu
  remains the canonical project / session creation affordance on the
  right side.
- **`mk-card` primitive.** Added a small reusable class for top-level
  surfaces (`bg-mk-depth` + 1px `border-mk-current` + radius + a
  hairline shadow in light mode). Replaces ad-hoc
  `rounded-md border border-mk-current bg-mk-depth` strings in
  `Home.tsx` and `ProjectCard.tsx` so the surface treatment stays
  consistent between themes.
- **Project favicons via on-disk file detection (not `homepage` field).**
  An earlier iteration tried to read `package.json#homepage` and proxy
  through Google's S2 favicon service. That was scrapped at user
  direction in favor of detecting actual favicon files in the project
  tree. `services/api/src/service.ts` now decorates every
  `AttachedProject` returned by `listProjects()` with `metadata.faviconUrl`
  pointing at a new `GET /api/v1/projects/:projectId/favicon` route.
  The detector walks 27 candidate paths in priority order
  (`app/icon.{svg,png,ico}` → `public/favicon.*` + `public/icon.*` +
  `public/logo.*` + `public/apple-touch-icon.png` → `static/favicon.*` →
  `src/favicon.*` + `src/assets/favicon.*` → `assets/favicon.*` →
  bare-root `favicon.*`) — SVG before raster, framework-canonical
  paths before fallbacks. The route streams the file with the right
  `Content-Type` (image/svg+xml, image/png, image/x-icon) and
  `Cache-Control: public, max-age=300, must-revalidate`; path-confinement
  guard ensures resolved paths stay inside the project root. The web's
  `ProjectAvatar` reads `metadata.faviconUrl` directly and falls back
  to a deterministic colored initial tile via `<img onError>` if the
  URL 404s or the file becomes unreadable. Tile colors come from a
  10-tile palette hashed by `projectId` so each project keeps a
  stable color across renders.
- **Persistent agent + embedding defaults.** Two new axes shipped on
  the Providers page: a top "Defaults" section with two cards
  (Embeddings | Agent), each carrying a Cloud picker, a Local picker,
  and a `Cloud / Local` segmented `prefer` toggle the operator flips
  explicitly. The harness resolves the active model with preferred-first /
  fallback-second logic (`packages/config/src/defaults-store.ts`'s
  `resolveAxis`); when the preferred slot is unusable (no API key,
  unreachable) the active resolves to the other slot and the response
  carries `source: "fallback"` + a human reason string.
- **Defaults storage model.** Schema extension lives in
  `packages/config/src/schema.ts`:
  `defaults.{agent,embedding}: { cloud, local, prefer }` where each
  slot is `{ providerId, modelId } | null` and `prefer` is
  `"cloud" | "local"`. Persisted to global `~/.mako-ai/config.json`
  via the new `defaults-store.ts` module — atomic temp-file + rename
  write; preserves any unrelated keys the file may carry.
  `readResolvedDefaults(projectRoot?)` merges project
  `<projectRoot>/.mako-ai/config.json` over global per-key (project
  wins where set, never destructively). The data layer supports
  per-project overrides today; the UI to write them is the next
  follow-up.
- **`GET / PUT /api/v1/defaults` on harness.** GET returns
  `{ agent, embedding }` with each axis carrying its four config
  fields plus `active / source / reason` resolved against live
  provider availability (key-resolved + reachability via
  `harness.providerRegistry`). PUT accepts a partial patch
  (`{ agent?: {...}, embedding?: {...} }`) and returns the new
  resolved state. Auto-save on every Providers UI change — no Save
  button.
- **TopBar agent chip.** Replaced the static
  `local-agent / cloud-agent / no-agent` text on the right edge with
  a live agent chip: `<provider-icon> <model>` reading from
  `/api/v1/defaults` active state. A small "fallback" pill appears
  when `source === "fallback"`. Empty state ("no agent") links to
  `/providers`. Tooltip carries the resolution `reason` so the
  operator can see why their cloud agent isn't running today
  (typically "no api key" or "unreachable"). The harness sonar dot +
  version moved to its own slot on the far right.
- **Provider brand icons.** Added 11 `*.svg` assets under
  `apps/web/public/ai-providers/` and a new `<ProviderIcon>` component
  that resolves `providerId → asset` (with prefix-fuzzy matching for
  custom variants like `openai-compatible-foo`). Used in the
  Providers table, the AxisDefaultsCard active-summary footer, and
  the TopBar agent chip. The naming convention drives theming:
  `*-color.svg` (claude-color, deepseek-color, gemini-color,
  kimi-color, claudecode-color, huggingface-color) keeps the
  multi-color brand via `<img>`; everything else (ollama, openai,
  moonshot, github, cursor) is monochrome and renders via CSS
  `mask-image` with `background-color: currentColor`, so the icon
  automatically inherits the parent text color and flips correctly
  between light and dark themes. All bundled monochrome assets
  already declare `fill="currentColor"`, so the mask treatment is
  visually identical to a native `<img>` render in light mode but
  gains theme-awareness in dark mode.
- **Agent rail unscoped by default.** The earlier session-list
  filter that sent `?project_id=<selectedProjectId>` to
  `/api/v1/sessions` was hiding sessions whose `projectId` was null
  (created before a project was selected) or tied to a project the
  operator hadn't selected. Agent rail now requests
  `/api/v1/sessions` unscoped by default; an opt-in
  "scope to selected project" checkbox narrows the list when a
  project is selected in the dashboard. The session count and
  empty-state messaging follow the effective scope.
