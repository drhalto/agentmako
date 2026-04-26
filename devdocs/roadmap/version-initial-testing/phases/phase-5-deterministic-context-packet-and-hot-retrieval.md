# Phase 5 Deterministic Context Packet And Hot Retrieval

Status: `Shipped`

## Deployment Observation

On 2026-04-24, after Phase 4 made indexed evidence honest and
refreshable, two follow-on observations converged:

- external-agent feedback showed that agents still spend too many early
  tool calls discovering the shape of a vague request before they can
  start useful read/edit/verify work
- a read-only review of `C:\Users\Dustin\fenrir` showed why Fenrir often
  felt faster at information lookup: hot in-process caches, a small
  JSX/string/symbol hint index, a batch MCP tool, prompt-time context
  injection, and per-file replacement of indexed chunks

CodexRef review pointed in the same direction:

- Aider's repo map is a deterministic symbol/reference graph squeezed
  into a token budget
- Continue's context providers collect candidates from typed sources,
  dedupe, rerank, and return a smaller set
- Cody labels context by source and retrieval strategy so agents know
  whether evidence came from exact matching, symbol search, editor
  state, or fuzzy retrieval
- OpenHands uses triggered knowledge and microagent-style rules that
  activate only when the request smells relevant
- Codex scopes repo instructions by directory so the agent sees local
  conventions without reading the entire tree

The product gap is not that Mako lacks search tools. The gap is that a
coding agent starts cold on vague requests. Mako should turn messy user
intent into a compact, ranked, explainable context packet, then let
Codex, Claude Code, Cursor, Continue, OpenHands, or another harness use
its normal read/search/edit/verify loop from a better starting point.

## Goal

Make Mako a deterministic context scout for coding agents.

Phase 5 adds a structured `context_packet` surface that takes a messy
request such as "my auth route is broken after changing the user type"
and returns a ranked packet of likely files, symbols, routes, database
objects, scoped instructions, risks, and recommended harness steps.

The packet is not prose and it is not an autonomous repair attempt. It
is a compact first-mile map that helps an external coding agent spend
fewer tool calls on orientation and make fewer bad assumptions.

Phase 5 should make Mako:

- compile context deterministically from typed providers
- return source-labeled candidates with `whyIncluded`, confidence, and
  freshness
- use fast hot indexes and batching for low-latency orientation
- preserve normal harness workflows instead of replacing them
- prepare the indexer for safe path-scoped refreshes where the current
  full-refresh model is too expensive

## Delivery Split

Phase 5 is intentionally split into two execution sub-phases so the
context packet can ship before the heavier refresh and instruction/risk
work.

### Phase 5a - Context Packet And Hot Retrieval

5a owns:

- `context_packet` contract and read-only tool
- deterministic intent/entity detection
- provider pipeline and candidate model
- ranking, budgeting, source labels, and freshness enrichment
- hot hint index lifecycle
- read-only `tool_batch`
- MCP/client instruction updates for the new scout surface

5a is done when an external coding agent can call `context_packet`,
receive a ranked source-labeled first-mile packet, and then continue its
normal harness search/read/edit/verify loop.

5a shipped in this implementation: contracts, registry wiring,
deterministic providers, hot hint cache, freshness enrichment,
read-only `tool_batch`, MCP/client guidance, telemetry, and focused
smokes are in place.

5b shipped in this implementation: triggered risk detection, scoped
instruction enrichment, intent-aware harness handoff guidance, and the
path-scoped refresh foundation with conservative full-refresh fallback
are in place.

### Phase 5b - Risk, Instructions, And Path Refresh

5b owns:

- triggered risk rules
- scoped instruction loading
- richer harness handoff patterns
- path-scoped refresh foundation for file-owned code rows
- production hardening informed by early 5a usage

5b depends on 5a's packet/provider surfaces. If 5a implementation
uncovers contract problems, fix the packet contract before starting 5b.

## Hard Decisions

- **`context_packet` is separate from `ask`.**
  `ask` can stay human-facing. `context_packet` returns structured JSON
  for agents. No narrative answer is required for the happy path.
- **Providers return candidates, not final answers.**
  Route, file, schema, symbol, import, text-search, risk, instruction,
  memory, and hot-index providers all emit typed candidates with
  metadata. Ranking and budgeting happen after collection.
- **Deterministic retrieval comes first.**
  Intent/entity detection, graph traversal, exact matching, scoped
  instruction lookup, freshness, and risk triggers run before any
  optional AI/reranking experiment. No model call is load-bearing in this
  phase.
- **Hot indexes are hints, not source of truth.**
  Fenrir's speed came partly from regex-backed process-local indexes.
  Mako should copy the speed primitive, but every hot-index hit must be
  labeled as a hint and reconciled against indexed evidence or live text
  when the agent needs authority.
- **`context_packet` stays read-only.**
  The public tool is annotated `{ readOnlyHint: true }`. It never calls
  `project_index_refresh`. If a packet finds dirty evidence, it reports
  freshness and recommends `project_index_refresh` as an expandable tool.
  A future mutation surface such as `context_packet_with_refresh` is
  parked unless real usage proves the split is too costly.
- **Mako scouts; the harness works.**
  The packet recommends a harness pattern, but Codex/Claude still reads
  files, searches references, inspects imports, edits, runs tests, and
  verifies.
- **Batching defaults to read-only.**
  A batch surface is useful because it collapses MCP round trips. It
  should reject mutation tools in Phase 5 unless a future phase adds a
  deliberate mutation batch contract.
- **Path-scoped refresh is bounded.**
  Phase 4 intentionally shipped full refresh. Phase 5 may add
  path-scoped refresh for file-owned code index rows, but full project
  refresh remains the fallback for graph-wide, schema-wide, or ambiguous
  changes.
- **No ML roadmap creep.**
  This phase may emit telemetry that later Roadmap 8 read models can use,
  but learned ranking, learned routing, and embeddings-driven behavior
  are not part of the done condition.
- **All reads stay project-root-scoped.**
  Files, scoped instructions, hot hints, live text, and path refresh
  inputs must resolve under the attached project root. Outside-root paths
  are dropped or reported as warnings. Database context comes only from
  Mako's configured project store and configured DB surfaces.

## Scope In

### Workstream A - Context Packet Contract (5a)

Add a first-class `context_packet` tool contract.

Input:

```ts
export interface ContextPacketToolInput {
  projectId?: string;
  projectRef?: string;
  request: string;
  focusFiles?: string[];
  focusSymbols?: string[];
  focusRoutes?: string[];
  focusDatabaseObjects?: string[];
  changedFiles?: string[];
  maxPrimaryContext?: number;     // default 8, cap 30
  maxRelatedContext?: number;     // default 16, cap 60
  budgetTokens?: number;          // default 2400, cap 12000
  includeInstructions?: boolean;  // default true
  includeRisks?: boolean;         // default true
  includeLiveHints?: boolean;     // default true
  freshnessPolicy?: "report" | "prefer_fresh";
}
```

Rules:

- `request` is required and is treated as the primary signal
- caller-provided focus fields boost ranking but do not force inclusion
  if they resolve outside the project root
- default `freshnessPolicy` is `report`
- `prefer_fresh` demotes stale indexed candidates when fresh alternatives
  exist; it does not refresh the index
- dirty or unknown freshness is reported through `indexFreshness`,
  candidate `freshness`, warnings, and `expandableTools`
- tool annotation is `{ readOnlyHint: true }`; mutation tools may be
  suggested under `expandableTools` but never executed by
  `context_packet`
- `includeInstructions` and `includeRisks` are stable inputs in 5a, but
  may produce empty arrays until 5b lands the corresponding providers
- output is JSON only; no prose wrapper

Output:

```ts
export interface ContextPacketToolOutput {
  toolName: "context_packet";
  projectId: string;
  projectRoot: string;
  request: string;
  intent: ContextPacketIntent;
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  symbols: ContextPacketSymbol[];
  routes: ContextPacketRoute[];
  databaseObjects: ContextPacketDatabaseObject[];
  risks: ContextPacketRisk[];
  scopedInstructions: ContextPacketInstruction[];
  recommendedHarnessPattern: string[];
  expandableTools: ContextPacketExpandableTool[];
  indexFreshness?: IndexFreshnessSummary;
  limits: ContextPacketLimits;
  warnings: string[];
}
```

Candidate shape:

```ts
export interface ContextPacketReadableCandidate {
  id: string;
  kind: "file" | "symbol" | "route" | "database_object";
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  routeKey?: string;
  databaseObjectName?: string;
  source: ContextPacketSource;
  strategy: ContextPacketStrategy;
  whyIncluded: string;
  // Provider-assigned heuristic confidence that this candidate belongs
  // in the packet before global ranking, 0..1. Not calibrated.
  confidence: number;
  // Final post-ranking value used only for ordering/debugging. Consumers
  // should prefer list order and `whyIncluded` over interpreting the
  // number directly.
  score: number;
  freshness?: IndexFreshnessDetail;
  evidenceRef?: string;
  metadata?: JsonObject;
}
```

`primaryContext` and `relatedContext` contain only readable evidence:
files, ranges, symbol locations, routes, and database objects with a
repo/file anchor where possible. Risks, instructions, and tool
suggestions live only in `risks`, `scopedInstructions`, and
`expandableTools`.

Additional output types:

```ts
// Source labels reflect the providers that actually emit candidates.
// Forward-looking sources (`live_text_provider`, `ast_pattern_provider`,
// `finding_ack_memory`, `user_focus`, `intent_detector`) will be added
// back when their providers ship — `intent_detector` runs as a separate
// extraction phase that feeds providers, not as a provider itself.
export type ContextPacketSource =
  | "route_provider"
  | "file_provider"
  | "schema_provider"
  | "symbol_provider"
  | "import_graph_provider"
  | "repo_map_provider"
  | "hot_hint_index";

export type ContextPacketStrategy =
  | "exact_match"
  | "deterministic_graph"
  | "symbol_reference"
  | "schema_usage"
  | "hot_hint"
  | "centrality_rank";

export type ContextPacketIntentFamily =
  | "debug_route"
  | "debug_type_contract"
  | "debug_auth_state"
  | "debug_database_usage"
  | "debug_ui_behavior"
  | "implement_feature"
  | "review_change"
  | "find_precedent"
  | "unknown";

export interface ContextPacketIntent {
  primaryFamily: ContextPacketIntentFamily;
  families: Array<{
    family: ContextPacketIntentFamily;
    confidence: number;
    signals: string[];
  }>;
  entities: {
    files: string[];
    symbols: string[];
    routes: string[];
    databaseObjects: string[];
    quotedText: string[];
    keywords: string[];
  };
}

export interface ContextPacketSymbol {
  name: string;
  kind: string;
  path?: string;
  lineStart?: number;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export interface ContextPacketRoute {
  routeKey: string;
  path?: string;
  method?: string;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export interface ContextPacketDatabaseObject {
  objectType: "table" | "view" | "rpc" | "function" | "policy" | "trigger" | "column" | "unknown";
  schemaName?: string;
  objectName: string;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export interface ContextPacketRisk {
  code: string;
  reason: string;
  source: "risk_detector" | "freshness" | "finding_ack_memory";
  severity: "info" | "low" | "medium" | "high";
  recommendedHarnessStep?: string;
  confidence: number;
}

export interface ContextPacketInstruction {
  path: string;
  appliesTo: string[];
  precedence: number;
  reason: string;
  excerpt: string;
}

export interface ContextPacketExpandableTool {
  toolName: ToolName;
  suggestedArgs: JsonObject;
  reason: string;
  whenToUse: string;
  readOnly: boolean;
}

export interface ContextPacketLimits {
  budgetTokens: number;
  tokenEstimateMethod: "char_div_4";
  maxPrimaryContext: number;
  maxRelatedContext: number;
  providersRun: string[];
  providersFailed: string[];
  candidatesConsidered: number;
  candidatesReturned: number;
}
```

`budgetTokens` uses the same rough `char / 4` estimate as `repo_map`.
It is a packet budgeting knob, not an exact tokenizer promise.

### Workstream B - Provider Pipeline (5a)

Create a provider interface and shared pipeline.

Recommended shape:

```ts
export interface ContextProvider {
  readonly id: string;
  collect(input: ContextProviderInput, ctx: ContextProviderRuntime): Promise<ContextProviderCandidate[]>;
}
```

Provider rules:

- providers do not call each other directly
- providers should prefer shared store/query/helper modules over
  invoking public tool definitions internally
- providers must not call `tool_batch`, dispatch through the MCP
  registry, or emit sub-tool telemetry by pretending to be top-level
  tool calls
- providers return more candidates than the packet will expose
- provider output carries source, strategy, confidence, and reason
- providers should be individually testable with fixture stores
- default provider concurrency is `4`
- providers that run tree-sitter / ast-grep / other CPU-heavy syntax
  passes run through a serial lane unless measurement proves parallelism
  is safe
- providers that use the project store borrow through the same
  `ProjectStoreCache` handle as the MCP session when one exists
- provider failures become packet warnings, not whole-tool failures,
  unless the project context itself cannot be resolved

Initial 5a providers:

- `intentProvider` - classify rough task shape and extract entity hints
- `fileProvider` - resolve explicit paths and filename-like terms
- `routeProvider` - route keys, route files, route context, route trace
- `symbolProvider` - symbols, exports, imports, references where
  available
- `schemaProvider` - tables, RPCs, policies, functions, schema usages
- `repoMapProvider` - aider-style central files and exported symbols
- `liveTextProvider` - exact live filesystem hints for high-confidence
  terms
- `hotHintProvider` - process-local JSX/string/symbol/filename hints
- `findingAckProvider` - known false positives and reviewer judgment

### Workstream C - Deterministic Intent And Entity Detection (5a)

Add lightweight request parsing that is good enough to route providers.

Required behavior:

- identify common intent families; output is multi-label because real
  requests often combine route, type, auth, and database concerns:
  - `debug_route`
  - `debug_type_contract`
  - `debug_auth_state`
  - `debug_database_usage`
  - `debug_ui_behavior`
  - `implement_feature`
  - `review_change`
  - `find_precedent`
  - `unknown`
- extract candidate entities:
  - file-like paths
  - route-like paths
  - table/RPC/policy/function names
  - symbol-like identifiers
  - quoted strings and error text
  - framework/domain keywords such as auth, hydration, state,
    onboarding, migration, RLS, route, hook, provider
- return confidence and signal list, not a hidden decision
- choose `primaryFamily` only as the highest-confidence routing hint;
  do not drop lower-confidence families that explain useful provider
  paths

Do not overbuild this into an LLM router. Regex, tokenization,
identifier splitting, existing project profile data, and provider
feedback are enough for Phase 5.

### Workstream D - Hot Retrieval Layer (5a)

Add a process-local hot hint index inspired by Fenrir's `CodeIndex`.

Indexes:

- filenames and path segments
- exported symbols and local symbols from indexed rows
- JSX visible text from indexed chunks when available
- string literals from indexed chunks or a lightweight live parser pass
- route path tokens
- schema object names

Rules:

- keyed by `projectId`, project root, and latest index run id
- owned by a `HotIndexCache` created beside `ProjectStoreCache` for
  long-lived MCP stdio sessions
- HTTP/default one-shot callers may build and discard a request-local
  hot index rather than retaining process state
- cleared when the owning `ProjectStoreCache` is flushed or the MCP
  coordinator closes
- invalidated when the latest index run changes
- subscribes to Phase 4 watcher dirty-path events through a new
  coordinator dirty callback, rather than polling
- dirty hot hits are still returned only as hints with freshness attached
- never broadens outside the attached project root
- no semantic ranking or embeddings

This is intentionally a speed layer. The authoritative path remains
indexed store rows plus freshness, or `live_text_search` for live disk
truth.

### Workstream E - Read-Only Batch Tool (5a)

Add a `tool_batch` surface for MCP clients that need multiple read-only
lookups in one round trip.

Input:

```ts
export interface ToolBatchInput {
  projectId?: string;
  projectRef?: string;
  ops: Array<{
    label: string;
    tool: ToolName;
    args?: JsonObject;
  }>;
  continueOnError?: boolean; // default true
  maxOps?: number;           // default 8, cap 20
}
```

Output:

```ts
export interface ToolBatchToolOutput {
  toolName: "tool_batch";
  projectId: string;
  projectRoot: string;
  results: ToolBatchResult[];
  summary: {
    requestedOps: number;
    executedOps: number;
    succeededOps: number;
    failedOps: number;
    rejectedOps: number;
    durationMs: number;
  };
  warnings: string[];
}

export interface ToolBatchResult {
  label: string;
  tool: ToolName;
  ok: boolean;
  durationMs: number;
  result?: JsonObject;
  error?: {
    code: "unknown_tool" | "mutation_rejected" | "recursive_batch_rejected" | "tool_error";
    message: string;
  };
}
```

Rules:

- reject mutation tools in Phase 5
- reject every sub-operation whose tool definition annotations include
  `mutation: true`
- preserve each sub-result under its caller-provided label
- include duration, ok/error status, and tool name per operation
- emit telemetry for the parent call and each sub-operation
- prevent recursive `tool_batch` calls, including any nested attempt to
  pass `tool_batch` as an op
- preserve project resolution semantics used by normal tools

### Workstream F - Ranking, Budgeting, And Source Labels (5a)

Rank provider candidates into packet sections.

Ranking inputs:

- exact request/entity match
- user focus boost
- graph proximity to primary files/routes/symbols
- repo-map centrality
- source reliability
- freshness state
- changed-file affinity
- finding-ack memory
- duplicate/near-duplicate penalty

Reserved 5b ranking/enrichment inputs:

- scoped instruction relevance
- risk trigger match

Output rules:

- `primaryContext` is the small set to read first
- `relatedContext` is useful expansion context, not required first read
- callers can concatenate `primaryContext` then `relatedContext` for the
  complete recommended read order; there is no third duplicate read list
- each item says why it was included
- every file-backed item carries freshness when possible
- packet includes warnings when stale evidence affects ranking

### Workstream G - Triggered Risks And Scoped Instructions (5b)

Add deterministic knowledge triggers that stay quiet when irrelevant.

5b adds one risk producer to the provider pipeline and one post-ranking
enrichment step:

- `riskProvider` - triggered risk rules and harness cautions; outputs
  `ContextPacketRisk[]`, not primary/related readable context
- `scopedInstructionEnricher` - runs after ranking because instruction
  relevance depends on the final primary/related file set

Risk detector shape:

```ts
export interface ContextRiskRule {
  id: string;
  triggers: string[];
  intentFamilies?: string[];
  fileGlobs?: string[];
  riskCode: string;
  reason: string;
  recommendedHarnessStep?: string;
}
```

Example rule:

```ts
const hydrationBoundaryRule: ContextRiskRule = {
  id: "hydration_boundary",
  triggers: ["hydration", "mismatch", "use client", "useEffect", "new Date", "Math.random"],
  intentFamilies: ["debug_ui_behavior"],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
  riskCode: "hydration_boundary",
  reason: "UI debugging request contains hydration/client-render signals; verify server/client render output before editing.",
  recommendedHarnessStep: "Read primary TSX files and search for render-time nondeterminism before changing state logic.",
};
```

Initial risk families:

- `type_contract_mismatch`
- `auth_state_flow`
- `hydration_boundary`
- `server_client_boundary`
- `rls_policy_gap`
- `schema_migration_drift`
- `duplicate_pattern_possible`
- `stale_index_evidence`

Scoped instruction enrichment:

- load `AGENTS.md` files by directory scope and precedence
- optionally load `.mako/instructions.md` as project-wide baseline
  instructions when present
- never read instruction files above the attached project root
- apply precedence as:
  - `.mako/instructions.md` baseline, if present
  - root `AGENTS.md`
  - child `AGENTS.md` files on the path to each candidate file
  - nearest ancestor wins when instructions conflict
- attach only instructions relevant to primary/related files
- report source path and precedence
- do not merge instruction text into free-form prose; return structured
  instruction items

### Workstream H - Harness Handoff Pattern (5b)

Add recommended harness steps derived from intent and packet contents.

Examples:

- "Read primaryContext files first"
- "Search references for exported auth/session symbols"
- "Use relatedContext only if primary files do not explain the issue"
- "Run focused typecheck or tests after edit"
- "Use live_text_search if indexed evidence is stale"
- "Call project_index_refresh before trusting indexed results if packet
  freshness is dirty"

The output should be practical guidance for Codex/Claude-style agents,
not a script that hides normal engineering judgment.

### Workstream I - Path-Scoped Refresh Foundation (5b)

Add the safe foundation for Fenrir-style per-file refresh.

Scope:

- add an internal changed-path refresh API for file-owned code rows
- support replacing rows for added/modified files:
  - `files`
  - `chunks`
  - `symbols`
  - source-side `import_edges`
  - file-owned `routes`
  - file-owned `schema_usages`
  - file graph nodes/edges that are directly derived from the changed
    file
- support deleted files by removing file-owned rows
- record an index run with `triggerSource` such as
  `watch_paths` or `mcp_refresh_paths`
- fall back to full `indexProject` for:
  - schema source changes
  - config/profile/manifest changes
  - changes that affect generated type sources
  - unknown or outside-root paths
  - graph-wide repair needs

Rules:

- no orphaned chunks, symbols, routes, or semantic units may survive a
  path-scoped refresh
- FTS rows must be deleted/rebuilt with the owning chunks
- file freshness must update for every refreshed path
- if import target resolution cannot be repaired safely for unchanged
  dependents, mark the project as needing a full graph refresh
- conservatively require a full refresh when:
  - the exported-name set for a refreshed file changed
  - an exported symbol was renamed or removed
  - a new file could satisfy a previously unresolved import or alias
  - a deleted file had one or more import dependents
  - `tsconfig`, package exports, project manifest/profile, schema
    sources, generated DB types, or indexer config changed
  - path normalization cannot prove every changed path is inside the
    project root

This is Phase 5b work. It should not block 5a. The phase doc keeps it in
the same roadmap item because the speed story from Fenrir depends on
per-file replacement eventually, but the packet contract must ship and
stabilize first.

## Scope Out

- no learned ranking or learned router
- no embeddings requirement
- no autonomous repair or edit tool
- no replacement for `ask`
- no replacement for normal Codex/Claude harness search/read/edit/test
  behavior
- no mutation-capable batch tool
- no cross-repo context packet
- no UI surface beyond CLI/MCP exposure unless already trivial
- no full import-graph incremental correctness proof beyond the bounded
  path-scoped refresh foundation

Parked for Roadmap 8 or a later phase:

- embedding-based packet reranking
- learned provider weights
- LLM intent detection
- LLM context summarization
- cross-repo packets
- mutation-capable `tool_batch`
- `context_packet_with_refresh`

## Architecture Boundary

### Owns

- `context_packet` contracts and tool implementation
- provider pipeline and provider candidate model
- deterministic intent/entity extraction
- hot hint index lifecycle
- source-labeled ranking and budgeting
- triggered risk rules
- scoped instruction packet items
- read-only `tool_batch`
- path-scoped refresh foundation for file-owned code rows

### Does Not Own

- `ask` answer composition
- Roadmap 8 learned read models
- full semantic retrieval replacement
- live Postgres catalog refresh
- external harness implementation
- mutation orchestration
- code editing or verification execution

## Security Boundary

- all filesystem reads resolve under the attached project root
- focus paths, changed paths, scoped instruction paths, and path-refresh
  paths are normalized through the same project-relative boundary checks
  used by Phase 3/4 live search and freshness code
- outside-root paths are dropped from provider input and reported in
  packet warnings when useful
- `AGENTS.md` / `.mako/instructions.md` lookup never walks above the
  attached project root
- `tool_batch` sub-operations use the same project resolution and
  annotation checks as top-level tools

## Telemetry

Phase 5 should use the existing R8.1 `RuntimeUsefulnessEvent` pipeline.

Required events:

- every `context_packet` call emits a `decisionKind:
  "packet_usefulness"` event with `family: "context_packet"`,
  `toolName: "context_packet"`, intent family, provider ids, candidate
  counts, stale/dirty flags, and whether the packet hit section/budget
  caps
- every `tool_batch` call emits a `decisionKind: "wrapper_usefulness"`
  parent event with `family: "tool_batch"`, `toolName: "tool_batch"`,
  op count, success/error counts, and rejected mutation count
- each `tool_batch` sub-operation keeps normal tool-run logging and may
  emit its existing decision-kind event if that tool already does so
- path-scoped refresh emits the existing index lifecycle events with
  `triggerSource` set to `watch_paths` or `mcp_refresh_paths`

Do not create parallel telemetry tables for this phase.

## Execution Flow

1. Resolve project context and latest index run.
2. Parse request into intent, entities, and raw signals.
3. Build provider runtime with project store, freshness helpers, hot
   index, and tool/service options.
4. Run providers with bounded concurrency.
5. Normalize, dedupe, and source-label candidates.
6. Enrich file-backed candidates with freshness.
7. Apply deterministic ranking and section assignment.
8. Attach risks, scoped instructions, expandable tools, and harness
   steps.
9. Return structured JSON.

## Execution Flow (slices)

### Phase 5a Slices

1. **Contract and tool shell**
   - add `context_packet` and `tool_batch` schemas
   - add tool names/categories and tool definitions
   - return an empty-but-valid packet from a resolved project
   - verify: contracts typecheck and tool-definition smoke

2. **Intent and entity detector**
   - implement deterministic request parsing
   - add fixtures for auth route, type mismatch, schema/RLS, hydration,
     and UI text requests
   - verify: detector unit smoke with confidence and extracted signals

3. **Provider pipeline**
   - add provider interface and runtime
   - wire file, route, schema, symbol, repo-map, and live-text providers
   - providers return candidates with reasons, source, and strategy
   - verify: packet fixture includes expected candidates before ranking

4. **Ranking and packet sections**
   - implement scoring and dedupe
   - split into primary/related context
   - attach freshness and stale warnings
   - verify: vague auth/type fixture ranks the route, session, and type
     files ahead of broader repo-map context

5. **Hot hint index**
   - add process-local project hot index
   - populate filenames, symbols, JSX text, strings, routes, schema names
   - invalidate by index run id and watcher dirty paths
   - verify: repeated `context_packet` calls reuse the hot index and dirty
     hits are labeled correctly

6. **Read-only batch**
   - implement `tool_batch`
   - reject mutation tools and recursive batch calls
   - record per-op durations and errors
   - verify: batch calls `project_index_status`, `repo_map`, and
     `context_packet`; mutation request is rejected

7. **5a docs and telemetry**
   - update MCP instructions and Claude/Codex hints for `context_packet`
   - emit `context_packet` and `tool_batch` telemetry through R8.1
   - document that `context_packet` is a scout, not an agent
   - update roadmap, phase README, handoff, and CHANGELOG
   - verify: docs mention normal harness handoff and no wording implies
     Mako edits code

### Phase 5b Slices

1. **Triggered risks and scoped instructions**
   - add risk rule registry
   - add AGENTS.md-style scoped instruction enrichment
   - attach relevant risks/instructions to packet output
   - verify: server/client, hydration, RLS, and auth fixtures attach only
     the expected risks

2. **Harness handoff patterns**
   - expand intent-specific harness steps
   - attach refresh/search/typecheck/test recommendations based on packet
     contents
   - verify: route/type/schema/UI fixtures get different harness steps

3. **Path-scoped refresh foundation**
   - add internal path-refresh API and store replacement helpers
   - connect watcher dirty paths to path refresh where safe
   - fall back to full refresh when the change is not file-owned
   - verify: editing one fixture file deletes old chunks/symbols/routes
     for that file and inserts the new rows without changing unrelated
     file rows

4. **5b docs and hardening**
   - update path-refresh and scoped-instruction docs
   - update handoff and CHANGELOG
   - verify: production guidance names full-refresh fallback triggers

## File Plan

New files:

- `packages/contracts/src/context-packet.ts`
- `packages/contracts/src/tool-context-packet-schemas.ts`
- `packages/contracts/src/tool-batch-schemas.ts`
- `packages/tools/src/context-packet/index.ts`
- `packages/tools/src/context-packet/intent.ts`
- `packages/tools/src/context-packet/providers.ts`
- `packages/tools/src/context-packet/ranking.ts`
- `packages/tools/src/context-packet/risks.ts`
- `packages/tools/src/context-packet/scoped-instructions.ts`
- `packages/tools/src/context-packet/harness-patterns.ts`
- `packages/tools/src/hot-index/index.ts`
- `packages/tools/src/hot-index/cache.ts`
- `packages/tools/src/tool-batch/index.ts`
- `services/indexer/src/path-refresh.ts`
- `test/smoke/context-packet.ts`
- `test/smoke/tool-batch.ts`
- `test/smoke/hot-index.ts`
- `test/smoke/path-scoped-refresh.ts`

Likely edits:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/tool-registry.ts`
- `packages/tools/src/tool-definitions.ts`
- `packages/tools/src/agent-clients/mako-server-instructions.ts`
- `packages/tools/src/agent-clients/claude-code-hints.ts`
- `packages/tools/src/code-intel/repo-map.ts`
- `packages/tools/src/live-text-search/index.ts`
- `packages/tools/src/project-index/index.ts`
- `packages/tools/src/runtime.ts`
- `packages/store/src/types.ts`
- `packages/store/src/project-store-index.ts`
- `packages/store/src/project-store-query-files.ts`
- `packages/store/src/project-store-methods-index.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/file-scan.ts`
- `services/indexer/src/types.ts`
- `services/api/src/index-refresh-coordinator.ts`
- `services/api/src/mcp.ts`
- `services/api/src/mcp-stdio.ts`
- `apps/cli/src/shared.ts`
- `CHANGELOG.md`
- `devdocs/roadmap/version-initial-testing/README.md`
- `devdocs/roadmap/version-initial-testing/handoff.md`
- `devdocs/roadmap/version-initial-testing/roadmap.md`
- `devdocs/roadmap/version-initial-testing/phases/README.md`

Keep unchanged unless a slice proves otherwise:

- `ask` output contract
- mutation tool semantics
- Roadmap 8 telemetry storage plumbing
- live Postgres catalog refresh
- external-agent harness integrations

## Verification

### Phase 5a Required

- `context_packet` returns a valid packet for a vague request with no
  focus hints
- auth route/type-change fixture ranks route, auth/session, and type
  files in primary context
- UI text fixture uses hot JSX/string hints but labels them as hints
- schema/RLS fixture includes database objects without requiring 5b risk
  output
- stale indexed evidence appears with freshness and a packet warning
- repeated packet calls reuse the hot index until the index run id or
  watcher dirty paths change
- `tool_batch` executes read-only tools and returns labeled sub-results
- `tool_batch` rejects `project_index_refresh` and `finding_ack`
- `context_packet` emits `decisionKind: "packet_usefulness"` with
  `family: "context_packet"` and provider/candidate metadata
- `tool_batch` emits `decisionKind: "wrapper_usefulness"` with `family:
  "tool_batch"` and preserves per-tool run logging

### Phase 5b Required

- scoped instruction fixture loads nearest AGENTS.md-style instruction
  and reports precedence
- risk detector fixture triggers hydration/server-client/RLS risks only
  when matching signals are present
- path-scoped refresh edits one indexed fixture file and old chunks,
  symbols, routes, schema usages, and semantic units for that file do
  not survive
- path-scoped refresh falls back to full refresh for schema/config
  changes

### General Checks

- `corepack pnpm run typecheck`
- `corepack pnpm run build`
- `node --import tsx test/smoke/context-packet.ts`
- `node --import tsx test/smoke/tool-batch.ts`
- `node --import tsx test/smoke/hot-index.ts`
- `node --import tsx test/smoke/path-scoped-refresh.ts` once 5b lands
- existing Phase 3/4 smokes for `live_text_search`,
  `ast_find_pattern`, `project_index_status`, and MCP watch
- `git diff --check`

## Done When

- Agents can call `context_packet` with a messy request and receive a
  structured, ranked, source-labeled packet.
- The packet distinguishes primary context, related context, symbols,
  routes, database objects, risks, scoped instructions, and expansion
  tools.
- Every included candidate says why it was included and how confident
  Mako is.
- File-backed candidates carry freshness when possible.
- Mako recommends a normal Codex/Claude-style harness pattern instead of
  pretending to solve the coding task itself.
- Hot hint indexes make repeated orientation calls faster without hiding
  that they are hints.
- `tool_batch` collapses read-only lookup round trips and rejects
  mutation tools.
- Path-scoped refresh can safely replace file-owned code rows or clearly
  fall back to full refresh.
- `context_packet` and `tool_batch` emit R8.1 telemetry events without
  creating parallel telemetry storage.
- MCP/client instructions explain when to use `context_packet` versus
  `ask`, `cross_search`, `repo_map`, and `live_text_search`.
- `devdocs/roadmap/version-initial-testing/handoff.md` includes Phase 5
  status and links.
- CHANGELOG entry present.

## Risks And Watchouts

- **Overbuilding the router.**
  Intent detection should be transparent and deterministic. Do not build
  a model-powered planner in this phase.
- **Packet bloat.**
  The packet is useful only if it is small enough for an agent to act on.
  Enforce budgets and section limits early.
- **False authority from hot hints.**
  Hot indexes are fast but weaker than parsed/indexed evidence. Always
  label them as hints and attach freshness when possible.
- **Provider failure coupling.**
  A broken schema provider should not block file/route/symbol context.
  Isolate provider failures into warnings.
- **Instruction over-attachment.**
  Scoped instructions should follow directory precedence and relevance.
  Do not dump every repo instruction into every packet.
- **Risk detector noise.**
  Triggered risks are valuable only when quiet by default. Prefer fewer,
  explainable risks.
- **Batch safety.**
  Read-only batch must not become an accidental mutation executor.
- **Incremental refresh correctness.**
  File-owned row replacement is manageable. Cross-file import graph
  correctness is harder. Fall back to full refresh whenever correctness
  is uncertain.
- **Roadmap overlap.**
  If ranking becomes learned or telemetry-driven, move that work to
  Roadmap 8 instead of expanding this phase.

## References

- [./README.md](./README.md) - phase sequence
- [../roadmap.md](../roadmap.md) - Initial Testing contract
- [../handoff.md](../handoff.md) - execution handoff
- [./phase-3-package-backed-search-and-parsing.md](./phase-3-package-backed-search-and-parsing.md)
- [./phase-4-index-freshness-and-auto-refresh.md](./phase-4-index-freshness-and-auto-refresh.md)
- `packages/tools/src/code-intel/repo-map.ts`
- `packages/tools/src/live-text-search/index.ts`
- `packages/tools/src/code-intel/ast-find-pattern.ts`
- `packages/tools/src/project-index/index.ts`
- `services/indexer/src/index-project.ts`
- `services/indexer/src/file-scan.ts`
- `services/api/src/index-refresh-coordinator.ts`
- `packages/store/src/project-store-index.ts`
- Fenrir comparison:
  - `C:\Users\Dustin\fenrir\src\fenrir\integrations\mcp\server.py`
  - `C:\Users\Dustin\fenrir\src\fenrir\integrations\mcp\tools\batch.py`
  - `C:\Users\Dustin\fenrir\src\fenrir\hooks\fenrir-watch.py`
  - `C:\Users\Dustin\fenrir\src\fenrir\hooks\fenrir-inject.py`
  - `C:\Users\Dustin\fenrir\src\fenrir\db\search.py`
