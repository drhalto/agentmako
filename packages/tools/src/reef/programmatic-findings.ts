import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type {
  AttachedProject,
  DiagnosticRefreshResult,
  DiagnosticRefreshToolInput,
  FactFreshness,
  GitPrecommitFinding,
  JsonObject,
  ProjectFinding,
  ProjectProfile,
  ReefRuleDescriptor,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { analyzeGitGuardSourceFiles, type GitGuardSourceFile } from "../code-intel/git-precommit-check.js";
import { normalizeFileQuery } from "../entity-resolver.js";

const SOURCE = "programmatic_findings";
const DEFAULT_MAX_FINDINGS = 500;
const SCHEMA_USAGE_STALE_RULE_ID = "schema_usage.stale_evidence";

const PROGRAMMATIC_RULES: ReefRuleDescriptor[] = [
  {
    id: "git.unprotected_route",
    version: "1.0.0",
    source: SOURCE,
    sourceNamespace: SOURCE,
    type: "problem",
    severity: "error",
    title: "Unprotected route",
    description: "A route has no detected auth guard and is not allowlisted as public.",
    factKinds: ["programmatic_findings"],
    enabledByDefault: true,
  },
  {
    id: "git.client_uses_server_only",
    version: "1.0.0",
    source: SOURCE,
    sourceNamespace: SOURCE,
    type: "problem",
    severity: "error",
    title: "Client imports server-only code",
    description: "A client component imports or calls server-only APIs.",
    factKinds: ["programmatic_findings"],
    enabledByDefault: true,
  },
  {
    id: "git.server_uses_client_hook",
    version: "1.0.0",
    source: SOURCE,
    sourceNamespace: SOURCE,
    type: "problem",
    severity: "warning",
    title: "Server file uses client hook",
    description: "A server file calls a React client hook without a top-level use client directive.",
    factKinds: ["programmatic_findings"],
    enabledByDefault: true,
  },
  {
    id: SCHEMA_USAGE_STALE_RULE_ID,
    version: "1.0.0",
    source: SOURCE,
    sourceNamespace: SOURCE,
    type: "problem",
    severity: "warning",
    title: "Schema usage depends on stale schema evidence",
    description: "An indexed schema usage is backed by stale, unknown, or missing schema freshness evidence.",
    factKinds: ["db_usage"],
    enabledByDefault: true,
  },
];

export interface ProgrammaticFindingsRefreshResult {
  result: DiagnosticRefreshResult;
  findings: ProjectFinding[];
}

export function runProgrammaticFindingsRefresh(args: {
  input: DiagnosticRefreshToolInput;
  project: AttachedProject;
  profile: ProjectProfile | null;
  projectStore: ProjectStore;
}): ProgrammaticFindingsRefreshResult {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const inputRevision = args.projectStore.loadReefAnalysisState(
    args.project.projectId,
    args.project.canonicalPath,
  )?.currentRevision;
  const maxFindings = args.input.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const warnings: string[] = [];
  const selectedFiles = selectProgrammaticFiles(args.input, args.project, args.projectStore, warnings);
  const sourceFiles = readProgrammaticSourceFiles(args.project.canonicalPath, selectedFiles, warnings);

  const gitGuard = analyzeGitGuardSourceFiles({
    projectRoot: args.project.canonicalPath,
    projectStore: args.projectStore,
    profile: args.profile,
    files: sourceFiles,
  });
  warnings.push(...gitGuard.warnings);
  if (gitGuard.skippedFiles.length > 0) {
    warnings.push(`skipped ${gitGuard.skippedFiles.length} non-TypeScript file(s) for route/boundary checks`);
  }

  const subjectFingerprints = new Set<string>();
  for (const filePath of gitGuard.checkedFiles) {
    for (const ruleId of ["git.unprotected_route", "git.client_uses_server_only", "git.server_uses_client_hook"]) {
      subjectFingerprints.add(args.projectStore.computeReefSubjectFingerprint({
        kind: "diagnostic",
        path: filePath,
        code: ruleId,
      }));
    }
  }

  const findings = [
    ...gitGuard.findings.map((finding) =>
      gitGuardFindingToReef({
        projectId: args.project.projectId,
        projectStore: args.projectStore,
        finding,
        capturedAt: startedAt,
      })
    ),
    ...schemaUsageFreshnessFindings({
      projectId: args.project.projectId,
      projectStore: args.projectStore,
      scopedFiles: selectedFiles,
      scopedToFiles: (args.input.files?.length ?? 0) > 0,
      capturedAt: startedAt,
      subjectFingerprints,
    }),
  ];

  for (const finding of findings) {
    subjectFingerprints.add(finding.subjectFingerprint);
  }

  const persistedFindings = findings.slice(0, maxFindings);
  if (findings.length > persistedFindings.length) {
    warnings.push(`truncated: findings capped at ${maxFindings}. Raise maxFindings or narrow the file set.`);
  }

  args.projectStore.saveReefRuleDescriptors(PROGRAMMATIC_RULES);
  args.projectStore.replaceReefFindingsForSource({
    projectId: args.project.projectId,
    source: SOURCE,
    overlay: "working_tree",
    subjectFingerprints: [...subjectFingerprints],
    findings: persistedFindings,
    reason: "programmatic_findings no longer produced finding for scoped subject",
  });

  const outputRevision = args.projectStore.loadReefAnalysisState(
    args.project.projectId,
    args.project.canonicalPath,
  )?.currentRevision;
  args.projectStore.saveReefDiagnosticRun({
    projectId: args.project.projectId,
    source: SOURCE,
    overlay: "working_tree",
    status: "succeeded",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedMs),
    checkedFileCount: gitGuard.checkedFiles.length,
    findingCount: findings.length,
    persistedFindingCount: persistedFindings.length,
    command: "programmatic findings refresh",
    cwd: args.project.canonicalPath,
    metadata: {
      sourceKind: "programmatic",
      ...(inputRevision !== undefined ? { inputRevision } : {}),
      ...(outputRevision !== undefined ? { outputRevision } : {}),
      requestedFiles: args.input.files ?? [],
      selectedFileCount: selectedFiles.length,
      checkedFileCount: gitGuard.checkedFiles.length,
      schemaUsageRuleId: SCHEMA_USAGE_STALE_RULE_ID,
      maxFindings,
      truncated: findings.length > persistedFindings.length,
    },
  });

  return {
    result: {
      source: SOURCE,
      toolName: "diagnostic_refresh",
      status: "succeeded",
      durationMs: Math.max(0, Date.now() - startedMs),
      checkedFileCount: gitGuard.checkedFiles.length,
      totalFindings: findings.length,
      persistedFindings: persistedFindings.length,
      warnings,
    },
    findings: persistedFindings,
  };
}

function selectProgrammaticFiles(
  input: DiagnosticRefreshToolInput,
  project: AttachedProject,
  projectStore: ProjectStore,
  warnings: string[],
): string[] {
  const requested = input.files?.map((file) => safeRelativeFile(project.canonicalPath, file)) ?? [];
  if (requested.length > 0) {
    const selected = requested.filter((file): file is string => file != null);
    if (selected.length < requested.length) {
      warnings.push("skipped one or more files outside the project root");
    }
    return [...new Set(selected)];
  }
  return projectStore.listFiles()
    .map((file) => file.path)
    .filter(isProgrammaticSourcePath)
    .sort((left, right) => left.localeCompare(right));
}

function safeRelativeFile(projectRoot: string, fileQuery: string): string | null {
  const normalized = normalizeFileQuery(projectRoot, fileQuery);
  if (normalized === "" || isAbsolute(normalized)) {
    return null;
  }
  const absolute = resolve(projectRoot, normalized);
  const relativePath = relative(projectRoot, absolute);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return normalized.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isProgrammaticSourcePath(filePath: string): boolean {
  return [".ts", ".tsx"].includes(extname(filePath));
}

function readProgrammaticSourceFiles(
  projectRoot: string,
  filePaths: readonly string[],
  warnings: string[],
): GitGuardSourceFile[] {
  const files: GitGuardSourceFile[] = [];
  const missing: string[] = [];
  for (const filePath of filePaths) {
    const absolute = resolve(projectRoot, filePath);
    if (!existsSync(absolute)) {
      missing.push(filePath);
      continue;
    }
    files.push({
      projectPath: filePath,
      content: readFileSync(absolute, "utf8"),
    });
  }
  if (missing.length > 0) {
    warnings.push(
      `skipped ${missing.length} missing file(s): ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}`,
    );
  }
  return files;
}

function gitGuardFindingToReef(args: {
  projectId: string;
  projectStore: ProjectStore;
  finding: GitPrecommitFinding;
  capturedAt: string;
}): ProjectFinding {
  const subject = {
    kind: "diagnostic" as const,
    path: args.finding.path,
    code: args.finding.code,
  };
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint(subject);
  const evidenceRefs = args.finding.evidence ? [args.finding.evidence] : [];
  return {
    projectId: args.projectId,
    fingerprint: args.projectStore.computeReefFindingFingerprint({
      source: SOURCE,
      ruleId: args.finding.code,
      subjectFingerprint,
      message: args.finding.message,
      evidenceRefs,
    }),
    source: SOURCE,
    subjectFingerprint,
    overlay: "working_tree",
    severity: args.finding.severity === "critical" ? "error" : "warning",
    status: "active",
    filePath: args.finding.path,
    ...(args.finding.line ? { line: args.finding.line } : {}),
    ruleId: args.finding.code,
    evidenceRefs,
    freshness: {
      state: "fresh",
      checkedAt: args.capturedAt,
      reason: "programmatic working-tree route and runtime-boundary checks",
    },
    capturedAt: args.capturedAt,
    message: args.finding.message,
    factFingerprints: [],
  };
}

function schemaUsageFreshnessFindings(args: {
  projectId: string;
  projectStore: ProjectStore;
  scopedFiles: readonly string[];
  scopedToFiles: boolean;
  capturedAt: string;
  subjectFingerprints: Set<string>;
}): ProjectFinding[] {
  const scopedFiles = new Set(args.scopedFiles);
  const findings: ProjectFinding[] = [];
  const facts = args.projectStore.queryReefFacts({
    projectId: args.projectId,
    overlay: "indexed",
    source: "db_reef_refresh",
    limit: 5000,
  });
  for (const fact of facts) {
    const filePath = stringValue(fact.data, "filePath");
    if (args.scopedToFiles && (!filePath || !scopedFiles.has(filePath))) {
      continue;
    }
    // When filePath is present, anchor by file+code so a file's stale-evidence
    // finding has a stable identity across runs. When filePath is missing,
    // anchor on the underlying fact's fingerprint plus the rule ID — stable
    // across runs without colliding with the fact's own subject identity.
    const subjectFingerprint = filePath
      ? args.projectStore.computeReefSubjectFingerprint({
          kind: "diagnostic" as const,
          path: filePath,
          code: schemaUsageCode(fact.data),
          ruleId: SCHEMA_USAGE_STALE_RULE_ID,
        })
      : args.projectStore.computeReefSubjectFingerprint({
          kind: "diagnostic" as const,
          path: `schema_fact:${fact.fingerprint}`,
          code: SCHEMA_USAGE_STALE_RULE_ID,
        });
    args.subjectFingerprints.add(subjectFingerprint);
    if (fact.freshness.state === "fresh") {
      continue;
    }
    findings.push(schemaUsageFinding({
      projectId: args.projectId,
      projectStore: args.projectStore,
      subjectFingerprint,
      filePath,
      line: numberValue(fact.data, "line"),
      capturedAt: args.capturedAt,
      freshness: fact.freshness,
      factFingerprint: fact.fingerprint,
      metadata: fact.provenance.metadata,
    }));
  }
  return findings;
}

function schemaUsageFinding(args: {
  projectId: string;
  projectStore: ProjectStore;
  subjectFingerprint: string;
  filePath: string | undefined;
  line: number | undefined;
  capturedAt: string;
  freshness: FactFreshness;
  factFingerprint: string;
  metadata: JsonObject | undefined;
}): ProjectFinding {
  const evidenceRefs = schemaUsageEvidenceRefs(args);
  const message = "schema-backed usage depends on stale schema evidence";
  return {
    projectId: args.projectId,
    fingerprint: args.projectStore.computeReefFindingFingerprint({
      source: SOURCE,
      ruleId: SCHEMA_USAGE_STALE_RULE_ID,
      subjectFingerprint: args.subjectFingerprint,
      message,
      evidenceRefs,
    }),
    source: SOURCE,
    subjectFingerprint: args.subjectFingerprint,
    overlay: "working_tree",
    severity: args.freshness.state === "unknown" ? "info" : "warning",
    status: "active",
    ...(args.filePath ? { filePath: args.filePath } : {}),
    ...(args.line ? { line: args.line } : {}),
    ruleId: SCHEMA_USAGE_STALE_RULE_ID,
    evidenceRefs,
    freshness: args.freshness,
    capturedAt: args.capturedAt,
    message,
    factFingerprints: [args.factFingerprint],
  };
}

function schemaUsageEvidenceRefs(args: {
  filePath: string | undefined;
  line: number | undefined;
  metadata: JsonObject | undefined;
}): string[] {
  const refs = args.filePath
    ? [args.line ? `${args.filePath}:L${args.line}` : args.filePath]
    : ["schema_snapshot"];
  for (const key of ["sourceFreshness", "liveDbFreshness", "lastSnapshotAt", "snapshotAgeMs", "liveSnapshotMaxAgeMs"]) {
    const value = args.metadata?.[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      refs.push(`${key}:${String(value)}`);
    }
  }
  return refs;
}

function schemaUsageCode(data: JsonObject | undefined): string {
  const schemaName = stringValue(data, "schemaName") ?? "unknown";
  const objectName = stringValue(data, "objectName") ?? "unknown";
  const usageKind = stringValue(data, "usageKind") ?? "usage";
  const line = numberValue(data, "line") ?? 0;
  return `${schemaName}.${objectName}:${usageKind}:${line}`;
}

function stringValue(data: JsonObject | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(data: JsonObject | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
