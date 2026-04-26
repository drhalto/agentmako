# Phase 6 CC — Session Recall

Status: `Complete`

## Deployment Observation

Mako persists a rich per-project memory in SQLite:

- `answer_traces` — every `ask` / composer answer, with packet,
  evidence, trust state, and confidence
- `tool_runs` — every tool invocation with input summary, outcome,
  duration, requestId
- `finding_acks` — every acknowledged false-positive / reviewed
  finding (Initial Testing Phase 1)
- `workflow_followups` — follow-up actions linked back to origin
  queries
- `mako_usefulness_events` — R8.1 telemetry

None of this is queryable from the tool plane.

Concrete scenario: an agent works through an admin-auth change in
session 1. Along the way, `ask` answers "how is `admin_ban_user`
authorized?" — a trust-stable answer with 6 evidence refs lands in
`answer_traces`. Session ends. Next day, a different CC session picks
up the same project. The agent needs the same context. Three options:

1. Re-ask `ask "how is admin_ban_user authorized?"` — burn a fresh
   answer loop turn, same grep + compose + trust-state work all
   over.
2. Grep around blind — lower-quality answer.
3. Read the project's `answer_traces` table directly via `db_ping`
   + ad-hoc SQL — not a thing the tool plane exposes.

All three are wrong. The correct answer is: *we already figured that
out yesterday*. Mako's own memory holds it. Expose it.

Separately, `tool_runs` holds the trace of what the previous session
actually did. "Did we already run `tenant_leak_audit` this week? What
did it find?" is a perfectly reasonable agent question with no answer
today.

## Goal

Ship two new read-only tools that surface mako's persistent memory
to the agent:

1. **`recall_answers`** — search / list `answer_traces` with filters:
   text query (FTS over `query_text` + optional `answer_markdown`),
   `queryKind`, `supportLevel`, `trustState`, time window.
2. **`recall_tool_runs`** — list `tool_runs` with filters: `toolName`,
   `outcome`, time window, `requestId`. Returns summaries suitable
   for the agent to spot "we did this before" without dumping entire
   payloads.

Both read-only, bounded, category `session_recall`.

Follow-ups (not in this phase): `recall_findings` over `finding_acks`,
`recall_followups` over `workflow_followups`. Land those when a real
agent scenario asks for them.

## Hard Decisions

- **Surface: tools, not resources or skills.**
  MCP offers three model-visible surfaces: tools, resources
  (URI-keyed fetches), and prompts / skills (slash-commands yielding
  prose). Recall needs structured input (text query, `queryKind`,
  time window, `limit`) and structured output (packet summaries,
  trust state, truncation flag). Only tools fit. See the roadmap's
  **Surface Choice** section for the full rationale and what this
  does not rule out (a future resource-based *browsable catalog* of
  answer traces is explicitly in scope for a later phase).

- **Read-only, no mutation surface.**
  Nothing in this phase updates existing records. `finding_ack`
  (Phase 1 of Initial Testing) already handles one kind of
  operator correction; these tools are strictly about surfacing
  prior state.

- **Bounded + truncated like every other mako tool.**
  `recall_answers` caps at 5 results default, 100 max. `recall_tool_runs`
  caps at 50 default, 500 max. Output includes `truncated` flag +
  warning when the cap fires.

- **Query text uses FTS when available, LIKE fallback.**
  `answer_traces.query_text` isn't FTS-indexed today — adding an
  FTS5 virtual table is part of this phase's migration. Fallback to
  `LIKE '%term%'` on the raw column for projects without the
  migration applied yet.

- **Returns the packet + evidence + trust state — not just the
  markdown.**
  The whole point is that `answer_traces.packet_json` carries
  typed structure the agent can reason over. Returning only
  `answer_markdown` throws that away.

- **Time window is the primary filter for freshness.**
  Default window: last 30 days. Agents investigating a change
  usually care about recent work; a historical sweep is an
  explicit opt-in via `since` / `until`.

- **`recall_tool_runs` returns input/output summaries, not full
  payloads.**
  The full JSON payloads live in `tool_runs.payload_json`.
  Surfacing them by default would blow context budgets. Return
  `inputSummary` (already stored truncated) + an `outcome` + a
  `durationMs`. Full-payload fetch is an explicit `includePayload:
  true` opt-in.

- **This phase does not touch the answer loop itself.**
  No automatic "we already answered this; returning cached" logic.
  The agent decides when to recall vs re-ask. That preserves
  freshness control.

## Scope In

- new SQLite migration adding an FTS5 virtual table over
  `answer_traces.query_text` (+ optional `answer_markdown` column
  for future ranking)
- new store accessors: `recallAnswersImpl`, `recallToolRunsImpl`
- new contract types: `RecallAnswersToolInput/Output`,
  `RecallToolRunsToolInput/Output`
- new tools: `recall_answers`, `recall_tool_runs`, category
  `session_recall` (new `MAKO_TOOL_CATEGORIES` entry)
- register both in `tool-definitions.ts`
- `ClaudeCodeClient` (Phase 1) gets `searchHint` entries for both
- smoke: `test/smoke/recall-answers.ts` (round-trip: seed 3 answer
  traces; query by text, by queryKind, by time window)
- smoke: `test/smoke/recall-tool-runs.ts` (round-trip: seed 5 tool
  runs; filter by toolName, outcome; assert summary fields present,
  payload absent unless requested)

## Scope Out

- automatic cache / dedup of identical re-asks (separate concern;
  would need freshness heuristics and a learned component)
- writing to `answer_traces` / `tool_runs` — existing writers are
  unchanged
- mutation tools over recall (no "delete this trace"; follow-up
  phase if operator evidence demands it)
- `recall_findings` / `recall_followups` (follow-on phases)
- cross-project recall (each project is isolated by design)
- summary / clustering over many traces (R8.2+ territory)

## Architecture Boundary

### Owns

- new migration `PROJECT_MIGRATION_0028_ANSWER_TRACE_RECALL_FTS_SQL` in
  `packages/store/src/migration-sql.ts`
- new store accessor file
  `packages/store/src/project-store-recall.ts`
- `packages/store/src/project-store-methods-recall.ts` — register
  the new methods on `ProjectStore`
- new contract file
  `packages/contracts/src/tool-recall-schemas.ts`
- `packages/contracts/src/tool-registry.ts` — add tool names +
  `session_recall` category
- `packages/contracts/src/tools.ts` — re-export, extend
  `ToolInput` / `ToolOutput` unions
- new tool files in `packages/tools/src/session-recall/`
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — add
  hints
- `test/smoke/recall-answers.ts`, `test/smoke/recall-tool-runs.ts`
  (new)

### Does Not Own

- existing answer-loop write paths (`saveAnswerTraceImpl` etc.)
- existing tool-runs write paths
- the answer loop — no automatic recall

## Contracts

### `RecallAnswersToolInput` / `Output`

```ts
// packages/contracts/src/tool-recall-schemas.ts
import { z } from "zod";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";
import { QueryKindSchema, AnswerTrustStateSchema } from "./...";
// plus existing trace-shape types

export interface RecallAnswersToolInput {
  projectId?: string;
  projectRef?: string;
  /** Text query, matched against query_text (FTS when available). */
  query?: string;
  queryKind?: QueryKind;
  supportLevel?: "native" | "adapted" | "best_effort";
  trustState?: AnswerTrustState;
  /** ISO-8601 with offset. Default window: now - 30d → now. */
  since?: string;
  until?: string;
  /** Max results. Default 5, cap 100. */
  limit?: number;
}

export interface RecalledAnswer {
  traceId: string;
  queryKind: QueryKind;
  queryText: string;
  createdAt: string;
  supportLevel: "native" | "adapted" | "best_effort";
  trustState?: AnswerTrustState;
  answerConfidence?: number;
  answerMarkdown?: string;
  // Packet + evidence summaries (not full payloads) so context stays
  // bounded while still being structurally useful.
  packetSummary: {
    family: string;
    basisCount: number;
    evidenceRefCount: number;
  };
}

export interface RecallAnswersToolOutput {
  toolName: "recall_answers";
  projectId: string;
  generatedAt: string;
  matchCount: number;          // total matching the filter, pre-cap
  truncated: boolean;
  answers: RecalledAnswer[];
  warnings: string[];
}
```

### `RecallToolRunsToolInput` / `Output`

```ts
export interface RecallToolRunsToolInput {
  projectId?: string;
  projectRef?: string;
  toolName?: string;
  outcome?: "success" | "failed" | "error";
  requestId?: string;
  since?: string;
  until?: string;
  limit?: number;              // default 50, cap 500
  includePayload?: boolean;    // default false
}

export interface RecalledToolRun {
  runId: string;
  toolName: string;
  outcome: "success" | "failed" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestId?: string;
  inputSummary: unknown;       // stored truncated already
  outputSummary?: unknown;
  payload?: unknown;           // only populated when includePayload
  errorText?: string;
}

export interface RecallToolRunsToolOutput {
  toolName: "recall_tool_runs";
  projectId: string;
  generatedAt: string;
  matchCount: number;
  truncated: boolean;
  toolRuns: RecalledToolRun[];
  warnings: string[];
}
```

### New tool category

```ts
// packages/contracts/src/tool-registry.ts
export const MAKO_TOOL_CATEGORIES = [
  // ...existing entries
  "session_recall",
] as const;
```

## Execution Flow (slices)

1. **FTS migration** — added migration
   `PROJECT_MIGRATION_0028_ANSWER_TRACE_RECALL_FTS_SQL` creating an FTS5 virtual table
   `answer_traces_fts` with `content='answer_traces'` content-table
   binding and INSERT / DELETE / UPDATE triggers to keep it in
   sync. Backfill existing rows on migration apply. Smoke:
   migration round-trips; FTS query returns expected rows.
2. **Store accessors** — `recallAnswersImpl` + `recallToolRunsImpl`
   in `packages/store/src/project-store-recall.ts`. FTS path for
   `query`; LIKE fallback. Windowed filter. Both return the full
   match count (not just the page) so the tool layer can report
   truncation accurately.
3. **Contracts** — `tool-recall-schemas.ts` with input / output
   shapes and zod schemas. Extend `MAKO_TOOL_CATEGORIES`,
   `ToolInput` / `ToolOutput` unions, re-exports.
4. **Tools** — `packages/tools/src/session-recall/` contains
   `recall-answers.ts`, `recall-tool-runs.ts`, and `index.ts`. Both
   tools are read-only; both use `withProjectContext` (which honors the
   `ProjectStoreCache` from Initial Testing Phase 2).
5. **Registration** — add both to `TOOL_DEFINITIONS` with
   `annotations: { readOnlyHint: true }`. Register smokes.
6. **CC metadata** — add entries to `CLAUDE_CODE_TOOL_HINTS`:
   - `recall_answers`: `"prior answers memory session history trust"`
   - `recall_tool_runs`: `"previous tool runs history durations outcomes"`
   Neither gets `alwaysLoad` — these are "I remember I did something"
   follow-ups, not turn-1 tools.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/store/src/project-store-recall.ts`
- `packages/contracts/src/tool-recall-schemas.ts`
- `packages/tools/src/session-recall/index.ts`
- `packages/tools/src/session-recall/recall-answers.ts`
- `packages/tools/src/session-recall/recall-tool-runs.ts`
- `test/smoke/recall-answers.ts`
- `test/smoke/recall-tool-runs.ts`

Modify:

- `packages/store/src/migration-sql.ts` — new FTS migration
- `packages/store/src/project-store.ts` — register migration
- `packages/store/src/project-store-methods-recall.ts` — wire
  accessors
- `packages/store/src/types.ts` — recall result/input types
- `packages/contracts/src/tools.ts` — extend unions
- `packages/contracts/src/tool-registry.ts` — add tool names +
  category
- `packages/tools/src/tool-definitions.ts` — register
- `packages/tools/src/agent-clients/claude-code-hints.ts` — add
  hints
- `package.json` — register smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Added`

Keep unchanged:

- answer-loop write paths
- tool-runs write paths
- every existing tool

## Verification

Required commands:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:smoke`

Verified during implementation:

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/recall-answers.ts`
- `node --import tsx test/smoke/recall-tool-runs.ts`
- `node --import tsx test/smoke/mcp-tool-metadata.ts`
- `corepack pnpm run test:smoke`

Required runtime checks:

- `recall-answers.ts`: seed traces with distinct `queryText`;
  recall by exact phrase returns the matching one; recall by
  `queryKind` filter narrows; `since` filter narrows; `limit: 1`
  returns `truncated: true`; text recall keeps `matchCount`
  pre-limit while fetching only limited answer rows.
- `recall-tool-runs.ts`: seed 5 runs (3 success, 2 failed); filter
  by `outcome: 'failed'` returns 2; `includePayload: false` returns
  no `payload` field on rows; `includePayload: true` returns it.
- FTS migration: apply on a fresh project store; backfill existing
  rows; INSERT a new trace afterward; confirm the FTS index picks
  it up automatically via the trigger; UPDATE and DELETE a trace and
  confirm the FTS index stays in sync.
- MCP tools/list includes `recall_answers` + `recall_tool_runs`
  with correct `anthropic/searchHint` values; the tool-search catalog
  carries category `session_recall`.

## Done When

- FTS migration shipped and registered.
- Both store accessors work with FTS + LIKE fallback and SQL-level
  result limits.
- Both contracts + schemas shipped.
- Both tools registered; MCP tools/list carries them with hints and
  tool-search catalog entries carry the category.
- Both focused smokes and the full smoke suite are green.
- `corepack pnpm run typecheck` is green.
- CHANGELOG entry present.

## Risks And Watchouts

- **FTS trigger correctness across INSERT / UPDATE / DELETE.**
  `answer_traces` rows are append-mostly today, but the migration
  still ships all three triggers because external-content FTS is
  painful to repair later. Smoke verifies insert, update, and delete
  behavior explicitly.
- **Bounded output still blows context on long answer_markdowns.**
  `answer_markdown` can be kilobytes. Default recall response
  includes it; consider truncating to first N chars with a
  continuation pointer. Trade-off: full markdown is useful for
  resuming context. Resolution: include full markdown for now and use
  the `limit: 5` default (sum of 5 answers is survivable for context).
  If this proves too large, add `markdownPreviewChars` in a follow-up;
  do not add that knob in this phase.
- **FTS tokenization quirks.**
  Uses `porter unicode61` tokenizer (matches the rest of mako).
  Identifier-heavy queries (e.g. `admin_ban_user`) may tokenize
  poorly. LIKE fallback is always available; document in the
  tool description that exact-identifier queries may want to use
  `query: "admin_ban_user"` in both modes (the tool runs both
  and merges, OR falls through to LIKE when FTS gives nothing).
- **Privacy: persistent memory across sessions.**
  Intentional. Recall is scoped to the current project's SQLite;
  no cross-project surface. `agentmako detach --purge` already
  blows the store away per Initial Testing tooling. Document in
  the tool description that recall reads are reading persisted
  history.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [./phase-1-tool-discoverability.md](./phase-1-tool-discoverability.md)
  — `CLAUDE_CODE_TOOL_HINTS` extension target
- `packages/store/src/migration-sql.ts` — migration pattern
- `packages/store/src/project-store-queries.ts` —
  `saveAnswerTraceImpl` / `getAnswerTraceImpl` call shape
- `packages/store/src/project-store-tool-runs.ts` — tool-runs write
  path this phase reads from
- `packages/store/src/project-store-runtime-telemetry.ts` — FTS /
  aggregate pattern to mirror
