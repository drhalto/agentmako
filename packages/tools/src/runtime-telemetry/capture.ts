import { randomUUID } from "node:crypto";
import { loadConfig } from "@mako-ai/config";
import type { AnswerResult, ToolOutput } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { openProjectStore, type ProjectStore } from "@mako-ai/store";
import {
  evaluateArtifactUsefulness,
  evaluateArtifactWrapperUsefulness,
  extractArtifactFromToolOutput,
  isArtifactToolName,
} from "../artifact-evaluation.js";
import { evaluateWorkflowPacketUsefulness } from "../workflow-packets/usefulness.js";
import {
  evaluatePowerWorkflowUsefulness,
  isPowerWorkflowToolName,
} from "../workflow-evaluation.js";
import { resolveToolProjectForLogging } from "../tool-invocation-logging.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  createRuntimeTelemetryEmitter,
  type RuntimeTelemetryEmitter,
} from "./emit.js";

/**
 * Phase 8.1b: runtime usefulness capture at decision sites.
 *
 * Two entry points:
 *
 * 1. {@link captureRuntimeUsefulnessForToolInvocation} runs in the
 *    `invokeTool` finally hook. Emits `power_workflow_usefulness`,
 *    `artifact_usefulness`, and `wrapper_usefulness` rows as applicable.
 *    Borrows the project-store cache when present; otherwise opens and
 *    closes its own project store.
 *
 * 2. {@link captureRuntimePacketUsefulnessForAnswerResult} runs from
 *    `enrich-answer-result.ts` after the companion packet is resolved.
 *    Emits `packet_usefulness` rows using the shipped
 *    `evaluateWorkflowPacketUsefulness` grader.
 *
 * Both entry points swallow every failure — runtime telemetry must never
 * fail the user-facing answer or tool call.
 */

const telemetryLogger = createLogger("mako-tools", {
  component: "runtime-telemetry",
});

export async function captureRuntimeUsefulnessForToolInvocation(args: {
  toolName: string;
  input: unknown;
  output: unknown;
  outcome: "success" | "failed" | "error";
  requestId?: string;
  options: ToolServiceOptions;
}): Promise<void> {
  // Fast-exit: no gradeable surface touches this tool.
  if (!isPowerWorkflowToolName(args.toolName) && !isArtifactToolName(args.toolName)) {
    return;
  }

  try {
    const config = loadConfig(args.options.configOverrides);
    const project = await resolveToolProjectForLogging(args.input, args.options);
    if (!project) {
      return;
    }

    const storeOptions = {
      projectRoot: project.canonicalPath,
      stateDirName: config.stateDirName,
      projectDbFilename: config.projectDbFilename,
    };

    // Pooled path: reuse the MCP server's store cache (Phase 2). The
    // cache owns lifecycle — we do NOT close the borrowed handle.
    const cache = args.options.projectStoreCache;
    const projectStore = cache ? cache.borrow(storeOptions) : openProjectStore(storeOptions);

    try {
      const emit = buildLoggingEmitter(projectStore, args.toolName);
      const requestId = args.requestId ?? `req_${randomUUID()}`;
      const capturedAt = new Date().toISOString();
      const projectId = project.projectId;

      emitPowerWorkflowUsefulness(emit, {
        toolName: args.toolName,
        output: args.output,
        outcome: args.outcome,
        projectId,
        requestId,
        capturedAt,
      });

      emitArtifactAndWrapperUsefulness(emit, {
        toolName: args.toolName,
        output: args.output,
        outcome: args.outcome,
        projectId,
        requestId,
        capturedAt,
      });
    } finally {
      if (!cache) {
        projectStore.close();
      }
    }
  } catch (error) {
    telemetryLogger.warn("runtime-telemetry.capture-failed", {
      toolName: args.toolName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function captureRuntimePacketUsefulnessForAnswerResult(args: {
  answerResult: AnswerResult;
  projectStore: ProjectStore;
  requestId: string;
  observedFollowupCount?: number;
}): void {
  try {
    const evaluation = evaluateWorkflowPacketUsefulness(args.answerResult, {
      observedFollowupCount: args.observedFollowupCount ?? 0,
    });

    // Skip the truly boring case — no attachment was expected and none was
    // made. Every other state (unexpected attachment, missing expected
    // attachment, or a real grade) carries a signal worth recording.
    if (!evaluation.eligible && !evaluation.attached) {
      return;
    }

    const emit = buildLoggingEmitter(args.projectStore, "packet_usefulness");
    emit({
      eventId: randomUUID(),
      projectId: args.answerResult.projectId,
      requestId: args.requestId,
      traceId: args.answerResult.queryId,
      capturedAt: new Date().toISOString(),
      decisionKind: "packet_usefulness",
      family: evaluation.family ?? "unknown",
      grade: evaluation.grade,
      reasonCodes: evaluation.reasonCodes,
      observedFollowupLinked: evaluation.observedFollowupCount > 0,
    });
  } catch (error) {
    telemetryLogger.warn("runtime-telemetry.packet-capture-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ===== Internal helpers =====

function buildLoggingEmitter(
  projectStore: ProjectStore,
  toolName: string,
): RuntimeTelemetryEmitter {
  return createRuntimeTelemetryEmitter({
    insert: (input) => projectStore.insertUsefulnessEvent(input),
    logger: (msg, err) =>
      telemetryLogger.warn(msg, {
        toolName,
        error: err instanceof Error ? err.message : String(err),
      }),
  });
}

interface EmitContext {
  toolName: string;
  output: unknown;
  outcome: "success" | "failed" | "error";
  projectId: string;
  requestId: string;
  capturedAt: string;
}

function emitPowerWorkflowUsefulness(
  emit: RuntimeTelemetryEmitter,
  ctx: EmitContext,
): void {
  if (ctx.outcome !== "success" || !ctx.output) return;
  if (!isPowerWorkflowToolName(ctx.toolName)) return;

  const pw = evaluatePowerWorkflowUsefulness(ctx.output as ToolOutput);
  if (!pw || !pw.eligible) return;

  emit({
    eventId: randomUUID(),
    projectId: ctx.projectId,
    requestId: ctx.requestId,
    capturedAt: ctx.capturedAt,
    decisionKind: "power_workflow_usefulness",
    family: pw.family,
    toolName: ctx.toolName,
    grade: pw.grade,
    reasonCodes: pw.reasonCodes,
    observedFollowupLinked: pw.observedFollowupCount > 0,
  });
}

function emitArtifactAndWrapperUsefulness(
  emit: RuntimeTelemetryEmitter,
  ctx: EmitContext,
): void {
  if (!isArtifactToolName(ctx.toolName)) return;

  // Failed artifact tool call — emit wrapper failure only; no artifact
  // to grade.
  if (ctx.outcome !== "success" || !ctx.output) {
    emit({
      eventId: randomUUID(),
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      capturedAt: ctx.capturedAt,
      decisionKind: "wrapper_usefulness",
      family: "tool_plane",
      toolName: ctx.toolName,
      grade: "no",
      reasonCodes: ["tool_call_failed"],
      reason: "Artifact tool call failed before producing a result.",
    });
    return;
  }

  const output = ctx.output as ToolOutput;
  const artifact = extractArtifactFromToolOutput(output);
  if (!artifact) return; // defensive; invokeTool already validated output schema

  // Artifact-level grade.
  const au = evaluateArtifactUsefulness(artifact);
  emit({
    eventId: randomUUID(),
    projectId: ctx.projectId,
    requestId: ctx.requestId,
    capturedAt: ctx.capturedAt,
    decisionKind: "artifact_usefulness",
    family: artifact.kind,
    toolName: ctx.toolName,
    grade: au.grade,
    reasonCodes: au.reasonCodes,
    observedFollowupLinked: au.observedFollowupCount > 0,
    reason: au.reason,
  });

  // tool_plane wrapper grade — every successful artifact tool call exercises
  // the tool plane.
  const toolPlane = evaluateArtifactWrapperUsefulness({
    family: "tool_plane",
    artifactKind: artifact.kind,
    toolCallDelivered: true,
    toolCallFailed: false,
    schemaValid: true,
    basisComplete: artifact.basis.length > 0,
  });
  emit({
    eventId: randomUUID(),
    projectId: ctx.projectId,
    requestId: ctx.requestId,
    capturedAt: ctx.capturedAt,
    decisionKind: "wrapper_usefulness",
    family: "tool_plane",
    toolName: ctx.toolName,
    grade: toolPlane.grade,
    reasonCodes: toolPlane.reasonCodes,
    reason: toolPlane.reason,
  });

  // file_export wrapper grade — only emitted when the caller actually
  // requested export (the output carries an `exported` block).
  const exportBlock = (output as { exported?: { files?: unknown[] } }).exported;
  if (exportBlock) {
    const exportedCount = Array.isArray(exportBlock.files)
      ? exportBlock.files.length
      : 0;
    const fileExport = evaluateArtifactWrapperUsefulness({
      family: "file_export",
      artifactKind: artifact.kind,
      exportRequested: true,
      exportedFileCount: exportedCount,
    });
    emit({
      eventId: randomUUID(),
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      capturedAt: ctx.capturedAt,
      decisionKind: "wrapper_usefulness",
      family: "file_export",
      toolName: ctx.toolName,
      grade: fileExport.grade,
      reasonCodes: fileExport.reasonCodes,
      reason: fileExport.reason,
    });
  }
}
