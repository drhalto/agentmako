import type {
  AnswerPacket,
  AnswerResult,
  AnswerToolName,
  AnswerToolQueryKind,
  AttachedProject,
  AuthPathToolInput,
  AuthPathToolOutput,
  FileHealthToolInput,
  FileHealthToolOutput,
  ProjectProfile,
  RouteTraceToolInput,
  RouteTraceToolOutput,
  SchemaUsageToolInput,
  SchemaUsageToolOutput,
  SupportLevel,
} from "@mako-ai/contracts";
import { createAnswerEngine } from "@mako-ai/engine";
import { isMakoToolError } from "../errors.js";
import { persistAndEnrichAnswerResult } from "../trust/enrich-answer-result.js";
import { createFreshAnswerPacket } from "./packet.js";
import {
  resolveAuthFeature,
  resolveIndexedFilePath,
  resolveIndexedRoute,
  resolveIndexedSchemaObject,
  resolveRouteIdentifier,
  resolveSchemaObjectIdentifier,
  withProjectContext,
  type ToolProjectContext,
  type ToolServiceOptions,
} from "../runtime.js";
import { buildReefToolExecutionWithStatus } from "../reef/tool-execution.js";

const answerEngine = createAnswerEngine();

function createFallbackProfile(project: AttachedProject): ProjectProfile {
  return {
    name: project.displayName,
    rootPath: project.canonicalPath,
    framework: "unknown",
    orm: "unknown",
    srcRoot: ".",
    entryPoints: [],
    pathAliases: {},
    middlewareFiles: [],
    serverOnlyModules: [],
    authGuardSymbols: [],
    supportLevel: "best_effort",
    detectedAt: new Date().toISOString(),
  };
}

async function answerWithStores(
  packet: AnswerPacket,
  profile: { supportLevel: SupportLevel } | null,
  context: Parameters<typeof answerEngine.answer>[0],
  options: ToolServiceOptions,
): Promise<AnswerResult> {
  if (!profile) {
    return answerEngine.createFallbackResult({
      ...packet,
      supportLevel: "best_effort",
      evidenceStatus: "partial",
      missingInformation: ["Project profile is missing from the project database."],
    });
  }

  const result = answerEngine.answer(context);
  return persistAndEnrichAnswerResult({
    result,
    projectStore: context.projectStore,
    options,
  });
}

async function runAnswerTool<Name extends AnswerToolName, Output extends { toolName: Name; projectId: string; result: AnswerResult }>(
  toolName: Name,
  locator: { projectId?: string; projectRef?: string },
  resolveQueryText: (context: ToolProjectContext) => string,
  options: ToolServiceOptions,
): Promise<Output> {
  return withProjectContext(locator, options, async ({ project, profile, projectStore }) => {
    const queryText = resolveQueryText({ project, profile, projectStore });
    const packet = createFreshAnswerPacket(project.projectId, toolName, queryText, profile?.supportLevel ?? "best_effort");
    const result = await answerWithStores(
      packet,
      profile,
      {
        packet,
        project,
        profile: profile ?? createFallbackProfile(project),
        projectStore,
      },
      options,
    );

    return {
      toolName,
      projectId: project.projectId,
      result,
    } as Output;
  });
}

export async function runAnswerPacket(packet: AnswerPacket, options: ToolServiceOptions = {}): Promise<AnswerResult> {
  try {
    return await withProjectContext({ projectId: packet.projectId }, options, async ({ project, profile, projectStore }) => {
      const result = await answerWithStores(
        packet,
        profile,
        {
          packet,
          project,
          profile: profile ?? createFallbackProfile(project),
          projectStore,
        },
        options,
      );

      return result;
    });
  } catch (error) {
    if (
      !isMakoToolError(error) ||
      (error.code !== "project_not_attached" && error.code !== "project_not_found")
    ) {
      throw error;
    }

    return answerEngine.createFallbackResult({
      ...packet,
      evidenceStatus: "partial",
      missingInformation: [`Project ${packet.projectId} is not attached in global state.`],
    });
  }
}

export async function routeTraceTool(input: RouteTraceToolInput, options: ToolServiceOptions = {}): Promise<RouteTraceToolOutput> {
  return runAnswerTool(
    "route_trace",
    input,
    ({ projectStore }) => resolveRouteIdentifier(resolveIndexedRoute(projectStore, input.route)),
    options,
  );
}

export async function schemaUsageTool(input: SchemaUsageToolInput, options: ToolServiceOptions = {}): Promise<SchemaUsageToolOutput> {
  return withProjectContext(input, options, async ({ project, profile, projectStore }) => {
    const startedAtMs = Date.now();
    const queryText = resolveSchemaObjectIdentifier(resolveIndexedSchemaObject(projectStore, input.object, input.schema));
    const packet = createFreshAnswerPacket(project.projectId, "schema_usage", queryText, profile?.supportLevel ?? "best_effort");
    const result = await answerWithStores(
      packet,
      profile,
      {
        packet,
        project,
        profile: profile ?? createFallbackProfile(project),
        projectStore,
      },
      options,
    );
    const reefExecutionResult = await buildReefToolExecutionWithStatus({
      toolName: "schema_usage",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      returnedCount: result.candidateActions.length,
    });
    const schemaFreshness = reefExecutionResult.projectStatus?.schema;

    return {
      toolName: "schema_usage",
      projectId: project.projectId,
      result,
      reefExecution: reefExecutionResult.execution,
      ...(schemaFreshness ? { schemaFreshness } : {}),
    };
  });
}

export async function fileHealthTool(input: FileHealthToolInput, options: ToolServiceOptions = {}): Promise<FileHealthToolOutput> {
  return runAnswerTool(
    "file_health",
    input,
    ({ project, projectStore }) => resolveIndexedFilePath(project.canonicalPath, projectStore, input.file),
    options,
  );
}

export async function authPathTool(input: AuthPathToolInput, options: ToolServiceOptions = {}): Promise<AuthPathToolOutput> {
  return runAnswerTool(
    "auth_path",
    input,
    (context) =>
      [
        input.route ? resolveRouteIdentifier(resolveIndexedRoute(context.projectStore, input.route)) : undefined,
        input.file ? resolveIndexedFilePath(context.project.canonicalPath, context.projectStore, input.file) : undefined,
        input.feature ? resolveAuthFeature(context, input.feature) : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
    options,
  );
}
