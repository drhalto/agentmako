import { z } from "zod";
import type { QueryKind } from "./answer.js";
import type { GraphEdgeKind, GraphNodeLocator, GraphTraversalDirection } from "./graph.js";
import type {
  ArtifactRenderFormat,
  ImplementationHandoffArtifact,
  ReviewBundleArtifact,
  TaskPreflightArtifact,
  VerificationBundleArtifact,
} from "./artifacts.js";
import type { JsonObject } from "./common.js";
import {
  ArtifactRenderFormatSchema,
  ImplementationHandoffArtifactSchema,
  ReviewBundleArtifactSchema,
  TaskPreflightArtifactSchema,
  VerificationBundleArtifactSchema,
} from "./artifacts.js";
import {
  GraphEdgeKindSchema,
  GraphNodeLocatorSchema,
  GraphTraversalDirectionSchema,
} from "./graph.js";
import {
  JsonObjectSchema,
  QueryKindSchema,
} from "./tool-schema-shared.js";
import {
  ProjectLocatorInputObjectSchema,
} from "./tool-project-locator.js";

// Shared export request / result shapes used by every artifact tool. The
// actual export side effect only runs when the caller opts in by passing
// `export: { file: ... }`; the generator defaults declare file_export
// capability via `exportIntent.defaultTargets`.

export interface ArtifactExportFileRequest {
  directory?: string;
  formats?: ArtifactRenderFormat[];
}

export const ArtifactExportFileRequestSchema = z
  .object({
    directory: z.string().min(1).optional(),
    formats: z.array(ArtifactRenderFormatSchema).min(1).optional(),
  })
  .strict() satisfies z.ZodType<ArtifactExportFileRequest>;

export interface ArtifactExportRequest {
  file?: ArtifactExportFileRequest;
}

export const ArtifactExportRequestSchema = z
  .object({
    file: ArtifactExportFileRequestSchema.optional(),
  })
  .strict() satisfies z.ZodType<ArtifactExportRequest>;

export interface ArtifactExportedFile {
  format: ArtifactRenderFormat;
  path: string;
}

export const ArtifactExportedFileSchema = z.object({
  format: ArtifactRenderFormatSchema,
  path: z.string().min(1),
}) satisfies z.ZodType<ArtifactExportedFile>;

export interface ArtifactExportResult {
  files: ArtifactExportedFile[];
}

export const ArtifactExportResultSchema = z.object({
  files: z.array(ArtifactExportedFileSchema),
}) satisfies z.ZodType<ArtifactExportResult>;

export interface ImplementationHandoffArtifactToolInput {
  projectId?: string;
  projectRef?: string;
  queryKind: QueryKind;
  queryText: string;
  queryArgs?: JsonObject;
  sessionLimit?: number;
  // 7.5 close: cap on how many recent workflow_followup records the tool
  // will attach as basis + payload. Default is 3 — enough to carry
  // continuation without making the handoff noisy.
  followupLimit?: number;
  export?: ArtifactExportRequest;
}

export const ImplementationHandoffArtifactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  queryArgs: JsonObjectSchema.optional(),
  sessionLimit: z.number().int().positive().max(32).optional(),
  followupLimit: z.number().int().positive().max(32).optional(),
  export: ArtifactExportRequestSchema.optional(),
}).strict() satisfies z.ZodType<ImplementationHandoffArtifactToolInput>;

export interface ImplementationHandoffArtifactToolOutput {
  toolName: "implementation_handoff_artifact";
  projectId: string;
  result: ImplementationHandoffArtifact;
  exported?: ArtifactExportResult;
}

export const ImplementationHandoffArtifactToolOutputSchema = z.object({
  toolName: z.literal("implementation_handoff_artifact"),
  projectId: z.string().min(1),
  result: ImplementationHandoffArtifactSchema,
  exported: ArtifactExportResultSchema.optional(),
}) satisfies z.ZodType<ImplementationHandoffArtifactToolOutput>;

export interface TaskPreflightArtifactToolInput {
  projectId?: string;
  projectRef?: string;
  queryKind: QueryKind;
  queryText: string;
  queryArgs?: JsonObject;
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
  export?: ArtifactExportRequest;
}

export const TaskPreflightArtifactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  queryArgs: JsonObjectSchema.optional(),
  startEntity: GraphNodeLocatorSchema,
  targetEntity: GraphNodeLocatorSchema,
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
  export: ArtifactExportRequestSchema.optional(),
}).strict() satisfies z.ZodType<TaskPreflightArtifactToolInput>;

export interface TaskPreflightArtifactToolOutput {
  toolName: "task_preflight_artifact";
  projectId: string;
  result: TaskPreflightArtifact;
  exported?: ArtifactExportResult;
}

export const TaskPreflightArtifactToolOutputSchema = z.object({
  toolName: z.literal("task_preflight_artifact"),
  projectId: z.string().min(1),
  result: TaskPreflightArtifactSchema,
  exported: ArtifactExportResultSchema.optional(),
}) satisfies z.ZodType<TaskPreflightArtifactToolOutput>;

export interface ReviewBundleArtifactToolInput {
  projectId?: string;
  projectRef?: string;
  queryKind: QueryKind;
  queryText: string;
  queryArgs?: JsonObject;
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
  includeTenantAudit?: boolean;
  freshenTenantAudit?: boolean;
  // 7.5 close for the 7.0 basis drift: impact_packet + diagnostics default
  // on (closes the 7.0 advertised basis). Callers may still opt out if they
  // need a faster minimal bundle, but the default path is the full basis.
  includeImpactPacket?: boolean;
  includeDiagnostics?: boolean;
  export?: ArtifactExportRequest;
}

export const ReviewBundleArtifactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  queryArgs: JsonObjectSchema.optional(),
  startEntity: GraphNodeLocatorSchema,
  targetEntity: GraphNodeLocatorSchema,
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
  includeTenantAudit: z.boolean().optional(),
  freshenTenantAudit: z.boolean().optional(),
  includeImpactPacket: z.boolean().optional(),
  includeDiagnostics: z.boolean().optional(),
  export: ArtifactExportRequestSchema.optional(),
}).strict() satisfies z.ZodType<ReviewBundleArtifactToolInput>;

export interface ReviewBundleArtifactToolOutput {
  toolName: "review_bundle_artifact";
  projectId: string;
  result: ReviewBundleArtifact;
  exported?: ArtifactExportResult;
}

export const ReviewBundleArtifactToolOutputSchema = z.object({
  toolName: z.literal("review_bundle_artifact"),
  projectId: z.string().min(1),
  result: ReviewBundleArtifactSchema,
  exported: ArtifactExportResultSchema.optional(),
}) satisfies z.ZodType<ReviewBundleArtifactToolOutput>;

export interface VerificationBundleArtifactToolInput {
  projectId?: string;
  projectRef?: string;
  queryKind: QueryKind;
  queryText: string;
  queryArgs?: JsonObject;
  includeTenantAudit?: boolean;
  freshenTenantAudit?: boolean;
  includeSessionHandoff?: boolean;
  includeIssuesNext?: boolean;
  sessionLimit?: number;
  issuesLimit?: number;
  // 7.5 close for the unused `trust_run` / `trust_evaluation` basis kinds.
  // When `traceId` is provided (or derived from sessionHandoff/issuesNext
  // current focus), the bundle attaches the latest trust run + evaluation
  // so a verifier can see whether the prior answer for this scope is
  // stable / aging / contradicted before signing off.
  traceId?: string;
  export?: ArtifactExportRequest;
}

export const VerificationBundleArtifactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  queryArgs: JsonObjectSchema.optional(),
  includeTenantAudit: z.boolean().optional(),
  freshenTenantAudit: z.boolean().optional(),
  includeSessionHandoff: z.boolean().optional(),
  includeIssuesNext: z.boolean().optional(),
  sessionLimit: z.number().int().positive().max(32).optional(),
  issuesLimit: z.number().int().positive().max(32).optional(),
  traceId: z.string().min(1).optional(),
  export: ArtifactExportRequestSchema.optional(),
}).strict() satisfies z.ZodType<VerificationBundleArtifactToolInput>;

export interface VerificationBundleArtifactToolOutput {
  toolName: "verification_bundle_artifact";
  projectId: string;
  result: VerificationBundleArtifact;
  exported?: ArtifactExportResult;
}

export const VerificationBundleArtifactToolOutputSchema = z.object({
  toolName: z.literal("verification_bundle_artifact"),
  projectId: z.string().min(1),
  result: VerificationBundleArtifactSchema,
  exported: ArtifactExportResultSchema.optional(),
}) satisfies z.ZodType<VerificationBundleArtifactToolOutput>;
