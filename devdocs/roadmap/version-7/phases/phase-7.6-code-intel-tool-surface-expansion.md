# Phase 7.6 Code-Intel Tool Surface Expansion

Status: `Shipped`

## Placement

Opens after 7.5 shipped. The 7.5 closeout rule says "no `7.6` is planned by
default. A later phase should only be added if a truly separate operational
packaging problem appears after evaluation." This is that case: the 7.5
eval-cycle surfaced that several code-intel primitives were already shipping
internally but not on the public tool plane — `findAstMatches`,
`collectDiagnosticsForFiles` — and that aider-style repo orientation was a
real gap for agents meeting forgebench cold. That is a separable problem
from 7.5's usefulness evaluation, so it gets its own phase rather than
extending 7.5 retroactively.

## Goal

Expose the code-intel primitives that already ship inside `@mako-ai/tools` as
public tools on the shared tool plane, and add one genuinely medium-effort
repo-orientation tool (`repo_map`) because mako has ~90% of the aider-style
substrate already and only lacks the budgeter + formatter.

## Rules

- Reuse what already ships. Do not introduce new editing surfaces (deferred
  per 7.5 dismount rule).
- Read-only only. `ast_replace_pattern` / any edit / any git mutation stays
  deferred.
- Mirror the existing tool-plane conventions exactly (contract + wrapper +
  smoke + registry entry). No new category unless genuinely distinct.
- Bound every tool with explicit caps so agent context stays small by
  default; require explicit caller opt-in to widen.

## Shipped Slice

### 1. `ast_find_pattern` (code_intel category — shipped)

Read-only structural pattern search wrapping `@ast-grep/napi` over every
indexed TS/TSX/JS/JSX file. Ships on the shared tool plane as
`ast_find_pattern`.

- contract: `packages/contracts/src/tool-ast-schemas.ts`
- implementation: `packages/tools/src/code-intel/ast-find-pattern.ts`
- smoke: `test/smoke/ast-find-pattern.ts`
- forgebench probe: `scripts/forgebench-ast-find.ts`

Typed inputs: pattern, optional captures, optional language filter
(`ts` / `tsx` / `js` / `jsx`), optional minimal `pathGlob`, bounded
`maxMatches` (default 100, cap 2000) + `maxFiles` (default 500, cap 5000).
Typed matches: file path, language, line/column range, raw match text,
captured metavariables.

Warnings surface truncation reason, empty-filter-match, and a zero-match
pattern-syntax hint (so users catch receiver-specificity surprises like
`supabase.rpc` vs `client.rpc`).

### 2. `lint_files` (code_intel category — shipped)

Exposes `collectDiagnosticsForFiles` (shipped during 7.5 close for
`review_bundle`) as a public tool. Runs rule-pack + alignment diagnostics on
an arbitrary indexed file set and returns typed `AnswerSurfaceIssue[]`.

- contract: `packages/contracts/src/tool-lint-schemas.ts`
- implementation: `packages/tools/src/code-intel/lint-files.ts`
- smoke: `test/smoke/lint-files.ts`

Typed inputs: `files[]` (1..200), optional `primaryFocusFile`, bounded
`maxFindings` (default 200, cap 1000). Typed output: resolved + unresolved
file lists (unresolved files land separately instead of silently dropping),
deduped `AnswerSurfaceIssue[]`, truncation + clean-pass warnings.

### 3. `repo_map` (code_intel category — shipped)

Aider-style token-budgeted compact outline of the indexed project.

- contract: `packages/contracts/src/tool-repo-map-schemas.ts`
- implementation: `packages/tools/src/code-intel/repo-map.ts`
- smoke: `test/smoke/repo-map.ts`
- forgebench probe: `scripts/forgebench-code-intel.ts`

Scoring: `fanIn * 2 + fanOut + 0.1` (inbound dominates; mild outbound
bonus; baseline keeps isolated files non-zero). Focus boost is additive
(1_000_000) so every `focusFiles` entry ranks above every non-focused
file deterministically, preserving ordering within each group.

Symbol selection prefers exported declarations, then ranks by kind
priority (class/interface/type/function before variable/property),
then by line position.

Token budget uses a char/4 approximation. When a file block exceeds the
remaining budget, the formatter tries a header-only variant before
dropping the file — keeps the centrality signal visible even when symbol
content has to be elided.

Aider-style formatter: `filePath:` header, `⋮...│<signature>` lines for
each kept symbol, `⋮...` elisions between. Empty-symbol files render as
`⋮... (no indexed symbols)` so the map stays consistent.

Bounded: `tokenBudget` default 1024 / cap 16384; `maxFiles` default 60 /
cap 500; `maxSymbolsPerFile` default 6 / cap 32. Truncation reasons
surface explicitly in `truncatedByBudget` / `truncatedByMaxFiles`.

### 4. Cookbook doc (shipped)

`devdocs/ast-find-pattern-cookbook.md` — 10 recipes covering logging audits,
`useEffect` with empty deps, parameterized-receiver method calls
(`$OBJ.rpc(...)` vs `supabase.rpc(...)`), error-throw captures, find-references
via call-shape, pathGlob scoping, async function declarations, JSX tag
matching, `await` expressions, and `process.env` inventories. Includes a
troubleshooting section keyed off the forgebench probe findings.

## Verification

- `pnpm typecheck` (including `test/tsconfig.json`) stays green
- `pnpm run test:smoke` stays green with new smokes registered
- forgebench probe extended to cover `lint_files` + `repo_map`; resulting
  output recorded in this doc

## Forgebench Probe Results

Captured from `scripts/forgebench-code-intel.ts` against the real
forgebench project (136 indexed files, ~50 symbols per top file). Times
are wall-clock on a warm store.

### `lint_files`

Three file sets probed, all cleanly typed:

| Files | Resolved | Findings | Notes |
| --- | --- | --- | --- |
| `lib/events/actions.ts`, `lib/events/dashboard.ts`, `lib/events/queries.ts` | 3/3 | 0 | 267ms — clean warning fires |
| `app/api/events/route.ts` | 1/1 | 0 | 74ms |
| `components/login-form.tsx`, `components/sign-up-form.tsx` | 2/2 | 0 | 101ms |

All three surfaced the "no findings — rule-packs + alignment diagnostics
returned clean" warning. Forgebench ships without custom rule-packs, so
zero findings is the expected production outcome; the warning lets agents
distinguish "clean" from "tool broke."

### `repo_map`

Top 5 files by score stayed stable across budgets (ranking is deterministic):

```
lib/utils.ts               (score=100.10, in=50, out=0, symbols=2/2)
components/ui/button.tsx   (score= 49.10, in=24, out=1, symbols=0/0)
lib/db/client.ts           (score= 37.10, in=17, out=3, symbols=3/3)
lib/db/helpers.ts          (score= 25.10, in=12, out=1, symbols=2/2)
types/supabase.ts          (score= 20.10, in=10, out=0, symbols=6/8)
```

- `tokenBudget=512` → 17 files included, 504 tokens estimated,
  `truncatedByBudget=true` (73ms)
- `tokenBudget=1024` → 42 files, 1019 tokens, `truncatedByBudget=true` (69ms)
- `tokenBudget=4096` → 60 files (default maxFiles cap), 1324 tokens,
  `truncatedByMaxFiles=true` (67ms)
- `focusFiles: ["app/api/events/route.ts"]` → focused file ranks first with
  the additive focus boost (score=1_000_003.10)

The ranking matches intuition: `lib/utils.ts` (the shadcn `cn()` utility) has
50 inbound edges and is correctly the most central file. The rendered output
follows aider conventions (`⋮...│` elision, file-header lines).

Observation for a future pass: `components/ui/button.tsx` shows
`symbols=0/0`. shadcn's Button is `const Button = React.forwardRef(...)`,
which the tree-sitter chunker currently doesn't extract as a top-level
symbol. Not a `repo_map` bug — a chunker coverage gap. `repo_map` gracefully
emits `⋮... (no indexed symbols)` so the file still appears in the map
with its centrality signal intact.

## Success Criteria

- every new public tool has contract + wrapper + smoke + registry entry
- every new public tool surfaces on harness / CLI / MCP discovery by virtue
  of being in `TOOL_DEFINITIONS`
- real-project probe against forgebench produces non-trivial, useful output
  for each tool (not just "zero matches" or "zero findings")
- `code_intel` becomes a coherent category rather than a one-tool label
