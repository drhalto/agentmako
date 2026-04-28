import type {
  ReefStructuralDefinition,
  ReefStructuralUsage,
  ReefWhereUsedToolInput,
  ReefWhereUsedToolOutput,
} from "@mako-ai/contracts";
import type { FileImportLink, FileSummaryRecord, ResolvedRouteRecord, SymbolRecord } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { buildReefToolExecution, defaultReefToolFreshnessPolicy } from "./tool-execution.js";

export async function reefWhereUsedTool(
  input: ReefWhereUsedToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefWhereUsedToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const query = input.query.trim();
    const limit = input.limit ?? 50;
    const freshnessPolicy = defaultReefToolFreshnessPolicy(input.freshnessPolicy);
    const files = projectStore.listFiles();
    const definitions: ReefStructuralDefinition[] = [];

    for (const file of files) {
      if (matchesFile(file, query, input.targetKind)) {
        definitions.push(fileDefinition(file));
      }
    }

    for (const file of files) {
      for (const symbol of projectStore.listSymbolsForFile(file.path)) {
        if (matchesSymbol(symbol, query, input.targetKind)) {
          definitions.push(symbolDefinition(file.path, symbol));
        }
      }
    }

    for (const route of projectStore.listRoutes()) {
      if (matchesRoute(route, query, input.targetKind)) {
        definitions.push(routeDefinition(route));
      }
    }

    const definitionPaths = new Set(definitions.map((definition) => definition.filePath));
    const targetRequiresIdentifierCheck = input.targetKind === "symbol" || input.targetKind === "component";
    const candidateUsages = dedupeUsages([
      ...definitionUsages(definitions),
      ...(targetRequiresIdentifierCheck ? [] : importUsages(projectStore.listAllImportEdges(), query, definitionPaths)),
      ...dependentUsages(projectStore, definitionPaths, targetRequiresIdentifierCheck ? query : undefined),
    ]);
    let usages = candidateUsages.slice(0, limit);
    let limitedDefinitions = definitions.slice(0, limit);
    const reefExecution = await buildReefToolExecution({
      toolName: "reef_where_used",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy,
      returnedCount: limitedDefinitions.length + usages.length,
    });
    const warnings: string[] = [];
    if (targetRequiresIdentifierCheck && definitions.length > 0) {
      warnings.push("Symbol/component usages are limited to maintained import edges whose indexed source contains the identifier; use ast_find_pattern when exact local references are required.");
    }
    if (reefExecution.snapshot.state !== "fresh" && freshnessPolicy !== "allow_stale_labeled") {
      const droppedCount = definitions.length + candidateUsages.length;
      limitedDefinitions = [];
      usages = [];
      if (droppedCount > 0) {
        warnings.push(`Dropped ${droppedCount} maintained structural results because Reef snapshot state is ${reefExecution.snapshot.state} under freshnessPolicy=${freshnessPolicy}.`);
      }
    } else if (reefExecution.snapshot.state !== "fresh" && limitedDefinitions.length + usages.length > 0) {
      warnings.push(`Returned maintained structural results with Reef snapshot state ${reefExecution.snapshot.state} under freshnessPolicy=allow_stale_labeled.`);
    }
    usages = stampUsageRevision(usages, reefExecution.snapshot.revision);

    return {
      toolName: "reef_where_used",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      query,
      ...(input.targetKind ? { targetKind: input.targetKind } : {}),
      definitions: limitedDefinitions,
      usages,
      totalReturned: limitedDefinitions.length + usages.length,
      reefExecution,
      ...(usages.length === 0 && limitedDefinitions.length === 0
        ? { fallbackRecommendation: "No maintained Reef structural match was found; use live_text_search or ast_find_pattern as an explicit fallback." }
        : {}),
      warnings,
    };
  });
}

function matchesSymbol(
  symbol: SymbolRecord,
  query: string,
  targetKind: ReefWhereUsedToolInput["targetKind"],
): boolean {
  if (targetKind === "route" || targetKind === "file") {
    return false;
  }
  const normalized = query.toLowerCase();
  return symbol.name.toLowerCase() === normalized
    || symbol.exportName?.toLowerCase() === normalized
    || (targetKind !== "component" && symbol.name.toLowerCase().includes(normalized))
    || (targetKind === "component" && isLikelyComponent(symbol.name) && symbol.name.toLowerCase().includes(normalized));
}

function matchesRoute(
  route: ResolvedRouteRecord,
  query: string,
  targetKind: ReefWhereUsedToolInput["targetKind"],
): boolean {
  if (targetKind && targetKind !== "route" && targetKind !== "pattern") {
    return false;
  }
  const normalized = query.toLowerCase();
  return route.routeKey.toLowerCase().includes(normalized)
    || route.pattern.toLowerCase().includes(normalized)
    || route.filePath.toLowerCase().includes(normalized)
    || route.handlerName?.toLowerCase().includes(normalized) === true;
}

function matchesFile(
  file: FileSummaryRecord,
  query: string,
  targetKind: ReefWhereUsedToolInput["targetKind"],
): boolean {
  if (targetKind && targetKind !== "file" && targetKind !== "pattern") {
    return false;
  }
  const normalized = query.toLowerCase();
  const fileName = file.path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? file.path.toLowerCase();
  return file.path.toLowerCase().includes(normalized) || fileName.includes(normalized);
}

function fileDefinition(file: FileSummaryRecord): ReefStructuralDefinition {
  return {
    filePath: file.path,
    name: file.path,
    kind: file.language,
    source: "file_index",
    metadata: {
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount,
      isGenerated: file.isGenerated,
    },
  };
}

function symbolDefinition(filePath: string, symbol: SymbolRecord): ReefStructuralDefinition {
  return {
    filePath,
    name: symbol.exportName ?? symbol.name,
    kind: symbol.kind,
    source: "symbol_index",
    ...(symbol.lineStart != null ? { lineStart: symbol.lineStart } : {}),
    ...(symbol.lineEnd != null ? { lineEnd: symbol.lineEnd } : {}),
    ...(symbol.metadata ? { metadata: symbol.metadata } : {}),
  };
}

function routeDefinition(route: ResolvedRouteRecord): ReefStructuralDefinition {
  return {
    filePath: route.filePath,
    name: route.routeKey,
    kind: route.isApi ? "api_route" : "route",
    source: "route_index",
    metadata: {
      framework: route.framework,
      pattern: route.pattern,
      ...(route.method ? { method: route.method } : {}),
      ...(route.handlerName ? { handlerName: route.handlerName } : {}),
    },
  };
}

function definitionUsages(definitions: readonly ReefStructuralDefinition[]): ReefStructuralUsage[] {
  return definitions.map((definition) => ({
    filePath: definition.filePath,
    usageKind: definition.source === "route_index" ? "route_owner" : "definition",
    reason: `${definition.name} is defined in maintained ${definition.source}.`,
    provenance: {
      source: "maintained_reef_state",
      producer: definition.source,
    },
  }));
}

function importUsages(
  imports: readonly FileImportLink[],
  query: string,
  definitionPaths: ReadonlySet<string>,
): ReefStructuralUsage[] {
  const normalized = query.toLowerCase();
  return imports
    .filter((edge) =>
      definitionPaths.has(edge.targetPath)
      || edge.specifier.toLowerCase().includes(normalized)
      || edge.targetPath.toLowerCase().includes(normalized)
    )
    .map((edge) => ({
      filePath: edge.sourcePath,
      usageKind: "import" as const,
      targetPath: edge.targetPath,
      specifier: edge.specifier,
      ...(edge.line != null ? { line: edge.line } : {}),
      reason: definitionPaths.has(edge.targetPath)
        ? `imports a maintained definition target ${edge.targetPath}`
        : `import edge matches ${query}`,
      provenance: {
        source: "maintained_reef_state" as const,
        producer: "import_edges",
      },
    }));
}

function dependentUsages(
  projectStore: {
    getFileContent(filePath: string): string | null;
    listDependentsForFile(filePath: string): FileImportLink[];
  },
  definitionPaths: ReadonlySet<string>,
  requiredIdentifier?: string,
): ReefStructuralUsage[] {
  const usages: ReefStructuralUsage[] = [];
  for (const filePath of definitionPaths) {
    for (const edge of projectStore.listDependentsForFile(filePath)) {
      if (requiredIdentifier && !fileContentReferencesIdentifier(projectStore.getFileContent(edge.sourcePath), requiredIdentifier)) {
        continue;
      }
      usages.push({
        filePath: edge.sourcePath,
        usageKind: "dependent",
        targetPath: edge.targetPath,
        specifier: edge.specifier,
        ...(edge.line != null ? { line: edge.line } : {}),
        reason: requiredIdentifier
          ? `references ${requiredIdentifier} while importing maintained target ${filePath}`
          : `depends on maintained target ${filePath}`,
        provenance: {
          source: "maintained_reef_state",
          producer: "import_edges",
        },
      });
    }
  }
  return usages;
}

function fileContentReferencesIdentifier(content: string | null, identifier: string): boolean {
  if (!content) {
    return false;
  }
  const withoutStringLiterals = content.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/gu, "");
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}([^A-Za-z0-9_$]|$)`, "u").test(withoutStringLiterals);
}

function stampUsageRevision(usages: readonly ReefStructuralUsage[], revision: number | undefined): ReefStructuralUsage[] {
  if (revision === undefined) {
    return [...usages];
  }
  return usages.map((usage) => ({
    ...usage,
    provenance: {
      ...usage.provenance,
      revision,
    },
  }));
}

function dedupeUsages(usages: readonly ReefStructuralUsage[]): ReefStructuralUsage[] {
  const seen = new Set<string>();
  const out: ReefStructuralUsage[] = [];
  for (const usage of usages) {
    const key = [
      usage.filePath,
      usage.usageKind,
      usage.targetPath ?? "",
      usage.specifier ?? "",
      usage.line ?? "",
    ].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(usage);
  }
  return out.sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }
    return left.usageKind.localeCompare(right.usageKind);
  });
}

function isLikelyComponent(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/u.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
