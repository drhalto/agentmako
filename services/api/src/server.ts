#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { ApiErrorCode, ApiHealthData, JsonObject } from "@mako-ai/contracts";
import { isProjectCommandError } from "@mako-ai/indexer";
import { createLogger, runWithContext } from "@mako-ai/logger";
import { isMakoToolError } from "@mako-ai/tools";
import { createMcpRouteHandler, type McpSession } from "./mcp.js";
import { API_ROUTE_DEFINITIONS } from "./routes.js";
import { createAnswerRouteHandlers } from "./routes/answers.js";
import { createProjectRouteHandlers } from "./routes/projects.js";
import { createToolRouteHandlers } from "./routes/tools.js";
import { createWorkflowPacketRouteHandlers } from "./routes/workflow-packets.js";
import { createApiService, type ApiServiceOptions } from "./service.js";
import {
  ApiRequestError,
  getConfig,
  getRequestContext,
  isLoopbackHost,
  setJsonHeaders,
  type HttpApp,
  type NextFunction,
  type Request,
  type RequestContext,
  type Response,
  writeError,
  writeSuccess,
} from "./server-utils.js";

const apiLogger = createLogger("mako-api");
const DEFAULT_BODY_LIMIT_BYTES = 1_000_000;

export interface HttpServerOptions extends ApiServiceOptions {
  host?: string;
  port?: number;
  bodyLimitBytes?: number;
  dashboardControls?: {
    restartHarness?: () => Promise<void>;
  };
}

export interface StartedHttpServer {
  host: string;
  port: number;
  close(): Promise<void>;
  server: Server;
}

function logRequest(
  context: RequestContext,
  statusCode: number,
  outcome: "ok" | "error",
  details: { errorCode?: ApiErrorCode } = {},
): void {
  const fields = {
    requestId: context.requestId,
    method: context.method,
    path: context.pathname,
    statusCode,
    durationMs: Date.now() - context.startedAt,
    ...details,
  };
  if (outcome === "ok") {
    apiLogger.info("request.complete", fields);
  } else {
    apiLogger.warn("request.complete", fields);
  }
}

function isKnownPath(pathname: string): boolean {
  if (pathname === API_ROUTE_DEFINITIONS.toolsList.path || pathname === API_ROUTE_DEFINITIONS.mcp.path) {
    return true;
  }

  if (/^\/api\/v1\/tools\/[^/]+$/.test(pathname)) {
    return true;
  }

  if (/^\/api\/v1\/projects\/[^/]+\/favicon$/.test(pathname)) {
    return true;
  }

  return Object.values(API_ROUTE_DEFINITIONS)
    .filter((route) => !route.path.includes(":"))
    .some((route) => route.path === pathname);
}

function createHttpApiApp(options: HttpServerOptions = {}) {
  const config = getConfig(options);
  const host = options.host ?? config.apiHost;
  if (!isLoopbackHost(host)) {
    throw new Error(`mako-ai only supports loopback hosts for the local server. Received: ${host}`);
  }

  const api = createApiService(options);
  const app = createMcpExpressApp({ host }) as unknown as HttpApp;
  const mcpSessions = new Map<string, McpSession>();

  const closeMcpSessions = async (): Promise<void> => {
    await Promise.all(
      [...mcpSessions.values()].map(async ({ server, transport }) => {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }),
    );
    mcpSessions.clear();
  };

  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestContext: RequestContext = {
      requestId: randomUUID(),
      method: request.method,
      pathname: request.path,
      startedAt: Date.now(),
    };

    response.locals.requestContext = requestContext;
    response.setHeader("x-request-id", requestContext.requestId);

    if (request.path !== API_ROUTE_DEFINITIONS.mcp.path) {
      setJsonHeaders(response);
    }

    response.on("finish", () => {
      const statusCode = response.statusCode;
      logRequest(requestContext, statusCode, statusCode >= 400 ? "error" : "ok");
    });

    runWithContext({ requestId: requestContext.requestId }, () => {
      next();
    });
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method === "OPTIONS" && request.path !== API_ROUTE_DEFINITIONS.mcp.path) {
      response.status(204).end();
      return;
    }

    next();
  });

  app.get(API_ROUTE_DEFINITIONS.health.path, (_request: Request, response: Response) => {
    const context = getRequestContext(response);
    writeSuccess<ApiHealthData>(response, context.requestId, 200, {
      ...api.health(),
      routes: API_ROUTE_DEFINITIONS,
    });
  });
  app.all(API_ROUTE_DEFINITIONS.health.path, (request: Request, _response: Response, next: NextFunction) => {
    next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
  });

  app.post(API_ROUTE_DEFINITIONS.dashboardRestartHarness.path, async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const restartHarness = options.dashboardControls?.restartHarness;
      if (!restartHarness) {
        throw new ApiRequestError(
          501,
          "request_failed",
          "Harness restart is only available when the dashboard launcher owns the harness process.",
        );
      }
      await restartHarness();
      const context = getRequestContext(response);
      writeSuccess(response, context.requestId, 200, { restarted: true });
    } catch (error) {
      next(error);
    }
  });
  app.all(API_ROUTE_DEFINITIONS.dashboardRestartHarness.path, (request: Request, _response: Response, next: NextFunction) => {
    next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
  });

  const projectHandlers = createProjectRouteHandlers(api, config);
  app.get(API_ROUTE_DEFINITIONS.projectsList.path, projectHandlers.list);
  app.all(API_ROUTE_DEFINITIONS.projectsList.path, projectHandlers.methodNotAllowed);
  app.get(API_ROUTE_DEFINITIONS.projectsStatus.path, projectHandlers.status);
  app.all(API_ROUTE_DEFINITIONS.projectsStatus.path, projectHandlers.methodNotAllowed);
  app.get(API_ROUTE_DEFINITIONS.projectsFavicon.path, projectHandlers.favicon);
  app.all(API_ROUTE_DEFINITIONS.projectsFavicon.path, projectHandlers.methodNotAllowed);
  app.post(API_ROUTE_DEFINITIONS.projectsAttach.path, projectHandlers.attach);
  app.all(API_ROUTE_DEFINITIONS.projectsAttach.path, projectHandlers.methodNotAllowed);
  app.post(API_ROUTE_DEFINITIONS.projectsDetach.path, projectHandlers.detach);
  app.all(API_ROUTE_DEFINITIONS.projectsDetach.path, projectHandlers.methodNotAllowed);
  app.post(API_ROUTE_DEFINITIONS.projectsIndex.path, projectHandlers.index);
  app.all(API_ROUTE_DEFINITIONS.projectsIndex.path, projectHandlers.methodNotAllowed);
  app.post(API_ROUTE_DEFINITIONS.projectsReveal.path, projectHandlers.reveal);
  app.all(API_ROUTE_DEFINITIONS.projectsReveal.path, projectHandlers.methodNotAllowed);

  const toolHandlers = createToolRouteHandlers(api, config);
  app.get(API_ROUTE_DEFINITIONS.toolsList.path, toolHandlers.list);
  app.all(API_ROUTE_DEFINITIONS.toolsList.path, toolHandlers.methodNotAllowed);
  app.post(API_ROUTE_DEFINITIONS.toolsInvoke.path, toolHandlers.invoke);
  app.all(API_ROUTE_DEFINITIONS.toolsInvoke.path, toolHandlers.methodNotAllowed);

  const answerHandlers = createAnswerRouteHandlers(api, config);
  app.post(API_ROUTE_DEFINITIONS.answerAsk.path, answerHandlers.ask);
  app.all(API_ROUTE_DEFINITIONS.answerAsk.path, answerHandlers.methodNotAllowed);

  const workflowPacketHandlers = createWorkflowPacketRouteHandlers(api);
  app.post(API_ROUTE_DEFINITIONS.workflowPacketsGenerate.path, workflowPacketHandlers.generate);
  app.all(API_ROUTE_DEFINITIONS.workflowPacketsGenerate.path, workflowPacketHandlers.methodNotAllowed);

  app.all(API_ROUTE_DEFINITIONS.mcp.path, createMcpRouteHandler(options, mcpSessions));

  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (isKnownPath(request.path)) {
      next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
      return;
    }

    next(new ApiRequestError(404, "not_found", `No route for ${request.method} ${request.path}`));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const context = getRequestContext(response);

    if (typeof error === "object" && error != null && "type" in error && (error as { type?: string }).type === "entity.too.large") {
      writeError(
        response,
        context.requestId,
        413,
        "request_too_large",
        `Request body exceeded limit of ${options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES} bytes.`,
      );
      return;
    }

    if (error instanceof SyntaxError) {
      writeError(response, context.requestId, 400, "invalid_json", "Request body must be valid JSON.");
      return;
    }

    if (error instanceof ApiRequestError) {
      writeError(response, context.requestId, error.statusCode, error.code, error.message, error.details);
      return;
    }

    if (isProjectCommandError(error)) {
      writeError(response, context.requestId, error.statusCode, error.code, error.message, error.details as JsonObject | undefined);
      return;
    }

    if (isMakoToolError(error)) {
      writeError(response, context.requestId, error.statusCode, error.code as ApiErrorCode, error.message, error.details);
      return;
    }

    writeError(response, context.requestId, 500, "internal_error", error instanceof Error ? error.message : String(error));
  });

  return { app, closeMcpSessions };
}

export function createHttpApiServer(options: HttpServerOptions = {}): Server {
  const { app, closeMcpSessions } = createHttpApiApp(options);
  const server = createServer(app as never);
  server.once("close", () => {
    void closeMcpSessions();
  });
  return server;
}

export async function startHttpApiServer(options: HttpServerOptions = {}): Promise<StartedHttpServer> {
  const config = getConfig(options);
  const host = options.host ?? config.apiHost;
  const port = options.port ?? config.apiPort;
  const server = createHttpApiServer({
    ...options,
    host,
    port,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    host,
    port: resolvedPort,
    server,
    close: async () => {
      const closeAllConnections = (server as Server & { closeAllConnections?: () => void }).closeAllConnections;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
        closeAllConnections?.call(server);
      });
    },
  };
}

// Note: this module used to end with a `main()` function and an
// `if (import.meta.url === pathToFileURL(process.argv[1]).href)` direct-
// execution block so `node services/api/src/server.ts` could spin up the
// HTTP server standalone. That was never actually invoked anywhere
// (nothing in the repo runs this file as a script; the CLI's `serve`
// command is the only entry point for starting the server), and when
// tsup bundled this file into the CLI the direct-execution guard fired
// spuriously because the bundle IS the entry point — `argv[0]` ended up
// being `["--json"]`, `portValue` was `"--json"`, and the CLI threw
// `Invalid port: --json` before the real CLI main could run. Removed to
// fix the bundling hazard. Re-add as a separate script file if standalone
// server invocation is ever needed.
