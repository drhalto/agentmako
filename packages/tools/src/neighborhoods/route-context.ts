import type {
  RouteContextToolInput,
  RouteContextToolOutput,
} from "@mako-ai/contracts";
import { collectExactRouteCandidates, withProjectContext, type ToolServiceOptions } from "../runtime.js";
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

export async function routeContextTool(
  input: RouteContextToolInput,
  options: ToolServiceOptions = {},
): Promise<RouteContextToolOutput> {
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const warnings: string[] = [];
    const exactRoutes = collectExactRouteCandidates(projectStore, input.route);
    const routeCandidates = exactRoutes.length > 0
      ? exactRoutes
      : projectStore.searchRoutes(input.route, 5);
    const route = routeCandidates[0] ?? null;
    if (routeCandidates.length > 1) {
      warnings.push(
        `Multiple routes matched ${input.route}; selected ${route?.routeKey ?? "none"}. Use a routeKey or METHOD path to disambiguate.`,
      );
    }
    if (!route) {
      warnings.push(`Route ${input.route} is not present in the current route index.`);
    }

    const handlerFile = route ? projectStore.getFileDetail(route.filePath) : null;
    if (route && !handlerFile) {
      warnings.push(`Handler file ${route.filePath} is not present in the file index.`);
    }

    const outboundImports = route
      ? projectStore.listImportsForFile(route.filePath).map(toImportLink)
      : [];
    const inboundImports = route
      ? projectStore.listDependentsForFile(route.filePath).map(toImportLink)
      : [];
    const analysisFiles = uniqueBy(
      [
        ...(route ? [route.filePath] : []),
        ...outboundImports
          .filter((link) => link.targetExists)
          .map((link) => link.targetPath),
      ],
      (filePath) => filePath,
    );

    const usageEntries = collectSchemaUsagesForFiles(projectStore, analysisFiles);
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
      projectStore.listFunctionTableRefs({
        rpcSchema: rpc.schemaName,
        rpcName: rpc.rpcName,
      }).map(tableTouchFromFunctionRef),
    );
    const downstreamTables = uniqueBy(
      [...directTableTouches, ...rpcTableTouches],
      tableTouchKey,
    );
    const rlsPolicies = uniqueBy(
      collectRlsPolicies(projectStore, downstreamTables),
      rlsPolicyKey,
    );

    const outboundSection = section(outboundImports, max);
    const inboundSection = section(inboundImports, max);
    const tableSection = section(downstreamTables, max);
    const rpcSection = section(downstreamRpcs, max);
    const rlsSection = section(rlsPolicies, max);
    appendTruncationWarning(warnings, "outboundImports", outboundSection, max);
    appendTruncationWarning(warnings, "inboundImports", inboundSection, max);
    appendTruncationWarning(warnings, "downstreamTables", tableSection, max);
    appendTruncationWarning(warnings, "downstreamRpcs", rpcSection, max);
    appendTruncationWarning(warnings, "rlsPolicies", rlsSection, max);

    return {
      toolName: "route_context",
      projectId: project.projectId,
      generatedAt,
      route: input.route,
      resolvedRoute: route ? toRouteRecord(route) : null,
      handlerFile: handlerFile ? toFileSummary(handlerFile) : null,
      outboundImports: outboundSection,
      inboundImports: inboundSection,
      downstreamTables: tableSection,
      downstreamRpcs: rpcSection,
      rlsPolicies: rlsSection,
      evidenceRefs: [
        `route_trace:${input.route}`,
        ...(route ? [`file_health:${route.filePath}`, `imports_deps:${route.filePath}`] : []),
        ...analysisFiles.map((filePath) => `schema_usage:${filePath}`),
        ...downstreamRpcs.map((rpc) => `trace_rpc:${rpc.schemaName}.${rpc.rpcName}`),
        ...downstreamTables.map((table) => `db_rls:${table.schemaName}.${table.tableName}`),
      ],
      trust: null,
      warnings,
    };
  });
}
