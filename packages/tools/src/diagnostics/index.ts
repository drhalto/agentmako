import type { AnswerResult, AnswerSurfaceIssue } from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { compileRulePacks, discoverRulePacks } from "../rule-packs/loader.js";
import { runRulePacks } from "../rule-packs/evaluator.js";
import type { CompiledRule } from "../rule-packs/types.js";
import { dedupeIssuesByMatchBasedId } from "./common.js";
import { runStructuralAlignmentDiagnostics } from "./structural.js";
import { runTsAwareAlignmentDiagnostics } from "./ts-aware.js";

/**
 * Process-lifetime cache for compiled YAML rule packs keyed by project root.
 * Walking the filesystem + parsing YAML on every answer would be wasteful,
 * and rule packs don't change within a running session. Users can restart
 * mako after editing a rule pack; we can add mtime invalidation later if
 * needed.
 */
const rulePackCache = new Map<string, CompiledRule[]>();
const appSurfaceCache = new Map<string, boolean>();

function getCompiledRules(projectStore: ProjectStore): CompiledRule[] {
  const cached = rulePackCache.get(projectStore.projectRoot);
  if (cached) return cached;
  let compiled: CompiledRule[] = [];
  try {
    compiled = compileRulePacks(discoverRulePacks(projectStore.projectRoot));
  } catch {
    // Malformed rule packs shouldn't break answer emission. The error is
    // visible in devcli-level tooling that calls loadRulePackFromFile
    // directly; production paths degrade to "no custom rules for this run."
    compiled = [];
  }
  rulePackCache.set(projectStore.projectRoot, compiled);
  return compiled;
}

function getHasNextLikeAppSurface(projectStore: ProjectStore, framework: string | null): boolean {
  if (framework === "nextjs") {
    return true;
  }

  const latestIndexRunId = projectStore.getLatestIndexRun()?.runId ?? "none";
  const cacheKey = `${projectStore.projectRoot}::${framework ?? "unknown"}::${latestIndexRunId}`;
  const cached = appSurfaceCache.get(cacheKey);
  if (cached != null) {
    return cached;
  }

  const detected =
    projectStore.getFileContent("app/dashboard/layout.tsx") != null ||
    projectStore.listFiles().some((file) => file.path.startsWith("app/api/"));
  appSurfaceCache.set(cacheKey, detected);
  return detected;
}

export interface CollectAnswerDiagnosticsInput {
  projectStore: ProjectStore;
  result: AnswerResult;
}

export interface CollectDiagnosticsForFilesInput {
  projectStore: ProjectStore;
  focusFiles: readonly string[];
  primaryFocusFile?: string | null;
}

// Lower helper shared by the answer-path and the 7.5 artifact path. The
// answer path adds its own support/evidence gates before calling in; the
// artifact path (review_bundle) calls directly with a file set derived from
// change-plan surfaces.
export function collectDiagnosticsForFiles(
  input: CollectDiagnosticsForFilesInput,
): AnswerSurfaceIssue[] {
  const resolvedFocusFiles = [...new Set(input.focusFiles)].filter(
    (filePath) => input.projectStore.getFileContent(filePath) != null,
  );
  if (resolvedFocusFiles.length === 0) {
    return [];
  }

  const profile = input.projectStore.loadProjectProfile()?.profile ?? null;
  const hasNextLikeAppSurface = getHasNextLikeAppSurface(input.projectStore, profile?.framework ?? null);

  const compiledRules = getCompiledRules(input.projectStore);
  const diagnostics = [
    ...runTsAwareAlignmentDiagnostics({
      projectStore: input.projectStore,
      focusFiles: resolvedFocusFiles,
    }),
    ...runStructuralAlignmentDiagnostics({
      projectStore: input.projectStore,
      focusFiles: resolvedFocusFiles,
      enableAppHeuristics: hasNextLikeAppSurface,
    }),
    ...runRulePacks({
      rules: compiledRules,
      projectStore: input.projectStore,
      focusFiles: resolvedFocusFiles,
    }),
  ];

  const deduped = dedupeIssuesByMatchBasedId(diagnostics);

  if (!input.primaryFocusFile) {
    return deduped;
  }

  return deduped.filter((diagnostic) => touchesPrimaryFocusFile(diagnostic, input.primaryFocusFile!));
}

export function collectAnswerDiagnostics(
  input: CollectAnswerDiagnosticsInput,
): AnswerSurfaceIssue[] {
  if (
    input.result.packet.evidence.length === 0 ||
    input.result.supportLevel === "best_effort" ||
    input.result.evidenceStatus === "partial"
  ) {
    return [];
  }

  const focusFiles = new Set<string>();
  for (const block of input.result.packet.evidence) {
    if (typeof block.filePath === "string" && block.filePath.trim().length > 0) {
      focusFiles.add(block.filePath);
    }
  }

  const primaryFocusFile =
    input.result.queryKind === "file_health" || input.result.queryKind === "trace_file"
      ? normalizePrimaryFile(input.result.packet.queryText)
      : null;
  if (primaryFocusFile) {
    focusFiles.add(primaryFocusFile);
  }

  return collectDiagnosticsForFiles({
    projectStore: input.projectStore,
    focusFiles: [...focusFiles],
    primaryFocusFile,
  });
}
function normalizePrimaryFile(queryText: string): string | null {
  const trimmed = queryText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const wrappedFileMatch = /^(?:trace_file|file_health)\((.+)\)$/.exec(trimmed);
  if (wrappedFileMatch) {
    const innerPath = wrappedFileMatch[1]?.trim();
    return innerPath && innerPath.length > 0 ? innerPath : null;
  }
  return trimmed;
}

function touchesPrimaryFocusFile(issue: AnswerSurfaceIssue, primaryFocusFile: string): boolean {
  return (
    issue.path === primaryFocusFile ||
    issue.producerPath === primaryFocusFile ||
    issue.consumerPath === primaryFocusFile
  );
}
