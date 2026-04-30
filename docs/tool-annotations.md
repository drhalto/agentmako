# Tool Annotations

Mako tools expose MCP annotations from one source of truth:
`packages/tools/src/tool-operational-metadata.ts`.

Every entry in `TOOL_DEFINITIONS` must use `toolAnnotations(toolName)`.
Do not hand-roll annotation objects in `tool-definitions.ts`.

## Flags

- `readOnlyHint`: the tool does not mutate Mako local state or the target
  project.
- `idempotentHint`: repeated calls with the same effective inputs should be
  safe and equivalent.
- `openWorldHint`: the tool reads live external state such as the filesystem,
  database, or external diagnostic programs.
- `destructiveHint`: the mutation is destructive or hard to reverse.

## Defaults

- Snapshot reads such as answer, composer, import, symbol, graph, and Reef read
  tools are read-only and idempotent.
- Live filesystem, live DB, and diagnostic tools set `openWorldHint`.
- Local cache refresh and diagnostic ingestion tools are mutations because they
  write Mako's local store.
- Finding acknowledgements, feedback, and review comments are append-style
  mutations.
- `tool_batch` is read-only at its public boundary but open-world because its
  inner read-only tools can inspect live state.

## Checks

`test/smoke/tool-operational-metadata.ts` verifies:

- operational metadata covers every built-in tool;
- every tool definition uses the centralized annotation row;
- public output schemas expose `_hints`;
- preview decisions are present for write-side tools.

`test/smoke/mcp-tool-metadata.ts` spot-checks the MCP-exposed annotations.
