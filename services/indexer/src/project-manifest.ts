import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ProjectDatabaseKind,
  ProjectLanguage,
  ProjectManifest,
  ProjectPackageManager,
  ProjectProfile,
} from "@mako-ai/contracts";
import { ProjectManifestSchema } from "@mako-ai/contracts";
import { isIgnoredDirectory } from "@mako-ai/store";
import { ProjectCommandError } from "./errors.js";
import { readJsonObject } from "./fs-utils.js";

export const PROJECT_MANIFEST_DIRNAME = ".mako";
export const PROJECT_MANIFEST_FILENAME = "project.json";

function resolvePackageManager(projectRoot: string): ProjectPackageManager {
  const packageJson = readJsonObject(path.join(projectRoot, "package.json"));
  if (typeof packageJson.packageManager === "string") {
    const packageManager = packageJson.packageManager.toLowerCase();
    if (packageManager.startsWith("pnpm@")) {
      return "pnpm";
    }
    if (packageManager.startsWith("npm@")) {
      return "npm";
    }
    if (packageManager.startsWith("yarn@")) {
      return "yarn";
    }
    if (packageManager.startsWith("bun@")) {
      return "bun";
    }
  }

  if (existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(projectRoot, "package-lock.json"))) {
    return "npm";
  }
  if (existsSync(path.join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(path.join(projectRoot, "bun.lockb")) || existsSync(path.join(projectRoot, "bun.lock"))) {
    return "bun";
  }

  return "unknown";
}

function resolveLanguages(projectRoot: string, databaseKind: ProjectDatabaseKind): ProjectLanguage[] {
  const languages = new Set<ProjectLanguage>();

  if (existsSync(path.join(projectRoot, "tsconfig.json"))) {
    languages.add("typescript");
  } else if (existsSync(path.join(projectRoot, "package.json"))) {
    languages.add("javascript");
  }

  if (
    databaseKind !== "unknown" ||
    existsSync(path.join(projectRoot, "supabase", "migrations")) ||
    existsSync(path.join(projectRoot, "prisma", "schema.prisma"))
  ) {
    languages.add("sql");
  }

  if (languages.size === 0) {
    languages.add("unknown");
  }

  return [...languages];
}

function resolveFrameworkTags(profile: ProjectProfile): string[] {
  const frameworks = new Set<string>();

  if (profile.framework !== "unknown") {
    frameworks.add(profile.framework);
  }

  if (profile.orm === "supabase" || profile.orm === "prisma" || profile.orm === "drizzle") {
    frameworks.add(profile.orm);
  }

  if (frameworks.size === 0) {
    frameworks.add("unknown");
  }

  return [...frameworks];
}

function resolveDatabaseKind(profile: ProjectProfile): ProjectDatabaseKind {
  switch (profile.orm) {
    case "supabase":
      return "supabase";
    case "prisma":
      return "prisma";
    case "drizzle":
      return "drizzle";
    case "sql":
      return "postgres";
    default:
      return "unknown";
  }
}

function resolveSchemaSources(projectRoot: string, databaseKind: ProjectDatabaseKind): string[] {
  const schemaSources: string[] = [];

  if (databaseKind === "supabase" && existsSync(path.join(projectRoot, "supabase", "migrations"))) {
    schemaSources.push("supabase/migrations");
  }

  if (existsSync(path.join(projectRoot, "types", "supabase.ts"))) {
    schemaSources.push("types/supabase.ts");
  }

  if (existsSync(path.join(projectRoot, "prisma", "schema.prisma"))) {
    schemaSources.push("prisma/schema.prisma");
  }

  if (existsSync(path.join(projectRoot, "drizzle"))) {
    schemaSources.push("drizzle");
  }

  return schemaSources;
}

function resolveGeneratedTypePaths(projectRoot: string): string[] {
  const generatedTypePaths: string[] = [];

  if (existsSync(path.join(projectRoot, "types", "supabase.ts"))) {
    generatedTypePaths.push("types/supabase.ts");
  }

  return generatedTypePaths;
}

function resolveEdgeFunctionPaths(projectRoot: string): string[] {
  const edgeFunctionPaths: string[] = [];

  if (existsSync(path.join(projectRoot, "supabase", "functions"))) {
    edgeFunctionPaths.push("supabase/functions");
  }

  return edgeFunctionPaths;
}

function resolveIndexingInclude(projectRoot: string): string[] {
  return readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((entry) => !entry.startsWith(".") && !isIgnoredDirectory(entry))
    .sort();
}

function resolveIndexingExclude(stateDirName: string): string[] {
  return [".mako", stateDirName, ".next", "build", "coverage", "dist", "node_modules"];
}

export function resolveProjectManifestDir(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_MANIFEST_DIRNAME);
}

export function resolveProjectManifestPath(projectRoot: string): string {
  return path.join(resolveProjectManifestDir(projectRoot), PROJECT_MANIFEST_FILENAME);
}

export function buildProjectManifest(
  projectRoot: string,
  projectId: string,
  profile: ProjectProfile,
  options: { stateDirName: string; existingManifest?: ProjectManifest | null },
): ProjectManifest {
  const databaseKind = resolveDatabaseKind(profile);
  const generatedManifest: ProjectManifest = {
    version: "2.0.0",
    projectId,
    root: ".",
    displayName: profile.name,
    frameworks: resolveFrameworkTags(profile),
    languages: resolveLanguages(projectRoot, databaseKind),
    packageManager: resolvePackageManager(projectRoot),
    database: {
      kind: databaseKind,
      mode: "repo_only",
      schemaSources: resolveSchemaSources(projectRoot, databaseKind),
      generatedTypePaths: resolveGeneratedTypePaths(projectRoot),
      edgeFunctionPaths: resolveEdgeFunctionPaths(projectRoot),
      liveBinding: {
        strategy: "keychain_ref",
        ref: `mako:${projectId}:primary-db`,
        enabled: false,
      },
    },
    indexing: {
      include: resolveIndexingInclude(projectRoot),
      exclude: resolveIndexingExclude(options.stateDirName),
    },
    capabilities: {
      supportLevel: profile.supportLevel,
      entryPoints: profile.entryPoints,
      middlewareFiles: profile.middlewareFiles,
      serverOnlyModules: profile.serverOnlyModules,
      authGuardSymbols: profile.authGuardSymbols,
    },
  };

  if (!options.existingManifest) {
    return generatedManifest;
  }

  const preservedScope = options.existingManifest.database.defaultSchemaScope;
  return {
    ...generatedManifest,
    database: {
      ...generatedManifest.database,
      mode: options.existingManifest.database.mode,
      liveBinding: options.existingManifest.database.liveBinding,
      ...(preservedScope && preservedScope.length > 0
        ? { defaultSchemaScope: [...preservedScope] }
        : {}),
    },
    indexing: options.existingManifest.indexing,
  };
}

function createManifestValidationError(projectRoot: string, manifestPath: string, error: unknown): ProjectCommandError {
  if (
    error != null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown[] }).issues)
  ) {
    const issues = (error as {
      issues: Array<{ path?: Array<string | number>; message?: string; code?: string }>;
    }).issues;
    return new ProjectCommandError(422, "project_manifest_invalid", `Project manifest is invalid: ${manifestPath}`, {
      projectRoot,
      manifestPath,
      issues: issues.map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join(".") : "",
        message: issue.message ?? "Invalid manifest value.",
        code: issue.code ?? "invalid_type",
      })),
    });
  }

  return new ProjectCommandError(422, "project_manifest_invalid", `Project manifest is invalid: ${manifestPath}`, {
    projectRoot,
    manifestPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function readProjectManifest(projectRoot: string): ProjectManifest | null {
  const manifestPath = resolveProjectManifestPath(projectRoot);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    const manifest = ProjectManifestSchema.safeParse(parsed);
    if (!manifest.success) {
      throw manifest.error;
    }

    return manifest.data;
  } catch (error) {
    throw createManifestValidationError(projectRoot, manifestPath, error);
  }
}

export function writeProjectManifest(projectRoot: string, manifest: ProjectManifest): string {
  const manifestDir = resolveProjectManifestDir(projectRoot);
  const manifestPath = resolveProjectManifestPath(projectRoot);
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

export function updateProjectManifestCapabilities(
  projectRoot: string,
  patch: Partial<
    Pick<ProjectManifest["capabilities"], "serverOnlyModules" | "authGuardSymbols">
  >,
): { manifest: ProjectManifest; manifestPath: string } {
  const manifest = readProjectManifest(projectRoot);
  if (!manifest) {
    throw new ProjectCommandError(
      422,
      "project_manifest_invalid",
      `Project manifest is missing for: ${projectRoot}`,
    );
  }

  const nextCapabilities = { ...manifest.capabilities };
  if (patch.serverOnlyModules !== undefined) {
    nextCapabilities.serverOnlyModules = [...patch.serverOnlyModules];
  }
  if (patch.authGuardSymbols !== undefined) {
    nextCapabilities.authGuardSymbols = [...patch.authGuardSymbols];
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    capabilities: nextCapabilities,
  };
  const manifestPath = writeProjectManifest(projectRoot, updatedManifest);
  return { manifest: updatedManifest, manifestPath };
}

export function updateProjectManifestDefaultSchemaScope(
  projectRoot: string,
  scope: string[] | undefined,
): { manifest: ProjectManifest; manifestPath: string } {
  const manifest = readProjectManifest(projectRoot);
  if (!manifest) {
    throw new ProjectCommandError(
      422,
      "project_manifest_invalid",
      `Project manifest is missing for: ${projectRoot}`,
    );
  }

  const cleaned = (scope ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  const nextDatabase = { ...manifest.database };
  if (cleaned.length > 0) {
    nextDatabase.defaultSchemaScope = [...cleaned];
  } else {
    delete nextDatabase.defaultSchemaScope;
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    database: nextDatabase,
  };
  const manifestPath = writeProjectManifest(projectRoot, updatedManifest);
  return { manifest: updatedManifest, manifestPath };
}
