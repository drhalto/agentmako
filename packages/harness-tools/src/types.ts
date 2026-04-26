/**
 * Shared types for the action-tool family.
 *
 * Action tools come in two flavors:
 *   1. Read-only tools (e.g. `file_read`) — execute immediately, no approval.
 *   2. Mutation tools (`file_write`, `file_edit`, etc.) — must produce a
 *      dry-run preview, persist a snapshot, and pass through the permission
 *      evaluator before applying.
 *
 * Every mutation tool returns a structured result with a `snapshotId` so
 * `agentmako session undo <session> <ordinal>` can reverse the change.
 */

export interface ActionToolContext {
  /** Active project root — every path is validated against this. */
  projectRoot: string;
  /** Session id; used for snapshot directory layout. */
  sessionId: string;
  /** Ordinal of the assistant message that owns this tool call. */
  messageOrdinal: number;
}

export interface DryRunPreview {
  kind: "write" | "edit" | "patch" | "create" | "delete" | "shell";
  /** Human-readable summary used in CLI prompts and SSE event payloads. */
  summary: string;
  /** Full payload — bytes for writes, unified diff for edits, command for shell. */
  detail: unknown;
}

export interface ApplyResult {
  ok: true;
  snapshotId: string | null;
  bytesAffected?: number;
  filesAffected?: string[];
  output?: string;
}

export class ActionToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | "action/path-outside-project"
      | "action/snapshot-failed"
      | "action/file-not-found"
      | "action/file-already-exists"
      | "action/match-not-found"
      | "action/patch-malformed"
      | "shell-run/timeout"
      | "shell-run/env-not-allowlisted"
      | "shell-run/exit-nonzero"
      | "shell-run/forbidden",
  ) {
    super(message);
    this.name = "ActionToolError";
  }
}
