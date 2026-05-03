import type {
  JsonObject,
  JsonValue,
  RouteContextToolInput,
  RouteContextToolOutput,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { collectExactRouteCandidates, withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { runCachedReefCalculation } from "../reef/calculation-cache.js";
import { REEF_ROUTE_CONTEXT_NODE, REEF_ROUTE_CONTEXT_QUERY_KIND } from "../reef/calculation-nodes.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";
import {
  appendTruncationWarning,
  collectRlsPolicies,
  collectSchemaUsagesForFiles,
  normalizeMaxPerSection,
  rlsPolicyKey,
  rpcTouchFromUsage,
  rpcTouchKey,
  section,
  tableTouchFromFunctionRef,
  tableTouchFromUsage,
  tableTouchKey,
  toFileSummary,
  toImportLink,
  toRouteRecord,
  uniqueBy,
} from "./shared.js";

const ANALYSIS_IMPORT_DEPTH = 3;
const ANALYSIS_FILE_LIMIT = 80;

export type RouteContextCalculationOutput = Omit<
  RouteContextToolOutput,
  "toolName" | "projectId" | "generatedAt" | "reefExecution"
>;

export interface RouteContextCalculationInput {
  projectStore: ProjectStore;
  route: string;
  maxPerSection: number;
}

export async function routeContextTool(
  input: RouteContextToolInput,
  options: ToolServiceOptions = {},
): Promise<RouteContextToolOutput> {
  const startedAtMs = Date.now();
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const sourceRevision = projectStore.loadReefAnalysisState(
      project.projectId,
      project.canonicalPath,
    )?.materializedRevision;
    const calculationInput: JsonObject = {
      route: input.route,
      maxPerSection: max,
    };
    const calculation = runCachedReefCalculation({
      projectStore,
      projectId: project.projectId,
      root: project.canonicalPath,
      node: REEF_ROUTE_CONTEXT_NODE,
      queryKind: REEF_ROUTE_CONTEXT_QUERY_KIND,
      sourceRevision,
      input: calculationInput,
      compute: () => calculateRouteContext({
        projectStore,
        route: input.route,
        maxPerSection: max,
      }),
      toJson: routeContextToJson,
      fromJson: routeContextFromJson,
    });
    const warnings = [
      ...calculation.value.warnings,
      ...(calculation.cache.enabled
        ? [`route context calculation cache ${calculation.cache.hit ? "hit" : "miss"} for ${calculation.cache.path}.`]
        : []),
    ];
    const reefExecution = await buildReefToolExecution({
      toolName: "route_context",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      returnedCount: calculation.value.outboundImports.entries.length
        + calculation.value.inboundImports.entries.length
        + calculation.value.downstreamTables.entries.length
        + calculation.value.downstreamRpcs.entries.length
        + calculation.value.rlsPolicies.entries.length,
    });

    return {
      toolName: "route_context",
      projectId: project.projectId,
      generatedAt,
      ...calculation.value,
      reefExecution,
      warnings,
    };
  });
}

export function calculateRouteContext(
  input: RouteContextCalculationInput,
): RouteContextCalculationOutput {
  const warnings: string[] = [];
  const exactRoutes = collectExactRouteCandidates(input.projectStore, input.route);
  const routeCandidates = exactRoutes.length > 0
    ? exactRoutes
    : input.projectStore.searchRoutes(input.route, 5);
  const route = routeCandidates[0] ?? null;
  if (routeCandidates.length > 1) {
    warnings.push(
      `Multiple routes matched ${input.route}; selected ${route?.routeKey ?? "none"}. Use a routeKey or METHOD path to disambiguate.`,
    );
  }
  if (!route) {
    warnings.push(`Route ${input.route} is not present in the current route index.`);
  }

  const handlerFile = route ? input.projectStore.getFileDetail(route.filePath) : null;
  if (route && !handlerFile) {
    warnings.push(`Handler file ${route.filePath} is not present in the file index.`);
  }

  const outboundImports = route
    ? input.projectStore.listImportsForFile(route.filePath).map(toImportLink)
    : [];
  const inboundImports = route
    ? input.projectStore.listDependentsForFile(route.filePath).map(toImportLink)
    : [];
  const analysisFileResult = route
    ? collectOutboundAnalysisFiles(input.projectStore, route.filePath)
    : { files: [] as string[], truncated: false };
  const analysisFiles = analysisFileResult.files;
  if (analysisFileResult.truncated) {
    warnings.push(
      `route_context schema analysis truncated at ${ANALYSIS_FILE_LIMIT} files while walking outbound imports to depth ${ANALYSIS_IMPORT_DEPTH}.`,
    );
  }

  const usageEntries = collectSchemaUsagesForFiles(input.projectStore, analysisFiles);
  const directTableTouches = usageEntries
    .filter(({ object }) => object.objectType === "table")
    .map(({ object, usage }) => tableTouchFromUsage(object, usage));
  const downstreamRpcs = uniqueBy(
    usageEntries
      .filter(({ object }) => object.objectType === "rpc")
      .map(({ object, usage }) => rpcTouchFromUsage(object, usage)),
    rpcTouchKey,
  );
  const rpcTableTouches = downstreamRpcs.flatMap((rpc) =>
    input.projectStore.listFunctionTableRefs({
      rpcSchema: rpc.schemaName,
      rpcName: rpc.rpcName,
    }).map(tableTouchFromFunctionRef),
  );
  const downstreamTables = uniqueBy(
    [...directTableTouches, ...rpcTableTouches],
    tableTouchKey,
  );
  const rlsPolicies = uniqueBy(
    collectRlsPolicies(input.projectStore, downstreamTables),
    rlsPolicyKey,
  );

  const outboundSection = section(outboundImports, input.maxPerSection);
  const inboundSection = section(inboundImports, input.maxPerSection);
  const tableSection = section(downstreamTables, input.maxPerSection);
  const rpcSection = section(downstreamRpcs, input.maxPerSection);
  const rlsSection = section(rlsPolicies, input.maxPerSection);
  appendTruncationWarning(warnings, "outboundImports", outboundSection, input.maxPerSection);
  appendTruncationWarning(warnings, "inboundImports", inboundSection, input.maxPerSection);
  appendTruncationWarning(warnings, "downstreamTables", tableSection, input.maxPerSection);
  appendTruncationWarning(warnings, "downstreamRpcs", rpcSection, input.maxPerSection);
  appendTruncationWarning(warnings, "rlsPolicies", rlsSection, input.maxPerSection);
  const evidenceRefs = [
    `route_trace:${input.route}`,
    ...(route ? [`file_health:${route.filePath}`, `imports_deps:${route.filePath}`] : []),
    ...analysisFiles.map((filePath) => `schema_usage:${filePath}`),
    ...downstreamRpcs.map((rpc) => `trace_rpc:${rpc.schemaName}.${rpc.rpcName}`),
    ...downstreamTables.map((table) => `db_rls:${table.schemaName}.${table.tableName}`),
  ];

  return {
    route: input.route,
    resolvedRoute: route ? toRouteRecord(route) : null,
    handlerFile: handlerFile ? toFileSummary(handlerFile) : null,
    outboundImports: outboundSection,
    inboundImports: inboundSection,
    downstreamTables: tableSection,
    downstreamRpcs: rpcSection,
    rlsPolicies: rlsSection,
    evidenceRefs,
    trust: null,
    warnings,
  };
}

function routeContextToJson(value: RouteContextCalculationOutput): JsonValue {
  return value as unknown as JsonValue;
}

function routeContextFromJson(value: JsonValue): RouteContextCalculationOutput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<RouteContextCalculationOutput>;
  if (
    typeof record.route !== "string" ||
    !record.outboundImports ||
    !record.inboundImports ||
    !record.downstreamTables ||
    !record.downstreamRpcs ||
    !record.rlsPolicies ||
    !Array.isArray(record.evidenceRefs) ||
    !Array.isArray(record.warnings)
  ) {
    return undefined;
  }
  return record as RouteContextCalculationOutput;
}

function collectOutboundAnalysisFiles(
  projectStore: { listImportsForFile(filePath: string): Array<{ targetExists: boolean; targetPath: string }> },
  startFilePath: string,
): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ filePath: string; depth: number }> = [{ filePath: startFilePath, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.filePath)) {
      continue;
    }
    seen.add(current.filePath);
    files.push(current.filePath);
    if (files.length >= ANALYSIS_FILE_LIMIT) {
      truncated = queue.length > 0 || current.depth < ANALYSIS_IMPORT_DEPTH;
      break;
    }
    if (current.depth >= ANALYSIS_IMPORT_DEPTH) {
      continue;
    }
    for (const link of projectStore.listImportsForFile(current.filePath)) {
      if (!link.targetExists || seen.has(link.targetPath)) {
        continue;
      }
      queue.push({ filePath: link.targetPath, depth: current.depth + 1 });
    }
  }

  return { files, truncated };
}
