import type {
  ProjectConvention,
  ProjectFact,
  ProjectFinding,
  ReefFreshnessPolicy,
  ReefDiffImpactCaller,
  ReefDiffImpactChangedFile,
  ReefDiffImpactConventionRisk,
  ReefDiffImpactInvalidatedFinding,
  ReefDiffImpactToolInput,
  ReefDiffImpactToolOutput,
} from "@mako-ai/contracts";
import type { FileImportLink, ProjectStore, SymbolRecord } from "@mako-ai/store";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { collectProjectConventions } from "./conventions.js";
import { applicableConventionsForFile } from "./file-preflight.js";
import { stringDataValue } from "./shared.js";
import { applyReefToolFreshnessPolicy, buildReefToolExecution } from "./tool-execution.js";

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_CALLERS_PER_FILE = 50;
const DEFAULT_MAX_FINDINGS_PER_CALLER = 10;
const DEFAULT_MAX_CONVENTIONS = 30;

export async function reefDiffImpactTool(
  input: ReefDiffImpactToolInput,
  options: ToolServiceOptions,
): Promise<ReefDiffImpactToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const depth = input.depth ?? DEFAULT_DEPTH;
    const maxCallersPerFile = input.maxCallersPerFile ?? DEFAULT_MAX_CALLERS_PER_FILE;
    const maxFindingsPerCaller = input.maxFindingsPerCaller ?? DEFAULT_MAX_FINDINGS_PER_CALLER;
    const maxConventions = input.maxConventions ?? DEFAULT_MAX_CONVENTIONS;
    const freshnessPolicy = input.freshnessPolicy ?? "allow_stale_labeled";
    const warnings: string[] = [];
    const indexedFiles = new Set(projectStore.listFiles().map((file) => file.path));
    const filePaths = uniqueSorted(input.filePaths.map((filePath) => normalizeFileQuery(project.canonicalPath, filePath)));
    const changedFiles = filePaths.map((filePath) =>
      changedFileEntry({
        projectId: project.projectId,
        filePath,
        indexed: indexedFiles.has(filePath),
        projectStore,
      })
    );

    for (const changedFile of changedFiles) {
      if (changedFile.overlayState === "missing") {
        warnings.push(`No working_tree_overlay file_snapshot exists for ${changedFile.filePath}; call working_tree_overlay for this file or wait for the watcher before treating diff facts as current.`);
      }
      if (!changedFile.indexed) {
        warnings.push(`${changedFile.filePath} is not in the indexed import graph, so dependent callers may be incomplete.`);
      }
    }

    const impactedCallers = walkImpactedCallers({
      changedFiles,
      projectStore,
      depth,
      maxCallersPerFile,
    });
    const truncated = impactedCallers.truncated;
    if (truncated) {
      warnings.push(`Impacted caller results were truncated to maxCallersPerFile=${maxCallersPerFile} for at least one changed file.`);
    }

    const findingResult = collectPossiblyInvalidatedFindings({
      projectId: project.projectId,
      projectStore,
      impactedCallers: impactedCallers.items,
      freshnessPolicy,
      maxFindingsPerCaller,
    });
    warnings.push(...findingResult.warnings);

    const conventionRisks = collectConventionRisks({
      projectStore,
      projectId: project.projectId,
      changedFiles,
      impactedCallers: impactedCallers.items,
      maxConventions,
    });

    const overlayMissingCount = changedFiles.filter((file) => file.overlayState === "missing").length;
    const reefExecution = await buildReefToolExecution({
      toolName: "reef_diff_impact",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy,
      staleEvidenceDropped: findingResult.staleEvidenceDropped,
      staleEvidenceLabeled: findingResult.staleEvidenceLabeled + overlayMissingCount,
      returnedCount: changedFiles.length +
        impactedCallers.items.length +
        findingResult.items.length +
        conventionRisks.length,
    });

    return {
      toolName: "reef_diff_impact",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      changedFiles,
      impactedCallers: impactedCallers.items,
      possiblyInvalidatedFindings: findingResult.items,
      conventionRisks,
      summary: {
        changedFileCount: changedFiles.length,
        impactedCallerCount: impactedCallers.items.length,
        possiblyInvalidatedFindingCount: findingResult.items.length,
        conventionRiskCount: conventionRisks.length,
        overlayMissingCount,
        truncated,
      },
      reefExecution,
      filters: {
        depth,
        maxCallersPerFile,
        maxFindingsPerCaller,
        maxConventions,
        freshnessPolicy,
      },
      warnings,
    };
  });
}

function changedFileEntry(args: {
  projectId: string;
  filePath: string;
  indexed: boolean;
  projectStore: ProjectStore;
}): ReefDiffImpactChangedFile {
  const overlayFact = workingTreeOverlayFact(args.projectStore, args.projectId, args.filePath);
  const symbols = args.projectStore.listSymbolsForFile(args.filePath);
  const overlayState = overlayFact
    ? stringDataValue(overlayFact.data, "state") === "deleted"
      ? "deleted"
      : "present"
    : "missing";
  return {
    filePath: args.filePath,
    indexed: args.indexed,
    overlayState,
    exportedSymbols: symbolNames(symbols, "exports"),
    declaredSymbols: symbolNames(symbols, "declared"),
    ...(overlayFact ? { overlayFact } : {}),
  };
}

function workingTreeOverlayFact(
  projectStore: ProjectStore,
  projectId: string,
  filePath: string,
): ProjectFact | undefined {
  const subjectFingerprint = projectStore.computeReefSubjectFingerprint({ kind: "file", path: filePath });
  return projectStore.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    subjectFingerprint,
    limit: 1,
  })[0];
}

function walkImpactedCallers(args: {
  changedFiles: readonly ReefDiffImpactChangedFile[];
  projectStore: ProjectStore;
  depth: number;
  maxCallersPerFile: number;
}): { items: ReefDiffImpactCaller[]; truncated: boolean } {
  const items: ReefDiffImpactCaller[] = [];
  let truncated = false;

  for (const changedFile of args.changedFiles) {
    const sourceItems: ReefDiffImpactCaller[] = [];
    const queue: Array<{ filePath: string; depth: number; via: string[] }> = [{
      filePath: changedFile.filePath,
      depth: 0,
      via: [],
    }];
    const visited = new Set<string>([changedFile.filePath]);

    while (queue.length > 0) {
      const current = queue.shift() as { filePath: string; depth: number; via: string[] };
      if (current.depth >= args.depth) {
        continue;
      }

      for (const edgeGroup of groupInternalDependents(args.projectStore.listDependentsForFile(current.filePath))) {
        const callerFilePath = edgeGroup.sourcePath;
        if (visited.has(callerFilePath)) {
          continue;
        }
        visited.add(callerFilePath);
        const nextDepth = current.depth + 1;
        const via = [...current.via, current.filePath];

        if (sourceItems.length >= args.maxCallersPerFile) {
          truncated = true;
          continue;
        }

        sourceItems.push({
          sourceFilePath: changedFile.filePath,
          callerFilePath,
          depth: nextDepth,
          via,
          importSpecifiers: edgeGroup.specifiers,
          potentiallyAffectedSymbols: affectedSymbols(changedFile),
          reason: nextDepth === 1
            ? `${callerFilePath} directly imports changed file ${changedFile.filePath}.`
            : `${callerFilePath} is a transitive dependent of changed file ${changedFile.filePath}.`,
        });
        queue.push({ filePath: callerFilePath, depth: nextDepth, via });
      }
    }

    items.push(...sourceItems);
  }

  items.sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    if (left.sourceFilePath !== right.sourceFilePath) return left.sourceFilePath.localeCompare(right.sourceFilePath);
    return left.callerFilePath.localeCompare(right.callerFilePath);
  });
  return { items, truncated };
}

function groupInternalDependents(edges: readonly FileImportLink[]): Array<{
  sourcePath: string;
  targetPath: string;
  specifiers: string[];
}> {
  const groups = new Map<string, { sourcePath: string; targetPath: string; specifiers: Set<string> }>();
  for (const edge of edges) {
    if (!edge.targetExists) {
      continue;
    }
    const key = `${edge.sourcePath}\0${edge.targetPath}`;
    const existing = groups.get(key) ?? {
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      specifiers: new Set<string>(),
    };
    existing.specifiers.add(edge.specifier);
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      sourcePath: group.sourcePath,
      targetPath: group.targetPath,
      specifiers: [...group.specifiers].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

function collectPossiblyInvalidatedFindings(args: {
  projectId: string;
  projectStore: ProjectStore;
  impactedCallers: readonly ReefDiffImpactCaller[];
  freshnessPolicy: ReefFreshnessPolicy;
  maxFindingsPerCaller: number;
}): {
  items: ReefDiffImpactInvalidatedFinding[];
  staleEvidenceDropped: number;
  staleEvidenceLabeled: number;
  warnings: string[];
} {
  const callerPaths = uniqueSorted(args.impactedCallers.map((impact) => impact.callerFilePath));
  const findingsByCaller = new Map<string, ProjectFinding[]>();
  let staleEvidenceDropped = 0;
  let staleEvidenceLabeled = 0;
  const warnings: string[] = [];

  for (const callerPath of callerPaths) {
    const rawFindings = args.projectStore.queryReefFindings({
      projectId: args.projectId,
      filePath: callerPath,
      status: "active",
      includeResolved: false,
      limit: args.maxFindingsPerCaller,
    });
    const filtered = applyReefToolFreshnessPolicy(rawFindings, args.freshnessPolicy, "caller finding");
    findingsByCaller.set(callerPath, filtered.items);
    staleEvidenceDropped += filtered.staleEvidenceDropped;
    staleEvidenceLabeled += filtered.staleEvidenceLabeled;
    warnings.push(...filtered.warnings.map((warning) => `${callerPath}: ${warning}`));
  }

  const items: ReefDiffImpactInvalidatedFinding[] = [];
  const seen = new Set<string>();
  for (const impact of args.impactedCallers) {
    for (const finding of findingsByCaller.get(impact.callerFilePath) ?? []) {
      const key = `${impact.sourceFilePath}\0${impact.callerFilePath}\0${finding.fingerprint}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        sourceFilePath: impact.sourceFilePath,
        callerFilePath: impact.callerFilePath,
        finding,
        reason: `${finding.source} finding on ${impact.callerFilePath} may need re-checking because ${impact.sourceFilePath} changed upstream.`,
      });
    }
  }

  return {
    items,
    staleEvidenceDropped,
    staleEvidenceLabeled,
    warnings,
  };
}

function collectConventionRisks(args: {
  projectStore: ProjectStore;
  projectId: string;
  changedFiles: readonly ReefDiffImpactChangedFile[];
  impactedCallers: readonly ReefDiffImpactCaller[];
  maxConventions: number;
}): ReefDiffImpactConventionRisk[] {
  const conventions = collectProjectConventions(args.projectStore, args.projectId, { limit: 200 });
  const risks: ReefDiffImpactConventionRisk[] = [];
  const seen = new Set<string>();

  const addRisks = (
    filePath: string,
    scope: ReefDiffImpactConventionRisk["scope"],
    sourceFilePath?: string,
  ): void => {
    for (const convention of applicableConventionsForFile(conventions, filePath)) {
      const key = `${scope}\0${sourceFilePath ?? ""}\0${filePath}\0${convention.id}`;
      if (seen.has(key) || risks.length >= args.maxConventions) {
        continue;
      }
      seen.add(key);
      risks.push({
        filePath,
        scope,
        convention,
        confidence: convention.confidence,
        reason: conventionRiskReason(filePath, convention, scope, sourceFilePath),
        ...(sourceFilePath ? { sourceFilePath } : {}),
      });
    }
  };

  for (const changedFile of args.changedFiles) {
    addRisks(changedFile.filePath, "changed_file");
  }
  for (const impact of args.impactedCallers) {
    addRisks(impact.callerFilePath, "impacted_caller", impact.sourceFilePath);
  }

  return risks.sort((left, right) =>
    right.confidence - left.confidence ||
    left.scope.localeCompare(right.scope) ||
    left.filePath.localeCompare(right.filePath) ||
    left.convention.id.localeCompare(right.convention.id)
  );
}

function conventionRiskReason(
  filePath: string,
  convention: ProjectConvention,
  scope: ReefDiffImpactConventionRisk["scope"],
  sourceFilePath?: string,
): string {
  const prefix = scope === "changed_file"
    ? `${filePath} is part of the current diff`
    : `${filePath} depends on changed file ${sourceFilePath}`;
  if (convention.filePath === filePath) {
    return `${prefix} and is the file attached to convention ${convention.id}.`;
  }
  if (convention.evidence.some((evidence) => evidence === filePath || evidence.includes(filePath))) {
    return `${prefix} and appears in the evidence for convention ${convention.id}.`;
  }
  return `${prefix}; convention ${convention.id} (${convention.kind}) may apply.`;
}

function affectedSymbols(changedFile: ReefDiffImpactChangedFile): string[] {
  return changedFile.exportedSymbols.length > 0 ? changedFile.exportedSymbols : changedFile.declaredSymbols;
}

function symbolNames(symbols: readonly SymbolRecord[], mode: "exports" | "declared"): string[] {
  const names = symbols
    .map((symbol) => mode === "exports" ? symbol.exportName : symbol.name)
    .filter((name): name is string => Boolean(name && name.trim().length > 0));
  return uniqueSorted(names);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
