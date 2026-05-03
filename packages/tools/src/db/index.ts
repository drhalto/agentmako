import type {
  DbColumnsToolInput,
  DbColumnsToolOutput,
  DbFkToolInput,
  DbFkToolOutput,
  DbPingToolInput,
  DbPingToolOutput,
  DbRlsToolInput,
  DbRlsToolOutput,
  DbRpcToolInput,
  DbRpcToolOutput,
  DbTableSchemaToolInput,
  DbTableSchemaToolOutput,
} from "@mako-ai/contracts";
import {
  fetchColumns,
  fetchForeignKeys,
  fetchPingInfo,
  fetchRls,
  fetchRpc,
  fetchRpcs,
  fetchTableSchema,
} from "@mako-ai/extension-postgres";
import type { ToolServiceOptions } from "../runtime.js";
import { MakoToolError } from "../errors.js";
import { resolveFunctionOrThrow, resolveTableOrThrow, withDbContext } from "./runtime.js";

export async function dbPingTool(
  input: DbPingToolInput,
  options: ToolServiceOptions = {},
): Promise<DbPingToolOutput> {
  return withDbContext(input, options, async (context) => {
    const info = await fetchPingInfo(context);
    return {
      toolName: "db_ping",
      connected: true,
      platform: info.platform,
      database: info.database,
      serverVersion: info.serverVersion,
      currentUser: info.currentUser,
      readOnly: info.readOnly,
      schemas: info.schemas,
    };
  });
}

export async function dbColumnsTool(
  input: DbColumnsToolInput,
  options: ToolServiceOptions = {},
): Promise<DbColumnsToolOutput> {
  return withDbContext(input, options, async (context) => {
    const target = await resolveTableOrThrow(context, input.table, input.schema);
    const columns = await fetchColumns(context, target);
    return {
      toolName: "db_columns",
      table: target.table,
      schema: target.schema,
      columns,
    };
  });
}

export async function dbFkTool(
  input: DbFkToolInput,
  options: ToolServiceOptions = {},
): Promise<DbFkToolOutput> {
  return withDbContext(input, options, async (context) => {
    const target = await resolveTableOrThrow(context, input.table, input.schema);
    const fks = await fetchForeignKeys(context, target);
    return {
      toolName: "db_fk",
      table: target.table,
      schema: target.schema,
      outbound: fks.outbound,
      inbound: fks.inbound,
    };
  });
}

export async function dbRlsTool(
  input: DbRlsToolInput,
  options: ToolServiceOptions = {},
): Promise<DbRlsToolOutput> {
  return withDbContext(input, options, async (context) => {
    const target = await resolveTableOrThrow(context, input.table, input.schema);
    const rls = await fetchRls(context, target);
    return {
      toolName: "db_rls",
      table: target.table,
      schema: target.schema,
      rlsEnabled: rls.rlsEnabled,
      forceRls: rls.forceRls,
      policies: rls.policies,
    };
  });
}

export async function dbRpcTool(
  input: DbRpcToolInput,
  options: ToolServiceOptions = {},
): Promise<DbRpcToolOutput> {
  if (input.list) {
    if (input.name || input.argTypes || input.includeSource) {
      throw new MakoToolError(400, "invalid_tool_input", "Tool input validation failed. In db_rpc list mode, omit name, argTypes, and includeSource.", {
        issues: [
          {
            path: "list",
            message: "When list is true, db_rpc enumerates routines and does not accept lookup-only fields.",
          },
        ],
      });
    }
    return withDbContext(input, options, async (context) => {
      const listed = await fetchRpcs(context, {
        schema: input.schema,
        limit: input.limit,
        includeSystemSchemas: input.includeSystemSchemas,
      });
      return {
        toolName: "db_rpc",
        mode: "list",
        ...(input.schema ? { schema: input.schema } : {}),
        rpcs: listed.rpcs,
        totalReturned: listed.rpcs.length,
        truncated: listed.truncated,
        limit: listed.limit,
      };
    });
  }

  if (!input.name) {
    throw new MakoToolError(400, "invalid_tool_input", "Tool input validation failed. Provide name for db_rpc lookup, or pass list: true to enumerate RPCs.", {
      issues: [
        {
          path: "name",
          message: "Required unless list is true.",
        },
      ],
      expectedKeys: ["projectId", "projectRef", "name", "schema", "argTypes", "includeSource", "list", "limit", "includeSystemSchemas"],
    });
  }

  const rpcName = input.name;
  return withDbContext(input, options, async (context) => {
    const target = await resolveFunctionOrThrow(context, rpcName, input.schema, input.argTypes);
    const rpc = await fetchRpc(context, target, { includeSource: input.includeSource });
    return {
      toolName: "db_rpc",
      mode: "lookup",
      name: target.name,
      schema: target.schema,
      args: rpc.args,
      returns: rpc.returns,
      language: rpc.language,
      securityDefiner: rpc.securityDefiner,
      volatility: rpc.volatility,
      source: rpc.source,
    };
  });
}

export async function dbTableSchemaTool(
  input: DbTableSchemaToolInput,
  options: ToolServiceOptions = {},
): Promise<DbTableSchemaToolOutput> {
  return withDbContext(input, options, async (context) => {
    const target = await resolveTableOrThrow(context, input.table, input.schema);
    const schema = await fetchTableSchema(context, target);
    return {
      toolName: "db_table_schema",
      table: target.table,
      schema: target.schema,
      columns: schema.columns,
      indexes: schema.indexes,
      constraints: schema.constraints,
      foreignKeys: {
        outbound: schema.foreignKeys.outbound,
        inbound: schema.foreignKeys.inbound,
      },
      rls: {
        rlsEnabled: schema.rls.rlsEnabled,
        forceRls: schema.rls.forceRls,
        policies: schema.rls.policies,
      },
      triggers: schema.triggers,
    };
  });
}
