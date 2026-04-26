/**
 * Evidence-block producers — Layer 2 of the composer stack.
 *
 * One producer per `EvidenceBlock.kind`. Composers pass raw snapshot rows
 * through these to get properly shaped evidence blocks. Titles, sourceRefs,
 * and content formatting live here (not in composers), so every composer
 * that emits "code callers" or "imports" gets identical rendering.
 *
 * These functions are pure — no I/O, no logging, no store access.
 */

import type {
  EvidenceBlock,
  JsonObject,
  JsonValue,
  SchemaColumn,
  SchemaForeignKeyInbound,
  SchemaForeignKeyOutbound,
  SchemaIndex,
  SchemaRlsState,
  SchemaTrigger,
} from "@mako-ai/contracts";
import type {
  CodeChunkHit,
  FileImportLink,
  FileSearchMatch,
  FunctionTableRef,
  HarnessMemoryRecord,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SchemaBodyHit,
  SymbolRecord,
} from "@mako-ai/store";
import { createId } from "@mako-ai/store";
import type { AstHit } from "../../code-intel/ast-patterns.js";

function nextId(): string {
  return createId("ev");
}

function compact(meta: Record<string, JsonValue | undefined>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function blocksFromImports(
  edges: FileImportLink[],
  direction: "outbound" | "inbound",
): EvidenceBlock[] {
  return edges.map((edge) => ({
    blockId: nextId(),
    kind: "file",
    title:
      direction === "outbound"
        ? `imports ${edge.targetPath}`
        : `imported by ${edge.sourcePath}`,
    sourceRef: direction === "outbound" ? edge.targetPath : edge.sourcePath,
    filePath: direction === "outbound" ? edge.sourcePath : edge.targetPath,
    line: edge.line,
    content: edge.specifier,
    stale: !edge.targetExists,
    metadata: compact({
      importKind: edge.importKind,
      isTypeOnly: edge.isTypeOnly,
      targetExists: edge.targetExists,
    }),
  }));
}

export function blocksFromSymbols(
  symbols: SymbolRecord[],
  filePath: string,
): EvidenceBlock[] {
  return symbols.map((symbol) => ({
    blockId: nextId(),
    kind: "symbol",
    title: `${symbol.kind} ${symbol.name}`,
    sourceRef: `${filePath}:${symbol.lineStart ?? 0}`,
    filePath,
    line: symbol.lineStart,
    content: symbol.signatureText ?? symbol.name,
    metadata: compact({
      exportName: symbol.exportName,
      lineEnd: symbol.lineEnd,
    }),
  }));
}

export function blocksFromRoutes(
  routes: ResolvedRouteRecord[],
): EvidenceBlock[] {
  return routes.map((route) => ({
    blockId: nextId(),
    kind: "route",
    title: route.handlerName
      ? `${route.pattern} → ${route.handlerName}`
      : route.pattern,
    sourceRef: route.routeKey,
    filePath: route.filePath,
    content: `${route.method ?? "ANY"} ${route.pattern}`,
    metadata: compact({
      framework: route.framework,
      isApi: route.isApi,
    }),
  }));
}

export function blocksFromSchemaObjects(
  objects: ResolvedSchemaObjectRecord[],
): EvidenceBlock[] {
  return objects.map((object) => ({
    blockId: nextId(),
    kind: "schema",
    title: `${object.objectType} ${object.schemaName}.${object.objectName}`,
    sourceRef: `${object.schemaName}.${object.objectName}`,
    content: object.objectName,
    metadata: compact({
      objectType: object.objectType,
      parentObjectName: object.parentObjectName,
      dataType: object.dataType,
      definition: object.definition,
    }),
  }));
}

export function blocksFromMemories(memos: HarnessMemoryRecord[]): EvidenceBlock[] {
  return memos.map((memo) => ({
    blockId: nextId(),
    kind: "document",
    title: memo.category ?? "memory",
    sourceRef: `memory:${memo.memoryId}`,
    content: memo.text,
    metadata: compact({
      category: memo.category,
      tags: memo.tags,
      createdAt: memo.createdAt,
    }),
  }));
}

export interface FindingInput {
  title: string;
  detail: string;
  sourceRef: string;
  filePath?: string;
  line?: number;
  stale?: boolean;
  metadata?: JsonObject;
}

export function blocksFromFindings(findings: FindingInput[]): EvidenceBlock[] {
  return findings.map((f) => ({
    blockId: nextId(),
    kind: "finding",
    title: f.title,
    sourceRef: f.sourceRef,
    filePath: f.filePath,
    line: f.line,
    content: f.detail,
    stale: f.stale,
    metadata: f.metadata,
  }));
}

export interface FileMatchBlockOptions {
  title?: (hit: FileSearchMatch) => string;
  metadataKind?: string;
}

export function blocksFromFileMatches(
  hits: FileSearchMatch[],
  options: FileMatchBlockOptions = {},
): EvidenceBlock[] {
  return hits.map((hit) => ({
    blockId: nextId(),
    kind: "file",
    title: options.title?.(hit) ?? hit.path,
    sourceRef: hit.path,
    filePath: hit.path,
    content: hit.snippet ?? hit.path,
    metadata: compact({
      kind: options.metadataKind,
      language: hit.language,
      isGenerated: hit.isGenerated,
      indexedAt: hit.indexedAt,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Phase 3.6.1 — schema-IR and retrieval-layer producers.
//
// These consume the richer `SchemaTable` shape exposed by
// `ProjectStore.getSchemaTableSnapshot(...)` and the retrieval-layer hits
// returned by `searchCodeChunks`, `searchSchemaBodies`, `listFunctionTableRefs`,
// and `findAstMatches`. Kept DRY so every composer that emits the same kind of
// evidence runs through the same producer.
// ---------------------------------------------------------------------------

function qualifiedTableRef(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function blocksFromSchemaColumns(
  columns: SchemaColumn[],
  schema: string,
  table: string,
): EvidenceBlock[] {
  return columns.map((column) => ({
    blockId: nextId(),
    kind: "schema",
    title: `column ${table}.${column.name}: ${column.dataType}${column.nullable ? "" : " NOT NULL"}${column.isPrimaryKey ? " PRIMARY KEY" : ""}`,
    sourceRef: `${qualifiedTableRef(schema, table)}.${column.name}`,
    content: column.dataType,
    metadata: compact({
      schemaName: schema,
      tableName: table,
      dataType: column.dataType,
      nullable: column.nullable,
      isPrimaryKey: column.isPrimaryKey ?? false,
      defaultExpression: column.defaultExpression,
    }),
  }));
}

export function blocksFromSchemaIndexes(
  indexes: SchemaIndex[],
  schema: string,
  table: string,
): EvidenceBlock[] {
  return indexes.map((index) => ({
    blockId: nextId(),
    kind: "schema",
    title: `index ${index.name}${index.unique ? " (unique)" : ""}${index.primary ? " (primary)" : ""} on ${table}(${index.columns.join(", ")})`,
    sourceRef: `${qualifiedTableRef(schema, table)}.index.${index.name}`,
    content: index.definition ?? index.columns.join(", "),
    metadata: compact({
      schemaName: schema,
      tableName: table,
      unique: index.unique,
      primary: index.primary,
      columns: index.columns,
    }),
  }));
}

export function blocksFromSchemaForeignKeys(
  outbound: SchemaForeignKeyOutbound[],
  inbound: SchemaForeignKeyInbound[],
  schema: string,
  table: string,
): EvidenceBlock[] {
  const outboundBlocks: EvidenceBlock[] = outbound.map((fk) => ({
    blockId: nextId(),
    kind: "schema",
    title: `FK ${fk.constraintName}: ${table}(${fk.columns.join(", ")}) → ${fk.targetSchema}.${fk.targetTable}(${fk.targetColumns.join(", ")})`,
    sourceRef: `${qualifiedTableRef(schema, table)}.fk.${fk.constraintName}`,
    content: `${fk.columns.join(", ")} → ${fk.targetSchema}.${fk.targetTable}(${fk.targetColumns.join(", ")})`,
    metadata: compact({
      direction: "outbound",
      schemaName: schema,
      tableName: table,
      columns: fk.columns,
      targetSchema: fk.targetSchema,
      targetTable: fk.targetTable,
      targetColumns: fk.targetColumns,
      onUpdate: fk.onUpdate,
      onDelete: fk.onDelete,
    }),
  }));
  const inboundBlocks: EvidenceBlock[] = inbound.map((fk) => ({
    blockId: nextId(),
    kind: "schema",
    title: `FK ${fk.constraintName}: ${fk.sourceSchema}.${fk.sourceTable}(${fk.sourceColumns.join(", ")}) → ${table}(${fk.columns.join(", ")})`,
    sourceRef: `${qualifiedTableRef(schema, table)}.fk-in.${fk.constraintName}`,
    content: `${fk.sourceSchema}.${fk.sourceTable}(${fk.sourceColumns.join(", ")}) → ${fk.columns.join(", ")}`,
    metadata: compact({
      direction: "inbound",
      schemaName: schema,
      tableName: table,
      columns: fk.columns,
      sourceSchema: fk.sourceSchema,
      sourceTable: fk.sourceTable,
      sourceColumns: fk.sourceColumns,
      onUpdate: fk.onUpdate,
      onDelete: fk.onDelete,
    }),
  }));
  return [...outboundBlocks, ...inboundBlocks];
}

export function blocksFromSchemaRls(
  rls: SchemaRlsState | undefined,
  schema: string,
  table: string,
): EvidenceBlock[] {
  if (!rls) return [];
  const header: EvidenceBlock = {
    blockId: nextId(),
    kind: "schema",
    title: `RLS on ${table} — enabled=${rls.rlsEnabled} force=${rls.forceRls} (${rls.policies.length} polic${rls.policies.length === 1 ? "y" : "ies"})`,
    sourceRef: `${qualifiedTableRef(schema, table)}.rls`,
    content: `rlsEnabled=${rls.rlsEnabled} forceRls=${rls.forceRls}`,
    metadata: compact({
      schemaName: schema,
      tableName: table,
      rlsEnabled: rls.rlsEnabled,
      forceRls: rls.forceRls,
      policyCount: rls.policies.length,
    }),
  };
  const policyBlocks: EvidenceBlock[] = rls.policies.map((policy) => ({
    blockId: nextId(),
    kind: "schema",
    title: `policy ${policy.name} (${policy.mode} ${policy.command} to ${policy.roles.join(",")})`,
    sourceRef: `${qualifiedTableRef(schema, table)}.rls.${policy.name}`,
    content: [
      policy.usingExpression ? `USING (${policy.usingExpression})` : null,
      policy.withCheckExpression ? `WITH CHECK (${policy.withCheckExpression})` : null,
    ]
      .filter((part): part is string => part != null)
      .join(" "),
    metadata: compact({
      schemaName: schema,
      tableName: table,
      mode: policy.mode,
      command: policy.command,
      roles: policy.roles,
      usingExpression: policy.usingExpression,
      withCheckExpression: policy.withCheckExpression,
    }),
  }));
  return [header, ...policyBlocks];
}

export function blocksFromSchemaTriggers(
  triggers: SchemaTrigger[] | undefined,
  schema: string,
  table: string,
): EvidenceBlock[] {
  if (!triggers || triggers.length === 0) return [];
  return triggers.map((trigger) => ({
    blockId: nextId(),
    kind: "schema",
    title: `trigger ${trigger.name} ${trigger.timing} ${trigger.events.join("/")} on ${table}`,
    sourceRef: `${qualifiedTableRef(schema, table)}.trigger.${trigger.name}`,
    content: trigger.bodyText ?? `${trigger.timing} ${trigger.events.join("/")}`,
    metadata: compact({
      schemaName: schema,
      tableName: table,
      enabled: trigger.enabled,
      enabledMode: trigger.enabledMode,
      timing: trigger.timing,
      events: trigger.events,
      hasBody: trigger.bodyText != null && trigger.bodyText.length > 0,
    }),
  }));
}

export function blocksFromChunkHits(hits: CodeChunkHit[]): EvidenceBlock[] {
  return hits.map((hit) => ({
    blockId: nextId(),
    kind: "trace",
    title:
      hit.name && hit.chunkKind === "symbol"
        ? `${hit.name} in ${hit.filePath}`
        : `${hit.filePath}${hit.lineStart ? `:L${hit.lineStart}` : ""}`,
    sourceRef: hit.lineStart ? `${hit.filePath}:${hit.lineStart}` : hit.filePath,
    filePath: hit.filePath,
    line: hit.lineStart,
    content: hit.snippet,
    score: hit.score,
    metadata: compact({
      chunkKind: hit.chunkKind,
      symbolName: hit.name,
      lineEnd: hit.lineEnd,
    }),
  }));
}

export function blocksFromSchemaBodies(hits: SchemaBodyHit[]): EvidenceBlock[] {
  return hits.map((hit) => ({
    blockId: nextId(),
    kind: "schema",
    title: `${hit.objectType} ${hit.schemaName}.${hit.objectName}${hit.argTypes && hit.argTypes.length > 0 ? `(${hit.argTypes.join(", ")})` : ""}`,
    sourceRef: `${hit.schemaName}.${hit.objectName}.body`,
    content: hit.bodyText.length > 400 ? `${hit.bodyText.slice(0, 400)}…` : hit.bodyText,
    metadata: compact({
      objectType: hit.objectType,
      schemaName: hit.schemaName,
      objectName: hit.objectName,
      tableName: hit.tableName,
      rpcKind: hit.rpcKind,
      argTypes: hit.argTypes,
    }),
  }));
}

export function blocksFromFunctionTableRefs(refs: FunctionTableRef[]): EvidenceBlock[] {
  return refs.map((ref) => ({
    blockId: nextId(),
    kind: "trace",
    title: `${ref.rpcSchema}.${ref.rpcName}${ref.argTypes.length > 0 ? `(${ref.argTypes.join(", ")})` : ""} → ${ref.targetSchema}.${ref.targetTable}`,
    sourceRef: `${ref.rpcSchema}.${ref.rpcName}→${ref.targetSchema}.${ref.targetTable}`,
    content: `${ref.rpcKind} ${ref.rpcName} references ${ref.targetSchema}.${ref.targetTable}`,
    metadata: compact({
      rpcSchema: ref.rpcSchema,
      rpcName: ref.rpcName,
      rpcKind: ref.rpcKind,
      argTypes: ref.argTypes,
      targetSchema: ref.targetSchema,
      targetTable: ref.targetTable,
    }),
  }));
}

export interface AstHitBlockOptions {
  title: (hit: AstHit) => string;
  metadataKind?: string;
}

export function blocksFromAstHits(
  hits: AstHit[],
  options: AstHitBlockOptions,
): EvidenceBlock[] {
  return hits.map((hit) => ({
    blockId: nextId(),
    kind: "finding",
    title: options.title(hit),
    sourceRef: `${hit.filePath}:${hit.lineStart}`,
    filePath: hit.filePath,
    line: hit.lineStart,
    content: hit.matchText,
    metadata: compact({
      kind: options.metadataKind,
      lineEnd: hit.lineEnd,
      columnStart: hit.columnStart,
      columnEnd: hit.columnEnd,
      captures: Object.keys(hit.captures).length > 0 ? (hit.captures as JsonValue) : undefined,
    }),
  }));
}
