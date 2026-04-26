# Studio 2 Project State Visualization

Status: `Planned`

## Goal

Surface Reef Engine state in the dashboard so the operator can see what
Mako already knows about the project without firing tool calls. Findings,
freshness, recent index runs, and the most relevant Reef facts become
first-class panels in the existing dashboard layout.

The user-visible test is: open a project that has lint findings,
boundary issues, or stale indexed files, and the dashboard's home page
shows that count and lets the operator drill in.

## Scope

- findings table page surfacing `project_findings` output
- per-file findings drawer accessible from `Search.tsx`, `Tools.tsx`,
  and `Health.tsx`
- index freshness panel (uses `project_index_status`)
- recent index runs list with trigger source, stats, and duration
- Reef-backed `context_packet` surface in `Agent.tsx` (replaces the
  current ad-hoc evidence rendering with a structured packet view)
- shell-aware "open in editor" links from findings to file:line via the
  Studio bridge

## Out Of Scope

- ack / suppress flows (Studio 3); resolved status remains Reef-derived
- multi-project bar (Studio 4)
- rule pack browser (Studio 6)
- modifications to Reef contracts (those belong in Reef phases)
- new MCP tool contracts
- overlay switching UI (`indexed | working_tree | staged | preview`).
  Studio 2 ships with `working_tree` as the implicit default for
  context-packet-style queries and `indexed` for AST-style queries —
  whatever the underlying tools already use. A user-facing overlay
  switcher waits until **Reef 3** ships overlay-aware fact/finding
  queries; a follow-up Studio phase (Studio 4.x or a new dedicated
  slice) adds the switcher once Reef 3 lands.

## Dependencies

- Reef 1 (fact model and `project_findings` / `file_findings` tools)
  must be shipped.
- Reef 2 (external lint/type ingestion) is not strictly required but
  makes the findings page useful enough to justify shipping; if Reef 2
  is still in flight, Studio 2 may ship with `git_precommit_check` as
  the sole finding source.
- Studio 1 must be shipped: this phase adds dashboard pages that exist
  inside the Studio shell and continue to work in the browser.

## UI Surfaces

### Findings page (new)

- table columns: severity, source, file:line, message, age, status badge
- every finding row renders its Reef freshness/age. Findings older than
  the configured stale threshold are visually downgraded until refreshed.
- filters: source, severity, status, file glob
- row click opens the per-file drawer
- empty state explains "Mako has no active findings; run lint or
  precommit to populate"

### Per-file findings drawer (additive)

- shown alongside file content in `Search.tsx` and `Tools.tsx` when a
  file is selected
- shows active findings for the file, freshness state, recent index
  runs that touched the file
- "open in editor" via `bridge.openInSystemEditor()` when running in
  Studio; falls back to a `code://` URL hint in browser-only mode

### Index freshness panel (new section in Health.tsx)

- mirrors the CLI's "Code Index Freshness" block
- breakdown by state (fresh / stale / deleted / unindexed / unknown)
- sample of non-fresh files with reason
- "Refresh now" button placeholder (wired in Studio 3)

### Recent index runs list (new section in Health.tsx)

- last 10 runs with trigger source, status, started/finished, duration
- expand row for stats (files, chunks, symbols, imports, routes)

### Context packet rendering (refactor Agent.tsx)

- show intent (primary family + signals)
- primary context with freshness badge per candidate
- related context collapsed by default
- risks panel
- scoped instructions panel
- recommended harness pattern as an ordered list
- expandable tools as click-to-call shortcuts

## Contract Sketch

No new MCP contracts ship in this phase. Studio 2 consumes:

- `project_findings` / `file_findings` (Reef 1)
- `project_index_status` (already shipped)
- `getLatestIndexRun` / index_runs query (already shipped)
- `context_packet` (already shipped)
- `recall_tool_runs` (already shipped, used for finding provenance)

A small TanStack Query layer adds queries keyed by `(projectId,
overlay)` so future Studio 4 multi-project switching invalidates
correctly.

## Done When

- a real fixture project with lint findings (via `git_precommit_check`)
  surfaces those findings in the new findings page
- per-file drawer shows correct active findings for a selected file
- finding rows never render without age/freshness context; stale findings
  are visually distinguished from fresh ones
- freshness panel matches what the CLI's `agentmako project status`
  prints
- "open in editor" works on macOS, opens the file in the user's default
  editor, and respects project-root scope
- context_packet rendering replaces the current Agent.tsx evidence view
  without regressing the existing query flow
- browser-only mode degrades gracefully: no Studio bridge errors, no
  broken "open in editor" links
- CHANGELOG entry under `## [Unreleased]`
- roadmap status updated

## Verification

Smokes:

- existing dashboard smokes continue to pass
- new `web-findings-page.ts` smoke that seeds a project with findings
  and verifies they render
- new `web-context-packet.ts` smoke that verifies the new packet view
  renders without console errors

UI parity check (manual): screenshot the new pages on macOS Studio,
ensure they read clearly at common dashboard widths.

## Risks And Watchouts

- **Findings table size.** A real project can have hundreds of findings
  from ESLint alone. Default page size 50, virtualize if >500 visible.
- **Freshness panel cost.** `project_index_status` with
  `includeUnindexed: true` walks the disk. Cache the result per project
  for 30 seconds inside TanStack Query to avoid hammering the api when
  the user navigates between pages.
- **Context packet shape drift.** Reef 5 may migrate `context_packet` to
  a Reef-backed candidate model. The dashboard renderer must consume
  the public `ContextPacketToolOutput` type, not internal types, so the
  Reef migration does not break Studio.
- **Browser-only feature flags.** Code that uses `bridge.*` must check
  `window.__MAKO_STUDIO__?.isStudio` first. Static lint rule recommended
  to catch un-flagged usage.
- **Editor URI scheme drift.** `openInSystemEditor` on macOS uses `open
  -a` with the user's default `.ts` handler; on Windows it uses
  `ShellExecute`. Document the fallback chain in the bridge module.
- **Path-traversal in finding payloads.** Findings carry `filePath`
  fields that come from external tools (ESLint, TypeScript). Validate
  every path against the active project root before passing to
  `bridge.openInSystemEditor`.
- **Reef 1 fingerprint contract.** Studio 2 displays `fingerprint`
  values; if Reef changes the fingerprint algorithm later, Studio's
  ack-state UI (Studio 3) must continue to match. Lock onto the public
  Reef contract types only.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- [../../reef-engine/phases/reef-1-fact-model-and-active-findings-store.md](../../reef-engine/phases/reef-1-fact-model-and-active-findings-store.md)
- [./studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
- `apps/web/src/pages/`
- `packages/contracts/src/tool-context-packet-schemas.ts`
