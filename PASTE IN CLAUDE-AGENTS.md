\## Mako MCP Usage



This repo has `mako-ai` registered in `.mcp.json` as:



```json

{

&#x20; "mako-ai": {

&#x20;   "command": "agentmako",

&#x20;   "args": \["mcp"]

&#x20; }

}

```



In Claude Code, Mako tools usually appear as `mcp\_\_mako-ai\_\_<toolName>`. The examples below use the bare tool name for readability.



\### Operating Model



Mako is a deterministic project context engine, not a replacement for normal coding discipline. Use it to narrow the work: relevant files, symbols, routes, schema objects, findings, freshness, and risks. Then use normal reads, edits, tests, and shell commands to implement and verify.



Prefer Mako before broad grep/file walking when the question is about project structure, cross-file impact, database usage, routing, auth, or known findings. Prefer `live\_text\_search` or shell `rg` when you need exact current disk text after edits.



Mako has two evidence modes:



\- Indexed/Reef evidence: fast and structured, but tied to the last index or persisted fact snapshot.

\- Live evidence: current filesystem or live database. Use this when line numbers, edited files, or recently created files matter.



Do not treat answer stability as freshness. A stable indexed answer can still be stale relative to disk. Check `project\_index\_status`, per-evidence freshness fields, or `live\_text\_search` before relying on exact lines after edits.



\### First Tool To Use



For a vague task, start with `context\_packet`.



```json

{

&#x20; "request": "debug why manager onboarding role checks are failing",

&#x20; "includeInstructions": true,

&#x20; "includeRisks": true,

&#x20; "includeLiveHints": true,

&#x20; "freshnessPolicy": "prefer\_fresh",

&#x20; "budgetTokens": 4000

}

```



Read the returned `primaryContext`, `relatedContext`, `activeFindings`, `risks`, `scopedInstructions`, `recommendedHarnessPattern`, and `expandableTools`. Then follow the normal harness loop: read the primary files, search references, edit surgically, and verify.



When the task already names files, include them:



```json

{

&#x20; "request": "review auth impact of this change",

&#x20; "focusFiles": \["lib/auth/dal.ts", "app/dashboard/manager/layout.tsx"],

&#x20; "includeInstructions": true,

&#x20; "includeRisks": true

}

```



\### Fast Follow-Up Batches



Use `tool\_batch` for independent read-only lookups. It reduces MCP round trips and keeps results labeled.



```json

{

&#x20; "verbosity": "compact",

&#x20; "continueOnError": true,

&#x20; "ops": \[

&#x20;   {

&#x20;     "label": "freshness",

&#x20;     "tool": "project\_index\_status",

&#x20;     "args": { "includeUnindexed": false }

&#x20;   },

&#x20;   {

&#x20;     "label": "auth-conventions",

&#x20;     "tool": "project\_conventions",

&#x20;     "args": { "limit": 20 }

&#x20;   },

&#x20;   {

&#x20;     "label": "open-loops",

&#x20;     "tool": "project\_open\_loops",

&#x20;     "args": { "limit": 20 }

&#x20;   }

&#x20; ]

}

```



`tool\_batch` is read-only. It rejects mutation tools such as `project\_index\_refresh`, `working\_tree\_overlay`, `diagnostic\_refresh`, `db\_reef\_refresh`, `finding\_ack`, and `finding\_ack\_batch`.



Use `verbosity: "compact"` or per-op `resultMode: "summary"` when querying noisy tools like `cross\_search`, `recall\_tool\_runs`, or project-wide Reef views.



\### Freshness And Indexing



Use `project\_index\_status` before trusting indexed line numbers or after large edits.



```json

{

&#x20; "includeUnindexed": false

}

```



Use `includeUnindexed: true` only when you need to discover new files on disk; it costs a filesystem walk.



If Mako reports stale, dirty, unknown, or missing indexed evidence, use one of these:



\- `live\_text\_search` for exact current text without reindexing.

\- `project\_index\_refresh` with `mode: "if\_stale"` when the index should be refreshed.

\- `project\_index\_refresh` with `mode: "force"` only when the indexed AST/search results appear wrong.

\- `working\_tree\_overlay` to snapshot working-tree file facts without reparsing AST/imports/routes/schema.



Example:



```json

{

&#x20; "mode": "if\_stale",

&#x20; "reason": "Need fresh indexed context before editing auth route"

}

```



\### Search And Code Intelligence



Use `cross\_search` for broad indexed search across code chunks, routes, schema objects, RPC/trigger bodies, and memories.



```json

{

&#x20; "term": "admin\_audit\_log",

&#x20; "limit": 20

}

```



Use `live\_text\_search` for exact current text on disk. It defaults to fixed-string search.



```json

{

&#x20; "query": "verifySession(",

&#x20; "pathGlob": "lib/\*\*/\*.ts",

&#x20; "fixedStrings": true,

&#x20; "maxMatches": 100

}

```



Use `ast\_find\_pattern` for structural TS/JS/TSX/JSX matches.



```json

{

&#x20; "pattern": "supabase.from($TABLE)",

&#x20; "languages": \["ts", "tsx"],

&#x20; "pathGlob": "app/\*\*/\*.tsx",

&#x20; "maxMatches": 200

}

```



Use these focused code tools when the shape is known:



\- `repo\_map`: token-budgeted project outline.

\- `symbols\_of`, `exports\_of`: symbol and export surfaces for a file.

\- `imports\_deps`, `imports\_impact`, `imports\_hotspots`, `imports\_cycles`: import graph questions.

\- `graph\_neighbors`, `graph\_path`, `flow\_map`: graph traversal and flow context.

\- `trace\_file`: explain one file.

\- `route\_trace`, `route\_context`: route resolution and route neighborhood.

\- `schema\_usage`: app-code references to schema objects.

\- `table\_neighborhood`, `rpc\_neighborhood`: table/RPC-centered context bundles.

\- `trace\_table`, `trace\_rpc`, `trace\_edge`, `trace\_error`: composer traces for specific investigation paths.



\### Reef Engine Tools



Reef is Mako's durable fact and finding layer. Use it to ask what Mako already calculated and whether it is still fresh.



Common Reef reads:



\- `reef\_scout`: turn a messy request into ranked facts/findings/rules/diagnostic candidates.

\- `reef\_inspect`: inspect the evidence trail for one file or subject.

\- `project\_findings`: active durable findings for the project.

\- `file\_findings`: durable findings for a specific file before editing it.

\- `project\_facts`, `file\_facts`: lower-level facts behind findings.

\- `project\_diagnostic\_runs`: recent lint/type adapter runs and whether they succeeded, failed, or are stale.

\- `project\_open\_loops`: unresolved findings, stale facts, failed diagnostics.

\- `verification\_state`: whether cached diagnostics still cover current working-tree facts.

\- `project\_conventions`: discovered auth guards, runtime boundaries, generated paths, route patterns, and schema usage conventions.

\- `rule\_memory`: rule descriptors plus finding history.

\- `evidence\_confidence`: label evidence as live, fresh indexed, stale, historical, contradicted, or unknown.

\- `evidence\_conflicts`: stale or contradictory evidence that needs cross-checking.

\- `reef\_instructions`: scoped `.mako/instructions.md` and `AGENTS.md` instructions for requested files.



Before editing a risky file, prefer:



```json

{

&#x20; "filePath": "lib/auth/dal.ts",

&#x20; "limit": 50

}

```



with `file\_findings`, then `reef\_inspect` if a finding needs explanation.



\### Diagnostics



Use diagnostics before and after code changes.



\- `lint\_files`: Mako's internal diagnostics for a bounded file set.

\- `typescript\_diagnostics`: TypeScript compiler diagnostics.

\- `eslint\_diagnostics`: ESLint diagnostics.

\- `oxlint\_diagnostics`: Oxlint diagnostics if available.

\- `biome\_diagnostics`: Biome diagnostics if available.

\- `diagnostic\_refresh`: run selected diagnostic sources and persist results into Reef.

\- `git\_precommit\_check`: staged auth and client/server boundary checks.

\- `project\_diagnostic\_runs`: read previous diagnostic run status without rerunning.



For changed files:



```json

{

&#x20; "files": \["app/dashboard/manager/layout.tsx", "lib/auth/dal.ts"],

&#x20; "maxFindings": 100

}

```



with `lint\_files`.



For staged changes before commit:



```json

{}

```



with `git\_precommit\_check`.



\### Database And Supabase



CourseConnect is a Supabase-backed, multi-tenant app. Use Mako database tools for live schema/RLS/RPC questions:



\- `db\_ping`: verify database connectivity.

\- `db\_table\_schema`: columns, indexes, constraints, foreign keys, RLS, triggers.

\- `db\_columns`: columns and primary-key details.

\- `db\_fk`: inbound/outbound foreign keys.

\- `db\_rls`: RLS enabled state and policies.

\- `db\_rpc`: stored procedure/function signature, return shape, security, and source.

\- `db\_reef\_refresh`: persist database schema objects, indexes, policies, triggers, function table refs, and optional app usage into Reef.



Use `db\_reef\_refresh` after schema migrations or Supabase type regeneration so Reef-backed tools can reason about current database facts.



For RLS-sensitive work, combine:



```json

{

&#x20; "table": "admin\_audit\_log",

&#x20; "schema": "public"

}

```



with `db\_table\_schema` and `db\_rls`, then use `schema\_usage` or `table\_neighborhood` to find app-code callers.



\### CourseConnect-Specific Habits



This project uses Next.js App Router plus Supabase. Auth and authorization are tenant-scoped. Before changing auth, role, route, manager, instructor, admin, or onboarding behavior:



1\. Call `context\_packet` with `includeInstructions: true` and `includeRisks: true`.

2\. Call `reef\_instructions` for the target files if the packet did not include the relevant `.mako/instructions.md` guidance.

3\. Use `auth\_path`, `route\_context`, or `route\_trace` for route/auth flow questions.

4\. Use `db\_rls`, `db\_rpc`, and `tenant\_leak\_audit` for privileged data access or tenant isolation questions.

5\. Use `git\_precommit\_check` before committing route or client/server boundary changes.



The project-specific Mako instruction file is `.mako/instructions.md`. It defines the role-domain model: global identity, tenant-scoped authorization, and district/resource-scoped manager behavior. Do not collapse `admin`, `instructor`, `manager`, and `user` into one simplistic vertical ladder without checking resource scope.



\### Finding Acknowledgements



Use acknowledgements when a Mako finding is manually reviewed and intentionally ignored or accepted. Do not ack something just to reduce noise.



For `ast\_find\_pattern`, use `match.ackableFingerprint`:



```json

{

&#x20; "category": "hydration-check",

&#x20; "subjectKind": "ast\_match",

&#x20; "filePath": "components/example.tsx",

&#x20; "fingerprint": "<match.ackableFingerprint>",

&#x20; "snippet": "<match.matchText>",

&#x20; "reason": "Runs inside useEffect after hydration.",

&#x20; "sourceToolName": "ast\_find\_pattern"

}

```



For `lint\_files`, use `finding.identity.matchBasedId` and normally use `finding.code` as the category:



```json

{

&#x20; "category": "<finding.code>",

&#x20; "subjectKind": "diagnostic\_issue",

&#x20; "filePath": "<finding.path>",

&#x20; "fingerprint": "<finding.identity.matchBasedId>",

&#x20; "reason": "Reviewed false positive because ...",

&#x20; "sourceToolName": "lint\_files",

&#x20; "sourceRuleId": "<finding.code>",

&#x20; "sourceIdentityMatchBasedId": "<finding.identity.matchBasedId>"

}

```



Use `finding\_ack\_batch` for many reviewed findings. Use `finding\_acks\_report` before assuming a clean result means no one suppressed anything.



\### When To Fall Back To Shell



Use normal shell tools when:



\- Mako MCP is unavailable or startup failed.

\- You need to run the app, tests, package scripts, migrations, or builds.

\- You need exact file contents for editing.

\- You need a live grep over generated/unindexed files and `live\_text\_search` is insufficient.



When falling back, prefer `rg` for search. If Mako and shell disagree, treat live filesystem reads and test output as authoritative, then refresh Mako if the index should catch up.



