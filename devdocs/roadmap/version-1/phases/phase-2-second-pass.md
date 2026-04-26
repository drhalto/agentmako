# Phase 2 Second Pass

This brief merges the two Phase 2 reviews into one clean follow-up pass. It separates confirmed implementation issues from non-issues so the next model does not waste time undoing correct work.

## Goal

Do a narrow cleanup pass on the shipped Phase 2 tool surface without changing the core architecture.

Keep the current structure:
- `packages/tools` remains the shared invariant tool layer.
- HTTP routes and MCP stay thin adapters over the same tool registry.
- `/api/v1/answers` stays supported.
- `createMcpExpressApp()` stays the MCP hosting pattern.

## Confirmed Good: Do Not Rework

These areas were reviewed and should not be treated as bugs:

- `createMcpExpressApp()` is valid in the installed MCP SDK and is an acceptable current integration path.
- MCP responses returning both `content` and `structuredContent` are correct for the current tool surface.
- MCP origin validation is actually wired on `/mcp`.
  Reference: [services/api/src/server.ts](../../../../services/api/src/server.ts:535)
- `readOnlyHint: true` in MCP tool registration is correct for the current MCP SDK/tool annotation model.
  Reference: [services/api/src/server.ts](../../../../services/api/src/server.ts:327)
- The new MCP smoke test is a real end-to-end verification improvement and should be kept.
- The web client no-auto-connect fix is good and should be kept.

## Must Fix

### 1. Strict identifier resolution in tools (architectural)

This item is governed by **architecture decision #18: Strict Identifier Resolution In Tools**. The distilled architecture decisions now live in [../../../architecture/overview.md](../../../architecture/overview.md); the full original decision list is archived history from the shipped Roadmap 1 pass.

Current behavior:
- `resolveIndexedFilePath()` falls back from exact file lookup to the first search hit.
  Reference: [packages/tools/src/runtime.ts](../../../../packages/tools/src/runtime.ts:76)

Why this matters:
- Agent-facing tools must be deterministic. A silent top-match pick breaks the "structured, typed, predictable" contract `packages/tools` exists to provide.
- An LLM calling `symbols_of("server.ts")` against a repo with three `server.ts` files must receive an ambiguity error listing the three candidates, not a silent pick from one of them.
- This applies uniformly to every file/route/object-input tool. There is no answer-vs-lookup carve-out.

Required change:

All tool functions in `packages/tools` that accept a named identifier must resolve it exactly against the indexed data, or return a typed `ambiguous_file` (or `ambiguous_route`, `ambiguous_object`, etc.) error with the candidate matches. No silent fallback to top search hit. This applies to:

- `symbols_of`, `exports_of`, `imports_deps`, `imports_impact` — file inputs
- `route_trace` — route inputs
- `schema_usage` — schema object inputs
- `file_health`, `auth_path` — file and feature inputs

Files to review:
- [packages/tools/src/runtime.ts](../../../../packages/tools/src/runtime.ts:76)
- [packages/tools/src/symbols/index.ts](../../../../packages/tools/src/symbols/index.ts:9)
- [packages/tools/src/imports/index.ts](../../../../packages/tools/src/imports/index.ts:51)
- [packages/tools/src/answers/](../../../../packages/tools/src/answers/) — every answer-style tool needs the same treatment on its file/route/object parameter

Additionally: **grep `packages/tools/src/` for other uses of `searchFiles(...)[0]` or similar top-hit selection patterns** and apply the same strict-resolution rule. The goal is one consistent contract across the whole tools package, not a patch limited to `runtime.ts`.

Where convenience belongs:

Interactive disambiguation, partial-input expansion, and "did you mean" prompts belong in CLI/UI wrappers that call the tools package. A CLI user typing `mako tool call . file_health server.ts` may still get helpful expansion logic in the CLI layer — but the underlying `file_health()` tool function stays strict. This is deliberate: one contract for every caller (HTTP, MCP, CLI, future SDKs), with softness only added at the human-facing edges.

Definition of done:
- A partial or ambiguous identifier passed to any `packages/tools` function returns a typed ambiguity error with candidate matches, not a silent pick.
- The rule is consistent across the whole tools package — no remaining `searchFiles(...)[0]` or equivalent silent-top-hit patterns.
- Regression assertions are in place (see "Required regression assertions" section below).

### 2. CLI `tool call` lets JSON override the positional project selector

Current behavior:
- The CLI builds tool input as:
  - `{ projectRef: projectReference, ...parsedArgs }`
- This lets `parsedArgs.projectRef` or `parsedArgs.projectId` override the positional project argument.
  Reference: [apps/cli/src/index.ts](../../../../apps/cli/src/index.ts:590)

Why this matters:
- The CLI contract becomes misleading.
- A human or agent can think they are targeting one project while the JSON payload silently redirects the call.

Required change:
- Make the positional selector authoritative.
- **Preferred fix:** spread parsed args first, set the positional selector last:
  ```typescript
  const toolInput = { ...parsedArgs, projectRef: projectReference };
  ```
  This is less surprising than rejecting fields in the JSON payload and keeps the CLI forgiving for users who want to pass extra fields. It is also a one-line change.
- Alternative: reject `projectId` / `projectRef` inside `json-args` for `mako tool call` with a validation error. Only use this if there's a reason to be noisy about the conflict.

Definition of done:
- The positional project argument cannot be silently overridden by the JSON payload.
- Tested with a CLI invocation where `json-args` contains a conflicting `projectRef` and the positional argument wins.

### 3. Smoke tests are not self-contained from a clean checkout

Current behavior:
- The smoke harness spawns the built CLI dist entrypoint.
  Reference: [test/smoke/core-mvp.ts](../../../../test/smoke/core-mvp.ts:27)
- Root `test` does not ensure a build happens first.
  Reference: [package.json](../../../../package.json:11)

Why this matters:
- `pnpm test` can fail on a clean checkout if `apps/cli/dist/index.js` does not exist yet.
- This is a workflow and CI reliability issue.

Required change:
- Make the smoke path self-contained.
- **Preferred fix:** run `build` before `smoke` in the root `test` script. This mirrors CI behavior, exercises the build on every smoke run, and avoids re-opening the tsx subprocess module resolution problem the earlier agent already fought through when they originally switched away from tsx source.
- Alternative options (only if the preferred fix has a blocker):
  - invoke the CLI source entrypoint directly in smoke (re-opens the tsx module resolution issue)
  - add a dedicated pre-smoke build step

Definition of done:
- `pnpm test` works on a clean checkout without relying on stale build output.
- After a fresh `rm -rf apps/cli/dist && pnpm test`, smoke passes without manual intervention.

### 4. Git hygiene: tracked `*.tsbuildinfo` noise

Current behavior:
- `.gitignore` ignores some `dist/` folders but does not ignore `*.tsbuildinfo` and does not ignore `extensions/**/dist/`.
  Reference: [\.gitignore](../../../../.gitignore:1)
- The repo currently tracks multiple `*.tsbuildinfo` files.

Why this matters:
- These files churn on nearly every build.
- They create noisy diffs and unnecessary merge conflicts.

Required change:
- Update `.gitignore` to include at minimum:
  - `*.tsbuildinfo`
  - `extensions/**/dist/`
- Remove already tracked `*.tsbuildinfo` files from the Git index with `git rm --cached`, without deleting local files.

Definition of done:
- `git status` no longer shows `*.tsbuildinfo` churn after a normal build.

## Should Fix

### 5. Docs say `readOnly`, implementation correctly uses `readOnlyHint`

Current state:
- Docs still say tools should declare `annotations: { readOnly: true }`.
- Implementation uses `readOnlyHint: true`, which is correct for the current MCP SDK surface.

References:
- [../../../architecture/overview.md](../../../architecture/overview.md) — distilled architecture decisions (the full Roadmap 1 decision log is archived)
- [../../../../services/api/src/server.ts](../../../../services/api/src/server.ts)

Required change:
- Update docs to use `readOnlyHint: true`.
- Optionally mention sibling MCP annotation fields so future work uses the right vocabulary:
  - `destructiveHint`
  - `idempotentHint`
  - `openWorldHint`

Definition of done:
- Docs and implementation describe the same annotation model.

### 6. `imports_cycles` traversal is more expensive than necessary

Current behavior:
- DFS revisits subgraphs repeatedly and uses `stack.includes(next)` during traversal.
  Reference: [packages/tools/src/imports/index.ts](../../../../packages/tools/src/imports/index.ts:190)

Why this matters:
- It is probably fine on the current repo.
- It will scale poorly on larger projects and is avoidably inefficient.

Required change:
- Improve cycle detection to avoid repeated traversal work.
- **Preferred approach:** three-color DFS (white/gray/black) with a finished-set. Each node is marked `white` (unvisited), `gray` (in current DFS path), or `black` (fully explored). A back-edge to a `gray` node is a cycle; a traversal to a `black` node is a no-op. This is simpler than Tarjan's SCC, deterministic, matches the roadmap's "simple and deterministic" aesthetic, and doesn't over-engineer a graph that's mostly trees.
- Full SCC (Tarjan / Kosaraju) is acceptable if someone prefers it, but not required.

Definition of done:
- The implementation avoids obvious repeated traversal and remains deterministic.
- No `stack.includes(next)` or similar O(n) lookups inside the inner DFS loop.

## Nice To Have

- Standardize ignore globs to cleaner patterns such as `**/dist/` and `**/*.tsbuildinfo` if that fits the repo style.
- Consider explicit ambiguity tests for file-targeted tools in addition to the existing negative-path coverage.

## Required Regression Assertions (Smoke Test)

The fixes for items 1 and 2 must be pinned by smoke-test assertions so they cannot silently regress. Add to `test/smoke/core-mvp.ts`:

### Assertion A — Ambiguity error for file-input tools

Create a fixture with two indexed files that share a basename, or use an existing pair already in the mako-ai repo (the repo currently has multiple `index.ts` files across `services/`, `packages/`, and `apps/` — any of those basenames work). Call `symbols_of` via the HTTP tool route with the ambiguous basename (e.g., `"index.ts"`). Assert:

1. The response is a typed error (HTTP 400 or an envelope with `ok: false`).
2. The error code is `ambiguous_file` (or whatever the implementation agent names the typed error — pin whatever string they choose).
3. The error body lists at least two candidate file paths.

Repeat the same assertion against at least one more file-input tool (e.g., `imports_deps`) to confirm the rule is applied uniformly.

### Assertion B — CLI positional-selector precedence

Attach a second project to the test state (or use an already-attached project with a different `projectId`). Invoke:

```
mako tool call <project-a-ref> symbols_of '{"projectRef":"<project-b-id>","file":"<file-in-project-a>"}' --json
```

Assert:

1. The exit code is `0` (the tool call succeeds).
2. The resolved project in the JSON output is `<project-a-ref>`, NOT `<project-b-id>`.
3. The file resolution operates against project-a's index, not project-b's.

This proves the positional argument wins over the JSON payload.

### Assertion C — Architectural coverage

Add one assertion that explicitly references decision #18: a comment in the smoke test identifying which assertions are guarding architectural decision #18, so the next reader understands why they exist and why they must not be weakened.

Without these assertions, the fixes land but are not guarded against future refactors silently reintroducing the same bugs.

## Verification For This Pass

Run at minimum:
- `corepack pnpm typecheck`
- `corepack pnpm build`
- `corepack pnpm test:smoke`
- `corepack pnpm test:smoke:web`

Additional verification:
- clean-checkout smoke reliability: `rm -rf apps/cli/dist && pnpm test` passes
- post-build `.gitignore` cleanliness for `*.tsbuildinfo`: after a build, `git status` shows no `*.tsbuildinfo` churn
- ambiguous-file assertion from section A above passes
- CLI positional-precedence assertion from section B above passes

## Deliverable Expectations

When this pass is complete, the next model should report:
1. Summary of the fixes made.
2. Files changed.
3. Verification performed and results.
4. Any residual risks left intentionally unchanged.

## Short Priority Order

1. **Strict identifier resolution in tool layer (architecture decision #18).** The load-bearing fix; everything else is polish by comparison.
2. CLI project selector precedence.
3. Self-contained smoke/build flow.
4. `.gitignore` and tracked `*.tsbuildinfo` cleanup.
5. `readOnlyHint` doc correction (already applied in this brief; implementation agent only needs to verify nothing else still says `readOnly`).
6. `imports_cycles` performance cleanup.
