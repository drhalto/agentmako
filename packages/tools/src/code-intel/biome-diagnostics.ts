import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  BiomeDiagnosticsToolInput,
  BiomeDiagnosticsToolOutput,
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
const BIOME_SOURCE = "biome";
const EXISTING_FINDINGS_CLEANUP_LIMIT = 10_000;
const BIOME_TIMEOUT_MS = 30_000;

interface BiomeGitLabFinding {
  description?: string;
  check_name?: string;
  fingerprint?: string;
  severity?: string;
  location?: {
    path?: string;
    lines?: {
      begin?: number;
      end?: number;
    };
  };
}

interface NormalizedBiomeDiagnostic {
  ruleId: string;
  message: string;
  filePath: string;
  line?: number;
  severity: ProjectFinding["severity"];
}

function resolveBiomeRunner(projectRoot: string, scriptName?: string): ExternalToolRunner | null {
  if (scriptName) {
    return resolvePackageScriptRunner(projectRoot, {
      scriptNames: [],
      requestedScriptName: scriptName,
    });
  }
  return resolveLocalToolRunner(projectRoot, {
    binName: "biome",
  }) ?? resolvePackageScriptRunner(projectRoot, {
    scriptNames: ["biome:gitlab", "lint:biome", "mako:biome"],
  });
}

function biomeSeverity(value: string | undefined): ProjectFinding["severity"] {
  switch ((value ?? "").toLowerCase()) {
    case "blocker":
    case "critical":
      return "error";
    case "info":
      return "info";
    default:
      return "warning";
  }
}

function normalizeBiomeGitLab(projectRoot: string, findings: BiomeGitLabFinding[]): NormalizedBiomeDiagnostic[] {
  const diagnostics: NormalizedBiomeDiagnostic[] = [];
  for (const finding of findings) {
    const rawPath = finding.location?.path;
    if (!rawPath) {
      continue;
    }
    const absoluteFilePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(projectRoot, rawPath);
    if (!isWithinRoot(projectRoot, absoluteFilePath)) {
      continue;
    }
    const line = finding.location?.lines?.begin;
    diagnostics.push({
      ruleId: finding.check_name ?? "biome",
      message: (finding.description ?? "Biome diagnostic").normalize("NFC"),
      filePath: slashPath(path.relative(projectRoot, absoluteFilePath)),
      ...(line && line > 0 ? { line } : {}),
      severity: biomeSeverity(finding.severity),
    });
  }
  return diagnostics;
}

function descriptorFor(diagnostic: NormalizedBiomeDiagnostic): ReefRuleDescriptor {
  return {
    id: diagnostic.ruleId,
    version: "1.0.0",
    source: BIOME_SOURCE,
    sourceNamespace: "biome",
    type: diagnostic.severity === "info" ? "suggestion" : "problem",
    severity: diagnostic.severity,
    title: diagnostic.ruleId,
    description: "Biome diagnostic.",
    factKinds: ["biome_diagnostics"],
    enabledByDefault: true,
  };
}

function diagnosticToFinding(args: {
  projectId: string;
  projectStore: ProjectStore;
  diagnostic: NormalizedBiomeDiagnostic;
  capturedAt: string;
}): ProjectFinding {
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint({
    kind: "diagnostic",
    path: args.diagnostic.filePath,
    ruleId: args.diagnostic.ruleId,
  });
  const evidenceRefs = [
    `${args.diagnostic.filePath}:${args.diagnostic.line ?? 1}:1`,
  ];
  return {
    projectId: args.projectId,
    fingerprint: args.projectStore.computeReefFindingFingerprint({
      source: BIOME_SOURCE,
      ruleId: args.diagnostic.ruleId,
      subjectFingerprint,
      message: args.diagnostic.message,
      evidenceRefs,
    }),
    source: BIOME_SOURCE,
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
      reason: "Biome GitLab reporter diagnostics read from working tree",
    },
    capturedAt: args.capturedAt,
    message: args.diagnostic.message,
    factFingerprints: [],
  };
}

export async function biomeDiagnosticsTool(
  input: BiomeDiagnosticsToolInput,
  options: ToolServiceOptions = {},
): Promise<BiomeDiagnosticsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const projectRoot = path.resolve(project.canonicalPath);
    const warnings: string[] = [
      "biome_diagnostics uses Biome's GitLab reporter instead of the experimental JSON reporter",
    ];
    const requestedFiles = input.files
      .map((filePath) => resolveProjectPath(projectRoot, filePath))
      .filter((filePath): filePath is string => filePath != null);
    if (requestedFiles.length !== input.files.length) {
      warnings.push("one or more requested files were outside the project root and ignored");
    }

    const finish = (args: Omit<BiomeDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): BiomeDiagnosticsToolOutput => {
      const durationMs = Math.max(0, Date.now() - startedMs);
      projectStore.saveReefDiagnosticRun({
        projectId: project.projectId,
        source: BIOME_SOURCE,
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
          reporter: "gitlab",
          requestedFiles,
          requestedFileCount: requestedFiles.length,
          scriptName: input.scriptName ?? null,
          exitCode: args.exitCode ?? null,
          truncated: args.truncated,
        },
      });
      return {
        toolName: "biome_diagnostics",
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

    const runner = resolveBiomeRunner(projectRoot, input.scriptName);
    if (!runner) {
      return finish({
        status: "unavailable",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: input.scriptName
          ? `Biome package script not found: ${input.scriptName}`
          : "local Biome executable or biome:gitlab/lint:biome package script not found",
      });
    }

    const biomeArgs = [
      ...runner.argsPrefix,
      "check",
      "--reporter=gitlab",
      ...requestedFiles,
    ];
    const command = `${runner.display} check --reporter=gitlab ${requestedFiles.join(" ")}`;
    const result = spawnSync(runner.command, biomeArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: BIOME_TIMEOUT_MS,
      windowsHide: true,
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
        errorText: stderr || "Biome GitLab reporter did not produce JSON output",
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
        errorText: "Biome GitLab reporter output was not an array",
      });
    }
    if (stderr && result.status !== 0) {
      warnings.push(`biome stderr: ${stderr.slice(0, 500)}`);
    }

    const capturedAt = new Date().toISOString();
    const diagnostics = normalizeBiomeGitLab(projectRoot, parsedJson as BiomeGitLabFinding[]);
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
        source: BIOME_SOURCE,
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
      source: BIOME_SOURCE,
      overlay: "working_tree",
      subjectFingerprints: [...subjectFingerprints],
      findings,
      reason: "biome_diagnostics no longer produced finding for scoped file",
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
