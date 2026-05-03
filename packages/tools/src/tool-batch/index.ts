import { randomUUID } from "node:crypto";
import type {
  JsonObject,
  JsonValue,
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

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonValues(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value as JsonValue[] : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function countSummary(value: unknown): JsonObject {
  return { count: jsonArray(value).length };
}

function compactReefAskSummary(value: JsonObject): JsonObject | undefined {
  if (value.toolName !== "reef_ask") {
    return undefined;
  }

  const answer = jsonRecord(value.answer);
  const queryPlan = jsonRecord(value.queryPlan);
  const evidence = jsonRecord(value.evidence);
  const freshness = jsonRecord(value.freshness);
  const limits = jsonRecord(value.limits);
  const decisionTrace = jsonRecord(answer?.decisionTrace);
  const diagnosticSummary = jsonRecord(answer?.diagnosticSummary);
  const inventorySummary = jsonRecord(answer?.inventorySummary);
  const databaseObjectSummary = jsonRecord(answer?.databaseObjectSummary);
  const findingsSummary = jsonRecord(answer?.findingsSummary);
  const literalMatchesSummary = jsonRecord(answer?.literalMatchesSummary);
  const whereUsedSummary = jsonRecord(answer?.whereUsedSummary);

  const summary: JsonObject = {
    toolName: "reef_ask",
    question: stringValue(value.question) ?? "",
    answer: {
      summary: stringValue(answer?.summary) ?? "",
      confidence: stringValue(answer?.confidence) ?? "low",
      confidenceReasons: jsonArray(answer?.confidenceReasons).filter((item): item is string => typeof item === "string"),
      ...(diagnosticSummary
        ? {
            diagnostic: {
              gate: stringValue(diagnosticSummary.gate) ?? "unknown",
              canClaimVerified: booleanValue(diagnosticSummary.canClaimVerified) ?? false,
              verificationStatus: stringValue(diagnosticSummary.verificationStatus) ?? "unknown",
              blockerCount: numberValue(diagnosticSummary.blockerCount) ?? 0,
              changedFileCount: numberValue(diagnosticSummary.changedFileCount) ?? 0,
              openLoopCounts: asJsonObject(diagnosticSummary.openLoopCounts) ?? {},
              sourceCounts: asJsonObject(diagnosticSummary.sourceCounts) ?? {},
            },
          }
        : {}),
      ...(inventorySummary
        ? {
            inventory: {
              total: numberValue(inventorySummary.total) ?? 0,
              byKind: asJsonObject(inventorySummary.byKind) ?? {},
              staleCount: numberValue(inventorySummary.staleCount) ?? 0,
              truncated: booleanValue(inventorySummary.truncated) ?? false,
            },
          }
        : {}),
      ...(databaseObjectSummary
        ? {
            databaseObject: {
              schemaName: stringValue(databaseObjectSummary.schemaName) ?? "",
              objectName: stringValue(databaseObjectSummary.objectName) ?? "",
              factCount: numberValue(databaseObjectSummary.factCount) ?? 0,
              staleCount: numberValue(databaseObjectSummary.staleCount) ?? 0,
              columns: countSummary(databaseObjectSummary.columns),
              indexes: countSummary(databaseObjectSummary.indexes),
              foreignKeys: countSummary(databaseObjectSummary.foreignKeys),
              rlsPolicies: countSummary(databaseObjectSummary.rlsPolicies),
              triggers: countSummary(databaseObjectSummary.triggers),
              usages: countSummary(databaseObjectSummary.usages),
              truncated: booleanValue(databaseObjectSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(findingsSummary
        ? {
            findings: {
              total: numberValue(findingsSummary.total) ?? 0,
              bySeverity: asJsonObject(findingsSummary.bySeverity) ?? {},
              bySource: asJsonObject(findingsSummary.bySource) ?? {},
              staleCount: numberValue(findingsSummary.staleCount) ?? 0,
              truncated: booleanValue(findingsSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(literalMatchesSummary
        ? {
            literalMatches: {
              query: stringValue(literalMatchesSummary.query) ?? "",
              totalMatches: numberValue(literalMatchesSummary.totalMatches) ?? 0,
              fileCount: numberValue(literalMatchesSummary.fileCount) ?? 0,
              files: countSummary(literalMatchesSummary.files),
              truncated: booleanValue(literalMatchesSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(whereUsedSummary
        ? {
            whereUsed: {
              query: stringValue(whereUsedSummary.query) ?? "",
              targetKind: stringValue(whereUsedSummary.targetKind) ?? "",
              definitionCount: numberValue(whereUsedSummary.definitionCount) ?? 0,
              usageCount: numberValue(whereUsedSummary.usageCount) ?? 0,
              relatedFindingCount: numberValue(whereUsedSummary.relatedFindingCount) ?? 0,
              byUsageKind: asJsonObject(whereUsedSummary.byUsageKind) ?? {},
              truncated: booleanValue(whereUsedSummary.truncated) ?? false,
            },
          }
        : {}),
      decisionTrace: {
        entries: jsonArray(decisionTrace?.entries)
          .map(jsonRecord)
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .map((entry) => ({
            lane: stringValue(entry.lane) ?? "",
            status: stringValue(entry.status) ?? "",
            evidenceCount: numberValue(entry.evidenceCount) ?? 0,
            ...(stringValue(entry.fallback) ? { fallback: stringValue(entry.fallback) } : {}),
          })),
        lowConfidenceFallbacks: jsonValues(decisionTrace?.lowConfidenceFallbacks),
      },
      nextQueries: jsonValues(answer?.nextQueries),
      suggestedNextActions: jsonValues(answer?.suggestedNextActions),
    },
    queryPlan: {
      mode: stringValue(queryPlan?.mode) ?? "",
      intent: stringValue(queryPlan?.intent) ?? "",
      evidenceLanes: jsonValues(queryPlan?.evidenceLanes),
      engineSteps: jsonArray(queryPlan?.engineSteps)
        .map(jsonRecord)
        .filter((step): step is Record<string, unknown> => Boolean(step))
        .map((step) => ({
          name: stringValue(step.name) ?? "",
          status: stringValue(step.status) ?? "",
          returnedCount: numberValue(step.returnedCount) ?? 0,
        })),
    },
    freshness: (freshness as JsonObject | undefined) ?? {},
    evidence: {
      mode: stringValue(evidence?.mode) ?? "",
      sections: (jsonRecord(evidence?.sections) as JsonObject | undefined) ?? {},
    },
    limits: (limits as JsonObject | undefined) ?? {},
    warnings: jsonValues(value.warnings),
  };
  return summary;
}

function summarizeJsonObject(value: JsonObject): JsonObject {
  const reefAskSummary = compactReefAskSummary(value);
  if (reefAskSummary) return reefAskSummary;

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
