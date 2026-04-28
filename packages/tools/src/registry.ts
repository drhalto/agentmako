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
    const parsed = parseToolInput(definition, input);
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

function parseToolInput(definition: MakoToolDefinition<string>, input: unknown): ToolInput {
  try {
    return definition.inputSchema.parse(input) as ToolInput;
  } catch (error) {
    if (!(error instanceof ZodError)) {
      throw error;
    }

    const coerced = coerceDeferredScalars(input);
    if (coerced !== input) {
      try {
        return definition.inputSchema.parse(coerced) as ToolInput;
      } catch {
        // Preserve the original Zod error so callers see the actual schema
        // path from the payload they sent.
      }
    }
    throw error;
  }
}

const NUMERIC_DEFERRED_KEYS = new Set([
  "budget",
  "cacheStalenessMs",
  "factsLimit",
  "limit",
  "maxFindings",
  "maxPerSection",
  "maxSteps",
  "traversalDepth",
]);

const BOOLEAN_DEFERRED_KEYS = new Set([
  "acknowledgeAdvisory",
  "continueOnError",
  "freshen",
  "includeAcknowledged",
  "includeAppUsage",
  "includeEqual",
  "includeFacts",
  "includeFindings",
  "includeFullResults",
  "includeHeuristicEdges",
  "includeRawEvidence",
]);

function coerceDeferredScalars(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((entry) => {
      const coerced = coerceDeferredScalars(entry);
      if (coerced !== entry) changed = true;
      return coerced;
    });
    return changed ? out : value;
  }

  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const coerced = coerceDeferredScalars(entryValue, entryKey);
      out[entryKey] = coerced;
      if (coerced !== entryValue) changed = true;
    }
    return changed ? out : value;
  }

  if (typeof value !== "string" || !key) {
    return value;
  }

  const trimmed = value.trim();
  if (NUMERIC_DEFERRED_KEYS.has(key) && /^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (BOOLEAN_DEFERRED_KEYS.has(key)) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  return value;
}
