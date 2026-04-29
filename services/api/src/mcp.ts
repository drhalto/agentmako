import { randomUUID } from "node:crypto";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListRootsResultSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AttachedProject } from "@mako-ai/contracts";
import { ACTION_TOOLS } from "@mako-ai/harness-tools";
import {
  createMcpProgressReporter,
  GenericAgentClient,
  MAKO_SERVER_INSTRUCTIONS,
  selectAgentClient,
  buildRegistryToolSearchCatalog,
  buildRegistryToolExposurePlan,
  type AgentClient,
  type AgentClientToolInfo,
  type ProgressReporter,
  type ToolSearchCatalogEntry,
  coerceDeferredInput,
  getToolDefinition,
  rankToolSearchEntries,
} from "@mako-ai/tools";
import { z, type ZodTypeAny } from "zod";
import type { HttpServerOptions } from "./server.js";
import { createApiService } from "./service.js";
import {
  ApiRequestError,
  getConfig,
  getOptionalJsonObject,
  getSingleHeaderValue,
  isAllowedMcpOrigin,
  rootUriToPath,
  type NextFunction,
  type Request,
  type Response,
  type RouteHandler,
} from "./server-utils.js";
import type { ProjectIndexRefreshCoordinator } from "./index-refresh-coordinator.js";

const APP_VERSION = "0.1.0";
const ActionToolUnavailableSchema = z.object({
  ok: z.literal(false),
  requiresHarnessSession: z.literal(true),
  error: z.string(),
});
const ToolSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});
const TOOL_SEARCH_DESCRIPTION =
  "Search the MCP-visible tool catalog, including deferred and blocked tools. Use when you are unsure which tool fits a task or why a tool is unavailable over MCP.";
const ToolSearchOutputSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      name: z.string().min(1),
      family: z.enum(["registry", "action"]),
      availability: z.enum(["immediate", "deferred", "blocked"]),
      reason: z.string().nullable(),
      description: z.string().min(1),
      category: z.string().nullable(),
    }),
  ),
});
const AuthPathMcpInputSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  projectRef: z.string().trim().min(1).optional(),
  route: z.string().trim().min(1).optional(),
  file: z.string().trim().min(1).optional(),
  feature: z.string().trim().min(1).optional(),
});

type SendNotification = (notification: unknown) => Promise<void> | void;

function getProgressToken(meta: Record<string, unknown> | undefined): string | number | undefined {
  const token = meta?.progressToken;
  return typeof token === "string" || typeof token === "number" ? token : undefined;
}

function createProgressReporterForCall(args: {
  meta: Record<string, unknown> | undefined;
  extra: unknown;
  agentClient: AgentClient;
}): ProgressReporter | undefined {
  const progressToken = getProgressToken(args.meta);
  const extra = args.extra as { sendNotification?: SendNotification };
  if (progressToken == null || typeof extra.sendNotification !== "function") {
    return undefined;
  }

  const sendNotification = extra.sendNotification.bind(extra);
  return createMcpProgressReporter({
    progressToken,
    client: args.agentClient,
    sendNotification,
    logger: (msg, error) => {
      console.error(
        `[mako-mcp-progress] ${msg}: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
}

function createMcpInputSchema(schema: ZodTypeAny): ZodTypeAny {
  if ((schema._def.typeName as string) !== "ZodObject") {
    return schema;
  }

  const shapeFactory = schema._def.shape as
    | (() => Record<string, ZodTypeAny>)
    | Record<string, ZodTypeAny>;
  const shape = typeof shapeFactory === "function" ? shapeFactory() : shapeFactory;
  const coercedShape: Record<string, ZodTypeAny> = {};
  for (const [key, entrySchema] of Object.entries(shape)) {
    coercedShape[key] = z.preprocess(
      (value) => coerceDeferredInput(entrySchema, value),
      entrySchema,
    );
  }

  let objectSchema: z.AnyZodObject = z.object(coercedShape);
  const unknownKeys = schema._def.unknownKeys as "passthrough" | "strict" | "strip" | undefined;
  if (unknownKeys === "strict") {
    objectSchema = objectSchema.strict();
  } else if (unknownKeys === "passthrough") {
    objectSchema = objectSchema.passthrough();
  } else {
    objectSchema = objectSchema.strip();
  }

  const catchall = schema._def.catchall as ZodTypeAny | undefined;
  if (catchall && (catchall._def.typeName as string) !== "ZodNever") {
    objectSchema = objectSchema.catchall(catchall);
  }

  return schema.description ? objectSchema.describe(schema.description) : objectSchema;
}

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  activeProjectId?: string;
  indexRefreshCoordinator?: ProjectIndexRefreshCoordinator;
}

export function createMcpServer(
  options: HttpServerOptions,
  getSession: (sessionId: string | undefined) => McpSession | undefined,
): McpServer {
  const config = getConfig(options);
  const api = createApiService(options);
  const server = new McpServer(
    { name: config.appName, version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions: MAKO_SERVER_INSTRUCTIONS,
    },
  );
  let agentClient: AgentClient = GenericAgentClient;
  const agentMetadataTools: Array<{
    registeredTool: RegisteredTool;
    tool: AgentClientToolInfo;
  }> = [];

  const metaForTool = (tool: AgentClientToolInfo): Record<string, unknown> | undefined => {
    const meta = agentClient.toolMeta(tool);
    return meta && Object.keys(meta).length > 0 ? meta : undefined;
  };
  const trackAgentMetadataTool = (
    registeredTool: RegisteredTool,
    tool: AgentClientToolInfo,
  ): void => {
    agentMetadataTools.push({ registeredTool, tool });
  };
  const refreshAgentMetadata = (): void => {
    agentClient = selectAgentClient(server.server.getClientVersion());
    let changed = false;
    for (const item of agentMetadataTools) {
      const nextMeta = metaForTool(item.tool);
      const currentMeta = item.registeredTool._meta;
      if (JSON.stringify(currentMeta ?? {}) !== JSON.stringify(nextMeta ?? {})) {
        item.registeredTool._meta = nextMeta;
        changed = true;
      }
    }
    if (changed) {
      server.sendToolListChanged();
    }
  };
  server.server.oninitialized = refreshAgentMetadata;

  const registryPlan = buildRegistryToolExposurePlan({
    configOverrides: options.configOverrides,
    surface: "mcp",
  });

  for (const item of registryPlan.immediate) {
    const tool = item.summary;
    const definition = getToolDefinition(tool.name);
    if (!definition) {
      continue;
    }

    const toolInfo = {
      name: tool.name,
      description: tool.description,
    };
    const isMutation = "mutation" in definition.annotations;
    const registeredTool = server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: createMcpInputSchema(
          tool.name === "auth_path" ? AuthPathMcpInputSchema : definition.inputSchema,
        ),
        outputSchema: definition.outputSchema,
        _meta: metaForTool(toolInfo),
        annotations: {
          title: tool.name,
          readOnlyHint: !isMutation,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        const session = getSession(extra.sessionId);
        const meta = getOptionalJsonObject(extra._meta);
        const requestId = randomUUID();
        const progressReporter = createProgressReporterForCall({
          meta,
          extra,
          agentClient,
        });
        const output = await api.callTool(
          tool.name,
          args,
          {
            requestId,
            sessionProjectId: session?.activeProjectId,
            meta,
            getRoots: async () => {
              try {
                const response = await extra.sendRequest({ method: "roots/list" }, ListRootsResultSchema);
                return response.roots
                  .map((root) => rootUriToPath(root.uri))
                  .filter((rootPath): rootPath is string => rootPath != null);
              } catch {
                return [];
              }
            },
            onProjectResolved: (project: AttachedProject) => {
              if (session) {
                session.activeProjectId = project.projectId;
                void session.indexRefreshCoordinator?.setActiveProject(project).catch((error) => {
                  console.error(
                    `[mako-mcp] index watcher failed: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  );
                });
              }
            },
          },
          { progressReporter },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      },
    );
    trackAgentMetadataTool(registeredTool, toolInfo);
  }

  const searchableCatalog: ToolSearchCatalogEntry[] = [
    ...buildRegistryToolSearchCatalog(registryPlan),
    ...ACTION_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: "action",
      family: "action" as const,
      availability: "blocked" as const,
      reason: "requires harness session approval flow",
    })),
  ];

  const toolSearchInfo = {
    name: "tool_search",
    description: TOOL_SEARCH_DESCRIPTION,
  };
  const registeredToolSearch = server.registerTool(
    "tool_search",
    {
      title: "tool_search",
      description: TOOL_SEARCH_DESCRIPTION,
      inputSchema: createMcpInputSchema(ToolSearchInputSchema),
      outputSchema: ToolSearchOutputSchema,
      _meta: metaForTool(toolSearchInfo),
      annotations: {
        title: "tool_search",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const results = rankToolSearchEntries(
        searchableCatalog,
        args.query,
        args.limit ?? 8,
      ).map((entry) => ({
        name: entry.name,
        family: entry.family,
        availability: entry.availability,
        reason: entry.reason,
        description: entry.description,
        category: entry.category ?? null,
      }));
      const output = {
        query: args.query,
        count: results.length,
        results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
  trackAgentMetadataTool(registeredToolSearch, toolSearchInfo);

  for (const tool of ACTION_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: createMcpInputSchema(tool.parameters),
        outputSchema: ActionToolUnavailableSchema,
        annotations: {
          title: tool.name,
          destructiveHint: true,
        },
        _meta: {
          requiresApproval: true,
        },
      },
      async (_args: Record<string, unknown>, _extra: Record<string, unknown>) => {
        const output = {
          ok: false as const,
          requiresHarnessSession: true as const,
          error:
            `\`${tool.name}\` is an action tool and requires the harness session transport. ` +
            "Use `services/harness` or `agentmako chat` so the approval and snapshot flow can run.",
        };
        return {
          content: [{ type: "text" as const, text: output.error }],
          structuredContent: output,
          isError: true,
        };
      },
    );
  }

  return server;
}

export function createMcpRouteHandler(
  options: HttpServerOptions,
  mcpSessions: Map<string, McpSession>,
): RouteHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!["GET", "POST", "DELETE"].includes(request.method)) {
        throw new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`);
      }

      const origin = getSingleHeaderValue(request.headers.origin);
      if (!isAllowedMcpOrigin(origin)) {
        throw new ApiRequestError(403, "invalid_request", "Origin is not allowed for /mcp.", {
          origin: origin ?? null,
        });
      }

      const sessionId = getSingleHeaderValue(request.headers["mcp-session-id"]);
      if (sessionId) {
        const session = mcpSessions.get(sessionId);
        if (!session) {
          throw new ApiRequestError(404, "not_found", `No MCP session found for: ${sessionId}`);
        }

        await session.transport.handleRequest(request as never, response as never, request.body);
        return;
      }

      if (request.method === "POST" && isInitializeRequest(request.body)) {
        const mcpServer = createMcpServer(options, (currentSessionId) =>
          currentSessionId ? mcpSessions.get(currentSessionId) : undefined,
        );
        let transport: StreamableHTTPServerTransport;
        let closed = false;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            mcpSessions.set(initializedSessionId, { server: mcpServer, transport });
          },
        });
        transport.onclose = () => {
          if (closed) {
            return;
          }

          closed = true;
          if (transport.sessionId) {
            mcpSessions.delete(transport.sessionId);
          }
        };
        transport.onerror = (error) => {
          console.error(error instanceof Error ? error.message : String(error));
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(request as never, response as never, request.body);
        return;
      }

      throw new ApiRequestError(
        400,
        "invalid_request",
        "MCP requests must initialize a session with POST /mcp before issuing follow-up requests.",
      );
    } catch (error) {
      next(error);
    }
  };
}
