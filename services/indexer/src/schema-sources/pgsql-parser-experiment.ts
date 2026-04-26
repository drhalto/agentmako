import { parse } from "pgsql-parser";
import { extractPgObjectsFromSql } from "../extract-pg-functions.js";
import { extractSchemaObjectsFromSql } from "../schema-scan.js";

export interface PgsqlParserStatementSummary {
  kind: string;
  objectName?: string;
}

export interface PgsqlParserExperimentResult {
  sourceFilePath: string;
  parserStatus: "parsed" | "failed";
  statementCount: number;
  statementKinds: PgsqlParserStatementSummary[];
  currentExtractor: {
    schemaObjectCount: number;
    pgObjectCount: number;
  };
  recommendation: "park_for_normalization";
  errorMessage?: string;
}

interface PgsqlParseResult {
  stmts?: Array<{
    stmt?: Record<string, unknown>;
  }>;
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

function qualifiedRelationName(relation: unknown): string | undefined {
  const schemaName = stringField(relation, "schemaname");
  const relationName = stringField(relation, "relname");
  if (!relationName) {
    return undefined;
  }
  return schemaName ? `${schemaName}.${relationName}` : relationName;
}

function functionName(functionNode: unknown): string | undefined {
  const record = objectRecord(functionNode);
  const functionNameNodes = Array.isArray(record?.funcname) ? record.funcname : [];
  const parts = functionNameNodes.flatMap((entry) => {
    const stringNode = objectRecord(entry)?.String;
    const value = stringField(stringNode, "sval");
    return value ? [value] : [];
  });
  return parts.length > 0 ? parts.join(".") : undefined;
}

function summarizeStatement(statement: { stmt?: Record<string, unknown> }): PgsqlParserStatementSummary {
  const stmt = statement.stmt;
  const kind = stmt ? Object.keys(stmt)[0] : undefined;
  if (!stmt || !kind) {
    return { kind: "UnknownStmt" };
  }
  const body = objectRecord(stmt[kind]);
  let objectName: string | undefined;
  if (kind === "CreateStmt") {
    objectName = qualifiedRelationName(body?.relation);
  } else if (kind === "ViewStmt") {
    objectName = qualifiedRelationName(body?.view);
  } else if (kind === "CreateFunctionStmt") {
    objectName = functionName(body);
  } else if (kind === "CreatePolicyStmt") {
    objectName = stringField(body, "policy_name");
  }
  return {
    kind,
    ...(objectName ? { objectName } : {}),
  };
}

export async function runPgsqlParserExperiment(
  sourceFilePath: string,
  content: string,
): Promise<PgsqlParserExperimentResult> {
  const currentSchemaObjects = await extractSchemaObjectsFromSql(sourceFilePath, content);
  const currentPgObjects = extractPgObjectsFromSql(sourceFilePath, content);

  try {
    const parsed = await parse(content) as PgsqlParseResult;
    const statementKinds = (parsed.stmts ?? []).map((statement) => summarizeStatement(statement));
    return {
      sourceFilePath,
      parserStatus: "parsed",
      statementCount: statementKinds.length,
      statementKinds,
      currentExtractor: {
        schemaObjectCount: currentSchemaObjects.length,
        pgObjectCount: currentPgObjects.length,
      },
      recommendation: "park_for_normalization",
    };
  } catch (error) {
    return {
      sourceFilePath,
      parserStatus: "failed",
      statementCount: 0,
      statementKinds: [],
      currentExtractor: {
        schemaObjectCount: currentSchemaObjects.length,
        pgObjectCount: currentPgObjects.length,
      },
      recommendation: "park_for_normalization",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
