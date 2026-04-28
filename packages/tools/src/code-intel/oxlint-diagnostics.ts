import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  OxlintDiagnosticsToolInput,
  OxlintDiagnosticsToolOutput,
  ProjectFinding,
  ReefDiagnosticRunStatus,
  ReefRuleDescriptor,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import {
  isWithinRoot,
  resolveLocalToolRunner,
  resolvePackageScriptRunner,
  resolveProjectPath,
  slashPath,
  type ExternalToolRunner,
} from "./external-diagnostics.js";

const DEFAULT_MAX_FINDINGS = 500;
const OXLINT_SOURCE = "oxlint";
const EXISTING_FINDINGS_CLEANUP_LIMIT = 10_000;
const OXLINT_TIMEOUT_MS = 30_000;

interface OxlintJsonSpan {
  line?: number;
  column?: number;
}

interface OxlintJsonLabel {
  span?: OxlintJsonSpan;
}

interface OxlintJsonDiagnostic {
  message?: string;
  code?: string;
  severity?: string;
  url?: string;
  help?: string;
  filename?: string;
  labels?: OxlintJsonLabel[];
}

interface OxlintJsonOutput {
  diagnostics?: OxlintJsonDiagnostic[];
  number_of_files?: number;
}

interface NormalizedOxlintDiagnostic {
  ruleId: string;
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: ProjectFinding["severity"];
  documentationUrl?: string;
  help?: string;
}

function resolveOxlintRunner(projectRoot: string, scriptName?: string): ExternalToolRunner | null {
  if (scriptName) {
    return resolvePackageScriptRunner(projectRoot, {
      scriptNames: [],
      requestedScriptName: scriptName,
    });
  }
  return resolveLocalToolRunner(projectRoot, {
    binName: "oxlint",
  }) ?? resolvePackageScriptRunner(projectRoot, {
    scriptNames: ["oxlint:json", "lint:oxlint", "mako:oxlint"],
  });
}

function oxlintSeverity(value: string | undefined): ProjectFinding["severity"] {
  switch ((value ?? "").toLowerCase()) {
    case "error":
    case "critical":
      return "error";
    case "info":
    case "hint":
      return "info";
    default:
      return "warning";
  }
}

function normalizeOxlintJson(projectRoot: string, output: OxlintJsonOutput): NormalizedOxlintDiagnostic[] {
  const diagnostics: NormalizedOxlintDiagnostic[] = [];
  for (const diagnostic of output.diagnostics ?? []) {
    if (!diagnostic.filename) {
      continue;
    }
    const absoluteFilePath = path.isAbsolute(diagnostic.filename)
      ? diagnostic.filename
      : path.resolve(projectRoot, diagnostic.filename);
    if (!isWithinRoot(projectRoot, absoluteFilePath)) {
      continue;
    }
    const primarySpan = diagnostic.labels?.find((label) => label.span)?.span;
    diagnostics.push({
      ruleId: diagnostic.code ?? "oxlint",
      message: (diagnostic.message ?? "Oxlint diagnostic").normalize("NFC"),
      filePath: slashPath(path.relative(projectRoot, absoluteFilePath)),
      ...(primarySpan?.line && primarySpan.line > 0 ? { line: primarySpan.line } : {}),
      ...(primarySpan?.column && primarySpan.column > 0 ? { column: primarySpan.column } : {}),
      severity: oxlintSeverity(diagnostic.severity),
      ...(diagnostic.url ? { documentationUrl: diagnostic.url } : {}),
      ...(diagnostic.help ? { help: diagnostic.help } : {}),
    });
  }
  return diagnostics;
}

function descriptorFor(diagnostic: NormalizedOxlintDiagnostic): ReefRuleDescriptor {
  return {
    id: diagnostic.ruleId,
    version: "1.0.0",
    source: OXLINT_SOURCE,
    sourceNamespace: "oxlint",
    type: diagnostic.severity === "info" ? "suggestion" : "problem",
    severity: diagnostic.severity,
    title: diagnostic.ruleId,
    description: diagnostic.help ?? "Oxlint diagnostic.",
    ...(diagnostic.documentationUrl ? { documentationUrl: diagnostic.documentationUrl } : {}),
    factKinds: ["oxlint_diagnostics"],
    enabledByDefault: true,
  };
}

function diagnosticToFinding(args: {
  projectId: string;
  projectStore: ProjectStore;
  diagnostic: NormalizedOxlintDiagnostic;
  capturedAt: string;
}): ProjectFinding {
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint({
    kind: "diagnostic",
    path: args.diagnostic.filePath,
    ruleId: args.diagnostic.ruleId,
  });
  const evidenceRefs = [
    `${args.diagnostic.filePath}:${args.diagnostic.line ?? 1}:${args.diagnostic.column ?? 1}`,
  ];
  return {
    projectId: args.projectId,
    fingerprint: args.projectStore.computeReefFindingFingerprint({
      source: OXLINT_SOURCE,
      ruleId: args.diagnostic.ruleId,
      subjectFingerprint,
      message: args.diagnostic.message,
      evidenceRefs,
    }),
    source: OXLINT_SOURCE,
    subjectFingerprint,
    overlay: "working_tree",
    severity: args.diagnostic.severity,
    status: "active",
    filePath: args.diagnostic.filePath,
    ...(args.diagnostic.line ? { line: args.diagnostic.line } : {}),
    ruleId: args.diagnostic.ruleId,
    ...(args.diagnostic.documentationUrl ? { documentationUrl: args.diagnostic.documentationUrl } : {}),
    evidenceRefs,
    freshness: {
      state: "fresh",
      checkedAt: args.capturedAt,
      reason: "Oxlint diagnostics read from working tree",
    },
    capturedAt: args.capturedAt,
    message: args.diagnostic.message,
    factFingerprints: [],
  };
}

export async function oxlintDiagnosticsTool(
  input: OxlintDiagnosticsToolInput,
  options: ToolServiceOptions = {},
): Promise<OxlintDiagnosticsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const projectRoot = path.resolve(project.canonicalPath);
    const warnings: string[] = [];
    const requestedFiles = input.files
      .map((filePath) => resolveProjectPath(projectRoot, filePath))
      .filter((filePath): filePath is string => filePath != null);
    if (requestedFiles.length !== input.files.length) {
      warnings.push("one or more requested files were outside the project root and ignored");
    }
    const inputRevision = projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath)?.currentRevision;

    const finish = (args: Omit<OxlintDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): OxlintDiagnosticsToolOutput => {
      const durationMs = Math.max(0, Date.now() - startedMs);
      const outputRevision = projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath)?.currentRevision;
      projectStore.saveReefDiagnosticRun({
        projectId: project.projectId,
        source: OXLINT_SOURCE,
        overlay: "working_tree",
        status: args.status,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        checkedFileCount: args.checkedFileCount,
        findingCount: args.totalFindings,
        persistedFindingCount: args.persistedFindings,
        command: args.command,
        cwd: projectRoot,
        errorText: args.errorText,
        metadata: {
          sourceKind: "lint",
          ...(inputRevision !== undefined ? { inputRevision } : {}),
          ...(outputRevision !== undefined ? { outputRevision } : {}),
          requestedFiles,
          requestedFileCount: requestedFiles.length,
          scriptName: input.scriptName ?? null,
          exitCode: args.exitCode ?? null,
          truncated: args.truncated,
        },
      });
      return {
        toolName: "oxlint_diagnostics",
        projectId: project.projectId,
        projectRoot,
        durationMs,
        requestedFiles,
        warnings,
        ...args,
      };
    };

    if (requestedFiles.length === 0) {
      return finish({
        status: "ran_with_error",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: "no requested files resolved inside the project root",
      });
    }

    const runner = resolveOxlintRunner(projectRoot, input.scriptName);
    if (!runner) {
      return finish({
        status: "unavailable",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: input.scriptName
          ? `Oxlint package script not found: ${input.scriptName}`
          : "local Oxlint executable or oxlint:json/lint:oxlint package script not found",
      });
    }

    const oxlintArgs = [
      ...runner.argsPrefix,
      "--format",
      "json",
      ...requestedFiles,
    ];
    const command = `${runner.display} --format json ${requestedFiles.join(" ")}`;
    const result = spawnSync(runner.command, oxlintArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: OXLINT_TIMEOUT_MS,
      windowsHide: true,
      ...(runner.shell ? { shell: true } : {}),
    });

    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    if (result.error) {
      return finish({
        status: "ran_with_error",
        command,
        exitCode: result.status ?? undefined,
        checkedFileCount: requestedFiles.length,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: result.error.message,
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = stdout ? JSON.parse(stdout) : { diagnostics: [] };
    } catch {
      return finish({
        status: "ran_with_error",
        command,
        exitCode: result.status ?? undefined,
        checkedFileCount: requestedFiles.length,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: stderr || "Oxlint did not produce JSON output",
      });
    }
    if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      return finish({
        status: "ran_with_error",
        command,
        exitCode: result.status ?? undefined,
        checkedFileCount: requestedFiles.length,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: "Oxlint JSON output was not an object",
      });
    }
    if (stderr && result.status !== 0) {
      warnings.push(`oxlint stderr: ${stderr.slice(0, 500)}`);
    }

    const capturedAt = new Date().toISOString();
    const diagnostics = normalizeOxlintJson(projectRoot, parsedJson as OxlintJsonOutput);
    const findings = diagnostics.map((diagnostic) =>
      diagnosticToFinding({
        projectId: project.projectId,
        projectStore,
        diagnostic,
        capturedAt,
      }),
    );
    const existingScopedFindings = requestedFiles.flatMap((filePath) =>
      projectStore.queryReefFindings({
        projectId: project.projectId,
        source: OXLINT_SOURCE,
        overlay: "working_tree",
        filePath,
        limit: EXISTING_FINDINGS_CLEANUP_LIMIT,
      }),
    );
    const subjectFingerprints = new Set(existingScopedFindings.map((finding) => finding.subjectFingerprint));
    for (const finding of findings) {
      subjectFingerprints.add(finding.subjectFingerprint);
    }
    const descriptors = new Map(
      diagnostics.map((diagnostic) => [diagnostic.ruleId, descriptorFor(diagnostic)] as const),
    );
    if (descriptors.size > 0) {
      projectStore.saveReefRuleDescriptors([...descriptors.values()]);
    }
    projectStore.replaceReefFindingsForSource({
      projectId: project.projectId,
      source: OXLINT_SOURCE,
      overlay: "working_tree",
      subjectFingerprints: [...subjectFingerprints],
      findings,
      reason: "oxlint_diagnostics no longer produced finding for scoped file",
    });

    const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;
    const truncated = findings.length > maxFindings;
    return finish({
      status: "succeeded" satisfies ReefDiagnosticRunStatus,
      command,
      exitCode: result.status ?? undefined,
      checkedFileCount: typeof (parsedJson as OxlintJsonOutput).number_of_files === "number"
        ? (parsedJson as OxlintJsonOutput).number_of_files ?? requestedFiles.length
        : requestedFiles.length,
      findings: truncated ? findings.slice(0, maxFindings) : findings,
      totalFindings: findings.length,
      persistedFindings: findings.length,
      truncated,
    });
  });
}
