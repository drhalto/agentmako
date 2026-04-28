import type {
  ReefCalculationDependency,
  ReefCalculationExecutionNode,
  ReefCalculationExecutionPlan,
  ReefCalculationNode,
  ReefCalculationRegistry,
  ReefWorkspaceChangeSet,
} from "@mako-ai/contracts";
import {
  reefCalculationDependencyKey,
  reefCalculationOutputKey,
} from "@mako-ai/contracts";

export interface ReefCalculationExecutionPlanOptions {
  fullRefreshPathThreshold: number;
  isGraphSensitivePath?: (path: string) => boolean;
}

export function createReefCalculationExecutionPlan(
  registry: ReefCalculationRegistry,
  changeSet: ReefWorkspaceChangeSet,
  options: ReefCalculationExecutionPlanOptions,
): ReefCalculationExecutionPlan {
  const changedPaths = changedPathsForChangeSet(changeSet);
  const inputDependencyKeys = new Set<string>();
  const affectedNodeIds = new Set<string>();

  for (const filePath of changedPaths) {
    inputDependencyKeys.add(reefCalculationDependencyKey({ kind: "file", path: filePath }));
    for (const node of registry.list()) {
      if (nodeDependsOnPath(node, filePath)) {
        affectedNodeIds.add(node.id);
        for (const dependency of node.dependsOn) {
          if (dependencyMatchesPath(dependency, filePath)) {
            inputDependencyKeys.add(reefCalculationDependencyKey(dependency));
          }
        }
      }
    }
  }

  if (changeSet.causes.some((event) => event.kind === "reef.git.index_changed" || event.kind === "reef.git.branch_changed")) {
    inputDependencyKeys.add(reefCalculationDependencyKey({ kind: "git_index" }));
    for (const node of registry.list()) {
      if (node.dependsOn.some((dependency) => dependency.kind === "git_index")) {
        affectedNodeIds.add(node.id);
      }
    }
  }

  if (changeSet.schema || changeSet.causes.some((event) => event.kind.startsWith("reef.schema."))) {
    inputDependencyKeys.add(reefCalculationDependencyKey({ kind: "schema_snapshot" }));
    for (const node of registry.list()) {
      if (node.dependsOn.some((dependency) => dependency.kind === "schema_snapshot")) {
        affectedNodeIds.add(node.id);
      }
    }
  }

  for (const event of changeSet.causes) {
    if (event.kind === "reef.diagnostic.source_changed") {
      const source = typeof event.data?.source === "string" ? event.data.source : undefined;
      if (source) {
        inputDependencyKeys.add(reefCalculationDependencyKey({ kind: "diagnostic_source", source }));
        for (const node of registry.findDependents({ kind: "diagnostic_source", source })) {
          affectedNodeIds.add(node.id);
        }
      }
    }
  }

  expandDependentNodes(registry, affectedNodeIds);
  const affectedNodes = registry.list()
    .filter((node) => affectedNodeIds.has(node.id))
    .map(calculationExecutionNode);
  const decision = materializationDecision(changeSet, changedPaths, affectedNodes, options);

  return {
    ...decision,
    inputDependencyKeys: [...inputDependencyKeys].sort(),
    changedPaths,
    affectedNodes,
  };
}

function changedPathsForChangeSet(changeSet: ReefWorkspaceChangeSet): string[] {
  const paths = new Set<string>();
  for (const fileChange of changeSet.fileChanges) {
    paths.add(fileChange.path);
    if (fileChange.priorPath) {
      paths.add(fileChange.priorPath);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function expandDependentNodes(
  registry: ReefCalculationRegistry,
  affectedNodeIds: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of registry.list()) {
      if (!affectedNodeIds.has(node.id)) {
        continue;
      }
      for (const output of node.outputs) {
        const dependency = output.kind === "artifact"
          ? { kind: "artifact_kind" as const, artifactKind: output.artifactKind, extractorVersion: output.extractorVersion }
          : output.kind === "fact"
            ? { kind: "fact_kind" as const, factKind: output.factKind }
            : undefined;
        if (!dependency) {
          continue;
        }
        for (const dependent of registry.findDependents(dependency)) {
          if (!affectedNodeIds.has(dependent.id)) {
            affectedNodeIds.add(dependent.id);
            changed = true;
          }
        }
      }
    }
  }
}

function calculationExecutionNode(node: ReefCalculationNode): ReefCalculationExecutionNode {
  return {
    nodeId: node.id,
    kind: node.kind,
    refreshScope: node.refreshScope,
    fallback: node.fallback,
    durability: node.durability,
    dependencyKeys: node.dependsOn.map(reefCalculationDependencyKey).sort(),
    outputKeys: node.outputs.map(reefCalculationOutputKey).sort(),
  };
}

function materializationDecision(
  changeSet: ReefWorkspaceChangeSet,
  changedPaths: readonly string[],
  affectedNodes: readonly ReefCalculationExecutionNode[],
  options: ReefCalculationExecutionPlanOptions,
): Pick<ReefCalculationExecutionPlan, "refreshMode" | "decisionReason" | "fallbackReason"> {
  if (changeSet.causes.some((event) => event.kind === "reef.refresh.requested")) {
    return {
      refreshMode: "full",
      decisionReason: "explicit refresh requested",
    };
  }
  if (changeSet.causes.some((event) => event.kind === "reef.git.branch_changed")) {
    return {
      refreshMode: "full",
      decisionReason: "git branch changed",
    };
  }
  if (changeSet.causes.some((event) => event.kind === "reef.git.index_changed")) {
    return {
      refreshMode: "full",
      decisionReason: "git index changed",
    };
  }
  if (changeSet.causes.some((event) => event.kind === "reef.schema.source_changed")) {
    return {
      refreshMode: "full",
      decisionReason: "schema source changed",
    };
  }
  if (changedPaths.length === 0) {
    return {
      refreshMode: "full",
      decisionReason: "no file changes in change set",
    };
  }
  if (changedPaths.length > options.fullRefreshPathThreshold) {
    return {
      refreshMode: "full",
      decisionReason: "dirty path threshold exceeded",
      fallbackReason: `dirty path threshold exceeded (${changedPaths.length} > ${options.fullRefreshPathThreshold})`,
    };
  }
  const graphSensitivePath = options.isGraphSensitivePath
    ? changedPaths.find(options.isGraphSensitivePath)
    : undefined;
  if (graphSensitivePath) {
    return {
      refreshMode: "full",
      decisionReason: "graph-sensitive path changed",
      fallbackReason: `graph-sensitive path changed: ${graphSensitivePath}`,
    };
  }
  const projectScopedNode = affectedNodes.find((node) => node.refreshScope !== "path_scoped");
  if (projectScopedNode) {
    return {
      refreshMode: "full",
      decisionReason: "project-scoped calculation node affected",
      fallbackReason: `calculation node requires ${projectScopedNode.refreshScope}: ${projectScopedNode.nodeId}`,
    };
  }
  return {
    refreshMode: "path_scoped",
    decisionReason: affectedNodes.length > 0
      ? "calculation executor selected path-scoped refresh"
      : "path-scoped refresh is safe",
  };
}

function nodeDependsOnPath(node: ReefCalculationNode, filePath: string): boolean {
  return node.dependsOn.some((dependency) => dependencyMatchesPath(dependency, filePath));
}

function dependencyMatchesPath(dependency: ReefCalculationDependency, filePath: string): boolean {
  switch (dependency.kind) {
    case "file":
    case "config":
      return normalizePath(dependency.path) === normalizePath(filePath);
    case "glob":
      return globMatchesPath(dependency.pattern, filePath);
    default:
      return false;
  }
}

function globMatchesPath(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);
  if (normalizedPattern === normalizedPath) {
    return true;
  }
  const extensionSet = /^\*\*\/\*\.?\{(?<extensions>[^}]+)\}$/u.exec(normalizedPattern)?.groups?.extensions;
  if (extensionSet) {
    const extensions = extensionSet.split(",").map((extension) => extension.replace(/^\./u, ""));
    return extensions.some((extension) => normalizedPath.endsWith(`.${extension}`));
  }
  const singleExtension = /^\*\*\/\*\.(?<extension>[^/{}]+)$/u.exec(normalizedPattern)?.groups?.extension;
  if (singleExtension) {
    return normalizedPath.endsWith(`.${singleExtension}`);
  }
  return false;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
