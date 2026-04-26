import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  isWatchableProjectPath,
  MAX_INDEXED_FILE_SIZE_BYTES,
  summarizeProjectIndexFreshness,
} from "@mako-ai/indexer";
import type {
  JsonObject,
  ProjectFact,
  WorkingTreeOverlaySkippedFile,
  WorkingTreeOverlayToolInput,
  WorkingTreeOverlayToolOutput,
} from "@mako-ai/contracts";
import { hashText, normalizePath, toRelativePath, type ProjectStore } from "@mako-ai/store";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";

export async function workingTreeOverlayTool(
  input: WorkingTreeOverlayToolInput,
  options: ToolServiceOptions,
): Promise<WorkingTreeOverlayToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const maxFiles = input.maxFiles ?? 100;
    const candidates = selectWorkingTreeOverlayCandidates({
      input,
      projectRoot: project.canonicalPath,
      projectStore,
      dirtyPaths: options.indexRefreshCoordinator?.getWatchState(project.projectId)?.dirtyPaths ?? [],
      maxFiles,
    });
    const checkedAt = new Date().toISOString();
    const facts: ProjectFact[] = [];
    const scannedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const skippedFiles: WorkingTreeOverlaySkippedFile[] = [];
    const warnings: string[] = [];

    if (candidates.truncated) {
      warnings.push(`working_tree_overlay limited candidates to maxFiles (${maxFiles})`);
    }
    if (candidates.paths.length === 0) {
      warnings.push("no changed or non-fresh paths found; pass files for an explicit working-tree overlay snapshot");
    }

    for (const candidate of candidates.paths) {
      const resolved = resolveProjectRelativePath(project.canonicalPath, candidate);
      if (!resolved.ok) {
        skippedFiles.push({ filePath: candidate, reason: resolved.reason });
        continue;
      }

      const result = buildWorkingTreeFileFact({
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        projectStore,
        relativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
        checkedAt,
      });

      if (result.skipped) {
        skippedFiles.push({ filePath: resolved.relativePath, reason: result.reason });
        continue;
      }

      facts.push(result.fact);
      scannedFiles.push(resolved.relativePath);
      if (result.deleted) {
        deletedFiles.push(resolved.relativePath);
      }
    }

    const savedFacts = projectStore.upsertReefFacts(facts);

    return {
      toolName: "working_tree_overlay",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      facts: savedFacts,
      scannedFiles,
      deletedFiles,
      skippedFiles,
      warnings,
    };
  });
}

function selectWorkingTreeOverlayCandidates(args: {
  input: WorkingTreeOverlayToolInput;
  projectRoot: string;
  projectStore: ProjectStore;
  dirtyPaths: readonly string[];
  maxFiles: number;
}): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (filePath: string): void => {
    const normalized = filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized === "" || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };

  if (args.input.files && args.input.files.length > 0) {
    for (const filePath of args.input.files) add(filePath);
  } else {
    for (const filePath of args.dirtyPaths) add(filePath);
    const freshness = summarizeProjectIndexFreshness({
      projectRoot: args.projectRoot,
      store: args.projectStore,
      includeUnindexed: args.input.includeUnindexed ?? false,
    });
    for (const detail of freshness.sample) {
      if (detail.state === "fresh") continue;
      add(detail.filePath);
    }
  }

  return {
    paths: paths.slice(0, args.maxFiles),
    truncated: paths.length > args.maxFiles,
  };
}

function resolveProjectRelativePath(
  projectRoot: string,
  filePath: string,
): { ok: true; relativePath: string; absolutePath: string } | { ok: false; reason: string } {
  const normalizedRoot = normalizePath(projectRoot);
  const normalizedQuery = normalizeFileQuery(normalizedRoot, filePath);
  if (normalizedQuery === "" || normalizedQuery === ".") {
    return { ok: false, reason: "file path is empty or resolves to the project root" };
  }
  if (path.isAbsolute(normalizedQuery)) {
    return { ok: false, reason: "file path resolves outside the project root" };
  }

  const absolutePath = normalizePath(path.join(normalizedRoot, normalizedQuery));
  if (absolutePath === normalizedRoot || !absolutePath.startsWith(`${normalizedRoot}/`)) {
    return { ok: false, reason: "file path resolves outside the project root" };
  }

  const relativePath = toRelativePath(normalizedRoot, absolutePath).replace(/\\/g, "/");
  if (relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return { ok: false, reason: "file path resolves outside the project root" };
  }

  return { ok: true, relativePath, absolutePath };
}

function buildWorkingTreeFileFact(args: {
  projectId: string;
  projectRoot: string;
  projectStore: ProjectStore;
  relativePath: string;
  absolutePath: string;
  checkedAt: string;
}): { skipped: true; reason: string } | { skipped: false; fact: ProjectFact; deleted: boolean } {
  if (!isWatchableProjectPath(args.relativePath)) {
    return { skipped: true, reason: "path is ignored or not indexable by the project index scope" };
  }

  if (!existsSync(args.absolutePath)) {
    return {
      skipped: false,
      deleted: true,
      fact: createWorkingTreeFileFact({
        ...args,
        data: { state: "deleted" },
        reason: "working tree deletion observed on disk",
      }),
    };
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(args.absolutePath);
  } catch (error) {
    return {
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!stat.isFile()) {
    return { skipped: true, reason: "path is not a regular file" };
  }
  if (stat.size > MAX_INDEXED_FILE_SIZE_BYTES) {
    return {
      skipped: true,
      reason: `file is larger than MAX_INDEXED_FILE_SIZE_BYTES (${MAX_INDEXED_FILE_SIZE_BYTES})`,
    };
  }

  let content: string;
  try {
    content = readFileSync(args.absolutePath, "utf8");
  } catch (error) {
    return {
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const data: JsonObject = {
    state: "present",
    sizeBytes: stat.size,
    lineCount: content === "" ? 0 : content.split("\n").length,
    sha256: hashText(content),
    lastModifiedAt: stat.mtime.toISOString(),
    mtimeMs: Math.round(stat.mtimeMs),
  };

  return {
    skipped: false,
    deleted: false,
    fact: createWorkingTreeFileFact({
      ...args,
      data,
      reason: "working tree file snapshot read from disk",
    }),
  };
}

function createWorkingTreeFileFact(args: {
  projectId: string;
  projectRoot: string;
  projectStore: ProjectStore;
  relativePath: string;
  checkedAt: string;
  data: JsonObject;
  reason: string;
}): ProjectFact {
  const subject = { kind: "file" as const, path: args.relativePath };
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint(subject);
  const source = "working_tree_overlay";
  const kind = "file_snapshot";
  return {
    projectId: args.projectId,
    kind,
    subject,
    subjectFingerprint,
    overlay: "working_tree",
    source,
    confidence: 1,
    fingerprint: args.projectStore.computeReefFactFingerprint({
      projectId: args.projectId,
      kind,
      subjectFingerprint,
      overlay: "working_tree",
      source,
      data: args.data,
    }),
    freshness: {
      state: "fresh",
      checkedAt: args.checkedAt,
      reason: args.reason,
    },
    provenance: {
      source,
      capturedAt: args.checkedAt,
      dependencies: [{ kind: "file", path: args.relativePath }],
      metadata: {
        projectRoot: args.projectRoot,
      },
    },
    data: args.data,
  };
}
