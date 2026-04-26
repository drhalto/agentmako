export type ProjectCommandErrorCode =
  | "db_binding_invalid"
  | "db_binding_not_configured"
  | "db_connection_test_failed"
  | "db_refresh_failed"
  | "detach_target_ambiguous"
  | "not_a_project_path"
  | "project_manifest_invalid"
  | "project_not_attached"
  | "purge_failed"
  | "snapshot_build_failed";

export class ProjectCommandError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ProjectCommandErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function isProjectCommandError(error: unknown): error is ProjectCommandError {
  return error instanceof ProjectCommandError;
}
