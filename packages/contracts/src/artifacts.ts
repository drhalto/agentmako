import { z } from "zod";
import type { JsonObject, JsonValue, Timestamp } from "./common.js";

// Recursive JSON validation for artifact metadata. The shared JsonObjectSchema
// used elsewhere in contracts is a loose cast; 7.0 enforces the real shape so
// `metadata: JsonObject` does not lie about what persistence / export can see.
const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ArtifactJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(ArtifactJsonValueSchema), z.record(ArtifactJsonValueSchema)]),
);
const ArtifactJsonObjectSchema: z.ZodType<JsonObject> = z.record(ArtifactJsonValueSchema);

/**
 * Roadmap 7 generated-artifact contract.
 *
 * Concrete payload types and generators land in 7.1 / 7.2.
 * This file defines only the shared shape that every artifact family must
 * honor: typed basis refs, freshness, refresh/replay, consumer targets,
 * and JSON-first rendering.
 */

export const ARTIFACT_KINDS = [
  "task_preflight",
  "implementation_handoff",
  "review_bundle",
  "verification_bundle",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

export const ARTIFACT_BASIS_KINDS = [
  "workflow_packet",
  "workflow_result",
  "trust_run",
  "trust_evaluation",
  "workflow_followup",
  "reference_document",
] as const;
export type ArtifactBasisKind = (typeof ARTIFACT_BASIS_KINDS)[number];
export const ArtifactBasisKindSchema = z.enum(ARTIFACT_BASIS_KINDS);

export const ARTIFACT_BASIS_ORIGINS = ["local", "reference"] as const;
export type ArtifactBasisOrigin = (typeof ARTIFACT_BASIS_ORIGINS)[number];
export const ArtifactBasisOriginSchema = z.enum(ARTIFACT_BASIS_ORIGINS);

export interface ArtifactBasisRef {
  basisRefId: string;
  kind: ArtifactBasisKind;
  sourceId: string;
  fingerprint: string;
  sourceOrigin: ArtifactBasisOrigin;
  label?: string;
}

export const ArtifactBasisRefSchema = z.object({
  basisRefId: z.string().min(1),
  kind: ArtifactBasisKindSchema,
  sourceId: z.string().min(1),
  fingerprint: z.string().min(1),
  sourceOrigin: ArtifactBasisOriginSchema,
  label: z.string().min(1).optional(),
}) satisfies z.ZodType<ArtifactBasisRef>;

export const ARTIFACT_FRESHNESS_STATES = ["fresh", "stale"] as const;
export type ArtifactFreshnessState = (typeof ARTIFACT_FRESHNESS_STATES)[number];
export const ArtifactFreshnessStateSchema = z.enum(ARTIFACT_FRESHNESS_STATES);

export const ARTIFACT_STALE_BEHAVIORS = ["warn_and_keep"] as const;
export type ArtifactStaleBehavior = (typeof ARTIFACT_STALE_BEHAVIORS)[number];
export const ArtifactStaleBehaviorSchema = z.enum(ARTIFACT_STALE_BEHAVIORS);

export const DEFAULT_ARTIFACT_STALE_BEHAVIOR: ArtifactStaleBehavior = "warn_and_keep";

export interface ArtifactFreshness {
  state: ArtifactFreshnessState;
  staleBehavior: ArtifactStaleBehavior;
  staleBasisRefIds: string[];
  evaluatedAt: Timestamp;
}

export const ArtifactFreshnessSchema = z.object({
  state: ArtifactFreshnessStateSchema,
  staleBehavior: ArtifactStaleBehaviorSchema,
  staleBasisRefIds: z.array(z.string().min(1)),
  evaluatedAt: z.string().min(1),
}) satisfies z.ZodType<ArtifactFreshness>;

export const ARTIFACT_CONSUMER_TARGETS = [
  "harness",
  "cli",
  "external_agent",
  "file_export",
  "editor",
  "ci",
  "hook",
] as const;
export type ArtifactConsumerTarget = (typeof ARTIFACT_CONSUMER_TARGETS)[number];
export const ArtifactConsumerTargetSchema = z.enum(ARTIFACT_CONSUMER_TARGETS);

export const ARTIFACT_RENDER_FORMATS = ["json", "markdown", "text"] as const;
export type ArtifactRenderFormat = (typeof ARTIFACT_RENDER_FORMATS)[number];
export const ArtifactRenderFormatSchema = z.enum(ARTIFACT_RENDER_FORMATS);

export interface ArtifactRendering {
  format: ArtifactRenderFormat;
  body: string;
}

export const ArtifactRenderingSchema = z
  .object({
    format: ArtifactRenderFormatSchema,
    body: z.string(),
  })
  .superRefine((rendering, ctx) => {
    if (rendering.format !== "json") return;
    try {
      JSON.parse(rendering.body);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: `json rendering body must be valid JSON: ${(error as Error).message}`,
      });
    }
  }) satisfies z.ZodType<ArtifactRendering>;

export interface ArtifactExportIntent {
  exportable: boolean;
  defaultTargets: ArtifactConsumerTarget[];
}

export const ArtifactExportIntentSchema = z.object({
  exportable: z.boolean(),
  defaultTargets: z.array(ArtifactConsumerTargetSchema),
}) satisfies z.ZodType<ArtifactExportIntent>;

export interface ArtifactBase<TKind extends ArtifactKind, TPayload> {
  artifactId: string;
  kind: TKind;
  projectId: string;
  title: string;
  generatedAt: Timestamp;
  basis: ArtifactBasisRef[];
  freshness: ArtifactFreshness;
  consumerTargets: ArtifactConsumerTarget[];
  exportIntent: ArtifactExportIntent;
  payload: TPayload;
  renderings: ArtifactRendering[];
  supersedesArtifactId?: string;
  metadata?: JsonObject;
}

// Concrete artifact families (7.1 / 7.2) extend this with their payload schema
// and pass the resulting z.object() through `refineArtifactShape` so freshness,
// basis, and rendering invariants are enforced consistently across families.
export const ArtifactBaseShape = {
  artifactId: z.string().min(1),
  kind: ArtifactKindSchema,
  projectId: z.string().min(1),
  title: z.string().min(1),
  generatedAt: z.string().min(1),
  basis: z.array(ArtifactBasisRefSchema).min(1),
  freshness: ArtifactFreshnessSchema,
  consumerTargets: z.array(ArtifactConsumerTargetSchema).min(1),
  exportIntent: ArtifactExportIntentSchema,
  renderings: z.array(ArtifactRenderingSchema).min(1),
  supersedesArtifactId: z.string().min(1).optional(),
  metadata: ArtifactJsonObjectSchema.optional(),
} as const;

type ArtifactShape = {
  basis: ArtifactBasisRef[];
  freshness: ArtifactFreshness;
  renderings: ArtifactRendering[];
  consumerTargets: ArtifactConsumerTarget[];
  exportIntent: ArtifactExportIntent;
};

export function refineArtifactShape<TSchema extends z.ZodType<ArtifactShape>>(
  schema: TSchema,
): z.ZodEffects<TSchema> {
  return schema.superRefine((artifact, ctx) => {
    if (!artifact.renderings.some((rendering) => rendering.format === "json")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renderings"],
        message: "artifact must include at least one json rendering (canonical projection)",
      });
    }

    const basisIds = new Set(artifact.basis.map((ref) => ref.basisRefId));
    const { state, staleBasisRefIds } = artifact.freshness;
    if (state === "fresh" && staleBasisRefIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freshness", "staleBasisRefIds"],
        message: "fresh artifacts must have no stale basis refs",
      });
    }
    if (state === "stale" && staleBasisRefIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freshness", "state"],
        message: "stale artifacts must list at least one stale basis ref",
      });
    }
    for (const staleId of staleBasisRefIds) {
      if (!basisIds.has(staleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["freshness", "staleBasisRefIds"],
          message: `stale basis ref "${staleId}" does not appear in basis`,
        });
      }
    }

    const { exportable, defaultTargets } = artifact.exportIntent;
    if (!exportable && defaultTargets.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exportIntent", "defaultTargets"],
        message: "non-exportable artifacts must not declare default export targets",
      });
    }
    const consumerTargetSet = new Set(artifact.consumerTargets);
    for (const target of defaultTargets) {
      if (!consumerTargetSet.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exportIntent", "defaultTargets"],
          message: `export target "${target}" must also appear in consumerTargets`,
        });
      }
    }
  });
}

// Structural shape check used by smoke/tests.
export const GenericArtifactSchema = refineArtifactShape(
  z.object({
    ...ArtifactBaseShape,
    payload: z.unknown(),
  }),
);

/**
 * Refresh regenerates an artifact using current basis state and supersedes
 * the prior artifact. `unchanged` means nothing in basis actually moved.
 * Generators live in 7.1 / 7.2; this file only declares the result shape.
 */
export const ARTIFACT_REFRESH_OUTCOMES = ["refreshed", "unchanged"] as const;
export type ArtifactRefreshOutcome = (typeof ARTIFACT_REFRESH_OUTCOMES)[number];

export interface ArtifactRefreshResult<TArtifact extends ArtifactBase<ArtifactKind, unknown>> {
  outcome: ArtifactRefreshOutcome;
  artifact: TArtifact | null;
  supersedesArtifactId: string | null;
  // basis refs whose identity or fingerprint shifted between the previous
  // artifact and the new one. Empty when outcome === "unchanged". Populated
  // with the exact basisRefIds that moved when outcome === "refreshed".
  // Matches the continue-main / openclaw pattern of surfacing "what changed"
  // at refresh time instead of running an ambient staleness watcher.
  changedBasisRefIds: string[];
  reason?: string;
}

/**
 * Replay rebuilds an artifact from its recorded basis refs without
 * consulting current state. Used for audit and handoff continuity.
 */
export const ARTIFACT_REPLAY_OUTCOMES = ["replayed"] as const;
export type ArtifactReplayOutcome = (typeof ARTIFACT_REPLAY_OUTCOMES)[number];

export interface ArtifactReplayResult<TArtifact extends ArtifactBase<ArtifactKind, unknown>> {
  outcome: ArtifactReplayOutcome;
  artifact: TArtifact;
}

export interface ArtifactTextEntry {
  itemId: string;
  text: string;
  basisRefIds: string[];
}

export const ArtifactTextEntrySchema = z.object({
  itemId: z.string().min(1),
  text: z.string().min(1),
  basisRefIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ArtifactTextEntry>;

export interface ArtifactReadItem {
  itemId: string;
  title: string;
  detail: string;
  basisRefIds: string[];
}

export const ArtifactReadItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  basisRefIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ArtifactReadItem>;

export const ArtifactChangeSurfaceRoleSchema = z.enum(["direct", "dependent"]);
export type ArtifactChangeSurfaceRole = z.infer<typeof ArtifactChangeSurfaceRoleSchema>;

export interface ArtifactChangeSurface {
  surfaceId: string;
  title: string;
  nodeLabel: string;
  role: ArtifactChangeSurfaceRole;
  dependsOnStepIds: string[];
  rationale: string;
  containsHeuristicEdge: boolean;
  basisRefIds: string[];
}

export const ArtifactChangeSurfaceSchema = z.object({
  surfaceId: z.string().min(1),
  title: z.string().min(1),
  nodeLabel: z.string().min(1),
  role: ArtifactChangeSurfaceRoleSchema,
  dependsOnStepIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  containsHeuristicEdge: z.boolean(),
  basisRefIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ArtifactChangeSurface>;

export interface TaskPreflightArtifactPayload {
  summary: string;
  pathOverview?: string;
  readFirst: ArtifactReadItem[];
  likelyMoveSurfaces: ArtifactChangeSurface[];
  verifyBeforeStart: ArtifactTextEntry[];
  activeRisks: ArtifactTextEntry[];
}

export const TaskPreflightArtifactPayloadSchema = z.object({
  summary: z.string().min(1),
  pathOverview: z.string().min(1).optional(),
  readFirst: z.array(ArtifactReadItemSchema).min(1),
  // `likelyMoveSurfaces` intentionally allows `[]`. Change plans can
  // legitimately return zero surfaces when the graph has no path between
  // start and target, and a hard schema failure in that case turns a real
  // user question into an opaque validation error. The markdown renderer
  // explicitly surfaces the empty-state instead.
  likelyMoveSurfaces: z.array(ArtifactChangeSurfaceSchema),
  verifyBeforeStart: z.array(ArtifactTextEntrySchema).min(1),
  activeRisks: z.array(ArtifactTextEntrySchema),
}) satisfies z.ZodType<TaskPreflightArtifactPayload>;

export interface ImplementationHandoffCurrentFocus {
  traceId: string;
  queryText: string;
  reason: string;
  stopWhen: string[];
  basisRefIds: string[];
}

export const ImplementationHandoffCurrentFocusSchema = z.object({
  traceId: z.string().min(1),
  queryText: z.string().min(1),
  reason: z.string().min(1),
  stopWhen: z.array(z.string().min(1)).min(1),
  basisRefIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ImplementationHandoffCurrentFocus>;

export interface ImplementationHandoffArtifactPayload {
  summary: string;
  currentFocus?: ImplementationHandoffCurrentFocus;
  keyContext: ArtifactTextEntry[];
  activeRisks: ArtifactTextEntry[];
  followUps: ArtifactTextEntry[];
  // 7.5 close: surfaces actual `workflow_followup` records so the handoff
  // carries the continuation that R5/R6 tracking was designed for. Empty is
  // legitimate (fresh session, no follow-ups yet); entries are derived from
  // projectStore.queryWorkflowFollowups.
  priorFollowups: ArtifactTextEntry[];
}

export const ImplementationHandoffArtifactPayloadSchema = z.object({
  summary: z.string().min(1),
  currentFocus: ImplementationHandoffCurrentFocusSchema.optional(),
  keyContext: z.array(ArtifactTextEntrySchema).min(1),
  activeRisks: z.array(ArtifactTextEntrySchema),
  followUps: z.array(ArtifactTextEntrySchema).min(1),
  priorFollowups: z.array(ArtifactTextEntrySchema),
}) satisfies z.ZodType<ImplementationHandoffArtifactPayload>;

export interface ReviewBundleArtifactPayload {
  summary: string;
  pathOverview?: string;
  inspectFirst: ArtifactReadItem[];
  reviewSurfaces: ArtifactChangeSurface[];
  reviewerChecks: ArtifactTextEntry[];
  activeRisks: ArtifactTextEntry[];
  directOperatorFindings: ArtifactTextEntry[];
  weakOperatorSignals: ArtifactTextEntry[];
  // 7.5 close for the 7.0 disambiguation-table basis gap: review_bundle was
  // advertised with `change_plan + impact_packet + diagnostics` but 7.2
  // shipped without impact_packet or diagnostics. These two sections close
  // that gap so the bundle is strictly stronger than reaching for the raw
  // underlying tools. Empty is legitimate (no impact items resolved / no
  // findings on the change surfaces); the renderer surfaces the empty-state
  // explicitly instead of failing validation.
  impactZones: ArtifactTextEntry[];
  diagnosticFindings: ArtifactTextEntry[];
}

export const ReviewBundleArtifactPayloadSchema = z.object({
  summary: z.string().min(1),
  pathOverview: z.string().min(1).optional(),
  inspectFirst: z.array(ArtifactReadItemSchema).min(1),
  // `reviewSurfaces` mirrors `likelyMoveSurfaces` above: empty is a valid
  // outcome when the graph can't find a change path, and the markdown
  // renderer surfaces the empty-state rather than throwing validation.
  reviewSurfaces: z.array(ArtifactChangeSurfaceSchema),
  reviewerChecks: z.array(ArtifactTextEntrySchema).min(1),
  activeRisks: z.array(ArtifactTextEntrySchema),
  directOperatorFindings: z.array(ArtifactTextEntrySchema),
  weakOperatorSignals: z.array(ArtifactTextEntrySchema),
  impactZones: z.array(ArtifactTextEntrySchema),
  diagnosticFindings: z.array(ArtifactTextEntrySchema),
}) satisfies z.ZodType<ReviewBundleArtifactPayload>;

// 7.5 close for the unused `trust_run` / `trust_evaluation` basis kinds.
// verification_bundle carries a typed trust snapshot when a traceId is in
// scope (from the caller or session focus). The projection stays minimal —
// state + reason codes + scope relation — so the payload is useful to a
// verifier without duplicating the full trust evaluation record.
export type VerificationBundleTrustStateGrade =
  | "stable"
  | "changed"
  | "aging"
  | "stale"
  | "superseded"
  | "contradicted"
  | "insufficient_evidence";

export type VerificationBundleTrustScopeRelation =
  | "none"
  | "same_scope"
  | "changed_scope"
  | "backtested_old_scope";

export interface VerificationBundleTrustState {
  traceId: string;
  state: VerificationBundleTrustStateGrade;
  scopeRelation: VerificationBundleTrustScopeRelation;
  reasons: string[];
  evaluatedAt: Timestamp;
  basisRefIds: string[];
}

export const VerificationBundleTrustStateSchema = z.object({
  traceId: z.string().min(1),
  state: z.enum([
    "stable",
    "changed",
    "aging",
    "stale",
    "superseded",
    "contradicted",
    "insufficient_evidence",
  ]),
  scopeRelation: z.enum(["none", "same_scope", "changed_scope", "backtested_old_scope"]),
  reasons: z.array(z.string().min(1)),
  evaluatedAt: z.string().min(1),
  basisRefIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<VerificationBundleTrustState>;

export interface VerificationBundleArtifactPayload {
  summary: string;
  baselineChecks: ArtifactTextEntry[];
  requiredChecks: ArtifactTextEntry[];
  stopConditions: ArtifactTextEntry[];
  changeManagementChecks: ArtifactTextEntry[];
  directOperatorFindings: ArtifactTextEntry[];
  weakOperatorSignals: ArtifactTextEntry[];
  trustState?: VerificationBundleTrustState;
}

export const VerificationBundleArtifactPayloadSchema = z.object({
  summary: z.string().min(1),
  baselineChecks: z.array(ArtifactTextEntrySchema).min(1),
  requiredChecks: z.array(ArtifactTextEntrySchema).min(1),
  stopConditions: z.array(ArtifactTextEntrySchema).min(1),
  changeManagementChecks: z.array(ArtifactTextEntrySchema),
  directOperatorFindings: z.array(ArtifactTextEntrySchema),
  weakOperatorSignals: z.array(ArtifactTextEntrySchema),
  trustState: VerificationBundleTrustStateSchema.optional(),
}) satisfies z.ZodType<VerificationBundleArtifactPayload>;

export type TaskPreflightArtifact = ArtifactBase<
  "task_preflight",
  TaskPreflightArtifactPayload
>;

export type ImplementationHandoffArtifact = ArtifactBase<
  "implementation_handoff",
  ImplementationHandoffArtifactPayload
>;

export type ReviewBundleArtifact = ArtifactBase<"review_bundle", ReviewBundleArtifactPayload>;

export type VerificationBundleArtifact = ArtifactBase<
  "verification_bundle",
  VerificationBundleArtifactPayload
>;

export const TaskPreflightArtifactSchema = refineArtifactShape(
  z.object({
    ...ArtifactBaseShape,
    kind: z.literal("task_preflight"),
    payload: TaskPreflightArtifactPayloadSchema,
  }),
) satisfies z.ZodType<TaskPreflightArtifact>;

export const ImplementationHandoffArtifactSchema = refineArtifactShape(
  z.object({
    ...ArtifactBaseShape,
    kind: z.literal("implementation_handoff"),
    payload: ImplementationHandoffArtifactPayloadSchema,
  }),
) satisfies z.ZodType<ImplementationHandoffArtifact>;

export const ReviewBundleArtifactSchema = refineArtifactShape(
  z.object({
    ...ArtifactBaseShape,
    kind: z.literal("review_bundle"),
    payload: ReviewBundleArtifactPayloadSchema,
  }),
) satisfies z.ZodType<ReviewBundleArtifact>;

export const VerificationBundleArtifactSchema = refineArtifactShape(
  z.object({
    ...ArtifactBaseShape,
    kind: z.literal("verification_bundle"),
    payload: VerificationBundleArtifactPayloadSchema,
  }),
) satisfies z.ZodType<VerificationBundleArtifact>;
