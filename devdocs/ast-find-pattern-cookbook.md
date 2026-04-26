# `ast_find_pattern` Cookbook

Recipes for the `ast_find_pattern` tool (shipped in Roadmap 7 code-intel
expansion). Wraps `@ast-grep/napi` over indexed TS / TSX / JS / JSX files.

The patterns here follow
[ast-grep's pattern syntax](https://ast-grep.github.io/guide/pattern-syntax.html).
Key primitives:

- `$X` — single-node metavariable (captures one child). Names are uppercase
  by convention.
- `$$$PARAMS` — variadic metavariable (captures zero or more siblings).
- Patterns match **AST shape exactly** — the receiver of a method call is
  part of the shape. `supabase.rpc($NAME)` only matches when the receiver
  is literally `supabase`. To match any receiver, use `$OBJ.rpc($NAME)`.

All matches return `{filePath, language, lineStart, lineEnd, columnStart,
columnEnd, matchText, captures}`.

---

## 1. Logging audit — find every `console.log` call

```json
{
  "pattern": "console.log($X)",
  "captures": ["X"]
}
```

Captures the first argument. To also catch multi-arg `console.log(a, b, c)`,
use the variadic variant:

```json
{
  "pattern": "console.log($$$ARGS)",
  "captures": ["ARGS"]
}
```

## 2. `useEffect` with empty deps (structural-only pattern)

Text search can't reliably distinguish empty `[]` from any other deps array.
AST match does:

```json
{
  "pattern": "useEffect($FN, [])"
}
```

React variant with namespaced receiver:

```json
{
  "pattern": "React.useEffect($FN, [])"
}
```

## 3. Any `.rpc()` call — parameterize the receiver

`supabase.rpc($NAME)` only matches when the receiver is *literally*
`supabase`. If your project uses `client.rpc(...)`, `supabaseAdmin.rpc(...)`,
or `createClient().rpc(...)`, you'll get zero matches. Fix: parameterize
the receiver.

```json
{
  "pattern": "$OBJ.rpc($NAME, $ARGS)",
  "captures": ["OBJ", "NAME", "ARGS"]
}
```

Forgebench validation found 15 matches this way across `lib/events/*.ts`;
the overspecified version returned 0.

## 4. Error audit — every `throw new Error(...)` with captured message

```json
{
  "pattern": "throw new Error($MSG)",
  "captures": ["MSG"]
}
```

## 5. Find references to a function (cheap "who calls this")

`ast_find_pattern` can answer "who calls function `foo`" via its call shape:

```json
{
  "pattern": "foo($$$ARGS)"
}
```

For methods, include the receiver as a metavariable:

```json
{
  "pattern": "$OBJ.foo($$$ARGS)",
  "captures": ["OBJ"]
}
```

## 6. Scoped search with `pathGlob`

Narrow to a subtree before running the pattern. The glob uses path-segment
semantics (`**` crosses `/`, `*` does not).

```json
{
  "pattern": "$FN($$$ARGS)",
  "pathGlob": "app/**/*.tsx"
}
```

## 7. Async function declarations

```json
{
  "pattern": "async function $NAME($$$PARAMS) { $$$BODY }",
  "captures": ["NAME"]
}
```

To find async arrow functions instead:

```json
{
  "pattern": "async ($$$PARAMS) => { $$$BODY }"
}
```

## 8. JSX element by tag name (TSX only)

```json
{
  "pattern": "<Dialog $$$PROPS>$$$CHILDREN</Dialog>",
  "languages": ["tsx"]
}
```

## 9. `await` expression around any call

Common for auditing async boundaries:

```json
{
  "pattern": "await $CALL"
}
```

## 10. Object-property access on a specific receiver

```json
{
  "pattern": "process.env.$VAR",
  "captures": ["VAR"]
}
```

Catches every `process.env.*` access across the project — useful for
inventorying which env vars a codebase actually reads.

---

## Troubleshooting

- **Zero matches on an expected pattern**: check the zero-match warning.
  Most common cause is receiver-specificity (`supabase.rpc` vs
  `$OBJ.rpc`). Next most common is language filter — patterns are
  parsed by the specified language's grammar, so a TS pattern won't match
  inside a `.js` file unless `languages` includes `js`.

- **Too many matches**: use `pathGlob` to narrow by subtree or `languages`
  to narrow by kind. Raise `maxMatches` only after narrowing; the tool caps
  at 2000 to keep output readable.

- **Variadic metavariable silently eats everything**: `$$$X` happily
  matches zero tokens, so `foo($$$ARGS)` matches both `foo()` and
  `foo(a, b, c)`. If you only want calls with at least one argument, use
  `foo($_, $$$REST)` — the `$_` anonymous metavariable matches exactly one
  node.
