import type {
  FileImportLink,
  FileSearchMatch,
  FileSummaryRecord,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SchemaUsageMatch,
  SymbolRecord,
} from "./types.js";
import { parseJson } from "./json.js";

export interface FileRow {
  file_id: number;
  path: string;
  sha256: string | null;
  language: string;
  size_bytes: number | null;
  line_count: number | null;
  is_generated: number;
  last_modified_at: string | null;
  indexed_at: string;
}

export interface FileSearchRow extends FileRow {
  snippet: string | null;
}

export interface RankedFileSearchRow extends FileSearchRow {
  relevance_score: number;
}

export interface ImportLinkRow {
  source_path: string;
  target_path: string;
  specifier: string;
  import_kind: string;
  is_type_only: number;
  line: number | null;
  target_exists: number;
}

export interface RouteRow {
  route_key: string;
  framework: string;
  pattern: string;
  method: string | null;
  handler_name: string | null;
  is_api: number;
  metadata_json: string | null;
  file_path: string;
}

export interface SymbolRow {
  name: string;
  kind: string;
  export_name: string | null;
  line_start: number | null;
  line_end: number | null;
  signature_text: string | null;
  metadata_json: string | null;
}

export interface SchemaObjectRow {
  object_id: number;
  object_type: ResolvedSchemaObjectRecord["objectType"];
  schema_name: string;
  object_name: string;
  parent_object_name: string | null;
  data_type: string | null;
  definition_json: string | null;
}

export interface SchemaUsageRow {
  file_path: string;
  usage_kind: string;
  line: number | null;
  excerpt: string | null;
}

export function normalizeSearchText(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function expandIdentifierTerms(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/[_./\\:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildFtsPhraseMatchExpression(queryText: string): string | null {
  const tokens = (queryText.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (token) => token.length >= 2,
  );
  if (tokens.length === 0) return null;
  return `"${tokens.join(" ")}"`;
}

export function extractSearchTokens(value: string): string[] {
  const tokens = new Set<string>();
  for (const candidate of [value, expandIdentifierTerms(value)]) {
    const matches = candidate.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
    for (const token of matches) {
      if (token.length >= 2) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

function extractFtsTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (token) => token.length >= 2,
  );
}

function prefixAnd(tokens: readonly string[]): string | null {
  return tokens.length > 0 ? tokens.map((token) => `${token}*`).join(" AND ") : null;
}

export function buildFtsPrefixMatchExpression(queryText: string): string | null {
  const raw = prefixAnd(extractFtsTokens(queryText));
  const expanded = prefixAnd(extractFtsTokens(expandIdentifierTerms(queryText)));
  const clauses = [...new Set([raw, expanded].filter((clause): clause is string => clause != null))];
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0]!;
  return clauses.map((clause) => `(${clause})`).join(" OR ");
}

export function mapFileSummaryRow(row: FileRow | undefined): FileSummaryRecord | null {
  if (!row) {
    return null;
  }

  return {
    path: row.path,
    sha256: row.sha256 ?? undefined,
    language: row.language,
    sizeBytes: row.size_bytes ?? 0,
    lineCount: row.line_count ?? 0,
    isGenerated: row.is_generated === 1,
    lastModifiedAt: row.last_modified_at ?? undefined,
    indexedAt: row.indexed_at,
  };
}

export function mapFileSearchRow(row: FileSearchRow): FileSearchMatch {
  const file = mapFileSummaryRow(row) as FileSummaryRecord;
  return {
    ...file,
    snippet: row.snippet ?? undefined,
  };
}

export function mapImportLinkRow(row: ImportLinkRow): FileImportLink {
  return {
    sourcePath: row.source_path,
    targetPath: row.target_path,
    specifier: row.specifier,
    importKind: row.import_kind,
    isTypeOnly: row.is_type_only === 1,
    line: row.line ?? undefined,
    targetExists: row.target_exists === 1,
  };
}

export function mapRouteRow(row: RouteRow): ResolvedRouteRecord {
  return {
    routeKey: row.route_key,
    framework: row.framework,
    pattern: row.pattern,
    method: row.method ?? undefined,
    handlerName: row.handler_name ?? undefined,
    isApi: row.is_api === 1,
    metadata: row.metadata_json == null ? undefined : parseJson(row.metadata_json, {}),
    filePath: row.file_path,
  };
}

export function mapSymbolRow(row: SymbolRow): SymbolRecord {
  return {
    name: row.name,
    kind: row.kind,
    exportName: row.export_name ?? undefined,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    signatureText: row.signature_text ?? undefined,
    metadata: row.metadata_json == null ? undefined : parseJson(row.metadata_json, {}),
  };
}

export function mapSchemaObjectRow(row: SchemaObjectRow): ResolvedSchemaObjectRecord {
  return {
    objectId: row.object_id,
    objectType: row.object_type,
    schemaName: row.schema_name,
    objectName: row.object_name,
    parentObjectName: row.parent_object_name ?? undefined,
    dataType: row.data_type ?? undefined,
    definition: row.definition_json == null ? undefined : parseJson(row.definition_json, {}),
  };
}

export function mapSchemaUsageRow(row: SchemaUsageRow): SchemaUsageMatch {
  return {
    filePath: row.file_path,
    usageKind: row.usage_kind,
    line: row.line ?? undefined,
    excerpt: row.excerpt ?? undefined,
  };
}

export function buildSchemaObjectIdentifiers(object: ResolvedSchemaObjectRecord): string[] {
  const identifiers = [object.objectName];

  if (object.parentObjectName) {
    identifiers.push(`${object.parentObjectName}.${object.objectName}`);
    identifiers.push(`${object.schemaName}.${object.parentObjectName}.${object.objectName}`);
  }

  identifiers.push(`${object.schemaName}.${object.objectName}`);
  return [...new Set(identifiers.map((identifier) => identifier.toLowerCase()))];
}
