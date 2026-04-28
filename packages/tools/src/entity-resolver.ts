import path from "node:path";
import { loadConfig } from "@mako-ai/config";
import type { ProjectLocatorInput } from "@mako-ai/contracts";
import {
  normalizePath,
  openProjectStore,
  listSchemaSnapshotObjects,
  schemaSnapshotObjectIdentifiers,
  toRelativePath,
  type ProjectStore,
  type ResolvedRouteRecord,
  type ResolvedSchemaObjectRecord,
} from "@mako-ai/store";
import { resolveProject } from "./project-resolver.js";
import { createAmbiguityError, createNotFoundError } from "./resolver-errors.js";
import type { ToolProjectContext, ToolServiceOptions } from "./runtime.js";

interface AuthFeatureCandidate {
  kind: "file" | "route" | "object" | "guard_symbol";
  label: string;
  queryText: string;
}

function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function formatRouteLabel(route: ResolvedRouteRecord): string {
  return `${route.method ?? "ANY"} ${route.pattern}`;
}

function formatSchemaObjectLabel(object: ResolvedSchemaObjectRecord): string {
  return object.parentObjectName
    ? `${object.schemaName}.${object.parentObjectName}.${object.objectName}`
    : `${object.schemaName}.${object.objectName}`;
}

export function normalizeFileQuery(projectRoot: string, fileQuery: string): string {
  const trimmed = fileQuery.trim();
  if (trimmed === "") {
    return "";
  }

  if (path.isAbsolute(trimmed)) {
    const normalizedRoot = normalizePath(projectRoot);
    const normalizedAbsolute = normalizePath(trimmed);
    if (normalizedAbsolute === normalizedRoot || normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
      return toRelativePath(normalizedRoot, normalizedAbsolute);
    }
  }

  return normalizeLookupValue(trimmed);
}

export function collectExactFileCandidates(
  projectRoot: string,
  projectStore: ProjectStore,
  fileQuery: string,
): string[] {
  const normalized = normalizeFileQuery(projectRoot, fileQuery);
  if (normalized === "") {
    return [];
  }

  const files = projectStore.listFiles().map((file) => file.path);
  const exact = files.filter((filePath) => filePath === normalized);
  if (exact.length > 0) {
    return exact;
  }

  return files.filter((filePath) => filePath.endsWith(`/${normalized}`));
}

export function collectExactRouteCandidates(
  projectStore: ProjectStore,
  routeQuery: string,
): ResolvedRouteRecord[] {
  const normalized = routeQuery.trim();
  if (normalized === "") {
    return [];
  }

  const methodPattern = /^(ANY|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S.*)$/i;
  const routes = projectStore.listRoutes();
  const exactByRouteKey = routes.filter((route) => route.routeKey === normalized);
  if (exactByRouteKey.length > 0) {
    return exactByRouteKey;
  }

  const parsed = normalized.match(methodPattern);
  if (parsed) {
    const [, method, routePath] = parsed;
    const normalizedMethod = method.toUpperCase();
    return routes.filter((route) => route.pattern === routePath.trim() && (route.method ?? "ANY") === normalizedMethod);
  }

  return routes.filter((route) => route.pattern === normalized);
}

export function collectExactSchemaObjectCandidates(
  projectStore: ProjectStore,
  objectQuery: string,
  schema?: string,
): ResolvedSchemaObjectRecord[] {
  const normalizedQuery = objectQuery.trim().toLowerCase();
  if (normalizedQuery === "") {
    return [];
  }

  const normalizedSchema = schema?.trim().toLowerCase();
  const matches = [
    ...projectStore.listSchemaObjects(),
    ...listSchemaSnapshotObjects(projectStore.loadSchemaSnapshot()),
  ].filter((object) => {
    if (normalizedSchema && object.schemaName.toLowerCase() !== normalizedSchema) {
      return false;
    }

    const identifiers = schemaSnapshotObjectIdentifiers(object);

    if (normalizedSchema) {
      return identifiers.includes(normalizedQuery) || object.objectName.toLowerCase() === normalizedQuery;
    }

    return identifiers.includes(normalizedQuery);
  });

  return [...new Map(
    matches.map((object) => [
      `${object.schemaName}|${object.parentObjectName ?? ""}|${object.objectName}|${object.objectType}`,
      object,
    ] as const),
  ).values()];
}

export async function withProjectContext<T>(
  locator: ProjectLocatorInput,
  options: ToolServiceOptions,
  callback: (context: ToolProjectContext) => Promise<T> | T,
): Promise<T> {
  const config = loadConfig(options.configOverrides);
  const project = await resolveProject(locator, options);

  const storeOptions = {
    projectRoot: project.canonicalPath,
    stateDirName: config.stateDirName,
    projectDbFilename: config.projectDbFilename,
  };

  // Pooled path: the caller (typically the MCP stdio server) owns a
  // ProjectStoreCache that stays alive across tool calls. Borrow the
  // handle, run the callback, do NOT close — the cache owns close().
  if (options.projectStoreCache) {
    const projectStore = options.projectStoreCache.borrow(storeOptions);
    const profile = projectStore.loadProjectProfile()?.profile ?? null;
    return await callback({ project, profile, projectStore });
  }

  // Fallback: open-close per call. Preserves pre-Phase-2 behavior for
  // tests and one-shot CLI commands that don't plumb a cache.
  const projectStore = openProjectStore(storeOptions);
  try {
    const profile = projectStore.loadProjectProfile()?.profile ?? null;
    return await callback({ project, profile, projectStore });
  } finally {
    projectStore.close();
  }
}

export function resolveIndexedFilePath(
  projectRoot: string,
  projectStore: ProjectStore,
  fileQuery: string,
): string {
  const candidates = collectExactFileCandidates(projectRoot, projectStore, fileQuery);
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw createAmbiguityError("ambiguous_file", fileQuery, candidates);
  }

  throw createNotFoundError("file_not_found", fileQuery);
}

export function resolveIndexedRoute(projectStore: ProjectStore, routeQuery: string): ResolvedRouteRecord {
  const candidates = collectExactRouteCandidates(projectStore, routeQuery);
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw createAmbiguityError(
      "ambiguous_route",
      routeQuery,
      candidates.map((candidate) => ({
        routeKey: candidate.routeKey,
        method: candidate.method ?? "ANY",
        pattern: candidate.pattern,
        filePath: candidate.filePath,
      })),
    );
  }

  throw createNotFoundError("route_not_found", routeQuery);
}

export function resolveIndexedSchemaObject(
  projectStore: ProjectStore,
  objectQuery: string,
  schema?: string,
): ResolvedSchemaObjectRecord {
  const candidates = collectExactSchemaObjectCandidates(projectStore, objectQuery, schema);
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw createAmbiguityError(
      "ambiguous_object",
      schema ? `${schema}.${objectQuery}` : objectQuery,
      candidates.map((candidate) => ({
        identifier: formatSchemaObjectLabel(candidate),
        objectType: candidate.objectType,
      })),
    );
  }

  throw createNotFoundError("object_not_found", schema ? `${schema}.${objectQuery}` : objectQuery);
}

export function resolveSchemaObjectIdentifier(object: ResolvedSchemaObjectRecord): string {
  return formatSchemaObjectLabel(object);
}

export function resolveRouteIdentifier(route: ResolvedRouteRecord): string {
  return route.routeKey;
}

export function resolveAuthFeature(context: ToolProjectContext, featureQuery: string): string {
  const normalized = normalizeLookupValue(featureQuery).toLowerCase();
  if (normalized === "") {
    throw createNotFoundError("feature_not_found", featureQuery);
  }

  const candidates: AuthFeatureCandidate[] = [];

  for (const route of collectExactRouteCandidates(context.projectStore, featureQuery)) {
    candidates.push({
      kind: "route",
      label: formatRouteLabel(route),
      queryText: resolveRouteIdentifier(route),
    });
  }

  for (const filePath of collectExactFileCandidates(context.project.canonicalPath, context.projectStore, featureQuery)) {
    candidates.push({
      kind: "file",
      label: filePath,
      queryText: filePath,
    });
  }

  for (const object of collectExactSchemaObjectCandidates(context.projectStore, featureQuery)) {
    candidates.push({
      kind: "object",
      label: formatSchemaObjectLabel(object),
      queryText: resolveSchemaObjectIdentifier(object),
    });
  }

  for (const guardSymbol of context.profile?.authGuardSymbols ?? []) {
    if (guardSymbol.toLowerCase() === normalized) {
      candidates.push({
        kind: "guard_symbol",
        label: guardSymbol,
        queryText: guardSymbol,
      });
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [`${candidate.kind}:${candidate.queryText}`, candidate] as const)).values()];

  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0].queryText;
  }

  if (uniqueCandidates.length > 1) {
    throw createAmbiguityError(
      "ambiguous_feature",
      featureQuery,
      uniqueCandidates.map((candidate) => ({
        kind: candidate.kind,
        label: candidate.label,
      })),
    );
  }

  throw createNotFoundError("feature_not_found", featureQuery);
}
