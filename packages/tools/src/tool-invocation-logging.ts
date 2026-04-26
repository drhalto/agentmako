import { loadConfig } from "@mako-ai/config";
import type { JsonValue } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { openProjectStore } from "@mako-ai/store";
import { ZodError } from "zod";
import { MakoToolError } from "./errors.js";
import { borrowGlobalStore, resolveProjectFromToolContext } from "./project-resolver.js";
import type { ToolServiceOptions } from "./runtime.js";

const registryLogger = createLogger("mako-tools", { component: "registry" });
const TOOL_SUMMARY_PREVIEW_LIMIT = 4_096;

export function safeJsonStringify(value: unknown): string {
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

export function summarizeJsonValue(value: unknown): JsonValue {
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

export function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function classifyToolFailure(error: unknown): "failed" | "error" {
  return error instanceof MakoToolError || error instanceof ZodError ? "failed" : "error";
}

export function extractProjectLocator(input: unknown): { projectId?: string; projectRef?: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const candidate = input as { projectId?: unknown; projectRef?: unknown };
  return {
    projectId: typeof candidate.projectId === "string" && candidate.projectId.trim() !== "" ? candidate.projectId.trim() : undefined,
    projectRef: typeof candidate.projectRef === "string" && candidate.projectRef.trim() !== "" ? candidate.projectRef.trim() : undefined,
  };
}

export async function resolveToolProjectForLogging(
  input: unknown,
  options: ToolServiceOptions,
): Promise<{ projectId: string; canonicalPath: string } | null> {
  try {
    const resolved = await resolveProjectFromToolContext(extractProjectLocator(input), options);
    return {
      projectId: resolved.projectId,
      canonicalPath: resolved.canonicalPath,
    };
  } catch {
    return null;
  }
}

export async function writeToolInvocationLogs(args: {
  toolName: string;
  input: unknown;
  output?: unknown;
  outcome: "success" | "failed" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorText?: string;
  requestId?: string;
  options: ToolServiceOptions;
}): Promise<void> {
  const config = loadConfig(args.options.configOverrides);
  const project = await resolveToolProjectForLogging(args.input, args.options);

  try {
    borrowGlobalStore(args.options, (store) => {
      store.upsertToolUsageStat(args.toolName, project?.projectId);
    });
  } catch (error) {
    registryLogger.warn("log-write-failed", {
      target: "global.tool_usage_stats",
      toolName: args.toolName,
      error: toErrorText(error),
    });
  }

  if (!project) {
    return;
  }

  const storeOptions = {
    projectRoot: project.canonicalPath,
    stateDirName: config.stateDirName,
    projectDbFilename: config.projectDbFilename,
  };
  const cache = args.options.projectStoreCache;
  const projectStore = cache ? cache.borrow(storeOptions) : openProjectStore(storeOptions);

  try {
    projectStore.insertToolRun({
      projectId: project.projectId,
      toolName: args.toolName,
      inputSummary: summarizeJsonValue(args.input),
      outputSummary: args.output === undefined ? undefined : summarizeJsonValue(args.output),
      outcome: args.outcome,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      durationMs: args.durationMs,
      requestId: args.requestId,
      errorText: args.errorText,
    });
  } catch (error) {
    registryLogger.warn("log-write-failed", {
      target: "project.tool_runs",
      toolName: args.toolName,
      projectId: project.projectId,
      error: toErrorText(error),
    });
  } finally {
    if (!cache) {
      projectStore.close();
    }
  }
}
