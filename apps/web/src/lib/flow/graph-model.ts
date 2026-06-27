/**
 * Flow graph model.
 *
 * Turns a flat list of "a tool ran and touched these files" records into a
 * bipartite node/edge graph (tool nodes ↔ file nodes), with optional
 * directory rollup so a real repo's hundreds of files stay legible. The same
 * builder serves both the historical seed (from `recall_tool_runs`) and the
 * live overlay (from the harness SSE stream) — callers normalize each source
 * into `FlowRunInput[]` first.
 *
 * Pure data only: positions/rendering live in the canvas component.
 */

import type { HarnessStreamEvent } from "../../hooks/useHarnessStream";
import {
  extractTouchedFiles,
  isMutationRun,
  type ToolRunLike,
} from "./extract-files";

export type FlowNodeKind = "tool" | "file" | "dir";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** Display label (tool name, basename, or directory name). */
  label: string;
  /** Full identifier for tooltips (tool name or full path). */
  title: string;
  /** Calls (tools) or touches (files/dirs). */
  runs: number;
  /** How many of those involved a failed/errored run. */
  errors: number;
  /** Epoch ms of the most recent activity — drives pulse + recency glow. */
  lastActivityMs: number;
  /** file/dir only: top-level directory key this node rolls up under. */
  dir?: string;
  /** dir only: number of distinct files collapsed into this node. */
  fileCount?: number;
}

export interface FlowEdge {
  id: string;
  /** Tool node id. */
  source: string;
  /** File or directory node id. */
  target: string;
  /** Number of touches. */
  weight: number;
  /** How many touches were writes (vs reads). */
  mutations: number;
  lastActivityMs: number;
}

export interface FlowGraphMeta {
  toolCount: number;
  fileCount: number;
  touchCount: number;
  /** Files dropped by the node cap (still counted in touchCount). */
  hiddenFileCount: number;
  /** Top-level directories present (for the expand/collapse control). */
  dirs: string[];
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  meta: FlowGraphMeta;
}

/** One tool invocation flattened to the fields the graph needs. */
export interface FlowRunInput {
  /** Stable id (runId or callId) — used only for de-duplication. */
  id: string;
  tool: string;
  files: string[];
  isMutation: boolean;
  outcome: "success" | "failed" | "error";
  atMs: number;
}

export interface BuildFlowGraphOptions {
  /** Roll files up under their top-level directory unless expanded. */
  groupByDirectory?: boolean;
  /** Directory keys to show expanded (files individually) when grouping. */
  expandedDirs?: Set<string>;
  /** Cap on file/dir nodes; least-active beyond this are hidden. */
  maxFileNodes?: number;
}

const DEFAULT_MAX_FILE_NODES = 220;

export const toolNodeId = (tool: string): string => `tool:${tool}`;
export const fileNodeId = (path: string): string => `file:${path}`;
export const dirNodeId = (dir: string): string => `dir:${dir}`;

/** Top-level directory key for a path (`apps/web/x.ts` → `apps`). */
export function topLevelDir(path: string): string | null {
  const slash = path.indexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function isoToMs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Map a recalled tool-run record into a FlowRunInput. */
export function runToFlowInput(
  run: ToolRunLike & { runId?: string; finishedAt?: string; startedAt?: string },
): FlowRunInput {
  return {
    id: run.runId ?? `${run.toolName}:${run.finishedAt ?? run.startedAt ?? ""}`,
    tool: run.toolName,
    files: extractTouchedFiles(run),
    isMutation: isMutationRun(run),
    outcome: run.outcome ?? "success",
    atMs: isoToMs(run.finishedAt ?? run.startedAt),
  };
}

/**
 * Pair live `tool.call` / `tool.result` events by callId into FlowRunInputs.
 * A call with no result yet still contributes (its args may name files);
 * the result, when it arrives, supplies outcome + any `filesAffected`.
 */
export function liveEventsToFlowInputs(events: HarnessStreamEvent[]): FlowRunInput[] {
  interface Pending {
    tool: string;
    files: Set<string>;
    isMutation: boolean;
    outcome: "success" | "failed" | "error";
    atMs: number;
  }
  const byCall = new Map<string, Pending>();

  for (const { event, createdAt } of events) {
    const atMs = isoToMs(createdAt);
    if (event.kind === "tool.call") {
      const entry = byCall.get(event.callId) ?? {
        tool: event.tool,
        files: new Set<string>(),
        isMutation: false,
        outcome: "success" as const,
        atMs,
      };
      entry.tool = event.tool;
      entry.atMs = Math.max(entry.atMs, atMs);
      for (const f of extractTouchedFiles({ tool: event.tool, argsPreview: event.argsPreview })) {
        entry.files.add(f);
      }
      if (isMutationRun({ tool: event.tool, argsPreview: event.argsPreview })) entry.isMutation = true;
      byCall.set(event.callId, entry);
    } else if (event.kind === "tool.result") {
      const entry = byCall.get(event.callId) ?? {
        tool: "(tool)",
        files: new Set<string>(),
        isMutation: false,
        outcome: "success" as const,
        atMs,
      };
      entry.atMs = Math.max(entry.atMs, atMs);
      entry.outcome = event.ok ? "success" : "error";
      for (const f of extractTouchedFiles({ tool: entry.tool, resultPreview: event.resultPreview })) {
        entry.files.add(f);
      }
      if (isMutationRun({ tool: entry.tool, resultPreview: event.resultPreview })) entry.isMutation = true;
      byCall.set(event.callId, entry);
    }
  }

  return [...byCall.entries()].map(([callId, p]) => ({
    id: callId,
    tool: p.tool,
    files: [...p.files],
    isMutation: p.isMutation,
    outcome: p.outcome,
    atMs: p.atMs,
  }));
}

/** Build the bipartite tool↔file graph from flattened run inputs. */
export function buildFlowGraph(
  runs: FlowRunInput[],
  options: BuildFlowGraphOptions = {},
): FlowGraph {
  const groupByDirectory = options.groupByDirectory ?? true;
  const expandedDirs = options.expandedDirs ?? new Set<string>();
  const maxFileNodes = options.maxFileNodes ?? DEFAULT_MAX_FILE_NODES;

  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const dirFiles = new Map<string, Set<string>>();
  const allFiles = new Set<string>();
  const allDirs = new Set<string>();
  let touchCount = 0;

  const bumpNode = (
    id: string,
    init: () => FlowNode,
    failed: boolean,
    atMs: number,
  ): FlowNode => {
    let node = nodes.get(id);
    if (!node) {
      node = init();
      nodes.set(id, node);
    }
    node.runs += 1;
    if (failed) node.errors += 1;
    if (atMs > node.lastActivityMs) node.lastActivityMs = atMs;
    return node;
  };

  for (const run of runs) {
    const failed = run.outcome !== "success";
    const toolId = toolNodeId(run.tool);
    // Tool node: one bump per call (not per file) so size reflects calls.
    bumpNode(
      toolId,
      () => ({ id: toolId, kind: "tool", label: run.tool, title: run.tool, runs: 0, errors: 0, lastActivityMs: 0 }),
      failed,
      run.atMs,
    );

    for (const file of run.files) {
      touchCount += 1;
      allFiles.add(file);
      const dir = topLevelDir(file);
      if (dir) allDirs.add(dir);

      const collapse = groupByDirectory && dir !== null && !expandedDirs.has(dir);
      let targetId: string;
      if (collapse && dir) {
        targetId = dirNodeId(dir);
        bumpNode(
          targetId,
          () => ({ id: targetId, kind: "dir", label: `${dir}/`, title: `${dir}/`, runs: 0, errors: 0, lastActivityMs: 0, dir, fileCount: 0 }),
          failed,
          run.atMs,
        );
        const set = dirFiles.get(dir) ?? new Set<string>();
        set.add(file);
        dirFiles.set(dir, set);
      } else {
        targetId = fileNodeId(file);
        bumpNode(
          targetId,
          () => ({ id: targetId, kind: "file", label: basename(file), title: file, runs: 0, errors: 0, lastActivityMs: 0, dir: dir ?? undefined }),
          failed,
          run.atMs,
        );
      }

      const edgeId = `${toolId}__${targetId}`;
      let edge = edges.get(edgeId);
      if (!edge) {
        edge = { id: edgeId, source: toolId, target: targetId, weight: 0, mutations: 0, lastActivityMs: 0 };
        edges.set(edgeId, edge);
      }
      edge.weight += 1;
      if (run.isMutation) edge.mutations += 1;
      if (run.atMs > edge.lastActivityMs) edge.lastActivityMs = run.atMs;
    }
  }

  // Fill in directory fileCounts.
  for (const [dir, files] of dirFiles) {
    const node = nodes.get(dirNodeId(dir));
    if (node) node.fileCount = files.size;
  }

  // Cap file/dir nodes by activity, keeping all tool nodes.
  const fileNodes = [...nodes.values()].filter((n) => n.kind !== "tool");
  let hiddenFileCount = 0;
  if (fileNodes.length > maxFileNodes) {
    const keep = new Set(
      fileNodes
        .slice()
        .sort((a, b) => b.runs - a.runs || b.lastActivityMs - a.lastActivityMs)
        .slice(0, maxFileNodes)
        .map((n) => n.id),
    );
    for (const n of fileNodes) {
      if (!keep.has(n.id)) {
        nodes.delete(n.id);
        hiddenFileCount += 1;
      }
    }
    for (const [id, edge] of edges) {
      if (!nodes.has(edge.target)) edges.delete(id);
    }
  }

  const toolCount = [...nodes.values()].filter((n) => n.kind === "tool").length;

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    meta: {
      toolCount,
      fileCount: allFiles.size,
      touchCount,
      hiddenFileCount,
      dirs: [...allDirs].sort(),
    },
  };
}
