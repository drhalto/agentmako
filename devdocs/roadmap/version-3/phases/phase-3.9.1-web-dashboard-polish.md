# Phase 3.9.1 Web Dashboard Polish

Status: `Complete` (shipped 2026-04-18)

This file is the canonical planning record for Roadmap 3 Phase 3.9.1, a follow-up to Phase 3.9 that lifts the web dashboard's information architecture to match the capability the 3.8 + 3.9 substrate now exposes. Same-day ship pattern as 3.5.1 after 3.5: close the most visible operator-surface rough edges without reopening transport, provider, or model-layer scope.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design and shipped behavior of Phase 3.9.1.

## Prerequisites

Phase 3.9.1 requires Phases 3.8 and 3.9 complete:

- Phase 3.8 shipped the `SelectedProjectProvider` hook, the Vercel-style projects board, the Defaults / AxisDefaultsCard surface on Providers, and the TopBar project chip (as a link).
- Phase 3.9 shipped the models.dev catalog composer, local-discovery probes into `GET /api/v1/providers`, cost/usage telemetry, the `/usage` page, and the Providers catalog-source line.

3.9.1 is addressable because the data surfaces it consumes are already correct. The phase is an IA pass, not a substrate pass.

## Goal

Turn the web dashboard from a collection of pages that happen to know about a project scope into a surface where project scope is deep-linkable, global-vs-scoped routes are honest, and the most visible controls (model pickers, project cards, provider CTAs) read as operator tools instead of generic admin forms.

Specifically:

- make project scope a URL-first concept (`/<slug>/...`) so scopes are bookmarkable and shareable
- distinguish machine-global routes (`/providers`, `/usage`) from project-scoped routes in the route tree itself, not just in the page copy
- replace the placeholder project "chip" in the top bar with a real popover picker
- give the model selector on the Providers Defaults cards a searchable combobox that doesn't clip the card
- rework the Project Card so the most-printed field isn't a raw UUID
- add one small backend affordance (`POST /api/v1/projects/:id/reveal`) for the one workflow that clearly wants an OS-native jump

This phase is intentionally narrow. It does not change the harness core, the provider registry, the catalog source, or the cost-telemetry schema.

## Hard Decisions

1. **Project scope lives in the URL path, not in a React context + localStorage.**
   3.8 shipped `SelectedProjectProvider` as a shell-wide React context that persisted the selected project id to `localStorage` and reconciled it against the live project list. That was correct for 3.8's deadline, but it made the scope invisible to anyone copying a URL, and it made the TopBar "project chip" a fiction — the chip read the context but couldn't actually switch scope without custom code no one wrote. 3.9.1 makes the URL (`/:slug/...`) the source of truth. `localStorage` collapses to a one-shot seed for the `/` root redirect.

2. **Machine-global routes are not under `/:slug/`.**
   Providers and Usage configure the harness install, not a project. Mounting them at `/:slug/providers` implied per-project provider settings that never existed. 3.9.1 hoists `/providers` and `/usage` to the top level. They render through the same Shell layout as the scoped routes, but the picker knows it's on a global route and behaves accordingly.

3. **Slugs derive from `displayName`, not `projectId`.**
   `projectId` is a `project_<uuid>` identifier — fine for the wire, hostile in a URL. The slug is a kebab-case derivative of `displayName` with a shortened-id suffix applied to every member of a colliding group. The reserved literal `all` maps to "all attached projects" for surfaces that support unscoped aggregation; if a project's base slug would be `all`, it gets a suffix so the reserved slug stays reserved.

4. **Model picker becomes a portal-rendered combobox.**
   The 3.8 Providers Defaults cards use a native `<select>` with ~30 options — workable, but the list is hard to scan and the AxisDefaultsCard's `overflow-hidden` clips any open dropdown. 3.9.1 replaces it with a custom combobox: search input, keyboard nav (Arrow/Enter/Esc), provider-icon annotations, warning chips for unusable rows (`no api key` / `unreachable`), and a `selected` badge on the current pick. Rendered via React portal so the card's overflow can stay for the card's own content.

5. **`reveal` is a narrow backend affordance, not a file-manager feature.**
   The one workflow that clearly wants a native escape hatch is "take me to this project on disk." The new route (`POST /api/v1/projects/:projectId/reveal`) looks the project up by id, spawns the OS's file manager detached, and returns. It is not a file tree, not a streaming file read, and not a generic shell executor. A future read-only file tree still belongs in its own phase.

6. **No new migration. No change to `harness_provider_calls`.**
   3.9.1 reads existing persisted data and adds no columns. The only new SQL-adjacent change is a `SELECT` by id in the reveal handler, which reuses the existing `listProjects()` accessor.

## Why This Phase Exists

3.8 left scope as a shell-wide React state. 3.9 left it untouched. Three operator pain points shared one fix:

1. **Scope is not deep-linkable.** Operators saving or sharing a URL could not carry their project selection with it. Every shared link was effectively scope-less; the recipient landed on the last-used scope from their own localStorage.
2. **Providers looked per-project even though it wasn't.** The Shell sidebar routed `Providers` through the same scope state as `Agent`, `Memory`, and `Search`. Operators reasonably assumed provider keys were per-project; they were always machine-global.
3. **The TopBar project chip was a fiction.** It rendered the displayName but linked back to `/`. Clicking it never changed scope. That misaligned with the chevron it rendered, which suggested a menu.

Independent of the scope story, the Providers page's descriptive prose (three separate paragraph-length subtitles) competed with the actual data for operator attention, and the dashboard's ProjectCard printed `projectId` — a UUID — as prominently as the displayName. These were low-cost cleanups that fit the same ship.

## Scope In

### 1. Path-based project scope

Build:

- `apps/web/src/hooks/useSelectedProject.tsx` rewritten as a route-aware hook. Drops `SelectedProjectProvider`. Reads `slug` from `useParams`. Exposes `scopedPath(path)` + `selectProject(id | null)` that navigate while preserving the current sub-path. `effectiveSlug` fallback derived from URL → stored → first project → `all`.
- `apps/web/src/App.tsx` route tree restructured:
  - a single layout route wraps both global and scoped pages through one Shell instance
  - `/providers` and `/usage` at the top level
  - `/:slug`, `/:slug/agent`, `/:slug/agent/:sessionId`, `/:slug/memory`, `/:slug/search` under the slug
  - `/` renders `<ProjectRedirect />` which resolves to `/<last-used-slug>`
  - legacy `/sessions/:id` → `/agent/:id` redirect preserved (2026-04-17 carry-over); the catch-all `*` path hits `ProjectRedirect` so unslugged URLs forward to a valid scope
- `computeSlugMap(projects)` — base slug from `displayName` kebab-case; collision groups get a 6-char id suffix; the reserved `all` literal is bumped to `all-x` if a real project would collide with it. Pure function; exported for the redirect layer.
- `scopedPath(path)` — respects a short `GLOBAL_ROUTE_PREFIXES = ["/providers", "/usage"]` allowlist so sidebar nav links point to the unscoped URL for global surfaces and prepend the slug for project-scoped ones.
- `selectProject(id)` — on scoped routes replaces the first path segment, preserving the sub-path (so `/<slug>/agent/<id>` swaps scope in place); on global routes jumps to `/<newSlug>` (the project's dashboard) so the selection is immediately visible.

Result:

- URLs are the single source of truth for scope
- `/forgebench/agent/abc123` is a shareable, bookmarkable deep link
- localStorage remains as a seed for the root redirect only — reload does not lose scope because the URL carries it

### 2. Global routes hoisted out of `/:slug/`

Build:

- `/providers` and `/usage` served at the top level through the shared layout route
- `TopBar`'s breadcrumb helper strips the slug segment only when the first segment is NOT a known global route
- `TopBar`'s project picker treats `effectiveSlug` (URL → stored → first → `all`) as the reference slug for label + selected badge, which keeps the picker coherent on global pages

Result:

- Provider keys and usage rollups no longer read as per-project settings
- The Shell's `Providers` nav entry highlights on the unscoped URL
- Switching projects from `/providers` sends the operator to that project's dashboard rather than a nonsense `/<slug>/providers` URL

### 3. TopBar project picker

Build:

- `apps/web/src/components/TopBar.tsx` — the former `<Link to="/">` project chip is now a real `<button>` with `data-testid="topbar-project"` retained for smoke compatibility
- Portal-rendered popover (re-uses the combobox pattern from task 4): fixed positioning anchored to the trigger's `getBoundingClientRect`, refreshed on `resize` + capture-phase `scroll`, click-outside + Escape dismiss
- Entries: an `All Projects` option (navigates to `/all`) + one row per attached project (navigates to `/<slug>` + preserved sub-path)
- Keyboard: `ArrowDown` / `Enter` / `Space` open; `ArrowUp` / `ArrowDown` navigate; `Enter` commits; `Escape` closes
- Selected row flagged with a `selected` badge and `aria-selected`

Result:

- Scope switching is a one-click, keyboard-accessible operation
- The chip's chevron is now honest — it opens a menu

### 4. Searchable model combobox

Build:

- `apps/web/src/components/AxisDefaultsCard.tsx` — the `<SlotRow>` internals replaced with a custom `<ModelCombobox>` component
- Matches by `providerName`, `providerId`, `modelDisplay`, and `modelId` on every keystroke
- Keyboard: `ArrowDown` opens from trigger; `ArrowUp`/`ArrowDown` navigate the filtered list; `Enter` picks; `Escape` closes
- Rows render `ProviderIcon` + provider display name + model display name, with `mk-label` chips for `unavailableReason` (`no api key` / `unreachable`) right-aligned and a `selected` badge on the current pick
- Portal-rendered via `createPortal(…, document.body)` with fixed positioning so the card's `overflow-hidden` cannot clip the popover
- `— none —` appears only when the search is empty; hidden during active filtering

Result:

- Defaults Agent/Embedding dropdowns scale to the 25+ model catalog without becoming a scroll swamp
- Open popover layers above every neighboring card; no clipping

### 5. ProjectCard redesign

Build:

- `apps/web/src/components/ProjectCard.tsx` — drops the prominent `projectId` UUID from the grid and list views
- Header shows `displayName` + a subtle `/<slug>` hint (links the card to its deep-link URL)
- `supportTarget` rendered as a small mono chip (e.g. `js-ts-web-postgres`) so at-a-glance operators see the project stack
- Canonical path rendered as a `<button>` with a folder icon + external-link arrow; click fires `POST /api/v1/projects/:id/reveal`. The path collapses to `…/parent/leaf` when the raw form would overflow
- Selected state strengthened: signal-tinted background + a 3px inset left stripe (`shadow-[inset_3px_0_0_var(--color-mk-signal)]`) + a `current scope` label in the footer
- Non-selected cards show a hover-revealed `open →` affordance in the footer
- Kebab menu gains an `Open folder` entry (keyboard path to the reveal endpoint that doesn't require clicking the path)
- `ProjectAvatar` unchanged

Result:

- Cards read as entry-points into a scope instead of database rows
- The slug is visible, so operators can bookmark or type a scope directly

### 6. Reveal endpoint

Build:

- `services/api/src/routes.ts` — new `projectsReveal: { method: "POST", path: "/api/v1/projects/:projectId/reveal" }`
- `services/api/src/routes/projects.ts` — handler looks the project up through `api.listProjects()`, then spawns the OS file manager detached:
  - `explorer.exe <path>` on `win32`
  - `open <path>` on `darwin`
  - `xdg-open <path>` everywhere else
  - `{ detached: true, stdio: "ignore" }` + `unref()` so the child outlives the request
- `services/api/src/server.ts` wires the new route + method-not-allowed handler
- `apps/web/src/components/ProjectCard.tsx` calls `POST /api/v1/projects/:id/reveal` via `useMutation`; both the path button and the kebab `Open folder` item drive it

Result:

- One click / one menu item opens the project directory in the operator's native file manager
- Only attached projects are reachable — the route refuses unknown ids with `404 not_found`

### 7. Providers page information architecture

Build:

- `apps/web/src/pages/Providers.tsx` — three descriptive paragraph subtitles collapsed into `title` tooltips on the section headings, so the page reads as data-first
- The redundant `BYOK · local + cloud` chip next to the `Providers` heading removed (the catalog-status line already carries the source breakdown)
- `ProviderStatusCell`'s `ADD API KEY` button tinted with the signal color (`border-mk-signal/50 bg-mk-signal/10 text-mk-signal hover:bg-mk-signal/20`) so it reads as the primary row action versus the neutral kebab controls
- `ProviderIcon` map updates `lmstudio` to the actual LM Studio glyph (`lmstudio.svg`) instead of falling back to the OpenAI mark

Result:

- The Providers page leads with data, not onboarding copy
- The LM Studio row no longer pretends to be OpenAI

### 8. Brand + shell layout refresh

Build:

- `apps/web/src/components/Shell.tsx` — the grid flips from `rows-[52px_1fr]` (top bar spanning full width) to `cols-[224px_1fr]` (sidebar full-height); the `mako` wordmark + brand mark lives in a 52px block at the top of the sidebar so the two 52px headers align
- `apps/web/src/components/TopBar.tsx` — now occupies the right column only, sitting above main content; no longer clips the sidebar; the former wordmark/home block is gone from the header

Result:

- Sidebar density matches the Vercel projects board language that 3.8 adopted
- The TopBar is free to carry scope, breadcrumb, and health signals without competing with the wordmark

## Scope Out

- a read-only project file tree (continues to wait on a backend enumeration route)
- per-project provider keys or per-project Defaults overrides (the Defaults schema already supports per-project overrides via `readResolvedDefaults(projectRoot?)`, but a UI surface for it is a later phase)
- path editing inline on the card (reveal-only; attach/detach still lives in the kebab)
- model-picker virtualization (the combobox currently renders every filtered row; fine at 25–50 options; virtualize when we cross ~300)
- changes to the `/sessions/:id` legacy redirect or any chat-surface rework

## Architecture Boundary

### Owns

- `apps/web/src/App.tsx`
- `apps/web/src/hooks/useSelectedProject.tsx`
- `apps/web/src/components/Shell.tsx`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/components/ProjectCard.tsx`
- `apps/web/src/components/AxisDefaultsCard.tsx`
- `apps/web/src/components/ProviderIcon.tsx`
- `apps/web/src/pages/Providers.tsx`
- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Agent.tsx`
- `apps/web/src/pages/Session.tsx`
- `apps/web/src/components/SessionListNav.tsx`
- `apps/web/public/ai-providers/lmstudio.svg`
- `services/api/src/routes.ts`
- `services/api/src/server.ts`
- `services/api/src/routes/projects.ts`

### Does Not Own

- `packages/harness-core` (untouched — no schema or telemetry changes)
- `services/harness/src/server.ts` (the harness transport layer stays as 3.9 left it)
- the `harness_provider_calls` schema or any cost/usage telemetry
- the catalog composer (`packages/harness-core/src/catalog-source.ts`) or the models.dev wire schema

## Execution Flow

1. Rewrite `useSelectedProject` as a route-aware hook; expose `scopedPath` + `effectiveSlug`.
2. Restructure `App.tsx` to a single layout route covering `/providers`, `/usage`, and `/:slug/...`; add `ProjectRedirect`.
3. Port every absolute `<Link to="/...">` and `navigate("/…")` across pages/components to `scopedPath(...)`.
4. Hoist `/providers` and `/usage` out of the slug tree; teach the breadcrumb renderer to recognize global top-levels.
5. Replace the TopBar project `<Link>` with a portal-rendered popover picker.
6. Replace the AxisDefaultsCard `<select>` with `ModelCombobox` (portal popover, search, keyboard nav).
7. Redesign `ProjectCard` (drop UUID, add slug hint + `supportTarget` chip, clickable path with folder icon, strengthened selected state).
8. Land the `POST /api/v1/projects/:projectId/reveal` route: handler + registration + wiring from `ProjectCard`.
9. Providers page IA: collapse subtitles into `title` tooltips, drop the redundant chip, tint the `ADD API KEY` button, swap in the real LM Studio icon.
10. Brand shift: move the `mako` wordmark from the header into the top of the full-height sidebar; reflow Shell as `cols-[224px_1fr]`.
11. Verify through the shipped Playwright smokes (no assertion change needed — `data-testid="topbar-project"` stays on the new picker button).

## File Plan

### Modify

- `apps/web/src/App.tsx`
- `apps/web/src/hooks/useSelectedProject.tsx`
- `apps/web/src/components/Shell.tsx`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/components/ProjectCard.tsx`
- `apps/web/src/components/ProjectAvatar.tsx` (no code change; documented reuse)
- `apps/web/src/components/AxisDefaultsCard.tsx`
- `apps/web/src/components/ProviderIcon.tsx`
- `apps/web/src/components/SessionListNav.tsx`
- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Agent.tsx`
- `apps/web/src/pages/Session.tsx`
- `apps/web/src/pages/Providers.tsx`
- `services/api/src/routes.ts`
- `services/api/src/server.ts`
- `services/api/src/routes/projects.ts`
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md`
- `devdocs/roadmap/version-3/phases/README.md`

### Create

- `apps/web/public/ai-providers/lmstudio.svg`
- `devdocs/roadmap/version-3/phases/phase-3.9.1-web-dashboard-polish.md` (this file)

### Reuse As-Is Unless Forced

- `apps/web/src/pages/Memory.tsx` / `Search.tsx` / `Usage.tsx` (consume the rewritten hook; no internal changes)
- `apps/web/src/components/AttachProjectModal.tsx` (selects the attached project via `selectProject(id)` — new hook is API-compatible)
- `packages/harness-contracts` (no schema change)
- `services/harness/src/server.ts` (untouched)
- the Playwright smokes (`web-harness-shell.ts`, `web-project-dashboard.ts`, `web-semantic-search.ts`, `web-session-affordances.ts`) — assertions remain valid because scoped pages still mount at the same labels and `data-testid="topbar-project"` is retained on the new picker button

## Verification

Required:

- `corepack pnpm run typecheck` clean
- existing web smoke chain (`pnpm run test:smoke:web`) stays green against a running API + harness + web stack

Manual acceptance:

1. Open `/` — the app redirects to `/<last-used-slug>` (first attached project if no stored slug).
2. Click a different project in the TopBar popover — the URL flips to `/<newSlug>` and the ProjectCard ring follows.
3. Deep-link into `/forgebench/agent/<sessionId>` directly — the page renders the right session and the picker shows `forgebench`.
4. Navigate to `/providers` — the URL stays unscoped, the breadcrumb reads `Providers`, the picker still reflects the effective scope, and sidebar nav links to scoped routes carry the correct slug.
5. Pick a different project from `/providers` — the app navigates to that project's dashboard (`/<newSlug>`), not to `/<newSlug>/providers`.
6. Open the Defaults Agent combobox on the Providers page — type a fragment of a provider or model id; the list filters live; Arrow keys move the highlight; Enter commits. The popover sits above the Configured providers card below; no clipping.
7. Click a ProjectCard's path (or `Open folder` in its kebab) — the OS file manager opens at the project root. An unknown id returns `404 not_found`.
8. Type `/all/agent` directly — renders the agent page with no project scope; switching scope from here preserves the `/agent` sub-path.

## Done When

- project scope is URL-first; every scoped page's URL carries `/:slug/` and every global page's URL does not
- the TopBar project picker actually switches scope (and does so with keyboard navigation)
- the Defaults model combobox is searchable and never clips the card
- the Project Card no longer leads with a UUID; path clicks open the OS file manager
- `POST /api/v1/projects/:id/reveal` exists, is registered, and refuses unknown ids
- `mako` wordmark lives in the sidebar; the TopBar no longer spans across the sidebar column
- typecheck + smoke chains stay green

## Risks And Watchouts

- **Slug collisions.** Two attached projects with the same `displayName` resolve to the same base slug. `computeSlugMap` disambiguates by appending a 6-char suffix to every member of the colliding group, so slugs stay stable across reloads even when a new project joins the group. Confirm this behavior when a user attaches two forks of the same repo.
- **Scope drift on global pages.** On `/providers` or `/usage` the URL has no slug. The picker label reads `effectiveSlug`, which falls back to last-used / first-attached / `all`. Surfaces that consume `selectedProjectId` (currently Memory, Search, Home) never render on a global route, so this drift is invisible in shipped surfaces — but anyone adding a new global page that consumes `selectedProjectId` should explicitly decide whether the fallback slug is meaningful for their page.
- **Reveal endpoint is fire-and-forget.** The API never waits for the spawned file manager; a failure to launch (`ENOENT`, missing `xdg-open`) is silent from the operator's perspective. Acceptable because the worst case is "nothing happened, try again," but if reveal gets used for anything load-bearing, switch to a `{ ok: boolean, error?: string }` response.
- **Combobox virtualization budget.** Every filtered row renders. At 25 cloud models + daemon-discovered locals this is fine. When the catalog grows past ~300 rows, swap to a windowed list before the popover starts jank-scrolling on low-end hardware.
- **Same-day-as-3.9 ship cadence.** 3.9 shipped 2026-04-18; 3.9.1 also shipped 2026-04-18. Both phase docs should stay distinct — 3.9 owns the model-layer work, 3.9.1 owns the dashboard IA. Don't fold 3.9.1's changes back into 3.9's deviations list after the fact.

## Deviations From Spec At Ship Time

1. **Slug fallback chain for `scopedPath(...)` prefers URL > localStorage > first project > `"all"`.** Early drafts had `scopedPath` pull from localStorage directly. Shipped implementation derives `effectiveSlug` once at the top of the hook and feeds it to `scopedPath` to keep the logic idempotent and to cover the edge where localStorage still references a detached project.

2. **Click-outside on the TopBar picker uses mousedown, not click.** Both the picker and the combobox listen on `document.addEventListener("mousedown", ...)` with early-returns for the trigger and popover refs. Click would fire too late (after `blur` already collapses focus state). Same pattern in the model combobox.

3. **`ProjectCard` doesn't show session count.** An earlier sketch included "X sessions" under the slug hint. Shipped implementation dropped it: the dashboard's Home page already fetches sessions scoped to the selected project, but fetching per-card counts would require either a new `/api/v1/sessions/count?group_by=project` endpoint or a cross-project session query in the browser. Neither is worth the round-trips for what ends up as a nice-to-have badge.

4. **`supportTarget` rendered as a chip, not a tooltip.** The display is a bordered `mk-label` chip at the card's mid-row. Earlier iterations tucked it into a hover tooltip to keep the card dense; operators pushed back that the stack label was actionable information (e.g. "this is the Postgres-backed one") and deserved to render unconditionally. Chip style matches the `FALLBACK` / `PRIMARY` badges used elsewhere.

5. **Reveal endpoint is `POST`, not `GET`.** Triggering side-effects from a `GET` is the wrong HTTP shape and blocks any caching / link-preview layer that might prefetch URLs. `POST` with an empty body is the right tool for "do this action against this id."

6. **`OpenExternalIcon` hover-reveal uses Tailwind `group/path` scoping.** Each card's path button declares `group/path`, so the external-link arrow that nests inside responds to hover on the button itself rather than the entire card. Without the scope, hovering the card's kebab would also fade the external-link arrow on the sibling path, which looked accidental. Named group scoping is the Tailwind v4 feature that makes this clean.

7. **`ProjectRedirect` preserves any sub-path when it fires.** When someone navigates to `/agent` without a slug, the catch-all renders `ProjectRedirect`, which walks `location.pathname` and forwards to `/<fallbackSlug>/agent` rather than dropping the path entirely. Keeps existing 3.8-era bookmarks working even though they predate the slug prefix.

8. **Legacy `/sessions/:id` redirect stays a raw `Navigate`.** It redirects to `/agent/:id` (no slug), which the catch-all then wraps through `ProjectRedirect` to land at `/<slug>/agent/:id`. Two-hop redirect is cheap, and a direct `/<slug>/agent/:id` redirect would require reading the project list in `LegacySessionRedirect` itself.

9. **`GLOBAL_ROUTE_PREFIXES` is a literal list, not a registry.** `["/providers", "/usage"]`. Adding a third global route means adding a string here, adding a top-level `<Route>` in `App.tsx`, and adding the segment name to the breadcrumb helper's `GLOBAL_TOP_LEVEL` set. Three touch points felt acceptable; a registry was over-engineering for the current surface count.

10. **LM Studio icon renders via CSS mask, not `<img>`.** The bundled `lmstudio.svg` declares `fill="currentColor"` on both its full-opacity and `fill-opacity="0.3"` paths. `ProviderIcon`'s monochrome branch masks the glyph with `background-color: currentColor`, which preserves the two-tone depth cue (because alpha is alpha) while theming correctly in light + dark. Treating it as a `-color.svg` `<img>` would have lost theme-awareness for no visual gain.

11. **No new Playwright smoke shipped.** The existing suite (`web-harness-shell`, `web-project-dashboard`, `web-semantic-search`, `web-session-affordances`) keeps passing because the assertion surface is unchanged — the TopBar picker keeps `data-testid="topbar-project"`, ProjectCards still render `displayName` and `canonicalPath`, the Providers `ADD API KEY` button keeps its label, and the new combobox preserves `role="listbox"` + `role="option"` semantics. A future `web-project-routing` smoke that asserts `/forgebench/agent` specifically would be the right place to lock in the path-based scope contract — deferred here because the smoke would need a fixture-attached project to deep-link into.
