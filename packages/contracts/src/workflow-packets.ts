import type { AnswerTrustState, QueryKind } from "./answer.js";
import type { EvidenceStatus, JsonObject, SupportLevel } from "./common.js";
import type { WorkflowPacketFamily, WorkflowPacketInput } from "./workflow-context.js";

export type WorkflowPacketSectionKind =
  | "summary"
  | "findings"
  | "gaps"
  | "baseline"
  | "change_areas"
  | "invariants"
  | "precedents"
  | "impact"
  | "verification"
  | "done_criteria"
  | "rerun_triggers"
  | "risks"
  | "assumptions"
  | "open_questions"
  | "steps";

export interface WorkflowPacketCitation {
  citationId: string;
  itemId: string;
  sourceRef: string | null;
  excerpt: string | null;
  rationale: string | null;
}

export interface WorkflowPacketEntry {
  entryId: string;
  text: string;
  citationIds: string[];
  metadata?: JsonObject;
}

export interface WorkflowPacketSection {
  sectionId: string;
  kind: WorkflowPacketSectionKind;
  title: string;
  entries: WorkflowPacketEntry[];
}

export interface WorkflowPacketBasis {
  scope: WorkflowPacketInput["scope"];
  watchMode: WorkflowPacketInput["watchMode"];
  selectedItemIds: string[];
  focusedItemIds: string[];
  primaryItemIds: string[];
  supportingItemIds: string[];
}

export interface WorkflowImplementationBriefPayload {
  summarySectionId: string;
  changeAreasSectionId: string | null;
  invariantsSectionId: string | null;
  risksSectionId: string | null;
  verificationSectionId: string | null;
}

export interface WorkflowPrecedentPackPayload {
  summarySectionId: string;
  precedentsSectionId: string | null;
  gapsSectionId: string | null;
  canonicalPrecedentItemIds: string[];
  secondaryPrecedentItemIds: string[];
  referencePrecedentItemIds: string[];
}

export interface WorkflowImpactPacketPayload {
  summarySectionId: string;
  impactSectionId: string | null;
  risksSectionId: string | null;
  directImpactItemIds: string[];
  adjacentImpactItemIds: string[];
  uncertainImpactItemIds: string[];
}

export interface WorkflowVerificationPlanPayload {
  summarySectionId: string;
  baselineSectionId: string | null;
  verificationSectionId: string | null;
  doneCriteriaSectionId: string | null;
  rerunTriggerSectionId: string | null;
}

export type WorkflowRecipeStepStatus = "todo" | "in_progress" | "done";

export interface WorkflowRecipeStep {
  stepId: string;
  title: string;
  status: WorkflowRecipeStepStatus;
  verification: string[];
  stopConditions: string[];
  rerunTriggers: string[];
}

export interface WorkflowRecipePayload {
  summarySectionId: string;
  stepSectionId: string | null;
  steps: WorkflowRecipeStep[];
}

export interface WorkflowPacketBase<
  TFamily extends WorkflowPacketFamily,
  TPayload,
> {
  packetId: string;
  family: TFamily;
  title: string;
  queryId: string;
  projectId: string;
  basis: WorkflowPacketBasis;
  sections: WorkflowPacketSection[];
  citations: WorkflowPacketCitation[];
  assumptions: string[];
  openQuestions: string[];
  payload: TPayload;
  metadata?: JsonObject;
}

export type WorkflowImplementationBriefPacket = WorkflowPacketBase<
  "implementation_brief",
  WorkflowImplementationBriefPayload
>;

export type WorkflowImpactPacket = WorkflowPacketBase<
  "impact_packet",
  WorkflowImpactPacketPayload
>;

export type WorkflowPrecedentPack = WorkflowPacketBase<
  "precedent_pack",
  WorkflowPrecedentPackPayload
>;

export type WorkflowVerificationPlanPacket = WorkflowPacketBase<
  "verification_plan",
  WorkflowVerificationPlanPayload
>;

export type WorkflowRecipePacket = WorkflowPacketBase<
  "workflow_recipe",
  WorkflowRecipePayload
>;

export type WorkflowPacketGenerateSurface = "tool";
export type WorkflowPacketGuidedSurface = "prompt";
export type WorkflowPacketReusableSurface = "resource";
export type WorkflowPacketRefreshReason = "initial" | "manual" | "watch_refresh";

export interface WorkflowPacketSurfacePlan {
  generateWith: WorkflowPacketGenerateSurface;
  guidedConsumption: WorkflowPacketGuidedSurface | null;
  reusableContext: WorkflowPacketReusableSurface | null;
}

export interface WorkflowPacketWatchState {
  mode: WorkflowPacketInput["watchMode"];
  stablePacketId: string;
  refreshReason: WorkflowPacketRefreshReason;
  refreshTriggers: string[];
}

export interface WorkflowPacketHandoff {
  current: string;
  stopWhen: string;
  refreshWhen?: string;
}

export interface WorkflowPacketAttachmentTrigger {
  queryKind: QueryKind;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  trustState: AnswerTrustState | null;
}

export interface WorkflowPacketAttachmentDecision {
  family: WorkflowPacketFamily;
  trigger: WorkflowPacketAttachmentTrigger;
}

export interface WorkflowPacketFollowupOrigin {
  originQueryId: string;
  originActionId: string;
  originPacketId: string | null;
  originPacketFamily: WorkflowPacketFamily;
  originQueryKind: QueryKind;
}

export type WorkflowPacket =
  | WorkflowImplementationBriefPacket
  | WorkflowImpactPacket
  | WorkflowPrecedentPack
  | WorkflowVerificationPlanPacket
  | WorkflowRecipePacket;

export interface WorkflowPacketSurface {
  packet: WorkflowPacket;
  rendered: string;
  surfacePlan: WorkflowPacketSurfacePlan;
  watch: WorkflowPacketWatchState;
  handoff?: WorkflowPacketHandoff;
  attachmentReason?: string;
  attachmentDecision?: WorkflowPacketAttachmentDecision;
}

export type WorkflowPacketForFamily<TFamily extends WorkflowPacketFamily> =
  TFamily extends "implementation_brief"
    ? WorkflowImplementationBriefPacket
    : TFamily extends "impact_packet"
      ? WorkflowImpactPacket
      : TFamily extends "precedent_pack"
        ? WorkflowPrecedentPack
        : TFamily extends "verification_plan"
          ? WorkflowVerificationPlanPacket
          : TFamily extends "workflow_recipe"
            ? WorkflowRecipePacket
            : never;

export interface WorkflowPacketGenerator<
  TFamily extends WorkflowPacketFamily = WorkflowPacketFamily,
> {
  family: TFamily;
  generate(
    input: WorkflowPacketInput,
  ): WorkflowPacketForFamily<TFamily> | Promise<WorkflowPacketForFamily<TFamily>>;
}
