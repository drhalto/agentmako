/**
 * Action-tool family — `file_write`, `file_edit`, `apply_patch`, `create_file`,
 * `delete_file`, `shell_run`.
 *
 * Each tool exposes:
 *   - `name` — tool id used by the agent loop and the permission evaluator.
 *   - `parameters` — zod schema for the LLM's tool-call args.
 *   - `dryRun(args, ctx)` — returns a `DryRunPreview` without touching the disk.
 *   - `apply(args, ctx)` — writes a snapshot, applies the change, returns
 *     an `ApplyResult` carrying `snapshotId` so undo works.
 *
 * The harness agent loop (in `@mako-ai/harness-core/src/harness.ts`) wraps
 * every action tool's `apply()` in the permission flow:
 *
 *     dryRun → evaluator.evaluate() →
 *       allow → apply
 *       ask   → emit permission.request → await decision → allow|deny
 *       deny  → throw PermissionDeniedError
 *
 * Splitting into one-file-per-tool would have triplicated the path-guard +
 * snapshot boilerplate. The six tools share enough that a single module is
 * the right shape until any single tool needs a sub-module of its own.
 */

import { execFile, type ExecFileOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  applyPatch as applyUnifiedPatch,
  createPatch,
  parsePatch,
  type StructuredPatch,
} from "diff";
import { z } from "zod";
import { assertInsideProject } from "./path-guard.js";
import { captureSnapshot } from "./snapshots.js";
import {
  ActionToolError,
  type ActionToolContext,
  type ApplyResult,
  type DryRunPreview,
} from "./types.js";

const execFileAsync = promisify(execFile);

// -----------------------------------------------------------------------------
// Tool definition shape
// -----------------------------------------------------------------------------

export interface ActionToolDefinition<I> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  /** Permission key matched against rules (`file_write`, `shell_run`, etc.). */
  permission: string;
  dryRun(args: I, ctx: ActionToolContext): DryRunPreview;
  apply(args: I, ctx: ActionToolContext): Promise<ApplyResult>;
}

// -----------------------------------------------------------------------------
// file_write
// -----------------------------------------------------------------------------

const FileWriteParams = z.object({
  path: z.string().min(1).describe("Project-relative path of the file to write"),
  content: z.string().describe("Full file content (UTF-8 text)"),
});
type FileWriteInput = z.infer<typeof FileWriteParams>;

export const fileWriteTool: ActionToolDefinition<FileWriteInput> = {
  name: "file_write",
  description:
    "Create or overwrite a file at a project-relative path. Returns a snapshot id for undo.",
  parameters: FileWriteParams,
  permission: "file_write",
  dryRun(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    const previousBytes = existsSync(validated.absolute)
      ? readFileSync(validated.absolute).length
      : 0;
    const nextBytes = Buffer.byteLength(args.content, "utf8");
    return {
      kind: "write",
      summary: `${existsSync(validated.absolute) ? "Overwrite" : "Create"} ${validated.relativePosix} (${previousBytes} → ${nextBytes} bytes)`,
      detail: {
        path: validated.relativePosix,
        previousBytes,
        nextBytes,
        nextContentPreview: args.content.slice(0, 4000),
        truncated: args.content.length > 4000,
      },
    };
  },
  async apply(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    const snap = captureSnapshot({
      projectRoot: ctx.projectRoot,
      sessionId: ctx.sessionId,
      messageOrdinal: ctx.messageOrdinal,
      files: [validated.relativePosix],
    });
    mkdirSync(dirname(validated.absolute), { recursive: true });
    writeFileSync(validated.absolute, args.content, "utf8");
    return {
      ok: true,
      snapshotId: snap.snapshotId,
      bytesAffected: Buffer.byteLength(args.content, "utf8"),
      filesAffected: [validated.relativePosix],
    };
  },
};

// -----------------------------------------------------------------------------
// file_edit
// -----------------------------------------------------------------------------

const FileEditParams = z.object({
  path: z.string().min(1).describe("Project-relative path of the file to edit"),
  oldString: z
    .string()
    .min(1)
    .describe("Exact substring to replace (must occur exactly once unless replaceAll is true)"),
  newString: z.string().describe("Replacement string"),
  replaceAll: z.boolean().optional().describe("Replace every occurrence (default: false)"),
});
type FileEditInput = z.infer<typeof FileEditParams>;

function buildUnifiedDiff(
  relativePath: string,
  oldContent: string,
  newContent: string,
): string {
  return createPatch(relativePath, oldContent, newContent, "", "", { context: 3 });
}

export const fileEditTool: ActionToolDefinition<FileEditInput> = {
  name: "file_edit",
  description:
    "Replace a substring in an existing file. The substring must occur exactly once unless replaceAll is true.",
  parameters: FileEditParams,
  permission: "file_edit",
  dryRun(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    if (!existsSync(validated.absolute)) {
      throw new ActionToolError(
        `file \`${validated.relativePosix}\` does not exist`,
        "action/file-not-found",
      );
    }
    const oldContent = readFileSync(validated.absolute, "utf8");
    const occurrences = oldContent.split(args.oldString).length - 1;
    if (occurrences === 0) {
      throw new ActionToolError(
        `oldString not found in \`${validated.relativePosix}\``,
        "action/match-not-found",
      );
    }
    if (occurrences > 1 && !args.replaceAll) {
      throw new ActionToolError(
        `oldString matches ${occurrences} times in \`${validated.relativePosix}\` — pass replaceAll: true to apply to all`,
        "action/match-not-found",
      );
    }
    const newContent = args.replaceAll
      ? oldContent.split(args.oldString).join(args.newString)
      : oldContent.replace(args.oldString, args.newString);

    return {
      kind: "edit",
      summary: `Edit ${validated.relativePosix} (${occurrences} ${args.replaceAll ? "occurrences" : "occurrence"})`,
      detail: {
        path: validated.relativePosix,
        occurrences,
        diff: buildUnifiedDiff(validated.relativePosix, oldContent, newContent),
      },
    };
  },
  async apply(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    const oldContent = readFileSync(validated.absolute, "utf8");
    const newContent = args.replaceAll
      ? oldContent.split(args.oldString).join(args.newString)
      : oldContent.replace(args.oldString, args.newString);
    if (oldContent === newContent) {
      throw new ActionToolError(
        `oldString not found in \`${validated.relativePosix}\``,
        "action/match-not-found",
      );
    }
    const snap = captureSnapshot({
      projectRoot: ctx.projectRoot,
      sessionId: ctx.sessionId,
      messageOrdinal: ctx.messageOrdinal,
      files: [validated.relativePosix],
    });
    writeFileSync(validated.absolute, newContent, "utf8");
    return {
      ok: true,
      snapshotId: snap.snapshotId,
      bytesAffected: Buffer.byteLength(newContent, "utf8"),
      filesAffected: [validated.relativePosix],
    };
  },
};

// -----------------------------------------------------------------------------
// create_file
// -----------------------------------------------------------------------------

const CreateFileParams = z.object({
  path: z.string().min(1).describe("Project-relative path of the new file"),
  content: z.string().describe("File content (UTF-8 text)"),
});
type CreateFileInput = z.infer<typeof CreateFileParams>;

export const createFileTool: ActionToolDefinition<CreateFileInput> = {
  name: "create_file",
  description:
    "Create a new file at a project-relative path. Errors if the file already exists; use file_write to overwrite.",
  parameters: CreateFileParams,
  permission: "create_file",
  dryRun(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    if (existsSync(validated.absolute)) {
      throw new ActionToolError(
        `file \`${validated.relativePosix}\` already exists; use file_write to overwrite`,
        "action/file-already-exists",
      );
    }
    return {
      kind: "create",
      summary: `Create ${validated.relativePosix} (${Buffer.byteLength(args.content, "utf8")} bytes)`,
      detail: {
        path: validated.relativePosix,
        nextBytes: Buffer.byteLength(args.content, "utf8"),
        nextContentPreview: args.content.slice(0, 4000),
        truncated: args.content.length > 4000,
      },
    };
  },
  async apply(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    if (existsSync(validated.absolute)) {
      throw new ActionToolError(
        `file \`${validated.relativePosix}\` already exists`,
        "action/file-already-exists",
      );
    }
    const snap = captureSnapshot({
      projectRoot: ctx.projectRoot,
      sessionId: ctx.sessionId,
      messageOrdinal: ctx.messageOrdinal,
      files: [validated.relativePosix], // tombstone — file did not exist
    });
    mkdirSync(dirname(validated.absolute), { recursive: true });
    writeFileSync(validated.absolute, args.content, "utf8");
    return {
      ok: true,
      snapshotId: snap.snapshotId,
      bytesAffected: Buffer.byteLength(args.content, "utf8"),
      filesAffected: [validated.relativePosix],
    };
  },
};

// -----------------------------------------------------------------------------
// delete_file
// -----------------------------------------------------------------------------

const DeleteFileParams = z.object({
  path: z.string().min(1).describe("Project-relative path of the file to delete"),
});
type DeleteFileInput = z.infer<typeof DeleteFileParams>;

export const deleteFileTool: ActionToolDefinition<DeleteFileInput> = {
  name: "delete_file",
  description: "Delete a file at a project-relative path. Snapshot captures the bytes for undo.",
  parameters: DeleteFileParams,
  permission: "delete_file",
  dryRun(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    if (!existsSync(validated.absolute)) {
      throw new ActionToolError(
        `file \`${validated.relativePosix}\` does not exist`,
        "action/file-not-found",
      );
    }
    const bytes = readFileSync(validated.absolute).length;
    return {
      kind: "delete",
      summary: `Delete ${validated.relativePosix} (${bytes} bytes will be snapshotted)`,
      detail: { path: validated.relativePosix, bytes },
    };
  },
  async apply(args, ctx) {
    const validated = assertInsideProject(ctx.projectRoot, args.path);
    if (!existsSync(validated.absolute)) {
      throw new ActionToolError(
        `file \`${validated.relativePosix}\` does not exist`,
        "action/file-not-found",
      );
    }
    const snap = captureSnapshot({
      projectRoot: ctx.projectRoot,
      sessionId: ctx.sessionId,
      messageOrdinal: ctx.messageOrdinal,
      files: [validated.relativePosix],
    });
    rmSync(validated.absolute);
    return {
      ok: true,
      snapshotId: snap.snapshotId,
      filesAffected: [validated.relativePosix],
    };
  },
};

// -----------------------------------------------------------------------------
// apply_patch
// -----------------------------------------------------------------------------

const ApplyPatchParams = z.object({
  diff: z
    .string()
    .min(1)
    .describe(
      "Unified diff. Multiple files supported. Each file header must be `--- a/<path>` then `+++ b/<path>`.",
    ),
});
type ApplyPatchInput = z.infer<typeof ApplyPatchParams>;

interface ParsedPatchFile {
  relativePath: string;
  patch: StructuredPatch;
}

function parseUnifiedDiff(diff: string): ParsedPatchFile[] {
  const patches = parsePatch(diff);
  const files: ParsedPatchFile[] = [];

  for (const patch of patches) {
    const relativePath = normalizePatchPath(patch.newFileName ?? patch.oldFileName);
    if (!relativePath) {
      throw new ActionToolError(
        `malformed diff: missing file path`,
        "action/patch-malformed",
      );
    }
    if (patch.newFileName === "/dev/null") {
      throw new ActionToolError(
        `delete patches are not supported by apply_patch; use delete_file`,
        "action/patch-malformed",
      );
    }
    files.push({ relativePath, patch });
  }

  if (files.length === 0) {
    throw new ActionToolError(
      `no file sections found in diff`,
      "action/patch-malformed",
    );
  }
  return files;
}

function normalizePatchPath(fileName: string | undefined): string | null {
  if (!fileName || fileName === "/dev/null") {
    return null;
  }
  return fileName.replace(/\\/g, "/").replace(/^(?:a|b)\//, "");
}

export const applyPatchTool: ActionToolDefinition<ApplyPatchInput> = {
  name: "apply_patch",
  description:
    "Apply a multi-file unified diff. Hunks must apply cleanly with exact context.",
  parameters: ApplyPatchParams,
  permission: "apply_patch",
  dryRun(args, ctx) {
    const files = parseUnifiedDiff(args.diff);
    const summaries: string[] = [];
    for (const file of files) {
      const validated = assertInsideProject(ctx.projectRoot, file.relativePath);
      const status = existsSync(validated.absolute) ? "modify" : "create";
      summaries.push(`${status} ${validated.relativePosix}`);
    }
    return {
      kind: "patch",
      summary: `Patch ${files.length} file${files.length === 1 ? "" : "s"}: ${summaries.join(", ")}`,
      detail: {
        files: files.map((f) => f.relativePath),
        diff: args.diff,
      },
    };
  },
  async apply(args, ctx) {
    const files = parseUnifiedDiff(args.diff);
    const validatedPaths = files.map((f) => ({
      file: f,
      validated: assertInsideProject(ctx.projectRoot, f.relativePath),
    }));
    const snap = captureSnapshot({
      projectRoot: ctx.projectRoot,
      sessionId: ctx.sessionId,
      messageOrdinal: ctx.messageOrdinal,
      files: validatedPaths.map((p) => p.validated.relativePosix),
    });
    let totalBytes = 0;
    for (const { file, validated } of validatedPaths) {
      const currentContent = existsSync(validated.absolute)
        ? readFileSync(validated.absolute, "utf8")
        : "";
      const patchedContent = applyUnifiedPatch(currentContent, file.patch, {
        fuzzFactor: 0,
        autoConvertLineEndings: true,
      });
      if (patchedContent === false) {
        throw new ActionToolError(
          `patch does not apply cleanly to \`${validated.relativePosix}\``,
          "action/patch-malformed",
        );
      }
      mkdirSync(dirname(validated.absolute), { recursive: true });
      writeFileSync(validated.absolute, patchedContent, "utf8");
      totalBytes += Buffer.byteLength(patchedContent, "utf8");
    }
    return {
      ok: true,
      snapshotId: snap.snapshotId,
      bytesAffected: totalBytes,
      filesAffected: validatedPaths.map((p) => p.validated.relativePosix),
    };
  },
};

// -----------------------------------------------------------------------------
// shell_run
// -----------------------------------------------------------------------------

const SHELL_DEFAULT_TIMEOUT_MS = 30_000;
const SHELL_HARD_KILL_MS = 120_000;
const SHELL_OUTPUT_CAP = 100_000;
const SHELL_DEFAULT_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_OPTIONS",
  "PNPM_HOME",
]);

const ShellRunParams = z.object({
  command: z.string().min(1).describe("Executable name (no shell metacharacters)"),
  args: z
    .array(z.string())
    .describe("Argument list — never concatenated into a shell string. Pass [] for no args."),
  cwd: z
    .string()
    .optional()
    .describe("Project-relative working directory (defaults to project root)"),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(SHELL_HARD_KILL_MS)
    .optional()
    .describe(`Soft timeout in ms (default ${SHELL_DEFAULT_TIMEOUT_MS}, hard kill ${SHELL_HARD_KILL_MS})`),
  env: z
    .record(z.string())
    .optional()
    .describe("Extra env vars; keys outside the allowlist are rejected"),
});
type ShellRunInput = z.infer<typeof ShellRunParams>;

function resolveShellCwd(projectRoot: string, cwd?: string): string {
  const validated = assertInsideProject(projectRoot, cwd ?? ".", { bypassDefaultDeny: true });
  return validated.absolute;
}

function buildShellEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SHELL_DEFAULT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (!SHELL_DEFAULT_ENV_ALLOWLIST.has(k)) {
        throw new ActionToolError(
          `env key \`${k}\` is not in the shell_run allowlist`,
          "shell-run/env-not-allowlisted",
        );
      }
      env[k] = v;
    }
  }
  return env;
}

export const shellRunTool: ActionToolDefinition<ShellRunInput> = {
  name: "shell_run",
  description:
    "Run a shell command with arguments as a list (never concatenated). cwd is locked to the project root or a subdirectory; env keys must be allowlisted.",
  parameters: ShellRunParams,
  permission: "shell_run",
  dryRun(args, ctx) {
    if (/[;&|<>`$]/.test(args.command)) {
      throw new ActionToolError(
        `command \`${args.command}\` contains shell metacharacters; pass them as args or use a wrapper`,
        "shell-run/forbidden",
      );
    }
    const cwd = resolveShellCwd(ctx.projectRoot, args.cwd);
    return {
      kind: "shell",
      summary: `Run \`${args.command} ${args.args.join(" ")}\` in ${cwd}`,
      detail: {
        command: args.command,
        args: args.args,
        cwd,
        timeoutMs: args.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS,
        envExtraKeys: args.env ? Object.keys(args.env) : [],
      },
    };
  },
  async apply(args, ctx) {
    const cwd = resolveShellCwd(ctx.projectRoot, args.cwd);
    const env = buildShellEnv(args.env);
    const timeoutMs = args.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS;
    const options: ExecFileOptions = {
      cwd,
      env: env as NodeJS.ProcessEnv,
      timeout: timeoutMs,
      maxBuffer: SHELL_OUTPUT_CAP,
      windowsHide: true,
    };
    try {
      const { stdout, stderr } = await execFileAsync(args.command, args.args, options);
      const output = (
        (typeof stdout === "string" ? stdout : stdout.toString("utf8")) +
        (typeof stderr === "string" ? stderr : stderr.toString("utf8"))
      ).slice(0, SHELL_OUTPUT_CAP);
      return {
        ok: true,
        snapshotId: null, // shell side effects outside the filesystem are not undoable
        output,
      };
    } catch (error: unknown) {
      const err = error as { code?: string | number; killed?: boolean; signal?: string; message?: string };
      if (err.killed && err.signal === "SIGTERM") {
        throw new ActionToolError(
          `shell_run timed out after ${timeoutMs}ms`,
          "shell-run/timeout",
        );
      }
      throw new ActionToolError(
        `shell_run exited with non-zero status: ${err.message ?? String(error)}`,
        "shell-run/exit-nonzero",
      );
    }
  },
};

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export const ACTION_TOOLS = [
  fileWriteTool,
  fileEditTool,
  createFileTool,
  deleteFileTool,
  applyPatchTool,
  shellRunTool,
] as const;

export type ActionToolName = (typeof ACTION_TOOLS)[number]["name"];

export function getActionTool(name: string): ActionToolDefinition<unknown> | undefined {
  return ACTION_TOOLS.find((t) => t.name === name) as ActionToolDefinition<unknown> | undefined;
}
