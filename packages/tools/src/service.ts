import type {
  AnswerPacket,
  AnswerToolQueryKind,
  AnswerResult,
  AttachedProject,
  ProjectLocatorInput,
  ProjectProfile,
  ToolDefinitionSummary,
  ToolOutput,
  WorkflowPacketSurface,
  WorkflowPacketToolInput,
} from "@mako-ai/contracts";
import { loadConfig } from "@mako-ai/config";
import { openGlobalStore, type GlobalStore } from "@mako-ai/store";
import { invokeTool, runAnswerPacket } from "./registry.js";
import { buildRegistryToolExposurePlan, type ToolExposureSurface } from "./tool-exposure.js";
import { createFreshAnswerPacket } from "./answers/packet.js";
import { evaluateTrustState, type EvaluateTrustStateInput, type EvaluateTrustStateResult } from "./trust/evaluate-trust-state.js";
import {
  listTrustStateHistory,
  readTrustState,
  type ListTrustStateHistoryInput,
  type ReadTrustStateInput,
} from "./trust/read-trust-state.js";
import { rerunAndCompare, type RerunAndCompareInput, type RerunAndCompareResult } from "./trust/rerun-and-compare.js";
import { generateWorkflowPacketSurfaceForQuery } from "./workflow-packets/surfaces.js";
import { withProjectContext, type ToolServiceCallOptions, type ToolServiceOptions, type ToolServiceRequestContext } from "./runtime.js";

export class MakoToolService {
  private readonly sharedStore: GlobalStore;
  private readonly ownsStore: boolean;
  private readonly effectiveOptions: ToolServiceOptions;

  constructor(options: ToolServiceOptions = {}) {
    if (options.sharedGlobalStore) {
      this.sharedStore = options.sharedGlobalStore;
      this.ownsStore = false;
    } else {
      const config = loadConfig(options.configOverrides);
      this.sharedStore = openGlobalStore({
        stateDirName: config.stateDirName,
        globalDbFilename: config.globalDbFilename,
      });
      this.ownsStore = true;
    }
    this.effectiveOptions = { ...options, sharedGlobalStore: this.sharedStore };
  }

  listTools(
    surface: ToolExposureSurface = "api",
    requestContext?: ToolServiceRequestContext,
  ): ToolDefinitionSummary[] {
    return buildRegistryToolExposurePlan({
      ...this.effectiveOptions,
      requestContext,
      surface,
    }).immediate.map((item) => item.summary);
  }

  async callTool(
    name: string,
    input: unknown,
    requestContext?: ToolServiceRequestContext,
    callOptions: ToolServiceCallOptions = {},
  ): Promise<ToolOutput> {
    return invokeTool(name, input, { ...this.effectiveOptions, ...callOptions, requestContext });
  }

  async answer(packet: AnswerPacket, requestContext?: ToolServiceRequestContext): Promise<AnswerResult> {
    return runAnswerPacket(packet, { ...this.effectiveOptions, requestContext });
  }

  async answerQuestion(
    locator: ProjectLocatorInput,
    queryKind: AnswerToolQueryKind | "free_form",
    queryText: string,
    requestContext?: ToolServiceRequestContext,
  ): Promise<AnswerResult> {
    const context = await withProjectContext(locator, { ...this.effectiveOptions, requestContext }, ({ project, profile }) => ({
      projectId: project.projectId,
      supportLevel: profile?.supportLevel ?? "best_effort",
    }));

    return runAnswerPacket(
      createFreshAnswerPacket(context.projectId, queryKind, queryText, context.supportLevel),
      { ...this.effectiveOptions, requestContext },
    );
  }

  async generateWorkflowPacket(
    input: WorkflowPacketToolInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<WorkflowPacketSurface> {
    return generateWorkflowPacketSurfaceForQuery(input, {
      ...this.effectiveOptions,
      requestContext,
    });
  }

  async rerunAndCompare(
    input: RerunAndCompareInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<RerunAndCompareResult> {
    return rerunAndCompare(input, { ...this.effectiveOptions, requestContext });
  }

  async evaluateTrustState(
    input: EvaluateTrustStateInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<EvaluateTrustStateResult> {
    return evaluateTrustState(input, { ...this.effectiveOptions, requestContext });
  }

  async readTrustState(
    input: ReadTrustStateInput,
    requestContext?: ToolServiceRequestContext,
  ) {
    return readTrustState(input, { ...this.effectiveOptions, requestContext });
  }

  async listTrustStateHistory(
    input: ListTrustStateHistoryInput,
    requestContext?: ToolServiceRequestContext,
  ) {
    return listTrustStateHistory(input, { ...this.effectiveOptions, requestContext });
  }

  async resolveProject(
    locator: ProjectLocatorInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<{ project: AttachedProject; profile: ProjectProfile | null }> {
    return withProjectContext(locator, { ...this.effectiveOptions, requestContext }, ({ project, profile }) => ({
      project,
      profile,
    }));
  }

  close(): void {
    if (this.ownsStore) {
      this.sharedStore.close();
    }
  }
}

export function createToolService(options: ToolServiceOptions = {}): MakoToolService {
  return new MakoToolService(options);
}
