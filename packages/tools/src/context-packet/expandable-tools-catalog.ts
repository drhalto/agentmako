import type {
  ContextPacketExpandableTool,
  ContextPacketIntent,
  ContextPacketToolInput,
  JsonObject,
  ToolName,
} from "@mako-ai/contracts";

const EXPANDABLE_TOOL_NAMES = [
  "repo_map",
  "reef_where_used",
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
  intent?: ContextPacketIntent;
}

type CatalogEntry = (
  ctx: ExpandableToolBuildContext,
) => ContextPacketExpandableTool | undefined;

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

function pickFirstFileWithIntent(
  input: ContextPacketToolInput,
  intent: ContextPacketIntent | undefined,
): string | undefined {
  return pickFirstFile(input) ?? intent?.entities.files[0];
}

function whereUsedQuery(input: ContextPacketToolInput, intent: ContextPacketIntent | undefined): {
  query: string;
  targetKind: "file" | "route" | "symbol" | "pattern";
} {
  const symbol = input.focusSymbols?.[0] ?? intent?.entities.symbols[0];
  if (symbol) return { query: symbol, targetKind: "symbol" };
  const route = input.focusRoutes?.[0] ?? intent?.entities.routes[0];
  if (route) return { query: route, targetKind: "route" };
  const file = pickFirstFileWithIntent(input, intent);
  if (file) return { query: normalizePath(file), targetKind: "file" };
  return { query: input.request, targetKind: "pattern" };
}

function uniqueValues(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizePath).filter((value) => value.length > 0))];
}

function repoMapArgs(input: ContextPacketToolInput, projectId: string): JsonObject {
  const focusFiles = uniquePaths([
    ...(input.focusFiles ?? []),
    ...(input.changedFiles ?? []),
  ]);
  const focusRoutes = uniqueValues(input.focusRoutes);
  const focusSymbols = uniqueValues(input.focusSymbols);
  const focusDatabaseObjects = uniqueValues(input.focusDatabaseObjects);

  return {
    projectId,
    ...(focusFiles.length > 0 ? { focusFiles } : {}),
    ...(focusRoutes.length > 0 ? { focusRoutes } : {}),
    ...(focusSymbols.length > 0 ? { focusSymbols } : {}),
    ...(focusDatabaseObjects.length > 0 ? { focusDatabaseObjects } : {}),
  } as JsonObject;
}

function liveTextQuery(input: ContextPacketToolInput, intent: ContextPacketIntent | undefined): string {
  const quotedText = intent?.entities.quotedText[0];
  if (quotedText) return quotedText;
  const symbol = intent?.entities.symbols[0] ?? input.focusSymbols?.[0];
  if (symbol) return symbol;
  return input.request;
}

function tableNeighborhoodArgs(projectId: string, target: string | undefined): JsonObject | undefined {
  if (!target) return undefined;
  const parts = target.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      projectId,
      schemaName: parts[0],
      tableName: parts.slice(1).join("."),
    } as unknown as JsonObject;
  }
  return { projectId, tableName: target } as unknown as JsonObject;
}

function graphNodeLocator(kind: "file" | "route" | "symbol" | "table", key: string): JsonObject {
  return { kind, key } as unknown as JsonObject;
}

function uniqueGraphLocators(locators: readonly JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  const out: JsonObject[] = [];
  for (const locator of locators) {
    const key = JSON.stringify(locator);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(locator);
  }
  return out;
}

function changePlanArgs(
  projectId: string,
  input: ContextPacketToolInput,
  intent: ContextPacketIntent | undefined,
): JsonObject | undefined {
  const locators = uniqueGraphLocators([
    ...uniquePaths([
      ...(input.focusFiles ?? []),
      ...(input.changedFiles ?? []),
      ...(intent?.entities.files ?? []),
    ]).map((file) => graphNodeLocator("file", file)),
    ...uniqueValues([...(input.focusRoutes ?? []), ...(intent?.entities.routes ?? [])])
      .map((route) => graphNodeLocator("route", route)),
    ...uniqueValues([...(input.focusSymbols ?? []), ...(intent?.entities.symbols ?? [])])
      .map((symbol) => graphNodeLocator("symbol", symbol)),
    ...uniqueValues([
      ...(input.focusDatabaseObjects ?? []),
      ...(intent?.entities.databaseObjects ?? []),
    ]).map((objectName) => graphNodeLocator("table", objectName)),
  ]);

  const startEntity = locators[0];
  const targetEntity = locators[1];
  if (!startEntity || !targetEntity) return undefined;

  return {
    projectId,
    startEntity,
    targetEntity,
    direction: "both",
    traversalDepth: 3,
    includeHeuristicEdges: true,
  } as unknown as JsonObject;
}

const CATALOG: Record<ContextPacketExpandableToolName, CatalogEntry> = {
  repo_map: ({ projectId, input }) => ({
    toolName: "repo_map",
    suggestedArgs: repoMapArgs(input, projectId),
    reason: "Expand from the packet into a broader anchor-personalized ranked project map.",
    whenToUse: "Use when primary and related context are too narrow, especially around known files, routes, symbols, or database objects.",
    readOnly: true,
  }),
  reef_where_used: ({ projectId, input, intent }) => {
    const query = whereUsedQuery(input, intent);
    return {
      toolName: "reef_where_used",
      suggestedArgs: {
        projectId,
        query: query.query,
        targetKind: query.targetKind,
        limit: 50,
      } as unknown as JsonObject,
      reason: "Inspect maintained definitions/usages for the most specific file, route, symbol, or pattern anchor.",
      whenToUse: "Use when graph evidence is missing, isolated, or the request asks where an anchor is used.",
      readOnly: true,
    };
  },
  live_text_search: ({ projectId, input, intent }) => ({
    toolName: "live_text_search",
    suggestedArgs: {
      projectId,
      query: liveTextQuery(input, intent),
      fixedStrings: true,
      maxMatches: 50,
    } as unknown as JsonObject,
    reason: "Verify exact live filesystem text for the most specific quoted literal or symbol before trusting indexed rows.",
    whenToUse: "Use before trusting suspicious line numbers, stale indexed context, or post-edit text checks.",
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
  change_plan: ({ projectId, input, intent }) => {
    const suggestedArgs = changePlanArgs(projectId, input, intent);
    if (!suggestedArgs) return undefined;
    return {
      toolName: "change_plan",
      suggestedArgs,
      reason: "Bound the change to direct + adjacent surfaces with explicit dependency ordering.",
      whenToUse: "Use before editing files with broad fan-out, or when planning a multi-step refactor.",
      readOnly: true,
    };
  },
  route_context: ({ projectId, input, intent }) => {
    const route = input.focusRoutes?.[0] ?? intent?.entities.routes[0];
    if (!route) return undefined;
    return {
      toolName: "route_context",
      suggestedArgs: { projectId, route, maxPerSection: 20 } as unknown as JsonObject,
      reason: "Pull the route's handler, neighbors, and contracts into focus.",
      whenToUse: "Use when the change touches an HTTP handler or server action.",
      readOnly: true,
    };
  },
  table_neighborhood: ({ projectId, input, intent }) => {
    const target = input.focusDatabaseObjects?.[0] ?? intent?.entities.databaseObjects[0];
    const suggestedArgs = tableNeighborhoodArgs(projectId, target);
    if (!suggestedArgs) return undefined;
    return {
      toolName: "table_neighborhood",
      suggestedArgs,
      reason: "Expand a table into its inbound/outbound usages and policy neighbors.",
      whenToUse: "Use when a database table is in scope and downstream effects matter.",
      readOnly: true,
    };
  },
  ast_find_pattern: ({ projectId, input, intent }) => ({
    toolName: "ast_find_pattern",
    suggestedArgs: {
      projectId,
      pattern: liveTextQuery(input, intent),
      maxMatches: 50,
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
    if (files.length === 0) return undefined;
    return {
      toolName: "lint_files",
      suggestedArgs: { projectId, files } as unknown as JsonObject,
      reason: "Run lint and AST diagnostics on the in-scope files and persist findings.",
      whenToUse: "Use after edits — or before a review — to surface diagnostics on the changed surface.",
      readOnly: false,
    };
  },
};

export function buildExpandableTool(
  name: ContextPacketExpandableToolName,
  ctx: ExpandableToolBuildContext,
): ContextPacketExpandableTool | undefined {
  return CATALOG[name](ctx);
}

export function isExpandableToolName(value: string): value is ContextPacketExpandableToolName {
  return (EXPANDABLE_TOOL_NAMES as readonly string[]).includes(value);
}
