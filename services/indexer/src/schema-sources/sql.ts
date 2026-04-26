import type {
  SchemaColumn,
  SchemaForeignKeyInbound,
  SchemaForeignKeyOutbound,
  SchemaIR,
  SchemaIndex,
  SchemaNamespace,
  SchemaRpc,
  SchemaRlsPolicy,
  SchemaSourceRef,
  SchemaTable,
  SchemaTrigger,
} from "@mako-ai/contracts";
import type { SchemaObjectRecord } from "@mako-ai/store";
import { extractPgObjectsFromSql, splitStatements } from "../extract-pg-functions.js";
import { extractSchemaObjectsFromSql } from "../schema-scan.js";
import type { SchemaInventoryEntry } from "./inventory.js";

function emptyNamespace(): SchemaNamespace {
  return { tables: [], views: [], enums: [], rpcs: [] };
}

function ensureNamespace(ir: SchemaIR, schemaName: string): SchemaNamespace {
  let namespace = ir.schemas[schemaName];
  if (!namespace) {
    namespace = emptyNamespace();
    ir.schemas[schemaName] = namespace;
  }
  return namespace;
}

function getDefinitionLine(definition: unknown): number | undefined {
  if (definition != null && typeof definition === "object" && "line" in definition) {
    const line = (definition as { line?: unknown }).line;
    return typeof line === "number" ? line : undefined;
  }
  return undefined;
}

function getStatementExcerpt(definition: unknown): string {
  if (definition != null && typeof definition === "object" && "statementExcerpt" in definition) {
    const excerpt = (definition as { statementExcerpt?: unknown }).statementExcerpt;
    if (typeof excerpt === "string") {
      return excerpt;
    }
  }
  return "";
}

function getEnumValues(definition: unknown): string[] {
  if (definition != null && typeof definition === "object" && "values" in definition) {
    const values = (definition as { values?: unknown }).values;
    if (Array.isArray(values)) {
      return values.filter((value): value is string => typeof value === "string");
    }
  }
  return [];
}

function inferNullableFromExcerpt(excerpt: string): boolean {
  return !/\bnot\s+null\b/i.test(excerpt);
}

function inferPrimaryKeyFromExcerpt(excerpt: string): boolean {
  return /\bprimary\s+key\b/i.test(excerpt);
}

function makeSourceRef(
  entry: SchemaInventoryEntry,
  record: SchemaObjectRecord,
): SchemaSourceRef {
  const line = getDefinitionLine(record.definition);
  return {
    kind: entry.kind,
    path: entry.relativePath,
    ...(line != null ? { line } : {}),
  };
}

function stripIdentifierQuoting(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeSqlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitTopLevelSqlList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
      } else if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed !== "") out.push(trimmed);
        current = "";
        continue;
      }
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed !== "") out.push(trimmed);
  return out;
}

function parseIdentifierList(value: string): string[] {
  return splitTopLevelSqlList(value)
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map((item) => {
      const bareIdentifier = item.match(/^(".*?"|[A-Za-z_][A-Za-z0-9_$]*)/);
      return stripIdentifierQuoting(bareIdentifier?.[1] ?? item);
    });
}

function extractParenthesizedClause(
  sql: string,
  clausePattern: RegExp,
): string | null {
  const match = clausePattern.exec(sql);
  if (!match) return null;
  let index = match.index + match[0].length;
  while (index < sql.length && /\s/.test(sql[index]!)) index += 1;
  if (sql[index] !== "(") return null;
  let depth = 0;
  let current = "";
  for (let i = index; i < sql.length; i += 1) {
    const char = sql[i]!;
    if (char === "(") {
      depth += 1;
      if (depth > 1) current += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return current.trim();
      }
      current += char;
      continue;
    }
    current += char;
  }
  return null;
}

function ensureOutboundForeignKeys(table: SchemaTable): SchemaForeignKeyOutbound[] {
  if (!table.foreignKeys) {
    table.foreignKeys = { outbound: [], inbound: [] };
  }
  return table.foreignKeys.outbound;
}

function ensureRlsState(table: SchemaTable): NonNullable<SchemaTable["rls"]> {
  if (!table.rls) {
    table.rls = { rlsEnabled: false, forceRls: false, policies: [] };
  }
  return table.rls;
}

function addIndex(table: SchemaTable, index: SchemaIndex): void {
  if (!table.indexes) table.indexes = [];
  if (!table.indexes.some((existing) => existing.name === index.name)) {
    table.indexes.push(index);
  }
}

function addRlsPolicy(table: SchemaTable, policy: SchemaRlsPolicy): void {
  const rls = ensureRlsState(table);
  if (!rls.policies.some((existing) => existing.name === policy.name)) {
    rls.policies.push(policy);
  }
}

function addTrigger(table: SchemaTable, trigger: SchemaTrigger): void {
  if (!table.triggers) table.triggers = [];
  const existing = table.triggers.find((candidate) => candidate.name === trigger.name);
  if (existing) {
    existing.enabled = trigger.enabled;
    existing.enabledMode = trigger.enabledMode;
    existing.timing = trigger.timing;
    existing.events = [...trigger.events];
    if (trigger.bodyText != null) {
      existing.bodyText = trigger.bodyText;
    }
    return;
  }
  table.triggers.push(trigger);
}

function sameRpcSignature(
  rpc: SchemaRpc,
  candidate: { name: string; schema: string; argTypes: string[]; returnType: string | null; line: number },
): boolean {
  const sameName = rpc.name === candidate.name && rpc.schema === candidate.schema;
  if (!sameName) return false;
  const sameArgs = JSON.stringify(rpc.argTypes ?? []) === JSON.stringify(candidate.argTypes);
  if (sameArgs) {
    if (rpc.returnType == null || candidate.returnType == null) {
      return true;
    }
    if (rpc.returnType === candidate.returnType) {
      return true;
    }
  }
  return rpc.sources?.[0]?.line === candidate.line;
}

function populateInboundForeignKeys(tableIndex: Map<string, SchemaTable>): void {
  for (const [sourceKey, table] of tableIndex) {
    const [sourceSchema, sourceTable] = sourceKey.split(".");
    for (const outbound of table.foreignKeys?.outbound ?? []) {
      const target = tableIndex.get(`${outbound.targetSchema}.${outbound.targetTable}`);
      if (!target) continue;
      if (!target.foreignKeys) {
        target.foreignKeys = { outbound: [], inbound: [] };
      }
      const inbound: SchemaForeignKeyInbound = {
        constraintName: outbound.constraintName,
        sourceSchema: sourceSchema!,
        sourceTable: sourceTable!,
        sourceColumns: [...outbound.columns],
        columns: [...outbound.targetColumns],
        onUpdate: outbound.onUpdate,
        onDelete: outbound.onDelete,
      };
      if (
        !target.foreignKeys.inbound.some(
          (existing) =>
            existing.constraintName === inbound.constraintName &&
            existing.sourceSchema === inbound.sourceSchema &&
            existing.sourceTable === inbound.sourceTable,
        )
      ) {
        target.foreignKeys.inbound.push(inbound);
      }
    }
  }
}

export async function parseSqlSchemaSource(entry: SchemaInventoryEntry): Promise<SchemaIR> {
  const records = await extractSchemaObjectsFromSql(entry.relativePath, entry.content);
  const ir: SchemaIR = { version: "1.0.0", schemas: {} };
  const tableIndex = new Map<string, SchemaTable>();

  for (const record of records) {
    const sourceRef = makeSourceRef(entry, record);
    const namespace = ensureNamespace(ir, record.schemaName);

    switch (record.objectType) {
      case "table": {
        const table: SchemaTable = {
          name: record.objectName,
          schema: record.schemaName,
          columns: [],
          sources: [sourceRef],
        };
        namespace.tables.push(table);
        tableIndex.set(`${record.schemaName}.${record.objectName}`, table);
        break;
      }
      case "view": {
        namespace.views.push({
          name: record.objectName,
          schema: record.schemaName,
          sources: [sourceRef],
        });
        break;
      }
      case "enum": {
        namespace.enums.push({
          name: record.objectName,
          schema: record.schemaName,
          values: getEnumValues(record.definition),
          sources: [sourceRef],
        });
        break;
      }
      case "rpc": {
        namespace.rpcs.push({
          name: record.objectName,
          schema: record.schemaName,
          sources: [sourceRef],
        });
        break;
      }
      default:
        break;
    }
  }

  for (const record of records) {
    if (record.objectType !== "column" || !record.parentObjectName) {
      continue;
    }

    const table = tableIndex.get(`${record.schemaName}.${record.parentObjectName}`);
    if (!table) {
      continue;
    }

    const excerpt = getStatementExcerpt(record.definition);
    const isPrimaryKey = inferPrimaryKeyFromExcerpt(excerpt);
    const column: SchemaColumn = {
      name: record.objectName,
      dataType: record.dataType ?? "unknown",
      nullable: !isPrimaryKey && inferNullableFromExcerpt(excerpt),
      sources: [makeSourceRef(entry, record)],
    };

    if (isPrimaryKey) {
      column.isPrimaryKey = true;
    }

    table.columns.push(column);
  }

  const CREATE_INDEX =
    /^\s*CREATE\s+(?<unique>UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:(?<indexSchema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<indexName>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:ONLY\s+)?(?:(?<tableSchema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<tableName>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*(?:USING\s+[A-Za-z_][A-Za-z0-9_$]*\s*)?\((?<columns>[\s\S]*?)\)/i;

  const ALTER_TABLE =
    /^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?(?:(?<schema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+(?<clauses>[\s\S]*)$/i;

  const ALTER_TABLE_FOREIGN_KEY =
    /^ADD\s+(?:CONSTRAINT\s+(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+)?FOREIGN\s+KEY\s*\((?<columns>[\s\S]*?)\)\s+REFERENCES\s+(?:(?<targetSchema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<targetTable>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*(?:\((?<targetColumns>[\s\S]*?)\))?(?<tail>[\s\S]*)$/i;

  const CREATE_POLICY =
    /^\s*CREATE\s+POLICY\s+(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:(?<schema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<table>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?<tail>[\s\S]*)$/i;

  for (const stmt of splitStatements(entry.content)) {
    const indexMatch = CREATE_INDEX.exec(stmt.text);
    if (indexMatch?.groups) {
      const tableSchema = stripIdentifierQuoting(indexMatch.groups.tableSchema ?? "public");
      const tableName = stripIdentifierQuoting(indexMatch.groups.tableName);
      const table = tableIndex.get(`${tableSchema}.${tableName}`);
      if (table) {
        addIndex(table, {
          name: stripIdentifierQuoting(indexMatch.groups.indexName),
          unique: indexMatch.groups.unique != null,
          primary: false,
          columns: parseIdentifierList(indexMatch.groups.columns),
          definition: normalizeSqlText(stmt.text),
        });
      }
      continue;
    }

    const alterMatch = ALTER_TABLE.exec(stmt.text);
    if (alterMatch?.groups) {
      const schemaName = stripIdentifierQuoting(alterMatch.groups.schema ?? "public");
      const tableName = stripIdentifierQuoting(alterMatch.groups.name);
      const table = tableIndex.get(`${schemaName}.${tableName}`);
      if (!table) continue;
      for (const clause of splitTopLevelSqlList(alterMatch.groups.clauses)) {
        const normalizedClause = clause.replace(/;+\s*$/, "").trim();
        const fkMatch = ALTER_TABLE_FOREIGN_KEY.exec(normalizedClause);
        if (fkMatch?.groups) {
          const tail = fkMatch.groups.tail ?? "";
          const onUpdate =
            tail.match(/\bON\s+UPDATE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
              ?.replace(/\s+/g, " ")
              .toUpperCase() ?? "NO ACTION";
          const onDelete =
            tail.match(/\bON\s+DELETE\s+(RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
              ?.replace(/\s+/g, " ")
              .toUpperCase() ?? "NO ACTION";
          ensureOutboundForeignKeys(table).push({
            constraintName: stripIdentifierQuoting(
              fkMatch.groups.name ?? `${table.name}_${parseIdentifierList(fkMatch.groups.columns).join("_")}_fkey`,
            ),
            columns: parseIdentifierList(fkMatch.groups.columns),
            targetSchema: stripIdentifierQuoting(fkMatch.groups.targetSchema ?? "public"),
            targetTable: stripIdentifierQuoting(fkMatch.groups.targetTable),
            targetColumns:
              fkMatch.groups.targetColumns != null
                ? parseIdentifierList(fkMatch.groups.targetColumns)
                : [],
            onUpdate,
            onDelete,
          });
          continue;
        }

        if (/^ENABLE\s+ROW\s+LEVEL\s+SECURITY$/i.test(normalizedClause)) {
          ensureRlsState(table).rlsEnabled = true;
          continue;
        }
        if (/^DISABLE\s+ROW\s+LEVEL\s+SECURITY$/i.test(normalizedClause)) {
          ensureRlsState(table).rlsEnabled = false;
          continue;
        }
        if (/^FORCE\s+ROW\s+LEVEL\s+SECURITY$/i.test(normalizedClause)) {
          ensureRlsState(table).forceRls = true;
          continue;
        }
        if (/^NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY$/i.test(normalizedClause)) {
          ensureRlsState(table).forceRls = false;
        }
      }
      continue;
    }

    const policyMatch = CREATE_POLICY.exec(stmt.text);
    if (policyMatch?.groups) {
      const schemaName = stripIdentifierQuoting(policyMatch.groups.schema ?? "public");
      const tableName = stripIdentifierQuoting(policyMatch.groups.table);
      const table = tableIndex.get(`${schemaName}.${tableName}`);
      if (!table) continue;
      const tail = policyMatch.groups.tail ?? "";
      const rolesMatch = tail.match(/\bTO\s+([\s\S]*?)(?=\s+(?:USING|WITH\s+CHECK)\b|$)/i);
      addRlsPolicy(table, {
        name: stripIdentifierQuoting(policyMatch.groups.name),
        mode: tail.match(/\bAS\s+(RESTRICTIVE)\b/i) ? "RESTRICTIVE" : "PERMISSIVE",
        command:
          tail.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase() ?? "ALL",
        roles:
          rolesMatch?.[1] != null
            ? parseIdentifierList(rolesMatch[1])
            : ["public"],
        usingExpression: extractParenthesizedClause(tail, /\bUSING\b/i),
        withCheckExpression: extractParenthesizedClause(tail, /\bWITH\s+CHECK\b/i),
      });
    }
  }

  // Phase 3.6.0 Workstream C: augment RPCs + triggers with body text from the
  // dollar-quote-aware extractor. Structural columns already populate above;
  // this pass adds the `bodyText` field that composers key off.
  const pgObjects = extractPgObjectsFromSql(entry.relativePath, entry.content);
  for (const obj of pgObjects) {
    const namespace = ensureNamespace(ir, obj.schema);
    if (obj.kind === "function") {
      const existing = namespace.rpcs.find(
        (rpc) => sameRpcSignature(rpc, obj),
      );
      if (existing) {
        existing.argTypes = [...obj.argTypes];
        if (obj.objectKind === "procedure") {
          existing.returnType = "procedure";
        } else if (obj.returnType != null) {
          existing.returnType = obj.returnType;
        }
        existing.bodyText = obj.bodyText;
      } else {
        namespace.rpcs.push({
          name: obj.name,
          schema: obj.schema,
          argTypes: [...obj.argTypes],
          returnType: obj.objectKind === "procedure" ? "procedure" : (obj.returnType ?? undefined),
          bodyText: obj.bodyText,
          sources: [
            {
              kind: entry.kind,
              path: entry.relativePath,
              line: obj.line,
            },
          ],
        });
      }
      continue;
    }
    // Trigger: attach as a SchemaTrigger on the target table if we recognize it.
    if (!obj.table) continue;
    const table = tableIndex.get(`${obj.schema}.${obj.table}`);
    if (!table) continue;
    addTrigger(table, {
      name: obj.name,
      enabled: true,
      enabledMode: "O",
      timing: obj.timing,
      events: [...obj.events],
      bodyText: obj.bodyText,
    });
  }

  populateInboundForeignKeys(tableIndex);

  return ir;
}
