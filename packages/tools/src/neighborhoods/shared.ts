import type {
  FileDetailRecord,
  FileImportLink,
  FunctionTableRef,
  ProjectStore,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SchemaUsageMatch,
} from "@mako-ai/store";
import type {
  NeighborhoodFileSummary,
  NeighborhoodImportLink,
  NeighborhoodRouteRecord,
  NeighborhoodSection,
  NeighborhoodTableTouch,
  NeighborhoodRpcTouch,
  NeighborhoodRlsPolicyEntry,
  SchemaRpc,
  SchemaTable,
} from "@mako-ai/contracts";

export const DEFAULT_MAX_PER_SECTION = 20;
export const MAX_MAX_PER_SECTION = 100;

export function normalizeMaxPerSection(value: number | undefined): number {
  if (value == null) {
    return DEFAULT_MAX_PER_SECTION;
  }
  return Math.min(Math.max(1, Math.trunc(value)), MAX_MAX_PER_SECTION);
}

export function section<T>(entries: T[], max: number): NeighborhoodSection<T> {
  return {
    entries: entries.slice(0, max),
    truncated: entries.length > max,
    totalCount: entries.length,
  };
}

export function appendTruncationWarning(
  warnings: string[],
  label: string,
  sectionResult: { truncated: boolean; totalCount: number },
  max: number,
): void {
  if (sectionResult.truncated) {
    warnings.push(`${label} truncated ${sectionResult.totalCount} entries to maxPerSection ${max}.`);
  }
}

export function uniqueBy<T>(entries: ReadonlyArray<T>, key: (entry: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = key(entry);
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(entry);
  }
  return out;
}

export function toRouteRecord(route: ResolvedRouteRecord): NeighborhoodRouteRecord {
  return {
    routeKey: route.routeKey,
    framework: route.framework,
    pattern: route.pattern,
    method: route.method,
    handlerName: route.handlerName,
    isApi: route.isApi,
    filePath: route.filePath,
    metadata: route.metadata,
  };
}

export function toImportLink(link: FileImportLink): NeighborhoodImportLink {
  return {
    sourcePath: link.sourcePath,
    targetPath: link.targetPath,
    specifier: link.specifier,
    importKind: link.importKind,
    isTypeOnly: link.isTypeOnly,
    line: link.line,
    targetExists: link.targetExists,
  };
}

export function toFileSummary(file: FileDetailRecord): NeighborhoodFileSummary {
  return {
    path: file.path,
    language: file.language,
    sizeBytes: file.sizeBytes,
    lineCount: file.lineCount,
    isGenerated: file.isGenerated,
    chunkPreview: file.chunkPreview,
  };
}

export function isWriteUsage(usageKind: string): boolean {
  return /\b(write|insert|update|delete|upsert|mutation|modify|call_write)\b/i.test(usageKind);
}

export function isReadUsage(usageKind: string): boolean {
  return !isWriteUsage(usageKind);
}

export function findSchemaObject(
  store: ProjectStore,
  objectType: ResolvedSchemaObjectRecord["objectType"],
  schemaName: string | undefined,
  objectName: string,
): ResolvedSchemaObjectRecord | null {
  const matches = store
    .listSchemaObjects()
    .filter(
      (object) =>
        object.objectType === objectType &&
        object.objectName === objectName &&
        (schemaName == null || object.schemaName === schemaName),
    );
  if (matches.length === 0) {
    return null;
  }
  return matches.find((object) => object.schemaName === "public") ?? matches[0] ?? null;
}

export function findSchemaTable(
  store: ProjectStore,
  tableName: string,
  schemaName: string | undefined,
): { table: SchemaTable | null; schemaName: string; warnings: string[] } {
  const warnings: string[] = [];
  if (schemaName) {
    return {
      table: store.getSchemaTableSnapshot(schemaName, tableName),
      schemaName,
      warnings,
    };
  }

  const snapshot = store.loadSchemaSnapshot();
  const matches: SchemaTable[] = [];
  for (const namespace of Object.values(snapshot?.ir.schemas ?? {})) {
    for (const table of namespace.tables) {
      if (table.name === tableName) {
        matches.push(table);
      }
    }
  }

  if (matches.length > 0) {
    const selected = matches.find((table) => table.schema === "public") ?? matches[0]!;
    if (matches.length > 1) {
      warnings.push(
        `Multiple schema snapshot tables named ${tableName}; selected ${selected.schema}.${tableName}. Pass schemaName to disambiguate.`,
      );
    }
    return { table: selected, schemaName: selected.schema, warnings };
  }

  const indexedObject = findSchemaObject(store, "table", undefined, tableName);
  return {
    table: null,
    schemaName: indexedObject?.schemaName ?? "public",
    warnings,
  };
}

export function findSchemaRpc(
  store: ProjectStore,
  rpcName: string,
  schemaName: string | undefined,
  argTypes: readonly string[] | undefined,
): { rpc: SchemaRpc | null; schemaName: string; warnings: string[] } {
  const warnings: string[] = [];
  const snapshot = store.loadSchemaSnapshot();
  const matches: SchemaRpc[] = [];
  for (const namespace of Object.values(snapshot?.ir.schemas ?? {})) {
    for (const rpc of namespace.rpcs) {
      if (rpc.name !== rpcName) {
        continue;
      }
      if (schemaName && rpc.schema !== schemaName) {
        continue;
      }
      if (argTypes && !sameArgTypes(rpc.argTypes ?? [], argTypes)) {
        continue;
      }
      matches.push(rpc);
    }
  }

  if (matches.length > 0) {
    const selected = matches.find((rpc) => rpc.schema === "public") ?? matches[0]!;
    if (!schemaName && matches.length > 1) {
      warnings.push(
        `Multiple schema snapshot RPCs named ${rpcName}; selected ${selected.schema}.${rpcName}. Pass schemaName or argTypes to disambiguate.`,
      );
    }
    return { rpc: selected, schemaName: selected.schema, warnings };
  }

  const indexedObject = findSchemaObject(store, "rpc", schemaName, rpcName);
  return {
    rpc: null,
    schemaName: schemaName ?? indexedObject?.schemaName ?? "public",
    warnings,
  };
}

export function schemaUsageForObject(
  store: ProjectStore,
  object: ResolvedSchemaObjectRecord | null,
): SchemaUsageMatch[] {
  return object ? store.listSchemaUsages(object.objectId) : [];
}

export function collectSchemaUsagesForFiles(
  store: ProjectStore,
  filePaths: readonly string[],
): Array<{ object: ResolvedSchemaObjectRecord; usage: SchemaUsageMatch }> {
  const wanted = new Set(filePaths);
  const out: Array<{ object: ResolvedSchemaObjectRecord; usage: SchemaUsageMatch }> = [];
  for (const object of store.listSchemaObjects()) {
    for (const usage of store.listSchemaUsages(object.objectId)) {
      if (wanted.has(usage.filePath)) {
        out.push({ object, usage });
      }
    }
  }
  return out;
}

export function tableTouchFromUsage(
  object: ResolvedSchemaObjectRecord,
  usage: SchemaUsageMatch,
): NeighborhoodTableTouch {
  return {
    schemaName: object.schemaName,
    tableName: object.objectName,
    usageKind: usage.usageKind,
    filePath: usage.filePath,
    line: usage.line,
    excerpt: usage.excerpt,
  };
}

export function rpcTouchFromUsage(
  object: ResolvedSchemaObjectRecord,
  usage: SchemaUsageMatch,
): NeighborhoodRpcTouch {
  return {
    schemaName: object.schemaName,
    rpcName: object.objectName,
    usageKind: usage.usageKind,
    filePath: usage.filePath,
    line: usage.line,
    excerpt: usage.excerpt,
  };
}

export function tableTouchFromFunctionRef(ref: FunctionTableRef): NeighborhoodTableTouch {
  return {
    schemaName: ref.targetSchema,
    tableName: ref.targetTable,
    usageKind: `via_rpc:${ref.rpcSchema}.${ref.rpcName}`,
  };
}

export function collectRlsPolicies(
  store: ProjectStore,
  tables: ReadonlyArray<{ schemaName: string; tableName: string }>,
): NeighborhoodRlsPolicyEntry[] {
  const out: NeighborhoodRlsPolicyEntry[] = [];
  const uniqueTables = uniqueBy(tables, (table) => `${table.schemaName}.${table.tableName}`);
  for (const tableRef of uniqueTables) {
    const table = store.getSchemaTableSnapshot(tableRef.schemaName, tableRef.tableName);
    for (const policy of table?.rls?.policies ?? []) {
      out.push({
        schemaName: tableRef.schemaName,
        tableName: tableRef.tableName,
        policy,
      });
    }
  }
  return out;
}

export function functionRefKey(ref: FunctionTableRef): string {
  return `${ref.rpcSchema}.${ref.rpcName}(${ref.argTypes.join(",")})>${ref.targetSchema}.${ref.targetTable}`;
}

export function routeKey(route: NeighborhoodRouteRecord): string {
  return `${route.routeKey}:${route.filePath}`;
}

export function schemaUsageKey(usage: SchemaUsageMatch): string {
  return `${usage.filePath}:${usage.usageKind}:${usage.line ?? ""}:${usage.excerpt ?? ""}`;
}

export function rlsPolicyKey(entry: NeighborhoodRlsPolicyEntry): string {
  return `${entry.schemaName}.${entry.tableName}.${entry.policy.name}`;
}

export function tableTouchKey(entry: NeighborhoodTableTouch): string {
  return `${entry.schemaName}.${entry.tableName}:${entry.usageKind}:${entry.filePath ?? ""}:${entry.line ?? ""}`;
}

export function rpcTouchKey(entry: NeighborhoodRpcTouch): string {
  return `${entry.schemaName}.${entry.rpcName}:${entry.usageKind}:${entry.filePath ?? ""}:${entry.line ?? ""}`;
}

function sameArgTypes(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
