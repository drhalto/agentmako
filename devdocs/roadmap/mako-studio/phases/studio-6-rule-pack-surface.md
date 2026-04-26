# Studio 6 Rule Pack Surface

Status: `Planned`

## Goal

Once Reef Engine ships rule identity/fingerprint semantics (Reef 1) and
public rule descriptor/query surfaces (Reef 5), surface rule packs in the
Studio dashboard so operators can browse rules by source, read
documentation, and manage acks scoped by rule, severity, or path glob.

The user-visible test is: open Studio against a project, navigate to a
"Rules" page, see all known rules grouped by source, click a rule to
read its documentation and recent findings, and bulk-ack matches across
the project from one screen.

## Scope

- "Rules" page (top-level dashboard nav addition)
- rule browser grouped by source (`reef_rule`, `eslint`, `typescript`,
  `git_precommit_check`, others as Reef 5 ships)
- per-rule detail panel: id, severity, source, documentation, recent
  matches, ack history
- ack lifecycle inspector: fingerprint preview, status timeline,
  reasoning trail
- bulk-ack flow scoped by rule, severity, or path glob
- rule-pack-aware search: "show me all findings for `auth_state_flow`"

## Out Of Scope

- creating or editing rules in-product (rule packs are distributed
  separately as code; Studio is a viewer)
- importing rule packs from URLs
- per-user rule overrides that change rule severity
- AI-suggested ack reasoning
- rule effectiveness metrics (Roadmap 8.x territory)

## Dependencies

- Reef 1 ships the executable rule contract, source namespaces,
  fingerprints, the public `ReefRuleDescriptor` data type, the
  `list_reef_rules` tool stub, and `finding_acks` compatibility. Studio
  imports `ReefRuleDescriptor` from `@mako-ai/contracts` rather than
  defining it locally — see Reef 1 contract sketch.
- Reef 5 populates `list_reef_rules` with real rule descriptors as
  `ReefRule` instances are registered. Studio 6 may ship before Reef 5
  if there is at least one external-source rule (e.g., a `git_precommit_check`
  descriptor) to render; the empty-but-valid contract from Reef 1 is
  enough to scaffold the UI.
- Studio 1, 2, 3, 4, 5 shipped.
- Existing `finding_ack` and `finding_acks_report` tools.

## UI Surfaces

### Rules page (new top-level nav)

- left rail: source list with rule count per source
- main pane: table of rules within the selected source, columns:
  severity, id, title, fact kinds, active findings count, ack count
- search box filters rules by id, title, source, or fact kind
- click row → opens detail panel

### Rule detail panel

- header: severity badge, id, source, title
- description block and descriptor-provided `docs.body` Markdown
  (rendered through the sanitized dashboard Markdown renderer)
- optional "Open external docs" link button (opens `documentationUrl` in
  the default browser via Studio 1's `bridge.openExternalUrl`; never
  navigates the Studio webview to a rule-provided URL)
- "Recent matches" section: last 20 findings produced by this rule,
  ordered by most recent
- "Ack history" section: last 50 acks for this rule's findings, with
  reasoning trail
- "Fact inputs" panel: the Reef fact kinds this rule consumes and any
  descriptor-provided path/source hints
- bulk action toolbar at the bottom of the panel:
  - "Ack all current matches" (with confirm dialog, requires reason)
  - "Ack matches under path glob..." (with glob input + preview count)
  - "Ack matches with severity ≥ ..." (severity selector)

### Search integration

- `Search.tsx` gets a "Rule" filter chip alongside the existing query
  chips
- selecting a rule filter scopes search results to findings produced
  by that rule

## Bridge Additions

No new bridge commands. This phase is dashboard-only on top of existing
tools and the Studio 1 `openExternalUrl` command for documentation links.

## Telemetry

Rule-related operator actions emit local Studio audit events (Studio 3)
with these `family` values:

- `family: "ack_by_rule"` — bulk ack scoped by rule id
- `family: "ack_by_glob"` — bulk ack scoped by path glob
- `family: "ack_by_severity"` — bulk ack scoped by severity threshold

The `reasonCodes` array carries the rule id, glob pattern, or severity
threshold. Do not add these to Roadmap 8.1 usefulness telemetry unless a
later telemetry contract explicitly does that.

## Done When

- a fixture project that triggers at least three Reef rules and one
  ESLint rule (via Reef 2 ingestion) shows them all in the Rules page
- rule detail panel renders the documentation link, opens it in the
  default browser through `openExternalUrl`, and shows recent matches
  accurately
- inline rule docs render sanitized Markdown and strip script, iframe, and
  `javascript:` link content
- bulk-ack-by-rule succeeds for 25+ findings in under 5 seconds
- bulk-ack-by-glob preview count matches the post-ack count
- search filter chip "Rule: <id>" narrows the findings page to
  matching rows
- Studio audit events fire with the correct `family` and
  `reasonCodes`
- browser-only mode degrades: documentation links use `window.open`;
  bulk acks still work
- CHANGELOG entry under `## [Unreleased]`
- roadmap status updated

## Verification

Smokes:

- new `web-rules-page-render.ts`: seeds rules and findings, verifies
  the page renders the right groups and counts
- new `web-rules-bulk-ack.ts`: bulk-acks 30 findings by rule,
  verifies the ack ledger has 30 new rows and the findings page shows
  them as acked
- new `web-rules-bulk-ack-glob.ts`: bulk-acks by path glob, verifies
  preview count matches actual count
- existing `finding-acks-*` smokes continue to pass

General checks:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke:web`

## Risks And Watchouts

- **Rule contract drift.** If Reef 5 changes the `ReefRuleDescriptor` shape
  after this phase ships, Studio's rule detail panel can break. Lock
  onto the public contract types only and add a regression test that
  the Studio renderer accepts every field documented in the contract.
- **Documentation URL trust.** `documentationUrl` comes from rule pack
  authors. Open it via the user's default browser, not inside the
  Studio webview, to avoid script-injection risk in the dashboard
  context.
- **Rule docs XSS.** Prefer inline `docs.body` Markdown in the descriptor
  and sanitize it before rendering. External URLs are optional escape
  hatches, not the primary docs transport.
- **Bulk ack performance.** Acking 1000+ findings through individual
  HTTP calls is slow. Add a batched endpoint
  (`POST /api/v1/findings/ack-batch`) under the existing services if
  benchmarks show >5s latency at 100+ findings.
- **Rule count explosion.** A project that runs ESLint with the
  recommended ruleset can light up 200+ rules. Default the source rail
  to "show only sources with active findings" with a toggle to show all.
- **Markdown rendering.** Rule descriptions may include code blocks,
  links, and lists. Use the same Markdown renderer as the dashboard's
  existing notes view to avoid drift.
- **Severity threshold semantics.** "Severity ≥ warning" is ambiguous
  if a rule has multiple severity levels. The threshold UI uses
  inclusive comparison and shows the full match count before confirm.
- **Search filter cardinality.** If the dashboard's search box backs
  by an FTS query, adding a "rule" filter requires the rule id to be
  indexed. Reef 5 must include rule id in finding rows; verify before
  Studio 6 starts.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- [./studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
- [../../reef-engine/phases/reef-1-fact-model-and-active-findings-store.md](../../reef-engine/phases/reef-1-fact-model-and-active-findings-store.md)
- [../../reef-engine/phases/reef-5-tool-view-migration.md](../../reef-engine/phases/reef-5-tool-view-migration.md)
- `packages/store/src/project-store-finding-acks.ts`
- `packages/contracts/src/finding-acks.ts`
