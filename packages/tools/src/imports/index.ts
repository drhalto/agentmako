import type {
  ImportsCyclesToolInput,
  ImportsCyclesToolOutput,
  ImportsDepsToolInput,
  ImportsDepsToolOutput,
  ImportsHotspotEntry,
  ImportsHotspotsToolInput,
  ImportsHotspotsToolOutput,
  ImportsImpactEntry,
  ImportsImpactToolInput,
  ImportsImpactToolOutput,
} from "@mako-ai/contracts";
import type { FileImportLink } from "@mako-ai/store";
import { withProjectContext, resolveIndexedFilePath, type ToolServiceOptions } from "../runtime.js";

function uniqueInternalEdges(edges: FileImportLink[]): FileImportLink[] {
  const seen = new Set<string>();
  const output: FileImportLink[] = [];

  for (const edge of edges) {
    if (!edge.targetExists) {
      continue;
    }

    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(edge);
  }

  return output;
}

function normalizeCycle(cycle: string[]): string[] {
  const normalized = cycle[0] === cycle[cycle.length - 1] ? cycle.slice(0, -1) : cycle.slice();
  let best = normalized;

  for (let index = 1; index < normalized.length; index += 1) {
    const rotated = normalized.slice(index).concat(normalized.slice(0, index));
    if (rotated.join("\u0000") < best.join("\u0000")) {
      best = rotated;
    }
  }

  return best;
}

export async function importsDepsTool(input: ImportsDepsToolInput, options: ToolServiceOptions = {}): Promise<ImportsDepsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);

    const imports = projectStore.listImportsForFile(resolvedFilePath);
    return {
      toolName: "imports_deps",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      imports,
      unresolved: imports.filter((edge) => !edge.targetExists),
      warnings: [],
    };
  });
}

export async function importsImpactTool(input: ImportsImpactToolInput, options: ToolServiceOptions = {}): Promise<ImportsImpactToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolvedFilePath = resolveIndexedFilePath(project.canonicalPath, projectStore, input.file);

    const maxDepth = input.depth ?? 2;
    const impactedFiles: ImportsImpactEntry[] = [];
    const visited = new Set<string>([resolvedFilePath]);
    const queue: Array<{ filePath: string; depth: number; via: string[] }> = [{ filePath: resolvedFilePath, depth: 0, via: [] }];

    while (queue.length > 0) {
      const current = queue.shift() as { filePath: string; depth: number; via: string[] };
      if (current.depth >= maxDepth) {
        continue;
      }

      const dependents = uniqueInternalEdges(projectStore.listDependentsForFile(current.filePath));
      for (const dependent of dependents) {
        const nextFilePath = dependent.sourcePath;
        if (visited.has(nextFilePath)) {
          continue;
        }

        visited.add(nextFilePath);
        const nextEntry = {
          filePath: nextFilePath,
          depth: current.depth + 1,
          via: [...current.via, current.filePath],
        };

        impactedFiles.push(nextEntry);
        queue.push(nextEntry);
      }
    }

    impactedFiles.sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth;
      }

      return left.filePath.localeCompare(right.filePath);
    });

    return {
      toolName: "imports_impact",
      projectId: project.projectId,
      file: input.file,
      resolvedFilePath,
      depth: maxDepth,
      impactedFiles,
      warnings: [],
    };
  });
}

export async function importsHotspotsTool(input: ImportsHotspotsToolInput, options: ToolServiceOptions = {}): Promise<ImportsHotspotsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const limit = input.limit ?? 10;
    const filePaths = projectStore.listFiles().map((file) => file.path);
    const inboundCounts = new Map<string, number>(filePaths.map((filePath) => [filePath, 0]));
    const outboundCounts = new Map<string, number>(filePaths.map((filePath) => [filePath, 0]));

    for (const edge of uniqueInternalEdges(projectStore.listAllImportEdges())) {
      outboundCounts.set(edge.sourcePath, (outboundCounts.get(edge.sourcePath) ?? 0) + 1);
      inboundCounts.set(edge.targetPath, (inboundCounts.get(edge.targetPath) ?? 0) + 1);
    }

    const hotspots: ImportsHotspotEntry[] = filePaths
      .map((filePath) => {
        const inboundCount = inboundCounts.get(filePath) ?? 0;
        const outboundCount = outboundCounts.get(filePath) ?? 0;
        return {
          filePath,
          inboundCount,
          outboundCount,
          totalConnections: inboundCount + outboundCount,
        };
      })
      .filter((entry) => entry.totalConnections > 0)
      .sort((left, right) => {
        if (right.totalConnections !== left.totalConnections) {
          return right.totalConnections - left.totalConnections;
        }

        if (right.inboundCount !== left.inboundCount) {
          return right.inboundCount - left.inboundCount;
        }

        return left.filePath.localeCompare(right.filePath);
      })
      .slice(0, limit);

    return {
      toolName: "imports_hotspots",
      projectId: project.projectId,
      limit,
      hotspots,
    };
  });
}

export async function importsCyclesTool(input: ImportsCyclesToolInput, options: ToolServiceOptions = {}): Promise<ImportsCyclesToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const adjacency = new Map<string, string[]>();
    for (const edge of uniqueInternalEdges(projectStore.listAllImportEdges())) {
      const current = adjacency.get(edge.sourcePath) ?? [];
      if (!current.includes(edge.targetPath)) {
        current.push(edge.targetPath);
      }
      adjacency.set(edge.sourcePath, current);
      if (!adjacency.has(edge.targetPath)) {
        adjacency.set(edge.targetPath, []);
      }
    }

    const nodes = [...adjacency.keys()].sort((left, right) => left.localeCompare(right));
    const discovered = new Set<string>();
    const cycles: string[][] = [];
    const stack: string[] = [];
    const stackIndex = new Map<string, number>();
    const colors = new Map<string, "gray" | "black">();

    const visit = (node: string): void => {
      colors.set(node, "gray");
      stackIndex.set(node, stack.length);
      stack.push(node);

      for (const next of adjacency.get(node) ?? []) {
        const nextColor = colors.get(next);

        if (nextColor === "gray") {
          const cycleStart = stackIndex.get(next);
          if (cycleStart != null && cycleStart >= 0) {
            const cycle = normalizeCycle(stack.slice(cycleStart));
            const key = cycle.join("\u0000");
            if (!discovered.has(key)) {
              discovered.add(key);
              cycles.push(cycle);
            }
          }
          continue;
        }

        if (nextColor === "black") {
          continue;
        }

        visit(next);
      }

      stack.pop();
      stackIndex.delete(node);
      colors.set(node, "black");
    };

    for (const node of nodes) {
      if (!colors.has(node)) {
        visit(node);
      }
    }

    cycles.sort((left, right) => {
      if (left.length !== right.length) {
        return left.length - right.length;
      }

      return left.join("\u0000").localeCompare(right.join("\u0000"));
    });

    return {
      toolName: "imports_cycles",
      projectId: project.projectId,
      cycles,
    };
  });
}
