import type {
  JsonObject,
  JsonValue,
  RpcNeighborhoodToolInput,
  RpcNeighborhoodToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { runCachedReefCalculation } from "../reef/calculation-cache.js";
import { REEF_RPC_NEIGHBORHOOD_NODE, REEF_RPC_NEIGHBORHOOD_QUERY_KIND } from "../reef/calculation-nodes.js";
import {
  appendTruncationWarning,
  collectRlsPolicies,
  findSchemaObject,
  findSchemaRpc,
  functionRefKey,
  normalizeMaxPerSection,
  rlsPolicyKey,
  schemaUsageForObject,
  schemaUsageKey,
  section,
  uniqueBy,
} from "./shared.js";

export type RpcNeighborhoodCalculationOutput = Omit<
  RpcNeighborhoodToolOutput,
  "toolName" | "projectId" | "generatedAt"
>;

export interface RpcNeighborhoodCalculationInput {
  projectStore: Parameters<typeof findSchemaRpc>[0];
  schemaName?: string;
  rpcName: string;
  argTypes?: string[];
  maxPerSection: number;
}

export async function rpcNeighborhoodTool(
  input: RpcNeighborhoodToolInput,
  options: ToolServiceOptions = {},
): Promise<RpcNeighborhoodToolOutput> {
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const sourceRevision = projectStore.loadReefAnalysisState(
      project.projectId,
      project.canonicalPath,
    )?.materializedRevision;
    const calculationInput: JsonObject = {
      rpcName: input.rpcName,
      maxPerSection: max,
    };
    if (input.schemaName) {
      calculationInput.schemaName = input.schemaName;
    }
    if (input.argTypes) {
      calculationInput.argTypes = input.argTypes;
    }
    const calculation = runCachedReefCalculation({
      projectStore,
      projectId: project.projectId,
      root: project.canonicalPath,
      node: REEF_RPC_NEIGHBORHOOD_NODE,
      queryKind: REEF_RPC_NEIGHBORHOOD_QUERY_KIND,
      sourceRevision,
      input: calculationInput,
      compute: () => calculateRpcNeighborhood({
        projectStore,
        schemaName: input.schemaName,
        rpcName: input.rpcName,
        argTypes: input.argTypes,
        maxPerSection: max,
      }),
      toJson: rpcNeighborhoodToJson,
      fromJson: rpcNeighborhoodFromJson,
    });
    const warnings = [
      ...calculation.value.warnings,
      ...(calculation.cache.enabled
        ? [`rpc neighborhood calculation cache ${calculation.cache.hit ? "hit" : "miss"} for ${calculation.cache.path}.`]
        : []),
    ];

    return {
      toolName: "rpc_neighborhood",
      projectId: project.projectId,
      generatedAt,
      ...calculation.value,
      warnings,
    };
  });
}

export function calculateRpcNeighborhood(
  input: RpcNeighborhoodCalculationInput,
): RpcNeighborhoodCalculationOutput {
  const rpcResolution = findSchemaRpc(
    input.projectStore,
    input.rpcName,
    input.schemaName,
    input.argTypes,
  );
  const warnings = [...rpcResolution.warnings];
  const { schemaName, rpc } = rpcResolution;
  const rpcObject = findSchemaObject(input.projectStore, "rpc", schemaName, input.rpcName);
  const callers = uniqueBy(schemaUsageForObject(input.projectStore, rpcObject), schemaUsageKey);
  const tablesTouched = uniqueBy(
    input.projectStore.listFunctionTableRefs({
      rpcSchema: schemaName,
      rpcName: input.rpcName,
      argTypes: input.argTypes,
    }),
    functionRefKey,
  );
  const rlsPolicies = uniqueBy(
    collectRlsPolicies(
      input.projectStore,
      tablesTouched.map((ref) => ({
        schemaName: ref.targetSchema,
        tableName: ref.targetTable,
      })),
    ),
    rlsPolicyKey,
  );

  if (!rpc) {
    warnings.push(
      `RPC ${schemaName}.${input.rpcName} is not present in the current schema snapshot.`,
    );
  }
  if (!rpcObject) {
    warnings.push(
      `RPC ${schemaName}.${input.rpcName} is not present in indexed schema_usage objects.`,
    );
  }

  const callerSection = section(callers, input.maxPerSection);
  const tableSection = section(tablesTouched, input.maxPerSection);
  const rlsSection = section(rlsPolicies, input.maxPerSection);
  appendTruncationWarning(warnings, "callers", callerSection, input.maxPerSection);
  appendTruncationWarning(warnings, "tablesTouched", tableSection, input.maxPerSection);
  appendTruncationWarning(warnings, "rlsPolicies", rlsSection, input.maxPerSection);

  return {
    schemaName,
    rpcName: input.rpcName,
    argTypes: input.argTypes ?? rpc?.argTypes,
    rpc,
    callers: callerSection,
    tablesTouched: tableSection,
    rlsPolicies: rlsSection,
    evidenceRefs: [
      `db_rpc:${schemaName}.${input.rpcName}`,
      `schema_usage:${schemaName}.${input.rpcName}`,
      `trace_rpc:${schemaName}.${input.rpcName}`,
      ...tablesTouched.map((ref) => `db_table_schema:${ref.targetSchema}.${ref.targetTable}`),
      ...tablesTouched.map((ref) => `db_rls:${ref.targetSchema}.${ref.targetTable}`),
    ],
    trust: null,
    warnings,
  };
}

function rpcNeighborhoodToJson(value: RpcNeighborhoodCalculationOutput): JsonValue {
  return value as unknown as JsonValue;
}

function rpcNeighborhoodFromJson(value: JsonValue): RpcNeighborhoodCalculationOutput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<RpcNeighborhoodCalculationOutput>;
  if (
    typeof record.schemaName !== "string" ||
    typeof record.rpcName !== "string" ||
    !record.callers ||
    !record.tablesTouched ||
    !record.rlsPolicies ||
    !Array.isArray(record.evidenceRefs) ||
    !Array.isArray(record.warnings)
  ) {
    return undefined;
  }
  return record as RpcNeighborhoodCalculationOutput;
}
