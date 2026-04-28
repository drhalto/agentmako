import { DatabaseSync } from "node:sqlite";
import type { SchemaIR, SchemaTable } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import {
  type SchemaObjectRow,
  type SchemaUsageRow,
  buildSchemaObjectIdentifiers,
  escapeLikePattern,
  extractSearchTokens,
  mapSchemaObjectRow,
  mapSchemaUsageRow,
  normalizeSearchText,
} from "./project-store-query-helpers.js";
import type {
  ResolvedSchemaObjectRecord,
  SchemaObjectDetail,
  SchemaUsageMatch,
} from "./types.js";

export interface SchemaBodyHit {
  objectType: "rpc" | "trigger";
  schemaName: string;
  objectName: string;
  tableName?: string;
  rpcKind?: "function" | "procedure";
  argTypes?: string[];
  bodyText: string;
}

export function searchSchemaBodiesImpl(
  db: DatabaseSync,
  term: string,
  limit = 20,
): SchemaBodyHit[] {
  const normalized = term.trim();
  if (normalized === "") return [];
  const normalizedLower = normalized.toLowerCase();
  const needle = `%${escapeLikePattern(normalizedLower)}%`;
  const expandedLimit = Math.max(limit * 5, limit);

  const rpcRows = db
    .prepare(`
      SELECT schema_name, rpc_name, rpc_kind, arg_types_json, body_text
      FROM schema_snapshot_rpcs
      WHERE snapshot_slot = 1
        AND body_text IS NOT NULL
        AND (
          LOWER(rpc_name) LIKE ? ESCAPE '\\'
          OR LOWER(body_text) LIKE ? ESCAPE '\\'
        )
      LIMIT ?
    `)
    .all(needle, needle, expandedLimit) as Array<{
    schema_name: string;
    rpc_name: string;
    rpc_kind: "function" | "procedure";
    arg_types_json: string;
    body_text: string;
  }>;

  const triggerRows = db
    .prepare(`
      SELECT schema_name, table_name, trigger_name, body_text
      FROM schema_snapshot_triggers
      WHERE snapshot_slot = 1
        AND body_text IS NOT NULL
        AND (
          LOWER(trigger_name) LIKE ? ESCAPE '\\'
          OR LOWER(table_name) LIKE ? ESCAPE '\\'
          OR LOWER(body_text) LIKE ? ESCAPE '\\'
        )
      LIMIT ?
    `)
    .all(needle, needle, needle, expandedLimit) as Array<{
    schema_name: string;
    table_name: string;
    trigger_name: string;
    body_text: string;
  }>;

  const out: Array<SchemaBodyHit & { score: number }> = [];
  for (const r of rpcRows) {
    const rpcNameLower = r.rpc_name.toLowerCase();
    const bodyLower = r.body_text.toLowerCase();
    let score = 0;
    if (rpcNameLower === normalizedLower) score += 400;
    else if (rpcNameLower.includes(normalizedLower)) score += 220;
    if (bodyLower.includes(normalizedLower)) score += 100;
    out.push({
      objectType: "rpc",
      schemaName: r.schema_name,
      objectName: r.rpc_name,
      rpcKind: r.rpc_kind,
      argTypes: parseJson<string[]>(r.arg_types_json, []),
      bodyText: r.body_text,
      score,
    });
  }
  for (const r of triggerRows) {
    const triggerNameLower = r.trigger_name.toLowerCase();
    const tableNameLower = r.table_name.toLowerCase();
    const bodyLower = r.body_text.toLowerCase();
    let score = 0;
    if (triggerNameLower === normalizedLower) score += 400;
    else if (triggerNameLower.includes(normalizedLower)) score += 220;
    if (tableNameLower === normalizedLower) score += 320;
    else if (tableNameLower.includes(normalizedLower)) score += 180;
    if (bodyLower.includes(normalizedLower)) score += 100;
    out.push({
      objectType: "trigger",
      schemaName: r.schema_name,
      objectName: r.trigger_name,
      tableName: r.table_name,
      bodyText: r.body_text,
      score,
    });
  }
  return out
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.objectType !== right.objectType) {
        return left.objectType.localeCompare(right.objectType);
      }
      if (left.schemaName !== right.schemaName) {
        return left.schemaName.localeCompare(right.schemaName);
      }
      return left.objectName.localeCompare(right.objectName);
    })
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}

export interface FunctionTableRef {
  rpcSchema: string;
  rpcName: string;
  rpcKind: "function" | "procedure";
  argTypes: string[];
  targetSchema: string;
  targetTable: string;
}

export function listFunctionTableRefsImpl(
  db: DatabaseSync,
  filter: {
    rpcSchema?: string;
    rpcName?: string;
    rpcKind?: "function" | "procedure";
    argTypes?: string[];
    targetSchema?: string;
    tableName?: string;
  } = {},
): FunctionTableRef[] {
  const clauses: string[] = ["snapshot_slot = 1"];
  const params: string[] = [];
  if (filter.rpcSchema) {
    clauses.push("rpc_schema = ?");
    params.push(filter.rpcSchema);
  }
  if (filter.rpcName) {
    clauses.push("rpc_name = ?");
    params.push(filter.rpcName);
  }
  if (filter.rpcKind) {
    clauses.push("rpc_kind = ?");
    params.push(filter.rpcKind);
  }
  if (filter.argTypes) {
    clauses.push("arg_types_json = ?");
    params.push(stringifyJson(filter.argTypes));
  }
  if (filter.targetSchema) {
    clauses.push("target_schema = ?");
    params.push(filter.targetSchema);
  }
  if (filter.tableName) {
    clauses.push("target_table = ?");
    params.push(filter.tableName);
  }

  const rows = db
    .prepare(`
      SELECT rpc_schema, rpc_name, rpc_kind, arg_types_json, target_schema, target_table
      FROM schema_snapshot_function_refs
      WHERE ${clauses.join(" AND ")}
    `)
    .all(...params) as Array<{
    rpc_schema: string;
    rpc_name: string;
    rpc_kind: "function" | "procedure";
    arg_types_json: string;
    target_schema: string;
    target_table: string;
  }>;

  return rows
    .map((row) => ({
      rpcSchema: row.rpc_schema,
      rpcName: row.rpc_name,
      rpcKind: row.rpc_kind,
      argTypes: parseJson<string[]>(row.arg_types_json, []),
      targetSchema: row.target_schema,
      targetTable: row.target_table,
    }))
    .sort((left, right) => {
      if (left.rpcSchema !== right.rpcSchema) {
        return left.rpcSchema.localeCompare(right.rpcSchema);
      }
      if (left.rpcName !== right.rpcName) {
        return left.rpcName.localeCompare(right.rpcName);
      }
      if (left.rpcKind !== right.rpcKind) {
        return left.rpcKind.localeCompare(right.rpcKind);
      }
      const leftArgs = stringifyJson(left.argTypes);
      const rightArgs = stringifyJson(right.argTypes);
      if (leftArgs !== rightArgs) {
        return leftArgs.localeCompare(rightArgs);
      }
      if (left.targetSchema !== right.targetSchema) {
        return left.targetSchema.localeCompare(right.targetSchema);
      }
      return left.targetTable.localeCompare(right.targetTable);
    });
}

export function getSchemaTableSnapshotImpl(
  db: DatabaseSync,
  schemaName: string,
  tableName: string,
): SchemaTable | null {
  const row = db
    .prepare(`
      SELECT ir_json
      FROM schema_snapshots
      WHERE snapshot_slot = 1
    `)
    .get() as { ir_json: string | null } | undefined;

  if (!row?.ir_json) {
    return null;
  }

  const ir = parseJson<SchemaIR>(row.ir_json, { version: "1.0.0", schemas: {} });
  const namespace = ir.schemas[schemaName];
  if (!namespace) {
    return null;
  }
  return namespace.tables.find((table) => table.name === tableName) ?? null;
}

export function searchSchemaObjectsImpl(
  db: DatabaseSync,
  queryText: string,
  limit = 5,
): ResolvedSchemaObjectRecord[] {
  const normalized = queryText.trim().toLowerCase();
  if (normalized === "") {
    return [];
  }

  const searchTokens = extractSearchTokens(normalized);
  const rows = db
    .prepare(`
      SELECT
        object_id,
        object_type,
        schema_name,
        object_name,
        parent_object_name,
        data_type,
        definition_json
      FROM schema_objects
    `)
    .all() as unknown as SchemaObjectRow[];

  return rows
    .map((row) => {
      const object = mapSchemaObjectRow(row);
      const identifiers = buildSchemaObjectIdentifiers(object);
      const haystack = identifiers.join(" ");
      let score = 0;

      if (identifiers.includes(normalized)) {
        score += 100;
      }

      if (object.objectName.toLowerCase() === normalized) {
        score += 90;
      }

      if (haystack.includes(normalized)) {
        score += 60;
      }

      const matchedTokens = searchTokens.filter((token) => haystack.includes(token));
      if (searchTokens.length > 1 && matchedTokens.length < searchTokens.length) {
        return { object, score: 0 };
      }

      score += matchedTokens.length * 10;

      if (searchTokens.length > 1 && matchedTokens.length === searchTokens.length) {
        score += 20;
      }

      return { object, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.object.schemaName !== right.object.schemaName) {
        return left.object.schemaName.localeCompare(right.object.schemaName);
      }

      if ((left.object.parentObjectName ?? "") !== (right.object.parentObjectName ?? "")) {
        return (left.object.parentObjectName ?? "").localeCompare(right.object.parentObjectName ?? "");
      }

      if (left.object.objectName !== right.object.objectName) {
        return left.object.objectName.localeCompare(right.object.objectName);
      }

      return left.object.objectType.localeCompare(right.object.objectType);
    })
    .slice(0, limit)
    .map((item) => item.object);
}

export function listSchemaObjectsImpl(db: DatabaseSync): ResolvedSchemaObjectRecord[] {
  const rows = db
    .prepare(`
      SELECT
        object_id,
        object_type,
        schema_name,
        object_name,
        parent_object_name,
        data_type,
        definition_json
      FROM schema_objects
      ORDER BY schema_name ASC, COALESCE(parent_object_name, '') ASC, object_name ASC, object_type ASC
    `)
    .all() as unknown as SchemaObjectRow[];

  return rows.map(mapSchemaObjectRow);
}

export function listSchemaUsagesImpl(db: DatabaseSync, objectId: number): SchemaUsageMatch[] {
  const rows = db
    .prepare(`
      SELECT
        f.path AS file_path,
        su.usage_kind,
        su.line,
        su.excerpt
      FROM schema_usages su
      INNER JOIN files f ON f.file_id = su.file_id
      WHERE su.schema_object_id = ?
      ORDER BY
        CASE su.usage_kind
          WHEN 'definition' THEN 0
          ELSE 1
        END,
        f.path ASC,
        COALESCE(su.line, 0) ASC
    `)
    .all(objectId) as unknown as SchemaUsageRow[];

  return rows.map(mapSchemaUsageRow);
}

export function getSchemaObjectDetailImpl(db: DatabaseSync, queryText: string): SchemaObjectDetail | null {
  const normalized = queryText.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  const object = listSchemaObjectsImpl(db).find((candidate) =>
    buildSchemaObjectIdentifiers(candidate).includes(normalized),
  );
  if (!object) {
    return null;
  }

  return {
    object,
    usages: listSchemaUsagesImpl(db, object.objectId),
  };
}
