import type { JsonObject, JsonValue } from "@mako-ai/contracts";
import { MakoToolError } from "./errors.js";

export function createAmbiguityError(
  code: MakoToolError["code"],
  input: string,
  candidates: JsonValue[],
): MakoToolError {
  return new MakoToolError(400, code, `Ambiguous identifier: ${input}`, {
    input,
    candidates,
  });
}

export function createNotFoundError(
  code: MakoToolError["code"],
  input: string,
  suggestions?: string[],
): MakoToolError {
  const trimmed = (suggestions ?? []).filter(Boolean).slice(0, 5);
  const suffix = trimmed.length > 0
    ? ` — closest indexed matches: ${trimmed.join(", ")}`
    : "";
  return new MakoToolError(404, code, `No indexed match found for: ${input}${suffix}`, {
    input,
    ...(trimmed.length > 0 ? { suggestions: trimmed } : {}),
  });
}

export function createProjectNotAttachedError(message: string, details: JsonObject): MakoToolError {
  return new MakoToolError(404, "project_not_attached", message, details);
}

export function createMissingProjectContextError(message: string, details?: JsonObject): MakoToolError {
  return new MakoToolError(400, "missing_project_context", message, details);
}
