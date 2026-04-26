import type {
  ExportsOfToolInput,
  ExportsOfToolOutput,
  SymbolsOfToolInput,
  SymbolsOfToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, resolveIndexedFilePath, type ToolServiceOptions } from "../runtime.js";

export async function symbolsOfTool(input: SymbolsOfToolInput, options: ToolServiceOptions = {}): Promise<SymbolsOfToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);

    return {
      toolName: "symbols_of",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      symbols: projectStore.listSymbolsForFile(resolvedFilePath),
      warnings: [],
    };
  });
}

export async function exportsOfTool(input: ExportsOfToolInput, options: ToolServiceOptions = {}): Promise<ExportsOfToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);

    return {
      toolName: "exports_of",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      exports: projectStore.listSymbolsForFile(resolvedFilePath).filter((symbol) => symbol.exportName != null),
      warnings: [],
    };
  });
}
