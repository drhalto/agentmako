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
  fetchTableSchema,
} from "@mako-ai/extension-postgres";
import type { ToolServiceOptions } from "../runtime.js";
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
  return withDbContext(input, options, async (context) => {
    const target = await resolveFunctionOrThrow(context, input.name, input.schema, input.argTypes);
    const rpc = await fetchRpc(context, target, { includeSource: input.includeSource });
    return {
      toolName: "db_rpc",
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
