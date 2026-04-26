# Studio 3 Operator Actions Surface

Status: `Planned`

## Goal

Add in-shell operator commands so the dashboard becomes a working
operator console, not only a viewer. The same actions that today require
`agentmako` CLI invocations become explicit, audit-logged buttons in the
UI.

The user-visible test is: project shows stale findings, operator clicks
"Refresh index," watches progress, sees freshness flip back to fresh,
and the findings update without restarting anything.

## Scope

- "Refresh index" button surfacing `project_index_refresh`
- "Run precommit" button surfacing `git_precommit_check`
- bulk ack / suppress for findings via `finding_ack`
- MCP run inspector surfacing `recall_tool_runs`
- session inspector surfacing `session_handoff`
- agent feedback summary view (read-only) over `agent_feedback_report`
- progress UI for any action that can take >1 second
- local Studio audit event per operator action (Studio-owned event table,
  not Roadmap 8.1 `RuntimeUsefulnessEvent`)

## Out Of Scope

- multi-project workspace (Studio 4)
- auto-update / telemetry consent (Studio 5)
- rule pack browser (Studio 6)
- new MCP tool contracts
- agent-driven repair or autonomous edits

## Dependencies

- Studio 1 (shell + bridge)
- Studio 2 (findings UI surfaces — this phase wires actions to those
  surfaces)
- All required MCP tools are already shipped:
  - `project_index_refresh` (Initial Testing Phase 4)
  - `git_precommit_check` (already shipped)
  - `finding_ack` and `finding_acks_report` (Initial Testing Phase 1)
  - `recall_tool_runs` and `recall_answers` (Roadmap CC Phase 6)
  - `session_handoff` (already shipped)
  - `agent_feedback_report` (Roadmap CC Phase 8)

## UI Surfaces

### Project header actions

- "Refresh index" button with three modes: `if_stale` (default),
  `force` (modifier-click), and a contextual variant when freshness
  panel reports `unknown`
- "Run precommit" button that defaults to `staged` overlay (per Reef 3
  semantics; in pre-Reef-3 world, defaults to working tree)
- Live progress: spinner, current stage if available, elapsed time

### Findings actions

- per-row actions: ack, suppress
- bulk select with shift-click range selection
- bulk action toolbar: "Ack N findings as <category>," "Suppress N"
- confirmation dialog for any action that affects >10 findings
- ack reason field: free text up to 500 chars, optional for `if_stale`
  acks, required for `force` acks
- resolved status is read-only until Reef exposes a findings-management
  API. Studio displays "resolved" when Reef reports the finding is no
  longer active; it does not invent a separate resolve write path.

### MCP run inspector (new section in Tools.tsx)

- list of recent tool runs from `recall_tool_runs` with filters by
  tool name, outcome, time window
- expand row to view full payload (when `includePayload: true`) and
  the structured summary
- "View related answer" jump for runs that produced an answer

### Session inspector (new section in Session.tsx)

- current focus, recent answers, follow-up actions
- one-click "Continue this session" that surfaces the latest evidence
  refs in the active project view

### Agent feedback summary (read-only, new section in Usage.tsx)

- aggregate grade counts by tool name from `agent_feedback_report`
- recent entries with grade, reason codes, and the referenced tool run
- filter by tool, grade, ISO time window

## Bridge Additions

```ts
// added to StudioBridge in apps/studio/src/bridge.ts
export interface StudioBridgeOperatorActions {
  // Confirms with the user via a native dialog before forwarding.
  confirmDestructiveAction(args: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }): Promise<boolean>;
}
```

All the actual work happens via existing HTTP endpoints. The bridge only
adds native confirmation prompts for destructive batch actions.

## Telemetry

Every operator action appends one local Studio audit event. Do not add a
new `RuntimeUsefulnessEvent.decisionKind` for this phase. The current
Roadmap 8.1 contract only accepts usefulness-style grades
(`full | partial | no`) and known decision kinds; operator clicks are
product audit data, not usefulness evaluations.

```ts
{
  kind: "operator_action",
  family: "refresh_index" | "run_precommit" | "ack_finding" | "suppress_finding",
  toolName: <the underlying tool>,
  projectId: string,
  requestId?: string,
  status: "started" | "succeeded" | "failed" | "partial",
  reason?: string;
  capturedAt: string;
}
```

If a finding action already writes to `finding_acks`, the ack ledger
remains the source of truth. The Studio audit event is a UI/operator
trace only.

## Done When

- Refresh index button works end-to-end in a Studio launch: starts
  stale, finishes fresh, freshness panel updates, findings re-rank
- Run precommit button populates `git_precommit_check` findings and
  the findings page reflects them within 2 seconds of completion
- Single-finding ack hides the finding from `ast_find_pattern` and
  `lint_files` queries that opt into the same category
- Bulk ack of 50 findings completes within 5 seconds and the table
  reflects the new state
- MCP run inspector shows the most recent run for each currently-loaded
  page's tool
- Session inspector shows current focus and recent answers
- Agent feedback summary shows aggregate counts
- Every operator action emits exactly one local Studio audit event with
  the correct family and status
- Browser-only mode degrades: actions still work but native confirms
  fall back to `window.confirm`
- CHANGELOG entry under `## [Unreleased]`
- roadmap status updated

## Verification

Smokes:

- new `web-operator-refresh.ts` smoke: seeds stale project, clicks
  refresh, verifies freshness flip and Studio audit event
- new `web-operator-ack.ts` smoke: seeds findings, bulk-acks 5,
  verifies they disappear from the page and the ack ledger has 5 new
  rows
- existing telemetry smokes continue to pass
- new Studio event-table smoke: operator actions write local audit rows
  without changing the `mako_usefulness_events.decision_kind` CHECK

General checks:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke`
- `corepack pnpm run test:smoke:web`

## Risks And Watchouts

- **Refresh during long sessions.** A `force` refresh on a 5k-file
  project can take 30+ seconds. The progress UI must not block the
  rest of the dashboard; route through TanStack Query with optimistic
  state.
- **Ack reversal.** The `finding_ack` ledger is append-only. There is
  no "unack" operation. Suppressing a finding is another ack category,
  not a separate writable lifecycle. Document this in the confirmation
  dialog so users do not expect undo.
- **Bulk action atomicity.** Bulk ack of 100 findings issues 100 store
  inserts. If 5 fail, the user must see partial-success state. Display
  per-finding result, do not roll back.
- **MCP run payload size.** Some tool runs persist large JSON payloads.
  The inspector must lazy-load payloads on row expand, not on initial
  table render.
- **Permission for destructive actions.** macOS may prompt for
  permission when the shell touches user files via the bridge. The
  permission flow should not block the action; if denied, surface a
  clear error.
- **Telemetry contract drift.** Do not add `operator_action` or
  `studio_telemetry` to `RuntimeUsefulnessEvent` as a drive-by. Studio
  audit events are separate unless a later roadmap explicitly widens the
  Roadmap 8.1 contract and store schema.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Mako Studio contract
- [../handoff.md](../handoff.md) - execution rules
- [./studio-1-tauri-shell-foundation.md](./studio-1-tauri-shell-foundation.md)
- [./studio-2-project-state-visualization.md](./studio-2-project-state-visualization.md)
- [../../version-initial-testing/phases/phase-4-index-freshness-and-auto-refresh.md](../../version-initial-testing/phases/phase-4-index-freshness-and-auto-refresh.md)
- `packages/store/src/project-store-runtime-telemetry.ts`
