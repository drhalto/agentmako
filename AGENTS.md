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

## First Tool To Use

For a vague task, start with `context_packet`.

```json
{
  "request": "debug why manager onboarding role checks are failing",
  "includeInstructions": true,
  "includeRisks": true,
  "includeLiveHints": true,
  "freshnessPolicy": "prefer_fresh",
  "budgetTokens": 4000
}
```

Read the returned `primaryContext`, `relatedContext`, `activeFindings`,
`risks`, `scopedInstructions`, `recommendedHarnessPattern`, and
`expandableTools`. Then follow the normal harness loop: read the primary
files, search references, edit surgically, and verify.

When the task already names files, include them:

```json
{
  "request": "review auth impact of this change",
  "focusFiles": ["lib/auth/dal.ts", "app/dashboard/manager/layout.tsx"],
  "includeInstructions": true,
  "includeRisks": true
}
```

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
querying noisy tools like `cross_search`, `recall_tool_runs`, or
project-wide Reef views.

## Freshness And Indexing

Use `project_index_status` before trusting indexed line numbers or after
large edits.

```json
{
  "includeUnindexed": false
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

Before editing a risky file, prefer:

```json
{
  "filePath": "lib/auth/dal.ts",
  "limit": 50
}
```

with `file_findings`, then `reef_inspect` if a finding needs
explanation.

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
