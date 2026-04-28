import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  EslintDiagnosticsToolInput,
  EslintDiagnosticsToolOutput,
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
const ESLINT_SOURCE = "eslint";
const EXISTING_FINDINGS_CLEANUP_LIMIT = 10_000;
const ESLINT_TIMEOUT_MS = 30_000;

interface EslintJsonMessage {
  ruleId?: string | null;
  severity?: number;
  message?: string;
  line?: number;
  column?: number;
}

interface EslintJsonResult {
  filePath?: string;
  messages?: EslintJsonMessage[];
}

interface NormalizedEslintDiagnostic {
  ruleId: string;
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: ProjectFinding["severity"];
}

function resolveEslintRunner(projectRoot: string, scriptName?: string): ExternalToolRunner | null {
  if (scriptName) {
    return resolvePackageScriptRunner(projectRoot, {
      scriptNames: [],
      requestedScriptName: scriptName,
    });
  }
  return resolveLocalToolRunner(projectRoot, {
    binName: "eslint",
    jsEntryCandidates: ["node_modules/eslint/bin/eslint.js"],
  }) ?? resolvePackageScriptRunner(projectRoot, {
    scriptNames: ["eslint:json", "lint:json", "mako:eslint"],
  });
}

function eslintSeverity(value: number | undefined): ProjectFinding["severity"] {
  return value === 2 ? "error" : "warning";
}

function normalizeEslintJson(
  projectRoot: string,
  results: EslintJsonResult[],
): NormalizedEslintDiagnostic[] {
  const diagnostics: NormalizedEslintDiagnostic[] = [];
  for (const result of results) {
    if (!result.filePath) {
      continue;
    }
    const absoluteFilePath = path.isAbsolute(result.filePath)
      ? result.filePath
      : path.resolve(projectRoot, result.filePath);
    if (!isWithinRoot(projectRoot, absoluteFilePath)) {
      continue;
    }
    const filePath = slashPath(path.relative(projectRoot, absoluteFilePath));
    for (const message of result.messages ?? []) {
      diagnostics.push({
        ruleId: message.ruleId ?? "eslint",
        message: (message.message ?? "ESLint diagnostic").normalize("NFC"),
        filePath,
        ...(message.line && message.line > 0 ? { line: message.line } : {}),
        ...(message.column && message.column > 0 ? { column: message.column } : {}),
        severity: eslintSeverity(message.severity),
      });
    }
  }
  return diagnostics;
}

function descriptorFor(diagnostic: NormalizedEslintDiagnostic): ReefRuleDescriptor {
  const isCoreRule = !diagnostic.ruleId.includes("/");
  return {
    id: diagnostic.ruleId,
    version: "1.0.0",
    source: ESLINT_SOURCE,
    sourceNamespace: "eslint",
    type: "problem",
    severity: diagnostic.severity,
    title: diagnostic.ruleId,
    description: "ESLint diagnostic.",
    ...(isCoreRule ? { documentationUrl: `https://eslint.org/docs/latest/rules/${diagnostic.ruleId}` } : {}),
    factKinds: ["eslint_diagnostics"],
    enabledByDefault: true,
  };
}

function diagnosticToFinding(args: {
  projectId: string;
  projectStore: ProjectStore;
  diagnostic: NormalizedEslintDiagnostic;
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
      source: ESLINT_SOURCE,
      ruleId: args.diagnostic.ruleId,
      subjectFingerprint,
      message: args.diagnostic.message,
      evidenceRefs,
    }),
    source: ESLINT_SOURCE,
    subjectFingerprint,
    overlay: "working_tree",
    severity: args.diagnostic.severity,
    status: "active",
    filePath: args.diagnostic.filePath,
    ...(args.diagnostic.line ? { line: args.diagnostic.line } : {}),
    ruleId: args.diagnostic.ruleId,
    evidenceRefs,
    freshness: {
      state: "fresh",
      checkedAt: args.capturedAt,
      reason: "ESLint diagnostics read from working tree",
    },
    capturedAt: args.capturedAt,
    message: args.diagnostic.message,
    factFingerprints: [],
  };
}

export async function eslintDiagnosticsTool(
  input: EslintDiagnosticsToolInput,
  options: ToolServiceOptions = {},
): Promise<EslintDiagnosticsToolOutput> {
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

    const finish = (args: Omit<EslintDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): EslintDiagnosticsToolOutput => {
      const durationMs = Math.max(0, Date.now() - startedMs);
      const outputRevision = projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath)?.currentRevision;
      projectStore.saveReefDiagnosticRun({
        projectId: project.projectId,
        source: ESLINT_SOURCE,
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
        toolName: "eslint_diagnostics",
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

    const runner = resolveEslintRunner(projectRoot, input.scriptName);
    if (!runner) {
      return finish({
        status: "unavailable",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: input.scriptName
          ? `ESLint package script not found: ${input.scriptName}`
          : "local ESLint executable or eslint:json/lint:json package script not found",
      });
    }

    const eslintArgs = [
      ...runner.argsPrefix,
      "--format",
      "json",
      ...requestedFiles,
    ];
    const command = `${runner.display} --format json ${requestedFiles.join(" ")}`;
    const result = spawnSync(runner.command, eslintArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: ESLINT_TIMEOUT_MS,
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
      parsedJson = stdout ? JSON.parse(stdout) : [];
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
        errorText: stderr || "ESLint did not produce JSON output",
      });
    }

    if (!Array.isArray(parsedJson)) {
      return finish({
        status: "ran_with_error",
        command,
        exitCode: result.status ?? undefined,
        checkedFileCount: requestedFiles.length,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: "ESLint JSON output was not an array",
      });
    }

    if (stderr && result.status !== 0) {
      warnings.push(`eslint stderr: ${stderr.slice(0, 500)}`);
    }

    const capturedAt = new Date().toISOString();
    const diagnostics = normalizeEslintJson(projectRoot, parsedJson as EslintJsonResult[]);
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
        source: ESLINT_SOURCE,
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
      source: ESLINT_SOURCE,
      overlay: "working_tree",
      subjectFingerprints: [...subjectFingerprints],
      findings,
      reason: "eslint_diagnostics no longer produced finding for scoped file",
    });

    const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;
    const truncated = findings.length > maxFindings;
    return finish({
      status: "succeeded" satisfies ReefDiagnosticRunStatus,
      command,
      exitCode: result.status ?? undefined,
      checkedFileCount: requestedFiles.length,
      findings: truncated ? findings.slice(0, maxFindings) : findings,
      totalFindings: findings.length,
      persistedFindings: findings.length,
      truncated,
    });
  });
}
