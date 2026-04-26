import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  ProjectDatabaseManifest,
  SchemaSnapshotWarning,
  SchemaSourceKind,
} from "@mako-ai/contracts";
import { normalizePath, toRelativePath } from "@mako-ai/store";
import { collectProjectFilePaths } from "../fs-utils.js";

export interface SchemaInventoryEntry {
  kind: SchemaSourceKind;
  relativePath: string;
  absolutePath: string;
  content: string;
  sha256: string;
  lastModifiedAt: string;
  sizeBytes: number;
}

export interface SchemaSourceInventory {
  entries: SchemaInventoryEntry[];
  warnings: SchemaSnapshotWarning[];
}

interface ClassifiedSource {
  kind: SchemaSourceKind;
  manifestPath: string;
}

function normalizeManifestPath(manifestPath: string): string {
  return manifestPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function classifySource(manifestPath: string): SchemaSourceKind | null {
  const normalized = normalizeManifestPath(manifestPath);

  if (normalized === "supabase/migrations" || normalized.startsWith("supabase/migrations/")) {
    return "sql_migration";
  }

  if (normalized === "prisma/schema.prisma" || normalized.endsWith(".prisma")) {
    return "prisma_schema";
  }

  if (normalized === "drizzle" || normalized.startsWith("drizzle/")) {
    return "drizzle_schema";
  }

  if (normalized === "types/supabase.ts") {
    return "generated_types";
  }

  if (normalized.endsWith(".sql")) {
    return "sql_migration";
  }

  if (normalized.startsWith("types/") && (normalized.endsWith(".ts") || normalized.endsWith(".tsx"))) {
    return "generated_types";
  }

  return null;
}

function collectDirectoryFiles(
  projectRoot: string,
  directoryAbsolutePath: string,
  fileMatcher: (relativePath: string) => boolean,
): string[] {
  return collectProjectFilePaths(directoryAbsolutePath, (_absolutePath, relativePath) =>
    fileMatcher(relativePath),
  ).map((filePath) => normalizePath(filePath));
}

function expandSource(
  projectRoot: string,
  classified: ClassifiedSource,
): { absolutePaths: string[]; missingReason: "path_missing" | "empty_directory" | null } {
  const absolutePath = path.join(projectRoot, classified.manifestPath);

  if (!existsSync(absolutePath)) {
    return { absolutePaths: [], missingReason: "path_missing" };
  }

  const stat = statSync(absolutePath);

  if (stat.isFile()) {
    return { absolutePaths: [normalizePath(absolutePath)], missingReason: null };
  }

  if (!stat.isDirectory()) {
    return { absolutePaths: [], missingReason: "path_missing" };
  }

  switch (classified.kind) {
    case "sql_migration": {
      const files = collectDirectoryFiles(projectRoot, absolutePath, (relativePath) =>
        relativePath.endsWith(".sql"),
      );
      return {
        absolutePaths: files,
        missingReason: files.length === 0 ? "empty_directory" : null,
      };
    }
    case "drizzle_schema": {
      const files = collectDirectoryFiles(projectRoot, absolutePath, (relativePath) =>
        relativePath.endsWith(".ts") || relativePath.endsWith(".tsx"),
      );
      return {
        absolutePaths: files,
        missingReason: files.length === 0 ? "empty_directory" : null,
      };
    }
    default:
      return { absolutePaths: [], missingReason: "path_missing" };
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readSourceFile(
  projectRoot: string,
  absolutePath: string,
  kind: SchemaSourceKind,
): SchemaInventoryEntry {
  const content = readFileSync(absolutePath, "utf8");
  const stat = statSync(absolutePath);
  return {
    kind,
    relativePath: toRelativePath(normalizePath(projectRoot), normalizePath(absolutePath)),
    absolutePath: normalizePath(absolutePath),
    content,
    sha256: hashContent(content),
    lastModifiedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

export function buildSchemaSourceInventory(
  projectRoot: string,
  database: ProjectDatabaseManifest,
): SchemaSourceInventory {
  const entries: SchemaInventoryEntry[] = [];
  const warnings: SchemaSnapshotWarning[] = [];
  const seenPaths = new Set<string>();
  const normalizedRoot = normalizePath(projectRoot);

  for (const rawManifestPath of database.schemaSources) {
    const manifestPath = normalizeManifestPath(rawManifestPath);
    if (manifestPath === "") {
      continue;
    }

    const kind = classifySource(manifestPath);
    if (!kind) {
      warnings.push({
        kind: "unsupported_source",
        sourcePath: manifestPath,
        message: `Unknown schema source pattern: ${manifestPath}`,
      });
      continue;
    }

    if (kind === "prisma_schema" || kind === "drizzle_schema") {
      warnings.push({
        kind: "unsupported_source",
        sourceKind: kind,
        sourcePath: manifestPath,
        message:
          kind === "prisma_schema"
            ? "Prisma schema parsing is not implemented in Phase 2."
            : "Drizzle schema parsing is not implemented in Phase 2.",
      });
      continue;
    }

    const { absolutePaths, missingReason } = expandSource(projectRoot, {
      kind,
      manifestPath,
    });

    if (missingReason) {
      warnings.push({
        kind: "source_missing",
        sourceKind: kind,
        sourcePath: manifestPath,
        message:
          missingReason === "path_missing"
            ? `Schema source path does not exist: ${manifestPath}`
            : `Schema source directory is empty: ${manifestPath}`,
      });
      continue;
    }

    for (const absolutePath of absolutePaths) {
      const relativeKey = toRelativePath(normalizedRoot, absolutePath);
      if (seenPaths.has(relativeKey)) {
        continue;
      }
      seenPaths.add(relativeKey);

      entries.push(readSourceFile(projectRoot, absolutePath, kind));
    }
  }

  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return { entries, warnings };
}
