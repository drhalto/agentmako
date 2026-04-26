import path from "node:path";
import ts from "typescript";
import type {
  ProjectFinding,
  ReefDiagnosticRunStatus,
  ReefRuleDescriptor,
  TypeScriptDiagnosticsToolInput,
  TypeScriptDiagnosticsToolOutput,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

const DEFAULT_MAX_FINDINGS = 500;
const TYPESCRIPT_SOURCE = "typescript";
const EXISTING_FINDINGS_CLEANUP_LIMIT = 10_000;

interface NormalizedDiagnostic {
  code: string;
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  category: ts.DiagnosticCategory;
}

function slashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveProjectPath(projectRoot: string, candidate: string): string | null {
  const absolutePath = path.resolve(projectRoot, candidate);
  if (!isWithinRoot(projectRoot, absolutePath)) {
    return null;
  }
  return slashPath(path.relative(projectRoot, absolutePath));
}

function resolveTsconfigPath(projectRoot: string, inputPath?: string): string | null {
  if (inputPath) {
    const absolutePath = path.resolve(projectRoot, inputPath);
    return isWithinRoot(projectRoot, absolutePath) ? absolutePath : null;
  }
  return ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json") ?? null;
}

function flattenMessage(messageText: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(messageText, "\n").normalize("NFC");
}

function normalizedSeverity(category: ts.DiagnosticCategory): ProjectFinding["severity"] {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
    case ts.DiagnosticCategory.Message:
      return "info";
  }
}

function descriptorFor(diagnostic: NormalizedDiagnostic): ReefRuleDescriptor {
  return {
    id: diagnostic.code,
    version: ts.version,
    source: TYPESCRIPT_SOURCE,
    sourceNamespace: "typescript",
    type: normalizedSeverity(diagnostic.category) === "info" ? "suggestion" : "problem",
    severity: normalizedSeverity(diagnostic.category),
    title: diagnostic.code,
    description: "TypeScript compiler diagnostic.",
    documentationUrl: `https://typescript.tv/errors/#${diagnostic.code}`,
    factKinds: ["typescript_diagnostics"],
    enabledByDefault: true,
  };
}

function normalizeDiagnostic(
  projectRoot: string,
  fallbackPath: string,
  diagnostic: ts.Diagnostic,
): NormalizedDiagnostic | null {
  const code = `TS${diagnostic.code}`;
  const message = flattenMessage(diagnostic.messageText);
  const fileName = diagnostic.file?.fileName ?? fallbackPath;
  const absoluteFile = path.resolve(fileName);
  if (!isWithinRoot(projectRoot, absoluteFile)) {
    return null;
  }
  const filePath = slashPath(path.relative(projectRoot, absoluteFile));
  const output: NormalizedDiagnostic = {
    code,
    message,
    filePath,
    category: diagnostic.category,
  };
  if (diagnostic.file && typeof diagnostic.start === "number") {
    const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    output.line = location.line + 1;
    output.column = location.character + 1;
  }
  return output;
}

function diagnosticToFinding(args: {
  projectId: string;
  projectStore: ProjectStore;
  diagnostic: NormalizedDiagnostic;
  capturedAt: string;
}): ProjectFinding {
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint({
    kind: "diagnostic",
    path: args.diagnostic.filePath,
    code: args.diagnostic.code,
  });
  const evidenceRefs = [
    `${args.diagnostic.filePath}:${args.diagnostic.line ?? 1}:${args.diagnostic.column ?? 1}`,
  ];

  return {
    projectId: args.projectId,
    fingerprint: args.projectStore.computeReefFindingFingerprint({
      source: TYPESCRIPT_SOURCE,
      ruleId: args.diagnostic.code,
      subjectFingerprint,
      message: args.diagnostic.message,
      evidenceRefs,
    }),
    source: TYPESCRIPT_SOURCE,
    subjectFingerprint,
    overlay: "working_tree",
    severity: normalizedSeverity(args.diagnostic.category),
    status: "active",
    filePath: args.diagnostic.filePath,
    ...(args.diagnostic.line ? { line: args.diagnostic.line } : {}),
    ruleId: args.diagnostic.code,
    documentationUrl: `https://typescript.tv/errors/#${args.diagnostic.code}`,
    evidenceRefs,
    freshness: {
      state: "fresh",
      checkedAt: args.capturedAt,
      reason: "TypeScript diagnostics read from working tree",
    },
    capturedAt: args.capturedAt,
    message: args.diagnostic.message,
    factFingerprints: [],
  };
}

export async function typescriptDiagnosticsTool(
  input: TypeScriptDiagnosticsToolInput,
  options: ToolServiceOptions = {},
): Promise<TypeScriptDiagnosticsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const projectRoot = path.resolve(project.canonicalPath);
    const warnings: string[] = [];
    const requestedFiles = (input.files ?? [])
      .map((filePath) => resolveProjectPath(projectRoot, filePath))
      .filter((filePath): filePath is string => filePath != null);
    if ((input.files?.length ?? 0) !== requestedFiles.length) {
      warnings.push("one or more requested files were outside the project root and ignored");
    }
    const finish = (args: Omit<TypeScriptDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): TypeScriptDiagnosticsToolOutput => {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      saveDiagnosticRun({
        projectStore,
        projectId: project.projectId,
        projectRoot,
        status: args.status,
        startedAt,
        finishedAt,
        durationMs,
        checkedFileCount: args.checkedFileCount,
        findingCount: args.totalFindings,
        persistedFindingCount: args.persistedFindings,
        tsconfigPath: args.tsconfigPath,
        requestedFiles,
        truncated: args.truncated,
        errorText: args.errorText,
      });
      return {
        toolName: "typescript_diagnostics",
        projectId: project.projectId,
        projectRoot,
        durationMs,
        requestedFiles,
        warnings,
        ...args,
      };
    };

    const tsconfigPath = resolveTsconfigPath(projectRoot, input.tsconfigPath);
    if (!tsconfigPath) {
      warnings.push("no tsconfig.json found inside the project root");
      return finish({
        status: "unavailable",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
      });
    }

    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.error) {
        const normalized = normalizeDiagnostic(projectRoot, tsconfigPath, configFile.error);
        const findings = normalized
          ? [diagnosticToFinding({
            projectId: project.projectId,
            projectStore,
            diagnostic: normalized,
            capturedAt: new Date().toISOString(),
          })]
          : [];
        return finish({
          status: "ran_with_error",
          tsconfigPath: slashPath(path.relative(projectRoot, tsconfigPath)),
          checkedFileCount: 0,
          findings,
          totalFindings: findings.length,
          persistedFindings: 0,
          truncated: false,
          errorText: flattenMessage(configFile.error.messageText),
        });
      }

      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath),
        { noEmit: true },
        tsconfigPath,
      );
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
      });
      const requestedSet = requestedFiles.length > 0 ? new Set(requestedFiles) : null;
      const fallbackPath = tsconfigPath;
      const normalizedDiagnostics = [
        ...parsed.errors,
        ...ts.getPreEmitDiagnostics(program),
      ]
        .map((diagnostic) => normalizeDiagnostic(projectRoot, fallbackPath, diagnostic))
        .filter((diagnostic): diagnostic is NormalizedDiagnostic => diagnostic != null)
        .filter((diagnostic) => !requestedSet || requestedSet.has(diagnostic.filePath));
      const capturedAt = new Date().toISOString();
      const findings = normalizedDiagnostics.map((diagnostic) =>
        diagnosticToFinding({
          projectId: project.projectId,
          projectStore,
          diagnostic,
          capturedAt,
        }),
      );
      const scopedFiles = requestedSet
        ? [...requestedSet]
        : parsed.fileNames
          .map((filePath) => resolveProjectPath(projectRoot, filePath))
          .filter((filePath): filePath is string => filePath != null);
      const existingScopedFindings = requestedSet
        ? scopedFiles.flatMap((filePath) =>
          projectStore.queryReefFindings({
            projectId: project.projectId,
            source: TYPESCRIPT_SOURCE,
            overlay: "working_tree",
            filePath,
            limit: EXISTING_FINDINGS_CLEANUP_LIMIT,
          }),
        )
        : projectStore.queryReefFindings({
          projectId: project.projectId,
          source: TYPESCRIPT_SOURCE,
          overlay: "working_tree",
          limit: EXISTING_FINDINGS_CLEANUP_LIMIT,
        });
      const subjectFingerprints = new Set(existingScopedFindings.map((finding) => finding.subjectFingerprint));
      for (const filePath of [
        ...scopedFiles,
        ...findings.map((finding) => finding.filePath).filter((filePath): filePath is string => filePath != null),
      ]) {
        subjectFingerprints.add(projectStore.computeReefSubjectFingerprint({
          kind: "diagnostic",
          path: filePath,
          code: "typescript",
        }));
      }
      for (const finding of findings) {
        subjectFingerprints.add(finding.subjectFingerprint);
      }
      const descriptors = new Map(
        normalizedDiagnostics.map((diagnostic) => [diagnostic.code, descriptorFor(diagnostic)] as const),
      );
      if (descriptors.size > 0) {
        projectStore.saveReefRuleDescriptors([...descriptors.values()]);
      }
      projectStore.replaceReefFindingsForSource({
        projectId: project.projectId,
        source: TYPESCRIPT_SOURCE,
        overlay: "working_tree",
        subjectFingerprints: [...subjectFingerprints],
        findings,
        reason: "typescript_diagnostics no longer produced finding for scoped subject",
      });

      const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;
      const truncated = findings.length > maxFindings;
      return finish({
        status: "succeeded",
        tsconfigPath: slashPath(path.relative(projectRoot, tsconfigPath)),
        checkedFileCount: parsed.fileNames.length,
        findings: truncated ? findings.slice(0, maxFindings) : findings,
        totalFindings: findings.length,
        persistedFindings: findings.length,
        truncated,
      });
    } catch (error) {
      return finish({
        status: "ran_with_error",
        tsconfigPath: slashPath(path.relative(projectRoot, tsconfigPath)),
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
        errorText: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function saveDiagnosticRun(args: {
  projectStore: ProjectStore;
  projectId: string;
  projectRoot: string;
  status: ReefDiagnosticRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checkedFileCount: number;
  findingCount: number;
  persistedFindingCount: number;
  tsconfigPath?: string;
  requestedFiles: string[];
  truncated: boolean;
  errorText?: string;
}): void {
  args.projectStore.saveReefDiagnosticRun({
    projectId: args.projectId,
    source: TYPESCRIPT_SOURCE,
    overlay: "working_tree",
    status: args.status,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    durationMs: args.durationMs,
    checkedFileCount: args.checkedFileCount,
    findingCount: args.findingCount,
    persistedFindingCount: args.persistedFindingCount,
    command: "typescript compiler API noEmit",
    cwd: args.projectRoot,
    configPath: args.tsconfigPath,
    errorText: args.errorText,
    metadata: {
      requestedFiles: args.requestedFiles,
      requestedFileCount: args.requestedFiles.length,
      truncated: args.truncated,
      typescriptVersion: ts.version,
    },
  });
}
