import { z } from "zod";
import type { AnswerResult } from "./answer.js";
import type {
  WorkflowPacketSurface,
} from "./workflow-packets.js";
import {
  IndexFreshnessDetailSchema,
  IndexFreshnessSummarySchema,
} from "./index-freshness.js";
import {
  AnswerComparisonChangeCodeSchema,
  AnswerComparisonChangeSchema,
  AnswerSurfaceIssueCategorySchema,
  AnswerSurfaceIssueConfidenceSchema,
  AnswerSurfaceIssueSeveritySchema,
  AnswerTrustFacetSchema,
  AnswerTrustReasonCodeSchema,
  AnswerTrustReasonSchema,
  AnswerTrustScopeRelationSchema,
  AnswerTrustStateSchema,
  ContextLayoutZoneSchema,
  EvidenceStatusSchema,
  JsonObjectSchema,
  QueryKindSchema,
  ReasoningTierSchema,
  SupportLevelSchema,
  TimestampSchema,
} from "./tool-schema-shared.js";

export {
  AnswerComparisonChangeCodeSchema,
  AnswerComparisonChangeSchema,
  AnswerSurfaceIssueCategorySchema,
  AnswerSurfaceIssueConfidenceSchema,
  AnswerSurfaceIssueSeveritySchema,
  AnswerTrustFacetSchema,
  AnswerTrustReasonCodeSchema,
  AnswerTrustReasonSchema,
  AnswerTrustScopeRelationSchema,
  AnswerTrustStateSchema,
  EvidenceStatusSchema,
  JsonObjectSchema,
  QueryKindSchema,
  ReasoningTierSchema,
  SupportLevelSchema,
  TimestampSchema,
} from "./tool-schema-shared.js";

export const EvidenceBlockSchema = z.object({
  blockId: z.string().min(1),
  kind: z.enum(["file", "symbol", "route", "schema", "finding", "trace", "document"]),
  title: z.string().min(1),
  sourceRef: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  content: z.string(),
  layoutZone: ContextLayoutZoneSchema.optional(),
  score: z.number().optional(),
  stale: z.boolean().optional(),
  freshness: IndexFreshnessDetailSchema.optional(),
  metadata: JsonObjectSchema.optional(),
});

export const CandidateActionSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  safeToAutomate: z.boolean(),
  execute: z
    .object({
      toolName: z.string().min(1),
      input: JsonObjectSchema,
    })
    .optional(),
});

export const AnswerSurfaceIssueIdentitySchema = z.object({
  matchBasedId: z.string().min(1),
  codeHash: z.string().min(1),
  patternHash: z.string().min(1),
});

export const AnswerSurfaceIssueSchema = z.object({
  severity: AnswerSurfaceIssueSeveritySchema,
  confidence: AnswerSurfaceIssueConfidenceSchema,
  category: AnswerSurfaceIssueCategorySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  producerPath: z.string().min(1).optional(),
  consumerPath: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)),
  identity: AnswerSurfaceIssueIdentitySchema,
  metadata: JsonObjectSchema.optional(),
});

export const AnswerTrustSurfaceSchema = z.object({
  state: AnswerTrustStateSchema,
  reasons: z.array(AnswerTrustReasonSchema),
  basisTraceIds: z.array(z.string().min(1)),
  conflictingFacets: z.array(AnswerTrustFacetSchema),
  scopeRelation: AnswerTrustScopeRelationSchema,
  comparisonId: z.string().min(1).optional(),
  clusterId: z.string().min(1).optional(),
  comparisonSummary: z.array(AnswerComparisonChangeSchema),
  issues: z.array(AnswerSurfaceIssueSchema),
});

export const AnswerRankingSurfaceSchema = z.object({
  orderKey: z.number(),
  deEmphasized: z.boolean(),
  reasons: z.array(AnswerSurfaceIssueSchema),
});

const CompanionWorkflowPacketSurfaceSchema: z.ZodType<WorkflowPacketSurface> = z.lazy(
  () => z.any(),
);

export const AnswerPacketSchema = z.object({
  queryId: z.string().min(1),
  projectId: z.string().min(1),
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  tierUsed: ReasoningTierSchema,
  supportLevel: SupportLevelSchema,
  evidenceStatus: EvidenceStatusSchema,
  evidenceConfidence: z.number(),
  missingInformation: z.array(z.string()),
  stalenessFlags: z.array(z.string()),
  indexFreshness: IndexFreshnessSummarySchema.optional(),
  evidence: z.array(EvidenceBlockSchema),
  generatedAt: TimestampSchema,
});

export const AnswerResultSchema = z.object({
  queryId: z.string().min(1),
  projectId: z.string().min(1),
  queryKind: QueryKindSchema,
  tierUsed: ReasoningTierSchema,
  supportLevel: SupportLevelSchema,
  evidenceStatus: EvidenceStatusSchema,
  answer: z.string().optional(),
  answerConfidence: z.number().optional(),
  packet: AnswerPacketSchema,
  candidateActions: z.array(CandidateActionSchema),
  noSynthesis: z.boolean().optional(),
  trust: AnswerTrustSurfaceSchema.optional(),
  diagnostics: z.array(AnswerSurfaceIssueSchema).optional(),
  ranking: AnswerRankingSurfaceSchema.optional(),
  companionPacket: CompanionWorkflowPacketSurfaceSchema.optional(),
}) satisfies z.ZodType<AnswerResult>;
