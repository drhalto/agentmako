import type {
  ContextPacketExpandableTool,
  ContextPacketToolInput,
  JsonObject,
  ToolName,
} from "@mako-ai/contracts";

const EXPANDABLE_TOOL_NAMES = [
  "repo_map",
  "live_text_search",
  "project_open_loops",
  "verification_state",
  "evidence_confidence",
  "change_plan",
  "route_context",
  "table_neighborhood",
  "ast_find_pattern",
  "lint_files",
] as const;

export type ContextPacketExpandableToolName = Extract<
  ToolName,
  (typeof EXPANDABLE_TOOL_NAMES)[number]
>;

export interface ExpandableToolBuildContext {
  input: ContextPacketToolInput;
  projectId: string;
}

type CatalogEntry = (
  ctx: ExpandableToolBuildContext,
) => ContextPacketExpandableTool;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function pickFirstFile(input: ContextPacketToolInput): string | undefined {
  const focus = input.focusFiles?.[0];
  if (focus) return normalizePath(focus);
  const changed = input.changedFiles?.[0];
  if (changed) return normalizePath(changed);
  return undefined;
}

const CATALOG: Record<ContextPacketExpandableToolName, CatalogEntry> = {
  repo_map: ({ projectId }) => ({
    toolName: "repo_map",
    suggestedArgs: { projectId } as JsonObject,
    reason: "Expand from the packet into a broader ranked project map.",
    whenToUse: "Use when primary and related context are too narrow.",
    readOnly: true,
  }),
  live_text_search: ({ projectId, input }) => ({
    toolName: "live_text_search",
    suggestedArgs: {
      projectId,
      query: input.request,
      fixedStrings: true,
    } as unknown as JsonObject,
    reason: "Verify exact live filesystem text when indexed rows may be stale.",
    whenToUse: "Use before trusting suspicious line numbers or post-edit checks.",
    readOnly: true,
  }),
  project_open_loops: ({ projectId }) => ({
    toolName: "project_open_loops",
    suggestedArgs: { projectId } as JsonObject,
    reason: "Check unresolved Reef findings, stale facts, and failed diagnostics related to the project.",
    whenToUse: "Use when the task may inherit unresolved work or stale evidence.",
    readOnly: true,
  }),
  verification_state: ({ projectId }) => ({
    toolName: "verification_state",
    suggestedArgs: { projectId } as JsonObject,
    reason: "See which diagnostics are fresh and which changed files need verification.",
    whenToUse: "Use before declaring a change verified.",
    readOnly: true,
  }),
  evidence_confidence: ({ projectId }) => ({
    toolName: "evidence_confidence",
    suggestedArgs: { projectId } as JsonObject,
    reason: "Inspect Reef confidence labels for facts and findings before trusting ambiguous evidence.",
    whenToUse: "Use when indexed, historical, or semantic evidence may need cross-checking.",
    readOnly: true,
  }),
  change_plan: ({ projectId, input }) => {
    const file = pickFirstFile(input);
    return {
      toolName: "change_plan",
      suggestedArgs: file
        ? ({ projectId, file } as unknown as JsonObject)
        : ({ projectId } as JsonObject),
      reason: "Bound the change to direct + adjacent surfaces with explicit dependency ordering.",
      whenToUse: "Use before editing files with broad fan-out, or when planning a multi-step refactor.",
      readOnly: true,
    };
  },
  route_context: ({ projectId, input }) => {
    const route = input.focusRoutes?.[0];
    return {
      toolName: "route_context",
      suggestedArgs: route
        ? ({ projectId, route } as unknown as JsonObject)
        : ({ projectId } as JsonObject),
      reason: "Pull the route's handler, neighbors, and contracts into focus.",
      whenToUse: "Use when the change touches an HTTP handler or server action.",
      readOnly: true,
    };
  },
  table_neighborhood: ({ projectId, input }) => {
    const target = input.focusDatabaseObjects?.[0];
    return {
      toolName: "table_neighborhood",
      suggestedArgs: target
        ? ({ projectId, table: target } as unknown as JsonObject)
        : ({ projectId } as JsonObject),
      reason: "Expand a table into its inbound/outbound usages and policy neighbors.",
      whenToUse: "Use when a database table is in scope and downstream effects matter.",
      readOnly: true,
    };
  },
  ast_find_pattern: ({ projectId, input }) => ({
    toolName: "ast_find_pattern",
    suggestedArgs: {
      projectId,
      query: input.request,
    } as unknown as JsonObject,
    reason: "Search the working tree for AST patterns that match the request.",
    whenToUse: "Use when the change requires locating exact syntactic shapes (decorators, call sites, JSX).",
    readOnly: true,
  }),
  lint_files: ({ projectId, input }) => {
    const files = [
      ...(input.focusFiles ?? []),
      ...(input.changedFiles ?? []),
    ].map(normalizePath);
    return {
      toolName: "lint_files",
      suggestedArgs: files.length > 0
        ? ({ projectId, files } as unknown as JsonObject)
        : ({ projectId } as JsonObject),
      reason: "Run lint and AST diagnostics on the in-scope files and persist findings.",
      whenToUse: "Use after edits — or before a review — to surface diagnostics on the changed surface.",
      readOnly: false,
    };
  },
};

export function buildExpandableTool(
  name: ContextPacketExpandableToolName,
  ctx: ExpandableToolBuildContext,
): ContextPacketExpandableTool {
  return CATALOG[name](ctx);
}

export function isExpandableToolName(value: string): value is ContextPacketExpandableToolName {
  return (EXPANDABLE_TOOL_NAMES as readonly string[]).includes(value);
}
