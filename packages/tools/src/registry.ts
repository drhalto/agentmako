import type { ToolInput, ToolOutput } from "@mako-ai/contracts";
import { ZodError, type ZodTypeAny } from "zod";
import { MakoToolError } from "./errors.js";
import {
  getToolDefinition,
  listToolDefinitions,
  registerToolDefinition,
  TOOL_DEFINITIONS,
  unregisterToolDefinition,
  withToolHintsSchema,
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
import { attachToolHints } from "./hints/index.js";

export {
  getToolDefinition,
  listToolDefinitions,
  registerToolDefinition,
  TOOL_DEFINITIONS,
  unregisterToolDefinition,
  withToolHintsSchema,
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
    const rawOutput = await definition.execute(parsed, options);
    output = attachToolHints({
      toolName: definition.name,
      input: parsed,
      output: rawOutput,
      annotations: definition.annotations,
    });
    return output as ToolOutput;
  } catch (error) {
    if (error instanceof ZodError) {
      outcome = classifyToolFailure(error);
      const mappedError = MakoToolError.fromZodError(error, {
        toolName: definition.name,
        expectedKeys: expectedInputKeys(definition.inputSchema),
        receivedKeys: receivedInputKeys(input),
      });
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

function expectedInputKeys(schema: ZodTypeAny): string[] {
  return uniquePreservingOrder(collectObjectKeys(schema));
}

function collectObjectKeys(schema: ZodTypeAny): string[] {
  const typeName = schema._def.typeName as string;
  if (
    typeName === "ZodOptional"
    || typeName === "ZodNullable"
    || typeName === "ZodDefault"
    || typeName === "ZodCatch"
  ) {
    return collectObjectKeys(schema._def.innerType as ZodTypeAny);
  }
  if (typeName === "ZodEffects") {
    return collectObjectKeys(schema._def.schema as ZodTypeAny);
  }
  if (typeName === "ZodIntersection") {
    return [
      ...collectObjectKeys(schema._def.left as ZodTypeAny),
      ...collectObjectKeys(schema._def.right as ZodTypeAny),
    ];
  }
  if (typeName === "ZodUnion") {
    return (schema._def.options as ZodTypeAny[]).flatMap((option) => collectObjectKeys(option));
  }
  if (typeName === "ZodDiscriminatedUnion") {
    return [...schema._def.optionsMap.values()].flatMap((option) => collectObjectKeys(option as ZodTypeAny));
  }
  if (typeName !== "ZodObject") {
    return [];
  }

  const shapeFactory = schema._def.shape as (() => Record<string, ZodTypeAny>) | Record<string, ZodTypeAny>;
  const shape = typeof shapeFactory === "function" ? shapeFactory() : shapeFactory;
  return Object.keys(shape);
}

function receivedInputKeys(input: unknown): string[] {
  const objectValue = parseJsonObjectLike(input);
  return objectValue && typeof objectValue === "object" && !Array.isArray(objectValue)
    ? Object.keys(objectValue)
    : [];
}

function uniquePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseToolInput(definition: MakoToolDefinition<string>, input: unknown): ToolInput {
  try {
    return definition.inputSchema.parse(input) as ToolInput;
  } catch (error) {
    if (!(error instanceof ZodError)) {
      throw error;
    }

    const coerced = coerceDeferredInput(definition.inputSchema, input);
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

export function coerceDeferredInput(schema: ZodTypeAny, value: unknown): unknown {
  const typeName = schema._def.typeName as string;
  if (
    typeName === "ZodOptional"
    || typeName === "ZodNullable"
    || typeName === "ZodDefault"
    || typeName === "ZodCatch"
  ) {
    return coerceDeferredInput(schema._def.innerType as ZodTypeAny, value);
  }
  if (typeName === "ZodEffects") {
    return coerceDeferredInput(schema._def.schema as ZodTypeAny, value);
  }
  if (typeName === "ZodIntersection") {
    const leftCoerced = coerceDeferredInput(schema._def.left as ZodTypeAny, value);
    return coerceDeferredInput(schema._def.right as ZodTypeAny, leftCoerced);
  }
  if (typeName === "ZodDiscriminatedUnion") {
    const objectValue = parseJsonObjectLike(value);
    if (!objectValue || Array.isArray(objectValue)) {
      return value;
    }
    const discriminator = schema._def.discriminator as string;
    const discriminatorValue = (objectValue as Record<string, unknown>)[discriminator];
    const option = schema._def.optionsMap.get(discriminatorValue) as ZodTypeAny | undefined;
    return option ? coerceDeferredInput(option, objectValue) : value;
  }
  if (typeName === "ZodUnion") {
    for (const option of schema._def.options as ZodTypeAny[]) {
      const coerced = coerceDeferredInput(option, value);
      if (option.safeParse(coerced).success) {
        return coerced;
      }
    }
    return value;
  }
  if (typeName === "ZodObject") {
    const objectValue = parseJsonObjectLike(value);
    if (!objectValue || Array.isArray(objectValue)) {
      return value;
    }
    const shape = schema._def.shape() as Record<string, ZodTypeAny>;
    let changed = objectValue !== value;
    const out: Record<string, unknown> = { ...objectValue };
    for (const [key, entrySchema] of Object.entries(shape)) {
      if (!(key in out)) continue;
      const coerced = coerceDeferredInput(entrySchema, out[key]);
      if (coerced !== out[key]) {
        out[key] = coerced;
        changed = true;
      }
    }
    return changed ? out : value;
  }
  if (typeName === "ZodArray") {
    const arrayValue = parseJsonArrayLike(value);
    if (!Array.isArray(arrayValue)) {
      return value;
    }
    const elementSchema = schema._def.type as ZodTypeAny;
    let changed = arrayValue !== value;
    const out = arrayValue.map((entry) => {
      const coerced = coerceDeferredInput(elementSchema, entry);
      if (coerced !== entry) changed = true;
      return coerced;
    });
    return changed ? out : value;
  }
  if (typeName === "ZodRecord") {
    const objectValue = parseJsonObjectLike(value);
    return objectValue && !Array.isArray(objectValue) ? objectValue : value;
  }
  if (typeName === "ZodNumber" && typeof value === "string") {
    const trimmed = value.trim();
    return /^[+-]?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : value;
  }
  if (typeName === "ZodBoolean" && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  return value;
}

function parseJsonObjectLike(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function parseJsonArrayLike(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}
