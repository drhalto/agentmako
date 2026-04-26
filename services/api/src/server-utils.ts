import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, type MakoConfig } from "@mako-ai/config";
import type {
  AnswerPacket,
  ApiErrorCode,
  ApiErrorResponse,
  ApiHealthData,
  ApiSuccessResponse,
  JsonObject,
  QueryKind,
  ReasoningTier,
  SupportLevel,
} from "@mako-ai/contracts";

const QUERY_KINDS: readonly QueryKind[] = ["route_trace", "schema_usage", "auth_path", "file_health", "free_form"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type JsonErrorBody = ApiErrorResponse;
type JsonSuccessBody<T> = ApiSuccessResponse<T>;

export class ApiRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message);
  }
}

export interface RequestContext {
  requestId: string;
  method: string;
  pathname: string;
  startedAt: number;
}

export type NextFunction = (error?: unknown) => void;

export interface Request {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body?: unknown;
  params: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}

export interface Response {
  locals: { requestContext?: RequestContext; [key: string]: unknown };
  statusCode: number;
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
  end(body?: unknown): void;
  on(event: string, listener: () => void): void;
}

export type RouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => void | Promise<void>;

export type ErrorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
) => void | Promise<void>;

export interface HttpApp {
  use(handler: RouteHandler | ErrorHandler): void;
  get(path: string, handler: RouteHandler): void;
  post(path: string, handler: RouteHandler): void;
  all(path: string, handler: RouteHandler): void;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function getConfig(options: { configOverrides?: Partial<MakoConfig> }): MakoConfig {
  return loadConfig(options.configOverrides);
}

export function getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function setJsonHeaders(response: { setHeader(name: string, value: string): void }): void {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,x-request-id");
  response.setHeader("cache-control", "no-store");
}

function writeJson<T>(
  response: {
    status(code: number): { json(body: JsonSuccessBody<T> | JsonErrorBody): void };
    setHeader(name: string, value: string): void;
  },
  requestId: string,
  statusCode: number,
  body: JsonSuccessBody<T> | JsonErrorBody,
): void {
  setJsonHeaders(response);
  response.setHeader("x-request-id", requestId);
  response.status(statusCode).json(body);
}

export function writeSuccess<T>(
  response: {
    status(code: number): { json(body: JsonSuccessBody<T> | JsonErrorBody): void };
    setHeader(name: string, value: string): void;
  },
  requestId: string,
  statusCode: number,
  data: T,
): void {
  writeJson(response, requestId, statusCode, { ok: true, requestId, data });
}

export function writeError(
  response: {
    status(code: number): { json(body: JsonSuccessBody<unknown> | JsonErrorBody): void };
    setHeader(name: string, value: string): void;
  },
  requestId: string,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: JsonObject,
): void {
  writeJson(response, requestId, statusCode, {
    ok: false,
    requestId,
    error: {
      code,
      message,
      details,
    },
  });
}

export function getRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiRequestError(400, "invalid_request", `Missing or invalid \`${fieldName}\`.`);
  }

  return value.trim();
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function getObjectBody(value: unknown): Record<string, unknown> {
  if (value == null || value === "") {
    return {};
  }

  if (Array.isArray(value) || typeof value !== "object") {
    throw new ApiRequestError(400, "invalid_request", "Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

export function getOptionalJsonObject(value: unknown): JsonObject | undefined {
  return value != null && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonObject)
    : undefined;
}

export function getOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiRequestError(400, "invalid_request", `Invalid \`${fieldName}\`; expected an array of strings.`);
  }

  return value;
}

export function getQueryKind(value: unknown): QueryKind {
  const queryKind = getRequiredString(value, "queryKind");
  if (!QUERY_KINDS.includes(queryKind as QueryKind)) {
    throw new ApiRequestError(400, "invalid_request", `Unknown query kind: ${queryKind}`);
  }

  return queryKind as QueryKind;
}

export function getOptionalReasoningTier(value: unknown): ReasoningTier | undefined {
  const tier = getOptionalString(value);
  if (tier == null) {
    return undefined;
  }

  if (!["fast", "standard", "deep"].includes(tier)) {
    throw new ApiRequestError(400, "invalid_request", `Unknown reasoning tier: ${tier}`);
  }

  return tier as ReasoningTier;
}

export function getOptionalSupportLevel(value: unknown): SupportLevel | undefined {
  const supportLevel = getOptionalString(value);
  if (supportLevel == null) {
    return undefined;
  }

  if (!["native", "adapted", "best_effort"].includes(supportLevel)) {
    throw new ApiRequestError(400, "invalid_request", `Unknown support level: ${supportLevel}`);
  }

  return supportLevel as SupportLevel;
}

export function getOptionalEvidenceStatus(value: unknown): AnswerPacket["evidenceStatus"] | undefined {
  const evidenceStatus = getOptionalString(value);
  if (evidenceStatus == null) {
    return undefined;
  }

  if (!["complete", "partial"].includes(evidenceStatus)) {
    throw new ApiRequestError(400, "invalid_request", `Unknown evidence status: ${evidenceStatus}`);
  }

  return evidenceStatus as AnswerPacket["evidenceStatus"];
}

export function getOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ApiRequestError(400, "invalid_request", `Invalid \`${fieldName}\`; expected a number.`);
  }

  return value;
}

export function getRequestContext(response: { locals: { requestContext?: RequestContext } }): RequestContext {
  return response.locals.requestContext ?? {
    requestId: randomUUID(),
    method: "UNKNOWN",
    pathname: "unknown",
    startedAt: Date.now(),
  };
}

export function isAllowedMcpOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function rootUriToPath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") {
      return null;
    }

    return fileURLToPath(parsed);
  } catch {
    return null;
  }
}

export type { ApiHealthData };
