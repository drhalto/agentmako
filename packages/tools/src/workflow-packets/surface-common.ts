import type {
  WorkflowPacketAttachmentDecision,
  WorkflowPacket,
  WorkflowPacketFamily,
  WorkflowPacketHandoff,
  WorkflowPacketRefreshReason,
  WorkflowRecipePacket,
  WorkflowPacketSurface,
  WorkflowPacketSurfacePlan,
  WorkflowVerificationPlanPacket,
} from "@mako-ai/contracts";
import { normalizeStringArray } from "./common.js";
import { formatWorkflowPacket } from "./index.js";

export function buildWorkflowPacketSurfacePlan(
  family: WorkflowPacketFamily,
): WorkflowPacketSurfacePlan {
  switch (family) {
    case "workflow_recipe":
    case "verification_plan":
      return {
        generateWith: "tool",
        guidedConsumption: "prompt",
        reusableContext: null,
      };
    case "implementation_brief":
    case "impact_packet":
    case "precedent_pack":
      return {
        generateWith: "tool",
        guidedConsumption: null,
        reusableContext: "resource",
      };
  }
}

function defaultRefreshTriggers(packet: WorkflowPacket): string[] {
  switch (packet.family) {
    case "workflow_recipe":
      return normalizeStringArray(packet.payload.steps.flatMap((step) => step.rerunTriggers));
    case "verification_plan": {
      const section = packet.sections.find((candidate) => candidate.kind === "rerun_triggers");
      return normalizeStringArray(section?.entries.map((entry) => entry.text) ?? []);
    }
    case "implementation_brief":
      return [
        "Refresh after the primary target, trust state, or active diagnostic changes.",
      ];
    case "impact_packet":
      return [
        "Refresh after the direct impact surface or adjacent diagnostics change.",
      ];
    case "precedent_pack":
      return [
        "Refresh after finding a stronger reusable precedent or shared helper path.",
      ];
  }
}

function firstSectionEntryText(
  packet: WorkflowPacket,
  kind: string,
): string | undefined {
  return packet.sections.find((section) => section.kind === kind)?.entries[0]?.text;
}

function buildVerificationPlanHandoff(
  packet: WorkflowVerificationPlanPacket,
): WorkflowPacketHandoff | undefined {
  const current =
    firstSectionEntryText(packet, "verification") ??
    firstSectionEntryText(packet, "baseline");
  const stopWhen = firstSectionEntryText(packet, "done_criteria");
  const refreshWhen = firstSectionEntryText(packet, "rerun_triggers");

  if (!current || !stopWhen) {
    return undefined;
  }

  return {
    current,
    stopWhen,
    ...(refreshWhen ? { refreshWhen } : {}),
  };
}

function buildWorkflowRecipeHandoff(
  packet: WorkflowRecipePacket,
): WorkflowPacketHandoff | undefined {
  const activeStep = packet.payload.steps.find((step) => step.status === "in_progress");
  if (!activeStep || activeStep.stopConditions.length === 0) {
    return undefined;
  }

  return {
    current: activeStep.title,
    stopWhen: activeStep.stopConditions[0],
    ...(activeStep.rerunTriggers[0] ? { refreshWhen: activeStep.rerunTriggers[0] } : {}),
  };
}

function buildWorkflowPacketHandoff(
  packet: WorkflowPacket,
): WorkflowPacketHandoff | undefined {
  switch (packet.family) {
    case "verification_plan":
      return buildVerificationPlanHandoff(packet);
    case "workflow_recipe":
      return buildWorkflowRecipeHandoff(packet);
    case "implementation_brief":
    case "impact_packet":
    case "precedent_pack":
      return undefined;
  }
}

export function buildWorkflowPacketSurface(
  packet: WorkflowPacket,
  options: {
    refreshReason?: WorkflowPacketRefreshReason;
    stablePacketId?: string;
    attachmentReason?: string;
    attachmentDecision?: WorkflowPacketAttachmentDecision;
  } = {},
): WorkflowPacketSurface {
  const refreshReason =
    options.refreshReason ??
    (packet.basis.watchMode === "watch" ? "initial" : "manual");
  const handoff = buildWorkflowPacketHandoff(packet);

  return {
    packet,
    rendered: formatWorkflowPacket(packet),
    surfacePlan: buildWorkflowPacketSurfacePlan(packet.family),
    watch: {
      mode: packet.basis.watchMode,
      stablePacketId: options.stablePacketId ?? packet.packetId,
      refreshReason,
      refreshTriggers: defaultRefreshTriggers(packet),
    },
    ...(handoff ? { handoff } : {}),
    ...(options.attachmentReason ? { attachmentReason: options.attachmentReason } : {}),
    ...(options.attachmentDecision ? { attachmentDecision: options.attachmentDecision } : {}),
  };
}
