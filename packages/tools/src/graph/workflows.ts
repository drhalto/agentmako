import type {
  ChangePlanResult,
  ChangePlanStep,
  ChangePlanSurface,
  FlowMapBoundaryKind,
  FlowMapStep,
  FlowMapTransition,
  GraphNode,
  GraphPathHop,
} from "@mako-ai/contracts";
import { hashJson } from "@mako-ai/store";
import { collectGraphNeighbors, type GraphTraversalState, type TraversalOptions } from "./traversal.js";

export const CHANGE_PLAN_DEPENDENT_SURFACE_LIMIT = 6;

export interface ChangePlanDependentSurfaceResult {
  surfaces: ChangePlanSurface[];
  truncatedCount: number;
}

export function buildFlowMapSteps(startNode: GraphNode, hops: readonly GraphPathHop[]): FlowMapStep[] {
  const steps: FlowMapStep[] = [
    {
      stepIndex: 0,
      node: startNode,
      boundary: "entry",
    },
  ];

  hops.forEach((hop, index) => {
    steps.push({
      stepIndex: index + 1,
      node: hop.toNode,
      boundary: flowMapBoundaryForNode(hop.toNode, index + 1),
      reachedViaHop: hop,
    });
  });

  return steps;
}

export function buildFlowMapTransitions(hops: readonly GraphPathHop[]): FlowMapTransition[] {
  return hops.map((hop, index) => ({
    transitionId: `flow_transition_${hashJson({ hopIndex: index, edgeId: hop.edge.edgeId })}`,
    hop,
    boundary: flowMapBoundaryForNode(hop.toNode, index + 1),
  }));
}

export function collectMajorBoundaryKinds(steps: readonly FlowMapStep[]): FlowMapBoundaryKind[] {
  const kinds: FlowMapBoundaryKind[] = [];
  const seen = new Set<FlowMapBoundaryKind>();
  for (const step of steps) {
    if (seen.has(step.boundary)) {
      continue;
    }
    seen.add(step.boundary);
    kinds.push(step.boundary);
  }
  return kinds;
}

function flowMapBoundaryForNode(node: GraphNode, stepIndex: number): FlowMapBoundaryKind {
  if (stepIndex === 0) {
    return "entry";
  }
  switch (node.kind) {
    case "file":
      return "file";
    case "symbol":
      return "symbol";
    case "route":
      return "route";
    case "rpc":
      return "rpc";
    case "table":
      return "data";
    case "policy":
      return "policy";
    case "trigger":
      return "trigger";
    default:
      return "generic";
  }
}

export function buildDirectChangePlanSurfaces(
  startNode: GraphNode,
  hops: readonly GraphPathHop[],
): ChangePlanSurface[] {
  const directSurfaces: ChangePlanSurface[] = [];
  const seenNodeIds = new Set<string>();
  const pathNodes = [startNode, ...hops.map((hop) => hop.toNode)];

  pathNodes.forEach((node, index) => {
    if (seenNodeIds.has(node.nodeId)) {
      return;
    }
    seenNodeIds.add(node.nodeId);
    const via = hops.slice(0, index);
    const reachedViaHop = index > 0 ? hops[index - 1] : null;
    directSurfaces.push(
      buildChangePlanSurface({
        node,
        role: "direct",
        distance: index,
        via,
        rationale:
          index === 0
            ? `${node.label} is the starting surface for the selected graph path.`
            : `${node.label} is directly on the selected graph path via ${reachedViaHop?.edge.kind}.`,
      }),
    );
  });

  return directSurfaces;
}

export function buildChangePlanFollowOnHint(
  directSurfaces: readonly ChangePlanSurface[],
  dependentSurfaces: readonly ChangePlanSurface[],
): NonNullable<ChangePlanResult["recommendedFollowOn"]> {
  return {
    toolName: "workflow_packet",
    family: "implementation_brief",
    reason:
      dependentSurfaces.length > 0
        ? `turn the ${directSurfaces.length} direct and ${dependentSurfaces.length} dependent graph surfaces into one implementation brief with invariants, risks, and verification guidance`
        : `turn the ${directSurfaces.length} direct graph surfaces into one implementation brief with invariants, risks, and verification guidance`,
  };
}

export function buildDependentChangePlanSurfaces(
  state: GraphTraversalState,
  directSurfaces: readonly ChangePlanSurface[],
  traversalOptions: TraversalOptions,
): ChangePlanDependentSurfaceResult {
  if (directSurfaces.length === 0) {
    return { surfaces: [], truncatedCount: 0 };
  }

  const rootNodes = directSurfaces.map((surface) => surface.node);
  const neighbors = collectGraphNeighbors(state, rootNodes, {
    // Dependent surfaces are always one-hop adjacency around the direct path.
    // The caller's direction still governs the main path search, but adjacency
    // stays bidirectional so the plan does not silently miss upstream checks.
    ...traversalOptions,
    direction: "both",
    traversalDepth: 1,
  });
  const directNodeIds = new Set(rootNodes.map((node) => node.nodeId));
  const adjacentEntries = neighbors.filter((entry) => !directNodeIds.has(entry.node.nodeId));
  const surfaces = adjacentEntries
    .slice(0, CHANGE_PLAN_DEPENDENT_SURFACE_LIMIT)
    .map((entry) =>
      buildChangePlanSurface({
        node: entry.node,
        role: "dependent",
        distance: entry.distance,
        via: entry.via,
        rationale:
          entry.via[0] != null
            ? `${entry.node.label} sits adjacent to ${entry.via[0].fromNode.label} via ${entry.via[0].edge.kind}.`
            : `${entry.node.label} is adjacent to the direct path.`,
      }),
    );

  return {
    surfaces,
    truncatedCount: Math.max(0, adjacentEntries.length - CHANGE_PLAN_DEPENDENT_SURFACE_LIMIT),
  };
}

function buildChangePlanSurface(input: {
  node: GraphNode;
  role: ChangePlanSurface["role"];
  distance: number;
  via: GraphPathHop[];
  rationale: string;
}): ChangePlanSurface {
  return {
    surfaceId: `change_surface_${hashJson({
      nodeId: input.node.nodeId,
      role: input.role,
      distance: input.distance,
      hopEdgeIds: input.via.map((hop) => hop.edge.edgeId),
    })}`,
    node: input.node,
    role: input.role,
    distance: input.distance,
    rationale: input.rationale,
    via: input.via,
    containsHeuristicEdge: input.via.some((hop) => hop.edge.exactness === "heuristic"),
  };
}

export function buildChangePlanSteps(
  directSurfaces: readonly ChangePlanSurface[],
  dependentSurfaces: readonly ChangePlanSurface[],
): ChangePlanStep[] {
  const steps: ChangePlanStep[] = [];
  const directStepByNodeId = new Map<string, string>();

  directSurfaces.forEach((surface, index) => {
    const previousStepId = steps[steps.length - 1]?.stepId;
    const stepId = `change_step_${hashJson({ order: index, surfaceId: surface.surfaceId })}`;
    steps.push({
      stepId,
      title: changePlanStepTitle(surface),
      surfaceId: surface.surfaceId,
      dependsOnStepIds: previousStepId ? [previousStepId] : [],
      rationale: surface.rationale,
    });
    directStepByNodeId.set(surface.node.nodeId, stepId);
  });

  dependentSurfaces.forEach((surface, index) => {
    const rootNodeId = surface.via[0]?.fromNode.nodeId;
    const dependentOn = rootNodeId ? directStepByNodeId.get(rootNodeId) : undefined;
    steps.push({
      stepId: `change_step_${hashJson({ order: directSurfaces.length + index, surfaceId: surface.surfaceId })}`,
      title: changePlanStepTitle(surface),
      surfaceId: surface.surfaceId,
      dependsOnStepIds: dependentOn ? [dependentOn] : [],
      rationale: surface.rationale,
    });
  });

  return steps;
}

function changePlanStepTitle(surface: ChangePlanSurface): string {
  const prefix = surface.role === "direct" ? "Change" : "Recheck";
  switch (surface.node.kind) {
    case "file":
      return `${prefix} file ${surface.node.label}`;
    case "symbol":
      return `${prefix} symbol ${surface.node.label}`;
    case "route":
      return `${prefix} route ${surface.node.label}`;
    case "rpc":
      return `${prefix} RPC ${surface.node.label}`;
    case "table":
      return `${prefix} table ${surface.node.label}`;
    case "policy":
      return `${prefix} policy ${surface.node.label}`;
    case "trigger":
      return `${prefix} trigger ${surface.node.label}`;
    default:
      return `${prefix} ${surface.node.label}`;
  }
}
