# Phase 4 Index Freshness And Auto-Refresh

Status: `Shipped`

Implementation landed in this phase:

- first-class `IndexFreshnessDetail` / `IndexFreshnessSummary` contracts
  and answer-packet freshness enrichment for file-backed evidence
- `project_index_status` and `project_index_refresh` tools on the shared
  tool plane, with `project_index_refresh` writing through the active
  `ProjectStoreCache`
- mutation-aware tool annotations without widening the public
  `readOnlyHint: true` contract for read-only tools
- shared index/watch path filtering so generated output does not loop the
  watcher
- `agentmako mcp` debounced index watcher with project-switch handling,
  max-file fail-closed behavior, and shutdown that waits for an in-flight
  refresh
- smokes `project-index-freshness.ts` and `mcp-index-watch.ts`

## Deployment Observation

On 2026-04-24, during external-agent use against a live working tree,
indexed search results looked authoritative even when the files on disk
had moved on.

The concrete failure mode was not that `live_text_search` was stale. It
was live and useful after Phase 3. The failure was that snapshot-backed
tools such as `cross_search`, `repo_map`, `route_trace`, symbols, and
schema-usage surfaces could return old line numbers or phantom matches
without saying that their evidence came from an older index.

Agent feedback showed the exact user-facing cost:

- `trust.stable` was read as "current" even though it only means "stable
  against the last comparable answer"
- stale file rows caused manual verification reads
- freshly edited files were invisible to indexed tools until a manual
  `agentmako project index .`
- the tool surface had no MCP-native way to ask Mako to refresh the code
  index

Codexref review reinforced the direction:

- Aider uses mtime-aware repo-map caching and explicit refresh paths.
- Cody tracks changed files and uses thresholds to decide when to
  reindex.
- Continue models codebase indexing as a diffable sync process with file
  events and per-file refresh APIs.

Phase 4 belongs in Initial Testing because stale evidence is only
obvious once Mako is used as an agent companion during real edits. The
goal is not learned ranking or a new intelligence layer. The goal is to
make indexed evidence honest, refreshable, and automatically kept close
to the live tree during long-running MCP sessions.

## Goal

Make Mako's indexed code evidence self-reporting and refreshable so an
agent can answer two different questions correctly:

- "What did the last index know?"
- "Is that indexed evidence still current against the working tree?"

Phase 4 should make Mako:

- attach freshness state to snapshot-backed file evidence
- warn clearly when any returned evidence is stale, deleted, or unknown
- expose MCP/CLI/API surfaces to refresh the project code index
- keep long-lived MCP sessions fresh through a debounced file watcher
- preserve `live_text_search` as the exact live fallback, not as a hidden
  replacement for indexing

## Hard Decisions

- **Freshness is not trust.**
  Trust compares one answer against previous answers. Freshness compares
  indexed evidence against the current filesystem. Phase 4 must keep
  these concepts separate in contracts and UI text.
- **Start with full reindex, not incremental mutation.**
  The current `indexProject` path atomically replaces files, chunks,
  symbols, imports, routes, semantic units, and repo-schema snapshots.
  Reusing that path is lower risk than adding partial graph mutation in
  the same phase.
- **The watcher is a trigger, not the source of truth.**
  File events can be dropped, coalesced, or duplicated. They only mark a
  project dirty and schedule a refresh. Tool-time freshness checks still
  compare indexed rows against live `stat` results.
- **Do not make every query block on reindex.**
  Indexed tools should report stale evidence immediately. They may offer
  a refresh action or call a refresh tool, but they should not silently
  turn normal retrieval into a long indexing job.
- **Keep live DB freshness separate.**
  Existing schema snapshot freshness and live DB refresh behavior stay in
  their current path. Phase 4 handles code-index freshness. Repo SQL
  schema snapshots are rebuilt when `indexProject` runs, but live
  `pg_catalog` refresh remains `agentmako refresh` / project DB refresh.
- **No incremental indexer until the full-refresh path is proven.**
  Phase 4 should retain enough changed-path state to make incremental
  indexing easy later, but the done condition is debounced full reindex
  plus honest freshness signals.
- **Do not widen `readOnlyHint` casually.**
  `ToolAnnotations.readOnlyHint` is a literal `true` in the public tool
  summary contract today. Widening it to boolean would be a contract
  version bump and would re-broaden every consumer that currently narrows
  on the literal. Prefer an additive `mutation?: true` annotation and
  have MCP registration translate that to wire-level `readOnlyHint:
  false` for mutating tools.

## Scope In

### Workstream A - Freshness Contract

Add a first-class index freshness contract shared by tools and API
surfaces.

States:

- `fresh` - file exists and live file metadata still matches the indexed
  row within timestamp tolerance
- `stale` - file exists, but live `mtime`, size, or optional hash differs
  from the indexed row
- `deleted` - file existed in the index but no longer exists on disk
- `unindexed` - file exists on disk but has no indexed row
- `unknown` - Mako could not inspect the live file safely

Recommended contract shape:

```ts
export const INDEX_FRESHNESS_MTIME_TOLERANCE_MS = 1500;

export type IndexFreshnessState =
  | "fresh"
  | "stale"
  | "deleted"
  | "unindexed"
  | "unknown";

export interface IndexFreshnessDetail {
  state: IndexFreshnessState;
  filePath: string;
  indexedAt?: string;
  indexedMtime?: string;
  liveMtime?: string;
  indexedSizeBytes?: number;
  liveSizeBytes?: number;
  reason: string;
}

export interface IndexFreshnessSummary {
  checkedAt: string;
  state: "fresh" | "dirty" | "unknown";
  freshCount: number;
  staleCount: number;
  deletedCount: number;
  unindexedCount: number;
  unknownCount: number;
  newestIndexedAt?: string;
  newestLiveMtime?: string;
  sample: IndexFreshnessDetail[];
}
```

Implementation notes:

- add contract exports in `packages/contracts/src/index-freshness.ts`
- add Zod schemas beside existing tool schemas
- avoid filesystem I/O inside `@mako-ai/store`; store remains SQLite
  access only
- implement live comparisons in `@mako-ai/tools`, where project root and
  tool context already exist
- use mtime + size as the default check, with
  `INDEX_FRESHNESS_MTIME_TOLERANCE_MS = 1500`
- only compute SHA-256 for small evidence files when metadata disagrees
  and a stronger reason is useful
- treat outside-root paths as `unknown` or drop them, matching the Phase
  3 `live_text_search` root boundary

### Workstream B - Freshness On Indexed Evidence

Surface freshness everywhere indexed file evidence is returned.

Required behavior:

- any `EvidenceBlock` with `filePath` gets a freshness detail
- stale or deleted file evidence sets `EvidenceBlock.stale = true`
- answer packets include a freshness summary
- answer packets add a `stalenessFlags` entry when any indexed evidence
  is not fresh
- `trust.stable` must not hide stale evidence

Recommended contract change:

```ts
export interface EvidenceBlock {
  // existing fields...
  freshness?: IndexFreshnessDetail;
}

export interface AnswerPacket {
  // existing fields...
  indexFreshness?: IndexFreshnessSummary;
}
```

Fast path if contract churn becomes risky:

- put the detail under `EvidenceBlock.metadata.indexFreshness`
- keep `EvidenceBlock.stale` and `packet.stalenessFlags` as the
  user-visible signal
- promote to first-class fields in the same phase once smokes are green

Store/query adjustments:

- `searchFiles` already returns `lastModifiedAt` and `indexedAt`
- use `files.last_modified_at` as `indexedMtime`; do not add a second
  column for the same value
- extend `CodeChunkHit` rows to include file metadata from `files`
- extend route, import, and symbol evidence paths by looking up file
  summaries once per unique path
- prefer a shared enrichment helper over duplicating `stat` logic inside
  each composer

Likely files:

- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tool-answer-schemas.ts`
- `packages/contracts/src/index-freshness.ts`
- `packages/store/src/project-store-query-files.ts`
- `packages/store/src/types.ts`
- `packages/tools/src/composers/_shared/blocks.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- `packages/tools/src/composers/_shared/context.ts`
- `packages/tools/src/index-freshness/index.ts`

### Workstream C - Project Index Status And Refresh Tools

Expose explicit project-index control to agents.

Add two tools:

1. `project_index_status`
2. `project_index_refresh`

`project_index_status` is read-only and returns:

- project id and canonical root
- latest index run id, status, trigger source, and timestamps
- global `lastIndexedAt`
- freshness summary for indexed files. `includeUnindexed` is opt-in
  because detecting brand-new files requires an O(files) disk walk.
- `unindexedScan` signal. Default status reports the new-file scan was
  skipped; watcher-backed calls can cheaply report possible unindexed
  dirty paths; `includeUnindexed: true` returns the exact count.
- dirty paths known by the MCP watcher, if any
- suggested next action: `none`, `run_live_text_search`, or
  `project_index_refresh`
- suggested action reason text, because the action enum is advisory and
  agents may reasonably choose either live search or refresh in borderline
  states

`project_index_refresh` runs the existing indexer and returns:

- prior freshness summary
- index result stats
- latest run id and trigger source
- after-refresh freshness summary
- warnings from repo schema snapshot rebuild
- outcome `reason`; caller-provided `reason` is echoed separately as
  `operatorReason` so request justification is not confused with result
  status

Recommended input shape:

```ts
export interface ProjectIndexRefreshToolInput {
  projectId?: string;
  projectRef?: string;
  mode?: "if_stale" | "force";
  reason?: string;
}
```

Implementation notes:

- add a new `project` tool category or deliberately place these under
  `code_intel`; `project` is cleaner
- mark `project_index_status` as `advisoryOnly: true`; it reports the
  recommended next action but should not be treated as policy
- keep `ToolAnnotations.readOnlyHint: true` literal for read-only tools
  and add `mutation?: true` as an additive annotation for tools that
  write project state
- grep every read of `annotations.readOnlyHint`; current reads include
  CLI tool listing and MCP registration, and both must understand
  `mutation?: true`
- update `finding_ack` annotations while touching this contract, because
  it already writes despite being described as a mutation tool
- register MCP wire annotations from the new contract:
  `readOnlyHint: definition.annotations.mutation ? false : true`
- route the refresh through `MakoApiService.indexProject`
- add `triggerSource?: "manual" | "mcp_refresh" | "watch"` to
  `indexProject` options and pass it into `beginIndexRun`; this is
  plumbing only, because `beginIndexRun(triggerSource: string)` and the
  DB column already accept arbitrary source strings
- `project_index_refresh` in MCP must borrow through the same
  `projectStoreCache` as the active MCP session; do not open an
  independent project store for refresh
- ensure MCP progress reporting emits start, scan, replace, and complete
  progress when available

Likely files:

- `packages/contracts/src/tool-registry.ts`
- `packages/contracts/src/tool-project-index-schemas.ts`
- `packages/tools/src/project-index/index.ts`
- `packages/tools/src/tool-definitions.ts`
- `services/api/src/service.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/types.ts`
- `apps/cli/src/commands/project.ts`
- `apps/cli/src/shared.ts`

### Workstream D - Debounced MCP File Watcher

Keep the code index close to fresh during long-running MCP sessions.

Use `chokidar` rather than raw `fs.watch` for the first implementation.
The watcher lives in the MCP/API host layer because it is lifecycle
state, not indexer logic.

Runtime behavior:

- watcher starts after a project is resolved in the MCP session
- watch only the attached project root
- use one shared index scope helper for ignores and indexable extensions;
  do not maintain a separate watcher ignore list
- record changed paths for `add`, `change`, `unlink`, and rename-like
  event pairs
- mark project status `dirty` immediately
- debounce full reindex for `MAKO_INDEX_WATCH_DEBOUNCE_MS`, default
  `3000`
- enforce `MAKO_INDEX_WATCH_MAX_DELAY_MS`, default `60000`, so continuous
  edits do not starve the index forever
- disable auto-watch by default when the latest indexed file count is
  above `MAKO_INDEX_WATCH_MAX_FILES`, default `20000`; status should say
  watch is disabled and suggest manual refresh or live search
- allow only one index run per project at a time
- queue one follow-up run if edits arrive while indexing
- stop the previous watcher and start a new watcher when the stdio
  session switches active projects
- write watcher errors to stderr/logging, never stdout on stdio MCP

Coordinator state:

```ts
export interface ProjectIndexWatchState {
  mode: "off" | "watch";
  status: "idle" | "dirty" | "scheduled" | "indexing" | "failed" | "disabled";
  projectId?: string;
  projectRoot?: string;
  dirtyPaths: string[];
  transition?: "started" | "stopped" | "switched";
  lastEventAt?: string;
  scheduledFor?: string;
  lastRefreshStartedAt?: string;
  lastRefreshFinishedAt?: string;
  switchFromProjectId?: string;
  disabledReason?: string;
  lastError?: string;
}
```

Defaults:

- enable in `agentmako mcp` stdio by default
- keep HTTP server auto-watch disabled unless explicitly configured
- allow `MAKO_INDEX_WATCH=0` to disable for debugging
- allow `MAKO_INDEX_WATCH_DEBOUNCE_MS` and
  `MAKO_INDEX_WATCH_MAX_DELAY_MS` overrides
- allow `MAKO_INDEX_WATCH_MAX_FILES` override for large repos

Shared scope helper:

- extract `services/indexer/src/project-index-scope.ts`
- move indexable-extension checks and ignored-directory/build-output
  checks out of `file-scan.ts` / `fs-utils.ts`
- make both `collectProjectFilePaths` and the MCP watcher consume the
  helper
- smoke asserts a generated-output write does not schedule a watcher
  refresh

Likely files:

- `services/api/package.json` - add `chokidar`
- `services/api/src/index-refresh-coordinator.ts`
- `services/api/src/mcp-stdio.ts`
- `services/api/src/mcp.ts`
- `services/api/src/service.ts`
- `test/smoke/mcp-index-watch.ts`

### Workstream E - Status Surfaces And Agent Instructions

Make the new behavior visible where agents make decisions.

Required updates:

- MCP server instructions explain that indexed tools are snapshot-backed
  and expose freshness metadata
- `project_index_status` is discoverable by `tool_search`
- `cross_search` description says it returns indexed evidence with
  freshness, and `live_text_search` remains the exact live fallback
- CLI status prints code-index freshness separately from schema snapshot
  freshness
- answer/trust surfaces avoid wording that implies `trust.stable` means
  current
- audit concrete trust copy in
  `packages/tools/src/trust/evaluate-trust-state.ts`, especially the
  stable-state reason and `freshness_warning` / `freshness_expired`
  reason text
- audit CLI status text in `apps/cli/src/shared.ts`
- add a regression grep so no user-facing copy says or implies
  "stable = current"

Likely files:

- `packages/tools/src/agent-clients/mako-server-instructions.ts`
- `packages/tools/src/agent-clients/claude-code-hints.ts`
- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/trust/evaluate-trust-state.ts`
- `apps/cli/src/shared.ts`

## Scope Out

- incremental per-file index mutation
- Merkle-tree sync
- learned routing or ML freshness prediction
- batch `finding_ack`
- scope-aware `ast_find_pattern` filters
- client/server runtime-boundary classification
- `table_callers(schema, table)` reverse lookup
- replacing `live_text_search` with indexed search
- live DB auto-refresh

These are still good next-phase candidates. Phase 4 should finish the
freshness foundation first so later tools can depend on honest evidence.

## Architecture Boundary

### Owns

- code-index freshness comparison against the live filesystem
- freshness contracts and schema validation
- evidence-level freshness enrichment
- project index status and refresh tools
- MCP stdio watcher lifecycle
- debounced full reindex scheduling
- clear distinction between trust and freshness

### Does Not Own

- direct live DB drift repair
- vector or semantic index refresh
- partial graph mutation
- editor plugin integration
- operating-system background services outside the MCP process

## Contracts

### Tool Annotations

```ts
export interface ToolAnnotations {
  readOnlyHint: true;
  advisoryOnly?: true;
  derivedOnly?: true;
  mutation?: true;
}
```

Rules:

- keep `readOnlyHint` literal `true` in the public summary contract for
  read-only tools
- use `mutation?: true` as the additive marker for tools that write
  project state
- MCP registration translates `mutation?: true` into wire-level
  `readOnlyHint: false`
- no implementation should infer "safe to mutate" from the absence of
  `readOnlyHint`

### Freshness Helper

```ts
export interface AssessFileFreshnessInput {
  projectRoot: string;
  filePath: string;
  indexedAt?: string;
  indexedMtime?: string;
  indexedSizeBytes?: number;
  indexedSha256?: string;
  hashMode?: "never" | "on_metadata_mismatch" | "always_small_files";
}

export function assessFileFreshness(
  input: AssessFileFreshnessInput,
): IndexFreshnessDetail;
```

Rules:

- normalize all paths to project-relative slash paths
- return `unknown` for paths that resolve outside the project root
- use `INDEX_FRESHNESS_MTIME_TOLERANCE_MS = 1500` for filesystem
  precision differences
- do not throw for missing files; return `deleted`
- do not hash large files by default

### Evidence Enrichment

```ts
export interface EnrichEvidenceFreshnessInput {
  projectRoot: string;
  store: ProjectStore;
  evidence: EvidenceBlock[];
}

export interface EnrichEvidenceFreshnessResult {
  evidence: EvidenceBlock[];
  summary: IndexFreshnessSummary;
  stalenessFlags: string[];
}
```

Rules:

- check each unique `filePath` once
- reuse indexed file rows when available
- preserve evidence order
- mark stale/deleted evidence with `stale: true`
- add concise flags, not one flag per file when many files are stale

### Tool: `project_index_status`

```ts
export interface ProjectIndexStatusToolOutput {
  toolName: "project_index_status";
  projectId: string;
  projectRoot: string;
  latestRun?: IndexRunRecord;
  lastIndexedAt?: string;
  freshness: IndexFreshnessSummary;
  watch?: ProjectIndexWatchState;
  unindexedScan: {
    status: "included" | "skipped" | "watch_hint";
    message: string;
    count?: number;
    possibleCount?: number;
  };
  suggestedAction: "none" | "run_live_text_search" | "project_index_refresh";
  suggestedActionReason: string;
}
```

### Tool: `project_index_refresh`

```ts
export interface ProjectIndexRefreshToolOutput {
  toolName: "project_index_refresh";
  projectId: string;
  projectRoot: string;
  skipped: boolean;
  operatorReason?: string;
  reason: string;
  before: IndexFreshnessSummary;
  after?: IndexFreshnessSummary;
  run?: IndexRunRecord;
  stats?: ProjectScanStats;
  warnings: string[];
}
```

Skip behavior:

- `mode: "if_stale"` skips when status is fresh
- `mode: "force"` always runs
- deleted or unindexed files count as stale for `if_stale`
- `unknown` freshness refreshes defensively under `if_stale`
- refresh is a full snapshot replacement: stale chunk, symbol, route, and
  semantic-unit rows are cleared and rebuilt rather than patched in place

## Execution Flow (slices)

1. **Freshness contract**
   - add contract types and Zod schemas
   - add `mutation?: true` to tool annotations without widening
     `readOnlyHint`
   - add helper tests for fresh, stale, deleted, unindexed, unknown
   - verify: `corepack pnpm --filter @mako-ai/contracts typecheck`

2. **Evidence enrichment helper**
   - implement filesystem comparison under `packages/tools`
   - add helper to enrich `EvidenceBlock[]`
   - test with temp project files and an in-memory indexed snapshot
   - verify: focused smoke for stale file evidence

3. **Store metadata gaps**
   - add file metadata to `CodeChunkHit`
   - add route file metadata through either query joins or enrichment-time
     file summary lookup
   - keep store free of filesystem I/O
   - verify: typecheck and query smokes

4. **Composer integration**
   - call enrichment inside the shared composer packet path
   - update `cross_search`, `route_context`, `table_neighborhood`, and
     other composer surfaces that emit file evidence through shared blocks
   - ensure stale evidence lowers confidence or adds missing information
     only when appropriate
   - verify: stale `cross_search` result carries freshness and packet flag

5. **Manual refresh tool**
   - add `project_index_status`
   - add `project_index_refresh`
   - add API and CLI plumbing where needed
   - add MCP exposure
   - ensure refresh borrows the active MCP `projectStoreCache` when one
     exists
   - verify: MCP smoke calls status, edits a file, sees dirty/stale, calls
     refresh, sees fresh

6. **Trigger source**
   - thread `triggerSource` into `indexProject`
   - persist `mcp_refresh` and `watch` run sources
   - verify: latest index run reports the correct source

7. **MCP watcher**
   - add `chokidar`
   - implement coordinator
   - extract the shared project index scope helper
   - start watcher after active project resolution in stdio MCP
   - debounce refresh
   - queue one follow-up refresh if edits happen during indexing
   - stop/start watchers when the active MCP project switches
   - verify: smoke starts MCP, calls an indexed tool, edits a fixture,
     waits for debounce, confirms index run source is `watch`

8. **Status and instruction polish**
   - update MCP instructions and tool descriptions
   - update CLI status output
   - adjust trust wording so stable does not imply fresh
   - verify: snapshots/smokes for tool definitions and CLI status text

## File Plan

New files:

- `packages/contracts/src/index-freshness.ts`
- `packages/contracts/src/tool-project-index-schemas.ts`
- `packages/tools/src/index-freshness/index.ts`
- `packages/tools/src/project-index/index.ts`
- `services/indexer/src/index-freshness.ts`
- `services/indexer/src/project-index-scope.ts`
- `services/api/src/index-refresh-coordinator.ts`
- `test/smoke/project-index-freshness.ts`
- `test/smoke/mcp-index-watch.ts`

Likely edits:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/answer.ts`
- `packages/contracts/src/tool-answer-schemas.ts`
- `packages/contracts/src/tool-registry.ts`
- `packages/store/src/types.ts`
- `packages/store/src/project-store-query-files.ts`
- `packages/tools/src/composers/_shared/context.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- `packages/tools/src/composers/_shared/blocks.ts`
- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/agent-clients/mako-server-instructions.ts`
- `packages/tools/src/agent-clients/claude-code-hints.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/file-scan.ts`
- `services/indexer/src/fs-utils.ts`
- `services/indexer/src/types.ts`
- `services/api/package.json`
- `services/api/src/mcp.ts`
- `services/api/src/mcp-stdio.ts`
- `services/api/src/service.ts`
- `apps/cli/src/commands/project.ts`
- `apps/cli/src/shared.ts`
- `packages/tools/src/trust/evaluate-trust-state.ts`
- `CHANGELOG.md` - one entry under `## [Unreleased]`
- `devdocs/roadmap/version-initial-testing/roadmap.md`
- `devdocs/roadmap/version-initial-testing/phases/README.md`

## Verification

Focused smokes:

- `index_freshness` reports fresh for an unchanged indexed file
- `index_freshness` reports stale after editing an indexed file
- `index_freshness` reports deleted after removing an indexed file
- `project_index_status` reports stale without running reindex
- `project_index_refresh` refreshes a stale project and returns fresh
  after-state
- cached-store smoke: borrow a project store through `ProjectStoreCache`,
  call `project_index_refresh`, then read through the same borrowed handle
  and confirm new rows are visible
- `cross_search` includes freshness details on file-backed evidence
- `cross_search` packet gets a staleness flag when returned evidence is
  stale
- `live_text_search` still finds an edited file before reindex
- MCP status/refresh smoke works over stdio
- MCP watch smoke edits a file and observes a `watch` index run after
  debounce
- MCP watch smoke writes to generated output and confirms no run is
  scheduled
- MCP watch smoke switches active projects and confirms the old watcher
  stops and the new watcher starts
- trust wording smoke/grep confirms no user-facing copy says or implies
  `trust.stable` means current filesystem state

General checks:

- `corepack pnpm run typecheck`
- `corepack pnpm run build`
- `node --import tsx test/smoke/project-index-freshness.ts`
- `node --import tsx test/smoke/mcp-index-watch.ts`
- existing Phase 3 smokes for `live_text_search`, `repo_map`, and
  `mcp-stdio`
- `git diff --check`

## Done When

- Indexed evidence can no longer silently masquerade as current evidence.
- `cross_search` and other shared composer outputs show freshness for
  file-backed evidence.
- Stale, deleted, and unindexed states produce visible packet flags.
- Agents can call `project_index_status` to decide whether to trust an
  indexed result.
- Agents can call `project_index_refresh` through MCP and get a new
  index run without shelling out.
- `agentmako mcp` keeps the active project index fresh after edits using
  a debounced watcher.
- Watch-triggered index runs are observable in the latest index run and
  lifecycle events.
- `live_text_search` remains available and clearly labeled as live
  filesystem evidence.
- Trust-state wording no longer implies freshness.
- CHANGELOG entry present.

## Risks And Watchouts

- **Watcher event noise.**
  Save operations can emit many events. Debounce and dirty-path coalescing
  are required before indexing.
- **Continuous edits.**
  A max delay is needed so a long edit stream eventually refreshes, but
  not after every keystroke.
- **SQLite write contention.**
  Watch refreshes run in the same process as MCP reads. Keep one refresh
  per project, rely on existing busy timeout, and do not run refresh
  inside a tool read transaction.
- **Cached project stores.**
  Phase 2 added long-lived project stores. Reindex writes must be visible
  to borrowed stores. `project_index_refresh` must write through the same
  `ProjectStoreCache` handle used by the MCP session; if a stale read
  appears even then, add explicit cache invalidation.
- **Contract churn.**
  Adding first-class freshness fields is better long-term, but metadata
  fallback is acceptable for the first slice if it keeps compatibility.
- **Filesystem timestamp precision.**
  Windows, Git checkout behavior, and editors differ. Use the pinned
  1500ms tolerance and size comparison; hash only when needed.
- **Over-eager auto-refresh.**
  Do not auto-refresh for HTTP by default. Long-lived MCP sessions are the
  deployment pain.
- **Generated files.**
  Watcher ignores and indexer ignores must come from one helper or
  generated output will cause expensive loops.
- **Large repos.**
  Full reindex can be too expensive on very large repositories. The
  default 20000-file auto-watch limit should fail closed with a clear
  status reason instead of keeping the watcher dirty forever.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Initial Testing contract
- [./phase-2-mcp-perf-store-lifetime.md](./phase-2-mcp-perf-store-lifetime.md)
- [./phase-3-package-backed-search-and-parsing.md](./phase-3-package-backed-search-and-parsing.md)
- `services/indexer/src/index-project.ts`
- `services/indexer/src/file-scan.ts`
- `services/api/src/mcp-stdio.ts`
- `services/api/src/mcp.ts`
- `packages/tools/src/composers/_shared/context.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- `packages/tools/src/composers/cross-search.ts`
- `packages/store/src/project-store-query-files.ts`
- `packages/store/src/project-store-cache.ts`
