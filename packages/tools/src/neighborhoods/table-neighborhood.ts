import type {
  TableNeighborhoodToolInput,
  TableNeighborhoodToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import {
  appendTruncationWarning,
  findSchemaObject,
  findSchemaTable,
  functionRefKey,
  isReadUsage,
  isWriteUsage,
  normalizeMaxPerSection,
  routeKey,
  schemaUsageForObject,
  schemaUsageKey,
  section,
  toRouteRecord,
  uniqueBy,
} from "./shared.js";

export async function tableNeighborhoodTool(
  input: TableNeighborhoodToolInput,
  options: ToolServiceOptions = {},
): Promise<TableNeighborhoodToolOutput> {
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const tableResolution = findSchemaTable(projectStore, input.tableName, input.schemaName);
    const warnings = [...tableResolution.warnings];
    const { schemaName, table } = tableResolution;
    const tableObject = findSchemaObject(projectStore, "table", schemaName, input.tableName);
    const usages = schemaUsageForObject(projectStore, tableObject);
    const reads = uniqueBy(usages.filter((usage) => isReadUsage(usage.usageKind)), schemaUsageKey);
    const writes = uniqueBy(usages.filter((usage) => isWriteUsage(usage.usageKind)), schemaUsageKey);
    const dependentRpcs = uniqueBy(
      projectStore.listFunctionTableRefs({
        targetSchema: schemaName,
        tableName: input.tableName,
      }),
      functionRefKey,
    );

    const dependentRoutes = uniqueBy(
      [...reads, ...writes].flatMap((usage) =>
        projectStore.listRoutesForFile(usage.filePath).map(toRouteRecord),
      ),
      routeKey,
    );

    if (!table) {
      warnings.push(
        `Table ${schemaName}.${input.tableName} is not present in the current schema snapshot.`,
      );
    }
    if (!tableObject) {
      warnings.push(
        `Table ${schemaName}.${input.tableName} is not present in indexed schema_usage objects.`,
      );
    }

    const readSection = section(reads, max);
    const writeSection = section(writes, max);
    const dependentRpcSection = section(dependentRpcs, max);
    const dependentRouteSection = section(dependentRoutes, max);
    appendTruncationWarning(warnings, "reads", readSection, max);
    appendTruncationWarning(warnings, "writes", writeSection, max);
    appendTruncationWarning(warnings, "dependentRpcs", dependentRpcSection, max);
    appendTruncationWarning(warnings, "dependentRoutes", dependentRouteSection, max);

    return {
      toolName: "table_neighborhood",
      projectId: project.projectId,
      generatedAt,
      schemaName,
      tableName: input.tableName,
      table,
      rls: table?.rls ?? null,
      reads: readSection,
      writes: writeSection,
      dependentRpcs: dependentRpcSection,
      dependentRoutes: dependentRouteSection,
      evidenceRefs: [
        `db_table_schema:${schemaName}.${input.tableName}`,
        `db_rls:${schemaName}.${input.tableName}`,
        `schema_usage:${schemaName}.${input.tableName}`,
        `trace_table:${schemaName}.${input.tableName}`,
        ...dependentRoutes.map((route) => `route_trace:${route.routeKey}`),
      ],
      trust: null,
      warnings,
    };
  });
}
