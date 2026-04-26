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
  type ReefDiagnosticRunStatus,
  type ReefSeverity,
  type ReefRuleDescriptor,
} from "./reef.js";
import type { JsonObject } from "./common.js";
import {
  AnswerSurfaceIssueCategorySchema,
  AnswerSurfaceIssueConfidenceSchema,
  AnswerSurfaceIssueSeveritySchema,
  JsonObjectSchema,
} from "./tool-schema-shared.js";
import {
  ContextPacketInstructionSchema,
  type ContextPacketInstruction,
} from "./tool-context-packet-schemas.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

export interface ProjectFindingsToolInput extends ProjectLocatorInput {
  overlay?: ProjectOverlay;
  source?: string;
  status?: ProjectFindingStatus;
  includeResolved?: boolean;
  limit?: number;
}

export const ProjectFindingsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  status: ProjectFindingStatusSchema.optional(),
  includeResolved: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ProjectFindingsToolInput>;

export interface ProjectFindingsToolOutput {
  toolName: "project_findings";
  projectId: string;
  projectRoot: string;
  findings: ProjectFinding[];
  totalReturned: number;
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
  limit?: number;
}

export const FileFindingsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  status: ProjectFindingStatusSchema.optional(),
  includeResolved: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<FileFindingsToolInput>;

export interface FileFindingsToolOutput {
  toolName: "file_findings";
  projectId: string;
  projectRoot: string;
  filePath: string;
  findings: ProjectFinding[];
  totalReturned: number;
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
  limit?: number;
}

export const ProjectFactsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  subjectFingerprint: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<ProjectFactsToolInput>;

export interface ProjectFactsToolOutput {
  toolName: "project_facts";
  projectId: string;
  projectRoot: string;
  facts: ProjectFact[];
  totalReturned: number;
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
  limit?: number;
}

export const FileFactsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  filePath: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  source: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}) satisfies z.ZodType<FileFactsToolInput>;

export interface FileFactsToolOutput {
  toolName: "file_facts";
  projectId: string;
  projectRoot: string;
  filePath: string;
  facts: ProjectFact[];
  totalReturned: number;
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
  limit?: number;
}

export const ReefOverlayDiffToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  leftOverlay: ProjectOverlaySchema.optional(),
  rightOverlay: ProjectOverlaySchema.optional(),
  filePath: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  includeEqual: z.boolean().optional(),
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

export interface RulePackValidationRule {
  id: string;
  sourcePath: string;
  category: z.infer<typeof AnswerSurfaceIssueCategorySchema>;
  severity: z.infer<typeof AnswerSurfaceIssueSeveritySchema>;
  confidence: z.infer<typeof AnswerSurfaceIssueConfidenceSchema>;
  languages?: string[];
  patternCount: number;
  message: string;
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

export const DiagnosticRefreshSourceSchema = z.enum([
  "lint_files",
  "typescript",
  "eslint",
  "oxlint",
  "biome",
  "git_precommit_check",
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
  sources: z.array(DiagnosticRefreshSourceSchema).min(1).max(6).optional(),
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
}

export const DbReefRefreshToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  includeAppUsage: z.boolean().optional(),
  includeFacts: z.boolean().optional(),
}).strict() satisfies z.ZodType<DbReefRefreshToolInput>;

export interface DbReefRefreshToolOutput {
  toolName: "db_reef_refresh";
  projectId: string;
  projectRoot: string;
  facts?: ProjectFact[];
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

export interface DbReviewCommentToolOutput {
  toolName: "db_review_comment";
  projectId: string;
  projectRoot: string;
  comment: DbReviewComment;
  warnings: string[];
}

export const DbReviewCommentToolOutputSchema = z.object({
  toolName: z.literal("db_review_comment"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  comment: DbReviewCommentSchema,
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
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefInspectToolOutput>;

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
  changedFiles: VerificationChangedFile[];
  suggestedActions: string[];
  warnings: string[];
}

export const VerificationStateToolOutputSchema = z.object({
  toolName: z.literal("verification_state"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: z.enum(["fresh", "stale", "unknown", "failed"]),
  sources: z.array(VerificationSourceStateSchema),
  changedFiles: z.array(VerificationChangedFileSchema),
  suggestedActions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<VerificationStateToolOutput>;

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
  warnings: string[];
}

export const EvidenceConflictsToolOutputSchema = z.object({
  toolName: z.literal("evidence_conflicts"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  conflicts: z.array(EvidenceConflictSchema),
  totalReturned: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<EvidenceConflictsToolOutput>;
