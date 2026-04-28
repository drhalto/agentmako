import type {
  BiomeDiagnosticsToolOutput,
  DiagnosticRefreshResult,
  DiagnosticRefreshSource,
  DiagnosticRefreshToolInput,
  DiagnosticRefreshToolOutput,
  EslintDiagnosticsToolOutput,
  GitPrecommitCheckToolOutput,
  LintFilesToolOutput,
  OxlintDiagnosticsToolOutput,
  ProjectFinding,
  TypeScriptDiagnosticsToolOutput,
} from "@mako-ai/contracts";
import {
  biomeDiagnosticsTool,
  eslintDiagnosticsTool,
  gitPrecommitCheckTool,
  lintFilesTool,
  oxlintDiagnosticsTool,
  typescriptSyntaxDiagnosticsTool,
  typescriptDiagnosticsTool,
} from "../code-intel/index.js";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { runProgrammaticFindingsRefresh } from "./programmatic-findings.js";

interface RunResult {
  result: DiagnosticRefreshResult;
  findings: ProjectFinding[];
}

export async function diagnosticRefreshTool(
  input: DiagnosticRefreshToolInput,
  options: ToolServiceOptions,
): Promise<DiagnosticRefreshToolOutput> {
  return await withProjectContext(input, options, async ({ project, profile, projectStore }) => {
    const startedMs = Date.now();
    const sources = input.sources ?? defaultSources(input);
    const results: DiagnosticRefreshResult[] = [];
    const findings: ProjectFinding[] = [];
    const warnings: string[] = [];
    const continueOnError = input.continueOnError ?? true;

    for (const source of sources) {
      const run = await runDiagnosticSource(source, {
        input,
        project,
        profile,
        projectStore,
        projectId: project.projectId,
        options,
      });
      results.push(run.result);
      findings.push(...run.findings);
      warnings.push(...run.result.warnings.map((warning: string) => `${source}: ${warning}`));
      if (!continueOnError && (run.result.status === "ran_with_error" || run.result.status === "unavailable")) {
        warnings.push(`stopped after ${source} returned ${run.result.status}`);
        break;
      }
    }

    const executed = results.filter((result) => result.status !== "skipped");
    const output: DiagnosticRefreshToolOutput = {
      toolName: "diagnostic_refresh",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      results,
      ...(input.includeFindings ? { findings } : {}),
      summary: {
        requestedSources: sources.length,
        executedSources: executed.length,
        skippedSources: results.filter((result) => result.status === "skipped").length,
        succeededSources: results.filter((result) => result.status === "succeeded").length,
        failedSources: results.filter((result) => result.status === "ran_with_error").length,
        unavailableSources: results.filter((result) => result.status === "unavailable").length,
        totalFindings: results.reduce((total, result) => total + result.totalFindings, 0),
        persistedFindings: results.reduce((total, result) => total + result.persistedFindings, 0),
        durationMs: Math.max(0, Date.now() - startedMs),
      },
      warnings,
    };
    return output;
  });
}

function defaultSources(input: DiagnosticRefreshToolInput): DiagnosticRefreshSource[] {
  if ((input.files?.length ?? 0) > 0) {
    return ["lint_files", "programmatic_findings", "typescript_syntax", "typescript", "eslint", "oxlint", "biome"];
  }
  return ["typescript_syntax"];
}

async function runDiagnosticSource(
  source: DiagnosticRefreshSource,
  args: {
    input: DiagnosticRefreshToolInput;
    project: Parameters<typeof runProgrammaticFindingsRefresh>[0]["project"];
    profile: Parameters<typeof runProgrammaticFindingsRefresh>[0]["profile"];
    projectStore: Parameters<typeof runProgrammaticFindingsRefresh>[0]["projectStore"];
    projectId: string;
    options: ToolServiceOptions;
  },
): Promise<RunResult> {
  const startedMs = Date.now();
  try {
    switch (source) {
      case "lint_files":
        return withElapsedDuration(normalizeLintFiles(await runFileModeSource(source, args, () =>
          lintFilesTool({
            projectId: args.projectId,
            files: args.input.files ?? [],
            ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
          }, args.options)
        )), startedMs);
      case "typescript_syntax": {
        const output = await typescriptSyntaxDiagnosticsTool({
          projectId: args.projectId,
          ...(args.input.files ? { files: args.input.files } : {}),
          ...(args.input.tsconfigPath ? { tsconfigPath: args.input.tsconfigPath } : {}),
          ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
        }, args.options);
        return normalizeProjectFindingOutput(source, "typescript_diagnostics", output);
      }
      case "typescript": {
        const output = await typescriptDiagnosticsTool({
          projectId: args.projectId,
          ...(args.input.files ? { files: args.input.files } : {}),
          ...(args.input.tsconfigPath ? { tsconfigPath: args.input.tsconfigPath } : {}),
          ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
        }, args.options);
        return normalizeProjectFindingOutput(source, "typescript_diagnostics", output);
      }
      case "eslint":
        return normalizeProjectFindingOutput(source, "eslint_diagnostics", await runFileModeSource(source, args, () =>
          eslintDiagnosticsTool({
            projectId: args.projectId,
            files: args.input.files ?? [],
            ...(args.input.scripts?.eslint ? { scriptName: args.input.scripts.eslint } : {}),
            ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
          }, args.options)
        ));
      case "oxlint":
        return normalizeProjectFindingOutput(source, "oxlint_diagnostics", await runFileModeSource(source, args, () =>
          oxlintDiagnosticsTool({
            projectId: args.projectId,
            files: args.input.files ?? [],
            ...(args.input.scripts?.oxlint ? { scriptName: args.input.scripts.oxlint } : {}),
            ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
          }, args.options)
        ));
      case "biome":
        return normalizeProjectFindingOutput(source, "biome_diagnostics", await runFileModeSource(source, args, () =>
          biomeDiagnosticsTool({
            projectId: args.projectId,
            files: args.input.files ?? [],
            ...(args.input.scripts?.biome ? { scriptName: args.input.scripts.biome } : {}),
            ...(args.input.maxFindings ? { maxFindings: args.input.maxFindings } : {}),
          }, args.options)
        ));
      case "git_precommit_check":
        return withElapsedDuration(normalizeGitPrecommit(await gitPrecommitCheckTool({
          projectId: args.projectId,
        }, args.options)), startedMs);
      case "programmatic_findings":
        return withElapsedDuration(runProgrammaticFindingsRefresh({
          input: args.input,
          project: args.project,
          profile: args.profile,
          projectStore: args.projectStore,
        }), startedMs);
    }
    return unreachableSource(source);
  } catch (error) {
    return {
      result: {
        source,
        toolName: toolNameForSource(source),
        status: "ran_with_error",
        durationMs: Math.max(0, Date.now() - startedMs),
        checkedFileCount: 0,
        totalFindings: 0,
        persistedFindings: 0,
        warnings: [],
        errorText: error instanceof Error ? error.message : String(error),
      },
      findings: [],
    };
  }
}

async function runFileModeSource<T>(
  source: DiagnosticRefreshSource,
  args: {
    input: DiagnosticRefreshToolInput;
  },
  run: () => Promise<T>,
): Promise<T | DiagnosticRefreshResult> {
  if ((args.input.files?.length ?? 0) === 0) {
    return {
      source,
      toolName: toolNameForSource(source),
      status: "skipped",
      durationMs: 0,
      checkedFileCount: 0,
      totalFindings: 0,
      persistedFindings: 0,
      warnings: [],
      skippedReason: `${source} requires explicit files`,
    };
  }
  return await run();
}

function normalizeLintFiles(output: LintFilesToolOutput | DiagnosticRefreshResult): RunResult {
  if (isRefreshResult(output)) {
    return { result: output, findings: [] };
  }
  return {
    result: {
      source: "lint_files",
      toolName: output.toolName,
      status: "succeeded",
      durationMs: 0,
      checkedFileCount: output.resolvedFiles.length,
      totalFindings: output.findings.length,
      persistedFindings: output.findings.length,
      warnings: output.warnings,
    },
    findings: [],
  };
}

function normalizeProjectFindingOutput(
  source: DiagnosticRefreshSource,
  toolName: string,
  output:
    | TypeScriptDiagnosticsToolOutput
    | EslintDiagnosticsToolOutput
    | OxlintDiagnosticsToolOutput
    | BiomeDiagnosticsToolOutput
    | DiagnosticRefreshResult,
): RunResult {
  if (isRefreshResult(output)) {
    return { result: output, findings: [] };
  }
  return {
    result: {
      source,
      toolName,
      status: output.status,
      durationMs: output.durationMs,
      checkedFileCount: output.checkedFileCount,
      totalFindings: output.totalFindings,
      persistedFindings: output.persistedFindings,
      warnings: output.warnings,
      ...(output.errorText ? { errorText: output.errorText } : {}),
    },
    findings: output.findings,
  };
}

function normalizeGitPrecommit(output: GitPrecommitCheckToolOutput): RunResult {
  return {
    result: {
      source: "git_precommit_check",
      toolName: output.toolName,
      status: output.continue ? "succeeded" : "ran_with_error",
      durationMs: 0,
      checkedFileCount: output.checkedFiles.length,
      totalFindings: output.findings.length,
      persistedFindings: output.findings.length,
      warnings: output.warnings,
      ...(output.stopReason ? { errorText: output.stopReason } : {}),
    },
    findings: [],
  };
}

function withElapsedDuration(run: RunResult, startedMs: number): RunResult {
  if (run.result.status !== "skipped" && run.result.durationMs === 0) {
    run.result.durationMs = Math.max(0, Date.now() - startedMs);
  }
  return run;
}

function isRefreshResult(value: unknown): value is DiagnosticRefreshResult {
  return Boolean(value && typeof value === "object" && "skippedReason" in value);
}

function toolNameForSource(source: DiagnosticRefreshSource): string {
  switch (source) {
    case "lint_files":
      return "lint_files";
    case "typescript_syntax":
      return "typescript_diagnostics";
    case "typescript":
      return "typescript_diagnostics";
    case "eslint":
      return "eslint_diagnostics";
    case "oxlint":
      return "oxlint_diagnostics";
    case "biome":
      return "biome_diagnostics";
    case "git_precommit_check":
      return "git_precommit_check";
    case "programmatic_findings":
      return "diagnostic_refresh";
  }
  return unreachableSource(source);
}

function unreachableSource(source: never): never {
  throw new Error(`unsupported diagnostic refresh source: ${String(source)}`);
}
