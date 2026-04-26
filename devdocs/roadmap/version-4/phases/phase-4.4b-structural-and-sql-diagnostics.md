# Phase 4.4b Structural And SQL Diagnostics

Status: `Completed`

This file is the canonical shipped record for Roadmap 4 Phase 4.4b. It delivered the first structural/relation diagnostics slice after 4.4a proved the alignment-diagnostics direction was paying off.

Use [../roadmap.md](../roadmap.md) for final roadmap status. Use [./phase-4.4a-ts-aware-alignment-diagnostics.md](./phase-4.4a-ts-aware-alignment-diagnostics.md) for the TS-aware prerequisite that shipped first.

## Shipped Outcome

By the end of 4.4b, mako can now surface the first explicit diagnostics for:

- `reuse.helper_bypass`
- `auth.role_source_drift`
- `sql.relation_alias_drift`

These diagnostics participate in the same answer/trust/eval surface as 4.4a instead of introducing a second tool/output family.

## What Shipped

- structural diagnostics in:
  - `packages/tools/src/diagnostics/structural.ts`
- integration through:
  - `packages/tools/src/diagnostics/index.ts`
  - `packages/tools/src/trust/enrich-answer-result.ts`
  - `packages/tools/src/evals/runner.ts`
- additive gating so low-signal answers (`best_effort`, `partial`, or no evidence) do not pay the structural diagnostic cost
- app-shaped heuristics (`reuse.helper_bypass`, `auth.role_source_drift`) only activate when the project profile or indexed files imply a Next/app-style surface
- eval assertions and real fixture coverage proving these findings surface on `forgebench-eval`

## Diagnostic Families

### 1. Helper/RPC reuse miss

Shipped code:

- `reuse.helper_bypass`

This flags route/helper implementations that bypass an already established helper flow instead of reusing it.

### 2. Auth/role source drift

Shipped code:

- `auth.role_source_drift`

This flags places where role/source resolution diverges between related surfaces, such as layout versus page or helper versus caller.

### 3. Relation-alias drift

Shipped code:

- `sql.relation_alias_drift`

This is the first SQL/relation-facing diagnostic slice. Today it is intentionally heuristic/string-backed and targeted to real alias-shape drift, not a full parser-heavy SQL engine.
It is also now stricter about locality: alias drift requires a same-file or type-neighbor consumer instead of any nearby pluralized property in the broader graph.

## Real Coverage

Shipped verification includes:

- deterministic smoke coverage in:
  - `test/smoke/alignment-diagnostics.ts`
- real fixture coverage in:
  - `devdocs/test-project/trust-eval-fixtures.ts`
  - `devdocs/test-project/run-trust-evals.ts`

The real `forgebench-eval` fixture set now proves:

- dashboard tracing surfaces relation drift
- admin page tracing surfaces role-source drift
- events route tracing surfaces helper reuse drift

## Intentional Limits

4.4b intentionally stopped short of:

- a broad rule marketplace
- full parser-backed SQL diagnostics everywhere
- interprocedural heavy dataflow analysis

The shipped slice is narrow on purpose:

- targeted to recurring real bug classes
- integrated with trust/ranking/eval
- local-first

## Acceptance Criteria Met

- the system can surface at least one reuse miss explicitly
- the system can surface at least one auth/role/tenant drift case explicitly
- the system can surface at least one relation/query mismatch where string-backed structure adds signal beyond raw search
- these diagnostics already improve the remaining eval gaps after 4.4a

## Primary Files

- `packages/tools/src/diagnostics/structural.ts`
- `packages/tools/src/diagnostics/index.ts`
- `packages/tools/src/trust/enrich-answer-result.ts`
- `test/smoke/alignment-diagnostics.ts`
- `devdocs/test-project/trust-eval-fixtures.ts`

## Post-Closeout Additions

### Shared code-intel primitive (`ast-grep` lift)

The `findAstMatches` helper moved from `composers/_shared/ast-patterns.ts` to
a new `packages/tools/src/code-intel/ast-patterns.ts` shared across the
tools package, and is now exported from the `@mako-ai/tools` root. Built-in
structural diagnostics that previously hand-walked the TS AST for Supabase
`.from() / .rpc() / .select()` calls (`collectQueryUsages`) now consume the
same ast-grep primitive the composer layer uses. Single source of truth;
no duplicated "find Supabase calls" implementation.

`collectCallSites` intentionally stays on the TypeScript compiler API
because its per-argument identity classification
(`classifyIdentityKindFromNode`) walks `PropertyAccessExpression` nodes
semantically, which ast-grep's text-only captures can't replicate.

### YAML rule-pack extension mechanism

Teams can now extend the structural diagnostic layer with project-specific
YAML rule packs without touching TypeScript or releasing a new mako
version. Rule packs are a declarative layer on top of the same
`findAstMatches` primitive the built-in diagnostics use, and emit
`AnswerSurfaceIssue` values through the identical `buildSurfaceIssue`
factory — so rule-pack findings flow through trust enrichment, SARIF
output, eval assertions, and CLI/web surfaces with zero format divergence
from built-ins.

Shipped artifacts:

- `packages/tools/src/rule-packs/types.ts` — typed rule contract
  (`RuleDefinition`, `RulePack`, `CompiledRule`, `RulePackLoadError`)
- `packages/tools/src/rule-packs/schema.ts` — zod schema with
  mutually-exclusive `pattern` / `patterns` validation
- `packages/tools/src/rule-packs/loader.ts` — `loadRulePackFromFile`,
  `discoverRulePacks(projectRoot)` walking
  `<projectRoot>/.mako/rules/**/*.{yaml,yml}`, `compileRulePacks`
- `packages/tools/src/rule-packs/evaluator.ts` — `runRulePacks` runs each
  rule's patterns via `findAstMatches`, interpolates `{{capture.NAME}}` in
  messages from ast-grep metavariable captures
- `collectAnswerDiagnostics` integration with process-lifetime rule-pack
  caching keyed by project root, cached app-surface heuristic detection keyed
  by the latest index run, and dedup-by-`matchBasedId` against built-in
  findings
- `test/smoke/rule-packs.ts` — direct loader, discovery, end-to-end via
  `trace_file`, schema-violation error surface
- `devdocs/rule-packs.md` — schema reference, pattern syntax, authoring
  guide with realistic example
- Added `yaml@^2.8.3` dependency to `packages/tools`

The current rule-pack slice intentionally scopes narrow: single-file
structural shapes only, no cross-file joins, no type-aware constraints,
no `pattern-either` / `pattern-not` / `metavariable-*` operators. The
built-in TS-aware diagnostics remain the semantic layer for relational
analysis. Rule packs are the ergonomic layer for pattern-matchable shapes.

This closes the gap between "Phase 4.4 took the Semgrep design influence"
and "Phase 4.4 supports user-authored rules in a Semgrep-style format."
