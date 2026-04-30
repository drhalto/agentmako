import { z } from "zod";
import type {
  WorkflowContextBundle,
  WorkflowContextItem,
  WorkflowContextItemKind,
  WorkflowPacketInput,
  WorkflowPacketRequest,
  WorkflowReferencePrecedentInput,
  WorkflowReferenceSearchKind,
} from "./workflow-context.js";
import type {
  WorkflowPacketAttachmentDecision,
  WorkflowPacketAttachmentTrigger,
  WorkflowPacketFollowupOrigin,
  WorkflowImpactPacket,
  WorkflowImpactPacketPayload,
  WorkflowImplementationBriefPacket,
  WorkflowImplementationBriefPayload,
  WorkflowPacket,
  WorkflowPacketBasis,
  WorkflowPacketCitation,
  WorkflowPacketEntry,
  WorkflowPacketHandoff,
  WorkflowPacketRefreshReason,
  WorkflowPacketSection,
  WorkflowPacketSectionKind,
  WorkflowPacketSurface,
  WorkflowPacketSurfacePlan,
  WorkflowPacketWatchState,
  WorkflowPrecedentPack,
  WorkflowPrecedentPackPayload,
  WorkflowRecipePacket,
  WorkflowRecipePayload,
  WorkflowRecipeStep,
  WorkflowRecipeStepStatus,
  WorkflowVerificationPlanPacket,
  WorkflowVerificationPlanPayload,
} from "./workflow-packets.js";
import type { QueryKind } from "./answer.js";
import type { JsonObject } from "./common.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import {
  AnswerComparisonChangeSchema,
  AnswerSurfaceIssueCategorySchema,
  AnswerSurfaceIssueConfidenceSchema,
  AnswerSurfaceIssueSeveritySchema,
  AnswerTrustFacetSchema,
  AnswerTrustReasonCodeSchema,
  AnswerTrustScopeRelationSchema,
  AnswerTrustStateSchema,
  ContextLayoutZoneSchema,
  EvidenceStatusSchema,
  JsonObjectSchema,
  QueryKindSchema,
  SupportLevelSchema,
} from "./tool-schema-shared.js";
import {
  ProjectLocatorInputObjectSchema,
} from "./tool-project-locator.js";

export const WorkflowContextItemSourceSchema = z.enum([
  "answer_result",
  "evidence",
  "reference_repo",
  "trust",
  "diagnostic",
  "comparison",
]);

export const WorkflowContextItemKindSchema = z.enum([
  "answer_packet",
  "file",
  "symbol",
  "route",
  "rpc",
  "table",
  "reference_precedent",
  "diagnostic",
  "trust_evaluation",
  "comparison",
]) satisfies z.ZodType<WorkflowContextItemKind>;

export const WorkflowReferenceSearchKindSchema = z.enum([
  "ref_ask",
  "ref_search",
  "ref_file",
]) satisfies z.ZodType<WorkflowReferenceSearchKind>;

export const WorkflowReferencePrecedentInputSchema = z.object({
  repoName: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: z.string().min(1),
  searchKind: WorkflowReferenceSearchKindSchema,
  score: z.number().nullable().optional(),
  vecRank: z.number().int().positive().nullable().optional(),
  ftsRank: z.number().int().positive().nullable().optional(),
}) satisfies z.ZodType<WorkflowReferencePrecedentInput>;

const WorkflowContextItemBaseSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  projectId: z.string().min(1),
  queryId: z.string().min(1),
  source: WorkflowContextItemSourceSchema,
  sourceRefs: z.array(z.string().min(1)),
  metadata: JsonObjectSchema.optional(),
});

const WorkflowAnswerPacketContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("answer_packet"),
  data: z.object({
    queryKind: QueryKindSchema,
    queryText: z.string().min(1),
    supportLevel: SupportLevelSchema,
    evidenceStatus: EvidenceStatusSchema,
    evidenceConfidence: z.number(),
    answerConfidence: z.number().nullable(),
    stalenessFlags: z.array(z.string().min(1)),
    candidateActionIds: z.array(z.string().min(1)),
    rankingDeEmphasized: z.boolean().nullable(),
    rankingReasonCodes: z.array(z.string().min(1)),
  }),
});

const WorkflowFileContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("file"),
  data: z.object({
    filePath: z.string().min(1),
    line: z.number().int().positive().nullable(),
  }),
});

const WorkflowSymbolContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("symbol"),
  data: z.object({
    symbolName: z.string().min(1),
    filePath: z.string().min(1).nullable(),
    line: z.number().int().positive().nullable(),
    exportName: z.string().min(1).nullable(),
  }),
});

const WorkflowRouteContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("route"),
  data: z.object({
    routeKey: z.string().min(1),
    pattern: z.string().min(1),
    method: z.string().min(1).nullable(),
    filePath: z.string().min(1).nullable(),
    handlerName: z.string().min(1).nullable(),
    isApi: z.boolean().nullable(),
  }),
});

const WorkflowRpcContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("rpc"),
  data: z.object({
    schemaName: z.string().min(1).nullable(),
    rpcName: z.string().min(1),
    argTypes: z.array(z.string().min(1)),
  }),
});

const WorkflowTableContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("table"),
  data: z.object({
    schemaName: z.string().min(1).nullable(),
    tableName: z.string().min(1),
  }),
});

const WorkflowReferencePrecedentContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("reference_precedent"),
  data: WorkflowReferencePrecedentInputSchema,
});

const WorkflowDiagnosticContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("diagnostic"),
  data: z.object({
    code: z.string().min(1),
    category: AnswerSurfaceIssueCategorySchema,
    severity: AnswerSurfaceIssueSeveritySchema,
    confidence: AnswerSurfaceIssueConfidenceSchema,
    path: z.string().min(1).nullable(),
    producerPath: z.string().min(1).nullable(),
    consumerPath: z.string().min(1).nullable(),
    line: z.number().int().positive().nullable(),
  }),
});

const WorkflowTrustEvaluationContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("trust_evaluation"),
  data: z.object({
    state: AnswerTrustStateSchema,
    reasonCodes: z.array(AnswerTrustReasonCodeSchema),
    scopeRelation: AnswerTrustScopeRelationSchema,
    basisTraceIds: z.array(z.string().min(1)),
    conflictingFacets: z.array(AnswerTrustFacetSchema),
    comparisonId: z.string().min(1).nullable(),
    clusterId: z.string().min(1).nullable(),
  }),
});

const WorkflowComparisonContextItemSchema = WorkflowContextItemBaseSchema.extend({
  kind: z.literal("comparison"),
  data: z.object({
    comparisonId: z.string().min(1).nullable(),
    summaryChanges: z.array(AnswerComparisonChangeSchema),
  }),
});

export const WorkflowContextItemSchema = z.discriminatedUnion("kind", [
  WorkflowAnswerPacketContextItemSchema,
  WorkflowFileContextItemSchema,
  WorkflowSymbolContextItemSchema,
  WorkflowRouteContextItemSchema,
  WorkflowRpcContextItemSchema,
  WorkflowTableContextItemSchema,
  WorkflowReferencePrecedentContextItemSchema,
  WorkflowDiagnosticContextItemSchema,
  WorkflowTrustEvaluationContextItemSchema,
  WorkflowComparisonContextItemSchema,
]) satisfies z.ZodType<WorkflowContextItem>;

export const WorkflowContextBundleSchema = z.object({
  queryId: z.string().min(1),
  projectId: z.string().min(1),
  items: z.array(WorkflowContextItemSchema),
  primaryItemIds: z.array(z.string().min(1)),
  supportingItemIds: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowContextBundle>;

export const WorkflowPacketFamilySchema = z.enum([
  "implementation_brief",
  "impact_packet",
  "precedent_pack",
  "verification_plan",
  "workflow_recipe",
]);

export const WorkflowPacketScopeSchema = z.enum(["primary", "all"]);
export const WorkflowPacketWatchModeSchema = z.enum(["off", "watch"]);

export const WorkflowPacketRequestSchema = z.object({
  family: WorkflowPacketFamilySchema,
  scope: WorkflowPacketScopeSchema.optional(),
  focusItemIds: z.array(z.string().min(1)).optional(),
  focusKinds: z.array(WorkflowContextItemKindSchema).optional(),
  referencePrecedents: z.array(WorkflowReferencePrecedentInputSchema).optional(),
  watchMode: WorkflowPacketWatchModeSchema.optional(),
}) satisfies z.ZodType<WorkflowPacketRequest>;

export const WorkflowPacketInputSchema = z.object({
  family: WorkflowPacketFamilySchema,
  queryId: z.string().min(1),
  projectId: z.string().min(1),
  scope: WorkflowPacketScopeSchema,
  watchMode: WorkflowPacketWatchModeSchema,
  selectedItems: z.array(WorkflowContextItemSchema),
  selectedItemIds: z.array(z.string().min(1)),
  primaryItemIds: z.array(z.string().min(1)),
  supportingItemIds: z.array(z.string().min(1)),
  focusedItemIds: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowPacketInput>;

export const WorkflowPacketSectionKindSchema = z.enum([
  "summary",
  "findings",
  "gaps",
  "baseline",
  "change_areas",
  "invariants",
  "precedents",
  "impact",
  "verification",
  "done_criteria",
  "rerun_triggers",
  "risks",
  "assumptions",
  "open_questions",
  "steps",
]) satisfies z.ZodType<WorkflowPacketSectionKind>;

export const WorkflowPacketCitationSchema = z.object({
  citationId: z.string().min(1),
  itemId: z.string().min(1),
  sourceRef: z.string().min(1).nullable(),
  excerpt: z.string().min(1).nullable(),
  rationale: z.string().min(1).nullable(),
}) satisfies z.ZodType<WorkflowPacketCitation>;

export const WorkflowPacketEntrySchema = z.object({
  entryId: z.string().min(1),
  text: z.string().min(1),
  citationIds: z.array(z.string().min(1)),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<WorkflowPacketEntry>;

export const WorkflowPacketSectionSchema = z.object({
  sectionId: z.string().min(1),
  kind: WorkflowPacketSectionKindSchema,
  title: z.string().min(1),
  layoutZone: ContextLayoutZoneSchema.optional(),
  entries: z.array(WorkflowPacketEntrySchema),
}) satisfies z.ZodType<WorkflowPacketSection>;

export const WorkflowPacketBasisSchema = z.object({
  scope: WorkflowPacketScopeSchema,
  watchMode: WorkflowPacketWatchModeSchema,
  selectedItemIds: z.array(z.string().min(1)),
  focusedItemIds: z.array(z.string().min(1)),
  primaryItemIds: z.array(z.string().min(1)),
  supportingItemIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowPacketBasis>;

export const WorkflowImplementationBriefPayloadSchema = z.object({
  summarySectionId: z.string().min(1),
  changeAreasSectionId: z.string().min(1).nullable(),
  invariantsSectionId: z.string().min(1).nullable(),
  risksSectionId: z.string().min(1).nullable(),
  verificationSectionId: z.string().min(1).nullable(),
}) satisfies z.ZodType<WorkflowImplementationBriefPayload>;

export const WorkflowPrecedentPackPayloadSchema = z.object({
  summarySectionId: z.string().min(1),
  precedentsSectionId: z.string().min(1).nullable(),
  gapsSectionId: z.string().min(1).nullable(),
  canonicalPrecedentItemIds: z.array(z.string().min(1)),
  secondaryPrecedentItemIds: z.array(z.string().min(1)),
  referencePrecedentItemIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowPrecedentPackPayload>;

export const WorkflowImpactPacketPayloadSchema = z.object({
  summarySectionId: z.string().min(1),
  impactSectionId: z.string().min(1).nullable(),
  risksSectionId: z.string().min(1).nullable(),
  directImpactItemIds: z.array(z.string().min(1)),
  adjacentImpactItemIds: z.array(z.string().min(1)),
  uncertainImpactItemIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowImpactPacketPayload>;

export const WorkflowVerificationPlanPayloadSchema = z.object({
  summarySectionId: z.string().min(1),
  baselineSectionId: z.string().min(1).nullable(),
  verificationSectionId: z.string().min(1).nullable(),
  doneCriteriaSectionId: z.string().min(1).nullable(),
  rerunTriggerSectionId: z.string().min(1).nullable(),
}) satisfies z.ZodType<WorkflowVerificationPlanPayload>;

export const WorkflowRecipeStepStatusSchema = z.enum([
  "todo",
  "in_progress",
  "done",
]) satisfies z.ZodType<WorkflowRecipeStepStatus>;

export const WorkflowRecipeStepSchema = z.object({
  stepId: z.string().min(1),
  title: z.string().min(1),
  status: WorkflowRecipeStepStatusSchema,
  verification: z.array(z.string().min(1)),
  stopConditions: z.array(z.string().min(1)),
  rerunTriggers: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowRecipeStep>;

export const WorkflowRecipePayloadSchema = z.object({
  summarySectionId: z.string().min(1),
  stepSectionId: z.string().min(1).nullable(),
  steps: z.array(WorkflowRecipeStepSchema),
}) satisfies z.ZodType<WorkflowRecipePayload>;

const WorkflowPacketBaseSchema = z.object({
  packetId: z.string().min(1),
  title: z.string().min(1),
  queryId: z.string().min(1),
  projectId: z.string().min(1),
  basis: WorkflowPacketBasisSchema,
  sections: z.array(WorkflowPacketSectionSchema),
  citations: z.array(WorkflowPacketCitationSchema),
  assumptions: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  metadata: JsonObjectSchema.optional(),
});

export const WorkflowImplementationBriefPacketSchema = WorkflowPacketBaseSchema.extend({
  family: z.literal("implementation_brief"),
  payload: WorkflowImplementationBriefPayloadSchema,
}) satisfies z.ZodType<WorkflowImplementationBriefPacket>;

export const WorkflowImpactPacketSchema = WorkflowPacketBaseSchema.extend({
  family: z.literal("impact_packet"),
  payload: WorkflowImpactPacketPayloadSchema,
}) satisfies z.ZodType<WorkflowImpactPacket>;

export const WorkflowPrecedentPackSchema = WorkflowPacketBaseSchema.extend({
  family: z.literal("precedent_pack"),
  payload: WorkflowPrecedentPackPayloadSchema,
}) satisfies z.ZodType<WorkflowPrecedentPack>;

export const WorkflowVerificationPlanPacketSchema = WorkflowPacketBaseSchema.extend({
  family: z.literal("verification_plan"),
  payload: WorkflowVerificationPlanPayloadSchema,
}) satisfies z.ZodType<WorkflowVerificationPlanPacket>;

export const WorkflowRecipePacketSchema = WorkflowPacketBaseSchema.extend({
  family: z.literal("workflow_recipe"),
  payload: WorkflowRecipePayloadSchema,
}) satisfies z.ZodType<WorkflowRecipePacket>;

export const WorkflowPacketSchema = z.discriminatedUnion("family", [
  WorkflowImplementationBriefPacketSchema,
  WorkflowImpactPacketSchema,
  WorkflowPrecedentPackSchema,
  WorkflowVerificationPlanPacketSchema,
  WorkflowRecipePacketSchema,
]) satisfies z.ZodType<WorkflowPacket>;

export const WorkflowPacketRefreshReasonSchema = z.enum([
  "initial",
  "manual",
  "watch_refresh",
]) satisfies z.ZodType<WorkflowPacketRefreshReason>;

export const WorkflowPacketSurfacePlanSchema = z.object({
  generateWith: z.literal("tool"),
  guidedConsumption: z.literal("prompt").nullable(),
  reusableContext: z.literal("resource").nullable(),
}) satisfies z.ZodType<WorkflowPacketSurfacePlan>;

export const WorkflowPacketWatchStateSchema = z.object({
  mode: WorkflowPacketWatchModeSchema,
  stablePacketId: z.string().min(1),
  refreshReason: WorkflowPacketRefreshReasonSchema,
  refreshTriggers: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkflowPacketWatchState>;

export const WorkflowPacketHandoffSchema = z.object({
  current: z.string().min(1),
  stopWhen: z.string().min(1),
  refreshWhen: z.string().min(1).optional(),
}) satisfies z.ZodType<WorkflowPacketHandoff>;

export const WorkflowPacketAttachmentTriggerSchema = z.object({
  queryKind: QueryKindSchema,
  supportLevel: SupportLevelSchema,
  evidenceStatus: EvidenceStatusSchema,
  trustState: AnswerTrustStateSchema.nullable(),
}) satisfies z.ZodType<WorkflowPacketAttachmentTrigger>;

export const WorkflowPacketAttachmentDecisionSchema = z.object({
  family: WorkflowPacketFamilySchema,
  trigger: WorkflowPacketAttachmentTriggerSchema,
}) satisfies z.ZodType<WorkflowPacketAttachmentDecision>;

export const WorkflowPacketFollowupOriginSchema = z.object({
  originQueryId: z.string().min(1),
  originActionId: z.string().min(1),
  originPacketId: z.string().min(1).nullable(),
  originPacketFamily: WorkflowPacketFamilySchema,
  originQueryKind: QueryKindSchema,
}) satisfies z.ZodType<WorkflowPacketFollowupOrigin>;

export const WorkflowPacketSurfaceSchema = z.object({
  packet: WorkflowPacketSchema,
  rendered: z.string().min(1),
  surfacePlan: WorkflowPacketSurfacePlanSchema,
  watch: WorkflowPacketWatchStateSchema,
  handoff: WorkflowPacketHandoffSchema.optional(),
  attachmentReason: z.string().min(1).optional(),
  attachmentDecision: WorkflowPacketAttachmentDecisionSchema.optional(),
}) satisfies z.ZodType<WorkflowPacketSurface>;

export interface WorkflowPacketToolInput extends Partial<ProjectLocatorInput>, WorkflowPacketRequest {
  queryKind: QueryKind;
  queryText: string;
  queryArgs?: JsonObject;
  followup?: WorkflowPacketFollowupOrigin;
  refreshReason?: WorkflowPacketRefreshReason;
}

export const WorkflowPacketToolInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    projectRef: z.string().trim().min(1).optional(),
    family: WorkflowPacketFamilySchema,
    queryKind: QueryKindSchema,
    queryText: z.string().trim().min(1),
    queryArgs: JsonObjectSchema.optional(),
    followup: WorkflowPacketFollowupOriginSchema.optional(),
    scope: WorkflowPacketScopeSchema.optional(),
    focusItemIds: z.array(z.string().trim().min(1)).optional(),
    focusKinds: z.array(WorkflowContextItemKindSchema).optional(),
    referencePrecedents: z.array(WorkflowReferencePrecedentInputSchema).optional(),
    watchMode: WorkflowPacketWatchModeSchema.optional(),
    refreshReason: WorkflowPacketRefreshReasonSchema.optional(),
  })
  .strict() satisfies z.ZodType<WorkflowPacketToolInput>;

export interface WorkflowPacketToolOutput {
  toolName: "workflow_packet";
  projectId: string;
  result: WorkflowPacketSurface;
}

export const WorkflowPacketToolOutputSchema = z.object({
  toolName: z.literal("workflow_packet"),
  projectId: z.string().min(1),
  result: WorkflowPacketSurfaceSchema,
}) satisfies z.ZodType<WorkflowPacketToolOutput>;
