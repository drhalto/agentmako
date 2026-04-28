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
const TYPESCRIPT_SYNTAX_SOURCE = "typescript_syntax";
const EXISTING_FINDINGS_CLEANUP_LIMIT = 10_000;
type TypeScriptDiagnosticKind = "syntactic" | "semantic";

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

interface LoadedTsconfig {
  configPath: string;
  parsed: ts.ParsedCommandLine;
}

function resolveProjectReferencePath(referencePath: string): string | null {
  if (ts.sys.directoryExists?.(referencePath)) {
    const candidate = path.join(referencePath, "tsconfig.json");
    return ts.sys.fileExists(candidate) ? candidate : null;
  }
  return ts.sys.fileExists(referencePath) ? referencePath : null;
}

function loadTsconfigChain(rootTsconfigPath: string): {
  chain: LoadedTsconfig[];
  errors: ts.Diagnostic[];
} {
  const visited = new Set<string>();
  const chain: LoadedTsconfig[] = [];
  const errors: ts.Diagnostic[] = [];
  const stack = [rootTsconfigPath];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    const normalized = path.resolve(next);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    const configFile = ts.readConfigFile(normalized, ts.sys.readFile);
    if (configFile.error) {
      errors.push(configFile.error);
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(normalized),
      { noEmit: true },
      normalized,
    );
    chain.push({ configPath: normalized, parsed });
    for (const reference of parsed.projectReferences ?? []) {
      const resolved = resolveProjectReferencePath(reference.path);
      if (resolved) {
        stack.push(resolved);
      }
    }
  }
  return { chain, errors };
}

function scriptKindFromPath(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".json":
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.TS;
  }
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

function descriptorFor(source: string, diagnostic: NormalizedDiagnostic): ReefRuleDescriptor {
  return {
    id: diagnostic.code,
    version: ts.version,
    source,
    sourceNamespace: "typescript",
    type: normalizedSeverity(diagnostic.category) === "info" ? "suggestion" : "problem",
    severity: normalizedSeverity(diagnostic.category),
    title: diagnostic.code,
    description: "TypeScript compiler diagnostic.",
    documentationUrl: `https://typescript.tv/errors/#${diagnostic.code}`,
    factKinds: [source === TYPESCRIPT_SYNTAX_SOURCE ? "typescript_syntax_diagnostics" : "typescript_diagnostics"],
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
  source: string;
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
      source: args.source,
      ruleId: args.diagnostic.code,
      subjectFingerprint,
      message: args.diagnostic.message,
      evidenceRefs,
    }),
    source: args.source,
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
      reason: args.source === TYPESCRIPT_SYNTAX_SOURCE
        ? "TypeScript syntactic diagnostics read from working tree"
        : "TypeScript semantic diagnostics read from working tree",
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
    const inputRevision = projectStore.loadReefAnalysisState(project.projectId, projectRoot)?.currentRevision;
    const finish = (args: Omit<TypeScriptDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): TypeScriptDiagnosticsToolOutput => {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      saveDiagnosticRun({
        projectStore,
        projectId: project.projectId,
        projectRoot,
        source: TYPESCRIPT_SOURCE,
        diagnosticKind: "semantic",
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
        inputRevision,
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
      const { chain, errors: chainErrors } = loadTsconfigChain(tsconfigPath);
      const rootEntry = chain[0];
      if (!rootEntry) {
        const firstError = chainErrors[0];
        const normalized = firstError ? normalizeDiagnostic(projectRoot, tsconfigPath, firstError) : null;
        const findings = normalized
          ? [diagnosticToFinding({
            projectId: project.projectId,
            projectStore,
            source: TYPESCRIPT_SOURCE,
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
          errorText: firstError
            ? flattenMessage(firstError.messageText)
            : "tsconfig could not be parsed",
        });
      }

      const usingReferenceChain = rootEntry.parsed.fileNames.length === 0
        && (rootEntry.parsed.projectReferences?.length ?? 0) > 0;
      const programConfigs = usingReferenceChain
        ? chain.filter((entry) => entry.parsed.fileNames.length > 0)
        : [rootEntry];

      const requestedSet = requestedFiles.length > 0 ? new Set(requestedFiles) : null;
      const fallbackPath = tsconfigPath;
      const programFileNames = new Set<string>();
      const rawDiagnostics: ts.Diagnostic[] = [];
      for (const error of rootEntry.parsed.errors) {
        rawDiagnostics.push(error);
      }
      for (const entry of programConfigs) {
        const program = ts.createProgram({
          rootNames: entry.parsed.fileNames,
          options: entry.parsed.options,
          ...(entry.parsed.projectReferences ? { projectReferences: entry.parsed.projectReferences } : {}),
        });
        if (entry !== rootEntry) {
          for (const error of entry.parsed.errors) {
            rawDiagnostics.push(error);
          }
        }
        for (const fileName of entry.parsed.fileNames) {
          const relative = resolveProjectPath(projectRoot, fileName);
          if (relative != null) {
            programFileNames.add(relative);
          }
        }
        const fileFilter = requestedSet
          ? (sourceFile: ts.SourceFile) => {
            const relative = resolveProjectPath(projectRoot, sourceFile.fileName);
            return relative != null && requestedSet.has(relative);
          }
          : undefined;
        for (const sourceFile of program.getSourceFiles()) {
          if (sourceFile.isDeclarationFile) continue;
          if (fileFilter && !fileFilter(sourceFile)) continue;
          rawDiagnostics.push(...program.getSyntacticDiagnostics(sourceFile));
          rawDiagnostics.push(...program.getSemanticDiagnostics(sourceFile));
        }
        if (!requestedSet) {
          rawDiagnostics.push(...program.getOptionsDiagnostics());
          rawDiagnostics.push(...program.getGlobalDiagnostics());
        }
      }
      const seenDiagnosticKeys = new Set<string>();
      const normalizedDiagnostics = rawDiagnostics
        .map((diagnostic) => normalizeDiagnostic(projectRoot, fallbackPath, diagnostic))
        .filter((diagnostic): diagnostic is NormalizedDiagnostic => diagnostic != null)
        .filter((diagnostic) => !requestedSet || requestedSet.has(diagnostic.filePath))
        .filter((diagnostic) => {
          const key = `${diagnostic.code}|${diagnostic.filePath}|${diagnostic.line ?? 0}|${diagnostic.column ?? 0}|${diagnostic.message}`;
          if (seenDiagnosticKeys.has(key)) return false;
          seenDiagnosticKeys.add(key);
          return true;
        });
      const capturedAt = new Date().toISOString();
      const findings = normalizedDiagnostics.map((diagnostic) =>
        diagnosticToFinding({
          projectId: project.projectId,
          projectStore,
          source: TYPESCRIPT_SOURCE,
          diagnostic,
          capturedAt,
        }),
      );
      const scopedFiles = requestedSet
        ? [...requestedSet]
        : [...programFileNames];
      const checkedFileCount = requestedSet
        ? requestedFiles.filter((filePath) => programFileNames.has(filePath)).length
        : programFileNames.size;
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
        normalizedDiagnostics.map((diagnostic) => [diagnostic.code, descriptorFor(TYPESCRIPT_SOURCE, diagnostic)] as const),
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
        checkedFileCount,
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

export async function typescriptSyntaxDiagnosticsTool(
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
    const inputRevision = projectStore.loadReefAnalysisState(project.projectId, projectRoot)?.currentRevision;

    const finish = (args: Omit<TypeScriptDiagnosticsToolOutput, "toolName" | "projectId" | "projectRoot" | "durationMs" | "requestedFiles" | "warnings">): TypeScriptDiagnosticsToolOutput => {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      saveDiagnosticRun({
        projectStore,
        projectId: project.projectId,
        projectRoot,
        source: TYPESCRIPT_SYNTAX_SOURCE,
        diagnosticKind: "syntactic",
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
        inputRevision,
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
    if (requestedFiles.length === 0 && !tsconfigPath) {
      warnings.push("no files were requested and no tsconfig.json was found inside the project root");
      return finish({
        status: "unavailable",
        checkedFileCount: 0,
        findings: [],
        totalFindings: 0,
        persistedFindings: 0,
        truncated: false,
      });
    }

    let scopedFiles = requestedFiles;
    let relativeTsconfigPath: string | undefined;
    if (requestedFiles.length === 0 && tsconfigPath) {
      relativeTsconfigPath = slashPath(path.relative(projectRoot, tsconfigPath));
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.error) {
        const normalized = normalizeDiagnostic(projectRoot, tsconfigPath, configFile.error);
        const findings = normalized
          ? [diagnosticToFinding({
            projectId: project.projectId,
            projectStore,
            source: TYPESCRIPT_SYNTAX_SOURCE,
            diagnostic: normalized,
            capturedAt: new Date().toISOString(),
          })]
          : [];
        return finish({
          status: "ran_with_error",
          tsconfigPath: relativeTsconfigPath,
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
      scopedFiles = parsed.fileNames
        .map((filePath) => resolveProjectPath(projectRoot, filePath))
        .filter((filePath): filePath is string => filePath != null);
    } else if (tsconfigPath) {
      relativeTsconfigPath = slashPath(path.relative(projectRoot, tsconfigPath));
    }

    const normalizedDiagnostics: NormalizedDiagnostic[] = [];
    let checkedFileCount = 0;
    for (const filePath of scopedFiles) {
      const absolutePath = path.resolve(projectRoot, filePath);
      const text = ts.sys.readFile(absolutePath);
      if (text === undefined) {
        warnings.push(`could not read ${filePath}`);
        continue;
      }
      checkedFileCount += 1;
      const sourceFile = ts.createSourceFile(
        absolutePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFromPath(absolutePath),
      );
      const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
      normalizedDiagnostics.push(
        ...parseDiagnostics
          .map((diagnostic) => normalizeDiagnostic(projectRoot, absolutePath, diagnostic))
          .filter((diagnostic): diagnostic is NormalizedDiagnostic => diagnostic != null),
      );
    }

    const capturedAt = new Date().toISOString();
    const findings = normalizedDiagnostics.map((diagnostic) =>
      diagnosticToFinding({
        projectId: project.projectId,
        projectStore,
        source: TYPESCRIPT_SYNTAX_SOURCE,
        diagnostic,
        capturedAt,
      }),
    );
    const existingScopedFindings = scopedFiles.length > 0
      ? scopedFiles.flatMap((filePath) =>
        projectStore.queryReefFindings({
          projectId: project.projectId,
          source: TYPESCRIPT_SYNTAX_SOURCE,
          overlay: "working_tree",
          filePath,
          limit: EXISTING_FINDINGS_CLEANUP_LIMIT,
        }),
      )
      : [];
    const subjectFingerprints = new Set(existingScopedFindings.map((finding) => finding.subjectFingerprint));
    for (const filePath of scopedFiles) {
      subjectFingerprints.add(projectStore.computeReefSubjectFingerprint({
        kind: "diagnostic",
        path: filePath,
        code: "typescript_syntax",
      }));
    }
    for (const finding of findings) {
      subjectFingerprints.add(finding.subjectFingerprint);
    }
    const descriptors = new Map(
      normalizedDiagnostics.map((diagnostic) => [diagnostic.code, descriptorFor(TYPESCRIPT_SYNTAX_SOURCE, diagnostic)] as const),
    );
    if (descriptors.size > 0) {
      projectStore.saveReefRuleDescriptors([...descriptors.values()]);
    }
    projectStore.replaceReefFindingsForSource({
      projectId: project.projectId,
      source: TYPESCRIPT_SYNTAX_SOURCE,
      overlay: "working_tree",
      subjectFingerprints: [...subjectFingerprints],
      findings,
      reason: "typescript_syntax diagnostics no longer produced finding for scoped subject",
    });

    const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;
    const truncated = findings.length > maxFindings;
    return finish({
      status: "succeeded",
      ...(relativeTsconfigPath ? { tsconfigPath: relativeTsconfigPath } : {}),
      checkedFileCount,
      findings: truncated ? findings.slice(0, maxFindings) : findings,
      totalFindings: findings.length,
      persistedFindings: findings.length,
      truncated,
    });
  });
}

function saveDiagnosticRun(args: {
  projectStore: ProjectStore;
  projectId: string;
  projectRoot: string;
  source: string;
  diagnosticKind: TypeScriptDiagnosticKind;
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
  inputRevision: number | undefined;
}): void {
  const outputRevision = args.projectStore.loadReefAnalysisState(args.projectId, args.projectRoot)?.currentRevision;
  args.projectStore.saveReefDiagnosticRun({
    projectId: args.projectId,
    source: args.source,
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
      sourceKind: args.diagnosticKind,
      ...(args.inputRevision !== undefined ? { inputRevision: args.inputRevision } : {}),
      ...(outputRevision !== undefined ? { outputRevision } : {}),
      requestedFiles: args.requestedFiles,
      requestedFileCount: args.requestedFiles.length,
      truncated: args.truncated,
      typescriptVersion: ts.version,
    },
  });
}
