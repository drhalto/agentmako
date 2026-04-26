import { z } from "zod";
import type { JsonObject, ProjectStatus, SupportLevel, Timestamp } from "./common.js";

export type ProjectFramework =
  | "nextjs"
  | "vite-react"
  | "node-ts"
  | "unknown";

export type ProjectOrm =
  | "supabase"
  | "prisma"
  | "drizzle"
  | "sql"
  | "unknown";

export type ProjectLanguage = "typescript" | "javascript" | "sql" | "unknown";

export type ProjectPackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

export type ProjectDatabaseKind = "supabase" | "postgres" | "prisma" | "drizzle" | "unknown";

export type ProjectDatabaseMode =
  | "repo_only"
  | "repo_plus_live_verify"
  | "live_refresh_enabled";

export type ProjectBindingStrategy = "keychain_ref" | "env_var_ref";

export interface AuthzProfile {
  presetId: string;
  roleTable?: string;
  roleColumn?: string;
  roleEnumType?: string;
  adminValues: string[];
  tenantTable?: string;
  tenantForeignKey?: string;
  adminCheckTemplate?: string;
}

export interface ProjectProfile {
  name: string;
  rootPath: string;
  framework: ProjectFramework;
  orm: ProjectOrm;
  srcRoot: string;
  entryPoints: string[];
  pathAliases: Record<string, string>;
  middlewareFiles: string[];
  serverOnlyModules: string[];
  authGuardSymbols: string[];
  supportLevel: SupportLevel;
  authz?: AuthzProfile;
  profileHash?: string;
  detectedAt: Timestamp;
}

export interface AttachedProject {
  projectId: string;
  displayName: string;
  canonicalPath: string;
  lastSeenPath: string;
  status: ProjectStatus;
  supportTarget: string;
  profileHash?: string;
  attachedAt: Timestamp;
  lastIndexedAt?: Timestamp;
  metadata?: JsonObject;
}

export interface ProjectLiveBindingRef {
  strategy: ProjectBindingStrategy;
  ref: string;
  enabled: boolean;
}

export interface ProjectDatabaseManifest {
  kind: ProjectDatabaseKind;
  mode: ProjectDatabaseMode;
  schemaSources: string[];
  generatedTypePaths: string[];
  edgeFunctionPaths: string[];
  liveBinding: ProjectLiveBindingRef;
  defaultSchemaScope?: string[];
}

export interface ProjectIndexingManifest {
  include: string[];
  exclude: string[];
}

export interface ProjectManifestCapabilities {
  supportLevel: SupportLevel;
  entryPoints: string[];
  middlewareFiles: string[];
  serverOnlyModules: string[];
  authGuardSymbols: string[];
}

export interface ProjectManifest {
  version: "2.0.0";
  projectId: string;
  root: ".";
  displayName: string;
  frameworks: string[];
  languages: ProjectLanguage[];
  packageManager: ProjectPackageManager;
  database: ProjectDatabaseManifest;
  indexing: ProjectIndexingManifest;
  capabilities: ProjectManifestCapabilities;
}

const SupportLevelSchema = z.enum(["native", "adapted", "best_effort"]);

export const ProjectLanguageSchema = z.enum(["typescript", "javascript", "sql", "unknown"]);
export const ProjectPackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun", "unknown"]);
export const ProjectDatabaseKindSchema = z.enum(["supabase", "postgres", "prisma", "drizzle", "unknown"]);
export const ProjectDatabaseModeSchema = z.enum(["repo_only", "repo_plus_live_verify", "live_refresh_enabled"]);
export const ProjectBindingStrategySchema = z.enum(["keychain_ref", "env_var_ref"]);

export const ProjectLiveBindingRefSchema = z
  .object({
    strategy: ProjectBindingStrategySchema,
    ref: z.string().trim(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.ref === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref"],
        message: "Live binding ref must not be empty when the binding is enabled.",
      });
    }
  }) satisfies z.ZodType<ProjectLiveBindingRef>;

export const ProjectDatabaseManifestSchema = z.object({
  kind: ProjectDatabaseKindSchema,
  mode: ProjectDatabaseModeSchema,
  schemaSources: z.array(z.string().trim().min(1)),
  generatedTypePaths: z.array(z.string().trim().min(1)),
  edgeFunctionPaths: z.array(z.string().trim().min(1)),
  liveBinding: ProjectLiveBindingRefSchema,
  defaultSchemaScope: z.array(z.string().trim().min(1)).optional(),
}) satisfies z.ZodType<ProjectDatabaseManifest>;

export const ProjectIndexingManifestSchema = z.object({
  include: z.array(z.string().trim().min(1)),
  exclude: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<ProjectIndexingManifest>;

export const ProjectManifestCapabilitiesSchema = z.object({
  supportLevel: SupportLevelSchema,
  entryPoints: z.array(z.string().trim().min(1)),
  middlewareFiles: z.array(z.string().trim().min(1)),
  serverOnlyModules: z.array(z.string().trim().min(1)),
  authGuardSymbols: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<ProjectManifestCapabilities>;

export const ProjectManifestSchema = z.object({
  version: z.literal("2.0.0"),
  projectId: z.string().trim().min(1),
  root: z.literal("."),
  displayName: z.string().trim().min(1),
  frameworks: z.array(z.string().trim().min(1)),
  languages: z.array(ProjectLanguageSchema),
  packageManager: ProjectPackageManagerSchema,
  database: ProjectDatabaseManifestSchema,
  indexing: ProjectIndexingManifestSchema,
  capabilities: ProjectManifestCapabilitiesSchema,
}) satisfies z.ZodType<ProjectManifest>;
