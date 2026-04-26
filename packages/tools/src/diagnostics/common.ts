import type {
  AnswerSurfaceIssue,
  AnswerSurfaceIssueCategory,
  AnswerSurfaceIssueConfidence,
  AnswerSurfaceIssueSeverity,
  JsonObject,
} from "@mako-ai/contracts";
import { hashJson, type ProjectStore } from "@mako-ai/store";
import * as ts from "typescript";
import { findAstMatches } from "../code-intel/ast-patterns.js";

export interface DiagnosticFile {
  path: string;
  content: string;
}

export interface DiagnosticAstFile extends DiagnosticFile {
  sourceFile: ts.SourceFile;
}

export interface DiagnosticIssueInput {
  category: AnswerSurfaceIssueCategory;
  code: string;
  message: string;
  severity: AnswerSurfaceIssueSeverity;
  confidence: AnswerSurfaceIssueConfidence;
  path?: string;
  line?: number;
  producerPath?: string;
  consumerPath?: string;
  evidenceRefs: string[];
  matchKey: unknown;
  codeFingerprint: unknown;
  metadata?: JsonObject;
}

export interface FilePropertyOccurrence {
  path: string;
  line: number;
  propertyName: string;
  ownerName?: string;
  ownerKind:
    | "interface_property"
    | "type_property"
    | "returned_object_property"
    | "component_prop"
    | "property_access"
    | "query_alias";
}

export interface FunctionParameterRecord {
  path: string;
  line: number;
  functionName: string;
  parameterNames: string[];
}

export interface ImportBindingRecord {
  localName: string;
  importedName: string;
  targetPath?: string;
}

export interface CallSiteRecord {
  path: string;
  line: number;
  calleeName: string;
  args: string[];
  argIdentityKinds: Array<string | null>;
}

export interface QueryUsageRecord {
  path: string;
  line: number;
  kind: "from" | "rpc" | "select";
  value: string;
}

export interface RoleSourceRecord {
  path: string;
  line: number;
  source: string;
}

const diagnosticAstCache = new WeakMap<ProjectStore, Map<string, { content: string; sourceFile: ts.SourceFile }>>();

export function readDiagnosticFiles(
  projectStore: ProjectStore,
  filePaths: string[],
): DiagnosticAstFile[] {
  let projectCache = diagnosticAstCache.get(projectStore);
  if (!projectCache) {
    projectCache = new Map();
    diagnosticAstCache.set(projectStore, projectCache);
  }

  const seen = new Set<string>();
  const files: DiagnosticAstFile[] = [];
  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    const content = projectStore.getFileContent(filePath);
    if (typeof content !== "string") continue;
    const cached = projectCache.get(filePath);
    const sourceFile =
      cached && cached.content === content
        ? cached.sourceFile
        : ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath));
    if (!cached || cached.content !== content) {
      projectCache.set(filePath, { content, sourceFile });
    }
    seen.add(filePath);
    files.push({
      path: filePath,
      content,
      sourceFile,
    });
  }
  return files;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function buildSurfaceIssue(input: DiagnosticIssueInput): AnswerSurfaceIssue {
  return {
    severity: input.severity,
    confidence: input.confidence,
    category: input.category,
    code: input.code,
    message: input.message,
    path: input.path,
    line: input.line,
    producerPath: input.producerPath,
    consumerPath: input.consumerPath,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort((left, right) => left.localeCompare(right)),
    identity: {
      matchBasedId: hashJson({
        category: input.category,
        code: input.code,
        matchKey: input.matchKey,
      }),
      codeHash: hashJson(input.codeFingerprint),
      patternHash: hashJson({ category: input.category, code: input.code, version: 1 }),
    },
    metadata: input.metadata,
  };
}

export function dedupeIssuesByMatchBasedId(issues: AnswerSurfaceIssue[]): AnswerSurfaceIssue[] {
  const seen = new Set<string>();
  const deduped: AnswerSurfaceIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.identity.matchBasedId)) {
      continue;
    }
    seen.add(issue.identity.matchBasedId);
    deduped.push(issue);
  }
  return deduped.sort((left, right) => left.code.localeCompare(right.code) || (left.path ?? "").localeCompare(right.path ?? ""));
}

export function canonicalizeFieldName(value: string): string {
  return value.replace(/[_-]+/g, "").toLowerCase();
}

export function splitIdentifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.:/\\]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function canonicalizePluralAware(value: string): string {
  const base = canonicalizeFieldName(value);
  if (base.length > 3 && base.endsWith("s") && !base.endsWith("ss")) {
    return base.slice(0, -1);
  }
  return base;
}

export function isSnakeCase(value: string): boolean {
  return value.includes("_");
}

export function isCamelCase(value: string): boolean {
  return /[a-z][A-Z]/.test(value);
}

export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function formatEvidenceRef(path: string, line?: number): string {
  return typeof line === "number" ? `${path}:L${line}` : path;
}

export function collectImportBindings(
  file: DiagnosticAstFile,
  projectStore: ProjectStore,
): ImportBindingRecord[] {
  const edges = projectStore.listImportsForFile(file.path);
  const bindings: ImportBindingRecord[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const targetPath = edges.find((edge) => edge.specifier === specifier)?.targetPath;
      const clause = node.importClause;
      if (clause?.name) {
        bindings.push({
          localName: clause.name.text,
          importedName: "default",
          targetPath,
        });
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          bindings.push({
            localName: element.name.text,
            importedName: (element.propertyName ?? element.name).text,
            targetPath,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file.sourceFile);
  return bindings;
}

export function collectFunctionParameters(file: DiagnosticAstFile): FunctionParameterRecord[] {
  const records: FunctionParameterRecord[] = [];

  const pushRecord = (
    node: ts.FunctionLikeDeclarationBase,
    functionName: string | undefined,
  ) => {
    if (!functionName) return;
    records.push({
      path: file.path,
      line: lineOf(file.sourceFile, node),
      functionName,
      parameterNames: node.parameters
        .map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : undefined))
        .filter((value): value is string => typeof value === "string"),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      pushRecord(node, node.name?.text);
    } else if (ts.isMethodDeclaration(node)) {
      pushRecord(node, ts.isIdentifier(node.name) ? node.name.text : undefined);
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) {
          pushRecord(declaration.initializer, declaration.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file.sourceFile);
  return records;
}

export function collectCallSites(
  file: DiagnosticAstFile,
): CallSiteRecord[] {
  const callSites: CallSiteRecord[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        callSites.push({
          path: file.path,
          line: lineOf(file.sourceFile, node),
          calleeName: expression.text,
          args: node.arguments.map((arg) => arg.getText(file.sourceFile)),
          argIdentityKinds: node.arguments.map((arg) => classifyIdentityKindFromNode(arg, file.sourceFile)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file.sourceFile);
  return callSites;
}

export function collectQueryUsages(file: DiagnosticAstFile): QueryUsageRecord[] {
  // Uses the shared code-intel ast-patterns primitive instead of walking the
  // TS AST by hand so we don't maintain two implementations of "find Supabase
  // .from() / .rpc() / .select() call sites" across composers + diagnostics.
  const methods: QueryUsageRecord["kind"][] = ["from", "rpc", "select"];
  const hits = methods.flatMap((method) =>
    findAstMatches(file.path, file.content, [
      { pattern: `$C.${method}('$V')`, captures: ["V"] },
      { pattern: `$C.${method}("$V")`, captures: ["V"] },
      { pattern: `$C.${method}('$V', $$$ARGS)`, captures: ["V"] },
      { pattern: `$C.${method}("$V", $$$ARGS)`, captures: ["V"] },
    ]).map((hit) => ({ method, hit })),
  );

  const seen = new Set<string>();
  const usages: QueryUsageRecord[] = [];
  for (const { method, hit } of hits) {
    const raw = hit.captures.V ?? "";
    // `$V` in a string-literal pattern captures the inner text directly when
    // the literal has no escapes. Strip any surrounding quotes defensively in
    // case the engine returns the whole literal for edge cases.
    const value = raw.replace(/^["'](.*)["']$/s, "$1");
    const dedupKey = `${method}:${hit.lineStart}:${value}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    usages.push({
      path: file.path,
      line: hit.lineStart,
      kind: method,
      value,
    });
  }
  return usages;
}

export function collectRoleSources(file: DiagnosticAstFile): RoleSourceRecord[] {
  const records: RoleSourceRecord[] = [];
  const seenSources = new Set<string>();
  const pushOnce = (source: string, line: number): void => {
    if (seenSources.has(source)) return;
    seenSources.add(source);
    records.push({ path: file.path, line, source });
  };

  const visit = (node: ts.Node): void => {
    // Any property access whose final segment is `role` (case-insensitive).
    // Captures `profile.role`, `user.role`, `session.role`, etc.
    if (ts.isPropertyAccessExpression(node) && node.name.text.toLowerCase() === "role") {
      const base = node.expression.getText(file.sourceFile);
      if (base) {
        pushOnce(`${base}.${node.name.text}`, lineOf(file.sourceFile, node));
      }
    }

    // Any call expression whose callee identifier contains `Role` as a word
    // (e.g., `getCurrentUserRole()`, `fetchUserRole()`, `resolveRole()`).
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && /role/i.test(callee.text) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(callee.text)) {
        pushOnce(callee.text, lineOf(file.sourceFile, node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file.sourceFile);
  // Preserve pre-existing "first match wins" behavior used by the drift
  // detector: stable ordering by line so callers get deterministic results.
  return records.sort((left, right) => left.line - right.line);
}

export function collectPropertyOccurrences(file: DiagnosticAstFile): FilePropertyOccurrence[] {
  const occurrences: FilePropertyOccurrence[] = [];

  const pushOccurrence = (
    propertyName: string,
    node: ts.Node,
    ownerKind: FilePropertyOccurrence["ownerKind"],
    ownerName?: string,
  ) => {
    occurrences.push({
      path: file.path,
      line: lineOf(file.sourceFile, node),
      propertyName,
      ownerKind,
      ownerName,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
          const propertyName = getPropertyNameText(member.name);
          if (propertyName) {
            pushOccurrence(propertyName, member.name, "interface_property", node.name.text);
          }
        }
      }
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (ts.isPropertySignature(member)) {
          const propertyName = getPropertyNameText(member.name);
          if (propertyName) {
            pushOccurrence(propertyName, member.name, "type_property", node.name.text);
          }
        }
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      let ownerName: string | undefined;
      const returnStatement = findEnclosingReturnStatement(node);
      if (returnStatement) {
        ownerName = nearestFunctionName(returnStatement);
      }
      if (ownerName) {
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const propertyName = getPropertyNameText(property.name);
            if (propertyName) {
              pushOccurrence(propertyName, property.name, "returned_object_property", ownerName);
            }
          }
        }
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      pushOccurrence(node.name.text, node.name, "property_access", node.expression.getText(file.sourceFile));
    }
    ts.forEachChild(node, visit);
  };

  visit(file.sourceFile);

  for (const alias of extractSelectAliases(file)) {
    occurrences.push({
      path: file.path,
      line: alias.line,
      propertyName: alias.alias,
      ownerKind: "query_alias",
      ownerName: alias.selectText,
    });
  }

  return occurrences;
}

function extractSelectAliases(file: DiagnosticAstFile): Array<{ alias: string; line: number; selectText: string }> {
  const aliases: Array<{ alias: string; line: number; selectText: string }> = [];
  for (const usage of collectQueryUsages(file)) {
    if (usage.kind !== "select") continue;
    const matches = usage.value.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g);
    for (const match of matches) {
      aliases.push({
        alias: match[1],
        line: usage.line,
        selectText: usage.value,
      });
    }
  }
  return aliases;
}

function nearestFunctionName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

function findEnclosingReturnStatement(node: ts.Expression): ts.ReturnStatement | undefined {
  let current: ts.Node = node;
  while (
    ts.isAsExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent) ||
    ts.isParenthesizedExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }

  return ts.isReturnStatement(current.parent) ? current.parent : undefined;
}

function getPropertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

export function classifyIdentityKind(name: string): string | null {
  const tokens = splitIdentifierTokens(name);
  const lastToken = tokens.at(-1);
  if (!lastToken) return null;

  if (tokens.includes("tenant") && ["tenant", "id", "slug", "key", "uuid", "ref", "identifier"].includes(lastToken)) {
    return "tenant";
  }
  if (tokens.includes("user") && ["user", "id", "email", "uuid", "ref", "identifier"].includes(lastToken)) {
    return "user";
  }
  if (tokens.includes("profile") && ["profile", "id", "uuid", "ref", "identifier"].includes(lastToken)) {
    return "profile";
  }
  return null;
}

function classifyIdentityKindFromNode(node: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (ts.isIdentifier(node)) {
    return classifyIdentityKind(node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const propertyKind = classifyIdentityKind(node.name.text);
    if (propertyKind) return propertyKind;
    return classifyIdentityKind(node.expression.getText(sourceFile));
  }
  return classifyIdentityKind(node.getText(sourceFile));
}
