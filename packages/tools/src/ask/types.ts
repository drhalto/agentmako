import type {
  AskSelectedFamily,
  AskToolInput,
  JsonObject,
  ProjectLocatorInput,
  ToolName,
} from "@mako-ai/contracts";
import type { ZodTypeAny } from "zod";
import type { ToolServiceOptions } from "../runtime.js";

export type AskDirectToolName = Exclude<
  ToolName,
  | "ask"
  | "workflow_packet"
  | "task_preflight_artifact"
  | "implementation_handoff_artifact"
  | "review_bundle_artifact"
  | "verification_bundle_artifact"
  | "suggest"
  | "investigate"
  | "graph_neighbors"
  | "graph_path"
  | "flow_map"
  | "change_plan"
  | "tenant_leak_audit"
  | "session_handoff"
  | "health_trend"
  | "issues_next"
>;

export type AskToolFamily = Exclude<AskSelectedFamily, "fallback">;

export interface AskExecutionDefinition {
  family: AskToolFamily;
  requiresProject: boolean;
  schema: ZodTypeAny;
  execute(input: unknown, options: ToolServiceOptions): Promise<unknown>;
}

export interface AskToolSelection {
  mode: "tool";
  selectedFamily: AskToolFamily;
  selectedTool: AskDirectToolName;
  selectedArgs: JsonObject;
  confidence: number;
}

export interface AskFallbackSelection {
  mode: "fallback";
  selectedFamily: "fallback";
  selectedTool: "free_form";
  selectedArgs: JsonObject;
  confidence: number;
  fallbackReason: string;
}

export type AskSelection = AskToolSelection | AskFallbackSelection;

export function projectLocatorArgs(input: AskToolInput): ProjectLocatorInput & JsonObject {
  const args: ProjectLocatorInput & JsonObject = {};
  if (input.projectId) {
    args.projectId = input.projectId;
  }
  if (input.projectRef) {
    args.projectRef = input.projectRef;
  }
  return args;
}

export function toProjectScopedArgs(input: AskToolInput, args: JsonObject): JsonObject {
  return {
    ...projectLocatorArgs(input),
    ...args,
  };
}
