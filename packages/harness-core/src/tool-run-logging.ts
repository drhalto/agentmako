import type { JsonValue } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore, ToolRunOutcome } from "@mako-ai/store";
import { ActionToolError } from "@mako-ai/harness-tools";
import { ZodError } from "zod";

const toolRunLogger = createLogger("mako-harness-tool-run-logging");
const TOOL_SUMMARY_PREVIEW_LIMIT = 4_096;

type HarnessToolFamily = "action" | "memory" | "semantic" | "sub_agent";

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, currentValue) => {
    if (currentValue instanceof Error) {
      return {
        name: currentValue.name,
        message: currentValue.message,
        stack: currentValue.stack,
      };
    }

    if (typeof currentValue === "bigint") {
      return currentValue.toString();
    }

    if (typeof currentValue === "function") {
      return `[function ${currentValue.name || "anonymous"}]`;
    }

    if (typeof currentValue === "symbol") {
      return currentValue.toString();
    }

    if (currentValue === undefined) {
      return "[undefined]";
    }

    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue)) {
        return "[circular]";
      }
      seen.add(currentValue);
    }

    return currentValue;
  });

  return serialized ?? "null";
}

function summarizeJsonValue(value: unknown): JsonValue {
  const serialized = safeJsonStringify(value);
  if (serialized.length <= TOOL_SUMMARY_PREVIEW_LIMIT) {
    return JSON.parse(serialized) as JsonValue;
  }

  return {
    truncated: true,
    preview: serialized.slice(0, TOOL_SUMMARY_PREVIEW_LIMIT),
    originalLength: serialized.length,
  };
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function classifyNativeToolFailure(error: unknown): ToolRunOutcome {
  if (
    error instanceof ActionToolError ||
    error instanceof ZodError ||
    (error instanceof Error && error.name === "PermissionDeniedError")
  ) {
    return "failed";
  }
  return "error";
}

function classifyResultOutcome(result: unknown): ToolRunOutcome {
  if (result && typeof result === "object" && "ok" in result && (result as { ok?: unknown }).ok === false) {
    return "failed";
  }
  return "success";
}

function extractResultErrorText(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("ok" in result) || (result as { ok?: unknown }).ok !== false) {
    return undefined;
  }

  const candidate = result as { error?: unknown; reason?: unknown };

  if (typeof candidate.error === "string" && candidate.error.trim() !== "") {
    return candidate.error;
  }
  if (typeof candidate.reason === "string" && candidate.reason.trim() !== "") {
    return candidate.reason;
  }
  return undefined;
}

export function logHarnessToolRun(args: {
  store: ProjectStore;
  projectId?: string | null;
  toolName: string;
  toolFamily: HarnessToolFamily;
  input: unknown;
  output?: unknown;
  startedAtMs: number;
  sessionId: string;
  callId: string;
  error?: unknown;
}): void {
  const finishedAtMs = Date.now();
  const outcome = args.error === undefined ? classifyResultOutcome(args.output) : classifyNativeToolFailure(args.error);
  const errorText = args.error === undefined ? extractResultErrorText(args.output) : toErrorText(args.error);

  try {
    args.store.insertToolRun({
      projectId: args.projectId ?? undefined,
      toolName: args.toolName,
      inputSummary: summarizeJsonValue(args.input),
      outputSummary: args.output === undefined ? undefined : summarizeJsonValue(args.output),
      payload: {
        toolFamily: args.toolFamily,
        sessionId: args.sessionId,
        callId: args.callId,
      },
      outcome,
      startedAt: new Date(args.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - args.startedAtMs,
      errorText,
    });
  } catch (error) {
    toolRunLogger.warn("log-write-failed", {
      target: "project.tool_runs",
      toolName: args.toolName,
      projectId: args.projectId ?? null,
      sessionId: args.sessionId,
      callId: args.callId,
      error: toErrorText(error),
    });
  }
}
