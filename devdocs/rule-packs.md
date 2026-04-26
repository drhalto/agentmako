# YAML Rule Packs

mako's alignment diagnostics can be extended with user-authored YAML rule
packs. Rule packs let teams declare project-specific structural checks
(identity-boundary drift, helper-reuse misses, auth-role mistakes) without
touching TypeScript or releasing a new mako version. Rule packs complement
the built-in TS-aware and structural diagnostics — they don't replace them.

## Where rule packs live

```
<projectRoot>/
└── .mako/
    └── rules/
        ├── security.yaml
        ├── identity.yaml
        └── internal/
            └── team-conventions.yaml
```

mako walks `<projectRoot>/.mako/rules/**/*.{yaml,yml}` on first diagnostic
run per project root, compiles every rule once, and caches the compiled set
for the process lifetime. A missing `.mako/rules/` directory is a valid
state — no rule packs = built-in diagnostics only.

Restart mako after editing a rule pack. mtime-based invalidation is not
implemented yet.

## Rule-pack schema

```yaml
name: internal-security-rules          # optional; defaults to file basename
rules:
  - id: identity.tenant_id_leaves_scope
    category: identity_key_mismatch    # AnswerSurfaceIssueCategory
    severity: high                     # low | medium | high | critical
    confidence: confirmed              # possible | probable (default) | confirmed
    languages: [ts, tsx]               # ts | tsx | js | jsx — default: all
    message: |
      `{{capture.FN}}({{capture.ARG}})` — a tenant-scoped identity is passed
      into a non-tenant-scoped callee.
    pattern: $FN(tenantId)             # one ast-grep pattern
    metadata:
      cwe: "CWE-284"
      reference: "https://internal.wiki/mako/tenant-scope"
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable identifier. Used as the `code` on every emitted issue and as part of the `matchBasedId` / `patternHash`. Conventionally dotted (`team.family.specific_check`). |
| `category` | yes | One of `trust`, `producer_consumer_drift`, `identity_key_mismatch`, `rpc_helper_reuse`, `auth_role_drift`, `sql_alignment`, `ranking`. Shared vocabulary with built-in diagnostics. |
| `severity` | yes | `low` / `medium` / `high` / `critical`. Maps onto SARIF `note` / `warning` / `error`. |
| `confidence` | no | `possible` / `probable` / `confirmed`. Defaults to `probable`. Affects ranking — `confirmed` + `high/critical` triggers a diagnostic penalty. |
| `languages` | no | Restrict to these script kinds. Detected per file via extension. Defaults to all supported. |
| `message` | yes | Rendered on every emitted issue. Supports `{{capture.NAME}}` interpolation from metavariables. |
| `pattern` | either | A single ast-grep pattern. Mutually exclusive with `patterns`. |
| `patterns` | either | Array of ast-grep patterns evaluated independently (OR semantics). Mutually exclusive with `pattern`. |
| `metadata` | no | Free-form JSON-safe properties attached to every emitted issue's `metadata` field. |

Exactly one of `pattern` / `patterns` must be present. Both declared or
neither declared is a load-time error.

## Pattern syntax

Rule packs use [ast-grep](https://ast-grep.github.io/) patterns — the same
primitive the built-in composer evidence layer uses. Metavariables start
with `$`:

- `$X` matches a single node and captures it as `X`
- `$$$X` matches a variadic sequence (e.g., argument lists)
- Literal tokens match themselves

Examples:

```yaml
# Direct Supabase table hit
pattern: $C.from('$TABLE')

# Both quote styles (use `patterns` when a rule needs multiple shapes)
patterns:
  - $C.from('$TABLE')
  - $C.from("$TABLE")

# Variadic argument capture
pattern: $CLIENT.rpc('$FN', $$$ARGS)

# Throw sites
pattern: throw new $ERR($MSG)

# Try/catch shapes
pattern: |
  try { $$$TRY } catch ($E) { $$$HANDLER }
```

Single-node metavariables referenced in the pattern are extracted
automatically. Any `$NAME` metavariable whose name matches
`[A-Z][A-Z0-9_]*` becomes a named capture available in `message`
interpolation. Variadic `$$$NAME` captures are matchable by ast-grep, but
they are intentionally not exposed through `{{capture.NAME}}` interpolation
in this slice.

### Message interpolation

```yaml
pattern: $FN(tenantId)
message: "Callee `{{capture.FN}}` receives a tenant-scoped id directly"
```

Each `{{capture.NAME}}` in the message is replaced with the matched text of
the `$NAME` metavariable at runtime. Missing captures interpolate to an
empty string instead of throwing — misauthored templates degrade loudly in
the rendered message rather than crashing the evaluator.

## What rule packs can and can't do

### Can
- Match a structural shape on a single file
- Report with severity, category, confidence, and free-form metadata
- Scope to specific languages
- Surface producer-side code via `path` / `line` (from the match location)
- Interpolate capture values into the message

### Can't (in this slice)
- Cross-file joins ("field declared in A, used in B")
- Type-aware constraints (`metavariable-name` module restrictions,
  `metavariable-comparison`, type flow)
- Boolean composition (`pattern-either`, `pattern-not`, `pattern-inside`)
- Negative patterns
- SQL / PL-pgSQL (ast-grep doesn't parse SQL)

For those, use the built-in TS-aware diagnostics — `diagnostics/ts-aware.ts`
walks the TypeScript AST with full semantic info. Rule packs are the
ergonomic layer for pattern-matchable shapes; the built-ins are the
semantic layer for relational analysis.

## Integration with the rest of the trust layer

Rule-pack matches flow through the identical pipeline as built-in
diagnostics:

1. `runRulePacks` emits `AnswerSurfaceIssue[]` via `buildSurfaceIssue`, so
   every emitted issue carries the three-hash identity (`matchBasedId` /
   `codeHash` / `patternHash`) — stable across runs, unique per
   rule-and-match combination.
2. `collectAnswerDiagnostics` concatenates built-in + rule-pack issues and
   dedupes by `matchBasedId`. A rule pack that re-matches a built-in's
   shape will not double-emit.
3. `enrichAnswerResultSurface` attaches the merged list to
   `AnswerResult.diagnostics`, so every surface (CLI, web, MCP, API, SARIF)
   renders rule-pack findings alongside built-ins with no format
   divergence.
4. Ranking: a `confirmed` / `high-or-critical` rule-pack finding contributes
   to the `rank.diagnostic_penalty` order-key drop just like a built-in
   finding would.

## Loader API

```ts
import {
  loadRulePackFromFile,
  discoverRulePacks,
  compileRulePacks,
  runRulePacks,
} from "@mako-ai/tools";
```

| Function | Signature | Use |
|---|---|---|
| `loadRulePackFromFile` | `(path: string) → LoadedRulePack` | Parse + validate one `.yaml` file. Throws `RulePackLoadError` on malformed input. |
| `discoverRulePacks` | `(projectRoot: string) → LoadedRulePack[]` | Walk `<projectRoot>/.mako/rules/` and load every pack. Returns `[]` when the directory doesn't exist. |
| `compileRulePacks` | `(packs: LoadedRulePack[]) → CompiledRule[]` | Resolve defaults and flatten into the shape the evaluator consumes. |
| `runRulePacks` | `(input) → AnswerSurfaceIssue[]` | Evaluate compiled rules against a set of focus files using the shared code-intel `findAstMatches` primitive. |

## Error handling

- **Unreadable file** → `RulePackLoadError`
- **Invalid YAML** → `RulePackLoadError`
- **Schema violation** → `RulePackLoadError` with every offending field path
- **Unsupported language / no pattern captures** → silently skipped for that
  file (not fatal)
- **Pattern that ast-grep can't parse** → silently skipped for that rule (not
  fatal)

At the integration layer, `collectAnswerDiagnostics` swallows rule-pack
errors entirely so a malformed pack doesn't break answer emission. Run
`loadRulePackFromFile` directly (or through a future `mako rules validate`
subcommand) to surface authoring errors.

## Smoke coverage

`test/smoke/rule-packs.ts` exercises:

- Direct file loading + schema validation
- Filesystem discovery walking `.mako/rules/`
- Default resolution in `compileRulePacks`
- Direct evaluation producing a match with correct severity / category /
  confidence / path / line / capture interpolation / metadata propagation
- End-to-end via `trace_file` — confirming a custom rule appears in
  `result.diagnostics` alongside any built-ins
- Schema validation error: a rule with no `pattern` or `patterns` is
  rejected with a readable error message

Run it:

```
node --import tsx test/smoke/rule-packs.ts
```

## Full example

```yaml
# .mako/rules/supabase-hygiene.yaml
name: supabase-hygiene
rules:
  - id: supabase.direct_from_in_route
    category: rpc_helper_reuse
    severity: medium
    confidence: probable
    languages: [ts, tsx]
    message: |
      `{{capture.CLIENT}}.from('{{capture.TABLE}}')` in an API route is a
      sign the route is bypassing a helper. Check `lib/` for a canonical
      fetcher before merging.
    patterns:
      - $CLIENT.from('$TABLE')
      - $CLIENT.from("$TABLE")
    metadata:
      convention: "prefer-lib-helpers"
      reference: "https://internal.wiki/mako/supabase-helpers"

  - id: supabase.sensitive_rpc_direct_call
    category: identity_key_mismatch
    severity: high
    confidence: confirmed
    languages: [ts, tsx]
    message: |
      Sensitive RPC `{{capture.FN}}` invoked directly. Wrap through the
      tenant-scope helper in `lib/auth/rpc-scope.ts`.
    patterns:
      - $CLIENT.rpc('sensitive_admin_$OP', $$$ARGS)
      - $CLIENT.rpc("sensitive_admin_$OP", $$$ARGS)
    metadata:
      cwe: "CWE-284"
      reference: "https://internal.wiki/mako/rpc-scope"
```
