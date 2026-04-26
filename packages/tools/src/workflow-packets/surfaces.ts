import {
  extractAnswerResultFromToolOutput,
  type AnswerResult,
  type JsonObject,
  type SupportLevel,
  type WorkflowContextBundle,
  type WorkflowContextItem,
  type WorkflowPacketInput,
  type WorkflowPacketRefreshReason,
  type WorkflowPacketRequest,
  type WorkflowPacketSurface,
  type WorkflowPacketToolInput,
  type WorkflowPacketToolOutput,
} from "@mako-ai/contracts";
import { hashJson, type ProjectStore } from "@mako-ai/store";
import { createLogger } from "@mako-ai/logger";
import { createFreshAnswerPacket } from "../answers/packet.js";
import { runAnswerPacket } from "../answers/index.js";
import { invokeTool } from "../registry.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { buildWorkflowPacketInput } from "../workflow-context/index.js";
import { normalizeStringArray } from "./common.js";
import { generateWorkflowPacket } from "./generators.js";
import { buildWorkflowPacketSurface } from "./surface-common.js";

type PacketSurfaceSource = AnswerResult | WorkflowContextBundle;
const workflowPacketSurfaceLogger = createLogger("mako-tools", { component: "workflow-packets" });

function buildWorkflowPacketStableId(input: WorkflowPacketInput): string {
  const stableItemKeys = new Map(
    input.selectedItems.map((item) => [item.itemId, stableWorkflowContextItemKey(item)] as const),
  );

  const stableIdsFor = (itemIds: readonly string[]): string[] =>
    normalizeStringArray(
      itemIds.map((itemId) => stableItemKeys.get(itemId)).filter((value): value is string => value != null),
    );

  return `workflow_packet_watch_${hashJson({
    family: input.family,
    projectId: input.projectId,
    scope: input.scope,
    watchMode: input.watchMode,
    selectedItemIds: stableIdsFor(input.selectedItemIds),
    primaryItemIds: stableIdsFor(input.primaryItemIds),
    supportingItemIds: stableIdsFor(input.supportingItemIds),
    focusedItemIds: stableIdsFor(input.focusedItemIds),
  })}`;
}

export async function generateWorkflowPacketSurface(
  source: PacketSurfaceSource,
  request: WorkflowPacketRequest,
  options: { refreshReason?: WorkflowPacketRefreshReason } = {},
): Promise<WorkflowPacketSurface> {
  const packetInput = buildWorkflowPacketInput(source, request);
  const packet = await generateWorkflowPacket(source, request);
  return buildWorkflowPacketSurface(packet, {
    refreshReason: options.refreshReason,
    stablePacketId: buildWorkflowPacketStableId(packetInput),
  });
}

export async function generateWorkflowPacketSurfaceForQuery(
  input: WorkflowPacketToolInput,
  options: ToolServiceOptions = {},
): Promise<WorkflowPacketSurface> {
  return withProjectContext(
    {
      projectId: input.projectId,
      projectRef: input.projectRef,
    },
    options,
    async ({ project, profile, projectStore }) => {
      const answer = await resolveAnswerResultForQuery(
        project.projectId,
        profile?.supportLevel ?? "best_effort",
        input,
        options,
      );
      const surface = await generateWorkflowPacketSurface(
        answer,
        {
          family: input.family,
          scope: input.scope,
          focusItemIds: input.focusItemIds,
          focusKinds: input.focusKinds,
          referencePrecedents: input.referencePrecedents,
          watchMode: input.watchMode,
        },
        { refreshReason: input.refreshReason },
      );

      recordWorkflowPacketFollowup(projectStore, {
        input,
        answer,
        surface,
        requestId: options.requestContext?.requestId,
      });

      return surface;
    },
  );
}

export async function workflowPacketTool(
  input: WorkflowPacketToolInput,
  options: ToolServiceOptions = {},
): Promise<WorkflowPacketToolOutput> {
  const result = await generateWorkflowPacketSurfaceForQuery(input, options);
  return {
    toolName: "workflow_packet",
    projectId: result.packet.projectId,
    result,
  };
}

async function resolveAnswerResultForQuery(
  projectId: string,
  supportLevel: SupportLevel,
  input: WorkflowPacketToolInput,
  options: ToolServiceOptions,
): Promise<AnswerResult> {
  if (input.queryKind === "free_form") {
    return runAnswerPacket(
      createFreshAnswerPacket(projectId, "free_form", input.queryText, supportLevel),
      options,
    );
  }

  const output = await invokeTool(
    input.queryKind,
    {
      ...(input.queryArgs ?? buildToolArgsForQuery(input.queryKind, input.queryText)),
      projectId,
    },
    options,
  );
  const answer = extractAnswerResultFromToolOutput(output);
  if (!answer) {
    throw new Error(`Workflow packet query ${input.queryKind} did not produce an answer result.`);
  }
  return answer;
}

function recordWorkflowPacketFollowup(
  projectStore: ProjectStore,
  args: {
    input: WorkflowPacketToolInput;
    answer: AnswerResult;
    surface: WorkflowPacketSurface;
    requestId?: string;
  },
): void {
  const followup = args.input.followup;
  if (!followup) {
    return;
  }

  try {
    projectStore.insertWorkflowFollowup({
      projectId: args.surface.packet.projectId,
      originQueryId: followup.originQueryId,
      originActionId: followup.originActionId,
      originPacketId: followup.originPacketId ?? undefined,
      originPacketFamily: followup.originPacketFamily,
      originQueryKind: followup.originQueryKind,
      executedToolName: "workflow_packet",
      executedInput: buildRecordedFollowupInput(args.input),
      resultPacketId: args.surface.packet.packetId,
      resultPacketFamily: args.surface.packet.family,
      resultQueryId: args.answer.queryId,
      requestId: args.requestId,
    });
  } catch (error) {
    workflowPacketSurfaceLogger.warn("workflow_packet.followup_write_failed", {
      originQueryId: followup.originQueryId,
      originActionId: followup.originActionId,
      family: followup.originPacketFamily,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildRecordedFollowupInput(input: WorkflowPacketToolInput): JsonObject {
  return {
    family: input.family,
    queryKind: input.queryKind,
    queryText: input.queryText,
    ...(input.queryArgs ? { queryArgs: input.queryArgs } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.focusItemIds && input.focusItemIds.length > 0 ? { focusItemIds: input.focusItemIds } : {}),
    ...(input.focusKinds && input.focusKinds.length > 0 ? { focusKinds: input.focusKinds } : {}),
    ...(input.watchMode ? { watchMode: input.watchMode } : {}),
    ...(input.refreshReason ? { refreshReason: input.refreshReason } : {}),
  };
}

function buildToolArgsForQuery(queryKind: WorkflowPacketToolInput["queryKind"], queryText: string): Record<string, unknown> {
  const trimmed = queryText.trim();
  switch (queryKind) {
    case "route_trace":
      return { route: trimmed };
    case "schema_usage": {
      const qualified = parseSchemaQualifiedName(trimmed);
      return qualified.schema
        ? { object: qualified.name, schema: qualified.schema }
        : { object: trimmed };
    }
    case "file_health":
    case "trace_file":
      return { file: trimmed };
    case "auth_path":
      return classifyAuthPathQuery(trimmed);
    case "preflight_table":
    case "trace_table": {
      const qualified = parseSchemaQualifiedName(trimmed);
      return qualified.schema
        ? { table: qualified.name, schema: qualified.schema }
        : { table: trimmed };
    }
    case "cross_search":
      return { term: trimmed };
    case "trace_edge":
      return { name: trimmed };
    case "trace_error":
      return { term: trimmed };
    case "trace_rpc": {
      const qualified = parseSchemaQualifiedName(trimmed);
      return qualified.schema
        ? { name: qualified.name, schema: qualified.schema }
        : { name: trimmed };
    }
    case "free_form":
      return {};
  }
}

function parseSchemaQualifiedName(value: string): { schema: string | null; name: string } {
  const dotIndex = value.indexOf(".");
  if (dotIndex <= 0 || dotIndex === value.length - 1) {
    return { schema: null, name: value };
  }
  return {
    schema: value.slice(0, dotIndex).trim() || null,
    name: value.slice(dotIndex + 1).trim(),
  };
}

function classifyAuthPathQuery(value: string): Record<string, string> {
  if (value.startsWith("/")) {
    return { route: value };
  }
  if (/[\\/]/.test(value) || /\.[A-Za-z0-9]+$/.test(value)) {
    return { file: value };
  }
  return { feature: value };
}

function stableWorkflowContextItemKey(item: WorkflowContextItem): string {
  switch (item.kind) {
    case "answer_packet":
      return hashJson({
        kind: item.kind,
        queryKind: item.data.queryKind,
        queryText: item.data.queryText,
        supportLevel: item.data.supportLevel,
        evidenceStatus: item.data.evidenceStatus,
        answerConfidence: item.data.answerConfidence,
        stalenessFlags: item.data.stalenessFlags,
        rankingDeEmphasized: item.data.rankingDeEmphasized,
        rankingReasonCodes: item.data.rankingReasonCodes,
      });
    case "file":
      return hashJson({ kind: item.kind, filePath: item.data.filePath, line: item.data.line });
    case "symbol":
      return hashJson({
        kind: item.kind,
        symbolName: item.data.symbolName,
        filePath: item.data.filePath,
        line: item.data.line,
        exportName: item.data.exportName,
      });
    case "route":
      return hashJson({
        kind: item.kind,
        routeKey: item.data.routeKey,
        pattern: item.data.pattern,
        method: item.data.method,
        filePath: item.data.filePath,
        handlerName: item.data.handlerName,
        isApi: item.data.isApi,
      });
    case "rpc":
      return hashJson({
        kind: item.kind,
        schemaName: item.data.schemaName,
        rpcName: item.data.rpcName,
        argTypes: item.data.argTypes,
      });
    case "table":
      return hashJson({
        kind: item.kind,
        schemaName: item.data.schemaName,
        tableName: item.data.tableName,
      });
    case "reference_precedent":
      return hashJson({
        kind: item.kind,
        repoName: item.data.repoName,
        path: item.data.path,
        startLine: item.data.startLine,
        endLine: item.data.endLine,
        excerpt: item.data.excerpt,
        searchKind: item.data.searchKind,
        score: item.data.score,
        vecRank: item.data.vecRank,
        ftsRank: item.data.ftsRank,
      });
    case "diagnostic":
      return hashJson({
        kind: item.kind,
        code: item.data.code,
        category: item.data.category,
        severity: item.data.severity,
        confidence: item.data.confidence,
        path: item.data.path,
        producerPath: item.data.producerPath,
        consumerPath: item.data.consumerPath,
        line: item.data.line,
      });
    case "trust_evaluation":
      // Watch identity should reflect the current trust verdict, not whether
      // a repeated call has accumulated more same-target history internally.
      return hashJson({
        kind: item.kind,
        state: item.data.state,
        reasonCodes: item.data.reasonCodes,
        conflictingFacets: item.data.conflictingFacets,
      });
    case "comparison":
      return hashJson({
        kind: item.kind,
        summaryChanges: item.data.summaryChanges,
      });
  }
}
