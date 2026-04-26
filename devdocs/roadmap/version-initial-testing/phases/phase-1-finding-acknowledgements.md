# Phase 1 Finding Acknowledgements

Status: `Shipped`

## Deployment Observation

On 2026-04-22, during a hydration-review session on `courseconnect`, the
agent ran `ast_find_pattern` to surface potential hydration bugs. The
pattern correctly matched several code sites, but on manual review four
of the matches were false positives in that codebase (Server Component
with `new Date()`, proper mount-guard pattern, `PopoverContent` only
rendering when open, `useSyncExternalStore` used correctly).

The agent (and the user) had no first-class way to mark those matches as
verified-safe. Every subsequent `ast_find_pattern` run with a similar
pattern re-surfaces them.

The same operator need exists for `lint_files` and other diagnostic
output, but the shape is different from AST matches:

- `lint_files` already emits stable diagnostic identity through
  `AnswerSurfaceIssue.identity.matchBasedId`
- the existing `findings.status` column in `project.db`
  (`packages/store/src/migration-sql.ts:323`) only applies to persisted
  `findings` rows
- today the tool plane neither persists `lint_files` outputs into
  `findings` nor exposes an acknowledgement / filtering loop

So the missing piece is an operator-facing acknowledgement ledger and
query-time filtering policy, not a second diagnostic identity system.

This phase closes that gap. The feature is intentionally narrow: one
append-only acknowledgement ledger, explicit category-based filtering,
two consumer tools.

## Goal

Ship a typed finding-acknowledgement layer that lets the agent (or the
user) mark specific AST matches or diagnostic findings as verified-safe
under a named category, with a reason, and have subsequent calls that
opt into the same category silently filter those sites.

`ast_find_pattern` adds a first-class ack fingerprint to each match.
`lint_files` reuses the stable identity it already emits
(`finding.identity.matchBasedId`) and treats `finding.code` as the
recommended default category for rule-pack / diagnostic findings.

## Hard Decisions

- **One append-only ack table, two identity sources.**
  Storage stays source-agnostic, but the identity fed into it is not
  invented twice. AST matches use a location-aware fingerprint.
  Diagnostic findings reuse existing `AnswerSurfaceIssue` identity.
- **AST fingerprint v1 is location-aware, not snippet-only.**
  `sha256(json({ tool: "ast_find_pattern", filePath, lineStart, lineEnd,
  columnStart, columnEnd, matchText: normalizedMatchText, version: 1 }))`.
  This distinguishes repeated identical snippets in the same file.
  `normalizedMatchText` is the raw matched text from ast-grep, NFC-normalized,
  with no trimming or whitespace collapse. Computed via the existing
  `hashJson` helper in `packages/tools/src/diagnostics/common.ts` so the
  hashing primitive stays consistent with diagnostic identity.
- **`lint_files` does not get a bespoke finding contract.**
  The tool already returns `AnswerSurfaceIssue`; Phase 1 filters by
  `finding.identity.matchBasedId` and leaves the shared diagnostic schema
  intact unless a later phase needs a broader exposure change.
- **Category is explicit and caller-owned.**
  A caller who wants filtering passes
  `excludeAcknowledgedCategory: "<name>"`. For `lint_files`,
  `finding.code` is the recommended default category. For AST matches,
  the caller intentionally chooses the category.
- **Filter at query time, store forever.**
  Acks are append-only with no-update / no-delete triggers matching
  `tool_runs` and `mako_usefulness_events`. Supersession / roll-forward
  semantics are a future slice.
- **`status` is operator intent and telemetry, not a filter switch.**
  Query-time filtering is status-agnostic: both `ignored` and `accepted`
  rows exclude the matching fingerprint from
  `excludeAcknowledgedCategory` callers. `accepted` exists as an explicit
  "reviewed-and-kept-filtered" marker so reports can distinguish
  suppress-because-wrong from suppress-because-wontfix.
- **Filter dedupes by `(projectId, category, fingerprint)`.**
  Because the ledger is append-only, the same fingerprint may appear
  more than once. `excludeAcknowledgedCategory` treats "any matching row
  exists" as the filter condition. `finding_acks_report` returns all
  rows in reverse-chronological order so the operator can see the full
  history; aggregate counts are by distinct `(category, fingerprint)`.
- **Telemetry-aware.**
  `finding_ack` emits a `RuntimeUsefulnessEvent` with a new
  `finding_ack` decision kind so R8.5 failure clustering can aggregate
  "this rule/category is acked N% of the time" and inform later tuning.

## Scope In

- migration + table + store accessor for `finding_acks`
- typed contracts for ack input/output, including `subjectKind`
- `finding_ack` tool (mutation)
- `finding_acks_report` tool (query)
- extend `ast_find_pattern` output with `ackableFingerprint` per match
- extend `ast_find_pattern` input with `excludeAcknowledgedCategory` and
  return `acknowledgedCount`
- extend `lint_files` input with `excludeAcknowledgedCategory`
- extend `lint_files` output with `acknowledgedCount`
- reuse `finding.identity.matchBasedId` from `lint_files` as the ack
  fingerprint; no parallel lint-only contract
- extend `RUNTIME_USEFULNESS_DECISION_KINDS` with `finding_ack`
- per-slice smokes; end-to-end smokes for both loops:
  `ast_find_pattern -> finding_ack -> ast_find_pattern`
  `lint_files -> finding_ack -> lint_files`

## Scope Out

- no ack filtering in `collectAnswerDiagnostics`, `review_bundle`,
  `verification_bundle`, or artifact generators (clean follow-up)
- no inline `// mako-ignore` comment support (clean follow-up)
- no automatic bridging from `finding_acks` into persisted
  `findings.status` rows (clean follow-up)
- no move-stable / AST-canonical fingerprint beyond the Phase 1
  location-aware key
- no "dangling ack" detection — surfacing acks whose fingerprint no
  longer matches anything is a clean follow-up, modeled on ast-grep's
  `unused-suppression` rule
  (`ast-grep-main/crates/cli/tests/scan_test.rs:150`)
- no UI surface; MCP / CLI only in this phase

## Architecture Boundary

### Owns

- `packages/store/src/project-store-finding-acks.ts` (new)
- `packages/contracts/src/finding-acks.ts` (new)
- `packages/contracts/src/tool-finding-ack-schemas.ts` (new)
- migration `0026_project_finding_acks` in
  `packages/store/src/migration-sql.ts`
- new `finding_ack` and `finding_acks_report` tools in
  `packages/tools/src/finding-acks/` (new directory)
- `ackableFingerprint` field additions to `AstFindPatternMatch`
- filter logic in `packages/tools/src/code-intel/ast-find-pattern.ts`
  and `packages/tools/src/code-intel/lint-files.ts`, where
  `lint_files` consumes `AnswerSurfaceIssue.identity.matchBasedId`

### Does Not Own

- the mutable lifecycle of persisted rows in the existing `findings`
  table; that stays for R4 / R8 integration once diagnostics are
  actually backed by persisted `findings` rows
- artifact generator filters (`review_bundle`, `verification_bundle`)
- inline comment parsing
- any UI

## Contracts

### `FindingAck`

```ts
export const FINDING_ACK_STATUSES = ["ignored", "accepted"] as const;
export type FindingAckStatus = (typeof FINDING_ACK_STATUSES)[number];

export const FINDING_ACK_SUBJECT_KINDS = [
  "ast_match",
  "diagnostic_issue",
] as const;
export type FindingAckSubjectKind =
  (typeof FINDING_ACK_SUBJECT_KINDS)[number];

export interface FindingAck {
  ackId: string;
  projectId: string;
  category: string;               // "hydration-check", rule id, etc.
  subjectKind: FindingAckSubjectKind;
  filePath?: string;              // when the source has a primary path
  fingerprint: string;            // source-specific stable identity
  status: FindingAckStatus;
  reason: string;                 // non-empty operator-supplied explanation
  acknowledgedBy?: string;        // operator identity when available
  acknowledgedAt: string;         // ISO-8601 datetime with offset
  snippet?: string;               // optional operator-visible context
  sourceToolName?: string;        // "ast_find_pattern" | "lint_files" | ...
  sourceRuleId?: string;          // populated when the source is rule-based
  sourceIdentityMatchBasedId?: string;
}
```

### `FindingAckInsert`

```ts
export interface FindingAckInsert {
  ackId?: string;
  projectId: string;
  category: string;
  subjectKind: FindingAckSubjectKind;
  filePath?: string;
  fingerprint: string;
  status: FindingAckStatus;
  reason: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  snippet?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}
```

### Ack Identity Sources

- `ast_find_pattern` emits `ackableFingerprint` on every match.
- `lint_files` findings are acked with
  `fingerprint = finding.identity.matchBasedId`.
- for `lint_files`, `finding.code` is the recommended default category
  and the recommended default `sourceRuleId`, so the ledger row carries
  the rule id directly instead of requiring reconstruction from
  `category`.
- for `ast_find_pattern`, `sourceRuleId` is left unset; AST pattern
  matches are not rule-based.
- `snippet` is persisted as operator-visible context when available; it
  is not the primary identity for diagnostic findings.
- `acknowledgedAt` is stored as SQLite `TEXT NOT NULL DEFAULT
  CURRENT_TIMESTAMP`, matching `tool_runs.started_at` and
  `mako_usefulness_events.captured_at`. Handler-supplied ISO-8601 values
  are accepted but optional.

### Tool: `finding_ack`

Input:

```ts
{
  projectId?: string;
  projectRef?: string;
  category: string;                   // non-empty
  subjectKind: "ast_match" | "diagnostic_issue";
  filePath?: string;
  fingerprint: string;                // required
  snippet?: string;                   // optional persisted context
  status: "ignored" | "accepted";     // defaults to "ignored" at handler level
  reason: string;                     // non-empty
  acknowledgedBy?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}
```

Output:

```ts
{
  toolName: "finding_ack";
  projectId: string;
  ack: FindingAck;
}
```

### Tool: `finding_acks_report`

Input:

```ts
{
  projectId?: string;
  projectRef?: string;
  category?: string;
  subjectKind?: "ast_match" | "diagnostic_issue";
  filePath?: string;
  status?: "ignored" | "accepted";
  since?: string;
  until?: string;
  limit?: number;                     // default 100, cap 500
}
```

Output mirrors the R8 report shape: aggregate counts (by category, by
status, by filePath, by subjectKind) + bounded list of acks +
`truncated` + warnings.

### Extension: `ast_find_pattern`

Input additions:

```ts
{
  // ...existing fields
  excludeAcknowledgedCategory?: string;
}
```

Output additions:

```ts
{
  // ...existing fields
  matches: Array<{
    // ...existing match fields
    ackableFingerprint: string;   // required
  }>;
  acknowledgedCount: number;      // matches filtered out by acks;
                                  // 0 when excludeAcknowledgedCategory
                                  // is unset
}
```

### Extension: `lint_files`

Input additions:

```ts
{
  // ...existing fields
  excludeAcknowledgedCategory?: string;
}
```

Output additions:

```ts
{
  // ...existing fields
  acknowledgedCount: number;      // 0 when excludeAcknowledgedCategory
                                  // is unset
}
```

`lint_files` findings stay as `AnswerSurfaceIssue`. Callers ack them by
passing:

- `subjectKind = "diagnostic_issue"`
- `fingerprint = finding.identity.matchBasedId`
- `category = finding.code` (recommended default)

### Extension: `RUNTIME_USEFULNESS_DECISION_KINDS`

Add `"finding_ack"` to the enum. Emission rules:

- every successful `finding_ack` call emits one
  `RuntimeUsefulnessEvent` row
- `family` = the ack's `category`
- `reasonCodes` = `[status, sourceRuleId]` when `sourceRuleId` is set,
  otherwise `[status]`. No embedded separators; each value is its own
  array entry so R8.5 aggregation by rule is deterministic.

## Execution Flow (slices)

1. **Storage** — `finding_acks` table migration; store accessor with
   insert/query; `computeAstMatchFingerprint(...)` helper. Confirm the
   next available migration slot against the current
   `packages/store/src/project-store.ts` registration list before
   writing SQL — do not hardcode `0026` without verifying. Smoke:
   round-trip + no-update/no-delete trigger enforcement.
2. **Contract** — new types + schemas; extend
   `RUNTIME_USEFULNESS_DECISION_KINDS`; re-export through barrels.
3. **Mutation + query tools** — `finding_ack` and
   `finding_acks_report` on the shared tool plane (new
   `finding_acks` category). Both register as regular tools so
   `tool_runs` capture (`requestId` / `traceId`) happens through the
   existing pipeline — no bespoke capture path. Per-tool smokes.
4. **`ast_find_pattern` wiring** — compute `ackableFingerprint` per
   match; accept `excludeAcknowledgedCategory`; filter + count. Load
   acks for `(projectId, category)` once per call into an in-memory
   `Set<fingerprint>`; never lookup per match. Smoke exercises full
   search -> ack -> re-search loop.
5. **`lint_files` wiring** — filter by
   `finding.identity.matchBasedId`; report `acknowledgedCount`. Same
   single-query ack loading as slice 4. Smoke exercises lint -> ack ->
   re-lint using `finding.code` as category.
6. **Telemetry emission** — `finding_ack` handler emits the runtime
   event; extend the R8 capture smoke to assert the event lands.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `packages/contracts/src/finding-acks.ts`
- `packages/contracts/src/tool-finding-ack-schemas.ts`
- `packages/store/src/project-store-finding-acks.ts`
- `packages/tools/src/finding-acks/index.ts`
- `packages/tools/src/finding-acks/ack.ts` (mutation tool)
- `packages/tools/src/finding-acks/report.ts` (query tool)
- `packages/tools/src/finding-acks/fingerprint.ts` (AST helper)
- `test/smoke/finding-acks-storage.ts`
- `test/smoke/finding-acks-tools.ts`
- `test/smoke/finding-acks-ast-find-pattern.ts`
- `test/smoke/finding-acks-lint-files.ts`

Modify:

- `packages/store/src/migration-sql.ts` — add migration 0026
- `packages/store/src/project-store.ts` — register migration
- `packages/store/src/project-store-methods-index.ts` — wire methods
- `packages/store/src/types.ts` — re-export new types
- `packages/contracts/src/index.ts` — re-export new contracts
- `packages/contracts/src/tools.ts` — re-export tool schemas, extend
  `ToolInput` / `ToolOutput` unions
- `packages/contracts/src/tool-registry.ts` — add new tool names and
  `finding_acks` category
- `packages/contracts/src/runtime-telemetry.ts` — extend
  `RUNTIME_USEFULNESS_DECISION_KINDS` with `"finding_ack"`
- `packages/contracts/src/tool-ast-schemas.ts` — add
  `ackableFingerprint` + `excludeAcknowledgedCategory` +
  `acknowledgedCount`
- `packages/contracts/src/tool-lint-schemas.ts` — add
  `excludeAcknowledgedCategory` + `acknowledgedCount`
- `packages/tools/src/tool-definitions.ts` — register tools
- `packages/tools/src/code-intel/ast-find-pattern.ts` — compute
  AST fingerprint per match; filter by ack
- `packages/tools/src/code-intel/lint-files.ts` — filter by
  `finding.identity.matchBasedId`; report `acknowledgedCount`
- `packages/tools/src/runtime-telemetry/capture.ts` — emit
  `finding_ack` event on success
- `package.json` — register smokes
- `CHANGELOG.md` — one entry under `## [Unreleased]` -> `### Added`

Keep unchanged:

- R4 `findings` table / schema — stays the mutable lifecycle table for
  persisted findings; Phase 1 does not auto-populate it
- every artifact generator, `collectAnswerDiagnostics`,
  `review_bundle`, `verification_bundle` (follow-up phase)

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- end-to-end AST loop: `ast_find_pattern` returns N matches; ack one
  with `finding_ack`; re-run `ast_find_pattern` with the same category;
  confirm N-1 matches and `acknowledgedCount=1`
- end-to-end diagnostics loop: `lint_files` returns M findings; ack one
  with:
  `subjectKind="diagnostic_issue"`,
  `category=finding.code`,
  `fingerprint=finding.identity.matchBasedId`;
  re-run `lint_files` with the same category; confirm M-1 findings and
  `acknowledgedCount=1`
- `finding_acks_report` returns the ack with aggregate counts
- `RuntimeUsefulnessEvent` row appears in `mako_usefulness_events`
  with `decisionKind = "finding_ack"`

## Done When

- migration `0026` shipped and registered
- `finding_ack` + `finding_acks_report` tools callable over MCP / CLI
- `ast_find_pattern` and `lint_files` honor
  `excludeAcknowledgedCategory`
- every AST match output carries `ackableFingerprint`
- `lint_files` findings are ackable via
  `finding.identity.matchBasedId`
- end-to-end smokes covering both loops are green
- `RuntimeUsefulnessEvent` with `finding_ack` kind lands on ack calls
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **AST line motion invalidates acks.**
  Phase 1 includes coordinates in the AST fingerprint to avoid
  same-snippet aliasing in one file. If real use shows line churn is too
  noisy, a later phase can move to AST-aware context / neighborhood
  hashing.
- **Category sprawl.**
  Operators may invent dozens of categories. `finding_acks_report` with
  no filter should list all categories so the operator can see the set.
  For `lint_files`, `finding.code` is the recommended default because it
  already names the detector / rule.
- **Diagnostics without a primary `path`.**
  Some `AnswerSurfaceIssue` instances may only expose producer /
  consumer context or evidence refs. Store `filePath` when available;
  report surfaces must tolerate `null`.
- **Filter opt-in is explicit.**
  A caller who forgets to pass the category gets unfiltered results.
  That is a feature (audit visibility), not a bug. Document it in the
  tool descriptions.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- `packages/contracts/src/answer.ts` — existing diagnostic identity
  contract (`AnswerSurfaceIssue.identity.matchBasedId`)
- `packages/tools/src/diagnostics/common.ts` — shared diagnostic
  identity builder
- `packages/contracts/src/runtime-telemetry.ts` — R8 contract extended
- `packages/tools/src/code-intel/ast-find-pattern.ts` — extension
  target
- `packages/tools/src/code-intel/lint-files.ts` — extension target
- `packages/store/src/migration-sql.ts` — append-only audit pattern to
  mirror for the new ack ledger
