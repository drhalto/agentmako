import type {
  JsonObject,
  JsonValue,
  TableNeighborhoodToolInput,
  TableNeighborhoodToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { runCachedReefCalculation } from "../reef/calculation-cache.js";
import { REEF_TABLE_NEIGHBORHOOD_NODE, REEF_TABLE_NEIGHBORHOOD_QUERY_KIND } from "../reef/calculation-nodes.js";
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

export type TableNeighborhoodCalculationOutput = Omit<
  TableNeighborhoodToolOutput,
  "toolName" | "projectId" | "generatedAt"
>;

export interface TableNeighborhoodCalculationInput {
  projectStore: Parameters<typeof findSchemaTable>[0];
  schemaName?: string;
  tableName: string;
  maxPerSection: number;
}

export async function tableNeighborhoodTool(
  input: TableNeighborhoodToolInput,
  options: ToolServiceOptions = {},
): Promise<TableNeighborhoodToolOutput> {
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const sourceRevision = projectStore.loadReefAnalysisState(
      project.projectId,
      project.canonicalPath,
    )?.materializedRevision;
    const calculationInput: JsonObject = {
      tableName: input.tableName,
      maxPerSection: max,
    };
    if (input.schemaName) {
      calculationInput.schemaName = input.schemaName;
    }
    const calculation = runCachedReefCalculation({
      projectStore,
      projectId: project.projectId,
      root: project.canonicalPath,
      node: REEF_TABLE_NEIGHBORHOOD_NODE,
      queryKind: REEF_TABLE_NEIGHBORHOOD_QUERY_KIND,
      sourceRevision,
      input: calculationInput,
      compute: () => calculateTableNeighborhood({
        projectStore,
        schemaName: input.schemaName,
        tableName: input.tableName,
        maxPerSection: max,
      }),
      toJson: tableNeighborhoodToJson,
      fromJson: tableNeighborhoodFromJson,
    });
    const warnings = [
      ...calculation.value.warnings,
      ...(calculation.cache.enabled
        ? [`table neighborhood calculation cache ${calculation.cache.hit ? "hit" : "miss"} for ${calculation.cache.path}.`]
        : []),
    ];

    return {
      toolName: "table_neighborhood",
      projectId: project.projectId,
      generatedAt,
      ...calculation.value,
      warnings,
    };
  });
}

export function calculateTableNeighborhood(
  input: TableNeighborhoodCalculationInput,
): TableNeighborhoodCalculationOutput {
  const tableResolution = findSchemaTable(input.projectStore, input.tableName, input.schemaName);
  const warnings = [...tableResolution.warnings];
  const { schemaName, table } = tableResolution;
  const tableObject = findSchemaObject(input.projectStore, "table", schemaName, input.tableName);
  const usages = schemaUsageForObject(input.projectStore, tableObject);
  const reads = uniqueBy(usages.filter((usage) => isReadUsage(usage.usageKind)), schemaUsageKey);
  const writes = uniqueBy(usages.filter((usage) => isWriteUsage(usage.usageKind)), schemaUsageKey);
  const dependentRpcs = uniqueBy(
    input.projectStore.listFunctionTableRefs({
      targetSchema: schemaName,
      tableName: input.tableName,
    }),
    functionRefKey,
  );

  const dependentRoutes = uniqueBy(
    [...reads, ...writes].flatMap((usage) =>
      input.projectStore.listRoutesForFile(usage.filePath).map(toRouteRecord),
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

  const readSection = section(reads, input.maxPerSection);
  const writeSection = section(writes, input.maxPerSection);
  const dependentRpcSection = section(dependentRpcs, input.maxPerSection);
  const dependentRouteSection = section(dependentRoutes, input.maxPerSection);
  appendTruncationWarning(warnings, "reads", readSection, input.maxPerSection);
  appendTruncationWarning(warnings, "writes", writeSection, input.maxPerSection);
  appendTruncationWarning(warnings, "dependentRpcs", dependentRpcSection, input.maxPerSection);
  appendTruncationWarning(warnings, "dependentRoutes", dependentRouteSection, input.maxPerSection);

  return {
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
}

function tableNeighborhoodToJson(value: TableNeighborhoodCalculationOutput): JsonValue {
  return value as unknown as JsonValue;
}

function tableNeighborhoodFromJson(value: JsonValue): TableNeighborhoodCalculationOutput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<TableNeighborhoodCalculationOutput>;
  if (
    typeof record.schemaName !== "string" ||
    typeof record.tableName !== "string" ||
    !record.reads ||
    !record.writes ||
    !record.dependentRpcs ||
    !record.dependentRoutes ||
    !Array.isArray(record.evidenceRefs) ||
    !Array.isArray(record.warnings)
  ) {
    return undefined;
  }
  return record as TableNeighborhoodCalculationOutput;
}
