import type {
  AnswerSurfaceIssue,
  LintFilesToolInput,
  LintFilesToolOutput,
  ProjectFinding,
  ReefRuleDescriptor,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { collectDiagnosticsForFiles } from "../diagnostics/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

/**
 * `lint_files` — read-only diagnostics over an arbitrary indexed file set.
 *
 * Implementation notes:
 * - Resolves each requested file through `projectStore.getFileContent`; files
 *   missing from the index land in `unresolvedFiles` instead of silently
 *   disappearing.
 * - Delegates to the shared `collectDiagnosticsForFiles` primitive — same
 *   engine that powers `collectAnswerDiagnostics` and the `review_bundle`
 *   artifact, so findings are consistent across surfaces.
 * - Applies `maxFindings` after the engine runs; truncation is reported via
 *   `truncated: true` + a warning explaining which cap fired.
 */

const DEFAULT_MAX_FINDINGS = 500;
const LINT_FILES_REEF_SOURCE = "lint_files";

function reefSeverity(issue: AnswerSurfaceIssue): ProjectFinding["severity"] {
  switch (issue.severity) {
    case "critical":
      return "error";
    case "high":
    case "medium":
      return "warning";
    case "low":
      return "info";
  }
}

function issueFilePath(issue: AnswerSurfaceIssue): string | undefined {
  return issue.path ?? issue.consumerPath ?? issue.producerPath;
}

function persistLintFindingsToReef(args: {
  projectId: string;
  projectStore: ProjectStore;
  resolvedFiles: readonly string[];
  issues: readonly AnswerSurfaceIssue[];
}): number {
  const capturedAt = new Date().toISOString();
  const freshness = {
    state: "fresh" as const,
    checkedAt: capturedAt,
    reason: "indexed diagnostics collected by lint_files",
  };
  const subjectFingerprints = new Set(
    args.resolvedFiles.map((filePath) =>
      args.projectStore.computeReefSubjectFingerprint({
        kind: "file",
        path: filePath,
      }),
    ),
  );
  const descriptors = new Map<string, ReefRuleDescriptor>();
  const findings: ProjectFinding[] = [];

  for (const issue of args.issues) {
    const filePath = issueFilePath(issue);
    if (!filePath) {
      continue;
    }

    const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint({
      kind: "file",
      path: filePath,
    });
    subjectFingerprints.add(subjectFingerprint);
    descriptors.set(issue.code, {
      id: issue.code,
      version: "1.0.0",
      source: LINT_FILES_REEF_SOURCE,
      sourceNamespace: "lint_files",
      type: "problem",
      severity: reefSeverity(issue),
      title: issue.code,
      description: "Diagnostic produced by lint_files.",
      factKinds: ["lint_files"],
      enabledByDefault: true,
    });
    findings.push({
      projectId: args.projectId,
      fingerprint: issue.identity.matchBasedId,
      source: LINT_FILES_REEF_SOURCE,
      subjectFingerprint,
      overlay: "indexed",
      severity: reefSeverity(issue),
      status: "active",
      filePath,
      ...(issue.line ? { line: issue.line } : {}),
      ruleId: issue.code,
      evidenceRefs: issue.evidenceRefs,
      freshness,
      capturedAt,
      message: issue.message,
      factFingerprints: [],
    });
  }

  if (descriptors.size > 0) {
    args.projectStore.saveReefRuleDescriptors([...descriptors.values()]);
  }
  args.projectStore.replaceReefFindingsForSource({
    projectId: args.projectId,
    source: LINT_FILES_REEF_SOURCE,
    overlay: "indexed",
    subjectFingerprints: [...subjectFingerprints],
    findings,
    reason: "lint_files no longer produced finding for indexed file",
  });
  return findings.length;
}

export async function lintFilesTool(
  input: LintFilesToolInput,
  options: ToolServiceOptions = {},
): Promise<LintFilesToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const warnings: string[] = [];
    const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;

    const resolvedFiles: string[] = [];
    const unresolvedFiles: string[] = [];
    for (const filePath of input.files) {
      if (projectStore.getFileContent(filePath) != null) {
        resolvedFiles.push(filePath);
      } else {
        unresolvedFiles.push(filePath);
      }
    }

    let findings: AnswerSurfaceIssue[] = [];
    let producedFindingCount = 0;
    let persistedFindingCount = 0;
    if (resolvedFiles.length > 0) {
      findings = collectDiagnosticsForFiles({
        projectStore,
        focusFiles: resolvedFiles,
        ...(input.primaryFocusFile ? { primaryFocusFile: input.primaryFocusFile } : {}),
      });
      producedFindingCount = findings.length;
      persistedFindingCount = persistLintFindingsToReef({
        projectId: project.projectId,
        projectStore,
        resolvedFiles,
        issues: findings,
      });
    }

    // Single-query ack loading: pulls all fingerprints for the requested
    // category into a Set, then filters findings by
    // `identity.matchBasedId`. When no category is opted into, the Set is
    // empty and acknowledgedCount stays at 0.
    let acknowledgedCount = 0;
    const excludeCategory = input.excludeAcknowledgedCategory;
    if (excludeCategory) {
      const acked = projectStore.loadAcknowledgedFingerprints(
        project.projectId,
        excludeCategory,
      );
      const before = findings.length;
      findings = findings.filter(
        (finding) => !acked.has(finding.identity.matchBasedId),
      );
      acknowledgedCount = before - findings.length;
    }

    const truncated = findings.length > maxFindings;
    if (truncated) {
      findings = findings.slice(0, maxFindings);
      warnings.push(
        `truncated: findings capped at ${maxFindings}. Raise maxFindings or narrow the file set.`,
      );
    }

    if (unresolvedFiles.length > 0) {
      warnings.push(
        `skipped ${unresolvedFiles.length} file(s) not in the indexed snapshot: ${unresolvedFiles
          .slice(0, 3)
          .join(", ")}${unresolvedFiles.length > 3 ? ", ..." : ""}`,
      );
    }

    if (resolvedFiles.length > 0 && findings.length === 0 && acknowledgedCount === 0) {
      warnings.push("no findings on the requested file set — rule-packs + alignment diagnostics returned clean.");
    }

    projectStore.saveReefDiagnosticRun({
      projectId: project.projectId,
      source: LINT_FILES_REEF_SOURCE,
      overlay: "indexed",
      status: "succeeded",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedMs),
      checkedFileCount: resolvedFiles.length,
      findingCount: producedFindingCount,
      persistedFindingCount,
      command: "indexed diagnostics engine",
      cwd: project.canonicalPath,
      metadata: {
        requestedFiles: input.files,
        requestedFileCount: input.files.length,
        unresolvedFiles,
        unresolvedFileCount: unresolvedFiles.length,
        maxFindings,
        truncated,
      },
    });

    return {
      toolName: "lint_files",
      projectId: project.projectId,
      resolvedFiles,
      unresolvedFiles,
      findings,
      acknowledgedCount,
      truncated,
      warnings,
    } satisfies LintFilesToolOutput;
  });
}
