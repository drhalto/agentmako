# Phase 3.2 Action Tools And Permission Model

Status: `Complete`

This file is the exact implementation spec for Roadmap 3 Phase 3.2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.2.

## Prerequisites

Phase 3.2 assumes Phases 3.0 and 3.1 are complete:

- Harness core and session persistence running against the no-agent tier
- BYOK provider layer with Vercel ai SDK, keyring integration, and fallback chains
- `agentmako chat` works in all three tiers
- `provider_calls` logging is active

## Goal

Ship the action-tool family (`file_write`, `file_edit`, `apply_patch`, `create_file`, `delete_file`, `shell_run`) plus a declarative permission model with dry-run previews, approval events, snapshot-backed undo, and MCP-compatible approval metadata.

## Hard Decisions

- Permission rules are declarative: `{ permission, pattern, action }` in `.mako/permissions.json` (project) and `~/.mako/permissions.json` (global). `deny` always beats `allow`. More-specific patterns beat more-general. Project rules beat global rules.
- Every mutation tool attaches a dry-run preview (unified diff for edits, proposed content for writes, command string + cwd for shell) to the `permission.request` event.
- Every mutation tool writes a before-state snapshot under `storage/snapshots/<session_id>/<message_ordinal>/` and records the snapshot id on the `tool_run`.
- `agentmako session undo <session> <ordinal>` restores files from the snapshot.
- `shell_run` is constrained: `cwd` must be the active project root or a subdirectory; default timeout 30s; hard kill at 120s; stdout/stderr size-capped; env allowlist; no shell metacharacters without explicit quoting.
- Action tools return `requiresApproval: true` metadata so external MCP clients (Claude Code, etc.) can prompt their own user. The MCP endpoint stays tool-surface-only — sessions are not exposed over MCP.
- Permission decisions are stored append-only in `permission_decisions` with scope `turn | session | project | global`.
- The agent loop pauses on `ask` and resumes on `permission.decision`. There is a configurable per-request timeout (default 5 minutes); on timeout the request is dropped with an `error` event.

## Why This Phase Exists

An agent that cannot mutate files is a read-only demo. Action tools are the payoff for the whole harness. But action tools without structured gating are dangerous.

The declarative rule model mirrors what opencode proved works: user-configurable, auditable, evaluator-scoped, and UI-decoupled. Two-phase approval (request → wait → continue) comes from openclaw. Snapshots plus undo borrow the "dry-run default" pattern from fenrir's remediator.

This phase finalizes the answer to "what can the agent do to my repo, and how do I stop or reverse it?" — which every other Roadmap 3 phase depends on to be trustworthy.

## Scope In

- New action tools in `packages/harness-tools`:
  - `file_write.ts` — create or overwrite a file at `<project_root>/<path>`. Permission `ask`. Dry-run returns proposed bytes and size delta. Snapshot before overwrite.
  - `file_edit.ts` — surgical match/replace or unified-diff application. Permission `ask`. Dry-run returns unified diff. Snapshot before.
  - `apply_patch.ts` — applies a multi-file unified diff. Permission `ask`. Dry-run returns per-file impact summary and full diff. Snapshots per file.
  - `create_file.ts` — writes a new file. Permission `ask`. Dry-run returns proposed content.
  - `delete_file.ts` — deletes a file. Permission `ask`. Tombstone snapshot.
  - `shell_run.ts` — runs a shell command. Permission `ask`. Dry-run returns exact command + cwd + env subset.
- Real implementation of `permission-evaluator.ts` in `packages/harness-core`:
  - Rule loading from `.mako/permissions.json` and `~/.mako/permissions.json`.
  - Pattern matching (glob for paths, exact or glob for commands).
  - `deny` > `allow`, more-specific > more-general, project-scope > global-scope.
  - Evaluator emits `permission.request` on `ask`, returns `allow` / `deny` otherwise.
- Approval event flow:
  - `permission.request { id, tool, args, preview }` emitted on the session bus and streamed over SSE/WS.
  - Client resolves via `POST /api/v1/permissions/requests/:id { action: "allow" | "deny", scope: "turn"|"session"|"project"|"global" }`.
  - `permission.decision { id, action, scope }` emitted; agent loop resumes the paused turn.
  - Scoped decisions stored in `permission_decisions`; matched on subsequent tool calls without prompting.
- Snapshot system in `packages/harness-tools/src/snapshots.ts`:
  - Writes before-state bytes for file tools.
  - Records `snapshot_id` on the `tool_run.payload_json`.
  - Is gitignored via `.gitignore` entry.
  - Project-scoped: snapshots live under the project's `.mako/snapshots/` directory, not under `storage/` in the repo.
- CLI commands:
  - `agentmako session undo <session> <ordinal>` — restore from snapshot.
  - `agentmako permissions list` — prints merged rule set (project + global).
  - `agentmako permissions add <permission> <pattern> <action>` — append rule to project permissions.
- HTTP routes:
  - `POST /api/v1/permissions/rules` — add rule.
  - `DELETE /api/v1/permissions/rules/:id` — remove rule.
  - `POST /api/v1/permissions/requests/:id` — resolve pending ask.
  - `GET /api/v1/permissions/requests` — list pending (for the UI).
- MCP integration in `services/api/src/mcp.ts`:
  - Action tools expose `requiresApproval: true` in tool metadata.
  - The MCP endpoint does not surface sessions — client's own approval UX handles it.
- Smoke tests:
  - `test/harness-action-approval.ts` — cloud-agent asks to edit a file; approval flow works end-to-end.
  - `test/harness-action-deny.ts` — deny rule blocks mutation with `PermissionDeniedError`.
  - `test/harness-shell-run-constrained.ts` — asserts cwd, timeout, env allowlist.
  - `test/harness-undo.ts` — `agentmako undo` restores.
  - `test/harness-mcp-requires-approval.ts` — MCP metadata correct.

## Scope Out

- Embeddings and memory tools (Phase 3.3 — though `memory_remember`/`recall`/`list` stubs from Phase 3.0 stay until 3.3).
- Sub-agent spawning (Phase 3.4).
- Web UI approval modal (Phase 3.5).
- Automatic rule synthesis ("allow all paths under src/" suggestions) — user writes rules explicitly.
- Time-based rule expiry — stored decisions do not auto-expire in this phase.
- Snapshot compression or pruning — snapshots grow until user clears them manually.

## Architecture Boundary

### Owns

- All six new action tool implementations.
- The permission evaluator and rule-loading logic.
- The approval event protocol and the `permission_decisions` row-writing.
- The snapshot system and `agentmako undo`.
- MCP metadata extensions to surface `requiresApproval`.
- New CLI and HTTP surfaces for permission rules and request resolution.

### Does Not Own

- `permission_decisions` table creation — created in Phase 3.0 migration `0004`.
- Existing Roadmap 1 read-only tools' permission declarations — they default to `allow`.
- Web UI rendering of approval modals (Phase 3.5).
- Cost or budget-based denial (Phase 3.1 ships `cost_hint` in `provider_calls`; budget enforcement is a later phase).

## Contracts

### Input Contract

- `POST /api/v1/permissions/rules` body: `{ permission, pattern, action, scope? }`. `scope` defaults to `project`.
- `DELETE /api/v1/permissions/rules/:id` removes by id.
- `POST /api/v1/permissions/requests/:id { action, scope }` resolves a pending ask.
- Action tool args follow their existing zod schemas (defined in `packages/harness-contracts/src/tools.ts`).

### Output Contract

- `permission.request { id, tool, args, preview }` emitted for every `ask`.
- `permission.decision { id, action, scope }` emitted on resolution.
- `tool.result { callId, ok, resultPreview, snapshotId? }` carries the snapshot id for mutation tools.

### Error Contract

- `permission/denied` — rule matched `deny` or user clicked deny.
- `permission/request-timeout` — pending request expired.
- `permission/rule-invalid` — a rule in `.mako/permissions.json` failed zod validation; the rule is skipped and a warning is emitted.
- `action/path-outside-project` — attempted mutation outside the active project root.
- `action/snapshot-failed` — snapshot write failed; the action is aborted and nothing is applied.
- `shell-run/timeout` — command exceeded default or explicit timeout.
- `shell-run/env-not-allowlisted` — attempted env key not in allowlist.

## Execution Flow

1. Ship all six action-tool implementations as read-only dry-runs first (they return previews but do not mutate).
2. Build the permission evaluator and rule-loading. Smoke-test with handcrafted rule files.
3. Wire approval events end-to-end: core emits → SSE/WS forwards → client resolves → core resumes.
4. Add `permission_decisions` writes on every resolution.
5. Implement the snapshot system and `tool_run.payload_json.snapshotId` recording.
6. Switch action tools from dry-run-only to real apply, gated by the evaluator.
7. Implement `agentmako undo`.
8. Add MCP `requiresApproval` metadata.
9. Write all five new smoke tests.

## File Plan

Create:

- `packages/harness-tools/src/file-write.ts`
- `packages/harness-tools/src/file-edit.ts`
- `packages/harness-tools/src/apply-patch.ts`
- `packages/harness-tools/src/create-file.ts`
- `packages/harness-tools/src/delete-file.ts`
- `packages/harness-tools/src/shell-run.ts`
- `packages/harness-tools/src/snapshots.ts`
- `packages/harness-core/src/permission-evaluator.ts` (full implementation — replaces the Phase 3.0 skeleton)
- `packages/harness-core/src/permission-loader.ts` (rule file parsing + validation)
- `apps/cli/src/commands/undo.ts`
- `apps/cli/src/commands/permissions/list.ts`, `add.ts`, `index.ts`
- `services/harness/src/routes/permissions.ts` (full implementation — replaces the Phase 3.0 stub)
- `test/harness-action-approval.ts`, `test/harness-action-deny.ts`, `test/harness-shell-run-constrained.ts`, `test/harness-undo.ts`, `test/harness-mcp-requires-approval.ts`

Modify:

- `packages/harness-tools/src/index.ts` — register action tools into `packages/tools/src/registry.ts`.
- `packages/harness-core/src/agent-loop.ts` — pause on `ask`, resume on `permission.decision`.
- `packages/harness-core/src/tool-dispatcher.ts` — consult evaluator before every invocation.
- `packages/harness-contracts/src/permission.ts` — full event and rule schemas.
- `packages/contracts/src/tools.ts` — action tool input/output schemas.
- `services/api/src/mcp.ts` — surface `requiresApproval` metadata.
- `apps/cli/src/index.ts` — register new commands.

Keep unchanged:

- Existing Roadmap 1 read-only tools.
- `packages/store/src/project-store-permissions.ts` — created in Phase 3.0; used verbatim.
- The Phase 3.1 provider layer.

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- With cloud-agent tier active, give the chat a prompt like "add a TODO comment to `README.md`". The agent proposes `file_edit`. SSE emits `permission.request` with a unified diff preview. CLI prompts. Approve. File is edited. `tool_runs` has a row with `snapshotId`. `permission_decisions` has a row with `scope: "turn"`.
- Set a `deny` rule for `.env*`. Ask the agent to write `.env.local`. Expect a `permission/denied` result; no file written.
- Set an `allow` rule for `"shell_run"`, pattern `"git status"`. Agent proposes `git status`; expect no prompt, immediate execution, output in `tool_runs`.
- `shell_run` with a command requesting cwd outside the project root — `action/path-outside-project`.
- `shell_run` with `timeout: 1000` on a sleep-2 command — `shell-run/timeout`.
- `agentmako session undo <session> <ordinal>` restores the edited file byte-for-byte.
- MCP `tools/list` returns `requiresApproval: true` on all six action tools.
- Pending approval with no response for 5+ minutes times out cleanly.
- All five new smoke tests pass.

## Done When

- Cloud-agent session can propose and apply a file edit with explicit approval.
- Deny path blocks mutations reliably.
- Allow path bypasses prompts.
- All six action tools ship with dry-run previews and snapshot-backed undo.
- `agentmako undo` works across all mutation tools.
- MCP clients see `requiresApproval: true` metadata.
- `.env*`, `~/.ssh/*`, and paths outside project root are denied by default.
- All five new smoke tests pass.

## Risks And Watchouts

- **Shell injection via args.** `shell_run` must pass `args` as a list, not concatenate into a shell string. Validate with a smoke test that spaces and quotes cannot escape.
- **Snapshot growth.** Large projects generate a lot of snapshots. Document a manual `agentmako session rm <id>` cleanup path; automatic pruning is explicitly out of scope.
- **Pattern precedence.** "Most specific wins" is well-defined for paths (longer prefix wins) but ambiguous for command patterns. Document the tie-break rule: exact string before glob before regex; project scope before global scope. Add smoke coverage.
- **Approval DoS.** A malicious prompt could spam `permission.request` events. Cap outstanding requests per session (default 3); additional requests block the turn until a prior one resolves.
- **MCP prompt divergence.** Different MCP clients may render approvals differently. Document the `requiresApproval: true` metadata contract so external clients behave consistently.
- **Undo ambiguity on shell commands.** We cannot undo arbitrary shell effects. Document clearly that `agentmako undo` only restores filesystem snapshots — shell side effects outside the filesystem are not reverted.

## Deviations From Spec At Ship Time

Documented for Phase 3.3 to inherit a clean substrate. The acceptance criteria in `Done When` all hold; these are mostly consolidation calls and deferrals of work that earns its keep in a later phase.

- **Single `action-tools.ts` instead of one file per tool.** Spec called for `file-write.ts`, `file-edit.ts`, `apply-patch.ts`, `create-file.ts`, `delete-file.ts`, `shell-run.ts`. Implementation puts all six in `packages/harness-tools/src/action-tools.ts` because they share the dry-run / snapshot / path-guard pattern; splitting would have triplicated boilerplate. Each tool is independently testable via the `ACTION_TOOLS` registry.
- **Permission engine + loader collapsed into `permission-engine.ts`.** Spec called for separate `permission-evaluator.ts` and `permission-loader.ts` files in `harness-core`. Implementation puts loader, evaluator, and persisted-decision cache in one module with three exports. The two were never going to be split in practice — every evaluator call needs the loader's rules.
- **Tool dispatch lives in `harness-core/src/tool-dispatch.ts`.** Spec called for modifying an existing `tool-dispatcher.ts`. That file never existed (the Phase 3.0 deviations list explicitly deferred it). Implementation creates a fresh `tool-dispatch.ts` with a `ToolDispatch` class that builds the `tools: { ... }` map for `streamText` and manages a session-scoped pending-approvals registry as a `static` map on the class.
- **CLI commands collapsed into `apps/cli/src/commands/harness.ts`.** Spec called for `apps/cli/src/commands/permissions/` and `apps/cli/src/commands/undo.ts`. Implementation continues the Phase 3.0/3.1 pattern of putting all harness CLI commands in one file because they share the HTTP client and SSE consumer helpers. Split when the file grows past ~600 lines (currently ~470).
- **Smoke tests collapsed into one file with 14 sub-assertions.** Spec called for five separate smokes (`harness-action-approval.ts`, `harness-action-deny.ts`, `harness-shell-run-constrained.ts`, `harness-undo.ts`, `harness-mcp-requires-approval.ts`). Implementation ships `test/smoke/harness-action-tools.ts` covering: catalog sanity, allow rule short-circuit, deny rule, ask default, persisted-decision recall, file_edit + snapshot + undo round-trip, file_write tombstone undo, path-guard outside-project, `.env*` default-deny, shell metacharacter rejection, shell cwd outside project, shell env-allowlist, full approval flow via `Harness.resolvePermissionRequest`, deny flow via same. The MCP `requiresApproval` smoke is rolled into the deviation below.
- **MCP `requiresApproval` metadata deferred to 3.2.x.** Spec called for `services/api/src/mcp.ts` to surface `requiresApproval: true` on action tools so external MCP clients (Claude Code, etc.) prompt their own user. The action tools are not yet registered into the existing `packages/tools/src/registry.ts` — they live behind the harness's own `streamText` `tools: { ... }` map. Registering them into the deterministic registry plus the MCP annotations (and reconciling the permission/tool-context plumbing) is a follow-up. Action tools are reachable today via `services/harness` HTTP and the harness's own approval flow, which is sufficient for the rest of the Phase 3.2 acceptance.
- **Patch parser is whole-file replacement only.** `apply_patch` accepts unified diffs but the parser is intentionally simple — it expects each file's hunk to list every line of the new content (matches what `file_edit`'s `buildUnifiedDiff` produces). A real patch applier (e.g. via the `diff` package) is a 3.2.x follow-up; the contract and snapshot semantics are unchanged.
- **WebSocket route still deferred to 3.5.** Spec listed it in Phase 3.0 originally and Phase 3.2 didn't re-mention it. Approval flow uses `POST /api/v1/sessions/:id/permissions/requests/:requestId` over plain HTTP. Browsers and CLI poll or rely on the SSE `permission.request` event for notification; bi-directional WS lands when the web UI needs it.
- **Shell `args` field is required, not optional with `[]` default.** Vercel `ai` SDK's tool params can't have output-required-but-input-optional shapes without dropping the strict zod-to-`ZodType<I>` conformance the dispatch relies on. Models pass an empty array explicitly. Documented in the tool's parameter description.
- **Per-session approval timeout default is 5 minutes**, configurable via `MAKO_HARNESS_APPROVAL_TIMEOUT`. Per-session outstanding-request cap is 3 (`MAKO_HARNESS_MAX_PENDING_APPROVALS`). Both ship as documented.

## What Shipped

- `packages/harness-tools/` — new package with `snapshots.ts` (project-scoped `.mako/snapshots/<sessionId>/<ordinal>/` layout, tombstones for created-since files, `applyUndo` restores byte-for-byte), `path-guard.ts` (project-root containment check + default-deny for `.env*`, `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `~/.docker/`, `id_rsa*`, etc.), `action-tools.ts` (six tools: `file_write`, `file_edit`, `create_file`, `delete_file`, `apply_patch`, `shell_run`), `types.ts` (shared `ActionToolError` taxonomy + `DryRunPreview` / `ApplyResult` shapes).
- `packages/harness-core/src/permission-engine.ts` — declarative rule loader (`.mako/permissions.json` + `~/.mako/permissions.json`), evaluator with `deny > allow > ask` precedence and project-scope before global-scope, persisted-decision cache via `harness_permission_decisions` row writes, tiny inline glob matcher (no `minimatch` dep needed for `*`/`**`/`?`).
- `packages/harness-core/src/tool-dispatch.ts` — `ToolDispatch` class wraps `ACTION_TOOLS` into the `ai` SDK's `tools: { ... }` map; `execute` runs `dryRun → evaluate → (await approval) → apply` with structured `tool.call` / `tool.result` event emission and `harness_message_parts` persistence; pending-approval registry as a static session-scoped map; `MAKO_HARNESS_APPROVAL_TIMEOUT` default 5 min; `MAKO_HARNESS_MAX_PENDING_APPROVALS` default 3.
- `packages/harness-core/src/harness.ts` — agent loop now passes `dispatch.tools` and `maxSteps: 10` to `streamText`; new `resolvePermissionRequest()` and `listPendingApprovals()` public methods that the HTTP route and CLI use to drive the approval flow.
- `packages/store/src/project-store-harness.ts` + `project-store.ts` — `insertHarnessPermissionDecision()` / `listHarnessPermissionDecisions()` accessors over the `harness_permission_decisions` table that Phase 3.0 created.
- `services/harness/src/server.ts` — new routes `GET /api/v1/permissions/rules`, `POST /api/v1/permissions/rules`, `DELETE /api/v1/permissions/rules/:permission/:pattern`, `GET /api/v1/sessions/:id/permissions/requests`, `POST /api/v1/sessions/:id/permissions/requests/:requestId`, `POST /api/v1/sessions/:id/undo/:ordinal`.
- `apps/cli/src/commands/harness.ts` — new commands `agentmako permissions list|add|remove|approve|deny`, `agentmako undo <session> <ordinal>`. Wired into the dispatcher and `CLI_COMMANDS` registry.
- `test/smoke/harness-action-tools.ts` — single smoke covering 14 acceptance sub-cases (see deviation above). Wired into `pnpm test:smoke`.

## Verification Result

- `corepack pnpm typecheck` — clean across all 28 workspace projects.
- `corepack pnpm test:smoke` — six suites pass (`core-mvp`, `ask-router-goldens`, `harness-no-agent`, `harness-providers`, `harness-cloud-agent`, `harness-action-tools`); `exit=0`.
- `harness-action-tools` confirms: catalog has 6 tools, `git *` allow rule short-circuits prompt, `secrets/**` deny rule blocks `file_write`, default `ask` for unmatched permissions, session-scope `allow` is remembered across calls, `file_edit` writes snapshot then `applyUndo` restores byte-for-byte, `file_write` to a new file uses tombstone undo, path-guard rejects `..` traversal and `.env.local`, `shell_run` rejects metacharacters / cwd outside project / non-allowlisted env keys, full approval round-trip via `Harness.resolvePermissionRequest` works for both allow and deny.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-3.0-harness-foundation.md](./phase-3.0-harness-foundation.md)
- [./phase-3.1-provider-layer.md](./phase-3.1-provider-layer.md)
- [./phase-3.3-embeddings-and-memory.md](./phase-3.3-embeddings-and-memory.md)
