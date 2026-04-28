import {
  type ChangePlanResult,
  type FlowMapResult,
  GRAPH_EDGE_INVENTORY,
  type GraphEdge,
  type GraphNeighborsResult,
  type GraphNode,
  type GraphNodeLocator,
  type GraphPathHop,
  type GraphPathNoPathReason,
  type GraphPathResult,
  type GraphSlice,
  type GraphNeighborsToolInput,
  type GraphNeighborsToolOutput,
  type GraphPathToolInput,
  type GraphPathToolOutput,
  type FlowMapToolInput,
  type FlowMapToolOutput,
  type ChangePlanToolInput,
  type ChangePlanToolOutput,
} from "@mako-ai/contracts";
import { hashJson, type FileSummaryRecord, type ProjectStore, type ResolvedSchemaObjectRecord, type SymbolRecord } from "@mako-ai/store";
import { resolveIndexedFilePath, withProjectContext, type ToolServiceOptions } from "../runtime.js";
import {
  type GraphEdgeAccumulator,
  addEdge,
  buildRpcLabel,
  buildRpcKey,
  buildRpcNodeKey,
  buildTableKey,
  ensureNode,
  ensureFileNode,
  ensureSymbolNode,
  formatPathLineRef,
  formatSchemaSourceRef,
  materializeRpcUsageEdges,
  materializeTablePolicyAndTriggerEdges,
  routeLabel,
} from "./materialization.js";
import {
  buildFlowMapSteps,
  buildFlowMapTransitions,
  buildDirectChangePlanSurfaces,
  buildDependentChangePlanSurfaces,
  buildChangePlanFollowOnHint,
  buildChangePlanSteps,
  CHANGE_PLAN_DEPENDENT_SURFACE_LIMIT,
  collectMajorBoundaryKinds,
} from "./workflows.js";
import {
  buildIncomingEdgeMap,
  buildOutgoingEdgeMap,
  collectGraphNeighbors,
  collectSuggestedStartEntities,
  DEFAULT_NEIGHBOR_LIMIT,
  findGraphPath,
  type GraphTraversalState,
  normalizeGraphNodeLocator,
  resolveGraphNodeLocator,
  resolveGraphNodeLocators,
  type TraversalOptions,
} from "./traversal.js";

export interface BuildDerivedGraphSliceOptions {
  derivedAt?: string;
}

const LARGE_GRAPH_WARNING_NODE_COUNT = 5_000;
const LARGE_GRAPH_WARNING_EDGE_COUNT = 10_000;
interface GraphTraversalCacheEntry {
  signature: string;
  state: GraphTraversalState;
}

interface ResolvedGraphPathQuery {
  state: GraphTraversalState;
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  startNode: GraphNode | null;
  targetNode: GraphNode | null;
  traversalOptions: TraversalOptions;
  hops: GraphPathHop[];
  noPathReason?: GraphPathNoPathReason;
  warnings: string[];
}

const graphTraversalStateCache = new Map<string, GraphTraversalCacheEntry>();
const MAX_GRAPH_TRAVERSAL_CACHE_ENTRIES = 12;

export function buildDerivedGraphSlice(
  projectStore: ProjectStore,
  options: BuildDerivedGraphSliceOptions = {},
): GraphSlice {
  const nodesBySemanticKey = new Map<string, GraphNode>();
  const edgesBySemanticKey = new Map<string, GraphEdgeAccumulator>();
  const fileSummaries = projectStore.listFiles();
  const fileByPath = new Map(fileSummaries.map((file) => [file.path, file] as const));
  const latestIndexRun = projectStore.getLatestIndexRun();
  const schemaSnapshot = projectStore.loadSchemaSnapshot();
  const warnings: string[] = [];

  for (const file of fileSummaries) {
    ensureFileNode(nodesBySemanticKey, file.path, file);
  }

  for (const edge of projectStore.listAllImportEdges()) {
    if (!edge.targetExists) {
      continue;
    }
    const sourceNode = ensureFileNode(nodesBySemanticKey, edge.sourcePath, fileByPath.get(edge.sourcePath));
    const targetNode = ensureFileNode(nodesBySemanticKey, edge.targetPath, fileByPath.get(edge.targetPath));
    addEdge(edgesBySemanticKey, {
      kind: "imports",
      fromNodeId: sourceNode.nodeId,
      toNodeId: targetNode.nodeId,
      exactness: "exact",
      provenance: {
        source: "project_store.listAllImportEdges",
        sourceObjectId: `${edge.sourcePath}->${edge.targetPath}:${edge.specifier}`,
        evidenceRefs: [formatPathLineRef(edge.sourcePath, edge.line), edge.targetPath],
      },
      metadata: {
        specifier: edge.specifier,
        importKind: edge.importKind,
        isTypeOnly: edge.isTypeOnly,
        ...(typeof edge.line === "number" ? { line: edge.line } : {}),
      },
    });
  }

  // The first graph slice is intentionally whole-project and derive-on-demand.
  // Rooted traversal and narrower filtering land in 6.1 where the public graph
  // workflows can actually take advantage of them.
  for (const file of fileSummaries) {
    const fileNode = ensureFileNode(nodesBySemanticKey, file.path, file);
    for (const symbol of projectStore.listSymbolsForFile(file.path)) {
      const symbolNode = ensureSymbolNode(nodesBySemanticKey, file.path, symbol);
      const evidenceRef = formatPathLineRef(file.path, symbol.lineStart);
      addEdge(edgesBySemanticKey, {
        kind: "declares_symbol",
        fromNodeId: fileNode.nodeId,
        toNodeId: symbolNode.nodeId,
        exactness: "exact",
        provenance: {
          source: "project_store.listSymbolsForFile",
          sourceObjectId: `${file.path}:${symbol.name}:${symbol.lineStart ?? 0}`,
          evidenceRefs: [evidenceRef],
        },
        metadata: {
          symbolName: symbol.name,
          symbolKind: symbol.kind,
          ...(typeof symbol.lineStart === "number" ? { lineStart: symbol.lineStart } : {}),
        },
      });
      if (typeof symbol.exportName === "string" && symbol.exportName.length > 0) {
        addEdge(edgesBySemanticKey, {
          kind: "exports",
          fromNodeId: fileNode.nodeId,
          toNodeId: symbolNode.nodeId,
          exactness: "exact",
          provenance: {
            source: "project_store.listSymbolsForFile",
            sourceObjectId: `${file.path}:${symbol.exportName}:${symbol.lineStart ?? 0}`,
            evidenceRefs: [evidenceRef],
          },
          metadata: {
            exportName: symbol.exportName,
            ...(typeof symbol.lineStart === "number" ? { lineStart: symbol.lineStart } : {}),
          },
        });
      }
    }
  }

  for (const route of projectStore.listRoutes()) {
    const fileNode = ensureFileNode(nodesBySemanticKey, route.filePath, fileByPath.get(route.filePath));
    const routeNode = ensureNode(nodesBySemanticKey, {
      kind: "route",
      key: route.routeKey,
      label: routeLabel(route.method, route.pattern, route.routeKey),
      sourceRef: route.filePath,
      metadata: {
        routeKey: route.routeKey,
        pattern: route.pattern,
        filePath: route.filePath,
        ...(typeof route.method === "string" ? { method: route.method } : {}),
        ...(typeof route.handlerName === "string" ? { handlerName: route.handlerName } : {}),
        ...(typeof route.isApi === "boolean" ? { isApi: route.isApi } : {}),
      },
    });
    addEdge(edgesBySemanticKey, {
      kind: "serves_route",
      fromNodeId: fileNode.nodeId,
      toNodeId: routeNode.nodeId,
      exactness: "exact",
      provenance: {
        source: "project_store.listRoutes",
        sourceObjectId: route.routeKey,
        evidenceRefs: [route.filePath, route.routeKey],
      },
      metadata: {
        framework: route.framework,
        pattern: route.pattern,
        ...(typeof route.method === "string" ? { method: route.method } : {}),
        ...(typeof route.handlerName === "string" ? { handlerName: route.handlerName } : {}),
        ...(typeof route.isApi === "boolean" ? { isApi: route.isApi } : {}),
      },
    });
  }

  if (schemaSnapshot) {
    for (const [schemaName, namespace] of Object.entries(schemaSnapshot.ir.schemas)) {
      for (const rpc of namespace.rpcs ?? []) {
        ensureNode(nodesBySemanticKey, {
          kind: "rpc",
          key: buildRpcKey(schemaName, rpc.name, rpc.argTypes),
          label: buildRpcLabel(schemaName, rpc.name, rpc.argTypes),
          sourceRef: formatSchemaSourceRef(rpc.sources[0]) ?? `rpc:${buildRpcKey(schemaName, rpc.name, rpc.argTypes)}`,
          metadata: {
            schemaName,
            rpcName: rpc.name,
            argTypes: rpc.argTypes ?? [],
            ...(typeof rpc.bodyText === "string" ? { bodyText: rpc.bodyText } : {}),
          },
        });
      }
    }
  }

  for (const ref of projectStore.listFunctionTableRefs()) {
    const rpcNode = ensureNode(nodesBySemanticKey, {
      kind: "rpc",
      key: buildRpcKey(ref.rpcSchema, ref.rpcName, ref.argTypes),
      label: buildRpcLabel(ref.rpcSchema, ref.rpcName, ref.argTypes),
      sourceRef: `rpc:${buildRpcKey(ref.rpcSchema, ref.rpcName, ref.argTypes)}`,
      metadata: {
        schemaName: ref.rpcSchema,
        rpcName: ref.rpcName,
        rpcKind: ref.rpcKind,
        argTypes: ref.argTypes,
      },
    });
    const tableNode = ensureNode(nodesBySemanticKey, {
      kind: "table",
      key: buildTableKey(ref.targetSchema, ref.targetTable),
      label: buildTableKey(ref.targetSchema, ref.targetTable),
      sourceRef: `table:${buildTableKey(ref.targetSchema, ref.targetTable)}`,
      metadata: {
        schemaName: ref.targetSchema,
        tableName: ref.targetTable,
      },
    });
    addEdge(edgesBySemanticKey, {
      kind: "touches_table",
      fromNodeId: rpcNode.nodeId,
      toNodeId: tableNode.nodeId,
      exactness: "exact",
      provenance: {
        source: "project_store.listFunctionTableRefs",
        sourceObjectId: `${buildRpcKey(ref.rpcSchema, ref.rpcName, ref.argTypes)}->${buildTableKey(ref.targetSchema, ref.targetTable)}`,
        evidenceRefs: [
          `rpc:${buildRpcKey(ref.rpcSchema, ref.rpcName, ref.argTypes)}`,
          `table:${buildTableKey(ref.targetSchema, ref.targetTable)}`,
        ],
      },
      metadata: {
        rpcKind: ref.rpcKind,
        rpcSchema: ref.rpcSchema,
        rpcName: ref.rpcName,
        argTypes: ref.argTypes,
        targetSchema: ref.targetSchema,
        targetTable: ref.targetTable,
      },
    });
  }

  materializeRpcUsageEdges(projectStore, nodesBySemanticKey, edgesBySemanticKey, fileByPath);

  if (schemaSnapshot) {
    for (const [schemaName, namespace] of Object.entries(schemaSnapshot.ir.schemas)) {
      for (const table of namespace.tables) {
        materializeTablePolicyAndTriggerEdges(nodesBySemanticKey, edgesBySemanticKey, schemaName, table);
      }
    }
  } else {
    warnings.push("schema snapshot missing; schema-derived graph nodes and edges were not materialized");
  }

  const nodes = [...nodesBySemanticKey.values()].sort(compareGraphNodes);
  const edges = [...edgesBySemanticKey.values()]
    .map(({ edge, evidenceRefs }) => ({
      ...edge,
      provenance: {
        ...edge.provenance,
        evidenceRefs: [...evidenceRefs].sort((left, right) => left.localeCompare(right)),
      },
    }))
    .sort(compareGraphEdges);

  if (nodes.length >= LARGE_GRAPH_WARNING_NODE_COUNT || edges.length >= LARGE_GRAPH_WARNING_EDGE_COUNT) {
    warnings.push(
      `large whole-project graph slice materialized (${nodes.length} nodes, ${edges.length} edges); traversal is bounded by the requested entities, but graph derivation is still whole-project`,
    );
  }

  return {
    derivedAt: options.derivedAt ?? new Date().toISOString(),
    basis: {
      strategy: "whole_project",
      latestIndexRunId: latestIndexRun?.runId ?? null,
      schemaSnapshotId: schemaSnapshot?.snapshotId ?? null,
      schemaFingerprint: schemaSnapshot?.fingerprint ?? null,
    },
    nodes,
    edges,
    inventory: [...GRAPH_EDGE_INVENTORY],
    warnings,
  };
}

function getGraphTraversalState(
  cacheKey: string,
  projectStore: ProjectStore,
): GraphTraversalState {
  const signature = buildGraphTraversalSignature(projectStore);
  const cached = graphTraversalStateCache.get(cacheKey);
  if (cached?.signature === signature) {
    graphTraversalStateCache.delete(cacheKey);
    graphTraversalStateCache.set(cacheKey, cached);
    return cached.state;
  }

  const slice = buildDerivedGraphSlice(projectStore);
  const state: GraphTraversalState = {
    slice,
    nodesById: new Map(slice.nodes.map((node) => [node.nodeId, node] as const)),
    outgoingByNodeId: buildOutgoingEdgeMap(slice.edges),
    incomingByNodeId: buildIncomingEdgeMap(slice.edges),
  };
  graphTraversalStateCache.set(cacheKey, { signature, state });
  while (graphTraversalStateCache.size > MAX_GRAPH_TRAVERSAL_CACHE_ENTRIES) {
    const oldestKey = graphTraversalStateCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    graphTraversalStateCache.delete(oldestKey);
  }
  return state;
}

function buildGraphTraversalSignature(projectStore: ProjectStore): string {
  const latestIndexRun = projectStore.getLatestIndexRun();
  const schemaSnapshot = projectStore.loadSchemaSnapshot();
  const files = projectStore
    .listFiles()
    .map((file) => ({
      path: file.path,
      sha256: file.sha256 ?? null,
      language: file.language,
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const imports = projectStore
    .listAllImportEdges()
    .map((edge) => ({
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      targetExists: edge.targetExists,
      specifier: edge.specifier,
      importKind: edge.importKind,
      isTypeOnly: edge.isTypeOnly,
      line: edge.line ?? null,
    }))
    .sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.targetPath.localeCompare(right.targetPath) ||
      left.specifier.localeCompare(right.specifier) ||
      left.importKind.localeCompare(right.importKind) ||
      Number(left.isTypeOnly) - Number(right.isTypeOnly) ||
      Number(left.targetExists) - Number(right.targetExists) ||
      (left.line ?? 0) - (right.line ?? 0),
    );
  const routes = projectStore
    .listRoutes()
    .map((route) => ({
      routeKey: route.routeKey,
      filePath: route.filePath,
      pattern: route.pattern,
      method: route.method ?? null,
      handlerName: route.handlerName ?? null,
      isApi: route.isApi,
    }))
    .sort((left, right) =>
      left.routeKey.localeCompare(right.routeKey) ||
      left.filePath.localeCompare(right.filePath),
    );

  return hashJson({
    latestIndexRunId: latestIndexRun?.runId ?? null,
    latestIndexRunStatus: latestIndexRun?.status ?? null,
    latestIndexRunFinishedAt: latestIndexRun?.finishedAt ?? null,
    schemaSnapshotId: schemaSnapshot?.snapshotId ?? null,
    schemaFingerprint: schemaSnapshot?.fingerprint ?? null,
    files,
    imports,
    routes,
  });
}

function resolveGraphPathQuery(
  project: { projectId: string; canonicalPath: string },
  projectStore: ProjectStore,
  startEntityInput: GraphNodeLocator,
  targetEntityInput: GraphNodeLocator,
  traversalOptions: TraversalOptions,
): ResolvedGraphPathQuery {
  const state = getGraphTraversalState(project.projectId, projectStore);
  const { slice } = state;
  const startEntity = normalizeGraphNodeLocator(project.canonicalPath, projectStore, startEntityInput);
  const targetEntity = normalizeGraphNodeLocator(project.canonicalPath, projectStore, targetEntityInput);
  const startNode = resolveGraphNodeLocator(slice, startEntity);
  const targetNode = resolveGraphNodeLocator(slice, targetEntity);
  const warnings = [...slice.warnings];

  if (!startNode) {
    warnings.push(`graph start entity not found: ${startEntity.kind}:${startEntity.key}`);
  }
  if (!targetNode) {
    warnings.push(`graph target entity not found: ${targetEntity.kind}:${targetEntity.key}`);
  }

  let hops: GraphPathHop[] = [];
  let noPathReason: GraphPathNoPathReason | undefined;
  if (!startNode) {
    noPathReason = "start_not_resolved";
  } else if (!targetNode) {
    noPathReason = "target_not_resolved";
  } else {
    const exactSearch = findGraphPath(state, startNode, targetNode, traversalOptions);
    hops = exactSearch.hops;
    noPathReason = exactSearch.noPathReason;
    if (
      hops.length === 0 &&
      startNode.nodeId !== targetNode.nodeId &&
      traversalOptions.includeHeuristicEdges === false
    ) {
      const heuristicSearch = findGraphPath(state, startNode, targetNode, {
        ...traversalOptions,
        includeHeuristicEdges: true,
      });
      if (heuristicSearch.hops.length > 0) {
        noPathReason = "no_exact_path";
      } else if (heuristicSearch.noPathReason === "depth_exceeded") {
        noPathReason = "depth_exceeded";
      }
    }
  }

  return {
    state,
    startEntity,
    targetEntity,
    startNode,
    targetNode,
    traversalOptions,
    hops,
    ...(noPathReason ? { noPathReason } : {}),
    warnings,
  };
}

export async function graphNeighborsTool(
  input: GraphNeighborsToolInput,
  options: ToolServiceOptions = {},
): Promise<GraphNeighborsToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const state = getGraphTraversalState(project.projectId, projectStore);
    const { slice } = state;
    const normalizedStartEntities = input.startEntities.map((locator) =>
      normalizeGraphNodeLocator(project.canonicalPath, projectStore, locator),
    );
    const resolved = resolveGraphNodeLocators(slice, normalizedStartEntities);
    const traversal = collectGraphNeighbors(state, resolved.nodes, {
      direction: input.direction ?? "both",
      traversalDepth: input.traversalDepth ?? 1,
      nodeKinds: input.nodeKinds ? new Set(input.nodeKinds) : undefined,
      edgeKinds: input.edgeKinds ? new Set(input.edgeKinds) : undefined,
      includeHeuristicEdges: input.includeHeuristicEdges ?? false,
    });
    const limit = input.limit ?? DEFAULT_NEIGHBOR_LIMIT;
    const neighbors = traversal.slice(0, limit).map((entry) => ({
      node: entry.node,
      distance: entry.distance,
      via: entry.via,
      containsHeuristicEdge: entry.containsHeuristicEdge,
    }));
    const warnings = [...slice.warnings];
    for (const locator of resolved.missing) {
      warnings.push(`graph start entity not found: ${locator.kind}:${locator.key}`);
    }
    const suggestedStartEntities: GraphNodeLocator[] =
      resolved.nodes.length === 0 && resolved.missing.length > 0
        ? collectSuggestedStartEntities(slice, resolved.missing)
        : [];
    if (resolved.nodes.length === 0 && resolved.missing.length > 0) {
      warnings.push(
        suggestedStartEntities.length > 0
          ? `graph neighbors could not resolve any start entities; ${suggestedStartEntities.length} same-kind candidate starts are suggested`
          : "graph neighbors could not resolve any start entities and no same-kind candidate starts were found",
      );
    }
    if (traversal.length > limit) {
      warnings.push(`graph neighbors truncated at ${limit} results`);
    }

    const result: GraphNeighborsResult = {
      requestedStartEntities: normalizedStartEntities,
      resolvedStartNodes: resolved.nodes,
      missingStartEntities: resolved.missing,
      ...(suggestedStartEntities.length > 0 ? { suggestedStartEntities } : {}),
      direction: input.direction ?? "both",
      traversalDepth: input.traversalDepth ?? 1,
      includeHeuristicEdges: input.includeHeuristicEdges ?? false,
      ...(input.nodeKinds ? { appliedNodeKinds: input.nodeKinds } : {}),
      ...(input.edgeKinds ? { appliedEdgeKinds: input.edgeKinds } : {}),
      neighbors,
      graphBasis: slice.basis,
      warnings,
    };

    return {
      toolName: "graph_neighbors",
      projectId: project.projectId,
      result,
    };
  });
}

export async function graphPathTool(
  input: GraphPathToolInput,
  options: ToolServiceOptions = {},
): Promise<GraphPathToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolved = resolveGraphPathQuery(project, projectStore, input.startEntity, input.targetEntity, {
      direction: input.direction ?? "both",
      traversalDepth: input.traversalDepth ?? 6,
      nodeKinds: input.nodeKinds ? new Set(input.nodeKinds) : undefined,
      edgeKinds: input.edgeKinds ? new Set(input.edgeKinds) : undefined,
      includeHeuristicEdges: input.includeHeuristicEdges ?? false,
    });
    const containsHeuristicEdge = resolved.hops.some((hop) => hop.edge.exactness === "heuristic");

    const result: GraphPathResult = {
      requestedStartEntity: resolved.startEntity,
      requestedTargetEntity: resolved.targetEntity,
      ...(resolved.startNode ? { resolvedStartNode: resolved.startNode } : {}),
      ...(resolved.targetNode ? { resolvedTargetNode: resolved.targetNode } : {}),
      direction: resolved.traversalOptions.direction,
      traversalDepth: resolved.traversalOptions.traversalDepth,
      includeHeuristicEdges: resolved.traversalOptions.includeHeuristicEdges,
      pathFound:
        resolved.startNode != null &&
        resolved.targetNode != null &&
        (resolved.startNode.nodeId === resolved.targetNode.nodeId || resolved.hops.length > 0),
      ...(resolved.noPathReason ? { noPathReason: resolved.noPathReason } : {}),
      hops: resolved.hops,
      containsHeuristicEdge,
      graphBasis: resolved.state.slice.basis,
      warnings: resolved.warnings,
    };

    return {
      toolName: "graph_path",
      projectId: project.projectId,
      result,
    };
  });
}

export async function flowMapTool(
  input: FlowMapToolInput,
  options: ToolServiceOptions = {},
): Promise<FlowMapToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolved = resolveGraphPathQuery(project, projectStore, input.startEntity, input.targetEntity, {
      direction: input.direction ?? "both",
      traversalDepth: input.traversalDepth ?? 6,
      edgeKinds: input.edgeKinds ? new Set(input.edgeKinds) : undefined,
      includeHeuristicEdges: input.includeHeuristicEdges ?? true,
    });
    const pathFound =
      resolved.startNode != null &&
      resolved.targetNode != null &&
      (resolved.startNode.nodeId === resolved.targetNode.nodeId || resolved.hops.length > 0);
    const steps = pathFound && resolved.startNode ? buildFlowMapSteps(resolved.startNode, resolved.hops) : [];
    const transitions = pathFound ? buildFlowMapTransitions(resolved.hops) : [];
    const majorBoundaryKinds = collectMajorBoundaryKinds(steps);

    const result: FlowMapResult = {
      requestedStartEntity: resolved.startEntity,
      requestedTargetEntity: resolved.targetEntity,
      ...(resolved.startNode ? { resolvedStartNode: resolved.startNode } : {}),
      ...(resolved.targetNode ? { resolvedTargetNode: resolved.targetNode } : {}),
      direction: resolved.traversalOptions.direction,
      traversalDepth: resolved.traversalOptions.traversalDepth,
      includeHeuristicEdges: resolved.traversalOptions.includeHeuristicEdges,
      pathFound,
      ...(resolved.noPathReason ? { noPathReason: resolved.noPathReason } : {}),
      steps,
      transitions,
      majorBoundaryKinds,
      containsHeuristicEdge: resolved.hops.some((hop) => hop.edge.exactness === "heuristic"),
      graphBasis: resolved.state.slice.basis,
      warnings: resolved.warnings,
    };

    return {
      toolName: "flow_map",
      projectId: project.projectId,
      result,
    };
  });
}

export async function changePlanTool(
  input: ChangePlanToolInput,
  options: ToolServiceOptions = {},
): Promise<ChangePlanToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const resolved = resolveGraphPathQuery(project, projectStore, input.startEntity, input.targetEntity, {
      direction: input.direction ?? "both",
      traversalDepth: input.traversalDepth ?? 6,
      edgeKinds: input.edgeKinds ? new Set(input.edgeKinds) : undefined,
      includeHeuristicEdges: input.includeHeuristicEdges ?? true,
    });
    const pathFound =
      resolved.startNode != null &&
      resolved.targetNode != null &&
      (resolved.startNode.nodeId === resolved.targetNode.nodeId || resolved.hops.length > 0);
    const directSurfaces = pathFound && resolved.startNode ? buildDirectChangePlanSurfaces(resolved.startNode, resolved.hops) : [];
    const dependentSurfaceResult = pathFound
      ? buildDependentChangePlanSurfaces(resolved.state, directSurfaces, resolved.traversalOptions)
      : { surfaces: [], truncatedCount: 0 };
    const dependentSurfaces = dependentSurfaceResult.surfaces;
    const steps = pathFound ? buildChangePlanSteps(directSurfaces, dependentSurfaces) : [];
    const warnings = [...resolved.warnings];
    if (dependentSurfaceResult.truncatedCount > 0) {
      warnings.push(
        `change plan dependent surfaces truncated at ${CHANGE_PLAN_DEPENDENT_SURFACE_LIMIT} results (${dependentSurfaceResult.truncatedCount} additional adjacent surfaces omitted)`,
      );
    }

    const result: ChangePlanResult = {
      requestedStartEntity: resolved.startEntity,
      requestedTargetEntity: resolved.targetEntity,
      ...(resolved.startNode ? { resolvedStartNode: resolved.startNode } : {}),
      ...(resolved.targetNode ? { resolvedTargetNode: resolved.targetNode } : {}),
      direction: resolved.traversalOptions.direction,
      traversalDepth: resolved.traversalOptions.traversalDepth,
      includeHeuristicEdges: resolved.traversalOptions.includeHeuristicEdges,
      pathFound,
      ...(resolved.noPathReason ? { noPathReason: resolved.noPathReason } : {}),
      directSurfaces,
      dependentSurfaces,
      steps,
      ...(pathFound
        ? { recommendedFollowOn: buildChangePlanFollowOnHint(directSurfaces, dependentSurfaces) }
        : {}),
      containsHeuristicEdge:
        directSurfaces.some((surface) => surface.containsHeuristicEdge) ||
        dependentSurfaces.some((surface) => surface.containsHeuristicEdge),
      graphBasis: resolved.state.slice.basis,
      warnings,
    };

    return {
      toolName: "change_plan",
      projectId: project.projectId,
      result,
    };
  });
}
function compareGraphNodes(left: GraphNode, right: GraphNode): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.key.localeCompare(right.key) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function compareGraphEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.fromNodeId.localeCompare(right.fromNodeId) ||
    left.toNodeId.localeCompare(right.toNodeId) ||
    left.edgeId.localeCompare(right.edgeId)
  );
}
