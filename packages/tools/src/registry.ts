import type { ToolInput, ToolOutput } from "@mako-ai/contracts";
import { ZodError } from "zod";
import { MakoToolError } from "./errors.js";
import {
  getToolDefinition,
  listToolDefinitions,
  registerToolDefinition,
  TOOL_DEFINITIONS,
  unregisterToolDefinition,
  type MakoToolDefinition,
} from "./tool-definitions.js";
import {
  classifyToolFailure,
  toErrorText,
  writeToolInvocationLogs,
} from "./tool-invocation-logging.js";
import { captureRuntimeUsefulnessForToolInvocation } from "./runtime-telemetry/capture.js";
import type { ToolServiceOptions } from "./runtime.js";
import { runAnswerPacket } from "./answers/index.js";

export {
  getToolDefinition,
  listToolDefinitions,
  registerToolDefinition,
  TOOL_DEFINITIONS,
  unregisterToolDefinition,
  type MakoToolDefinition,
};

export async function invokeTool(name: string, input: unknown, options: ToolServiceOptions = {}): Promise<ToolOutput> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const definition = getToolDefinition(name);
  if (!definition) {
    const error = new MakoToolError(404, "tool_not_found", `Unknown tool: ${name}`);
    await writeToolInvocationLogs({
      toolName: name,
      input,
      outcome: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      errorText: error.message,
      requestId: options.requestContext?.requestId,
      options,
    });
    throw error;
  }

  let output: unknown;
  let outcome: "success" | "failed" | "error" = "success";
  let errorText: string | undefined;

  try {
    const parsed = definition.inputSchema.parse(input) as ToolInput;
    output = await definition.execute(parsed, options);
    return output as ToolOutput;
  } catch (error) {
    if (error instanceof ZodError) {
      outcome = classifyToolFailure(error);
      const mappedError = MakoToolError.fromZodError(error);
      errorText = toErrorText(mappedError);
      throw mappedError;
    }

    outcome = classifyToolFailure(error);
    errorText = toErrorText(error);
    throw error;
  } finally {
    const finishedAt = new Date().toISOString();
    await writeToolInvocationLogs({
      toolName: name,
      input,
      output,
      outcome,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      errorText,
      requestId: options.requestContext?.requestId,
      options,
    });
    // Phase 8.1b: capture runtime usefulness signals for gradeable tools
    // (power-workflow + artifact). Uses the store cache when provided and
    // swallows any failure so telemetry never breaks the tool call.
    await captureRuntimeUsefulnessForToolInvocation({
      toolName: name,
      input,
      output,
      outcome,
      requestId: options.requestContext?.requestId,
      options,
    });
  }
}

export { runAnswerPacket };
