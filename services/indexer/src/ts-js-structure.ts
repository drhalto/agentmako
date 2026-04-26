import path from "node:path";
import { getTsconfig } from "get-tsconfig";
import type { ProjectProfile } from "@mako-ai/contracts";
import type { IndexedFileRecord, RouteRecord, SymbolRecord } from "@mako-ai/store";
import { toRelativePath } from "@mako-ai/store";
import ts from "typescript";

const SOURCE_FILE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"] as const;
const RUNTIME_IMPORT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const SOURCE_ROUTE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const EXPRESS_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);
const compilerOptionsByRoot = new Map<string, ts.CompilerOptions>();

export interface ScannableTsJsFile {
  relativePath: string;
  content: string;
}

export interface NamedRouteDefinition {
  definitionId: string;
  objectName: string;
  routeName: string;
  method?: string;
  path: string;
  sourceFilePath: string;
  line: number;
}

export interface CollectedRoute {
  filePath: string;
  route: RouteRecord;
  priority: number;
}

interface RouteDefinitionValue {
  definition: NamedRouteDefinition;
  property: "method" | "path";
}

interface LocalRouteCandidate {
  pattern: string;
  method?: string;
  handlerName?: string;
  definition?: NamedRouteDefinition;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  const ext = path.posix.extname(relativePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".ts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

function parseSourceFile(relativePath: string, content: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(relativePath),
  );
}

function lineStart(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function lineEnd(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function firstLineText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).split(/\r?\n/, 1)[0]!.trim();
}

function modifiersOf(node: ts.Node): readonly ts.ModifierLike[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiersOf(node).some((modifier) => modifier.kind === kind);
}

function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (node == null) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (name == null) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function resolveKnownFileTarget(
  basePath: string,
  knownRelativePaths: Set<string>,
): string {
  const ext = path.posix.extname(basePath);
  const stem = ext === "" ? basePath : basePath.slice(0, -ext.length);
  const candidates: string[] = [];

  pushUnique(candidates, basePath);

  for (const candidateExt of SOURCE_FILE_EXTENSIONS) {
    pushUnique(candidates, `${stem}${candidateExt}`);
  }

  if (ext === "" || RUNTIME_IMPORT_EXTENSIONS.has(ext)) {
    for (const candidateExt of SOURCE_FILE_EXTENSIONS.slice(1)) {
      pushUnique(candidates, `${stem}/index${candidateExt}`);
    }
  }

  for (const candidate of candidates) {
    if (knownRelativePaths.has(candidate)) {
      return candidate;
    }
  }

  return basePath;
}

function compilerOptionsForRoot(rootPath: string): ts.CompilerOptions {
  const cached = compilerOptionsByRoot.get(rootPath);
  if (cached) {
    return cached;
  }

  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
  };

  const tsconfig = getTsconfig(rootPath);
  if (tsconfig) {
    const converted = ts.convertCompilerOptionsFromJson(
      tsconfig.config.compilerOptions ?? {},
      path.dirname(tsconfig.path),
    );
    options = {
      ...options,
      ...converted.options,
      allowJs: true,
      resolveJsonModule: true,
      moduleResolution: converted.options.moduleResolution ?? options.moduleResolution,
    };
  }

  compilerOptionsByRoot.set(rootPath, options);
  return options;
}

function resolveTypeScriptModuleTarget(
  rootPath: string,
  sourceRelativePath: string,
  specifier: string,
  knownRelativePaths: Set<string>,
): string | undefined {
  const sourceFileName = path.resolve(rootPath, sourceRelativePath);
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFileName,
    compilerOptionsForRoot(rootPath),
    ts.sys,
  ).resolvedModule;
  if (!resolved) {
    return undefined;
  }

  const relativePath = toRelativePath(rootPath, path.resolve(resolved.resolvedFileName));
  if (relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return undefined;
  }

  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (knownRelativePaths.has(normalizedPath)) {
    return normalizedPath;
  }

  const knownTarget = resolveKnownFileTarget(normalizedPath, knownRelativePaths);
  return knownRelativePaths.has(knownTarget) ? knownTarget : undefined;
}

function resolveRelativeImportTarget(
  rootPath: string,
  sourceRelativePath: string,
  specifier: string,
  knownRelativePaths: Set<string>,
  pathAliases: Record<string, string>,
): string {
  const typeScriptTarget = resolveTypeScriptModuleTarget(
    rootPath,
    sourceRelativePath,
    specifier,
    knownRelativePaths,
  );
  if (typeScriptTarget) {
    return typeScriptTarget;
  }

  if (!specifier.startsWith(".")) {
    const aliasEntries = Object.entries(pathAliases).sort(
      ([left], [right]) => right.length - left.length,
    );
    for (const [aliasPrefix, aliasTargetRoot] of aliasEntries) {
      if (!specifier.startsWith(aliasPrefix)) {
        continue;
      }
      const aliasRemainder = specifier.slice(aliasPrefix.length);
      const aliasTargetPath = toRelativePath(
        rootPath,
        path.resolve(aliasTargetRoot, aliasRemainder),
      );
      return resolveKnownFileTarget(aliasTargetPath, knownRelativePaths);
    }
    return specifier;
  }

  const sourceDirectory = path.posix.dirname(sourceRelativePath);
  const basePath = path.posix.normalize(path.posix.join(sourceDirectory, specifier));
  return resolveKnownFileTarget(basePath, knownRelativePaths);
}

function importKindForSpecifier(
  specifier: string,
  pathAliases: Record<string, string>,
  options: { reExport: boolean },
): string {
  const isAlias = Object.keys(pathAliases).some((aliasPrefix) => specifier.startsWith(aliasPrefix));
  if (options.reExport && specifier.startsWith(".")) {
    return "re-export";
  }
  if (specifier.startsWith(".")) {
    return "relative";
  }
  return isAlias ? "alias" : "package";
}

export function collectImportEdgesFromAst(
  rootPath: string,
  content: string,
  sourceRelativePath: string,
  knownRelativePaths: Set<string>,
  pathAliases: Record<string, string>,
): IndexedFileRecord["imports"] {
  const sourceFile = parseSourceFile(sourceRelativePath, content);
  const imports: IndexedFileRecord["imports"] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      if (specifier == null) {
        continue;
      }
      imports.push({
        specifier,
        targetPath: resolveRelativeImportTarget(
          rootPath,
          sourceRelativePath,
          specifier,
          knownRelativePaths,
          pathAliases,
        ),
        importKind: importKindForSpecifier(specifier, pathAliases, { reExport: false }),
        isTypeOnly: statement.importClause?.isTypeOnly === true,
        line: lineStart(sourceFile, statement),
      });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      if (specifier == null) {
        continue;
      }
      imports.push({
        specifier,
        targetPath: resolveRelativeImportTarget(
          rootPath,
          sourceRelativePath,
          specifier,
          knownRelativePaths,
          pathAliases,
        ),
        importKind: importKindForSpecifier(specifier, pathAliases, { reExport: true }),
        isTypeOnly: statement.isTypeOnly,
        line: lineStart(sourceFile, statement),
      });
    }
  }

  return imports;
}

function pushDeclarationSymbol(
  symbols: SymbolRecord[],
  sourceFile: ts.SourceFile,
  node:
    | ts.FunctionDeclaration
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.EnumDeclaration,
  kind: string,
): void {
  if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    return;
  }
  const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const name = node.name?.text ?? "default";
  const exportName = isDefault ? "default" : name;
  symbols.push({
    name: exportName,
    kind,
    exportName,
    lineStart: lineStart(sourceFile, node),
    lineEnd: lineEnd(sourceFile, node),
    signatureText: firstLineText(sourceFile, node),
  });
}

export function collectExportedSymbolsFromAst(content: string, relativePath = "module.ts"): SymbolRecord[] {
  const sourceFile = parseSourceFile(relativePath, content);
  const symbols: SymbolRecord[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement)) {
      pushDeclarationSymbol(symbols, sourceFile, statement, "class");
      continue;
    }
    if (ts.isInterfaceDeclaration(statement)) {
      pushDeclarationSymbol(symbols, sourceFile, statement, "interface");
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      pushDeclarationSymbol(symbols, sourceFile, statement, "type");
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      pushDeclarationSymbol(symbols, sourceFile, statement, "function");
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      pushDeclarationSymbol(symbols, sourceFile, statement, "enum");
      continue;
    }
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const symbolName = declaration.name.text;
        symbols.push({
          name: symbolName,
          kind: "variable",
          exportName: symbolName,
          lineStart: lineStart(sourceFile, declaration),
          lineEnd: lineEnd(sourceFile, declaration),
          signatureText: firstLineText(sourceFile, statement),
        });
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        symbols.push({
          name: element.name.text,
          kind: "export",
          exportName: element.name.text,
          lineStart: lineStart(sourceFile, element),
          lineEnd: lineEnd(sourceFile, element),
          signatureText: firstLineText(sourceFile, statement),
        });
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      symbols.push({
        name: "default",
        kind: "export",
        exportName: "default",
        lineStart: lineStart(sourceFile, statement),
        lineEnd: lineEnd(sourceFile, statement),
        signatureText: firstLineText(sourceFile, statement),
      });
    }
  }

  return symbols;
}

function createLocalHttpRouteKey(pattern: string, method?: string): string {
  return `local-http:${method ?? "ANY"}:${pattern}`;
}

function normalizeMethod(methodValue: string | undefined): string | undefined {
  if (!methodValue) {
    return undefined;
  }
  const normalized = methodValue.toUpperCase();
  return normalized === "ALL" ? undefined : normalized;
}

function mapRouteSegment(segment: string): string | null {
  if (segment === "" || (segment.startsWith("(") && segment.endsWith(")"))) {
    return null;
  }

  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return `:${segment.slice(5, -2)}?`;
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `:${segment.slice(4, -1)}*`;
  }

  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }

  return segment;
}

function toRoutePattern(segments: string[]): string {
  const mapped = segments.map(mapRouteSegment).filter((segment): segment is string => segment != null && segment !== "");
  return mapped.length === 0 ? "/" : `/${mapped.join("/")}`;
}

function collectNextRouteMethods(sourceFile: ts.SourceFile): string[] {
  const methods = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const method = statement.name?.text.toUpperCase();
      if (method && HTTP_METHODS.has(method)) {
        methods.add(method);
      }
      continue;
    }
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const method = declaration.name.text.toUpperCase();
          if (HTTP_METHODS.has(method)) {
            methods.add(method);
          }
        }
      }
    }
  }
  return [...methods].sort();
}

function collectNextRoutes(relativePath: string, content: string): CollectedRoute[] {
  const routes: CollectedRoute[] = [];
  const normalizedPath = relativePath.startsWith("src/") ? relativePath.slice(4) : relativePath;
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  if (!SOURCE_ROUTE_EXTENSIONS.has(ext)) {
    return routes;
  }
  const basename = path.posix.basename(normalizedPath, ext);

  if (normalizedPath.startsWith("app/") && basename === "page") {
    const directory = path.posix.dirname(normalizedPath).slice("app".length).replace(/^\/+/, "");
    const pattern = toRoutePattern(directory === "" || directory === "." ? [] : directory.split("/"));
    routes.push({
      filePath: relativePath,
      priority: 2,
      route: {
        routeKey: `page:${pattern}`,
        framework: "nextjs",
        pattern,
        handlerName: "default",
        isApi: false,
        metadata: { kind: "page", routeKind: "handler" },
      },
    });
  }

  if (normalizedPath.startsWith("app/") && basename === "route") {
    const directory = path.posix.dirname(normalizedPath).slice("app".length).replace(/^\/+/, "");
    const pattern = toRoutePattern(directory === "" || directory === "." ? [] : directory.split("/"));
    const methods = collectNextRouteMethods(parseSourceFile(relativePath, content));
    for (const method of methods.length === 0 ? [undefined] : methods) {
      routes.push({
        filePath: relativePath,
        priority: 2,
        route: {
          routeKey: `route:${pattern}:${method ?? "ANY"}`,
          framework: "nextjs",
          pattern,
          method,
          handlerName: method ?? "route-handler",
          isApi: true,
          metadata: { kind: "route-handler", routeKind: "handler" },
        },
      });
    }
  }

  if (normalizedPath.startsWith("pages/api/")) {
    const withoutPrefix = normalizedPath.slice("pages/api/".length);
    const withoutExtension = withoutPrefix.slice(0, -ext.length);
    const routePath = withoutExtension.endsWith("/index")
      ? withoutExtension.slice(0, -"/index".length)
      : withoutExtension;
    const pattern = toRoutePattern(routePath === "" ? ["api"] : ["api", ...routePath.split("/")]);
    routes.push({
      filePath: relativePath,
      priority: 2,
      route: {
        routeKey: `api:${pattern}`,
        framework: "nextjs",
        pattern,
        handlerName: "default",
        isApi: true,
        metadata: { kind: "pages-api", routeKind: "handler" },
      },
    });
  }

  return routes;
}

function routeDefinitionValueFromPropertyAccess(
  expression: ts.Expression,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
): RouteDefinitionValue | undefined {
  if (!ts.isPropertyAccessExpression(expression)) {
    return undefined;
  }
  const property = expression.name.text;
  if (property !== "path" && property !== "method") {
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(expression.expression)) {
    return undefined;
  }
  const routeName = expression.expression.name.text;
  const objectExpression = expression.expression.expression;
  if (!ts.isIdentifier(objectExpression)) {
    return undefined;
  }
  const definition = routeDefinitions.get(objectExpression.text)?.get(routeName);
  return definition ? { definition, property } : undefined;
}

function literalRoutePath(expression: ts.Expression): string | undefined {
  return stringLiteralValue(unwrapExpression(expression));
}

function extractRoutePath(
  expression: ts.Expression,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
): { path: string; definition?: NamedRouteDefinition } | undefined {
  const unwrapped = unwrapExpression(expression);
  const literal = literalRoutePath(unwrapped);
  if (literal != null) {
    return { path: literal };
  }
  const definitionValue = routeDefinitionValueFromPropertyAccess(unwrapped, routeDefinitions);
  if (definitionValue?.property === "path") {
    return {
      path: definitionValue.definition.path,
      definition: definitionValue.definition,
    };
  }
  return undefined;
}

function extractRouteMethod(
  expression: ts.Expression,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
): { method?: string; definition?: NamedRouteDefinition } | undefined {
  const unwrapped = unwrapExpression(expression);
  const literal = stringLiteralValue(unwrapped);
  if (literal != null) {
    return { method: normalizeMethod(literal) };
  }
  const definitionValue = routeDefinitionValueFromPropertyAccess(unwrapped, routeDefinitions);
  if (definitionValue?.property === "method") {
    return {
      method: definitionValue.definition.method,
      definition: definitionValue.definition,
    };
  }
  return undefined;
}

function isMethodSubject(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isIdentifier(unwrapped) && unwrapped.text === "method"
  ) || (
    ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "method"
  );
}

function isPathSubject(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isIdentifier(unwrapped) && unwrapped.text === "pathname"
  ) || (
    ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "pathname"
  );
}

function extractEqualityParts(
  node: ts.Node,
): { left: ts.Expression; right: ts.Expression } | undefined {
  if (!ts.isBinaryExpression(node)) {
    return undefined;
  }
  if (
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
  ) {
    return undefined;
  }
  return { left: node.left, right: node.right };
}

function collectAndTerms(node: ts.Expression): ts.Expression[] {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [...collectAndTerms(node.left), ...collectAndTerms(node.right)];
  }
  return [node];
}

function routeCandidateFromCondition(
  expression: ts.Expression,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
  handlerName?: string,
): LocalRouteCandidate | undefined {
  const terms = collectAndTerms(expression);
  let methodValue: { method?: string; definition?: NamedRouteDefinition } | undefined;
  let pathValue: { path: string; definition?: NamedRouteDefinition } | undefined;

  for (const term of terms) {
    const equality = extractEqualityParts(term);
    if (equality == null) {
      continue;
    }
    if (isMethodSubject(equality.left)) {
      methodValue = extractRouteMethod(equality.right, routeDefinitions) ?? methodValue;
      continue;
    }
    if (isMethodSubject(equality.right)) {
      methodValue = extractRouteMethod(equality.left, routeDefinitions) ?? methodValue;
      continue;
    }
    if (isPathSubject(equality.left)) {
      pathValue = extractRoutePath(equality.right, routeDefinitions) ?? pathValue;
      continue;
    }
    if (isPathSubject(equality.right)) {
      pathValue = extractRoutePath(equality.left, routeDefinitions) ?? pathValue;
    }
  }

  if (pathValue == null || methodValue == null) {
    return undefined;
  }

  return {
    pattern: pathValue.path,
    method: methodValue.method,
    handlerName,
    definition: pathValue.definition ?? methodValue.definition,
  };
}

function inferHandlerNameFromAncestors(ancestors: readonly ts.Node[]): string | undefined {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ancestors[i]!;
    if (ts.isFunctionDeclaration(ancestor) && ancestor.name) {
      return ancestor.name.text;
    }
    if (ts.isMethodDeclaration(ancestor)) {
      return propertyNameText(ancestor.name);
    }
    if (ts.isVariableDeclaration(ancestor) && ts.isIdentifier(ancestor.name)) {
      return ancestor.name.text;
    }
  }
  return undefined;
}

function handlerNameFromArgument(argument: ts.Expression | undefined): string | undefined {
  if (argument == null) {
    return undefined;
  }
  const unwrapped = unwrapExpression(argument);
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isFunctionExpression(unwrapped) && unwrapped.name) {
    return unwrapped.name.text;
  }
  return undefined;
}

function routeCandidateFromExpressCall(
  node: ts.CallExpression,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
  ancestors: readonly ts.Node[],
): LocalRouteCandidate | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const rawMethod = node.expression.name.text.toLowerCase();
  if (!EXPRESS_METHODS.has(rawMethod)) {
    return undefined;
  }
  const firstArgument = node.arguments[0];
  if (firstArgument == null) {
    return undefined;
  }
  const pathValue = extractRoutePath(firstArgument, routeDefinitions);
  if (pathValue == null) {
    return undefined;
  }
  const method = normalizeMethod(rawMethod);
  return {
    pattern: pathValue.path,
    method: method ?? pathValue.definition?.method,
    handlerName: handlerNameFromArgument(node.arguments[1]) ?? inferHandlerNameFromAncestors(ancestors),
    definition: pathValue.definition,
  };
}

function collectLocalHttpHandlerRoutes(
  relativePath: string,
  content: string,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
  referencedDefinitionIds: Set<string>,
): CollectedRoute[] {
  const sourceFile = parseSourceFile(relativePath, content);
  const routes: CollectedRoute[] = [];
  const emittedRouteKeys = new Set<string>();

  const emit = (candidate: LocalRouteCandidate): void => {
    if (candidate.definition) {
      referencedDefinitionIds.add(candidate.definition.definitionId);
    }
    const routeKey = createLocalHttpRouteKey(candidate.pattern, candidate.method);
    if (emittedRouteKeys.has(routeKey)) {
      return;
    }
    emittedRouteKeys.add(routeKey);
    routes.push({
      filePath: relativePath,
      priority: 2,
      route: {
        routeKey,
        framework: "local-http",
        pattern: candidate.pattern,
        method: candidate.method,
        handlerName: candidate.handlerName ?? candidate.definition?.routeName,
        isApi: true,
        metadata: {
          kind: "local-http-handler",
          routeKind: "handler",
          ...(candidate.definition
            ? {
                definitionExport: `${candidate.definition.objectName}.${candidate.definition.routeName}`,
                definitionFilePath: candidate.definition.sourceFilePath,
                definitionLine: candidate.definition.line,
              }
            : {}),
        },
      },
    });
  };

  const visit = (node: ts.Node, ancestors: ts.Node[]): void => {
    if (ts.isCallExpression(node)) {
      const candidate = routeCandidateFromExpressCall(node, routeDefinitions, ancestors);
      if (candidate) {
        emit(candidate);
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const candidate = routeCandidateFromCondition(
        node,
        routeDefinitions,
        inferHandlerNameFromAncestors(ancestors),
      );
      if (candidate) {
        emit(candidate);
      }
    }

    ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
  };

  visit(sourceFile, []);
  return routes;
}

function collectLocalHttpDefinitionRoutes(
  relativePath: string,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
  referencedDefinitionIds: Set<string>,
): CollectedRoute[] {
  const routes: CollectedRoute[] = [];

  for (const definitionsForObject of routeDefinitions.values()) {
    for (const definition of definitionsForObject.values()) {
      if (definition.sourceFilePath !== relativePath || referencedDefinitionIds.has(definition.definitionId)) {
        continue;
      }

      routes.push({
        filePath: relativePath,
        priority: 1,
        route: {
          routeKey: createLocalHttpRouteKey(definition.path, definition.method),
          framework: "local-http",
          pattern: definition.path,
          method: definition.method,
          handlerName: definition.routeName,
          isApi: true,
          metadata: {
            kind: "local-http-definition",
            routeKind: "definition",
            definitionExport: `${definition.objectName}.${definition.routeName}`,
            definitionFilePath: definition.sourceFilePath,
            definitionLine: definition.line,
          },
        },
      });
    }
  }

  return routes;
}

function collectRouteDefinitionsForFile(file: ScannableTsJsFile): NamedRouteDefinition[] {
  const sourceFile = parseSourceFile(file.relativePath, file.content);
  const definitions: NamedRouteDefinition[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer == null) {
        continue;
      }
      const objectName = declaration.name.text;
      if (!objectName.toLowerCase().includes("route")) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) {
        continue;
      }
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue;
        }
        const routeName = propertyNameText(property.name);
        if (routeName == null) {
          continue;
        }
        const entryValue = unwrapExpression(property.initializer);
        if (!ts.isObjectLiteralExpression(entryValue)) {
          continue;
        }
        let routePath: string | undefined;
        let method: string | undefined;
        for (const entryProperty of entryValue.properties) {
          if (!ts.isPropertyAssignment(entryProperty)) {
            continue;
          }
          const name = propertyNameText(entryProperty.name);
          if (name === "path") {
            routePath = stringLiteralValue(unwrapExpression(entryProperty.initializer));
          } else if (name === "method") {
            method = normalizeMethod(stringLiteralValue(unwrapExpression(entryProperty.initializer)));
          }
        }
        if (routePath == null) {
          continue;
        }
        definitions.push({
          definitionId: `${file.relativePath}:${objectName}.${routeName}`,
          objectName,
          routeName,
          method,
          path: routePath,
          sourceFilePath: file.relativePath,
          line: lineStart(sourceFile, property),
        });
      }
    }
  }

  return definitions;
}

export function buildNamedRouteDefinitionIndex(
  files: ScannableTsJsFile[],
): Map<string, Map<string, NamedRouteDefinition>> {
  const definitionsByObject = new Map<string, Map<string, NamedRouteDefinition>>();

  for (const file of files) {
    for (const definition of collectRouteDefinitionsForFile(file)) {
      const definitionsForObject = definitionsByObject.get(definition.objectName) ?? new Map<string, NamedRouteDefinition>();
      definitionsForObject.set(definition.routeName, definition);
      definitionsByObject.set(definition.objectName, definitionsForObject);
    }
  }

  return definitionsByObject;
}

export function collectRoutesFromAst(
  relativePath: string,
  profile: ProjectProfile,
  content: string,
  routeDefinitions: Map<string, Map<string, NamedRouteDefinition>>,
  referencedDefinitionIds: Set<string>,
): CollectedRoute[] {
  const routes: CollectedRoute[] = [];

  if (profile.framework === "nextjs") {
    routes.push(...collectNextRoutes(relativePath, content));
  }

  routes.push(...collectLocalHttpHandlerRoutes(relativePath, content, routeDefinitions, referencedDefinitionIds));
  routes.push(...collectLocalHttpDefinitionRoutes(relativePath, routeDefinitions, referencedDefinitionIds));

  return routes;
}
