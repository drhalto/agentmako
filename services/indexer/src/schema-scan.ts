import type {
  IndexedFileRecord,
  SchemaObjectKind,
  SchemaObjectRecord,
  SchemaUsageRecord,
} from "@mako-ai/store";
import type { JsonObject } from "@mako-ai/contracts";
import { parse } from "pgsql-parser";
import ts from "typescript";

function stripIdentifierQuotes(value: string): string {
  return value.replace(/^["`[]/, "").replace(/["`\]]$/, "");
}

function normalizeIdentifier(value: string): string {
  return stripIdentifierQuotes(value.trim()).toLowerCase();
}

function parseQualifiedName(rawName: string): { schemaName: string; objectName: string } {
  const parts = rawName
    .split(".")
    .map((part) => normalizeIdentifier(part))
    .filter((part) => part !== "");

  if (parts.length >= 2) {
    return {
      schemaName: parts[parts.length - 2],
      objectName: parts[parts.length - 1],
    };
  }

  return {
    schemaName: "public",
    objectName: parts[0] ?? normalizeIdentifier(rawName),
  };
}

function buildObjectKey(
  objectType: SchemaObjectKind,
  schemaName: string,
  objectName: string,
  parentObjectName?: string,
): string {
  return [objectType, schemaName, parentObjectName ?? "", objectName].join(":");
}

function createDefinition(
  sourceFilePath: string,
  line: number,
  statementExcerpt: string,
  extra: JsonObject = {},
): JsonObject {
  return {
    sourceFilePath,
    line,
    statementExcerpt,
    ...extra,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberFromIndex(content: string, characterIndex: number): number {
  return content.slice(0, characterIndex).split("\n").length;
}

interface PgsqlRawStmt {
  stmt?: Record<string, unknown>;
  stmt_location?: number;
  stmt_len?: number;
}

interface PgsqlParseResult {
  stmts?: PgsqlRawStmt[];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const record = objectRecord(value);
  const field = record?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const record = objectRecord(value);
  const field = record?.[key];
  return typeof field === "number" ? field : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const record = objectRecord(value);
  const field = record?.[key];
  return typeof field === "boolean" ? field : undefined;
}

function stringNodeValue(value: unknown): string | undefined {
  return stringField(objectRecord(value)?.String, "sval");
}

function stringNodeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const stringValue = stringNodeValue(entry);
        return stringValue ? [normalizeIdentifier(stringValue)] : [];
      })
    : [];
}

function qualifiedNameFromStringNodes(value: unknown): { schemaName: string; objectName: string } | undefined {
  const parts = stringNodeList(value);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length >= 2) {
    return {
      schemaName: parts[parts.length - 2]!,
      objectName: parts[parts.length - 1]!,
    };
  }
  return {
    schemaName: "public",
    objectName: parts[0]!,
  };
}

function qualifiedNameFromRangeVar(value: unknown): { schemaName: string; objectName: string; location?: number } | undefined {
  const relationName = stringField(value, "relname");
  if (!relationName) {
    return undefined;
  }
  return {
    schemaName: normalizeIdentifier(stringField(value, "schemaname") ?? "public"),
    objectName: normalizeIdentifier(relationName),
    location: numberField(value, "location"),
  };
}

function typeNameText(typeName: unknown): string | undefined {
  const record = objectRecord(typeName);
  const parts = stringNodeList(record?.names);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(".");
}

function statementStartIndex(content: string, rawStatement: PgsqlRawStmt, objectLocation?: number): number {
  if (typeof rawStatement.stmt_location === "number") {
    return rawStatement.stmt_location;
  }
  if (typeof objectLocation === "number") {
    const prefix = content.slice(0, objectLocation);
    const createIndex = prefix.search(/create\s+(?:or\s+replace\s+)?(?:table|view|type|function|procedure)\s+[^\s]*$/i);
    if (createIndex >= 0) {
      return createIndex;
    }
    const lastCreate = prefix.toLowerCase().lastIndexOf("create ");
    if (lastCreate >= 0) {
      return lastCreate;
    }
  }
  return 0;
}

function statementExcerptFromRaw(content: string, rawStatement: PgsqlRawStmt, startIndex: number): string {
  const length = typeof rawStatement.stmt_len === "number" && rawStatement.stmt_len > 0
    ? rawStatement.stmt_len
    : 240;
  return content.slice(startIndex, Math.min(content.length, startIndex + length)).slice(0, 240).replace(/\s+/g, " ").trim();
}

function columnConstraintsExcerpt(columnDef: Record<string, unknown>): string {
  const constraints = Array.isArray(columnDef.constraints) ? columnDef.constraints : [];
  const labels: string[] = [];
  for (const item of constraints) {
    const constraint = objectRecord(objectRecord(item)?.Constraint);
    const type = stringField(constraint, "contype");
    if (type === "CONSTR_PRIMARY") {
      labels.push("primary key");
    } else if (type === "CONSTR_NOTNULL") {
      labels.push("not null");
    } else if (type === "CONSTR_NULL") {
      labels.push("null");
    } else if (type === "CONSTR_DEFAULT") {
      labels.push("default");
    } else if (type === "CONSTR_FOREIGN") {
      labels.push("references");
    }
  }
  return labels.join(" ");
}

function extractTableFromPgsqlAst(
  sourceFilePath: string,
  content: string,
  rawStatement: PgsqlRawStmt,
  createStmt: Record<string, unknown>,
): SchemaObjectRecord[] {
  const relation = qualifiedNameFromRangeVar(createStmt.relation);
  if (!relation) {
    return [];
  }

  const startIndex = statementStartIndex(content, rawStatement, relation.location);
  const line = lineNumberFromIndex(content, startIndex);
  const statementExcerpt = statementExcerptFromRaw(content, rawStatement, startIndex);
  const tableElts = Array.isArray(createStmt.tableElts) ? createStmt.tableElts : [];
  const records: SchemaObjectRecord[] = [
    createSchemaObjectRecord("table", relation.schemaName, relation.objectName, sourceFilePath, line, statementExcerpt, {
      definition: createDefinition(sourceFilePath, line, statementExcerpt, {
        columnsHint: tableElts.filter((item) => objectRecord(item)?.ColumnDef).length,
      }),
    }),
  ];

  for (const item of tableElts) {
    const columnDef = objectRecord(objectRecord(item)?.ColumnDef);
    const columnName = stringField(columnDef, "colname");
    if (!columnDef || !columnName) {
      continue;
    }

    const columnLocation = numberField(columnDef, "location");
    const columnLine = lineNumberFromIndex(content, columnLocation ?? startIndex);
    const dataType = typeNameText(columnDef.typeName);
    const constraints = columnConstraintsExcerpt(columnDef);
    const excerpt = `${columnName} ${dataType ?? "unknown"}${constraints ? ` ${constraints}` : ""}`;
    const normalizedColumnName = normalizeIdentifier(columnName);

    records.push(
      createSchemaObjectRecord(
        "column",
        relation.schemaName,
        normalizedColumnName,
        sourceFilePath,
        columnLine,
        excerpt,
        {
          parentObjectName: relation.objectName,
          dataType,
          definition: createDefinition(sourceFilePath, columnLine, excerpt, {
            parentObjectName: relation.objectName,
            dataType: dataType ?? null,
          }),
        },
      ),
    );
  }

  return records;
}

function extractViewFromPgsqlAst(
  sourceFilePath: string,
  content: string,
  rawStatement: PgsqlRawStmt,
  viewStmt: Record<string, unknown>,
): SchemaObjectRecord[] {
  const relation = qualifiedNameFromRangeVar(viewStmt.view);
  if (!relation) {
    return [];
  }
  const startIndex = statementStartIndex(content, rawStatement, relation.location);
  const line = lineNumberFromIndex(content, startIndex);
  const statementExcerpt = statementExcerptFromRaw(content, rawStatement, startIndex);
  return [createSchemaObjectRecord("view", relation.schemaName, relation.objectName, sourceFilePath, line, statementExcerpt)];
}

function extractEnumFromPgsqlAst(
  sourceFilePath: string,
  content: string,
  rawStatement: PgsqlRawStmt,
  createEnumStmt: Record<string, unknown>,
): SchemaObjectRecord[] {
  const relation = qualifiedNameFromStringNodes(createEnumStmt.typeName);
  if (!relation) {
    return [];
  }
  const startIndex = statementStartIndex(content, rawStatement);
  const line = lineNumberFromIndex(content, startIndex);
  const statementExcerpt = statementExcerptFromRaw(content, rawStatement, startIndex);
  const values = Array.isArray(createEnumStmt.vals)
    ? createEnumStmt.vals.flatMap((entry) => {
        const value = stringNodeValue(entry);
        return value ? [value] : [];
      })
    : [];

  return [
    createSchemaObjectRecord("enum", relation.schemaName, relation.objectName, sourceFilePath, line, statementExcerpt, {
      definition: createDefinition(sourceFilePath, line, statementExcerpt, {
        values,
      }),
    }),
  ];
}

function extractRpcFromPgsqlAst(
  sourceFilePath: string,
  content: string,
  rawStatement: PgsqlRawStmt,
  createFunctionStmt: Record<string, unknown>,
): SchemaObjectRecord[] {
  const relation = qualifiedNameFromStringNodes(createFunctionStmt.funcname);
  if (!relation) {
    return [];
  }
  const startIndex = statementStartIndex(content, rawStatement);
  const line = lineNumberFromIndex(content, startIndex);
  const statementExcerpt = statementExcerptFromRaw(content, rawStatement, startIndex);
  return [createSchemaObjectRecord("rpc", relation.schemaName, relation.objectName, sourceFilePath, line, statementExcerpt)];
}

function objectsFromPgsqlStatement(
  sourceFilePath: string,
  content: string,
  rawStatement: PgsqlRawStmt,
): SchemaObjectRecord[] {
  const statement = rawStatement.stmt;
  if (!statement) {
    return [];
  }
  const kind = Object.keys(statement)[0];
  if (!kind) {
    return [];
  }
  const body = objectRecord(statement[kind]);
  if (!body) {
    return [];
  }

  if (kind === "CreateStmt") {
    if (booleanField(body, "isforeign")) {
      return [];
    }
    return extractTableFromPgsqlAst(sourceFilePath, content, rawStatement, body);
  }
  if (kind === "ViewStmt") {
    return extractViewFromPgsqlAst(sourceFilePath, content, rawStatement, body);
  }
  if (kind === "CreateEnumStmt") {
    return extractEnumFromPgsqlAst(sourceFilePath, content, rawStatement, body);
  }
  if (kind === "CreateFunctionStmt") {
    return extractRpcFromPgsqlAst(sourceFilePath, content, rawStatement, body);
  }
  return [];
}

function snippetAround(content: string, index: number, radius = 90): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + radius);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function createSchemaObjectRecord(
  objectType: SchemaObjectKind,
  schemaName: string,
  objectName: string,
  sourceFilePath: string,
  line: number,
  statementExcerpt: string,
  options: Partial<Pick<SchemaObjectRecord, "parentObjectName" | "dataType" | "definition">> = {},
): SchemaObjectRecord {
  return {
    objectKey: buildObjectKey(objectType, schemaName, objectName, options.parentObjectName),
    objectType,
    schemaName,
    objectName,
    parentObjectName: options.parentObjectName,
    dataType: options.dataType,
    definition:
      options.definition ??
      createDefinition(sourceFilePath, line, statementExcerpt, {
        objectType,
      }),
  };
}

function parseTableColumns(
  sourceFilePath: string,
  schemaName: string,
  tableName: string,
  blockContent: string,
  lineOffset: number,
): SchemaObjectRecord[] {
  const columns: SchemaObjectRecord[] = [];
  const rawLines = blockContent.split("\n");

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]?.trim().replace(/,$/, "") ?? "";
    if (line === "" || /^(-{2}|\/\*|\*\/)/.test(line)) {
      continue;
    }

    if (/^(constraint|primary|foreign|unique|check|exclude|like)\b/i.test(line)) {
      continue;
    }

    const match = line.match(/^(".*?"|`.*?`|\[.*?\]|[a-zA-Z_][a-zA-Z0-9_$]*)\s+(.+)$/);
    if (!match) {
      continue;
    }

    const columnName = normalizeIdentifier(match[1]);
    const remainder = match[2]
      .split(/\s+(?=not\b|null\b|default\b|constraint\b|references\b|primary\b|unique\b|check\b)/i)[0]
      ?.trim();

    columns.push(
      createSchemaObjectRecord(
        "column",
        schemaName,
        columnName,
        sourceFilePath,
        lineOffset + index,
        line,
        {
          parentObjectName: tableName,
          dataType: remainder,
          definition: createDefinition(sourceFilePath, lineOffset + index, line, {
            parentObjectName: tableName,
            dataType: remainder ?? null,
          }),
        },
      ),
    );
  }

  return columns;
}

function extractTables(sourceFilePath: string, content: string): SchemaObjectRecord[] {
  const objects: SchemaObjectRecord[] = [];
  const tableRegex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+))?)\s*\(([\s\S]*?)\)\s*;/gi;

  for (const match of content.matchAll(tableRegex)) {
    const [, rawName, blockContent] = match;
    const { schemaName, objectName } = parseQualifiedName(rawName);
    const line = lineNumberFromIndex(content, match.index ?? 0);
    const statementExcerpt = match[0].slice(0, 240).replace(/\s+/g, " ").trim();

    objects.push(
      createSchemaObjectRecord("table", schemaName, objectName, sourceFilePath, line, statementExcerpt, {
        definition: createDefinition(sourceFilePath, line, statementExcerpt, {
          columnsHint: blockContent.split("\n").length,
        }),
      }),
    );

    objects.push(...parseTableColumns(sourceFilePath, schemaName, objectName, blockContent, line + 1));
  }

  return objects;
}

function extractViews(sourceFilePath: string, content: string): SchemaObjectRecord[] {
  const objects: SchemaObjectRecord[] = [];
  const viewRegex =
    /create\s+(?:or\s+replace\s+)?view\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+))?)\s+as\b/gi;

  for (const match of content.matchAll(viewRegex)) {
    const [, rawName] = match;
    const { schemaName, objectName } = parseQualifiedName(rawName);
    const line = lineNumberFromIndex(content, match.index ?? 0);
    const statementExcerpt = match[0].replace(/\s+/g, " ").trim();
    objects.push(createSchemaObjectRecord("view", schemaName, objectName, sourceFilePath, line, statementExcerpt));
  }

  return objects;
}

function extractEnums(sourceFilePath: string, content: string): SchemaObjectRecord[] {
  const objects: SchemaObjectRecord[] = [];
  const enumRegex =
    /create\s+type\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+))?)\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/gi;

  for (const match of content.matchAll(enumRegex)) {
    const [, rawName, valuesBlock] = match;
    const { schemaName, objectName } = parseQualifiedName(rawName);
    const line = lineNumberFromIndex(content, match.index ?? 0);
    const enumValues = valuesBlock
      .split(",")
      .map((item) => item.trim().replace(/^'/, "").replace(/'$/, ""))
      .filter((item) => item !== "");

    objects.push(
      createSchemaObjectRecord("enum", schemaName, objectName, sourceFilePath, line, match[0].slice(0, 240).replace(/\s+/g, " ").trim(), {
        definition: createDefinition(sourceFilePath, line, match[0].slice(0, 240).replace(/\s+/g, " ").trim(), {
          values: enumValues,
        }),
      }),
    );
  }

  return objects;
}

function extractRpcs(sourceFilePath: string, content: string): SchemaObjectRecord[] {
  const objects: SchemaObjectRecord[] = [];
  const rpcRegex =
    /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+))?)\s*\(/gi;

  for (const match of content.matchAll(rpcRegex)) {
    const [, rawName] = match;
    const { schemaName, objectName } = parseQualifiedName(rawName);
    const line = lineNumberFromIndex(content, match.index ?? 0);
    const statementExcerpt = match[0].replace(/\s+/g, " ").trim();
    objects.push(createSchemaObjectRecord("rpc", schemaName, objectName, sourceFilePath, line, statementExcerpt));
  }

  return objects;
}

function extractSchemaObjectsFromSqlFallback(
  sourceFilePath: string,
  content: string,
): SchemaObjectRecord[] {
  const objects = [
    ...extractTables(sourceFilePath, content),
    ...extractViews(sourceFilePath, content),
    ...extractEnums(sourceFilePath, content),
    ...extractRpcs(sourceFilePath, content),
  ];

  const seen = new Set<string>();
  return objects.filter((object) => {
    if (seen.has(object.objectKey)) {
      return false;
    }

    seen.add(object.objectKey);
    return true;
  });
}

export async function extractSchemaObjectsFromSql(
  sourceFilePath: string,
  content: string,
): Promise<SchemaObjectRecord[]> {
  let objects: SchemaObjectRecord[];
  try {
    const parsed = await parse(content) as PgsqlParseResult;
    objects = (parsed.stmts ?? []).flatMap((statement) =>
      objectsFromPgsqlStatement(sourceFilePath, content, statement),
    );
  } catch {
    objects = extractSchemaObjectsFromSqlFallback(sourceFilePath, content);
  }

  const seen = new Set<string>();
  return objects.filter((object) => {
    if (seen.has(object.objectKey)) {
      return false;
    }

    seen.add(object.objectKey);
    return true;
  });
}

function shouldTrackUsage(object: SchemaObjectRecord): boolean {
  return object.objectType === "table" || object.objectType === "view" || object.objectType === "rpc" || object.objectType === "enum";
}

// Only scan genuine code files for schema-object usage. Markdown docs,
// YAML / JSON config, and other prose / data formats can legitimately
// mention table or RPC names (docs/benchmark-answer-key.md, migration
// READMEs, etc.) but those mentions are not executable call sites — the
// `tenant_leak_audit` operator downstream treats each match as a weak
// signal, so surfacing RPC-name-in-docs inflates the operator's finding
// count with false positives. Restrict to the JS/TS + SQL languages the
// rest of the indexer actively parses; add entries here when the indexer
// grows support for another code language.
const SCHEMA_USAGE_CODE_LANGUAGES: ReadonlySet<string> = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "esm",
  "commonjs",
  "sql",
]);

interface StructuredSchemaUsageCandidate {
  objectName: string;
  schemaName?: string;
  usageMethod: "from" | "rpc";
  line: number;
  excerpt: string;
}

function scriptKindForLanguage(language: string): ts.ScriptKind {
  switch (language) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "jsx":
      return ts.ScriptKind.JSX;
    case "javascript":
    case "esm":
    case "commonjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function isTsJsLanguage(language: string): boolean {
  return (
    language === "typescript" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "jsx" ||
    language === "esm" ||
    language === "commonjs"
  );
}

function firstStringArgument(call: ts.CallExpression): string | undefined {
  const firstArg = call.arguments[0];
  if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
    return firstArg.text;
  }
  return undefined;
}

function schemaNameFromReceiver(receiver: ts.Expression): string | undefined {
  if (!ts.isCallExpression(receiver)) {
    return undefined;
  }
  const expression = receiver.expression;
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "schema") {
    return undefined;
  }
  return firstStringArgument(receiver);
}

function collectStructuredSchemaUsages(file: IndexedFileRecord, content: string): StructuredSchemaUsageCandidate[] {
  if (!isTsJsLanguage(file.language) || content.trim() === "") {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    file.path,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForLanguage(file.language),
  );
  const candidates: StructuredSchemaUsageCandidate[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (methodName === "from" || methodName === "rpc") {
        const objectName = firstStringArgument(node);
        if (objectName) {
          const index = node.getStart(sourceFile);
          candidates.push({
            objectName,
            schemaName: schemaNameFromReceiver(node.expression.expression),
            usageMethod: methodName,
            line: lineNumberFromIndex(content, index),
            excerpt: snippetAround(content, index),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return candidates;
}

function matchesStructuredUsage(
  object: SchemaObjectRecord,
  candidate: StructuredSchemaUsageCandidate,
): boolean {
  if (candidate.objectName !== object.objectName) {
    return false;
  }
  if (candidate.schemaName && candidate.schemaName !== object.schemaName) {
    return false;
  }
  if (candidate.usageMethod === "rpc") {
    return object.objectType === "rpc";
  }
  return object.objectType === "table" || object.objectType === "view";
}

export function collectSchemaUsages(
  files: IndexedFileRecord[],
  schemaObjects: SchemaObjectRecord[],
): SchemaUsageRecord[] {
  const usages: SchemaUsageRecord[] = [];
  const seen = new Set<string>();
  const structuredUsagesByPath = new Map<string, StructuredSchemaUsageCandidate[]>();

  for (const object of schemaObjects) {
    const sourceFilePath =
      object.definition != null && typeof object.definition.sourceFilePath === "string"
        ? object.definition.sourceFilePath
        : undefined;
    const definitionLine =
      object.definition != null && typeof object.definition.line === "number"
        ? object.definition.line
        : undefined;

    if (sourceFilePath) {
      const key = [object.objectKey, sourceFilePath, "definition", definitionLine ?? ""].join(":");
      if (!seen.has(key)) {
        seen.add(key);
        usages.push({
          objectKey: object.objectKey,
          filePath: sourceFilePath,
          usageKind: "definition",
          line: definitionLine,
          excerpt:
            object.definition != null && typeof object.definition.statementExcerpt === "string"
              ? object.definition.statementExcerpt
              : undefined,
        });
      }
    }

    if (!shouldTrackUsage(object)) {
      continue;
    }

    const usageRegex = new RegExp(`\\b${escapeRegExp(object.objectName)}\\b`, "i");

    for (const file of files) {
      if (!SCHEMA_USAGE_CODE_LANGUAGES.has(file.language)) {
        continue;
      }

      const content = file.chunks[0]?.content ?? "";
      if (content === "") {
        continue;
      }

      if (file.path === sourceFilePath) {
        continue;
      }

      let structuredUsages = structuredUsagesByPath.get(file.path);
      if (!structuredUsages) {
        structuredUsages = collectStructuredSchemaUsages(file, content);
        structuredUsagesByPath.set(file.path, structuredUsages);
      }

      const structuredMatches = structuredUsages.filter((candidate) =>
        matchesStructuredUsage(object, candidate),
      );
      if (structuredMatches.length > 0) {
        for (const candidate of structuredMatches) {
          const key = [object.objectKey, file.path, "reference", candidate.line].join(":");
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          usages.push({
            objectKey: object.objectKey,
            filePath: file.path,
            usageKind: "reference",
            line: candidate.line,
            excerpt: candidate.excerpt,
          });
        }
        continue;
      }

      const match = usageRegex.exec(content);
      if (!match) {
        continue;
      }

      const line = lineNumberFromIndex(content, match.index);
      const key = [object.objectKey, file.path, "reference", line].join(":");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      usages.push({
        objectKey: object.objectKey,
        filePath: file.path,
        usageKind: "reference",
        line,
        excerpt: snippetAround(content, match.index),
      });
    }
  }

  return usages;
}
