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

export class MakoToolError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: MakoToolErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message);
  }

  static fromZodError(error: ZodError): MakoToolError {
    return new MakoToolError(400, "invalid_tool_input", "Tool input validation failed.", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
}

export function isMakoToolError(error: unknown): error is MakoToolError {
  return error instanceof MakoToolError;
}
