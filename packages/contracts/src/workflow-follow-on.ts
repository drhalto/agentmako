import { z } from "zod";
import type { WorkflowPacketFamily } from "./workflow-context.js";

export interface WorkflowPacketFollowOnHint {
  toolName: "workflow_packet";
  family: WorkflowPacketFamily;
  reason: string;
}

export const WorkflowPacketFollowOnHintSchema = z.object({
  toolName: z.literal("workflow_packet"),
  family: z.enum([
    "implementation_brief",
    "impact_packet",
    "precedent_pack",
    "verification_plan",
    "workflow_recipe",
  ]) satisfies z.ZodType<WorkflowPacketFamily>,
  reason: z.string().trim().min(1),
}) satisfies z.ZodType<WorkflowPacketFollowOnHint>;
