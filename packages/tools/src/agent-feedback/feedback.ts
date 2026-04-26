import { randomUUID } from "node:crypto";
import type {
  AgentFeedbackToolInput,
  AgentFeedbackToolOutput,
  RuntimeUsefulnessEvent,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type { UsefulnessEventRecord } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { createRuntimeTelemetryEmitter } from "../runtime-telemetry/emit.js";

const feedbackLogger = createLogger("mako-tools", { component: "agent_feedback" });

export async function agentFeedbackTool(
  input: AgentFeedbackToolInput,
  options: ToolServiceOptions = {},
): Promise<AgentFeedbackToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const capturedAt = new Date().toISOString();
    const event: RuntimeUsefulnessEvent = {
      eventId: randomUUID(),
      projectId: project.projectId,
      requestId: input.referencedRequestId,
      capturedAt,
      decisionKind: "agent_feedback",
      family: input.referencedToolName,
      toolName: "agent_feedback",
      grade: input.grade,
      reasonCodes: input.reasonCodes,
      reason: input.reason,
    };

    const writeState: { written?: UsefulnessEventRecord } = {};
    let writeError: unknown;
    const emit = createRuntimeTelemetryEmitter({
      insert: (eventInput) => {
        writeState.written = projectStore.insertUsefulnessEvent(eventInput);
        return writeState.written;
      },
      logger: (message, error) => {
        writeError = error;
        feedbackLogger.warn(message, {
          referencedToolName: input.referencedToolName,
          referencedRequestId: input.referencedRequestId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    emit(event);
    const persisted = writeState.written;
    if (!persisted) {
      if (writeError instanceof Error) {
        throw writeError;
      }
      throw new Error("agent_feedback failed to persist RuntimeUsefulnessEvent");
    }

    return {
      toolName: "agent_feedback",
      projectId: project.projectId,
      eventId: persisted.eventId,
      capturedAt: persisted.capturedAt,
    };
  });
}
