import type { ProjectConvention, ProjectConventionsToolInput, ProjectConventionsToolOutput } from "@mako-ai/contracts";
import type { FileSummaryRecord, ProjectStore, ResolvedRouteRecord, SymbolRecord } from "@mako-ai/store";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  addConvention,
  conventionStatus,
  filePathFromFact,
  inferConventionKind,
  ruleSearchText,
  stringDataValue,
} from "./shared.js";

const AUTH_GUARD_RE = /(?:auth|session|permission|role|guard|verify|require|protect)/i;

function addDerivedProfileConventions(conventions: Map<string, ProjectConvention>, projectStore: ProjectStore): void {
  const profile = projectStore.loadProjectProfile()?.profile;
  if (!profile) return;

  for (const symbol of profile.authGuardSymbols) {
    addConvention(conventions, {
      id: `profile:auth_guard:${symbol}`,
      kind: "auth_guard",
      title: `Auth guard symbol ${symbol}`,
      status: "accepted",
      source: "project_profile",
      confidence: 0.88,
      whyIncluded: "Project profile detected this symbol as an auth guard.",
      evidence: [symbol],
      metadata: { framework: profile.framework },
    });
  }

  for (const filePath of profile.middlewareFiles) {
    addConvention(conventions, {
      id: `profile:middleware:${filePath}`,
      kind: "runtime_boundary",
      title: `Middleware boundary ${filePath}`,
      status: "accepted",
      source: "project_profile",
      confidence: 0.82,
      whyIncluded: "Project profile lists this file as middleware.",
      filePath,
      evidence: [filePath],
      metadata: { framework: profile.framework },
    });
  }

  for (const modulePath of profile.serverOnlyModules) {
    addConvention(conventions, {
      id: `profile:server_only:${modulePath}`,
      kind: "runtime_boundary",
      title: `Server-only module ${modulePath}`,
      status: "accepted",
      source: "project_profile",
      confidence: 0.82,
      whyIncluded: "Project profile lists this module as server-only.",
      filePath: modulePath,
      evidence: [modulePath],
      metadata: { framework: profile.framework },
    });
  }
}

function addIndexedAuthGuardConventions(
  conventions: Map<string, ProjectConvention>,
  projectStore: ProjectStore,
  files: readonly FileSummaryRecord[],
): void {
  for (const file of files.slice(0, 500)) {
    for (const symbol of projectStore.listSymbolsForFile(file.path)) {
      if (!isLikelyAuthGuardSymbol(symbol)) continue;
      addConvention(conventions, {
        id: `index:auth_guard:${file.path}:${symbol.name}`,
        kind: "auth_guard",
        title: `Potential auth guard ${symbol.name}`,
        status: "candidate",
        source: "index:symbols",
        confidence: 0.68,
        whyIncluded: "Indexed symbol name/signature matches common auth guard naming.",
        filePath: file.path,
        evidence: [`${file.path}:${symbol.lineStart ?? 1}`],
        metadata: {
          symbolName: symbol.name,
          symbolKind: symbol.kind,
          ...(symbol.exportName ? { exportName: symbol.exportName } : {}),
        },
      });
    }
  }
}

function isLikelyAuthGuardSymbol(symbol: SymbolRecord): boolean {
  const text = `${symbol.name} ${symbol.exportName ?? ""} ${symbol.signatureText ?? ""}`;
  if (!AUTH_GUARD_RE.test(text)) return false;
  return /^(?:get|require|verify|assert|ensure|check|protect|with|use|has|is)/i.test(symbol.name)
    || /\b(auth|session|permission|role|guard)\b/i.test(text);
}

function addRoutePatternConvention(conventions: Map<string, ProjectConvention>, routes: readonly ResolvedRouteRecord[]): void {
  if (routes.length === 0) return;

  const appRouterRoutes = routes.filter((route) => /(^|\/)app\/.+\/(?:page|layout|route)\.[jt]sx?$/i.test(route.filePath));
  const apiRoutes = routes.filter((route) => route.isApi || route.pattern.startsWith("/api/"));
  const sampleRoutes = routes.slice(0, 5).map((route) => route.pattern);
  const sampleFile = routes[0]?.filePath;

  addConvention(conventions, {
    id: "index:route_pattern:routes",
    kind: "route_pattern",
    title: appRouterRoutes.length > 0 ? "Routes follow App Router file conventions" : "Indexed route patterns",
    status: "candidate",
    source: "index:routes",
    confidence: appRouterRoutes.length > 0 ? 0.74 : 0.62,
    whyIncluded: "Indexed route records reveal the project's route layout convention.",
    ...(sampleFile ? { filePath: sampleFile } : {}),
    evidence: sampleRoutes.length > 0 ? sampleRoutes : routes.map((route) => route.routeKey).slice(0, 5),
    metadata: {
      routeCount: routes.length,
      appRouterRouteCount: appRouterRoutes.length,
      apiRouteCount: apiRoutes.length,
      examples: sampleRoutes,
    },
  });
}

function addGeneratedPathConvention(conventions: Map<string, ProjectConvention>, files: readonly FileSummaryRecord[]): void {
  const generated = files.filter((file) =>
    file.isGenerated ||
    /(^|\/)(?:__generated__|generated|gen)\//i.test(file.path) ||
    /(?:^|[./-])generated\.[jt]sx?$/i.test(file.path) ||
    /(?:database|schema)\.types\.ts$/i.test(file.path)
  );
  if (generated.length === 0) return;

  addConvention(conventions, {
    id: "index:generated_path:files",
    kind: "generated_path",
    title: "Generated files should be treated as derived artifacts",
    status: "candidate",
    source: "index:files",
    confidence: 0.72,
    whyIncluded: "Indexed files include generated-file markers or generated path names.",
    filePath: generated[0]?.path,
    evidence: generated.slice(0, 5).map((file) => file.path),
    metadata: {
      generatedFileCount: generated.length,
      examples: generated.slice(0, 5).map((file) => file.path),
    },
  });
}

function addSchemaUsageConvention(conventions: Map<string, ProjectConvention>, projectStore: ProjectStore): void {
  const objects = projectStore.listSchemaObjects();
  const examples: string[] = [];
  let usageCount = 0;

  for (const object of objects.slice(0, 100)) {
    const usages = projectStore.listSchemaUsages(object.objectId);
    usageCount += usages.length;
    for (const usage of usages) {
      if (examples.length >= 5) break;
      examples.push(`${object.schemaName}.${object.objectName}:${usage.filePath}`);
    }
    if (examples.length >= 5 && usageCount >= 10) break;
  }

  if (usageCount === 0) return;

  addConvention(conventions, {
    id: "index:schema_usage:app_code",
    kind: "schema_pattern",
    title: "App code references indexed schema objects",
    status: "candidate",
    source: "index:schema_usage",
    confidence: 0.7,
    whyIncluded: "Indexed schema usage records show how app code reaches database objects.",
    evidence: examples.length > 0 ? examples : [`schema usages: ${usageCount}`],
    metadata: {
      schemaObjectCount: objects.length,
      schemaUsageCount: usageCount,
      examples,
    },
  });
}

interface CollectProjectConventionsInput {
  kind?: string;
  status?: ProjectConventionsToolInput["status"];
  limit?: number;
}

export function collectProjectConventions(
  projectStore: ProjectStore,
  projectId: string,
  input: CollectProjectConventionsInput = {},
): ProjectConvention[] {
  const conventions = new Map<string, ProjectConvention>();
  const files = projectStore.listFiles();
  const routes = projectStore.listRoutes();

  addDerivedProfileConventions(conventions, projectStore);
  addIndexedAuthGuardConventions(conventions, projectStore, files);
  addRoutePatternConvention(conventions, routes);
  addGeneratedPathConvention(conventions, files);
  addSchemaUsageConvention(conventions, projectStore);

  for (const fact of projectStore.queryReefFacts({ projectId, limit: 500 })) {
    const kind = stringDataValue(fact.data, "conventionKind") ?? (fact.kind.startsWith("convention:") ? fact.kind.slice("convention:".length) : undefined);
    if (!kind) continue;
    addConvention(conventions, {
      id: `fact:${fact.fingerprint}`,
      kind,
      title: stringDataValue(fact.data, "title") ?? `${kind} convention`,
      status: conventionStatus(fact.data),
      source: fact.source,
      confidence: fact.confidence,
      whyIncluded: stringDataValue(fact.data, "reason") ?? `Reef fact ${fact.kind} declares a convention`,
      ...(filePathFromFact(fact) ? { filePath: filePathFromFact(fact) } : {}),
      evidence: [fact.fingerprint],
      metadata: { subjectFingerprint: fact.subjectFingerprint },
    });
  }

  for (const rule of projectStore.listReefRuleDescriptors()) {
    const kind = inferConventionKind(ruleSearchText(rule));
    if (!kind) continue;
    addConvention(conventions, {
      id: `rule:${rule.source}:${rule.id}`,
      kind,
      title: `${rule.title} rule convention`,
      status: "candidate",
      source: rule.source,
      confidence: rule.enabledByDefault ? 0.65 : 0.45,
      whyIncluded: `rule descriptor tags/title imply ${kind}`,
      evidence: [rule.id],
      metadata: { sourceNamespace: rule.sourceNamespace, severity: rule.severity },
    });
  }

  return [...conventions.values()]
    .filter((convention) => !input.kind || convention.kind === input.kind)
    .filter((convention) => !input.status || convention.status === input.status)
    .sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind))
    .slice(0, input.limit ?? 100);
}

export async function projectConventionsTool(
  input: ProjectConventionsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectConventionsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const filtered = collectProjectConventions(projectStore, project.projectId, input);

    return {
      toolName: "project_conventions",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      conventions: filtered,
      totalReturned: filtered.length,
      warnings: filtered.length === 0 ? ["no Reef convention facts or rule-derived convention candidates matched"] : [],
    };
  });
}
