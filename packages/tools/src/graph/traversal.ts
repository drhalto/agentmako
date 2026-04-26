import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  GraphNodeLocator,
  GraphPathHop,
  GraphPathNoPathReason,
  GraphSlice,
  GraphTraversalDirection,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { resolveIndexedFilePath } from "../runtime.js";

export const DEFAULT_NEIGHBOR_LIMIT = 25;

export interface TraversalOptions {
  direction: GraphTraversalDirection;
  traversalDepth: number;
  nodeKinds?: Set<GraphNodeKind>;
  edgeKinds?: Set<GraphEdgeKind>;
  includeHeuristicEdges: boolean;
}

export interface TraversalNeighbor {
  node: GraphNode;
  distance: number;
  via: GraphPathHop[];
  containsHeuristicEdge: boolean;
}

export interface GraphTraversalState {
  slice: GraphSlice;
  nodesById: Map<string, GraphNode>;
  outgoingByNodeId: Map<string, GraphEdge[]>;
  incomingByNodeId: Map<string, GraphEdge[]>;
}

export interface GraphPathSearchResult {
  hops: GraphPathHop[];
  noPathReason?: Exclude<GraphPathNoPathReason, "start_not_resolved" | "target_not_resolved" | "no_exact_path">;
}

export function normalizeGraphNodeLocator(
  projectRoot: string,
  projectStore: ProjectStore,
  locator: GraphNodeLocator,
): GraphNodeLocator {
  if (locator.kind === "file") {
    try {
      return {
        kind: "file",
        key: resolveIndexedFilePath(projectRoot, projectStore, locator.key),
      };
    } catch {
      return locator;
    }
  }

  if (locator.kind === "route") {
    return normalizeRouteLocator(projectStore, locator);
  }

  return locator;
}

// The indexer stores routes under keys like `route:/api/events:GET` (API
// routes, with method) and `page:/dashboard/admin` (page routes, no method),
// but callers naturally write the human form that `route_trace` accepts —
// `"GET /api/events"` or `"/dashboard/admin"`. Resolve the human form to the
// stored routeKey by consulting `projectStore.listRoutes()` before the
// graph resolver does its exact-match lookup.
function normalizeRouteLocator(
  projectStore: ProjectStore,
  locator: GraphNodeLocator,
): GraphNodeLocator {
  const input = locator.key.trim();
  if (input.length === 0) return locator;

  const routes = projectStore.listRoutes();

  // 1. Already-stored routeKey passes through untouched.
  if (routes.some((route) => route.routeKey === input)) {
    return { kind: "route", key: input };
  }

  // 2. "METHOD /path" form → look up by pattern + method (case-insensitive).
  const methodMatch = /^([A-Za-z]+)\s+(\/.*)$/.exec(input);
  if (methodMatch) {
    const [, rawMethod, pattern] = methodMatch;
    const method = rawMethod.toUpperCase();
    const match = routes.find(
      (route) =>
        route.pattern === pattern && (route.method ?? "").toUpperCase() === method,
    );
    if (match) {
      return { kind: "route", key: match.routeKey };
    }
  }

  // 3. Bare "/path" form — prefer a page route (bare paths are usually
  //    pages), fall back to the alphabetically-first method-bearing route
  //    with that pattern for deterministic resolution.
  if (input.startsWith("/")) {
    const page = routes.find((route) => route.pattern === input && !route.method);
    if (page) {
      return { kind: "route", key: page.routeKey };
    }
    const api = routes
      .filter((route) => route.pattern === input)
      .sort((left, right) => (left.method ?? "").localeCompare(right.method ?? ""))[0];
    if (api) {
      return { kind: "route", key: api.routeKey };
    }
  }

  // No match — return unchanged so the resolver emits `start_not_resolved`
  // with the caller-supplied key surfaced in the warning.
  return locator;
}

export function resolveGraphNodeLocators(
  slice: GraphSlice,
  locators: GraphNodeLocator[],
): { nodes: GraphNode[]; missing: GraphNodeLocator[] } {
  const nodes: GraphNode[] = [];
  const missing: GraphNodeLocator[] = [];
  const seenNodeIds = new Set<string>();

  for (const locator of locators) {
    const node = resolveGraphNodeLocator(slice, locator);
    if (!node) {
      missing.push(locator);
      continue;
    }
    if (!seenNodeIds.has(node.nodeId)) {
      seenNodeIds.add(node.nodeId);
      nodes.push(node);
    }
  }

  return { nodes, missing };
}

export function resolveGraphNodeLocator(slice: GraphSlice, locator: GraphNodeLocator): GraphNode | null {
  const exact = slice.nodes.find((node) => node.kind === locator.kind && node.key === locator.key);
  if (exact) {
    return exact;
  }

  // RPC key relaxation. The graph stores RPC keys as `schema.name(argTypes)`
  // (e.g. `public.get_visible_events()`, `extensions.armor(bytea)`), but
  // callers naturally write the bare `schema.name` form. If exact match
  // fails and the input looks like a bare RPC identifier, try prefix
  // matching against `schema.name(`. Prefer the no-arg overload when
  // present, else pick the alphabetically-first key for determinism.
  if (locator.kind === "rpc" && !locator.key.includes("(")) {
    const prefix = `${locator.key}(`;
    const matches = slice.nodes.filter(
      (node) => node.kind === "rpc" && node.key.startsWith(prefix),
    );
    if (matches.length > 0) {
      const noArg = matches.find((node) => node.key === `${locator.key}()`);
      if (noArg) {
        return noArg;
      }
      return [...matches].sort((left, right) => left.key.localeCompare(right.key))[0]!;
    }
  }

  return null;
}

export function collectSuggestedStartEntities(
  slice: GraphSlice,
  missingLocators: readonly GraphNodeLocator[],
  limit = 5,
): GraphNodeLocator[] {
  const suggestions = new Map<string, { locator: GraphNodeLocator; score: number }>();

  for (const locator of missingLocators) {
    for (const candidate of suggestGraphNodes(slice, locator, limit)) {
      const key = `${candidate.kind}:${candidate.key}`;
      const existing = suggestions.get(key);
      if (!existing || candidate.score > existing.score) {
        suggestions.set(key, {
          locator: { kind: candidate.kind, key: candidate.key },
          score: candidate.score,
        });
      }
    }
  }

  return [...suggestions.values()]
    .sort((left, right) => right.score - left.score || left.locator.key.localeCompare(right.locator.key))
    .slice(0, limit)
    .map((entry) => entry.locator);
}

function suggestGraphNodes(
  slice: GraphSlice,
  locator: GraphNodeLocator,
  limit: number,
): Array<GraphNodeLocator & { score: number }> {
  const query = locator.key.trim().toLowerCase();
  if (query.length === 0) {
    return [];
  }

  return slice.nodes
    .filter((node) => node.kind === locator.kind)
    .map((node) => ({
      kind: node.kind,
      key: node.key,
      score: scoreGraphNodeSuggestion(query, node),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, limit);
}

function scoreGraphNodeSuggestion(query: string, node: GraphNode): number {
  const key = node.key.toLowerCase();
  const label = node.label.toLowerCase();
  const keyTail = key.split(/[\\/]/).at(-1) ?? key;
  const queryTail = query.split(/[\\/]/).at(-1) ?? query;
  let score = 0;

  if (key === query) {
    score += 100;
  }
  if (label === query) {
    score += 80;
  }
  if (key.startsWith(query)) {
    score += 60;
  }
  if (label.startsWith(query)) {
    score += 40;
  }
  if (key.includes(query)) {
    score += 30;
  }
  if (label.includes(query)) {
    score += 20;
  }
  if (keyTail.startsWith(query) || query.startsWith(keyTail)) {
    score += 15;
  }
  if (keyTail.includes(queryTail) || queryTail.includes(keyTail)) {
    score += 15;
  }

  return score;
}

export function collectGraphNeighbors(
  state: GraphTraversalState,
  startNodes: GraphNode[],
  options: TraversalOptions,
): TraversalNeighbor[] {
  const queue = startNodes.map((node) => ({ node, via: [] as GraphPathHop[] }));
  const rootNodeIds = new Set(startNodes.map((node) => node.nodeId));
  const visited = new Set(startNodes.map((node) => node.nodeId));
  const neighbors: TraversalNeighbor[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as { node: GraphNode; via: GraphPathHop[] };
    if (current.via.length >= options.traversalDepth) {
      continue;
    }

    for (const transition of listGraphTransitions(
      current.node,
      current.via.length,
      state.nodesById,
      state.outgoingByNodeId,
      state.incomingByNodeId,
      options,
    )) {
      if (visited.has(transition.node.nodeId)) {
        continue;
      }
      const nextVia = [...current.via, transition.hop];
      visited.add(transition.node.nodeId);
      queue.push({ node: transition.node, via: nextVia });
      if (!rootNodeIds.has(transition.node.nodeId)) {
        neighbors.push({
          node: transition.node,
          distance: nextVia.length,
          via: nextVia,
          containsHeuristicEdge: nextVia.some((hop) => hop.edge.exactness === "heuristic"),
        });
      }
    }
  }

  neighbors.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    return (
      left.node.kind.localeCompare(right.node.kind) ||
      left.node.key.localeCompare(right.node.key) ||
      left.node.nodeId.localeCompare(right.node.nodeId)
    );
  });
  return neighbors;
}

export function findGraphPath(
  state: GraphTraversalState,
  startNode: GraphNode,
  targetNode: GraphNode,
  options: TraversalOptions,
): GraphPathSearchResult {
  if (startNode.nodeId === targetNode.nodeId) {
    return { hops: [] };
  }

  const queue = [{ node: startNode, via: [] as GraphPathHop[] }];
  const visited = new Set<string>([startNode.nodeId]);
  let hitDepthLimit = false;

  while (queue.length > 0) {
    const current = queue.shift() as { node: GraphNode; via: GraphPathHop[] };
    if (current.via.length >= options.traversalDepth) {
      hitDepthLimit = true;
      continue;
    }

    for (const transition of listGraphTransitions(
      current.node,
      current.via.length,
      state.nodesById,
      state.outgoingByNodeId,
      state.incomingByNodeId,
      options,
    )) {
      if (visited.has(transition.node.nodeId)) {
        continue;
      }
      const nextVia = [...current.via, transition.hop];
      if (transition.node.nodeId === targetNode.nodeId) {
        return { hops: nextVia };
      }
      visited.add(transition.node.nodeId);
      queue.push({ node: transition.node, via: nextVia });
    }
  }

  return {
    hops: [],
    noPathReason: hitDepthLimit ? "depth_exceeded" : "disconnected",
  };
}

function listGraphTransitions(
  currentNode: GraphNode,
  currentDepth: number,
  nodesById: Map<string, GraphNode>,
  outgoingByNodeId: Map<string, GraphEdge[]>,
  incomingByNodeId: Map<string, GraphEdge[]>,
  options: TraversalOptions,
): Array<{ node: GraphNode; hop: GraphPathHop }> {
  const transitions: Array<{ node: GraphNode; hop: GraphPathHop }> = [];

  if (options.direction === "downstream" || options.direction === "both") {
    for (const edge of outgoingByNodeId.get(currentNode.nodeId) ?? []) {
      const nextNode = nodesById.get(edge.toNodeId);
      if (!nextNode || !isEdgeAllowed(edge, nextNode, options)) {
        continue;
      }
      transitions.push({
        node: nextNode,
        hop: buildGraphPathHop(currentNode, nextNode, edge, "downstream", currentDepth),
      });
    }
  }

  if (options.direction === "upstream" || options.direction === "both") {
    for (const edge of incomingByNodeId.get(currentNode.nodeId) ?? []) {
      const nextNode = nodesById.get(edge.fromNodeId);
      if (!nextNode || !isEdgeAllowed(edge, nextNode, options)) {
        continue;
      }
      transitions.push({
        node: nextNode,
        hop: buildGraphPathHop(currentNode, nextNode, edge, "upstream", currentDepth),
      });
    }
  }

  transitions.sort((left, right) => {
    if (left.hop.direction !== right.hop.direction) {
      return left.hop.direction.localeCompare(right.hop.direction);
    }
    return (
      left.node.kind.localeCompare(right.node.kind) ||
      left.node.key.localeCompare(right.node.key) ||
      left.hop.edge.kind.localeCompare(right.hop.edge.kind)
    );
  });
  return transitions;
}

function isEdgeAllowed(edge: GraphEdge, nextNode: GraphNode, options: TraversalOptions): boolean {
  if (!options.includeHeuristicEdges && edge.exactness === "heuristic") {
    return false;
  }
  if (options.edgeKinds && !options.edgeKinds.has(edge.kind)) {
    return false;
  }
  if (options.nodeKinds && !options.nodeKinds.has(nextNode.kind)) {
    return false;
  }
  return true;
}

function buildGraphPathHop(
  fromNode: GraphNode,
  toNode: GraphNode,
  edge: GraphEdge,
  direction: "upstream" | "downstream",
  hopIndex: number,
): GraphPathHop {
  return {
    hopIndex,
    direction,
    fromNode,
    toNode,
    edge,
    explanation:
      direction === "downstream"
        ? `${fromNode.label} connects downstream to ${toNode.label} via ${edge.kind}`
        : `${fromNode.label} connects upstream to ${toNode.label} via ${edge.kind}`,
  };
}

export function buildOutgoingEdgeMap(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const current = map.get(edge.fromNodeId);
    if (current) {
      current.push(edge);
    } else {
      map.set(edge.fromNodeId, [edge]);
    }
  }
  return map;
}

export function buildIncomingEdgeMap(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const current = map.get(edge.toNodeId);
    if (current) {
      current.push(edge);
    } else {
      map.set(edge.toNodeId, [edge]);
    }
  }
  return map;
}
