import type { AnswerPacket, AnswerResult, QueryKind } from "./answer.js";
import type { JsonObject, ReasoningTier, SupportLevel } from "./common.js";
import type { AttachedProject } from "./project.js";

export type ApiErrorCode =
  | "ambiguous_feature"
  | "ambiguous_file"
  | "ambiguous_object"
  | "ambiguous_route"
  | "db_ambiguous_object"
  | "db_binding_invalid"
  | "db_binding_not_configured"
  | "db_connection_test_failed"
  | "db_not_connected"
  | "db_object_not_found"
  | "db_permission_denied"
  | "db_query_failed"
  | "db_refresh_failed"
  | "db_unsupported_target"
  | "detach_target_ambiguous"
  | "feature_not_found"
  | "file_not_found"
  | "internal_error"
  | "invalid_json"
  | "invalid_request"
  | "invalid_tool_input"
  | "method_not_allowed"
  | "missing_project_context"
  | "not_a_project_path"
  | "object_not_found"
  | "not_found"
  | "project_not_attached"
  | "project_manifest_invalid"
  | "project_not_found"
  | "purge_failed"
  | "query_restart_exhausted"
  | "request_failed"
  | "request_too_large"
  | "route_not_found"
  | "snapshot_build_failed"
  | "stale_base_revision"
  | "tool_not_found";

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: JsonObject;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  requestId: string;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: ApiErrorPayload;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ApiHealthData {
  status: "ok";
  appName: string;
  supportTarget: string;
  enabledExtensions: Record<string, boolean>;
  routes?: Record<string, { method: string; path: string }>;
}

export interface AttachProjectRequest {
  projectRoot: string;
}

export interface IndexProjectRequest {
  projectRoot: string;
}

export interface DetachProjectRequest {
  projectRef?: string;
  purge?: boolean;
}

export interface AskAnswerRequest {
  projectId?: string;
  projectRef?: string;
  queryId?: string;
  queryKind: QueryKind;
  queryText: string;
  tierUsed?: ReasoningTier;
  supportLevel?: SupportLevel;
  evidenceStatus?: AnswerPacket["evidenceStatus"];
  evidenceConfidence?: number;
  missingInformation?: string[];
  stalenessFlags?: string[];
  evidence?: AnswerPacket["evidence"];
  generatedAt?: string;
}

export interface ProjectListData extends Array<AttachedProject> {}

export interface AskAnswerData extends AnswerResult {}
