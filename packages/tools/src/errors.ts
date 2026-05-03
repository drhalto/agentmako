import type { JsonObject } from "@mako-ai/contracts";
import { ZodError } from "zod";

export type MakoToolResolutionErrorCode =
  | "ambiguous_feature"
  | "ambiguous_file"
  | "ambiguous_object"
  | "ambiguous_route"
  | "feature_not_found"
  | "file_not_found"
  | "object_not_found"
  | "route_not_found";

export type MakoDatabaseToolErrorCode =
  | "db_binding_invalid"
  | "db_binding_not_configured"
  | "db_not_connected"
  | "db_permission_denied"
  | "db_object_not_found"
  | "db_ambiguous_object"
  | "db_unsupported_target"
  | "db_query_failed";

export type MakoToolErrorCode =
  | "invalid_tool_input"
  | "project_not_attached"
  | "project_not_found"
  | "missing_project_context"
  | "trust_run_not_found"
  | "trust_target_not_found"
  | "rerun_not_supported"
  | "tool_not_found"
  | MakoToolResolutionErrorCode
  | MakoDatabaseToolErrorCode;

export interface MakoToolInputValidationContext {
  toolName?: string;
  expectedKeys?: readonly string[];
  receivedKeys?: readonly string[];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function formatKeys(keys: readonly string[], limit = 16): string {
  const visible = keys.slice(0, limit).map((key) => `"${key}"`);
  const remaining = keys.length - visible.length;
  return remaining > 0 ? `${visible.join(", ")}, +${remaining} more` : visible.join(", ");
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function suggestionScore(receivedKey: string, expectedKey: string): number | undefined {
  const received = normalizeKey(receivedKey);
  const expected = normalizeKey(expectedKey);
  if (!received || !expected) return undefined;
  if (received === expected) return 0;
  if (received === "path" && expected === "filepath") return 0.05;
  if (received === "query" && expected === "term") return 0.05;
  if (received.endsWith("name") && received.slice(0, -4) === expected) return 0.1;
  if (expected.endsWith(received) || received.startsWith(expected)) return 0.15;
  if ((received.length >= 3 && expected.includes(received)) || (expected.length >= 3 && received.includes(expected))) {
    return 0.2;
  }

  const distance = levenshteinDistance(received, expected);
  const maxLength = Math.max(received.length, expected.length);
  const ratio = distance / maxLength;
  return distance <= Math.max(2, Math.floor(maxLength * 0.45)) ? 0.5 + ratio : undefined;
}

function suggestExpectedKey(receivedKey: string, expectedKeys: readonly string[]): string | undefined {
  let best: { key: string; score: number } | undefined;
  for (const expectedKey of expectedKeys) {
    const score = suggestionScore(receivedKey, expectedKey);
    if (score == null) continue;
    if (!best || score < best.score) {
      best = { key: expectedKey, score };
    }
  }
  return best?.key;
}

function unrecognizedIssueKeys(error: ZodError): string[] {
  const keys: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      keys.push(...issue.keys);
    }
  }
  return uniqueStrings(keys);
}

function formatValidationMessage(args: {
  context: MakoToolInputValidationContext;
  unexpectedKeys: readonly string[];
  suggestions: readonly JsonObject[];
}): string {
  const parts = ["Tool input validation failed."];
  if (args.context.toolName) {
    parts.push(`Tool: ${args.context.toolName}.`);
  }
  if (args.unexpectedKeys.length > 0) {
    const rendered = args.suggestions.map((entry) => {
      const received = typeof entry.received === "string" ? entry.received : "";
      const expected = typeof entry.expected === "string" ? entry.expected : undefined;
      return expected ? `"${received}" (did you mean "${expected}"?)` : `"${received}"`;
    });
    parts.push(`Unexpected input key${args.unexpectedKeys.length === 1 ? "" : "s"}: ${rendered.join(", ")}.`);
  }
  if ((args.context.expectedKeys?.length ?? 0) > 0) {
    parts.push(`Expected top-level fields: ${formatKeys(args.context.expectedKeys ?? [])}.`);
  }
  return parts.join(" ");
}

export class MakoToolError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: MakoToolErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message);
  }

  static fromZodError(error: ZodError, context: MakoToolInputValidationContext = {}): MakoToolError {
    const expectedKeys = uniqueStrings(context.expectedKeys ?? []);
    const receivedKeys = uniqueStrings(context.receivedKeys ?? []);
    const unknownReceivedKeys = receivedKeys.filter((key) => !expectedKeys.includes(key));
    const unexpectedKeys = uniqueStrings([...unrecognizedIssueKeys(error), ...unknownReceivedKeys]);
    const suggestions = unexpectedKeys.map((key): JsonObject => {
      const expected = suggestExpectedKey(key, expectedKeys);
      return expected ? { received: key, expected } : { received: key };
    });
    const validationContext: MakoToolInputValidationContext = {
      ...context,
      expectedKeys,
      receivedKeys,
    };

    const details: JsonObject = {
      issues: error.issues.map((issue): JsonObject => {
        const entry: JsonObject = {
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        };
        if (issue.code === "unrecognized_keys") {
          entry.keys = issue.keys;
        }
        return entry;
      }),
    };
    if (expectedKeys.length > 0) details.expectedKeys = expectedKeys;
    if (receivedKeys.length > 0) details.receivedKeys = receivedKeys;
    if (unexpectedKeys.length > 0) details.unexpectedKeys = unexpectedKeys;
    if (suggestions.length > 0) details.suggestions = suggestions;

    return new MakoToolError(
      400,
      "invalid_tool_input",
      formatValidationMessage({ context: validationContext, unexpectedKeys, suggestions }),
      details,
    );
  }
}

export function isMakoToolError(error: unknown): error is MakoToolError {
  return error instanceof MakoToolError;
}
