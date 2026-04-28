import type {
  ExportsOfToolInput,
  ExportsOfToolOutput,
  SymbolsOfToolInput,
  SymbolsOfToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, resolveIndexedFilePath, type ToolServiceOptions } from "../runtime.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";

export async function symbolsOfTool(input: SymbolsOfToolInput, options: ToolServiceOptions = {}): Promise<SymbolsOfToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);
    const symbols = projectStore.listSymbolsForFile(resolvedFilePath);
    const reefExecution = await buildReefToolExecution({
      toolName: "symbols_of",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      returnedCount: symbols.length,
    });

    return {
      toolName: "symbols_of",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      symbols,
      reefExecution,
      warnings: [],
    };
  });
}

export async function exportsOfTool(input: ExportsOfToolInput, options: ToolServiceOptions = {}): Promise<ExportsOfToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);
    const exports = projectStore.listSymbolsForFile(resolvedFilePath).filter((symbol) => symbol.exportName != null);
    const reefExecution = await buildReefToolExecution({
      toolName: "exports_of",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      returnedCount: exports.length,
    });

    return {
      toolName: "exports_of",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      exports,
      reefExecution,
      warnings: [],
    };
  });
}
