# Mako MCP Usage (paste into AGENTS.md or CLAUDE.md)

This file is meant to be copied into your target project's `AGENTS.md`,
`CLAUDE.md`, or equivalent agent-instructions file. It teaches a coding
agent how to use Mako's MCP tools effectively before reading or editing
your code.

Mako is registered with MCP clients as `mako-ai`:

```json
{
  "mako-ai": {
    "command": "agentmako",
    "args": ["mcp"]
  }
}
```

In Claude Code, Mako tools usually appear as `mcp__mako-ai__<toolName>`.
The examples below use the bare tool name for readability.

## Operating Model

Mako is a deterministic project context engine, not a replacement for
normal coding discipline. Use it to narrow the work: relevant files,
symbols, routes, schema objects, findings, freshness, and risks. Then
use normal reads, edits, tests, and shell commands to implement and
verify.

Prefer Mako before broad grep/file walking when the question is about
project structure, cross-file impact, database usage, routing, auth, or
known findings. Prefer `live_text_search` or shell `rg` when you need
exact current disk text after edits.

Mako has two evidence modes:

- Indexed/Reef evidence: fast and structured, but tied to the last index
  or persisted fact snapshot.
- Live evidence: current filesystem or live database. Use this when
  line numbers, edited files, or recently created files matter.

Do not treat answer stability as freshness. A stable indexed answer can
still be stale relative to disk. Check `project_index_status`,
per-evidence freshness fields, or `live_text_search` before relying on
exact lines after edits.

Every tool result includes `_hints: string[]`. Read those hints before
deciding the next call; they are generated from the returned result and are
often more specific than the static tool description.

## First Tool To Use

When you are unsure which Mako workflow fits the task, call `mako_help` first.
It returns an ordered recipe with pre-filled `suggestedArgs`, batchable
follow-ups, and post-edit verification steps.

```json
{
  "task": "audit auth flow for tenant-scoped dashboard role checks",
  "focusFiles": ["app/dashboard/layout.tsx"],
  "changedFiles": ["app/dashboard/layout.tsx"]
}
```

For a vague task, start with `context_packet`.

```json
{
  "request": "debug why manager onboarding role checks are failing",
  "mode": "explore",
  "includeInstructions": true,
  "includeRisks": true,
  "risksMinConfidence": 0.7,
  "includeLiveHints": true,
  "freshnessPolicy": "prefer_fresh",
  "budgetTokens": 4000
}
```

Use `mode: "explore"` for discovery, `"plan"` before writing an
implementation plan, `"implement"` before editing code, and `"review"` for
verification or change review. The returned `modePolicy` explains which
providers and follow-up tools were emphasized.

Read the returned `primaryContext`, `relatedContext`, `activeFindings`,
`risks`, `scopedInstructions`, `freshnessGate`,
`recommendedHarnessPattern`, and `expandableTools`. Then follow the normal
harness loop: read the primary files, search references, edit surgically,
and verify.

When the task already names files, include them:

```json
{
  "request": "review auth impact of this change",
  "focusFiles": ["lib/auth/dal.ts", "app/dashboard/manager/layout.tsx"],
  "includeInstructions": true,
  "includeRisks": true
}
```

Use `risksMinConfidence` when risk output is too speculative. For example,
`0.7` keeps strong risk signals and drops low-confidence guesses.

## Fast Follow-Up Batches

Use `tool_batch` for independent read-only lookups. It reduces MCP
round trips and keeps results labeled.

```json
{
  "verbosity": "compact",
  "continueOnError": true,
  "ops": [
    {
      "label": "freshness",
      "tool": "project_index_status",
      "args": { "includeUnindexed": false }
    },
    {
      "label": "auth-conventions",
      "tool": "project_conventions",
      "args": { "limit": 20 }
    },
    {
      "label": "open-loops",
      "tool": "project_open_loops",
      "args": { "limit": 20 }
    }
  ]
}
```

`tool_batch` is read-only. It rejects mutation tools such as
`project_index_refresh`, `working_tree_overlay`, `diagnostic_refresh`,
`db_reef_refresh`, `finding_ack`, and `finding_ack_batch`.

Use `verbosity: "compact"` or per-op `resultMode: "summary"` when
querying noisy tools like `cross_search`, `lint_files`,
`project_index_status`, `recall_tool_runs`, or project-wide Reef views.
`cross_search`, `lint_files`, and `project_index_status` already default
to compact output; pass `verbosity: "full"` only when you need broader
debug detail.

## Freshness And Indexing

In long-running MCP sessions, Mako's watcher refreshes changed files and
reruns scoped diagnostics in the background. Normal coding flow should
not require calling `project_index_refresh` or `diagnostic_refresh` after
every edit. Use `project_index_status` before trusting indexed line
numbers, after large edits, or when a tool reports stale/degraded
freshness.

```json
{
  "includeUnindexed": false
}
```

`project_index_status` is compact by default and omits the freshness
sample. Use this when you need specific stale paths:

```json
{
  "includeUnindexed": false,
  "verbosity": "full"
}
```

Use `includeUnindexed: true` only when you need to discover new files on
disk; it costs a filesystem walk.

If Mako reports stale, dirty, unknown, or missing indexed evidence, use
one of these:

- `live_text_search` for exact current text without reindexing.
- `project_index_refresh` with `mode: "if_stale"` when the index should
  be refreshed.
- `project_index_refresh` with `mode: "force"` only when the indexed
  AST/search results appear wrong.
- `working_tree_overlay` to snapshot working-tree file facts without
  reparsing AST/imports/routes/schema.
- `diagnostic_refresh` when `verification_state` still reports stale,
  failed, unavailable, or unknown sources after the watcher settles.

Example:

```json
{
  "mode": "if_stale",
  "reason": "Need fresh indexed context before editing auth route"
}
```

## Search And Code Intelligence

Use `cross_search` for broad indexed search across code chunks, routes,
schema objects, RPC/trigger bodies, and memories.

```json
{
  "term": "admin_audit_log",
  "limit": 20
}
```

`cross_search` defaults to compact output. Pass an explicit `limit` or
`verbosity: "full"` when you need a wider result set.

Use `live_text_search` for exact current text on disk. It defaults to
fixed-string search.

```json
{
  "query": "verifySession(",
  "pathGlob": "lib/**/*.ts",
  "fixedStrings": true,
  "maxMatches": 100
}
```

Use `ast_find_pattern` for structural TS/JS/TSX/JSX matches.

```json
{
  "pattern": "supabase.from($TABLE)",
  "languages": ["ts", "tsx"],
  "pathGlob": "app/**/*.tsx",
  "maxMatches": 200
}
```

For TSX/JSX, ambiguous snippets that start with `{`, `[`, or `<` are
also run with `const _ = ...` parser context; the auto-anchored form wins
when it matches. Check `patternAttempts` and each match's `patternVariant`
to see whether the original or auto-anchored form matched. You still need to
list metavariables in `captures` when you want captured values returned.

Use these focused code tools when the shape is known:

- `repo_map`: token-budgeted project outline.
- `symbols_of`, `exports_of`: symbol and export surfaces for a file.
- `imports_deps`, `imports_impact`, `imports_hotspots`,
  `imports_cycles`: import graph questions.
- `graph_neighbors`, `graph_path`, `flow_map`: graph traversal and flow
  context.
- `trace_file`: explain one file.
- `route_trace`, `route_context`: route resolution and route
  neighborhood.
- `auth_path`: auth/authorization path evidence. If no exact route, file,
  or feature matches, it returns `matched: false`, `reason`, and a suggested
  `cross_search` fallback instead of breaking the batch.
- `schema_usage`: direct app-code references to schema objects. It does not
  report RPC-mediated or graph-transitive touches; use `trace_rpc`,
  `route_context`, `table_neighborhood`, or `flow_map` for those.
- `table_neighborhood`, `rpc_neighborhood`: table/RPC-centered context
  bundles.
- `trace_table`, `trace_rpc`, `trace_edge`, `trace_error`: composer
  traces for specific investigation paths.

## Reef Engine Tools

Reef is Mako's durable fact and finding layer. Use it to ask what Mako
already calculated and whether it is still fresh.

Common Reef reads:

- `reef_scout`: turn a messy request into ranked
  facts/findings/rules/diagnostic candidates.
- `reef_inspect`: inspect the evidence trail for one file or subject.
- `project_findings`: active durable findings for the project.
- `file_findings`: durable findings for a specific file before editing
  it.
- `file_preflight`: one-call pre-edit gate for a file. Returns durable
  findings, file-scoped diagnostic freshness flags, recent diagnostic runs,
  applicable conventions, and finding acknowledgement history.
- `reef_diff_impact`: mid-edit changed-file impact packet. For files in the
  working tree, returns downstream import callers, active findings on those
  callers that may need re-checking, and conventions the diff may violate.
- `project_facts`, `file_facts`: lower-level facts behind findings.
- `project_diagnostic_runs`: recent lint/type adapter runs and whether
  they succeeded, failed, or are stale.
- `project_open_loops`: unresolved findings, stale facts, failed
  diagnostics.
- `verification_state`: whether cached diagnostics still cover current
  working-tree facts.
- `project_conventions`: discovered auth guards, runtime boundaries,
  generated paths, route patterns, and schema usage conventions.
- `rule_memory`: rule descriptors plus finding history.
- `evidence_confidence`: label evidence as live, fresh indexed, stale,
  historical, contradicted, or unknown.
- `evidence_conflicts`: stale or contradictory evidence that needs
  cross-checking.
- `reef_instructions`: scoped `.mako/instructions.md` and `AGENTS.md`
  instructions for requested files.
- `rule_pack_validate`: validate `.mako/rules` YAML packs and preview rule
  descriptors before relying on new or edited project rules.
- `extract_rule_template`: mine a local git fix diff and propose a
  reviewable `.mako/rules` YAML draft from removed TS/JS anti-pattern
  shapes. It does not write files or mutate Reef.

`reef_scout` ranks with a light intent classifier: app-flow requests favor
file, route, and finding evidence; RLS/schema requests favor database evidence.
Use `project_conventions` for extracted profile/index/rule conventions such as
auth guards, runtime boundaries, generated paths, route patterns, and schema
usage patterns.

`file_findings` includes durable findings produced by full diagnostic tools
and persisted query-time diagnostics from answer/composer tools such as
`cross_search` and `trace_file`. For
`project_findings` and `file_findings`, the `source` filter matches the
producer source, such as `lint_files` or `cross_search`, the bare rule ID, such
as `identity.boundary_mismatch`, or a rule-pack alias such as
`rule_pack:courseconnect.hydration.dynamic_ssr_false_owns_trigger`.

Before editing a risky file, prefer:

```json
{
  "filePath": "lib/auth/dal.ts",
  "findingsLimit": 50
}
```

with `file_preflight`. Use `reef_inspect` only when one returned finding or
fact needs its deeper evidence trail.

Mid-edit or before review, ask for changed-file impact:

```json
{
  "filePaths": ["src/util.ts", "app/api/users/route.ts"],
  "depth": 2
}
```

with `reef_diff_impact`. It is read-only and does not run
`working_tree_overlay`; if overlay facts are missing, run
`working_tree_overlay` or wait for the watcher first.

## Diagnostics

Use diagnostics before and after code changes.

- `lint_files`: Mako's internal diagnostics for a bounded file set.
- `typescript_diagnostics`: TypeScript compiler diagnostics.
- `eslint_diagnostics`: ESLint diagnostics.
- `oxlint_diagnostics`: Oxlint diagnostics if available.
- `biome_diagnostics`: Biome diagnostics if available.
- `diagnostic_refresh`: run selected diagnostic sources and persist
  results into Reef.
- `git_precommit_check`: staged auth and client/server boundary checks.
- `project_diagnostic_runs`: read previous diagnostic run status without
  rerunning.

For changed files:

```json
{
  "files": ["app/dashboard/manager/layout.tsx", "lib/auth/dal.ts"],
  "maxFindings": 100
}
```

with `lint_files`.

`lint_files` defaults to compact output. Pass `verbosity: "full"` or an
explicit `maxFindings` when investigating broad diagnostics. Custom YAML
rule packs under `.mako/rules` are hot-reloaded; editing a rule should not
require restarting the MCP server.

After fixing a repeated bug pattern, use `extract_rule_template` with the fix
commit to propose a rule-pack draft:

```json
{
  "fixCommit": "HEAD",
  "filePath": "components/nav-main.tsx",
  "ruleIdPrefix": "courseconnect.hydration"
}
```

Review the returned `draftYaml`, adjust overly broad patterns, then place it
under `.mako/rules` and run `rule_pack_validate` / `lint_files`.

For helper-bypass bugs, rule packs can add a primitive cross-file guard with
`canonicalHelper`. The `pattern` still matches the local bad shape; Mako
suppresses files that already reference the helper symbol and emits
producer/consumer context when the helper path is declared:

```yaml
rules:
  - id: project.auth.helper_bypass
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

For staged changes before commit:

```json
{}
```

with `git_precommit_check`.

## Database And Supabase

For projects with a Postgres or Supabase database attached, use Mako's
database tools for live schema/RLS/RPC questions:

- `db_ping`: verify database connectivity.
- `db_table_schema`: columns, indexes, constraints, foreign keys, RLS,
  triggers.
- `db_columns`: columns and primary-key details.
- `db_fk`: inbound/outbound foreign keys.
- `db_rls`: RLS enabled state and policies.
- `db_rpc`: stored procedure/function signature, return shape, security,
  and source.
- `db_reef_refresh`: persist database schema objects, indexes, policies,
  triggers, function table refs, and optional app usage into Reef.

Use `db_reef_refresh` after schema migrations or Supabase type
regeneration so Reef-backed tools can reason about current database
facts.

For RLS-sensitive work, combine:

```json
{
  "table": "admin_audit_log",
  "schema": "public"
}
```

with `db_table_schema` and `db_rls`, then use `schema_usage` or
`table_neighborhood` to find app-code callers.

## Project-Specific Habits

Customize this section for the host project. Typical things to call out:

- Framework and stack (e.g. Next.js App Router + Supabase).
- Auth/authorization model and any tenant scoping.
- Files or directories that warrant `context_packet` +
  `reef_instructions` before editing (auth, routes, RLS-touching code).
- Pre-commit checks the project requires (e.g. `git_precommit_check`).
- The location of `.mako/instructions.md` if the project uses one.

A reasonable default workflow before changing risky behavior:

1. Call `context_packet` with `includeInstructions: true` and
   `includeRisks: true`.
2. Call `reef_instructions` for the target files if the packet did not
   include the relevant `.mako/instructions.md` guidance.
3. Use `auth_path`, `route_context`, or `route_trace` for route/auth
   flow questions.
4. Use `db_rls`, `db_rpc`, and `tenant_leak_audit` for privileged data
   access or tenant isolation questions.
5. Use `git_precommit_check` before committing route or
   client/server boundary changes.

## Finding Acknowledgements

Use acknowledgements when a Mako finding is manually reviewed and
intentionally ignored or accepted. Do not ack something just to reduce
noise.

For `ast_find_pattern`, use `match.ackableFingerprint`:

```json
{
  "category": "hydration-check",
  "subjectKind": "ast_match",
  "filePath": "components/example.tsx",
  "fingerprint": "<match.ackableFingerprint>",
  "snippet": "<match.matchText>",
  "reason": "Runs inside useEffect after hydration.",
  "sourceToolName": "ast_find_pattern"
}
```

For `lint_files`, use `finding.identity.matchBasedId` and normally use
`finding.code` as the category:

```json
{
  "category": "<finding.code>",
  "subjectKind": "diagnostic_issue",
  "filePath": "<finding.path>",
  "fingerprint": "<finding.identity.matchBasedId>",
  "reason": "Reviewed false positive because ...",
  "sourceToolName": "lint_files",
  "sourceRuleId": "<finding.code>",
  "sourceIdentityMatchBasedId": "<finding.identity.matchBasedId>"
}
```

Use `finding_ack_batch` for many reviewed findings. Use
`finding_acks_report` before assuming a clean result means no one
suppressed anything.

## When To Fall Back To Shell

Use normal shell tools when:

- Mako MCP is unavailable or startup failed.
- You need to run the app, tests, package scripts, migrations, or
  builds.
- You need exact file contents for editing.
- You need a live grep over generated/unindexed files and
  `live_text_search` is insufficient.

When falling back, prefer `rg` for search. If Mako and shell disagree,
treat live filesystem reads and test output as authoritative, then
refresh Mako if the index should catch up.
