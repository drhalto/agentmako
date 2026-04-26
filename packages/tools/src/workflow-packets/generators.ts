import type {
  AnswerResult,
  WorkflowContextBundle,
  WorkflowPacketFamily,
  WorkflowPacketForFamily,
  WorkflowPacketGenerator,
  WorkflowPacketInput,
  WorkflowPacketRequest,
} from "@mako-ai/contracts";
import {
  buildWorkflowPacketInput,
} from "../workflow-context/index.js";
import { WorkflowPacketRegistry } from "./index.js";
import { buildImplementationBriefPacket } from "./generator-implementation-brief.js";
import { buildPrecedentPack } from "./generator-precedent-pack.js";
import {
  buildImpactPacket,
  buildVerificationPlanPacket,
  buildWorkflowRecipePacket,
} from "./generator-workflow-guides.js";

export function createImplementationBriefGenerator(): WorkflowPacketGenerator<"implementation_brief"> {
  return {
    family: "implementation_brief",
    generate(input) {
      return buildImplementationBriefPacket(input);
    },
  };
}

export function createPrecedentPackGenerator(): WorkflowPacketGenerator<"precedent_pack"> {
  return {
    family: "precedent_pack",
    generate(input) {
      return buildPrecedentPack(input);
    },
  };
}

export function createImpactPacketGenerator(): WorkflowPacketGenerator<"impact_packet"> {
  return {
    family: "impact_packet",
    generate(input) {
      return buildImpactPacket(input);
    },
  };
}

export function createVerificationPlanGenerator(): WorkflowPacketGenerator<"verification_plan"> {
  return {
    family: "verification_plan",
    generate(input) {
      return buildVerificationPlanPacket(input);
    },
  };
}

export function createWorkflowRecipeGenerator(): WorkflowPacketGenerator<"workflow_recipe"> {
  return {
    family: "workflow_recipe",
    generate(input) {
      return buildWorkflowRecipePacket(input);
    },
  };
}

export function createBuiltinWorkflowPacketRegistry(): WorkflowPacketRegistry {
  return new WorkflowPacketRegistry([
    createImplementationBriefGenerator(),
    createImpactPacketGenerator(),
    createPrecedentPackGenerator(),
    createVerificationPlanGenerator(),
    createWorkflowRecipeGenerator(),
  ]);
}

export async function generateWorkflowPacket<
  TFamily extends WorkflowPacketFamily,
>(
  source: AnswerResult | WorkflowContextBundle,
  request: WorkflowPacketRequest & { family: TFamily },
): Promise<WorkflowPacketForFamily<TFamily>> {
  const registry = createBuiltinWorkflowPacketRegistry();
  const input = buildWorkflowPacketInput(source, request);
  return registry.generate(input as WorkflowPacketInput & { family: TFamily });
}
