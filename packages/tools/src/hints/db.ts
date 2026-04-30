import type {
  DbColumnsToolOutput,
  DbFkToolOutput,
  DbRlsToolOutput,
  DbTableSchemaToolOutput,
} from "@mako-ai/contracts";

function tableRef(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function dbColumnsHints(output: DbColumnsToolOutput): string[] {
  const columns = Array.isArray(output.columns) ? output.columns.length : 0;
  if (columns === 0) {
    return [
      `${tableRef(output.schema, output.table)} has no columns indexed — verify the schema/name or call db_table_schema for a fuller probe.`,
    ];
  }
  return [];
}

export function dbFkHints(output: DbFkToolOutput): string[] {
  const inbound = Array.isArray(output.inbound) ? output.inbound.length : 0;
  const outbound = Array.isArray(output.outbound) ? output.outbound.length : 0;
  if (inbound === 0 && outbound === 0) {
    return [
      `${tableRef(output.schema, output.table)} has no foreign keys — confirm relationships are intentionally absent before treating it as standalone.`,
    ];
  }
  return [];
}

export function dbRlsHints(output: DbRlsToolOutput): string[] {
  const hints: string[] = [];
  if (!output.rlsEnabled) {
    hints.push(
      `RLS is not enabled on ${tableRef(output.schema, output.table)} — run tenant_leak_audit if multi-tenant data is stored here.`,
    );
    return hints;
  }
  const policies = Array.isArray(output.policies) ? output.policies.length : 0;
  if (policies === 0) {
    hints.push(
      `RLS is enabled on ${tableRef(output.schema, output.table)} with no policies — all access will be denied.`,
    );
  }
  return hints;
}

export function dbTableSchemaHints(output: DbTableSchemaToolOutput): string[] {
  const hints: string[] = [];
  if (output.rls && output.rls.rlsEnabled === false) {
    hints.push(
      `RLS is not enabled on ${tableRef(output.schema, output.table)} — run tenant_leak_audit if multi-tenant data is stored here.`,
    );
  }
  const inbound = output.foreignKeys && Array.isArray(output.foreignKeys.inbound)
    ? output.foreignKeys.inbound.length
    : 0;
  const outbound = output.foreignKeys && Array.isArray(output.foreignKeys.outbound)
    ? output.foreignKeys.outbound.length
    : 0;
  if (inbound === 0 && outbound === 0) {
    hints.push(
      `${tableRef(output.schema, output.table)} has no foreign keys — confirm the table is intentionally standalone.`,
    );
  }
  return hints;
}
