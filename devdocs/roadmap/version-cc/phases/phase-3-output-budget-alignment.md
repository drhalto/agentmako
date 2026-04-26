# Phase 3 CC — Output Budget Alignment

Status: `Complete`

## Deployment Observation

Claude Code auto-handles large tool results. `CC/constants/toolLimits.ts:49`:

```ts
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
```

When any tool (or collection of parallel tools in one turn) produces
more than ~200 KB of content, CC persists the largest blocks to disk
under a tool-results directory and replaces them with a **preview +
compact inferred schema + filepath + instruction to Read / jq**. The
model keeps the signal; the context window stays bounded.
`CC/services/mcp/client.ts:2719-2764` — `processMCPResult` does this
per MCP result, including running `inferCompactSchema` over
`structuredContent` so the preview carries `"JSON with schema: {...}"`.

The 200 KB figure is the **per-message aggregate** budget. CC also
applies:

- `DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000` — per-tool default persist
  threshold (`constants/toolLimits.ts:13`). Individual tools may set
  a higher `maxResultSizeChars` on their definition; most MCP tools
  sit at `100_000`. Mako's per-tool default is effectively the MCP
  default.
- `MAX_TOOL_RESULT_BYTES = 400_000` — per-tool absolute byte cap
  derived from `MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN`
  (`constants/toolLimits.ts:33`).
- `ENABLE_MCP_LARGE_OUTPUT_FILES` — env kill-switch. When explicitly
  falsy, CC falls back to truncation instead of disk-persisting
  (`services/mcp/client.ts:~2738`). Safe default assumption: feature
  is on.
- **Images fall back to truncation.** `contentContainsImages` in
  `processMCPResult` skips the persist path when any content block is
  an image (`services/mcp/client.ts:~2757`); the image compression
  logic defeats JSON persistence and makes images unreadable via file
  preview. Text-only tool outputs are the ones that benefit from
  raising defaults.
- GrowthBook `tengu_hawthorn_window` can override the 200 KB aggregate
  at runtime (`utils/toolResultStorage.ts:getPerMessageBudgetLimit`).

Mako truncates *before* any of that. Default per-tool caps today:

- `ast_find_pattern.maxMatches` — default 500, cap 2000
- `ast_find_pattern.maxFiles` — default 500, cap 5000
- `lint_files.maxFindings` — default 500, cap 1000
- `repo_map.tokenBudget` — default 1024, cap 16384
- `repo_map.maxFiles` — default 60, cap 500
- `repo_map.maxSymbolsPerFile` — default 6, cap 32
- artifact-side: basis lists, evidence lists, likelyMoveSurfaces, etc.
  all have internal slicing

Some of these caps are load-bearing for **latency** (scanning 5000
files through ast-grep is not free). Others are load-bearing for
**bytes only** — the tool computes the full result cheaply and then
discards it to keep the output "small." That second class is where
mako is double-truncating: we drop detail at the tool boundary that
CC would have happily persisted to disk with a readable preview.

The cost shows up concretely when an agent asks for
`ast_find_pattern { pattern: "useEffect($FN, [])" }` on a large Next.js
project and gets the first 100 matches with `truncated: true`. The
agent has two bad options: raise `maxMatches` and retry (one wasted
turn), or grep around blind (lower-quality answer). Either way, the
session got slower than it needed to.

## Goal

Identify which mako truncation caps are **byte-cost** vs **latency-
cost**, raise the byte-cost defaults so CC's large-output handler does
the work, and document each cap with its rationale so future changes
don't accidentally re-tighten them. Latency-cost caps stay where they
are — CC's disk-persist doesn't help if the tool itself hasn't returned
yet.

This phase intentionally does not add per-client defaults. Current
defaults live as code-level constants and schema descriptions; making
them per-client would require `ToolServiceOptions` / session plumbing
and changes inside tool bodies. Instead this phase raises globally
conservative byte-cost defaults validated against CC's large-output
behavior and existing clients.

## Hard Decisions

- **Distinguish cost class per cap.**
  Every cap gets labeled *byte-cost* (the work was already done; the
  cap just limits what's returned), *latency-cost* (the cap bounds
  how much work is done), or *shape-cost* (the cap keeps the output
  readable — `repo_map.tokenBudget` is this). Byte-cost caps are
  candidates for raising. Latency and shape caps stay.
- **No per-client defaults in this phase.**
  The implementation changes constants and schema descriptions only.
  If a later client genuinely needs different defaults, add explicit
  `ToolServiceOptions` / session plumbing then; do not smuggle client
  branching into individual tools now.
- **Raise byte-cost defaults toward CC's ~200 KB limit, not past it.**
  The goal isn't to hand CC a 5 MB blob. It's to stop cutting off at
  100 matches when we could have returned 500 at no extra cost.
  Concrete targets stated per-tool in the file plan.
- **Keep the current hard max values** as the upper bound. Today's
  max of `maxMatches: 2000` stays — the default just moves closer to
  it.
- **Output schema inclusion is free.** Every mako tool's output is
  already a typed JSON object, so CC's `inferCompactSchema` works
  out of the box when the output lands as `structuredContent`.
  Verified already.
- **Document the limits alongside the fields.**
  Every `maxX` parameter in `packages/contracts/src/tool-*-schemas.ts`
  gets a one-line JSDoc explaining its cost class and whether raising
  it has observed pain. Future phases reference that to know if a
  change is safe.
- **No new knobs.**
  Resist the temptation to add per-project truncation overrides or a
  "give me everything" flag. The phase is about re-setting defaults,
  not adding surface area.

## Scope In

- audit every `maxX` cap in
  `packages/contracts/src/tool-ast-schemas.ts`,
  `tool-lint-schemas.ts`, `tool-repo-map-schemas.ts`, and (where
  present) artifact schemas; label each byte-cost / latency-cost /
  shape-cost
- raise byte-cost defaults per the file plan; defaults remain
  code-level constants mirrored by schema descriptions
- add JSDoc on each cap stating its cost class and the rationale
  for its current default
- smoke: realistic large-output case no longer hits mako-side caps
  on courseconnect-sized input (asserted via a fixture project sized
  to produce > 100 `ast_find_pattern` matches)
- smoke update (if needed): existing `ast-find-pattern.ts` smoke's
  truncation assertion gets re-checked against the new default

## Scope Out

- raising max values (keep current ceilings)
- adding streaming / chunked output (different mechanism)
- changing artifact generators' internal slicing (separate phase
  if ever needed — today they compose bounded inputs)
- making caps configurable per-project (no observed need)
- changing CC-side handling (not ours to change)

## Architecture Boundary

### Owns

- `packages/contracts/src/tool-ast-schemas.ts` — `maxMatches`,
  `maxFiles` defaults + JSDoc
- `packages/contracts/src/tool-lint-schemas.ts` — `maxFindings`
  default + JSDoc
- `packages/contracts/src/tool-repo-map-schemas.ts` — default audit
  (`tokenBudget`, `maxFiles`, and `maxSymbolsPerFile` are
  shape-cost; confirm and document)
- `packages/tools/src/code-intel/ast-find-pattern.ts`,
  `lint-files.ts`, `repo_map.ts` — `DEFAULT_MAX_*` constants
- `test/smoke/mcp-large-output-passthrough.ts` (new)

### Does Not Own

- CC's disk-persist policy or the 200 KB budget
- `AgentClient` adapter contracts or session plumbing
- artifact generators' internal composition (they take bounded
  inputs; this phase doesn't re-audit them)
- any tool's Zod schema shape — fields stay the same; defaults
  and JSDoc are all that change

## Contracts

No new types. Defaults and JSDoc only.

Example of the JSDoc pattern to apply:

```ts
// packages/contracts/src/tool-ast-schemas.ts
maxMatches: z
  .number()
  .int()
  .positive()
  .max(2000)
  .optional()
  // Cost class: byte-cost. Increasing this does not change how much
  // work the tool does — ast-grep already scans every eligible file
  // before the cap is applied. CC's large-output handler persists
  // results > ~200 KB to disk with a preview, so cutting off early
  // at the mako boundary is net-harmful. Default raised from 100 to
  // 500 (Phase CC.3).
  .describe("Maximum matches returned in the matches array..."),
```

## Execution Flow (slices)

1. **Audit** — go through every `maxX` cap in the three code-intel
   schemas. Label each in a scratch table: name, current default,
   hard max, cost class, notes. Publish the table as an appendix to
   this phase doc before any default moves.
2. **Raise byte-cost defaults** —
   - `ast_find_pattern.maxMatches`: **100 → 500**
   - `ast_find_pattern.maxFiles`: stays **500** (latency-cost; ast-grep
     per-file is non-trivial on TSX)
   - `lint_files.maxFindings`: **200 → 500** (byte-cost; lint already
     ran)
   - `repo_map.tokenBudget`: stays **1024** (shape-cost; too big a
     map stops being a map)
   - `repo_map.maxFiles`: stays **60** (shape-cost; ranking goes
     noisy past ~100)
3. **Document every cap** — JSDoc pass over each of the five caps
   stating cost class and rationale.
4. **Smoke** — new
   `test/smoke/mcp-large-output-passthrough.ts`:
   - seed a project with enough content to produce 300+
     `ast_find_pattern` matches for a common pattern
   - call the tool with defaults; assert `truncated: false` and
     `matches.length >= 300`
   - call `lint_files` on a rule-pack that trips 300+ findings;
     assert `truncated: false`
   - verify the result serializes to something CC would either
     accept whole or persist with a schema (check total byte size is
     reasonable — i.e. not 50 MB)
5. **Regression check** — run `ast-find-pattern.ts` and `lint-files.ts`
   smokes; their existing truncation assertions still fire at their
   respective `maxMatches: 2` / `maxFindings: 1` explicit low caps.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `test/smoke/mcp-large-output-passthrough.ts`

Modify:

- `packages/contracts/src/tool-ast-schemas.ts` — `maxMatches` JSDoc
  + default
- `packages/contracts/src/tool-lint-schemas.ts` — `maxFindings` JSDoc
  + default
- `packages/contracts/src/tool-repo-map-schemas.ts` — JSDoc on
  existing caps (no default change)
- `packages/tools/src/code-intel/ast-find-pattern.ts` —
  `DEFAULT_MAX_MATCHES` constant
- `packages/tools/src/code-intel/lint-files.ts` —
  `DEFAULT_MAX_FINDINGS` constant
- `package.json` — register smoke
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Changed`
- this phase doc — fill in the audit appendix after slice 1

Keep unchanged:

- tool execution flow and behavior aside from the default cap
  constants listed above
- every `_meta` or progress channel
- every hard max value
- every artifact generator

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- appendix in this phase doc lists every cap audited with cost class
- new large-output smoke passes with new defaults
- existing `ast-find-pattern.ts`, `lint-files.ts`, `repo-map.ts`
  smokes still pass (their explicit low caps still fire truncation)
- no tool output exceeds ~1 MB on the seeded fixture (sanity
  check — if we're suddenly producing 10 MB results, something is
  wrong)

## Done When

- audit appendix populated
- byte-cost defaults raised per file plan
- every cap has a JSDoc cost-class annotation
- new smoke green; existing smokes green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **CI memory / time pressure.**
  A smoke that seeds 300+ matches is heavier than existing smokes.
  Keep the fixture proportionate — the goal is to cross mako's old
  default, not to torture-test the tool. A fixture that produces
  600 matches is plenty.
- **Default change breaks an existing caller's budget assumption.**
  Any caller that assumed "I'll always get at most 100 matches and
  plan my prompt accordingly" is now surprised. Mitigation: CC
  itself is the main consumer and handles >100 results gracefully.
  Other MCP clients following the contract see the new default in
  the schema metadata. Surfaces that explicitly set `maxMatches` are
  unaffected.
- **Hidden latency cost of raising `lint_files.maxFindings`.**
  `lint_files` currently runs the full diagnostic pass regardless of
  cap — the cap just slices the result. Verified against
  `packages/tools/src/code-intel/lint-files.ts`. If that ever
  changes (e.g. to early-exit on cap), the cap becomes latency-cost
  and this phase's rationale no longer applies.
- **CC's 200 KB budget changes.**
  The number is a GrowthBook-adjustable constant in CC
  (`tengu_hawthorn_window`). Our defaults assume a stable ~200 KB
  ceiling. If CC tightens it, we'd want to tighten ours. Realistic
  outcome: CC loosens, not tightens, as context windows grow — our
  new defaults still fit.
- **Per-tool threshold is 50 KB, not 200 KB.**
  `DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000` is CC's per-tool persist
  threshold; the 200 KB cap is the per-message aggregate. A single
  mako tool producing 60 KB trips the per-tool persist path before
  the aggregate matters. Raising mako defaults should target the
  50 KB-ish window for per-call bytes, not 200 KB — anything larger
  per tool call is already going to disk on CC's side. This does not
  change the phase's posture (that's still "let CC persist it"), but
  it sets the right mental model for the defaults.
- **Images are exempt from disk-persist.**
  `processMCPResult` falls back to truncation when any content block
  is an image. Mako tools that ever return images (none today) must
  keep their own caps live; raising defaults helps text-only tools
  only.

## Appendix: Cap Audit

*(Populated during slice 1.)*

| Tool | Cap | Current default | Hard max | Cost class | Action |
|------|-----|-----------------|----------|------------|--------|
| `ast_find_pattern` | `maxMatches` | 100 | 2000 | byte | raise → 500 |
| `ast_find_pattern` | `maxFiles` | 500 | 5000 | latency | keep |
| `lint_files` | `maxFindings` | 200 | 1000 | byte | raise → 500 |
| `repo_map` | `tokenBudget` | 1024 | 16384 | shape | keep |
| `repo_map` | `maxFiles` | 60 | 500 | shape | keep |
| `repo_map` | `maxSymbolsPerFile` | 6 | 32 | shape | keep |

Audit confirmation:

- `ast_find_pattern.maxMatches` is byte-cost: the tool scans eligible
  files and applies the match cap while building the returned array;
  default raised to 500.
- `ast_find_pattern.maxFiles` is latency-cost: it stops the indexed
  file scan before parsing/searching more files; default kept at 500.
- `lint_files.maxFindings` is byte-cost: `collectDiagnosticsForFiles`
  runs before slicing findings; default raised to 500.
- `repo_map.tokenBudget`, `repo_map.maxFiles`, and
  `repo_map.maxSymbolsPerFile` are shape-cost: they preserve the
  outline's readability rather than protecting CC's byte budget;
  defaults kept.
- No artifact schema cap fields were in this phase's concrete target
  set; artifact generator slicing remains out of scope.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- `CC/constants/toolLimits.ts:49` — `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`
  (per-message aggregate)
- `CC/constants/toolLimits.ts:13` — `DEFAULT_MAX_RESULT_SIZE_CHARS`
  (per-tool default persist threshold)
- `CC/constants/toolLimits.ts:33` — `MAX_TOOL_RESULT_BYTES`
  (per-tool absolute cap)
- `CC/services/mcp/client.ts:2719-2764` — `processMCPResult`
  + `transformMCPResult` + image-fallback branch
- `CC/utils/toolResultStorage.ts:getPerMessageBudgetLimit` —
  GrowthBook override (`tengu_hawthorn_window`)
- `CC/utils/mcpOutputStorage.ts:16-27` — `getFormatDescription`
- `packages/contracts/src/tool-ast-schemas.ts` — current caps
- `packages/contracts/src/tool-lint-schemas.ts` — current caps
- `packages/contracts/src/tool-repo-map-schemas.ts` — current caps
