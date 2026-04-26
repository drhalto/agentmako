# Phase 3 Package-Backed Search And Parsing Hardening

Status: `Shipped`

## Deployment Observation

On 2026-04-24, during initial-testing architecture review after using
mako through external-agent surfaces, the operator asked whether Mako is
still carrying custom code where a mature package would reduce
maintenance and improve accuracy.

The review found five concrete areas where Mako's own value is not the
generic mechanics being hand-written:

- duplicate custom glob matching in `ast_find_pattern` and `repo_map`
- regex-first Markdown sectioning that is fine for current docs, but
  too weak for a first-class knowledge substrate
- no live, unindexed text-search surface for agents that need to check
  files before the next index refresh
- regex-based TS / JS import, export, symbol, and local-route extraction
  in the indexer
- custom SQL / PL/pgSQL extraction around migrations, function bodies,
  triggers, policies, and table refs

This belongs in Initial Testing because the pain is visible only once
Mako is being used as a coding-agent companion on real repos. The goal
is not to add speculative power. The goal is to stop spending product
risk on generic parsing and search mechanics when package-backed
components can feed the same typed Mako evidence model.

## Goal

Replace or augment the highest-leverage generic search / parsing
mechanics with mature packages while preserving Mako's local-first,
typed, evidence-backed tool contracts.

Phase 3 should make Mako:

- less fragile around glob filters and ignored paths
- ready to ingest Markdown knowledge mounts without a regex parser
- able to answer "what is in the live tree right now?" without waiting
  for re-index
- more accurate in TS / JS structural indexing
- safer around Postgres migration parsing, with a measured fallback path

## Hard Decisions

- **Packages are substrate, not product logic.**
  Mako still owns project identity, evidence refs, trust state, storage,
  and tool schemas. Packages own mechanics like glob matching, Markdown
  parsing, live text search, syntax tree traversal, and SQL AST parsing.
- **This phase is five workstreams because the deployment question was
  package-backed mechanics.**
  Each workstream is independently shippable and can stop without
  blocking the others. Do not turn this into a general "dependency
  cleanup" phase.
- **Use `picomatch` for glob semantics.**
  Replace Mako's small custom glob-to-regex helpers. Do not broaden the
  public glob contract past what the current tools need unless tests
  cover it.
- **Use `remark` + `gray-matter` for knowledge Markdown.**
  The current `doc-chunker` can stay for indexed repo docs until the
  knowledge substrate lands. The new knowledge path should not parse
  headings or frontmatter with regex.
- **Add live text search as a distinct surface.**
  `@vscode/ripgrep` should power a `live_text_search` tool over the
  working tree. It does not replace SQLite FTS, semantic search, or
  `cross_search`. It answers a different question: "what is present on
  disk right now?"
- **Consolidate TS / JS extraction around syntax parsers before
  type-aware project models.**
  Mako now uses the TypeScript compiler parser for import / export /
  symbol / route extraction. `ts-morph` remains parked because this
  phase did not need type-aware project graph semantics; `oxc-parser`
  remains parked until performance data justifies another parser.
- **Run Postgres parser work as a gated experiment.**
  `pgsql-parser` is promising because it uses the real Postgres parser
  via WASM, but it may introduce packaging, size, and AST-shape
  complexity. It must prove better fixture accuracy before replacing
  custom extractors. Live `pg_catalog` inspection stays custom and is
  out of scope.

## Scope In

### Workstream A - Glob Semantics

- add `picomatch`
- create one shared Mako glob helper
- replace duplicate `matchesPathGlob` helpers in:
  - `packages/tools/src/code-intel/ast-find-pattern.ts`
  - `packages/tools/src/code-intel/repo-map.ts`
- keep existing behavior covered by focused smoke tests

### Workstream B - Knowledge Markdown Parser

- add `remark` and `gray-matter`
- create a knowledge-oriented Markdown parser/chunker module
- support frontmatter, heading path, line ranges, and stable chunk IDs
- keep project/global knowledge separation from the existing
  `knowledge-substrate` note
- do not require embeddings for v1

### Workstream C - Live Text Search

- add `@vscode/ripgrep`
- expose a read-only `live_text_search` tool
- run ripgrep against the resolved project root, not arbitrary system
  paths
- return structured matches with file path, line, column, excerpt, and
  truncation warnings
- keep live-search output clearly labeled as live filesystem evidence,
  not indexed snapshot evidence

### Workstream D - TS / JS Indexing Consolidation

- move import, export, symbol, and local route extraction out of regex
  helpers in `services/indexer/src/file-scan.ts`
- use a syntax parser for first pass structural extraction
- switch defaults with smoke coverage for imports, exported symbols,
  Next routes, local handlers, and named route definitions
- document that `ts-morph` and `oxc-parser` remain parked

### Workstream E - Postgres SQL Parser Experiment

- add `pgsql-parser` only behind an experimental parser module or flag
- parse representative Supabase / Postgres migration fixtures
- compare extracted tables, columns, indexes, FKs, RLS policies, RPCs,
  triggers, and function body refs against current extractor output
- keep custom extraction as default; record the package parser as parked
  behind an experiment module
- keep custom dollar-quote-aware fallback until the parser path proves
  complete enough

## Scope Out

- no learned ranking or Roadmap 8 read-model behavior
- no semantic-search replacement
- no vector database or `sqlite-vec` migration
- no `ts-morph` adoption unless Workstream D finds a named type-aware
  need
- no `oxc-parser` adoption unless Workstream D finds tree-sitter /
  ast-grep performance or syntax coverage insufficient
- no replacement for live `pg_catalog` queries in
  `extensions/postgres`
- no new visual-selection UI
- no background file watcher
- no broad CLI framework rewrite in this phase

## Architecture Boundary

### Owns

- package-backed glob helper
- knowledge Markdown parser/chunker foundation
- read-only live text search tool surface
- TS / JS indexer extraction refactor plan and first implementation
- Postgres parser experiment and comparison harness

### Does Not Own

- trust-state policy
- workflow packet contracts
- artifact generation
- R8 telemetry read models
- vector search backend
- database live catalog inspection

## Contracts

### Shared Glob Helper

The public behavior stays intentionally small:

```ts
export function matchesMakoPathGlob(filePath: string, glob: string): boolean;
```

Rules:

- input paths are normalized to Mako's existing slash-separated
  relative path form
- `**`, `*`, and `?` keep working
- brace and extglob semantics stay disabled

### Knowledge Markdown Chunk

```ts
export interface KnowledgeMarkdownChunk {
  chunkId: string;
  title: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
  frontmatter: Record<string, unknown>;
}
```

The chunker should read Markdown AST position data instead of counting
lines with regex. `chunkId` should be deterministic from source path,
heading path, ordinal, and content hash.

### Tool: `live_text_search`

Input:

```ts
{
  projectId?: string;
  projectRef?: string;
  query: string;
  pathGlob?: string;
  fixedStrings?: boolean;        // default true for safety
  caseSensitive?: boolean;       // default false
  includeHidden?: boolean;       // default false
  maxMatches?: number;           // default 500, cap 2000
  maxFiles?: number;             // default 200, cap 5000 matched files
}
```

Output:

```ts
{
  toolName: "live_text_search";
  projectId: string;
  query: string;
  evidenceMode: "live_filesystem";
  matches: Array<{
    filePath: string;
    line: number;
    column: number;
    text: string;
    submatches: Array<{ text: string; start: number; end: number }>;
  }>;
  filesMatched: string[];
  truncated: boolean;
  warnings: string[];
}
```

Rules:

- use ripgrep JSON output, not ad hoc stdout parsing
- never search outside the resolved project root
- do not follow symlinks in v1
- honor `.gitignore` / ripgrep smart filtering by default
- label results as live evidence so agents understand they may differ
  from the indexed snapshot

### TS / JS Structural Index Result

No public contract change is expected. The indexer still persists the
same `IndexedFileRecord` shape. This workstream changes how imports,
symbols, and route hints are derived, not what downstream tools receive.

### SQL Parser Experiment Result

No public contract change is expected in the experiment slice. The
parser comparison harness should produce a structured report:

```ts
interface SqlParserComparisonResult {
  fixturePath: string;
  currentExtractor: SchemaExtractionSummary;
  packageParser: SchemaExtractionSummary;
  deltas: Array<{
    kind: string;
    identity: string;
    current: unknown;
    candidate: unknown;
  }>;
  recommendation: "park_for_normalization";
  errorMessage?: string;
}
```

The default parser only changes after fixture reports prove the package
path is better or equal on supported cases.

## Execution Flow (slices)

1. **Glob helper**
   - add `picomatch`
   - create shared helper
   - replace two duplicate glob matchers
   - verify `ast_find_pattern` and `repo_map` glob smokes

2. **Live text search**
   - add `@vscode/ripgrep`
   - implement project-root-scoped runner over JSON output
   - add contracts and tool registration
   - smoke: find a newly written fixture file before re-index

3. **Knowledge Markdown parser foundation**
   - add `remark` and `gray-matter`
   - implement parser module behind tests
   - smoke: frontmatter + nested heading chunks + line ranges
   - do not expose a public notes tool unless the storage slice is also
     ready

4. **TS / JS extraction consolidation**
   - move TS / JS extraction into `services/indexer/src/ts-js-structure.ts`
   - implement TypeScript-AST extraction for imports, exports, symbols,
     Next routes, local route hints, and named route definitions
   - switch default with focused smoke coverage

5. **Postgres parser experiment**
   - add `pgsql-parser` behind an experimental module or optional code
     path
   - build fixture comparison harness
   - evaluate Supabase migrations with dollar-quoted functions,
     triggers, policies, indexes, FKs, and enum values
   - park the parser for normalization follow-up while keeping the
     custom extractor as the default

Stopping between any two slices leaves mako in a working state.

## File Plan

Create:

- `packages/tools/src/code-intel/path-globs.ts` or shared equivalent
- `packages/tools/src/live-text-search/index.ts`
- `services/indexer/src/knowledge/markdown-parser.ts`
- `services/indexer/src/ts-js-structure.ts`
- `services/indexer/src/schema-sources/pgsql-parser-experiment.ts`
- `test/smoke/live-text-search.ts`
- `test/smoke/knowledge-markdown-parser.ts`
- `test/smoke/ts-js-structure-indexing.ts`
- `test/smoke/pgsql-parser-experiment.ts`

Modify:

- `packages/tools/package.json` - add `picomatch` and `@vscode/ripgrep`
- `services/indexer/package.json` - add Markdown parser packages and
  gated SQL parser package
- `packages/contracts/src/tool-registry.ts` - add `live_text_search`
- `packages/contracts/src/tools.ts` - include live text search input /
  output union
- `packages/tools/src/tool-definitions.ts` - register
  `live_text_search`
- `packages/tools/src/code-intel/ast-find-pattern.ts` - use shared glob
  helper
- `packages/tools/src/code-intel/repo-map.ts` - use shared glob helper
- `services/indexer/src/file-scan.ts` - consume structural extractor
  output instead of regex helpers
- `services/indexer/src/doc-chunker.ts` - preserve API while delegating
  to the parser-backed knowledge chunker
- `package.json` - register new smokes
- `CHANGELOG.md` - one entry under `## [Unreleased]`

Keep unchanged:

- `extensions/postgres` live catalog queries
- existing SQLite FTS search
- `cross_search` contract
- semantic-search embedding storage
- public index snapshot schema unless a later slice justifies it

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Focused checks:

- `ast_find_pattern` and `repo_map` path-glob behavior is unchanged for
  current examples and gains test coverage for `**`, `*`, and `?`
- `live_text_search` finds a fixture file that has not been indexed yet
  and reports `evidenceMode = "live_filesystem"`
- `live_text_search` normalizes ripgrep paths and drops any result that
  would resolve outside the project root
- Markdown parser smoke proves frontmatter, nested heading paths, and
  line ranges
- TS / JS smoke shows imports, exported symbols, route handlers, and
  local route definitions survive the parser switch
- SQL parser experiment smoke covers a schema-qualified table and
  dollar-quoted function body; broader trigger / policy / FK / index /
  enum normalization remains parked

## Done When

- duplicate hand-rolled glob helpers are gone
- `live_text_search` is callable over MCP / CLI / HTTP tool routes
- live search is clearly distinguished from snapshot evidence
- knowledge Markdown parser foundation exists and is tested
- TS / JS regex extraction has either been replaced by structural
  extraction or left behind a documented compatibility fallback with
  fixture deltas
- `pgsql-parser` experiment has a recorded park decision
- no live `pg_catalog` code was replaced by the SQL parser experiment
- focused smokes are registered
- `pnpm typecheck` and `pnpm run test:smoke` are green
- CHANGELOG entry present

## Risks And Watchouts

- **Dependency packaging risk.**
  `@vscode/ripgrep`, tree-sitter WASM, ast-grep native bindings, and
  `pgsql-parser` WASM all have packaging implications for the bundled
  CLI. Each new package needs a bundled-CLI smoke, not only source-mode
  tests.
- **Glob semantics can accidentally broaden matches.**
  `picomatch` supports more syntax than Mako's current helpers. Keep
  the wrapper narrow unless product tests opt into richer syntax.
- **Live search can confuse agents if evidence mode is not explicit.**
  Agents must know whether a result came from the indexed snapshot or
  the current filesystem. The tool output must say so.
- **Markdown AST line ranges depend on parser positions.**
  If a parser node lacks position data, the chunker should emit a
  warning and skip precise line refs rather than inventing them.
- **TS / JS extraction can regress silently.**
  Indexer changes feed many downstream tools. Dual-run comparison
  fixtures are mandatory before switching defaults.
- **Postgres ASTs are large and version-shaped.**
  `pgsql-parser` may parse more accurately but produce an AST that is
  too costly to normalize in this phase. Parking it after evidence is
  an acceptable outcome.

## References

- [./README.md](../README.md) - roadmap context
- [./roadmap.md](../roadmap.md) - canonical contract
- [./handoff.md](../handoff.md) - execution rules
- [../../../future-ideas/knowledge-substrate.md](../../../future-ideas/knowledge-substrate.md)
- `packages/tools/src/code-intel/ast-find-pattern.ts`
- `packages/tools/src/code-intel/repo-map.ts`
- `services/indexer/src/doc-chunker.ts`
- `services/indexer/src/file-scan.ts`
- `services/indexer/src/schema-scan.ts`
- `services/indexer/src/extract-pg-functions.ts`
- `services/indexer/src/schema-sources/sql.ts`
- `picomatch` - https://github.com/micromatch/picomatch
- `remark` - https://unifiedjs.com/explore/package/remark/
- `gray-matter` - https://github.com/jonschlinkert/gray-matter
- `@vscode/ripgrep` - https://www.npmjs.com/package/@vscode/ripgrep
- `ast-grep` JS API - https://ast-grep.github.io/guide/api-usage/js-api.html
- `ts-morph` - https://ts-morph.com/
- `oxc-parser` - https://oxc.rs/docs/guide/usage/parser
- `pgsql-parser` - https://www.npmjs.com/package/pgsql-parser
