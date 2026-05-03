import { z } from "zod";
import {
  FactFreshnessSchema,
  DbReviewCommentCategorySchema,
  DbReviewCommentSchema,
  DbReviewObjectTypeSchema,
  DbReviewTargetSchema,
  ProjectFactSchema,
  ProjectFindingSchema,
  ProjectFindingStatusSchema,
  ProjectOverlaySchema,
  ReefDiagnosticRunSchema,
  ReefEvidenceGraphSchema,
  ReefDiagnosticRunStatusSchema,
  ReefSeveritySchema,
  ReefRuleDescriptorSchema,
  type FactFreshness,
  type DbReviewComment,
  type DbReviewCommentCategory,
  type DbReviewObjectType,
  type DbReviewTarget,
  type ProjectFact,
  type ProjectFinding,
  type ProjectFindingStatus,
  type ProjectOverlay,
  type ReefDiagnosticRun,
  type ReefEvidenceGraph,
  type ReefDiagnosticRunStatus,
  type ReefSeverity,
  type ReefRuleDescriptor,
} from "./reef.js";
import {
  ReefProjectSchemaStatusSchema,
  type ReefProjectSchemaStatus,
} from "./reef-service.js";
import {
  ReefFreshnessPolicySchema,
  ProjectIndexWatchStateSchema,
  type ReefFreshnessPolicy,
  type ProjectIndexWatchState,
} from "./index-freshness.js";
import {
  ReefToolExecutionSchema,
  type ReefToolExecution,
} from "./tool-reef-execution-schemas.js";
import {
  FindingAckSchema,
  type FindingAck,
} from "./finding-acks.js";
import type { JsonObject } from "./common.js";
import {
  AnswerSurfaceIssueCategorySchema,
  AnswerSurfaceIssueConfidenceSchema,
  AnswerSurfaceIssueSeveritySchema,
  JsonObjectSchema,
} from "./tool-schema-shared.js";
import {
  ContextPacketDatabaseObjectSchema,
  ContextPacketIntentSchema,
  ContextPacketInstructionSchema,
  ContextPacketReadableCandidateSchema,
  ContextPacketRiskSchema,
  ContextPacketRouteSchema,
  ContextPacketSymbolSchema,
  type ContextPacketDatabaseObject,
  type ContextPacketIntent,
  type ContextPacketInstruction,
  type ContextPacketReadableCandidate,
  type ContextPacketRisk,
  type ContextPacketRoute,
  type ContextPacketSymbol,
} from "./tool-context-packet-schemas.js";
import {
  LiveTextSearchMatchSchema,
  type LiveTextSearchMatch,
} from "./tool-live-text-search-schemas.js";
import {
  RouteContextToolOutputSchema,
  RpcNeighborhoodToolOutputSchema,
  TableNeighborhoodToolOutputSchema,
  type RouteContextToolOutput,
  type RpcNeighborhoodToolOutput,
  type TableNeighborhoodToolOutput,
} from "./tool-neighborhood-schemas.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

export interface ProjectFindingsToolInput extends ProjectLocatorInput {
  overlay?: ProjectOverlay;
  source?: string;
  status?: ProjectFindingStatus;
  includeResolved?: boolean;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const ProjectFindingsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  status: ProjectFindingStatusSchema.optional(),
  includeResolved: z.boolean().optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ProjectFindingsToolInput>;

export interface ProjectFindingsToolOutput {
  toolName: "project_findings";
  projectId: string;
  projectRoot: string;
  findings: ProjectFinding[];
  totalReturned: number;
  reefExecution: ReefToolExecution;
  filters: {
    overlay?: ProjectOverlay;
    source?: string;
    status?: ProjectFindingStatus;
    includeResolved: boolean;
  };
  warnings: string[];
}

export const ProjectFindingsToolOutputSchema = z.object({
  toolName: z.literal("project_findings"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  findings: z.array(ProjectFindingSchema),
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    overlay: ProjectOverlaySchema.optional(),
    source: z.string().min(1).optional(),
    status: ProjectFindingStatusSchema.optional(),
    includeResolved: z.boolean(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectFindingsToolOutput>;

export interface FileFindingsToolInput extends ProjectLocatorInput {
  filePath: string;
  overlay?: ProjectOverlay;
  source?: string;
  status?: ProjectFindingStatus;
  includeResolved?: boolean;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const FileFindingsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  status: ProjectFindingStatusSchema.optional(),
  includeResolved: z.boolean().optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<FileFindingsToolInput>;

export interface FileFindingsToolOutput {
  toolName: "file_findings";
  projectId: string;
  projectRoot: string;
  filePath: string;
  findings: ProjectFinding[];
  totalReturned: number;
  reefExecution: ReefToolExecution;
  filters: {
    overlay?: ProjectOverlay;
    source?: string;
    status?: ProjectFindingStatus;
    includeResolved: boolean;
  };
  warnings: string[];
}

export const FileFindingsToolOutputSchema = z.object({
  toolName: z.literal("file_findings"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1),
  findings: z.array(ProjectFindingSchema),
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    overlay: ProjectOverlaySchema.optional(),
    source: z.string().min(1).optional(),
    status: ProjectFindingStatusSchema.optional(),
    includeResolved: z.boolean(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<FileFindingsToolOutput>;

export interface ProjectFactsToolInput extends ProjectLocatorInput {
  overlay?: ProjectOverlay;
  source?: string;
  kind?: string;
  subjectFingerprint?: string;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const ProjectFactsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ProjectFactsToolInput>;

export interface ProjectFactsToolOutput {
  toolName: "project_facts";
  projectId: string;
  projectRoot: string;
  facts: ProjectFact[];
  totalReturned: number;
  reefExecution: ReefToolExecution;
  filters: {
    overlay?: ProjectOverlay;
    source?: string;
    kind?: string;
    subjectFingerprint?: string;
  };
  warnings: string[];
}

export const ProjectFactsToolOutputSchema = z.object({
  toolName: z.literal("project_facts"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  facts: z.array(ProjectFactSchema),
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    overlay: ProjectOverlaySchema.optional(),
    source: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    subjectFingerprint: z.string().min(1).optional(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectFactsToolOutput>;

export interface FileFactsToolInput extends ProjectLocatorInput {
  filePath: string;
  overlay?: ProjectOverlay;
  source?: string;
  kind?: string;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const FileFactsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<FileFactsToolInput>;

export interface FileFactsToolOutput {
  toolName: "file_facts";
  projectId: string;
  projectRoot: string;
  filePath: string;
  facts: ProjectFact[];
  totalReturned: number;
  reefExecution: ReefToolExecution;
  filters: {
    overlay?: ProjectOverlay;
    source?: string;
    kind?: string;
  };
  warnings: string[];
}

export const FileFactsToolOutputSchema = z.object({
  toolName: z.literal("file_facts"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1),
  facts: z.array(ProjectFactSchema),
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    overlay: ProjectOverlaySchema.optional(),
    source: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<FileFactsToolOutput>;

export interface WorkingTreeOverlaySkippedFile {
  filePath: string;
  reason: string;
}

export const WorkingTreeOverlaySkippedFileSchema = z.object({
  filePath: z.string().min(1),
  reason: z.string().min(1),
}) satisfies z.ZodType<WorkingTreeOverlaySkippedFile>;

export interface WorkingTreeOverlayToolInput extends ProjectLocatorInput {
  files?: string[];
  includeUnindexed?: boolean;
  maxFiles?: number;
}

export const WorkingTreeOverlayToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().min(1)).min(1).max(500).optional(),
  includeUnindexed: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<WorkingTreeOverlayToolInput>;

export interface WorkingTreeOverlayToolOutput {
  toolName: "working_tree_overlay";
  projectId: string;
  projectRoot: string;
  facts: ProjectFact[];
  scannedFiles: string[];
  deletedFiles: string[];
  skippedFiles: WorkingTreeOverlaySkippedFile[];
  warnings: string[];
}

export const WorkingTreeOverlayToolOutputSchema = z.object({
  toolName: z.literal("working_tree_overlay"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  facts: z.array(ProjectFactSchema),
  scannedFiles: z.array(z.string().min(1)),
  deletedFiles: z.array(z.string().min(1)),
  skippedFiles: z.array(WorkingTreeOverlaySkippedFileSchema),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<WorkingTreeOverlayToolOutput>;

export const ReefOverlayDiffStatusSchema = z.enum([
  "same",
  "changed",
  "only_left",
  "only_right",
]);
export type ReefOverlayDiffStatus = z.infer<typeof ReefOverlayDiffStatusSchema>;

export interface ReefOverlayDiffToolInput extends ProjectLocatorInput {
  leftOverlay?: ProjectOverlay;
  rightOverlay?: ProjectOverlay;
  filePath?: string;
  kind?: string;
  source?: string;
  includeEqual?: boolean;
  includeFacts?: boolean;
  limit?: number;
}

export const ReefOverlayDiffToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  leftOverlay: ProjectOverlaySchema.optional(),
  rightOverlay: ProjectOverlaySchema.optional(),
  filePath: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  includeEqual: z.boolean().optional(),
  includeFacts: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).strict() satisfies z.ZodType<ReefOverlayDiffToolInput>;

export interface ReefOverlayDiffEntry {
  key: string;
  kind: string;
  subjectFingerprint: string;
  filePath?: string;
  leftOverlay: ProjectOverlay;
  rightOverlay: ProjectOverlay;
  status: ReefOverlayDiffStatus;
  leftSource?: string;
  rightSource?: string;
  changedDataKeys: string[];
  leftFact?: ProjectFact;
  rightFact?: ProjectFact;
}

export const ReefOverlayDiffEntrySchema = z.object({
  key: z.string().min(1),
  kind: z.string().min(1),
  subjectFingerprint: z.string().min(1),
  filePath: z.string().min(1).optional(),
  leftOverlay: ProjectOverlaySchema,
  rightOverlay: ProjectOverlaySchema,
  status: ReefOverlayDiffStatusSchema,
  leftSource: z.string().min(1).optional(),
  rightSource: z.string().min(1).optional(),
  changedDataKeys: z.array(z.string().min(1)),
  leftFact: ProjectFactSchema.optional(),
  rightFact: ProjectFactSchema.optional(),
}) satisfies z.ZodType<ReefOverlayDiffEntry>;

export interface ReefOverlayDiffToolOutput {
  toolName: "reef_overlay_diff";
  projectId: string;
  projectRoot: string;
  leftOverlay: ProjectOverlay;
  rightOverlay: ProjectOverlay;
  entries: ReefOverlayDiffEntry[];
  summary: {
    comparedKeys: number;
    same: number;
    changed: number;
    onlyLeft: number;
    onlyRight: number;
    returnedEntries: number;
    truncated: boolean;
  };
  warnings: string[];
}

export const ReefOverlayDiffToolOutputSchema = z.object({
  toolName: z.literal("reef_overlay_diff"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  leftOverlay: ProjectOverlaySchema,
  rightOverlay: ProjectOverlaySchema,
  entries: z.array(ReefOverlayDiffEntrySchema),
  summary: z.object({
    comparedKeys: z.number().int().nonnegative(),
    same: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    onlyLeft: z.number().int().nonnegative(),
    onlyRight: z.number().int().nonnegative(),
    returnedEntries: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefOverlayDiffToolOutput>;

export interface ListReefRulesToolInput extends ProjectLocatorInput {
  sourceNamespace?: string;
  enabledOnly?: boolean;
  limit?: number;
}

export const ListReefRulesToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  sourceNamespace: z.string().min(1).optional(),
  enabledOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ListReefRulesToolInput>;

export interface ListReefRulesToolOutput {
  toolName: "list_reef_rules";
  projectId: string;
  projectRoot: string;
  rules: ReefRuleDescriptor[];
  totalReturned: number;
  filters: {
    sourceNamespace?: string;
    enabledOnly: boolean;
  };
  warnings: string[];
}

export const ListReefRulesToolOutputSchema = z.object({
  toolName: z.literal("list_reef_rules"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  rules: z.array(ReefRuleDescriptorSchema),
  totalReturned: z.number().int().nonnegative(),
  filters: z.object({
    sourceNamespace: z.string().min(1).optional(),
    enabledOnly: z.boolean(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ListReefRulesToolOutput>;

export interface ProjectDiagnosticRunsToolInput extends ProjectLocatorInput {
  source?: string;
  status?: ReefDiagnosticRunStatus;
  limit?: number;
  cacheStalenessMs?: number;
}

export const ProjectDiagnosticRunsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  source: z.string().min(1).optional(),
  status: ReefDiagnosticRunStatusSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cacheStalenessMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
}) satisfies z.ZodType<ProjectDiagnosticRunsToolInput>;

export interface ProjectDiagnosticRunsToolOutput {
  toolName: "project_diagnostic_runs";
  projectId: string;
  projectRoot: string;
  runs: ReefDiagnosticRun[];
  totalReturned: number;
  filters: {
    source?: string;
    status?: ReefDiagnosticRunStatus;
    cacheStalenessMs: number;
  };
  warnings: string[];
}

export const ProjectDiagnosticRunsToolOutputSchema = z.object({
  toolName: z.literal("project_diagnostic_runs"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  runs: z.array(ReefDiagnosticRunSchema),
  totalReturned: z.number().int().nonnegative(),
  filters: z.object({
    source: z.string().min(1).optional(),
    status: ReefDiagnosticRunStatusSchema.optional(),
    cacheStalenessMs: z.number().int().positive(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectDiagnosticRunsToolOutput>;

export interface ReefInstructionsToolInput extends ProjectLocatorInput {
  files?: string[];
  includeDerivedFacts?: boolean;
}

export const ReefInstructionsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  includeDerivedFacts: z.boolean().optional(),
}).strict() satisfies z.ZodType<ReefInstructionsToolInput>;

export interface ReefInstructionsToolOutput {
  toolName: "reef_instructions";
  projectId: string;
  projectRoot: string;
  files: string[];
  instructions: ContextPacketInstruction[];
  derivedFacts: ProjectFact[];
  summary: {
    instructionCount: number;
    derivedFactCount: number;
  };
  warnings: string[];
}

export const ReefInstructionsToolOutputSchema = z.object({
  toolName: z.literal("reef_instructions"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  files: z.array(z.string().min(1)),
  instructions: z.array(ContextPacketInstructionSchema),
  derivedFacts: z.array(ProjectFactSchema),
  summary: z.object({
    instructionCount: z.number().int().nonnegative(),
    derivedFactCount: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefInstructionsToolOutput>;

export interface RulePackValidationPack {
  path: string;
  name?: string;
  valid: boolean;
  ruleCount: number;
  errorText?: string;
}

export const RulePackValidationPackSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  valid: z.boolean(),
  ruleCount: z.number().int().nonnegative(),
  errorText: z.string().min(1).optional(),
}) satisfies z.ZodType<RulePackValidationPack>;

export interface RulePackValidationCrossFile {
  kind: "canonical_helper";
  symbol: string;
  path?: string;
  mode: "absent_in_consumer";
}

export const RulePackValidationCrossFileSchema = z.object({
  kind: z.literal("canonical_helper"),
  symbol: z.string().min(1),
  path: z.string().min(1).optional(),
  mode: z.literal("absent_in_consumer"),
}) satisfies z.ZodType<RulePackValidationCrossFile>;

export interface RulePackValidationRule {
  id: string;
  sourcePath: string;
  category: z.infer<typeof AnswerSurfaceIssueCategorySchema>;
  severity: z.infer<typeof AnswerSurfaceIssueSeveritySchema>;
  confidence: z.infer<typeof AnswerSurfaceIssueConfidenceSchema>;
  languages?: string[];
  patternCount: number;
  message: string;
  crossFile?: RulePackValidationCrossFile;
  descriptor?: ReefRuleDescriptor;
}

export const RulePackValidationRuleSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  category: AnswerSurfaceIssueCategorySchema,
  severity: AnswerSurfaceIssueSeveritySchema,
  confidence: AnswerSurfaceIssueConfidenceSchema,
  languages: z.array(z.string().min(1)).optional(),
  patternCount: z.number().int().nonnegative(),
  message: z.string().min(1),
  crossFile: RulePackValidationCrossFileSchema.optional(),
  descriptor: ReefRuleDescriptorSchema.optional(),
}) satisfies z.ZodType<RulePackValidationRule>;

export interface RulePackValidateToolInput extends ProjectLocatorInput {
  includeDescriptors?: boolean;
}

export const RulePackValidateToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  includeDescriptors: z.boolean().optional(),
}).strict() satisfies z.ZodType<RulePackValidateToolInput>;

export interface RulePackValidateToolOutput {
  toolName: "rule_pack_validate";
  projectId: string;
  projectRoot: string;
  packs: RulePackValidationPack[];
  rules: RulePackValidationRule[];
  summary: {
    packCount: number;
    validPackCount: number;
    invalidPackCount: number;
    ruleCount: number;
  };
  warnings: string[];
}

export const RulePackValidateToolOutputSchema = z.object({
  toolName: z.literal("rule_pack_validate"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  packs: z.array(RulePackValidationPackSchema),
  rules: z.array(RulePackValidationRuleSchema),
  summary: z.object({
    packCount: z.number().int().nonnegative(),
    validPackCount: z.number().int().nonnegative(),
    invalidPackCount: z.number().int().nonnegative(),
    ruleCount: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<RulePackValidateToolOutput>;

export interface ExtractRuleTemplateToolInput extends ProjectLocatorInput {
  fixCommit: string;
  baseCommit?: string;
  filePath?: string;
  ruleIdPrefix?: string;
  maxTemplates?: number;
  includeRelatedFindings?: boolean;
}

export const ExtractRuleTemplateToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  fixCommit: z.string().trim().min(1),
  baseCommit: z.string().trim().min(1).optional(),
  filePath: z.string().min(1).optional(),
  ruleIdPrefix: z.string().trim().min(1).optional(),
  maxTemplates: z.number().int().min(1).max(20).optional(),
  includeRelatedFindings: z.boolean().optional(),
}).strict() satisfies z.ZodType<ExtractRuleTemplateToolInput>;

export const ExtractRuleTemplateLanguageSchema = z.enum(["ts", "tsx", "js", "jsx"]);
export type ExtractRuleTemplateLanguage = z.infer<typeof ExtractRuleTemplateLanguageSchema>;

export interface ExtractedRuleTemplate {
  ruleId: string;
  sourceFile: string;
  language: ExtractRuleTemplateLanguage;
  patterns: string[];
  category: z.infer<typeof AnswerSurfaceIssueCategorySchema>;
  severity: z.infer<typeof AnswerSurfaceIssueSeveritySchema>;
  confidence: z.infer<typeof AnswerSurfaceIssueConfidenceSchema>;
  message: string;
  beforeSnippet: string;
  afterSnippet?: string;
  rationale: string;
  caveats: string[];
  relatedFindings: ProjectFinding[];
}

export const ExtractedRuleTemplateSchema = z.object({
  ruleId: z.string().min(1),
  sourceFile: z.string().min(1),
  language: ExtractRuleTemplateLanguageSchema,
  patterns: z.array(z.string().min(1)).nonempty(),
  category: AnswerSurfaceIssueCategorySchema,
  severity: AnswerSurfaceIssueSeveritySchema,
  confidence: AnswerSurfaceIssueConfidenceSchema,
  message: z.string().min(1),
  beforeSnippet: z.string().min(1),
  afterSnippet: z.string().min(1).optional(),
  rationale: z.string().min(1),
  caveats: z.array(z.string().min(1)),
  relatedFindings: z.array(ProjectFindingSchema),
}) satisfies z.ZodType<ExtractedRuleTemplate>;

export interface ExtractRuleTemplateToolOutput {
  toolName: "extract_rule_template";
  projectId: string;
  projectRoot: string;
  fixCommit: string;
  baseCommit: string;
  templates: ExtractedRuleTemplate[];
  draftYaml: string;
  suggestedPath: string;
  summary: {
    changedFileCount: number;
    hunkCount: number;
    templateCount: number;
  };
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const ExtractRuleTemplateToolOutputSchema = z.object({
  toolName: z.literal("extract_rule_template"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  fixCommit: z.string().min(1),
  baseCommit: z.string().min(1),
  templates: z.array(ExtractedRuleTemplateSchema),
  draftYaml: z.string(),
  suggestedPath: z.string().min(1),
  summary: z.object({
    changedFileCount: z.number().int().nonnegative(),
    hunkCount: z.number().int().nonnegative(),
    templateCount: z.number().int().nonnegative(),
  }),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ExtractRuleTemplateToolOutput>;

export const ReefLearningReviewModeSchema = z.enum(["suggest"]);
export type ReefLearningReviewMode = z.infer<typeof ReefLearningReviewModeSchema>;

export const ReefLearningSuggestionKindSchema = z.enum([
  "rule_pack_template",
  "sentinel_rule",
  "instruction_patch",
  "project_convention_candidate",
  "conjecture",
  "session_recall_note",
]);
export type ReefLearningSuggestionKind = z.infer<typeof ReefLearningSuggestionKindSchema>;

export const ReefLearningSuggestionStatusSchema = z.enum(["proposed"]);
export type ReefLearningSuggestionStatus = z.infer<typeof ReefLearningSuggestionStatusSchema>;

export interface ReefLearningSuggestionDraft {
  path?: string;
  content?: string;
  patch?: string;
}

export const ReefLearningSuggestionDraftSchema = z.object({
  path: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  patch: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefLearningSuggestionDraft>;

export interface ReefLearningSuggestionTarget {
  filePath?: string;
  ruleId?: string;
  findingFingerprint?: string;
  toolRunId?: string;
  requestId?: string;
}

export const ReefLearningSuggestionTargetSchema = z.object({
  filePath: z.string().min(1).optional(),
  ruleId: z.string().min(1).optional(),
  findingFingerprint: z.string().min(1).optional(),
  toolRunId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefLearningSuggestionTarget>;

export interface ReefLearningSuggestion {
  id: string;
  kind: ReefLearningSuggestionKind;
  status: ReefLearningSuggestionStatus;
  title: string;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
  sourceSignals: string[];
  suggestedAction: string;
  target?: ReefLearningSuggestionTarget;
  draft?: ReefLearningSuggestionDraft;
  metadata?: JsonObject;
}

export const ReefLearningSuggestionSchema = z.object({
  id: z.string().min(1),
  kind: ReefLearningSuggestionKindSchema,
  status: ReefLearningSuggestionStatusSchema,
  title: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  sourceSignals: z.array(z.string().min(1)),
  suggestedAction: z.string().min(1),
  target: ReefLearningSuggestionTargetSchema.optional(),
  draft: ReefLearningSuggestionDraftSchema.optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefLearningSuggestion>;

export interface ReefLearningReviewToolInput extends ProjectLocatorInput {
  changedFiles?: string[];
  resolvedFindingIds?: string[];
  recentToolRunIds?: string[];
  since?: string;
  mode?: ReefLearningReviewMode;
  includeLowConfidence?: boolean;
  limit?: number;
}

export const ReefLearningReviewToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  changedFiles: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  resolvedFindingIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  recentToolRunIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  since: z.string().min(1).optional(),
  mode: ReefLearningReviewModeSchema.optional(),
  includeLowConfidence: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict() satisfies z.ZodType<ReefLearningReviewToolInput>;

export interface ReefLearningReviewToolOutput {
  toolName: "reef_learning_review";
  projectId: string;
  projectRoot: string;
  mode: ReefLearningReviewMode;
  suggestions: ReefLearningSuggestion[];
  summary: {
    changedFileCount: number;
    resolvedFindingCount: number;
    repeatedRuleCount: number;
    recentToolRunCount: number;
    feedbackSignalCount: number;
    suggestionCount: number;
  };
  guardrails: string[];
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const ReefLearningReviewToolOutputSchema = z.object({
  toolName: z.literal("reef_learning_review"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  mode: ReefLearningReviewModeSchema,
  suggestions: z.array(ReefLearningSuggestionSchema),
  summary: z.object({
    changedFileCount: z.number().int().nonnegative(),
    resolvedFindingCount: z.number().int().nonnegative(),
    repeatedRuleCount: z.number().int().nonnegative(),
    recentToolRunCount: z.number().int().nonnegative(),
    feedbackSignalCount: z.number().int().nonnegative(),
    suggestionCount: z.number().int().nonnegative(),
  }),
  guardrails: z.array(z.string().min(1)),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefLearningReviewToolOutput>;

export const DiagnosticRefreshSourceSchema = z.enum([
  "lint_files",
  "typescript_syntax",
  "typescript",
  "eslint",
  "oxlint",
  "biome",
  "git_precommit_check",
  "programmatic_findings",
]);
export type DiagnosticRefreshSource = z.infer<typeof DiagnosticRefreshSourceSchema>;

export const DiagnosticRefreshRunStatusSchema = z.union([
  ReefDiagnosticRunStatusSchema,
  z.literal("skipped"),
]);
export type DiagnosticRefreshRunStatus = ReefDiagnosticRunStatus | "skipped";

export interface DiagnosticRefreshScripts {
  eslint?: string;
  oxlint?: string;
  biome?: string;
}

export const DiagnosticRefreshScriptsSchema = z.object({
  eslint: z.string().trim().min(1).optional(),
  oxlint: z.string().trim().min(1).optional(),
  biome: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<DiagnosticRefreshScripts>;

export interface DiagnosticRefreshToolInput extends ProjectLocatorInput {
  sources?: DiagnosticRefreshSource[];
  files?: string[];
  maxFindings?: number;
  tsconfigPath?: string;
  scripts?: DiagnosticRefreshScripts;
  continueOnError?: boolean;
  includeFindings?: boolean;
}

export const DiagnosticRefreshToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  sources: z.array(DiagnosticRefreshSourceSchema).min(1).max(8).optional(),
  files: z.array(z.string().trim().min(1)).min(1).max(200).optional(),
  maxFindings: z.number().int().positive().max(1000).optional(),
  tsconfigPath: z.string().trim().min(1).optional(),
  scripts: DiagnosticRefreshScriptsSchema.optional(),
  continueOnError: z.boolean().optional(),
  includeFindings: z.boolean().optional(),
}).strict() satisfies z.ZodType<DiagnosticRefreshToolInput>;

export interface DiagnosticRefreshResult {
  source: DiagnosticRefreshSource;
  toolName: string;
  status: DiagnosticRefreshRunStatus;
  durationMs: number;
  checkedFileCount: number;
  totalFindings: number;
  persistedFindings: number;
  warnings: string[];
  errorText?: string;
  skippedReason?: string;
}

export const DiagnosticRefreshResultSchema = z.object({
  source: DiagnosticRefreshSourceSchema,
  toolName: z.string().min(1),
  status: DiagnosticRefreshRunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  checkedFileCount: z.number().int().nonnegative(),
  totalFindings: z.number().int().nonnegative(),
  persistedFindings: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)),
  errorText: z.string().min(1).optional(),
  skippedReason: z.string().min(1).optional(),
}) satisfies z.ZodType<DiagnosticRefreshResult>;

export interface DiagnosticRefreshToolOutput {
  toolName: "diagnostic_refresh";
  projectId: string;
  projectRoot: string;
  results: DiagnosticRefreshResult[];
  findings?: ProjectFinding[];
  summary: {
    requestedSources: number;
    executedSources: number;
    skippedSources: number;
    succeededSources: number;
    failedSources: number;
    unavailableSources: number;
    totalFindings: number;
    persistedFindings: number;
    durationMs: number;
  };
  warnings: string[];
}

export const DiagnosticRefreshToolOutputSchema = z.object({
  toolName: z.literal("diagnostic_refresh"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  results: z.array(DiagnosticRefreshResultSchema),
  findings: z.array(ProjectFindingSchema).optional(),
  summary: z.object({
    requestedSources: z.number().int().nonnegative(),
    executedSources: z.number().int().nonnegative(),
    skippedSources: z.number().int().nonnegative(),
    succeededSources: z.number().int().nonnegative(),
    failedSources: z.number().int().nonnegative(),
    unavailableSources: z.number().int().nonnegative(),
    totalFindings: z.number().int().nonnegative(),
    persistedFindings: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<DiagnosticRefreshToolOutput>;

export interface DbReefRefreshToolInput extends ProjectLocatorInput {
  includeAppUsage?: boolean;
  includeFacts?: boolean;
  factsLimit?: number;
  freshen?: boolean;
}

export const DbReefRefreshToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  includeAppUsage: z.boolean().optional(),
  includeFacts: z.boolean().optional(),
  factsLimit: z.number().int().min(1).max(500).optional(),
  freshen: z.boolean().optional(),
}).strict() satisfies z.ZodType<DbReefRefreshToolInput>;

export interface DbReefRefreshToolOutput {
  toolName: "db_reef_refresh";
  projectId: string;
  projectRoot: string;
  facts?: ProjectFact[];
  factsTruncated?: boolean;
  schemaFreshness: ReefProjectSchemaStatus;
  summary: {
    factCount: number;
    byKind: Record<string, number>;
    schemaCount: number;
    tableCount: number;
    viewCount: number;
    enumCount: number;
    rpcCount: number;
    columnCount: number;
    indexCount: number;
    foreignKeyCount: number;
    rlsPolicyCount: number;
    triggerCount: number;
    functionTableRefCount: number;
    appUsageCount: number;
  };
  warnings: string[];
}

export const DbReefRefreshToolOutputSchema = z.object({
  toolName: z.literal("db_reef_refresh"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  facts: z.array(ProjectFactSchema).optional(),
  factsTruncated: z.boolean().optional(),
  schemaFreshness: ReefProjectSchemaStatusSchema,
  summary: z.object({
    factCount: z.number().int().nonnegative(),
    byKind: z.record(z.number().int().nonnegative()),
    schemaCount: z.number().int().nonnegative(),
    tableCount: z.number().int().nonnegative(),
    viewCount: z.number().int().nonnegative(),
    enumCount: z.number().int().nonnegative(),
    rpcCount: z.number().int().nonnegative(),
    columnCount: z.number().int().nonnegative(),
    indexCount: z.number().int().nonnegative(),
    foreignKeyCount: z.number().int().nonnegative(),
    rlsPolicyCount: z.number().int().nonnegative(),
    triggerCount: z.number().int().nonnegative(),
    functionTableRefCount: z.number().int().nonnegative(),
    appUsageCount: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<DbReefRefreshToolOutput>;

export interface DbReviewCommentToolInput extends ProjectLocatorInput {
  preview?: boolean;
  objectType: DbReviewObjectType;
  objectName: string;
  schemaName?: string;
  parentObjectName?: string;
  category?: DbReviewCommentCategory;
  severity?: ReefSeverity;
  comment: string;
  tags?: string[];
  createdBy?: string;
  metadata?: JsonObject;
}

export const DbReviewCommentToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  preview: z.boolean().optional(),
  objectType: DbReviewObjectTypeSchema,
  objectName: z.string().trim().min(1).max(256),
  schemaName: z.string().trim().min(1).max(128).optional(),
  parentObjectName: z.string().trim().min(1).max(256).optional(),
  category: DbReviewCommentCategorySchema.optional(),
  severity: ReefSeveritySchema.optional(),
  comment: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  createdBy: z.string().trim().min(1).max(128).optional(),
  metadata: JsonObjectSchema.optional(),
}).strict() satisfies z.ZodType<DbReviewCommentToolInput>;

export interface DbReviewCommentPreview {
  target: DbReviewTarget;
  targetFingerprint: string;
  category: DbReviewCommentCategory;
  severity?: ReefSeverity;
  comment: string;
  tags: string[];
  createdBy: string;
  sourceToolName: "db_review_comment";
  metadata?: JsonObject;
}

export const DbReviewCommentPreviewSchema = z.object({
  target: DbReviewTargetSchema,
  targetFingerprint: z.string().min(1),
  category: DbReviewCommentCategorySchema,
  severity: ReefSeveritySchema.optional(),
  comment: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  createdBy: z.string().trim().min(1),
  sourceToolName: z.literal("db_review_comment"),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<DbReviewCommentPreview>;

export interface DbReviewCommentToolOutput {
  toolName: "db_review_comment";
  projectId: string;
  projectRoot: string;
  preview: boolean;
  comment?: DbReviewComment;
  wouldApply?: DbReviewCommentPreview;
  warnings: string[];
}

export const DbReviewCommentToolOutputSchema = z.object({
  toolName: z.literal("db_review_comment"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  preview: z.boolean(),
  comment: DbReviewCommentSchema.optional(),
  wouldApply: DbReviewCommentPreviewSchema.optional(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<DbReviewCommentToolOutput>;

export interface DbReviewCommentsToolInput extends ProjectLocatorInput {
  objectType?: DbReviewObjectType;
  objectName?: string;
  schemaName?: string;
  parentObjectName?: string;
  targetFingerprint?: string;
  category?: DbReviewCommentCategory;
  tag?: string;
  query?: string;
  limit?: number;
}

export const DbReviewCommentsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  objectType: DbReviewObjectTypeSchema.optional(),
  objectName: z.string().trim().min(1).max(256).optional(),
  schemaName: z.string().trim().min(1).max(128).optional(),
  parentObjectName: z.string().trim().min(1).max(256).optional(),
  targetFingerprint: z.string().trim().min(1).optional(),
  category: DbReviewCommentCategorySchema.optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  query: z.string().trim().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict() satisfies z.ZodType<DbReviewCommentsToolInput>;

export interface DbReviewCommentsToolOutput {
  toolName: "db_review_comments";
  projectId: string;
  projectRoot: string;
  comments: DbReviewComment[];
  totalReturned: number;
  filters: {
    target?: DbReviewTarget;
    targetFingerprint?: string;
    category?: DbReviewCommentCategory;
    tag?: string;
    query?: string;
  };
  warnings: string[];
}

export const DbReviewCommentsToolOutputSchema = z.object({
  toolName: z.literal("db_review_comments"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  comments: z.array(DbReviewCommentSchema),
  totalReturned: z.number().int().nonnegative(),
  filters: z.object({
    target: DbReviewTargetSchema.optional(),
    targetFingerprint: z.string().min(1).optional(),
    category: DbReviewCommentCategorySchema.optional(),
    tag: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<DbReviewCommentsToolOutput>;

export const ReefCandidateKindSchema = z.enum([
  "file",
  "fact",
  "finding",
  "rule",
  "diagnostic_run",
  "open_loop",
  "convention",
  "evidence_conflict",
]);
export type ReefCandidateKind = z.infer<typeof ReefCandidateKindSchema>;

export const ReefEvidenceConfidenceLabelSchema = z.enum([
  "verified_live",
  "fresh_indexed",
  "stale_indexed",
  "fuzzy_semantic",
  "historical",
  "contradicted",
  "unknown",
]);
export type ReefEvidenceConfidenceLabel = z.infer<typeof ReefEvidenceConfidenceLabelSchema>;

export interface ReefCandidate {
  id: string;
  kind: ReefCandidateKind;
  title: string;
  filePath?: string;
  subjectFingerprint?: string;
  source: string;
  overlay?: ProjectOverlay;
  score: number;
  confidence: number;
  confidenceLabel?: ReefEvidenceConfidenceLabel;
  freshness?: FactFreshness;
  whyIncluded: string;
  suggestedActions?: string[];
  metadata?: JsonObject;
}

export const ReefCandidateSchema = z.object({
  id: z.string().min(1),
  kind: ReefCandidateKindSchema,
  title: z.string().min(1),
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  confidenceLabel: ReefEvidenceConfidenceLabelSchema.optional(),
  freshness: FactFreshnessSchema.optional(),
  whyIncluded: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)).optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefCandidate>;

export interface ReefScoutToolInput extends ProjectLocatorInput {
  query: string;
  focusFiles?: string[];
  limit?: number;
  includeRawEvidence?: boolean;
}

export const ReefScoutToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  query: z.string().trim().min(1),
  focusFiles: z.array(z.string().min(1)).min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  includeRawEvidence: z.boolean().optional(),
}) satisfies z.ZodType<ReefScoutToolInput>;

export interface ReefScoutToolOutput {
  toolName: "reef_scout";
  projectId: string;
  projectRoot: string;
  query: string;
  candidates: ReefCandidate[];
  facts?: ProjectFact[];
  findings?: ProjectFinding[];
  reefExecution: ReefToolExecution;
  suggestedActions: string[];
  warnings: string[];
}

export const ReefScoutToolOutputSchema = z.object({
  toolName: z.literal("reef_scout"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  query: z.string().min(1),
  candidates: z.array(ReefCandidateSchema),
  facts: z.array(ProjectFactSchema).optional(),
  findings: z.array(ProjectFindingSchema).optional(),
  reefExecution: ReefToolExecutionSchema,
  suggestedActions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefScoutToolOutput>;

export interface ReefInspectToolInput extends ProjectLocatorInput {
  filePath?: string;
  subjectFingerprint?: string;
  limit?: number;
}

export const ReefInspectToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<ReefInspectToolInput>;

export interface ReefInspectToolOutput {
  toolName: "reef_inspect";
  projectId: string;
  projectRoot: string;
  filePath?: string;
  subjectFingerprint?: string;
  facts: ProjectFact[];
  findings: ProjectFinding[];
  diagnosticRuns: ReefDiagnosticRun[];
  summary: {
    factCount: number;
    findingCount: number;
    activeFindingCount: number;
    staleFactCount: number;
  };
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const ReefInspectToolOutputSchema = z.object({
  toolName: z.literal("reef_inspect"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  facts: z.array(ProjectFactSchema),
  findings: z.array(ProjectFindingSchema),
  diagnosticRuns: z.array(ReefDiagnosticRunSchema),
  summary: z.object({
    factCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    activeFindingCount: z.number().int().nonnegative(),
    staleFactCount: z.number().int().nonnegative(),
  }),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefInspectToolOutput>;

export const ReefStructuralTargetKindSchema = z.enum(["symbol", "file", "route", "component", "pattern"]);
export type ReefStructuralTargetKind = z.infer<typeof ReefStructuralTargetKindSchema>;

export interface ReefWhereUsedToolInput extends ProjectLocatorInput {
  query: string;
  targetKind?: ReefStructuralTargetKind;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const ReefWhereUsedToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  query: z.string().trim().min(1),
  targetKind: ReefStructuralTargetKindSchema.optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<ReefWhereUsedToolInput>;

export interface ReefStructuralDefinition {
  filePath: string;
  name: string;
  kind: string;
  source: "symbol_index" | "route_index" | "file_index";
  lineStart?: number;
  lineEnd?: number;
  metadata?: JsonObject;
}

export const ReefStructuralDefinitionSchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  source: z.enum(["symbol_index", "route_index", "file_index"]),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefStructuralDefinition>;

export interface ReefStructuralUsage {
  filePath: string;
  usageKind: "import" | "dependent" | "route_owner" | "definition" | "text_reference";
  targetPath?: string;
  specifier?: string;
  line?: number;
  reason: string;
  provenance: {
    source: "maintained_reef_state";
    producer: string;
    revision?: number;
  };
}

export const ReefStructuralUsageSchema = z.object({
  filePath: z.string().min(1),
  usageKind: z.enum(["import", "dependent", "route_owner", "definition", "text_reference"]),
  targetPath: z.string().min(1).optional(),
  specifier: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  reason: z.string().min(1),
  provenance: z.object({
    source: z.literal("maintained_reef_state"),
    producer: z.string().min(1),
    revision: z.number().int().nonnegative().optional(),
  }),
}) satisfies z.ZodType<ReefStructuralUsage>;

export interface ReefWhereUsedFallbackTool {
  tool: "ast_find_pattern" | "live_text_search" | "cross_search";
  reason: string;
  args: JsonObject;
}

export const ReefWhereUsedFallbackToolSchema = z.object({
  tool: z.enum(["ast_find_pattern", "live_text_search", "cross_search"]),
  reason: z.string().min(1),
  args: JsonObjectSchema,
}) satisfies z.ZodType<ReefWhereUsedFallbackTool>;

export interface ReefWhereUsedCoverage {
  directUsageSources: Array<"definitions" | "import_edges" | "indexed_identifier_text">;
  relatedSignalSources: Array<"project_findings">;
  limitations: string[];
  fallbackTools: ReefWhereUsedFallbackTool[];
}

export const ReefWhereUsedCoverageSchema = z.object({
  directUsageSources: z.array(z.enum(["definitions", "import_edges", "indexed_identifier_text"])),
  relatedSignalSources: z.array(z.enum(["project_findings"])),
  limitations: z.array(z.string().min(1)),
  fallbackTools: z.array(ReefWhereUsedFallbackToolSchema),
}) satisfies z.ZodType<ReefWhereUsedCoverage>;

export interface ReefWhereUsedToolOutput {
  toolName: "reef_where_used";
  projectId: string;
  projectRoot: string;
  query: string;
  targetKind?: ReefStructuralTargetKind;
  definitions: ReefStructuralDefinition[];
  usages: ReefStructuralUsage[];
  relatedFindings: ProjectFinding[];
  coverage: ReefWhereUsedCoverage;
  totalReturned: number;
  reefExecution: ReefToolExecution;
  fallbackRecommendation?: string;
  warnings: string[];
}

export const ReefWhereUsedToolOutputSchema = z.object({
  toolName: z.literal("reef_where_used"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  query: z.string().min(1),
  targetKind: ReefStructuralTargetKindSchema.optional(),
  definitions: z.array(ReefStructuralDefinitionSchema),
  usages: z.array(ReefStructuralUsageSchema),
  relatedFindings: z.array(ProjectFindingSchema),
  coverage: ReefWhereUsedCoverageSchema,
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  fallbackRecommendation: z.string().min(1).optional(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefWhereUsedToolOutput>;

export const ReefOpenLoopKindSchema = z.enum([
  "active_finding",
  "stale_fact",
  "unknown_fact",
  "stale_diagnostic_run",
  "failed_diagnostic_run",
  "unverified_change",
]);
export type ReefOpenLoopKind = z.infer<typeof ReefOpenLoopKindSchema>;

export interface ReefOpenLoop {
  id: string;
  kind: ReefOpenLoopKind;
  severity: ReefSeverity;
  title: string;
  filePath?: string;
  subjectFingerprint?: string;
  source: string;
  reason: string;
  suggestedActions: string[];
  metadata?: JsonObject;
}

export const ReefOpenLoopSchema = z.object({
  id: z.string().min(1),
  kind: ReefOpenLoopKindSchema,
  severity: ReefSeveritySchema,
  title: z.string().min(1),
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  source: z.string().min(1),
  reason: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefOpenLoop>;

export interface ProjectOpenLoopsToolInput extends ProjectLocatorInput {
  filePath?: string;
  includeAcknowledged?: boolean;
  limit?: number;
  cacheStalenessMs?: number;
}

export const ProjectOpenLoopsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1).optional(),
  includeAcknowledged: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cacheStalenessMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
}) satisfies z.ZodType<ProjectOpenLoopsToolInput>;

export interface ProjectOpenLoopsToolOutput {
  toolName: "project_open_loops";
  projectId: string;
  projectRoot: string;
  filePath?: string;
  loops: ReefOpenLoop[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const ProjectOpenLoopsToolOutputSchema = z.object({
  toolName: z.literal("project_open_loops"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1).optional(),
  loops: z.array(ReefOpenLoopSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
  }),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectOpenLoopsToolOutput>;

export interface VerificationSourceState {
  source: string;
  status: "fresh" | "stale" | "unknown" | "failed" | "unavailable";
  lastRun?: ReefDiagnosticRun;
  reason: string;
  suggestedActions: string[];
}

export const VerificationSourceStateSchema = z.object({
  source: z.string().min(1),
  status: z.enum(["fresh", "stale", "unknown", "failed", "unavailable"]),
  lastRun: ReefDiagnosticRunSchema.optional(),
  reason: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)),
}) satisfies z.ZodType<VerificationSourceState>;

export interface VerificationChangedFile {
  filePath: string;
  lastModifiedAt: string;
  staleForSources: string[];
}

export const VerificationChangedFileSchema = z.object({
  filePath: z.string().min(1),
  lastModifiedAt: z.string().min(1),
  staleForSources: z.array(z.string().min(1)),
}) satisfies z.ZodType<VerificationChangedFile>;

export interface VerificationStateToolInput extends ProjectLocatorInput {
  files?: string[];
  sources?: string[];
  limit?: number;
  cacheStalenessMs?: number;
}

export const VerificationStateToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().min(1)).min(1).max(200).optional(),
  sources: z.array(z.string().min(1)).min(1).max(20).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cacheStalenessMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
}) satisfies z.ZodType<VerificationStateToolInput>;

export interface VerificationStateToolOutput {
  toolName: "verification_state";
  projectId: string;
  projectRoot: string;
  status: "fresh" | "stale" | "unknown" | "failed";
  sources: VerificationSourceState[];
  recentRuns: ReefDiagnosticRun[];
  changedFiles: VerificationChangedFile[];
  suggestedActions: string[];
  watcher?: ProjectIndexWatchState;
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const VerificationStateToolOutputSchema = z.object({
  toolName: z.literal("verification_state"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: z.enum(["fresh", "stale", "unknown", "failed"]),
  sources: z.array(VerificationSourceStateSchema),
  recentRuns: z.array(ReefDiagnosticRunSchema),
  changedFiles: z.array(VerificationChangedFileSchema),
  suggestedActions: z.array(z.string().min(1)),
  watcher: ProjectIndexWatchStateSchema.optional(),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<VerificationStateToolOutput>;

export interface ReefVerifyToolInput extends VerificationStateToolInput {
  includeOpenLoops?: boolean;
  includeAcknowledgedLoops?: boolean;
  openLoopsLimit?: number;
}

export const ReefVerifyToolInputSchema = VerificationStateToolInputSchema.extend({
  includeOpenLoops: z.boolean().optional(),
  includeAcknowledgedLoops: z.boolean().optional(),
  openLoopsLimit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<ReefVerifyToolInput>;

export interface ReefVerifyToolOutput {
  toolName: "reef_verify";
  projectId: string;
  projectRoot: string;
  status: VerificationStateToolOutput["status"];
  verification: VerificationStateToolOutput;
  openLoops?: ProjectOpenLoopsToolOutput;
  summary: {
    verificationStatus: VerificationStateToolOutput["status"];
    sourceCount: number;
    staleSourceCount: number;
    failedSourceCount: number;
    unknownSourceCount: number;
    changedFileCount: number;
    recentRunCount: number;
    openLoopCount: number;
    openLoopErrorCount: number;
    openLoopWarningCount: number;
    canClaimVerified: boolean;
  };
  reefExecution: ReefToolExecution;
  suggestedActions: string[];
  warnings: string[];
}

export const ReefVerifyToolOutputSchema = z.object({
  toolName: z.literal("reef_verify"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: z.enum(["fresh", "stale", "unknown", "failed"]),
  verification: VerificationStateToolOutputSchema,
  openLoops: ProjectOpenLoopsToolOutputSchema.optional(),
  summary: z.object({
    verificationStatus: z.enum(["fresh", "stale", "unknown", "failed"]),
    sourceCount: z.number().int().nonnegative(),
    staleSourceCount: z.number().int().nonnegative(),
    failedSourceCount: z.number().int().nonnegative(),
    unknownSourceCount: z.number().int().nonnegative(),
    changedFileCount: z.number().int().nonnegative(),
    recentRunCount: z.number().int().nonnegative(),
    openLoopCount: z.number().int().nonnegative(),
    openLoopErrorCount: z.number().int().nonnegative(),
    openLoopWarningCount: z.number().int().nonnegative(),
    canClaimVerified: z.boolean(),
  }),
  reefExecution: ReefToolExecutionSchema,
  suggestedActions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefVerifyToolOutput>;

export interface ProjectConvention {
  id: string;
  kind: string;
  title: string;
  status: "candidate" | "accepted" | "deprecated" | "conflicting";
  source: string;
  confidence: number;
  whyIncluded: string;
  filePath?: string;
  evidence: string[];
  metadata?: JsonObject;
}

export const ProjectConventionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["candidate", "accepted", "deprecated", "conflicting"]),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  whyIncluded: z.string().min(1),
  filePath: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ProjectConvention>;

export interface ProjectConventionsToolInput extends ProjectLocatorInput {
  kind?: string;
  status?: "candidate" | "accepted" | "deprecated" | "conflicting";
  limit?: number;
}

export const ProjectConventionsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  kind: z.string().min(1).optional(),
  status: z.enum(["candidate", "accepted", "deprecated", "conflicting"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<ProjectConventionsToolInput>;

export interface ProjectConventionsToolOutput {
  toolName: "project_conventions";
  projectId: string;
  projectRoot: string;
  conventions: ProjectConvention[];
  totalReturned: number;
  warnings: string[];
}

export const ProjectConventionsToolOutputSchema = z.object({
  toolName: z.literal("project_conventions"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  conventions: z.array(ProjectConventionSchema),
  totalReturned: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectConventionsToolOutput>;

export interface FilePreflightToolInput extends ProjectLocatorInput {
  filePath: string;
  sources?: string[];
  freshnessPolicy?: ReefFreshnessPolicy;
  findingsLimit?: number;
  conventionsLimit?: number;
  diagnosticRunsLimit?: number;
  ackLimit?: number;
  cacheStalenessMs?: number;
}

export const FilePreflightToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1).max(20).optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  findingsLimit: z.number().int().min(1).max(500).optional(),
  conventionsLimit: z.number().int().min(1).max(100).optional(),
  diagnosticRunsLimit: z.number().int().min(1).max(100).optional(),
  ackLimit: z.number().int().min(1).max(500).optional(),
  cacheStalenessMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
}) satisfies z.ZodType<FilePreflightToolInput>;

export interface FilePreflightDiagnostics {
  status: "fresh" | "stale" | "unknown" | "failed";
  sources: VerificationSourceState[];
  staleSources: string[];
  failedSources: string[];
  unknownSources: string[];
  changedFile?: VerificationChangedFile;
  recentRuns: ReefDiagnosticRun[];
  watcher?: ProjectIndexWatchState;
  suggestedActions: string[];
}

export const FilePreflightDiagnosticsSchema = z.object({
  status: z.enum(["fresh", "stale", "unknown", "failed"]),
  sources: z.array(VerificationSourceStateSchema),
  staleSources: z.array(z.string().min(1)),
  failedSources: z.array(z.string().min(1)),
  unknownSources: z.array(z.string().min(1)),
  changedFile: VerificationChangedFileSchema.optional(),
  recentRuns: z.array(ReefDiagnosticRunSchema),
  watcher: ProjectIndexWatchStateSchema.optional(),
  suggestedActions: z.array(z.string().min(1)),
}) satisfies z.ZodType<FilePreflightDiagnostics>;

export interface FilePreflightToolOutput {
  toolName: "file_preflight";
  projectId: string;
  projectRoot: string;
  filePath: string;
  findings: ProjectFinding[];
  diagnostics: FilePreflightDiagnostics;
  conventions: ProjectConvention[];
  ackHistory: FindingAck[];
  summary: {
    findingCount: number;
    activeFindingCount: number;
    acknowledgedFindingCount: number;
    staleFindingCount: number;
    staleDiagnosticSourceCount: number;
    failedDiagnosticSourceCount: number;
    unknownDiagnosticSourceCount: number;
    conventionCount: number;
    recentDiagnosticRunCount: number;
    ackCount: number;
  };
  reefExecution: ReefToolExecution;
  filters: {
    freshnessPolicy: ReefFreshnessPolicy;
    cacheStalenessMs: number;
    sources?: string[];
  };
  warnings: string[];
}

export const FilePreflightToolOutputSchema = z.object({
  toolName: z.literal("file_preflight"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1),
  findings: z.array(ProjectFindingSchema),
  diagnostics: FilePreflightDiagnosticsSchema,
  conventions: z.array(ProjectConventionSchema),
  ackHistory: z.array(FindingAckSchema),
  summary: z.object({
    findingCount: z.number().int().nonnegative(),
    activeFindingCount: z.number().int().nonnegative(),
    acknowledgedFindingCount: z.number().int().nonnegative(),
    staleFindingCount: z.number().int().nonnegative(),
    staleDiagnosticSourceCount: z.number().int().nonnegative(),
    failedDiagnosticSourceCount: z.number().int().nonnegative(),
    unknownDiagnosticSourceCount: z.number().int().nonnegative(),
    conventionCount: z.number().int().nonnegative(),
    recentDiagnosticRunCount: z.number().int().nonnegative(),
    ackCount: z.number().int().nonnegative(),
  }),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    freshnessPolicy: ReefFreshnessPolicySchema,
    cacheStalenessMs: z.number().int().positive(),
    sources: z.array(z.string().min(1)).optional(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<FilePreflightToolOutput>;

export interface ReefDiffImpactToolInput extends ProjectLocatorInput {
  filePaths: string[];
  depth?: number;
  maxCallersPerFile?: number;
  maxFindingsPerCaller?: number;
  maxConventions?: number;
  freshnessPolicy?: ReefFreshnessPolicy;
}

export const ReefDiffImpactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePaths: z.array(z.string().trim().min(1)).min(1).max(100),
  depth: z.number().int().min(1).max(8).optional(),
  maxCallersPerFile: z.number().int().min(1).max(500).optional(),
  maxFindingsPerCaller: z.number().int().min(1).max(100).optional(),
  maxConventions: z.number().int().min(1).max(200).optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
}) satisfies z.ZodType<ReefDiffImpactToolInput>;

export interface ReefDiffImpactChangedFile {
  filePath: string;
  indexed: boolean;
  overlayState: "present" | "deleted" | "missing";
  exportedSymbols: string[];
  declaredSymbols: string[];
  overlayFact?: ProjectFact;
}

export const ReefDiffImpactChangedFileSchema = z.object({
  filePath: z.string().min(1),
  indexed: z.boolean(),
  overlayState: z.enum(["present", "deleted", "missing"]),
  exportedSymbols: z.array(z.string().min(1)),
  declaredSymbols: z.array(z.string().min(1)),
  overlayFact: ProjectFactSchema.optional(),
}) satisfies z.ZodType<ReefDiffImpactChangedFile>;

export interface ReefDiffImpactCaller {
  sourceFilePath: string;
  callerFilePath: string;
  depth: number;
  via: string[];
  importSpecifiers: string[];
  potentiallyAffectedSymbols: string[];
  reason: string;
}

export const ReefDiffImpactCallerSchema = z.object({
  sourceFilePath: z.string().min(1),
  callerFilePath: z.string().min(1),
  depth: z.number().int().min(1),
  via: z.array(z.string().min(1)),
  importSpecifiers: z.array(z.string().min(1)),
  potentiallyAffectedSymbols: z.array(z.string().min(1)),
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefDiffImpactCaller>;

export interface ReefDiffImpactInvalidatedFinding {
  sourceFilePath: string;
  callerFilePath: string;
  finding: ProjectFinding;
  reason: string;
}

export const ReefDiffImpactInvalidatedFindingSchema = z.object({
  sourceFilePath: z.string().min(1),
  callerFilePath: z.string().min(1),
  finding: ProjectFindingSchema,
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefDiffImpactInvalidatedFinding>;

export interface ReefDiffImpactConventionRisk {
  filePath: string;
  scope: "changed_file" | "impacted_caller";
  convention: ProjectConvention;
  confidence: number;
  reason: string;
  sourceFilePath?: string;
}

export const ReefDiffImpactConventionRiskSchema = z.object({
  filePath: z.string().min(1),
  scope: z.enum(["changed_file", "impacted_caller"]),
  convention: ProjectConventionSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  sourceFilePath: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefDiffImpactConventionRisk>;

export interface ReefDiffImpactToolOutput {
  toolName: "reef_diff_impact";
  projectId: string;
  projectRoot: string;
  changedFiles: ReefDiffImpactChangedFile[];
  impactedCallers: ReefDiffImpactCaller[];
  possiblyInvalidatedFindings: ReefDiffImpactInvalidatedFinding[];
  conventionRisks: ReefDiffImpactConventionRisk[];
  summary: {
    changedFileCount: number;
    impactedCallerCount: number;
    possiblyInvalidatedFindingCount: number;
    conventionRiskCount: number;
    overlayMissingCount: number;
    truncated: boolean;
  };
  reefExecution: ReefToolExecution;
  filters: {
    depth: number;
    maxCallersPerFile: number;
    maxFindingsPerCaller: number;
    maxConventions: number;
    freshnessPolicy: ReefFreshnessPolicy;
  };
  warnings: string[];
}

export const ReefDiffImpactToolOutputSchema = z.object({
  toolName: z.literal("reef_diff_impact"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  changedFiles: z.array(ReefDiffImpactChangedFileSchema),
  impactedCallers: z.array(ReefDiffImpactCallerSchema),
  possiblyInvalidatedFindings: z.array(ReefDiffImpactInvalidatedFindingSchema),
  conventionRisks: z.array(ReefDiffImpactConventionRiskSchema),
  summary: z.object({
    changedFileCount: z.number().int().nonnegative(),
    impactedCallerCount: z.number().int().nonnegative(),
    possiblyInvalidatedFindingCount: z.number().int().nonnegative(),
    conventionRiskCount: z.number().int().nonnegative(),
    overlayMissingCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  reefExecution: ReefToolExecutionSchema,
  filters: z.object({
    depth: z.number().int().min(1),
    maxCallersPerFile: z.number().int().min(1),
    maxFindingsPerCaller: z.number().int().min(1),
    maxConventions: z.number().int().min(1),
    freshnessPolicy: ReefFreshnessPolicySchema,
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefDiffImpactToolOutput>;

export type ReefImpactToolInput = ReefDiffImpactToolInput;
export const ReefImpactToolInputSchema = ReefDiffImpactToolInputSchema satisfies z.ZodType<ReefImpactToolInput>;

export interface ReefImpactToolOutput extends Omit<ReefDiffImpactToolOutput, "toolName"> {
  toolName: "reef_impact";
}

export const ReefImpactToolOutputSchema = ReefDiffImpactToolOutputSchema.extend({
  toolName: z.literal("reef_impact"),
}) satisfies z.ZodType<ReefImpactToolOutput>;

export interface RuleMemoryEntry {
  ruleId: string;
  source: string;
  sourceNamespace?: string;
  title?: string;
  severity?: ReefSeverity;
  counts: {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    suppressed: number;
  };
  lastSeenAt?: string;
  suggestedActions: string[];
}

export const RuleMemoryEntrySchema = z.object({
  ruleId: z.string().min(1),
  source: z.string().min(1),
  sourceNamespace: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  severity: ReefSeveritySchema.optional(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
  }),
  lastSeenAt: z.string().min(1).optional(),
  suggestedActions: z.array(z.string().min(1)),
}) satisfies z.ZodType<RuleMemoryEntry>;

export interface RuleMemoryToolInput extends ProjectLocatorInput {
  sourceNamespace?: string;
  limit?: number;
}

export const RuleMemoryToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  sourceNamespace: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<RuleMemoryToolInput>;

export interface RuleMemoryToolOutput {
  toolName: "rule_memory";
  projectId: string;
  projectRoot: string;
  entries: RuleMemoryEntry[];
  totalReturned: number;
  warnings: string[];
}

export const RuleMemoryToolOutputSchema = z.object({
  toolName: z.literal("rule_memory"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  entries: z.array(RuleMemoryEntrySchema),
  totalReturned: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<RuleMemoryToolOutput>;

export interface EvidenceConfidenceItem {
  id: string;
  kind: "fact" | "finding";
  filePath?: string;
  subjectFingerprint: string;
  source: string;
  overlay: ProjectOverlay;
  confidence: number;
  confidenceLabel: ReefEvidenceConfidenceLabel;
  freshness: FactFreshness;
  reason: string;
  fact?: ProjectFact;
  finding?: ProjectFinding;
}

export const EvidenceConfidenceItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["fact", "finding"]),
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema,
  confidence: z.number().min(0).max(1),
  confidenceLabel: ReefEvidenceConfidenceLabelSchema,
  freshness: FactFreshnessSchema,
  reason: z.string().min(1),
  fact: ProjectFactSchema.optional(),
  finding: ProjectFindingSchema.optional(),
}) satisfies z.ZodType<EvidenceConfidenceItem>;

export interface EvidenceConfidenceToolInput extends ProjectLocatorInput {
  filePath?: string;
  subjectFingerprint?: string;
  limit?: number;
}

export const EvidenceConfidenceToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<EvidenceConfidenceToolInput>;

export interface EvidenceConfidenceToolOutput {
  toolName: "evidence_confidence";
  projectId: string;
  projectRoot: string;
  items: EvidenceConfidenceItem[];
  summary: Record<ReefEvidenceConfidenceLabel, number>;
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const EvidenceConfidenceSummarySchema = z.object({
  verified_live: z.number().int().nonnegative(),
  fresh_indexed: z.number().int().nonnegative(),
  stale_indexed: z.number().int().nonnegative(),
  fuzzy_semantic: z.number().int().nonnegative(),
  historical: z.number().int().nonnegative(),
  contradicted: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
}) satisfies z.ZodType<Record<ReefEvidenceConfidenceLabel, number>>;

export const EvidenceConfidenceToolOutputSchema = z.object({
  toolName: z.literal("evidence_confidence"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  items: z.array(EvidenceConfidenceItemSchema),
  summary: EvidenceConfidenceSummarySchema,
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<EvidenceConfidenceToolOutput>;

export interface EvidenceConflict {
  conflictId: string;
  conflictKind: string;
  status: "open" | "resolved";
  severity: ReefSeverity;
  title: string;
  filePath?: string;
  subjectFingerprint?: string;
  sources: string[];
  facts: ProjectFact[];
  findings: ProjectFinding[];
  reason: string;
  suggestedActions: string[];
}

export const EvidenceConflictSchema = z.object({
  conflictId: z.string().min(1),
  conflictKind: z.string().min(1),
  status: z.enum(["open", "resolved"]),
  severity: ReefSeveritySchema,
  title: z.string().min(1),
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  sources: z.array(z.string().min(1)),
  facts: z.array(ProjectFactSchema),
  findings: z.array(ProjectFindingSchema),
  reason: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)),
}) satisfies z.ZodType<EvidenceConflict>;

export interface EvidenceConflictsToolInput extends ProjectLocatorInput {
  filePath?: string;
  subjectFingerprint?: string;
  includeResolved?: boolean;
  limit?: number;
}

export const EvidenceConflictsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  includeResolved: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<EvidenceConflictsToolInput>;

export interface EvidenceConflictsToolOutput {
  toolName: "evidence_conflicts";
  projectId: string;
  projectRoot: string;
  conflicts: EvidenceConflict[];
  totalReturned: number;
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const EvidenceConflictsToolOutputSchema = z.object({
  toolName: z.literal("evidence_conflicts"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  conflicts: z.array(EvidenceConflictSchema),
  totalReturned: z.number().int().nonnegative(),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<EvidenceConflictsToolOutput>;

export interface ReefKnownIssuesToolInput extends ProjectLocatorInput {
  files?: string[];
  sources?: string[];
  severities?: ReefSeverity[];
  includeAcknowledged?: boolean;
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const ReefKnownIssuesToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().min(1)).min(1).max(200).optional(),
  sources: z.array(z.string().min(1)).min(1).max(50).optional(),
  severities: z.array(ReefSeveritySchema).min(1).max(3).optional(),
  includeAcknowledged: z.boolean().optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ReefKnownIssuesToolInput>;

export interface ReefKnownIssuesToolOutput {
  toolName: "reef_known_issues";
  projectId: string;
  projectRoot: string;
  issues: ProjectFinding[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    staleSources: number;
    failedSources: number;
    unavailableSources: number;
    unknownSources: number;
  };
  reefExecution: ReefToolExecution;
  suggestedActions: string[];
  warnings: string[];
}

export const ReefKnownIssuesToolOutputSchema = z.object({
  toolName: z.literal("reef_known_issues"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  issues: z.array(ProjectFindingSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    staleSources: z.number().int().nonnegative(),
    failedSources: z.number().int().nonnegative(),
    unavailableSources: z.number().int().nonnegative(),
    unknownSources: z.number().int().nonnegative(),
  }),
  reefExecution: ReefToolExecutionSchema,
  suggestedActions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefKnownIssuesToolOutput>;

export interface ReefAgentStatusToolInput extends ProjectLocatorInput {
  focusFiles?: string[];
  freshnessPolicy?: ReefFreshnessPolicy;
  limit?: number;
}

export const ReefAgentStatusToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  focusFiles: z.array(z.string().min(1)).min(1).max(100).optional(),
  freshnessPolicy: ReefFreshnessPolicySchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}) satisfies z.ZodType<ReefAgentStatusToolInput>;

export interface ReefAgentStatusToolOutput {
  toolName: "reef_agent_status";
  projectId: string;
  projectRoot: string;
  state: "fresh" | "refreshing" | "dirty" | "stale" | "unknown" | "disabled" | "error";
  knownIssues: ProjectFinding[];
  changedFiles: VerificationChangedFile[];
  staleSources: VerificationSourceState[];
  schema?: ReefProjectSchemaStatus;
  summary: {
    knownIssueCount: number;
    changedFileCount: number;
    staleSourceCount: number;
    watcherDegraded: boolean;
    backgroundQueue: "idle" | "running" | "queued";
  };
  reefExecution: ReefToolExecution;
  suggestedActions: string[];
  warnings: string[];
}

export const ReefAgentStatusToolOutputSchema = z.object({
  toolName: z.literal("reef_agent_status"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  state: z.enum(["fresh", "refreshing", "dirty", "stale", "unknown", "disabled", "error"]),
  knownIssues: z.array(ProjectFindingSchema),
  changedFiles: z.array(VerificationChangedFileSchema),
  staleSources: z.array(VerificationSourceStateSchema),
  schema: ReefProjectSchemaStatusSchema.optional(),
  summary: z.object({
    knownIssueCount: z.number().int().nonnegative(),
    changedFileCount: z.number().int().nonnegative(),
    staleSourceCount: z.number().int().nonnegative(),
    watcherDegraded: z.boolean(),
    backgroundQueue: z.enum(["idle", "running", "queued"]),
  }),
  reefExecution: ReefToolExecutionSchema,
  suggestedActions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefAgentStatusToolOutput>;

export type ReefStatusToolInput = ReefAgentStatusToolInput;
export const ReefStatusToolInputSchema = ReefAgentStatusToolInputSchema satisfies z.ZodType<ReefStatusToolInput>;

export interface ReefStatusToolOutput extends Omit<ReefAgentStatusToolOutput, "toolName"> {
  toolName: "reef_status";
}

export const ReefStatusToolOutputSchema = ReefAgentStatusToolOutputSchema.extend({
  toolName: z.literal("reef_status"),
}) satisfies z.ZodType<ReefStatusToolOutput>;

export const ReefAskModeSchema = z.enum(["explore", "plan", "implement", "review", "verify"]);
export type ReefAskMode = z.infer<typeof ReefAskModeSchema>;

export const ReefAskConfidenceSchema = z.enum(["high", "medium", "low"]);
export type ReefAskConfidence = z.infer<typeof ReefAskConfidenceSchema>;

export const ReefAskEvidenceModeSchema = z.enum(["compact", "full"]);
export type ReefAskEvidenceMode = z.infer<typeof ReefAskEvidenceModeSchema>;

export const ReefAskEngineStepStatusSchema = z.enum(["included", "skipped"]);
export type ReefAskEngineStepStatus = z.infer<typeof ReefAskEngineStepStatusSchema>;

export interface ReefAskToolInput extends ProjectLocatorInput {
  question: string;
  mode?: ReefAskMode;
  focusFiles?: string[];
  changedFiles?: string[];
  focusRoutes?: string[];
  focusSymbols?: string[];
  focusDatabaseObjects?: string[];
  includeInstructions?: boolean;
  includeRisks?: boolean;
  includeOpenLoops?: boolean;
  includeVerification?: boolean;
  freshnessPolicy?: "report" | "prefer_fresh";
  budgetTokens?: number;
  maxPrimaryContext?: number;
  maxRelatedContext?: number;
  maxOpenLoops?: number;
  evidenceMode?: ReefAskEvidenceMode;
  maxEvidenceItemsPerSection?: number;
  risksMinConfidence?: number;
}

export const ReefAskToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  question: z.string().trim().min(1),
  mode: ReefAskModeSchema.optional(),
  focusFiles: z.array(z.string().min(1)).min(1).max(100).optional(),
  changedFiles: z.array(z.string().min(1)).min(1).max(100).optional(),
  focusRoutes: z.array(z.string().min(1)).min(1).max(50).optional(),
  focusSymbols: z.array(z.string().min(1)).min(1).max(100).optional(),
  focusDatabaseObjects: z.array(z.string().min(1)).min(1).max(100).optional(),
  includeInstructions: z.boolean().optional(),
  includeRisks: z.boolean().optional(),
  includeOpenLoops: z.boolean().optional(),
  includeVerification: z.boolean().optional(),
  freshnessPolicy: z.enum(["report", "prefer_fresh"]).optional(),
  budgetTokens: z.number().int().min(512).max(24_000).optional(),
  maxPrimaryContext: z.number().int().min(1).max(50).optional(),
  maxRelatedContext: z.number().int().min(1).max(100).optional(),
  maxOpenLoops: z.number().int().min(1).max(50).optional(),
  evidenceMode: ReefAskEvidenceModeSchema.optional(),
  maxEvidenceItemsPerSection: z.number().int().min(1).max(500).optional(),
  risksMinConfidence: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<ReefAskToolInput>;

export interface ReefAskEngineStep {
  name: string;
  status: ReefAskEngineStepStatus;
  reason: string;
  returnedCount: number;
}

export const ReefAskEngineStepSchema = z.object({
  name: z.string().min(1),
  status: ReefAskEngineStepStatusSchema,
  reason: z.string().min(1),
  returnedCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ReefAskEngineStep>;

export interface ReefAskPlannedCalculation {
  nodeId: string;
  queryKind: string;
  lane: string;
  status: ReefAskEngineStepStatus;
  reason: string;
  returnedCount: number;
}

export const ReefAskPlannedCalculationSchema = z.object({
  nodeId: z.string().min(1),
  queryKind: z.string().min(1),
  lane: z.string().min(1),
  status: ReefAskEngineStepStatusSchema,
  reason: z.string().min(1),
  returnedCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ReefAskPlannedCalculation>;

export interface ReefAskGraphSummary {
  returnedNodes: number;
  totalNodes: number;
  droppedNodes: number;
  returnedEdges: number;
  totalEdges: number;
  droppedEdges: number;
  truncated: boolean;
  nodeKinds: Record<string, number>;
  edgeKinds: Record<string, number>;
  sourceCounts: Record<string, number>;
}

export const ReefAskGraphSummarySchema = z.object({
  returnedNodes: z.number().int().nonnegative(),
  totalNodes: z.number().int().nonnegative(),
  droppedNodes: z.number().int().nonnegative(),
  returnedEdges: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  droppedEdges: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nodeKinds: z.record(z.string().min(1), z.number().int().nonnegative()),
  edgeKinds: z.record(z.string().min(1), z.number().int().nonnegative()),
  sourceCounts: z.record(z.string().min(1), z.number().int().nonnegative()),
}) satisfies z.ZodType<ReefAskGraphSummary>;

export interface ReefAskQueryPlan {
  mode: ReefAskMode;
  intent: ContextPacketIntent;
  evidenceLanes: string[];
  graphSummary: ReefAskGraphSummary;
  assumptions: string[];
  engineSteps: ReefAskEngineStep[];
  calculations: ReefAskPlannedCalculation[];
}

export const ReefAskQueryPlanSchema = z.object({
  mode: ReefAskModeSchema,
  intent: ContextPacketIntentSchema,
  evidenceLanes: z.array(z.string().min(1)),
  graphSummary: ReefAskGraphSummarySchema,
  assumptions: z.array(z.string().min(1)),
  engineSteps: z.array(ReefAskEngineStepSchema),
  calculations: z.array(ReefAskPlannedCalculationSchema),
}) satisfies z.ZodType<ReefAskQueryPlan>;

export interface ReefAskAnswer {
  summary: string;
  confidence: ReefAskConfidence;
  confidenceReasons: string[];
  inventorySummary?: ReefAskInventorySummary;
  databaseObjectSummary?: ReefAskDatabaseObjectSummary;
  diagnosticSummary?: ReefAskDiagnosticSummary;
  findingsSummary?: ReefAskFindingsSummary;
  literalMatchesSummary?: ReefAskLiteralMatchesSummary;
  whereUsedSummary?: ReefAskWhereUsedSummary;
  decisionTrace: ReefAskDecisionTrace;
  nextQueries: ReefAskNextQuery[];
  suggestedNextActions: string[];
}

export interface ReefAskInventoryItem {
  kind: string;
  name: string;
  schemaName?: string;
  freshness: FactFreshness;
}

export const ReefAskInventoryItemSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  schemaName: z.string().min(1).optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskInventoryItem>;

export interface ReefAskInventorySummary {
  total: number;
  byKind: Record<string, number>;
  staleCount: number;
  items: ReefAskInventoryItem[];
  truncated: boolean;
}

export const ReefAskInventorySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  byKind: z.record(z.string().min(1), z.number().int().nonnegative()),
  staleCount: z.number().int().nonnegative(),
  items: z.array(ReefAskInventoryItemSchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<ReefAskInventorySummary>;

export interface ReefAskDatabaseTableSummary {
  columnCount?: number;
  primaryKey: string[];
  indexCount?: number;
  outboundForeignKeyCount?: number;
  inboundForeignKeyCount?: number;
  rlsEnabled?: boolean;
  forceRls?: boolean;
  policyCount?: number;
  triggerCount?: number;
  freshness: FactFreshness;
}

export const ReefAskDatabaseTableSummarySchema = z.object({
  columnCount: z.number().int().nonnegative().optional(),
  primaryKey: z.array(z.string().min(1)),
  indexCount: z.number().int().nonnegative().optional(),
  outboundForeignKeyCount: z.number().int().nonnegative().optional(),
  inboundForeignKeyCount: z.number().int().nonnegative().optional(),
  rlsEnabled: z.boolean().optional(),
  forceRls: z.boolean().optional(),
  policyCount: z.number().int().nonnegative().optional(),
  triggerCount: z.number().int().nonnegative().optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseTableSummary>;

export interface ReefAskDatabaseColumnSummary {
  name: string;
  dataType?: string;
  nullable?: boolean;
  defaultExpression?: string;
  isPrimaryKey?: boolean;
  freshness: FactFreshness;
}

export const ReefAskDatabaseColumnSummarySchema = z.object({
  name: z.string().min(1),
  dataType: z.string().min(1).optional(),
  nullable: z.boolean().optional(),
  defaultExpression: z.string().min(1).optional(),
  isPrimaryKey: z.boolean().optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseColumnSummary>;

export interface ReefAskDatabaseIndexSummary {
  name: string;
  unique?: boolean;
  primary?: boolean;
  columns: string[];
  definition?: string;
  freshness: FactFreshness;
}

export const ReefAskDatabaseIndexSummarySchema = z.object({
  name: z.string().min(1),
  unique: z.boolean().optional(),
  primary: z.boolean().optional(),
  columns: z.array(z.string().min(1)),
  definition: z.string().min(1).optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseIndexSummary>;

export interface ReefAskDatabaseForeignKeySummary {
  direction?: string;
  constraintName: string;
  columns: string[];
  targetSchema?: string;
  targetTable?: string;
  targetColumns: string[];
  sourceSchema?: string;
  sourceTable?: string;
  sourceColumns: string[];
  onUpdate?: string;
  onDelete?: string;
  freshness: FactFreshness;
}

export const ReefAskDatabaseForeignKeySummarySchema = z.object({
  direction: z.string().min(1).optional(),
  constraintName: z.string().min(1),
  columns: z.array(z.string().min(1)),
  targetSchema: z.string().min(1).optional(),
  targetTable: z.string().min(1).optional(),
  targetColumns: z.array(z.string().min(1)),
  sourceSchema: z.string().min(1).optional(),
  sourceTable: z.string().min(1).optional(),
  sourceColumns: z.array(z.string().min(1)),
  onUpdate: z.string().min(1).optional(),
  onDelete: z.string().min(1).optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseForeignKeySummary>;

export interface ReefAskDatabaseRlsPolicySummary {
  name: string;
  mode?: string;
  command?: string;
  roles: string[];
  usingExpression?: string;
  withCheckExpression?: string;
  freshness: FactFreshness;
}

export const ReefAskDatabaseRlsPolicySummarySchema = z.object({
  name: z.string().min(1),
  mode: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)),
  usingExpression: z.string().min(1).optional(),
  withCheckExpression: z.string().min(1).optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseRlsPolicySummary>;

export interface ReefAskDatabaseTriggerSummary {
  name: string;
  enabled?: boolean;
  enabledMode?: string;
  timing?: string;
  events: string[];
  hasBodyText?: boolean;
  freshness: FactFreshness;
}

export const ReefAskDatabaseTriggerSummarySchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  enabledMode: z.string().min(1).optional(),
  timing: z.string().min(1).optional(),
  events: z.array(z.string().min(1)),
  hasBodyText: z.boolean().optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseTriggerSummary>;

export interface ReefAskDatabaseUsageSummary {
  filePath: string;
  line?: number;
  usageKind?: string;
  excerpt?: string;
  freshness: FactFreshness;
}

export const ReefAskDatabaseUsageSummarySchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().positive().optional(),
  usageKind: z.string().min(1).optional(),
  excerpt: z.string().min(1).optional(),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskDatabaseUsageSummary>;

export interface ReefAskDatabaseObjectSummary {
  schemaName?: string;
  objectName: string;
  factCount: number;
  staleCount: number;
  table?: ReefAskDatabaseTableSummary;
  columns: ReefAskDatabaseColumnSummary[];
  indexes: ReefAskDatabaseIndexSummary[];
  foreignKeys: ReefAskDatabaseForeignKeySummary[];
  rlsPolicies: ReefAskDatabaseRlsPolicySummary[];
  triggers: ReefAskDatabaseTriggerSummary[];
  usages: ReefAskDatabaseUsageSummary[];
  truncated: boolean;
}

export const ReefAskDatabaseObjectSummarySchema = z.object({
  schemaName: z.string().min(1).optional(),
  objectName: z.string().min(1),
  factCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  table: ReefAskDatabaseTableSummarySchema.optional(),
  columns: z.array(ReefAskDatabaseColumnSummarySchema),
  indexes: z.array(ReefAskDatabaseIndexSummarySchema),
  foreignKeys: z.array(ReefAskDatabaseForeignKeySummarySchema),
  rlsPolicies: z.array(ReefAskDatabaseRlsPolicySummarySchema),
  triggers: z.array(ReefAskDatabaseTriggerSummarySchema),
  usages: z.array(ReefAskDatabaseUsageSummarySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<ReefAskDatabaseObjectSummary>;

export const ReefAskDiagnosticGateSchema = z.enum([
  "clear",
  "review_required",
  "needs_refresh",
  "blocked",
  "unknown",
]);
export type ReefAskDiagnosticGate = z.infer<typeof ReefAskDiagnosticGateSchema>;

export interface ReefAskDiagnosticSourceSummary {
  source: string;
  status: VerificationSourceState["status"];
  reason: string;
  lastRunStatus?: ReefDiagnosticRunStatus;
  lastRunFinishedAt?: string;
  findingCount?: number;
  persistedFindingCount?: number;
  checkedFileCount?: number;
}

export const ReefAskDiagnosticSourceSummarySchema = z.object({
  source: z.string().min(1),
  status: z.enum(["fresh", "stale", "unknown", "failed", "unavailable"]),
  reason: z.string().min(1),
  lastRunStatus: ReefDiagnosticRunStatusSchema.optional(),
  lastRunFinishedAt: z.string().min(1).optional(),
  findingCount: z.number().int().nonnegative().optional(),
  persistedFindingCount: z.number().int().nonnegative().optional(),
  checkedFileCount: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ReefAskDiagnosticSourceSummary>;

export interface ReefAskDiagnosticRunSummary {
  source: string;
  status: ReefDiagnosticRunStatus;
  finishedAt: string;
  findingCount: number;
  persistedFindingCount: number;
  checkedFileCount?: number;
}

export const ReefAskDiagnosticRunSummarySchema = z.object({
  source: z.string().min(1),
  status: ReefDiagnosticRunStatusSchema,
  finishedAt: z.string().min(1),
  findingCount: z.number().int().nonnegative(),
  persistedFindingCount: z.number().int().nonnegative(),
  checkedFileCount: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ReefAskDiagnosticRunSummary>;

export interface ReefAskDiagnosticChangedFileSummary {
  filePath: string;
  lastModifiedAt: string;
  staleForSources: string[];
}

export const ReefAskDiagnosticChangedFileSummarySchema = z.object({
  filePath: z.string().min(1),
  lastModifiedAt: z.string().min(1),
  staleForSources: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefAskDiagnosticChangedFileSummary>;

export interface ReefAskDiagnosticOpenLoopSummary {
  kind: ReefOpenLoopKind;
  severity: ReefSeverity;
  source: string;
  title: string;
  filePath?: string;
  reason: string;
}

export const ReefAskDiagnosticOpenLoopSummarySchema = z.object({
  kind: ReefOpenLoopKindSchema,
  severity: ReefSeveritySchema,
  source: z.string().min(1),
  title: z.string().min(1),
  filePath: z.string().min(1).optional(),
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefAskDiagnosticOpenLoopSummary>;

export interface ReefAskDiagnosticSummary {
  gate: ReefAskDiagnosticGate;
  canClaimVerified: boolean;
  verificationStatus: VerificationStateToolOutput["status"] | "skipped";
  sourceCounts: Record<VerificationSourceState["status"], number>;
  openLoopCounts: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  changedFileCount: number;
  blockerCount: number;
  sources: ReefAskDiagnosticSourceSummary[];
  recentRuns: ReefAskDiagnosticRunSummary[];
  changedFiles: ReefAskDiagnosticChangedFileSummary[];
  openLoops: ReefAskDiagnosticOpenLoopSummary[];
  suggestedActions: string[];
  truncated: boolean;
}

export const ReefAskDiagnosticSummarySchema = z.object({
  gate: ReefAskDiagnosticGateSchema,
  canClaimVerified: z.boolean(),
  verificationStatus: z.enum(["fresh", "stale", "unknown", "failed", "skipped"]),
  sourceCounts: z.object({
    fresh: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }),
  openLoopCounts: z.object({
    total: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
  }),
  changedFileCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  sources: z.array(ReefAskDiagnosticSourceSummarySchema),
  recentRuns: z.array(ReefAskDiagnosticRunSummarySchema),
  changedFiles: z.array(ReefAskDiagnosticChangedFileSummarySchema),
  openLoops: z.array(ReefAskDiagnosticOpenLoopSummarySchema),
  suggestedActions: z.array(z.string().min(1)),
  truncated: z.boolean(),
}) satisfies z.ZodType<ReefAskDiagnosticSummary>;

export interface ReefAskFindingSummaryItem {
  fingerprint: string;
  source: string;
  ruleId?: string;
  severity: ReefSeverity;
  status: ProjectFindingStatus;
  filePath?: string;
  line?: number;
  message: string;
  freshness: FactFreshness;
}

export const ReefAskFindingSummaryItemSchema = z.object({
  fingerprint: z.string().min(1),
  source: z.string().min(1),
  ruleId: z.string().min(1).optional(),
  severity: ReefSeveritySchema,
  status: ProjectFindingStatusSchema,
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  freshness: FactFreshnessSchema,
}) satisfies z.ZodType<ReefAskFindingSummaryItem>;

export interface ReefAskFindingsSummary {
  total: number;
  bySeverity: Record<ReefSeverity, number>;
  bySource: Record<string, number>;
  staleCount: number;
  items: ReefAskFindingSummaryItem[];
  truncated: boolean;
}

export const ReefAskFindingsSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: z.object({
    info: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  bySource: z.record(z.string().min(1), z.number().int().nonnegative()),
  staleCount: z.number().int().nonnegative(),
  items: z.array(ReefAskFindingSummaryItemSchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<ReefAskFindingsSummary>;

export interface ReefAskLiteralMatchFileSummary {
  filePath: string;
  matchCount: number;
  firstLine?: number;
}

export const ReefAskLiteralMatchFileSummarySchema = z.object({
  filePath: z.string().min(1),
  matchCount: z.number().int().nonnegative(),
  firstLine: z.number().int().positive().optional(),
}) satisfies z.ZodType<ReefAskLiteralMatchFileSummary>;

export interface ReefAskLiteralMatchesSummary {
  query: string;
  totalMatches: number;
  fileCount: number;
  files: ReefAskLiteralMatchFileSummary[];
  truncated: boolean;
}

export const ReefAskLiteralMatchesSummarySchema = z.object({
  query: z.string().min(1),
  totalMatches: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(ReefAskLiteralMatchFileSummarySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<ReefAskLiteralMatchesSummary>;

export interface ReefAskWhereUsedDefinitionSummary {
  filePath: string;
  name: string;
  kind: string;
  lineStart?: number;
}

export const ReefAskWhereUsedDefinitionSummarySchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  lineStart: z.number().int().positive().optional(),
}) satisfies z.ZodType<ReefAskWhereUsedDefinitionSummary>;

export interface ReefAskWhereUsedUsageSummary {
  filePath: string;
  usageKind: ReefStructuralUsage["usageKind"];
  targetPath?: string;
  line?: number;
  reason: string;
}

export const ReefAskWhereUsedUsageSummarySchema = z.object({
  filePath: z.string().min(1),
  usageKind: z.enum(["import", "dependent", "route_owner", "definition", "text_reference"]),
  targetPath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefAskWhereUsedUsageSummary>;

export interface ReefAskWhereUsedSummary {
  query: string;
  targetKind?: ReefStructuralTargetKind;
  definitionCount: number;
  usageCount: number;
  relatedFindingCount: number;
  byUsageKind: Record<ReefStructuralUsage["usageKind"], number>;
  definitions: ReefAskWhereUsedDefinitionSummary[];
  usages: ReefAskWhereUsedUsageSummary[];
  truncated: boolean;
  fallbackRecommendation?: string;
}

export const ReefAskWhereUsedSummarySchema = z.object({
  query: z.string().min(1),
  targetKind: ReefStructuralTargetKindSchema.optional(),
  definitionCount: z.number().int().nonnegative(),
  usageCount: z.number().int().nonnegative(),
  relatedFindingCount: z.number().int().nonnegative(),
  byUsageKind: z.object({
    import: z.number().int().nonnegative(),
    dependent: z.number().int().nonnegative(),
    route_owner: z.number().int().nonnegative(),
    definition: z.number().int().nonnegative(),
    text_reference: z.number().int().nonnegative(),
  }),
  definitions: z.array(ReefAskWhereUsedDefinitionSummarySchema),
  usages: z.array(ReefAskWhereUsedUsageSummarySchema),
  truncated: z.boolean(),
  fallbackRecommendation: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefAskWhereUsedSummary>;

export interface ReefAskNextQuery {
  reason: string;
  question: string;
}

export const ReefAskNextQuerySchema = z.object({
  reason: z.string().min(1),
  question: z.string().min(1),
}) satisfies z.ZodType<ReefAskNextQuery>;

export interface ReefAskDecisionTraceEntry {
  lane: string;
  status: ReefAskEngineStepStatus;
  reason: string;
  evidenceCount: number;
  fallback?: string;
}

export const ReefAskDecisionTraceEntrySchema = z.object({
  lane: z.string().min(1),
  status: ReefAskEngineStepStatusSchema,
  reason: z.string().min(1),
  evidenceCount: z.number().int().nonnegative(),
  fallback: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefAskDecisionTraceEntry>;

export interface ReefAskDecisionTrace {
  entries: ReefAskDecisionTraceEntry[];
  calculations: ReefAskPlannedCalculation[];
  lowConfidenceFallbacks: ReefAskNextQuery[];
}

export const ReefAskDecisionTraceSchema = z.object({
  entries: z.array(ReefAskDecisionTraceEntrySchema),
  calculations: z.array(ReefAskPlannedCalculationSchema),
  lowConfidenceFallbacks: z.array(ReefAskNextQuerySchema),
}) satisfies z.ZodType<ReefAskDecisionTrace>;

export const ReefAskAnswerSchema = z.object({
  summary: z.string().min(1),
  confidence: ReefAskConfidenceSchema,
  confidenceReasons: z.array(z.string().min(1)),
  inventorySummary: ReefAskInventorySummarySchema.optional(),
  databaseObjectSummary: ReefAskDatabaseObjectSummarySchema.optional(),
  diagnosticSummary: ReefAskDiagnosticSummarySchema.optional(),
  findingsSummary: ReefAskFindingsSummarySchema.optional(),
  literalMatchesSummary: ReefAskLiteralMatchesSummarySchema.optional(),
  whereUsedSummary: ReefAskWhereUsedSummarySchema.optional(),
  decisionTrace: ReefAskDecisionTraceSchema,
  nextQueries: z.array(ReefAskNextQuerySchema),
  suggestedNextActions: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefAskAnswer>;

export interface ReefAskEvidence {
  mode: ReefAskEvidenceMode;
  sections: Record<string, {
    returned: number;
    total: number;
    truncated: boolean;
  }>;
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  symbols: ContextPacketSymbol[];
  routes: ContextPacketRoute[];
  databaseObjects: ContextPacketDatabaseObject[];
  findings: ProjectFinding[];
  risks: ContextPacketRisk[];
  instructions: ContextPacketInstruction[];
  openLoops: ReefOpenLoop[];
  facts: ProjectFact[];
  graph: ReefEvidenceGraph;
  tableNeighborhood?: TableNeighborhoodToolOutput;
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  routeContext?: RouteContextToolOutput;
  whereUsed?: {
    query: string;
    targetKind?: ReefStructuralTargetKind;
    definitions: ReefStructuralDefinition[];
    usages: ReefStructuralUsage[];
    relatedFindings: ProjectFinding[];
    coverage: ReefWhereUsedCoverage;
    fallbackRecommendation?: string;
    warnings: string[];
  };
  liveTextSearch?: {
    query: string;
    matches: LiveTextSearchMatch[];
    filesMatched: string[];
    truncated: boolean;
    warnings: string[];
  };
  verification: {
    status: "fresh" | "stale" | "unknown" | "failed";
    sources: VerificationSourceState[];
    changedFiles: VerificationChangedFile[];
    suggestedActions: string[];
  };
}

export const ReefAskEvidenceSchema = z.object({
  mode: ReefAskEvidenceModeSchema,
  sections: z.record(z.string().min(1), z.object({
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })),
  primaryContext: z.array(ContextPacketReadableCandidateSchema),
  relatedContext: z.array(ContextPacketReadableCandidateSchema),
  symbols: z.array(ContextPacketSymbolSchema),
  routes: z.array(ContextPacketRouteSchema),
  databaseObjects: z.array(ContextPacketDatabaseObjectSchema),
  findings: z.array(ProjectFindingSchema),
  risks: z.array(ContextPacketRiskSchema),
  instructions: z.array(ContextPacketInstructionSchema),
  openLoops: z.array(ReefOpenLoopSchema),
  facts: z.array(ProjectFactSchema),
  graph: ReefEvidenceGraphSchema,
  tableNeighborhood: TableNeighborhoodToolOutputSchema.optional(),
  rpcNeighborhood: RpcNeighborhoodToolOutputSchema.optional(),
  routeContext: RouteContextToolOutputSchema.optional(),
  whereUsed: z.object({
    query: z.string().min(1),
    targetKind: ReefStructuralTargetKindSchema.optional(),
    definitions: z.array(ReefStructuralDefinitionSchema),
    usages: z.array(ReefStructuralUsageSchema),
    relatedFindings: z.array(ProjectFindingSchema),
    coverage: ReefWhereUsedCoverageSchema,
    fallbackRecommendation: z.string().min(1).optional(),
    warnings: z.array(z.string().min(1)),
  }).optional(),
  liveTextSearch: z.object({
    query: z.string().min(1),
    matches: z.array(LiveTextSearchMatchSchema),
    filesMatched: z.array(z.string().min(1)),
    truncated: z.boolean(),
    warnings: z.array(z.string()),
  }).optional(),
  verification: z.object({
    status: z.enum(["fresh", "stale", "unknown", "failed"]),
    sources: z.array(VerificationSourceStateSchema),
    changedFiles: z.array(VerificationChangedFileSchema),
    suggestedActions: z.array(z.string().min(1)),
  }),
}) satisfies z.ZodType<ReefAskEvidence>;

export interface ReefAskFreshness {
  code: string;
  database: string;
  diagnostics: "fresh" | "stale" | "unknown" | "failed" | "skipped";
}

export const ReefAskFreshnessSchema = z.object({
  code: z.string().min(1),
  database: z.string().min(1),
  diagnostics: z.enum(["fresh", "stale", "unknown", "failed", "skipped"]),
}) satisfies z.ZodType<ReefAskFreshness>;

export interface ReefAskToolOutput {
  toolName: "reef_ask";
  projectId: string;
  projectRoot: string;
  question: string;
  answer: ReefAskAnswer;
  queryPlan: ReefAskQueryPlan;
  evidence: ReefAskEvidence;
  freshness: ReefAskFreshness;
  reefExecution: ReefToolExecution;
  limits: {
    budgetTokens: number;
    maxPrimaryContext: number;
    maxRelatedContext: number;
    maxOpenLoops: number;
    evidenceMode: ReefAskEvidenceMode;
    maxEvidenceItemsPerSection: number;
  };
  warnings: string[];
}

export const ReefAskToolOutputSchema = z.object({
  toolName: z.literal("reef_ask"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  question: z.string().min(1),
  answer: ReefAskAnswerSchema,
  queryPlan: ReefAskQueryPlanSchema,
  evidence: ReefAskEvidenceSchema,
  freshness: ReefAskFreshnessSchema,
  reefExecution: ReefToolExecutionSchema,
  limits: z.object({
    budgetTokens: z.number().int().min(1),
    maxPrimaryContext: z.number().int().min(1),
    maxRelatedContext: z.number().int().min(1),
    maxOpenLoops: z.number().int().min(1),
    evidenceMode: ReefAskEvidenceModeSchema,
    maxEvidenceItemsPerSection: z.number().int().min(1),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefAskToolOutput>;
