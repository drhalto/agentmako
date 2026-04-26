import { randomUUID } from "node:crypto";
import type {
  JsonObject,
  ToolBatchInput,
  ToolBatchResult,
  ToolBatchToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

function asJsonObject(value: unknown): JsonObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return undefined;
}

function summarizeJsonObject(value: JsonObject): JsonObject {
  const summary: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      summary[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      summary[key] = { count: entry.length };
      continue;
    }
    if (typeof entry === "object") {
      summary[key] = { keys: Object.keys(entry).slice(0, 12) };
    }
  }
  return summary;
}

function rejectedResult(
  op: ToolBatchInput["ops"][number],
  durationMs: number,
  code: NonNullable<ToolBatchResult["error"]>["code"],
  message: string,
): ToolBatchResult {
  return {
    label: op.label,
    tool: op.tool,
    ok: false,
    durationMs,
    error: { code, message },
  };
}

function emitToolBatchTelemetry(args: {
  projectStore: import("@mako-ai/store").ProjectStore;
  projectId: string;
  requestId?: string;
  results: readonly ToolBatchResult[];
}): void {
  try {
    const succeeded = args.results.filter((result) => result.ok).length;
    const failed = args.results.length - succeeded;
    args.projectStore.insertUsefulnessEvent({
      eventId: randomUUID(),
      projectId: args.projectId,
      requestId: args.requestId ?? `req_${randomUUID()}`,
      decisionKind: "wrapper_usefulness",
      family: "tool_batch",
      toolName: "tool_batch",
      grade: failed === 0 ? "full" : succeeded > 0 ? "partial" : "no",
      reasonCodes: [
        succeeded > 0 ? "ops_succeeded" : "no_ops_succeeded",
        failed > 0 ? "ops_failed_or_rejected" : "no_ops_failed",
      ],
      reason: `tool_batch completed ${succeeded}/${args.results.length} operation(s).`,
    });
  } catch {
    // Telemetry must never affect the tool result.
  }
}

export async function toolBatchTool(
  input: ToolBatchInput,
  options: ToolServiceOptions = {},
): Promise<ToolBatchToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const maxOps = Math.min(input.maxOps ?? 8, input.ops.length);
    const ops = input.ops.slice(0, maxOps);
    const warnings: string[] = [];
    if (input.ops.length > maxOps) {
      warnings.push(`truncated: ${input.ops.length - maxOps} operation(s) were skipped by maxOps.`);
    }

    const { getToolDefinition } = await import("../tool-definitions.js");
    const { invokeTool } = await import("../registry.js");
    const results: ToolBatchResult[] = [];
    const continueOnError = input.continueOnError ?? true;

    for (const op of ops) {
      const opStartedAtMs = Date.now();
      if ((op.tool as string) === "tool_batch") {
        results.push(rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "recursive_batch_rejected",
          "tool_batch cannot call itself.",
        ));
        if (!continueOnError) break;
        continue;
      }

      const definition = getToolDefinition(op.tool);
      if (!definition) {
        results.push(rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "unknown_tool",
          `Unknown tool: ${op.tool}`,
        ));
        if (!continueOnError) break;
        continue;
      }

      if ("mutation" in definition.annotations) {
        results.push(rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "mutation_rejected",
          `${op.tool} is a mutation tool and cannot be called from read-only tool_batch.`,
        ));
        if (!continueOnError) break;
        continue;
      }

      try {
        const args = {
          ...(op.args ?? {}),
          projectId: project.projectId,
        };
        const output = await invokeTool(op.tool, args, options);
        const result = asJsonObject(output);
        const summarizeResult = op.resultMode === "summary" ||
          (op.resultMode !== "full" && input.verbosity === "compact");
        results.push({
          label: op.label,
          tool: op.tool,
          ok: true,
          durationMs: Math.max(0, Date.now() - opStartedAtMs),
          ...(result && summarizeResult ? { resultSummary: summarizeJsonObject(result) } : {}),
          ...(result && !summarizeResult ? { result } : {}),
        });
      } catch (error) {
        results.push(rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "tool_error",
          error instanceof Error ? error.message : String(error),
        ));
        if (!continueOnError) break;
      }
    }

    const succeededOps = results.filter((result) => result.ok).length;
    const rejectedOps = results.filter((result) =>
      result.error?.code === "mutation_rejected" ||
      result.error?.code === "recursive_batch_rejected" ||
      result.error?.code === "unknown_tool"
    ).length;
    const failedOps = results.length - succeededOps;

    emitToolBatchTelemetry({
      projectStore,
      projectId: project.projectId,
      requestId: options.requestContext?.requestId,
      results,
    });

    return {
      toolName: "tool_batch",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      results,
      summary: {
        requestedOps: input.ops.length,
        executedOps: results.length,
        succeededOps,
        failedOps,
        rejectedOps,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      },
      warnings,
    };
  });
}
