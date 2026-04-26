import type {
  RpcNeighborhoodToolInput,
  RpcNeighborhoodToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
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

export async function rpcNeighborhoodTool(
  input: RpcNeighborhoodToolInput,
  options: ToolServiceOptions = {},
): Promise<RpcNeighborhoodToolOutput> {
  const generatedAt = new Date().toISOString();
  const max = normalizeMaxPerSection(input.maxPerSection);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const rpcResolution = findSchemaRpc(
      projectStore,
      input.rpcName,
      input.schemaName,
      input.argTypes,
    );
    const warnings = [...rpcResolution.warnings];
    const { schemaName, rpc } = rpcResolution;
    const rpcObject = findSchemaObject(projectStore, "rpc", schemaName, input.rpcName);
    const callers = uniqueBy(schemaUsageForObject(projectStore, rpcObject), schemaUsageKey);
    const tablesTouched = uniqueBy(
      projectStore.listFunctionTableRefs({
        rpcSchema: schemaName,
        rpcName: input.rpcName,
        argTypes: input.argTypes,
      }),
      functionRefKey,
    );
    const rlsPolicies = uniqueBy(
      collectRlsPolicies(
        projectStore,
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

    const callerSection = section(callers, max);
    const tableSection = section(tablesTouched, max);
    const rlsSection = section(rlsPolicies, max);
    appendTruncationWarning(warnings, "callers", callerSection, max);
    appendTruncationWarning(warnings, "tablesTouched", tableSection, max);
    appendTruncationWarning(warnings, "rlsPolicies", rlsSection, max);

    return {
      toolName: "rpc_neighborhood",
      projectId: project.projectId,
      generatedAt,
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
  });
}
