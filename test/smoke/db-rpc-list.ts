import assert from "node:assert/strict";
import {
  DbRpcToolInputSchema,
  DbRpcToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { fetchRpcs, type PgReadContext } from "../../extensions/postgres/src/index.ts";

function result(rows: Array<Record<string, unknown>>): Awaited<ReturnType<PgReadContext["query"]>> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

async function main(): Promise<void> {
  assert.equal(DbRpcToolInputSchema.parse({ projectId: "proj", name: "search_users" }).name, "search_users");
  assert.equal(DbRpcToolInputSchema.parse({ projectId: "proj", list: true, limit: 5 }).list, true);

  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const context = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return result([
        {
          schema_name: "public",
          rpc_name: "search_users",
          kind: "function",
          arg_names: ["needle"],
          arg_types: ["text"],
          input_arg_types: ["text"],
          arg_modes: ["i"],
          returns: "SETOF users",
          language: "sql",
          security_definer: false,
          volatility: "s",
        },
        {
          schema_name: "ops",
          rpc_name: "refresh_cache",
          kind: "procedure",
          arg_names: [],
          arg_types: [],
          input_arg_types: [],
          arg_modes: [],
          returns: "procedure",
          language: "plpgsql",
          security_definer: true,
          volatility: "v",
        },
      ]);
    },
  } as unknown as PgReadContext;

  const listed = await fetchRpcs(context, { limit: 1 });
  assert.equal(calls[0]?.values?.[0], null);
  assert.equal(calls[0]?.values?.[1], false);
  assert.equal(calls[0]?.values?.[2], 2);
  assert.equal(listed.limit, 1);
  assert.equal(listed.truncated, true);
  assert.equal(listed.rpcs.length, 1);
  assert.equal(listed.rpcs[0]?.schema, "public");
  assert.equal(listed.rpcs[0]?.name, "search_users");
  assert.equal(listed.rpcs[0]?.kind, "function");
  assert.deepEqual(listed.rpcs[0]?.argTypes, ["text"]);
  assert.equal(listed.rpcs[0]?.args[0]?.mode, "in");
  assert.equal(listed.rpcs[0]?.volatility, "stable");

  DbRpcToolOutputSchema.parse({
    toolName: "db_rpc",
    mode: "list",
    rpcs: listed.rpcs,
    totalReturned: listed.rpcs.length,
    truncated: listed.truncated,
    limit: listed.limit,
  });
  DbRpcToolOutputSchema.parse({
    toolName: "db_rpc",
    name: "search_users",
    schema: "public",
    args: [],
    returns: "SETOF users",
    language: "sql",
    securityDefiner: false,
    volatility: "stable",
    source: null,
  });

  console.log("db-rpc-list: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
