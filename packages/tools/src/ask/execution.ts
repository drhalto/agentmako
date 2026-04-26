import type {
  AnswerResult,
  AskToolInput,
  AuthPathToolInput,
  CrossSearchToolInput,
  DbColumnsToolInput,
  DbFkToolInput,
  DbPingToolInput,
  DbRlsToolInput,
  DbRpcToolInput,
  DbTableSchemaToolInput,
  ExportsOfToolInput,
  FileHealthToolInput,
  ImportsCyclesToolInput,
  ImportsDepsToolInput,
  ImportsHotspotsToolInput,
  ImportsImpactToolInput,
  PreflightTableToolInput,
  RouteTraceToolInput,
  SchemaUsageToolInput,
  SymbolsOfToolInput,
  TraceEdgeToolInput,
  TraceErrorToolInput,
  TraceFileToolInput,
  TraceRpcToolInput,
  TraceTableToolInput,
} from "@mako-ai/contracts";
import {
  AuthPathToolInputSchema,
  CrossSearchToolInputSchema,
  DbColumnsToolInputSchema,
  DbFkToolInputSchema,
  DbPingToolInputSchema,
  DbRlsToolInputSchema,
  DbRpcToolInputSchema,
  DbTableSchemaToolInputSchema,
  ExportsOfToolInputSchema,
  FileHealthToolInputSchema,
  ImportsCyclesToolInputSchema,
  ImportsDepsToolInputSchema,
  ImportsHotspotsToolInputSchema,
  ImportsImpactToolInputSchema,
  PreflightTableToolInputSchema,
  RouteTraceToolInputSchema,
  SchemaUsageToolInputSchema,
  SymbolsOfToolInputSchema,
  TraceEdgeToolInputSchema,
  TraceErrorToolInputSchema,
  TraceFileToolInputSchema,
  TraceRpcToolInputSchema,
  TraceTableToolInputSchema,
} from "@mako-ai/contracts";
import { ZodError } from "zod";
import { authPathTool, fileHealthTool, routeTraceTool, runAnswerPacket, schemaUsageTool } from "../answers/index.js";
import { createFreshAnswerPacket } from "../answers/packet.js";
import {
  crossSearchTool,
  preflightTableTool,
  traceEdgeTool,
  traceErrorTool,
  traceFileTool,
  traceRpcTool,
  traceTableTool,
} from "../composers/index.js";
import { dbColumnsTool, dbFkTool, dbPingTool, dbRlsTool, dbRpcTool, dbTableSchemaTool } from "../db/index.js";
import { MakoToolError } from "../errors.js";
import { importsCyclesTool, importsDepsTool, importsHotspotsTool, importsImpactTool } from "../imports/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { exportsOfTool, symbolsOfTool } from "../symbols/index.js";
import { type AskExecutionDefinition, type AskSelection, projectLocatorArgs } from "./types.js";

const ASK_EXECUTION_MAP: Record<string, AskExecutionDefinition> = {
  route_trace: {
    family: "answers",
    requiresProject: true,
    schema: RouteTraceToolInputSchema,
    execute: (input, options) => routeTraceTool(input as RouteTraceToolInput, options),
  },
  schema_usage: {
    family: "answers",
    requiresProject: true,
    schema: SchemaUsageToolInputSchema,
    execute: (input, options) => schemaUsageTool(input as SchemaUsageToolInput, options),
  },
  file_health: {
    family: "answers",
    requiresProject: true,
    schema: FileHealthToolInputSchema,
    execute: (input, options) => fileHealthTool(input as FileHealthToolInput, options),
  },
  auth_path: {
    family: "answers",
    requiresProject: true,
    schema: AuthPathToolInputSchema,
    execute: (input, options) => authPathTool(input as AuthPathToolInput, options),
  },
  imports_deps: {
    family: "imports",
    requiresProject: true,
    schema: ImportsDepsToolInputSchema,
    execute: (input, options) => importsDepsTool(input as ImportsDepsToolInput, options),
  },
  imports_impact: {
    family: "imports",
    requiresProject: true,
    schema: ImportsImpactToolInputSchema,
    execute: (input, options) => importsImpactTool(input as ImportsImpactToolInput, options),
  },
  imports_hotspots: {
    family: "imports",
    requiresProject: true,
    schema: ImportsHotspotsToolInputSchema,
    execute: (input, options) => importsHotspotsTool(input as ImportsHotspotsToolInput, options),
  },
  imports_cycles: {
    family: "imports",
    requiresProject: true,
    schema: ImportsCyclesToolInputSchema,
    execute: (input, options) => importsCyclesTool(input as ImportsCyclesToolInput, options),
  },
  symbols_of: {
    family: "symbols",
    requiresProject: true,
    schema: SymbolsOfToolInputSchema,
    execute: (input, options) => symbolsOfTool(input as SymbolsOfToolInput, options),
  },
  exports_of: {
    family: "symbols",
    requiresProject: true,
    schema: ExportsOfToolInputSchema,
    execute: (input, options) => exportsOfTool(input as ExportsOfToolInput, options),
  },
  db_ping: {
    family: "db",
    requiresProject: true,
    schema: DbPingToolInputSchema,
    execute: (input, options) => dbPingTool(input as DbPingToolInput, options),
  },
  db_columns: {
    family: "db",
    requiresProject: true,
    schema: DbColumnsToolInputSchema,
    execute: (input, options) => dbColumnsTool(input as DbColumnsToolInput, options),
  },
  db_fk: {
    family: "db",
    requiresProject: true,
    schema: DbFkToolInputSchema,
    execute: (input, options) => dbFkTool(input as DbFkToolInput, options),
  },
  db_rls: {
    family: "db",
    requiresProject: true,
    schema: DbRlsToolInputSchema,
    execute: (input, options) => dbRlsTool(input as DbRlsToolInput, options),
  },
  db_rpc: {
    family: "db",
    requiresProject: true,
    schema: DbRpcToolInputSchema,
    execute: (input, options) => dbRpcTool(input as DbRpcToolInput, options),
  },
  db_table_schema: {
    family: "db",
    requiresProject: true,
    schema: DbTableSchemaToolInputSchema,
    execute: (input, options) => dbTableSchemaTool(input as DbTableSchemaToolInput, options),
  },
  trace_file: {
    family: "composer",
    requiresProject: true,
    schema: TraceFileToolInputSchema,
    execute: (input, options) => traceFileTool.execute(input as TraceFileToolInput, options),
  },
  preflight_table: {
    family: "composer",
    requiresProject: true,
    schema: PreflightTableToolInputSchema,
    execute: (input, options) => preflightTableTool.execute(input as PreflightTableToolInput, options),
  },
  cross_search: {
    family: "composer",
    requiresProject: true,
    schema: CrossSearchToolInputSchema,
    execute: (input, options) => crossSearchTool.execute(input as CrossSearchToolInput, options),
  },
  trace_edge: {
    family: "composer",
    requiresProject: true,
    schema: TraceEdgeToolInputSchema,
    execute: (input, options) => traceEdgeTool.execute(input as TraceEdgeToolInput, options),
  },
  trace_error: {
    family: "composer",
    requiresProject: true,
    schema: TraceErrorToolInputSchema,
    execute: (input, options) => traceErrorTool.execute(input as TraceErrorToolInput, options),
  },
  trace_table: {
    family: "composer",
    requiresProject: true,
    schema: TraceTableToolInputSchema,
    execute: (input, options) => traceTableTool.execute(input as TraceTableToolInput, options),
  },
  trace_rpc: {
    family: "composer",
    requiresProject: true,
    schema: TraceRpcToolInputSchema,
    execute: (input, options) => traceRpcTool.execute(input as TraceRpcToolInput, options),
  },
};

function createMissingProjectContextError(selection: AskSelection): MakoToolError {
  return new MakoToolError(
    400,
    "missing_project_context",
    selection.mode === "fallback"
      ? "Fallback requires project context."
      : `The routed tool \`${selection.selectedTool}\` requires project context. Provide \`projectId\` or \`projectRef\`.`,
    {
      selectedFamily: selection.selectedFamily,
      selectedTool: selection.selectedTool,
      selectedArgs: selection.selectedArgs,
    },
  );
}

async function runFallback(question: string, input: AskToolInput, options: ToolServiceOptions): Promise<AnswerResult> {
  const locator = projectLocatorArgs(input);
  const projectInfo = await withProjectContext(locator, options, ({ project, profile }) => ({
    projectId: project.projectId,
    supportLevel: profile?.supportLevel ?? "best_effort",
  }));

  return runAnswerPacket(createFreshAnswerPacket(projectInfo.projectId, "free_form", question, projectInfo.supportLevel), options);
}

export async function executeAskSelection(
  selection: AskSelection,
  input: AskToolInput,
  options: ToolServiceOptions,
): Promise<unknown> {
  if (selection.mode === "fallback") {
    return runFallback(input.question, input, options);
  }

  const definition = ASK_EXECUTION_MAP[selection.selectedTool];

  try {
    const parsed = definition.schema.parse(selection.selectedArgs);
    return await definition.execute(parsed, options);
  } catch (error) {
    if (error instanceof ZodError) {
      throw MakoToolError.fromZodError(error);
    }

    if (error instanceof MakoToolError && error.code === "missing_project_context") {
      throw createMissingProjectContextError(selection);
    }

    throw error;
  }
}
