/**
 * owasp_audit result builder.
 *
 * Scans the indexed TS/JS snapshot with the OWASP detector catalog, maps the
 * raw hits to typed findings, reuses the git-guard analyzer for A01 (broken
 * access control on unprotected routes), and always emits a full 10-category
 * coverage section so the tool is explicit about what it did and did not check.
 */

import type {
  OwaspAuditBasis,
  OwaspAuditFinding,
  OwaspAuditResult,
  OwaspAuditSummary,
  OwaspCategoryId,
  OwaspCoverageEntry,
  ProjectProfile,
  WorkflowPacketFollowOnHint,
} from "@mako-ai/contracts";
import { hashJson, type ProjectStore } from "@mako-ai/store";
import type { ProgressReporter } from "../../progress/types.js";
import { langFromPath } from "../../code-intel/ast-patterns.js";
import {
  analyzeGitGuardSourceFiles,
  type GitGuardSourceFile,
} from "../../code-intel/git-precommit-check.js";
import {
  A01_UNPROTECTED_ROUTE_DETECTOR_ID,
  OWASP_CATEGORY_META,
  OWASP_DETECTORS,
  getDetectorById,
  type OwaspDetector,
} from "./catalog.js";
import { buildDetectorContext, runOwaspDetectorsOnFile } from "./detectors.js";

const OWASP_ROLLOUT_STAGE = "opt_in" as const;
const DEFAULT_MAX_FILES = 5000;
const ALL_CATEGORY_IDS: OwaspCategoryId[] = [
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
];
const OWASP_2025_URL = "https://owasp.org/Top10/2025/";

export interface BuildOwaspAuditArgs {
  projectRoot: string;
  profile: ProjectProfile | null;
  projectStore: ProjectStore;
  categories?: OwaspCategoryId[];
  maxFiles?: number;
  freshen?: boolean;
  progressReporter?: ProgressReporter;
}

export async function buildOwaspAuditResult(args: BuildOwaspAuditArgs): Promise<OwaspAuditResult> {
  const { projectRoot, profile, projectStore } = args;
  const selected = args.categories && args.categories.length > 0 ? new Set(args.categories) : null;
  const maxFiles = args.maxFiles ?? DEFAULT_MAX_FILES;
  const warnings: string[] = [];

  const catalogDetectors = OWASP_DETECTORS.filter(
    (detector) => !selected || selected.has(detector.owaspCategory),
  );
  const runA01 = !selected || selected.has("A01");

  const indexedFiles = projectStore
    .listFiles()
    .filter((file) => langFromPath(file.path) != null);
  const truncatedScan = indexedFiles.length > maxFiles;
  const filesToScan = truncatedScan ? indexedFiles.slice(0, maxFiles) : indexedFiles;

  const latestIndexRun = projectStore.getLatestIndexRun();
  if (filesToScan.length === 0) {
    warnings.push(
      "owasp_audit found no indexed TS/JS files to scan; run project_index_refresh first if the project should contain source files.",
    );
  } else if (args.freshen !== false && !latestIndexRun) {
    warnings.push(
      "owasp_audit scanned the indexed snapshot but found no index run on record; results may be stale — run project_index_refresh.",
    );
  }

  const findings: OwaspAuditFinding[] = [];
  const routeSourceFiles: GitGuardSourceFile[] = [];

  await args.progressReporter?.report({
    stage: "file_scan",
    message: `Scanning ${filesToScan.length} indexed TS/JS file(s) with ${catalogDetectors.length} detector(s).`,
    current: 0,
    total: filesToScan.length,
  });

  for (let index = 0; index < filesToScan.length; index += 1) {
    const file = filesToScan[index];
    const content = projectStore.getFileContent(file.path);
    if (content == null) {
      continue;
    }

    if (runA01 && isApiRouteCandidate(file.path)) {
      routeSourceFiles.push({ projectPath: file.path, content });
    }

    if (catalogDetectors.length === 0) {
      continue;
    }

    const ctx = buildDetectorContext(file.path, content);
    if (ctx == null) {
      continue;
    }
    for (const hit of runOwaspDetectorsOnFile(ctx, catalogDetectors)) {
      const detector = getDetectorById(hit.detectorId);
      if (!detector) {
        continue;
      }
      findings.push(buildCatalogFinding(detector, file.path, hit.line, hit.evidence, hit.strength));
    }

    if ((index + 1) % 500 === 0) {
      await args.progressReporter?.report({
        stage: "file_scan",
        message: `Scanned ${index + 1}/${filesToScan.length} files.`,
        current: index + 1,
        total: filesToScan.length,
      });
    }
  }

  if (runA01 && routeSourceFiles.length > 0) {
    findings.push(...collectAccessControlFindings(projectRoot, profile, projectStore, routeSourceFiles));
  }

  const dedupedFindings = dedupeFindings(findings).sort(compareFindings);
  const coverage = buildCoverage(selected, dedupedFindings);
  const summary = buildSummary(dedupedFindings, coverage);
  const recommendedFollowOn = buildFollowOnHint(dedupedFindings);

  warnings.push(
    "owasp_audit reports heuristic, evidence-backed signals — not a complete security assessment. It does not replace dedicated SAST/SCA (Semgrep, CodeQL) or manual review.",
  );
  if (truncatedScan) {
    warnings.push(
      `Scan capped at ${maxFiles} files of ${indexedFiles.length}; raise maxFiles for full coverage.`,
    );
  }

  const basis: OwaspAuditBasis = {
    latestIndexRunId: latestIndexRun?.runId ?? null,
    scannedFileCount: filesToScan.length,
    truncatedScan,
  };

  return {
    advisoryOnly: true,
    rolloutStage: OWASP_ROLLOUT_STAGE,
    basis,
    coverage,
    findings: dedupedFindings,
    ...(recommendedFollowOn ? { recommendedFollowOn } : {}),
    summary,
    warnings,
  };
}

function isApiRouteCandidate(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("app/api/") || normalized.includes("pages/api/");
}

function collectAccessControlFindings(
  projectRoot: string,
  profile: ProjectProfile | null,
  projectStore: ProjectStore,
  files: GitGuardSourceFile[],
): OwaspAuditFinding[] {
  const analysis = analyzeGitGuardSourceFiles({ projectRoot, projectStore, profile, files });
  const out: OwaspAuditFinding[] = [];
  for (const finding of analysis.findings) {
    if (finding.code !== "git.unprotected_route") {
      continue;
    }
    out.push(
      buildFinding({
        owaspCategory: "A01",
        detectorId: A01_UNPROTECTED_ROUTE_DETECTOR_ID,
        strength: "direct_evidence",
        severity: finding.severity === "critical" ? "critical" : "high",
        surfaceKind: "route",
        surfaceKey: finding.path,
        filePath: finding.path,
        line: finding.line,
        message:
          "API route has no detected auth guard and is not allowlisted as public; enforce authentication/authorization before handling the request.",
        cwe: ["CWE-862"],
        references: [OWASP_2025_URL],
        evidence: finding.evidence,
        metadata: { sourceCode: finding.code },
      }),
    );
  }
  return out;
}

function buildCatalogFinding(
  detector: OwaspDetector,
  filePath: string,
  line: number,
  evidence: string,
  strength: OwaspAuditFinding["strength"],
): OwaspAuditFinding {
  return buildFinding({
    owaspCategory: detector.owaspCategory,
    detectorId: detector.id,
    strength,
    severity: detector.severity,
    surfaceKind: "file",
    surfaceKey: filePath,
    filePath,
    line,
    message: detector.message,
    cwe: detector.cwe,
    references: detector.references,
    evidence,
  });
}

function buildFinding(input: {
  owaspCategory: OwaspCategoryId;
  detectorId: string;
  strength: OwaspAuditFinding["strength"];
  severity: OwaspAuditFinding["severity"];
  surfaceKind: OwaspAuditFinding["surfaceKind"];
  surfaceKey: string;
  filePath: string;
  line?: number;
  message: string;
  cwe: string[];
  references: string[];
  evidence: string;
  metadata?: OwaspAuditFinding["metadata"];
}): OwaspAuditFinding {
  const meta = OWASP_CATEGORY_META[input.owaspCategory];
  const evidenceRef =
    typeof input.line === "number" ? `${input.filePath}:${input.line}` : input.filePath;
  return {
    findingId: `owasp_finding_${hashJson({
      detectorId: input.detectorId,
      filePath: input.filePath,
      line: input.line ?? null,
      surfaceKey: input.surfaceKey,
      evidence: input.evidence,
    })}`,
    owaspCategory: input.owaspCategory,
    owaspTitle: meta.title,
    owaspRef: meta.ref,
    detectorId: input.detectorId,
    strength: input.strength,
    severity: input.severity,
    surfaceKind: input.surfaceKind,
    surfaceKey: input.surfaceKey,
    filePath: input.filePath,
    ...(typeof input.line === "number" ? { line: input.line } : {}),
    message: input.message,
    cwe: [...input.cwe],
    references: [...input.references],
    evidenceRefs: [evidenceRef],
    metadata: { evidence: input.evidence, ...(input.metadata ?? {}) },
  };
}

function dedupeFindings(findings: readonly OwaspAuditFinding[]): OwaspAuditFinding[] {
  const seen = new Map<string, OwaspAuditFinding>();
  for (const finding of findings) {
    if (!seen.has(finding.findingId)) {
      seen.set(finding.findingId, finding);
    }
  }
  return [...seen.values()];
}

function buildCoverage(
  selected: Set<OwaspCategoryId> | null,
  findings: readonly OwaspAuditFinding[],
): OwaspCoverageEntry[] {
  return ALL_CATEGORY_IDS.map((category) => {
    const meta = OWASP_CATEGORY_META[category];
    const detectorIds = collectDetectorIdsForCategory(category);
    const requested = !selected || selected.has(category);
    let status = meta.baseStatus;
    let note = meta.note;
    if (meta.baseStatus === "scanned" && !requested) {
      status = "not_covered";
      note = `Skipped: not in the requested categories. ${meta.note}`;
    }
    return {
      owaspCategory: category,
      owaspTitle: meta.title,
      owaspRef: meta.ref,
      status,
      detectorIds: requested ? detectorIds : [],
      note,
    };
  });
}

function collectDetectorIdsForCategory(category: OwaspCategoryId): string[] {
  const ids = OWASP_DETECTORS.filter((detector) => detector.owaspCategory === category).map(
    (detector) => detector.id,
  );
  if (category === "A01") {
    ids.push(A01_UNPROTECTED_ROUTE_DETECTOR_ID);
  }
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function buildSummary(
  findings: readonly OwaspAuditFinding[],
  coverage: readonly OwaspCoverageEntry[],
): OwaspAuditSummary {
  const byCategory: Record<string, number> = {};
  for (const finding of findings) {
    byCategory[finding.owaspCategory] = (byCategory[finding.owaspCategory] ?? 0) + 1;
  }
  return {
    findingCount: findings.length,
    directEvidenceCount: findings.filter((finding) => finding.strength === "direct_evidence").length,
    weakSignalCount: findings.filter((finding) => finding.strength === "weak_signal").length,
    scannedCategoryCount: coverage.filter((entry) => entry.status === "scanned").length,
    notCoveredCategoryCount: coverage.filter((entry) => entry.status === "not_covered").length,
    byCategory,
  };
}

function buildFollowOnHint(
  findings: readonly OwaspAuditFinding[],
): WorkflowPacketFollowOnHint | null {
  const directEvidenceCount = findings.filter(
    (finding) => finding.strength === "direct_evidence",
  ).length;
  const weakSignalCount = findings.filter((finding) => finding.strength === "weak_signal").length;

  if (directEvidenceCount > 0) {
    return {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason:
        directEvidenceCount === 1
          ? "turn the direct OWASP finding into one implementation brief with concrete remediation and verification guidance"
          : `turn the ${directEvidenceCount} direct OWASP findings into one implementation brief with concrete remediation and verification guidance`,
    };
  }
  if (weakSignalCount > 0) {
    return {
      toolName: "workflow_packet",
      family: "verification_plan",
      reason:
        weakSignalCount === 1
          ? "turn the weak OWASP signal into a targeted verification plan before treating it as a confirmed vulnerability"
          : `turn the ${weakSignalCount} weak OWASP signals into a targeted verification plan before treating them as confirmed vulnerabilities`,
    };
  }
  return null;
}

const STRENGTH_ORDER: Record<OwaspAuditFinding["strength"], number> = {
  direct_evidence: 0,
  weak_signal: 1,
};

function compareFindings(left: OwaspAuditFinding, right: OwaspAuditFinding): number {
  if (left.owaspCategory !== right.owaspCategory) {
    return left.owaspCategory.localeCompare(right.owaspCategory);
  }
  if (left.strength !== right.strength) {
    return STRENGTH_ORDER[left.strength] - STRENGTH_ORDER[right.strength];
  }
  if (left.filePath !== right.filePath) {
    return left.filePath.localeCompare(right.filePath);
  }
  return (left.line ?? 0) - (right.line ?? 0);
}
