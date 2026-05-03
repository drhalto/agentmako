<p align="center">
  <img src="../public/reef-engine.png" alt="Reef Engine" />
</p>

# Reef Engine

Reef Engine is agentmako's durable project memory layer. It turns the things
Mako already calculated about a repository into queryable facts and findings
that coding agents can use without starting from raw search every time.

In practical terms, Reef answers questions like:

- Which files, routes, symbols, tables, and diagnostics are relevant here?
- Is this evidence from the indexed snapshot, the working tree, or staged git
  state?
- Is the evidence still fresh compared with disk?
- Has this finding already been reviewed, acknowledged, or resolved?

Reef is local-first. Its state lives in the local Mako SQLite store for the
attached project. It is not a hosted service and it is not an LLM.

## Why Reef Exists

AI coding tools are strong once they have the right context, but they spend a
lot of early tool calls rediscovering the shape of the project. Reef gives the
agent a calculated starting point:

```text
project files + schema + diagnostics + git state + review notes
  -> Reef facts and findings
  -> ranked tool results and context packets
  -> agent reads, edits, and verifies with better aim
```

The goal is not to replace normal agent workflow. The agent should still read
files, inspect references, run tests, and verify changes. Reef makes the first
move sharper by returning structured evidence with source labels and freshness
signals.

## Facts And Findings

Reef stores two main kinds of data.

Facts are calculated observations about the project:

- file metadata and freshness
- symbols and import edges
- routes and route handlers
- schema objects, functions, policies, triggers, and table relationships
- diagnostics from TypeScript, ESLint, Biome, Oxlint, and staged git checks
- database review comments added through Mako tools

Findings are actionable or reviewable results derived from facts:

- lint or type errors
- staged pre-commit boundary/auth issues
- acknowledged static findings
- database review notes
- higher-level tool findings returned by model-facing views

Findings keep stable fingerprints where possible so acknowledgements can
survive future scans.

## Overlays

Reef separates evidence by overlay so agents know what they are looking at:

- `indexed`: the last indexed project snapshot
- `working_tree`: current files on disk
- `staged`: git staged state for pre-commit review

This matters because a bug report may need working-tree evidence, while a
pre-commit check should care about staged files.

## Freshness

Reef tracks whether indexed evidence still matches disk. If a file has changed
after indexing, tools can mark the evidence as stale or suggest a refresh.

Use this when an indexed tool result seems suspicious:

```bash
agentmako --json tool call . project_index_status "{}"
agentmako --json tool call . project_index_refresh "{\"mode\":\"if_stale\"}"
```

For exact current text after edits, use live search:

```bash
agentmako --json tool call . live_text_search "{\"query\":\"useSession\",\"fixedStrings\":true}"
```

## Agent-Facing Tools

The primary Reef tool is:

- `reef_ask`: one evidence-backed query over codebase, database, durable
  findings, diagnostics, instructions, freshness, and quoted literal checks

The most direct specialist Reef tools are:

- `reef_status`: maintained health summary for known issues, changed files
  needing verification, stale diagnostic sources, schema freshness, watcher
  degradation, and queue state
- `reef_verify`: completion gate combining diagnostic coverage, changed files,
  recent runs, watcher state, and unresolved open loops
- `reef_impact`: compact changed-file impact packet over downstream import
  callers, invalidated findings, and convention risks
- `reef_scout`: lower-level ranked facts, findings, and likely next reads for a
  task
- `project_findings`: active project findings across sources
- `file_findings`: findings for a specific file
- `file_preflight`: one-call pre-edit gate for a file, combining findings,
  file-scoped diagnostic freshness, recent diagnostic runs, applicable
  conventions, and acknowledgement history
- `reef_diff_impact`: lower-level mid-edit impact packet for changed files, combining
  downstream import callers, active caller findings that may need re-checking,
  and conventions the diff may violate
- `project_facts`: raw Reef facts for a project
- `file_facts`: facts for a specific file
- `working_tree_overlay`: working-tree status as Reef evidence
- `list_reef_rules`: known rule descriptors
- `project_conventions`: conventions extracted from explicit Reef facts, the
  project profile, indexed symbols/routes/files, schema usage, and rules

Reef also strengthens higher-level tools such as `context_packet`,
`live_text_search`, `lint_files`, and `git_precommit_check`. The model-facing
surface should default to `reef_ask`; use specialist tools when the answer
packet points at a concrete expansion.

In long-running MCP sessions, the project watcher keeps Reef live in two
steps after a file edit: it refreshes the indexed/working-tree facts for the
changed paths, then runs a scoped diagnostic refresh for local in-process
sources (`lint_files`, `programmatic_findings`, `typescript_syntax`, and
`typescript` when a `tsconfig.json` is present). That keeps
`verification_state` fresh for ordinary edit loops without requiring a manual
`diagnostic_refresh`. Manual refresh is still the recovery path for broad
checks, external linters, disabled watcher diagnostics, or large file batches
that exceed the watcher diagnostic cap.

For file-scoped checks, Reef only counts a diagnostic run as covering the file
when the run was project-wide or its `metadata.requestedFiles` includes that
file. `verification_state` now returns filtered `recentRuns` and watcher
diagnostic state, and `file_preflight` includes the same watcher state inside
`diagnostics`, so agents can distinguish "daemon has not caught up" from
"daemon ran but this file is still stale."

`reef_ask` plans over code, database, diagnostics, findings, usage, literal,
and status lanes. Its scout/context lanes use light intent classification
before ranking: app-flow questions prefer file, route, and finding evidence;
RLS/schema questions prefer database facts and review comments. This keeps
text-similar schema facts from crowding out app-layer work unless the request
is actually schema-oriented.

Each `reef_ask` answer also includes `evidence.graph`: a normalized Reef
evidence graph with typed nodes and edges for the evidence packet. Nodes and
edges carry source, confidence, freshness, provenance, calculation
dependencies, overlay, and snapshot revision when available. The graph is
bounded by the same compact/full evidence mode as the rest of the response,
and `queryPlan.graphSummary` reports returned/total node and edge counts plus
node kind, edge kind, and source coverage without requiring agents to read the
full graph payload.
For planner-selected files and database objects, Reef enriches that graph from
the project index with imports, exports, symbol definitions, route ownership,
persisted imported call/render interaction artifacts, app-code schema usage
edges, focused project conventions, and rule-derived convention candidates.
Those interaction artifacts are content-addressed Reef artifacts, so the
calculation engine owns path-scoped invalidation and backdating instead of
recomputing the edge slice ad hoc per query. Reef also adds recent operational
evidence from diagnostic runs and tool-run recall, including command, test,
session, patch, touched-file, and resolved-finding edges when that activity is
relevant to the selected files.

Examples:

```bash
agentmako --json tool call . reef_ask "{\"question\":\"why is dashboard onboarding auth failing?\"}"
agentmako --json tool call . reef_ask "{\"question\":\"which RLS policy protects public.user_profiles?\"}"
```

Use `project_conventions` when the agent needs project-specific habits before
editing. It combines explicit Reef convention facts with derived signals from
the project profile, indexed symbols, route records, generated-file markers,
schema usage, and rule descriptors:

```bash
agentmako --json tool call . project_conventions "{}"
agentmako --json tool call . project_conventions "{\"kind\":\"auth_guard\"}"
```

Use `file_preflight` before editing a risky file when the agent needs the
operational gate in one call instead of separately asking for findings,
diagnostic freshness, conventions, recent runs, and ack history:

```bash
agentmako --json tool call . file_preflight "{\"filePath\":\"lib/auth/dal.ts\"}"
```

Use `reef_impact` after files have changed or before review when the agent
needs to understand blast radius from the current diff. It reads existing
working-tree overlay facts and import graph state; it does not mutate Reef or
run `working_tree_overlay` itself. `reef_diff_impact` remains the lower-level
compatibility name for the same calculation:

```bash
agentmako --json tool call . reef_impact "{\"filePaths\":[\"src/util.ts\"],\"depth\":2}"
```

Findings can be produced by full diagnostic passes, such as `lint_files`, or by
query-time answer/composer diagnostics, such as `cross_search` and `trace_file`.
Those query-time diagnostics are persisted so `file_findings` can still warn
before a later edit. The `source` filter on `project_findings` and
`file_findings` accepts the producer source (`lint_files`, `cross_search`), the
bare rule ID (`identity.boundary_mismatch`), or a rule-pack alias
(`rule_pack:<ruleId>`). Rule-pack diagnostics are still persisted under their
producer source, usually `lint_files`; the alias is a lookup convenience for
agents auditing one rule.

After a fix lands, `extract_rule_template` can mine the local git diff and
propose a `.mako/rules` YAML draft from removed TS/JS anti-pattern shapes. The
tool is read-only: it returns `templates`, `draftYaml`, caveats, and a
`suggestedPath`, but it does not write the rule pack or mutate Reef state.

```bash
agentmako --json tool call . extract_rule_template "{\"fixCommit\":\"HEAD\",\"filePath\":\"components/nav-main.tsx\",\"ruleIdPrefix\":\"courseconnect.hydration\"}"
```

Rule packs can also express a primitive cross-file helper-canonicality rule.
The local `pattern` still finds the suspect AST shape, while
`canonicalHelper` names the helper that should own that behavior. If the
consumer file already references the helper symbol, the match is suppressed. If
it does not, the finding includes the helper path as `producerPath` and the
matched file as `consumerPath`.

```yaml
rules:
  - id: courseconnect.auth.helper_bypass
    category: rpc_helper_reuse
    severity: high
    confidence: confirmed
    languages: [ts]
    message: Direct profiles query should go through enforceAccountStatus.
    pattern: $CLIENT.from("profiles")
    canonicalHelper:
      symbol: enforceAccountStatus
      path: lib/auth/dal.ts
```

## Common Use

Start with a Reef query:

```bash
agentmako --json tool call . reef_ask "{\"question\":\"why is the auth callback route broken?\"}"
```

Then read the primary files it returns, use normal search or references for
verification, and run focused checks after edits. Use `context_packet`,
`reef_scout`, or other specialist tools only when the `reef_ask` result needs
raw expansion.

For staged review:

```bash
agentmako git precommit . --json
```

For project-wide findings:

```bash
agentmako --json tool call . project_findings "{\"limit\":20}"
```

## Boundary

Reef is a context and evidence engine. It does not decide the final code change
for the agent, and it should not be treated as more authoritative than current
file reads or test output. If live files and Reef disagree, refresh the index or
use live tools to confirm the current state.
