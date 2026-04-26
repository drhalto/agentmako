import type {
  AnswerSurfaceIssue,
  ArtifactBase,
  ArtifactBasisRef,
  ArtifactExportIntent,
  ArtifactKind,
  ArtifactRefreshResult,
  ArtifactReplayResult,
  ArtifactRendering,
  ArtifactTextEntry,
  ChangePlanResult,
  ChangePlanSurface,
  FlowMapResult,
  GraphNode,
  ImplementationHandoffArtifact,
  ImplementationHandoffCurrentFocus,
  ImplementationHandoffArtifactToolInput,
  ImplementationHandoffArtifactToolOutput,
  IssuesNextResult,
  JsonObject,
  ArtifactChangeSurface,
  ArtifactReadItem,
  ReviewBundleArtifactToolInput,
  ReviewBundleArtifactToolOutput,
  ReviewBundleArtifact,
  SessionHandoffResult,
  TaskPreflightArtifact,
  TaskPreflightArtifactToolInput,
  TaskPreflightArtifactToolOutput,
  TenantLeakAuditResult,
  VerificationBundleArtifactToolInput,
  VerificationBundleArtifactToolOutput,
  VerificationBundleArtifact,
  VerificationBundleTrustState,
  WorkflowImpactPacket,
  WorkflowImplementationBriefPacket,
  WorkflowPacketSurface,
  WorkflowVerificationPlanPacket,
} from "@mako-ai/contracts";
import {
  DEFAULT_ARTIFACT_STALE_BEHAVIOR,
  ImplementationHandoffArtifactSchema,
  ReviewBundleArtifactSchema,
  TaskPreflightArtifactSchema,
  VerificationBundleArtifactSchema,
} from "@mako-ai/contracts";
import type {
  AnswerTrustEvaluationRecord,
  AnswerTrustRunRecord,
  WorkflowFollowupRecord,
} from "@mako-ai/store";
import { hashJson } from "@mako-ai/store";
import { collectDiagnosticsForFiles } from "../diagnostics/index.js";
import { changePlanTool, flowMapTool } from "../graph/index.js";
import { tenantLeakAuditTool } from "../operators/index.js";
import { buildSessionHandoffResult } from "../project-intelligence/index.js";
import { buildIssuesNextResult } from "../project-intelligence/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { generateWorkflowPacketSurfaceForQuery } from "../workflow-packets/surfaces.js";
import { exportArtifactToFile } from "./export.js";

type PacketSurfaceForFamily<TPacket> = Omit<WorkflowPacketSurface, "packet"> & { packet: TPacket };

export interface ArtifactGenerationOptions {
  generatedAt?: string;
  metadata?: JsonObject;
  additionalBasis?: ArtifactBasisRef[];
}

export interface TaskPreflightArtifactInput extends ArtifactGenerationOptions {
  projectId: string;
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  verificationPlan: PacketSurfaceForFamily<WorkflowVerificationPlanPacket>;
  changePlan: ChangePlanResult;
  flowMap?: FlowMapResult;
}

export interface ImplementationHandoffArtifactInput extends ArtifactGenerationOptions {
  projectId: string;
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  sessionHandoff: SessionHandoffResult;
  // 7.5 close: `workflow_followup` records scoped to this handoff. The tool
  // layer populates this via projectStore.queryWorkflowFollowups; passing it
  // through the generator keeps the pure/in-memory surface testable without
  // a live store.
  workflowFollowups?: WorkflowFollowupRecord[];
}

// 7.5 close for the 7.0 basis drift — impact_packet surface and diagnostics
// findings scoped to the change plan are now load-bearing review_bundle
// inputs. The generator keeps them optional only so focused unit smokes can
// construct a bundle without re-running the full tool plane; the tool layer
// populates them by default when `includeImpactPacket` / `includeDiagnostics`
// are on (they default to true).
export interface ReviewBundleDiagnosticsInput {
  findings: AnswerSurfaceIssue[];
  focusFiles: string[];
}

export interface ReviewBundleArtifactInput extends ArtifactGenerationOptions {
  projectId: string;
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  changePlan: ChangePlanResult;
  flowMap?: FlowMapResult;
  tenantLeakAudit?: TenantLeakAuditResult;
  impactPacket?: PacketSurfaceForFamily<WorkflowImpactPacket>;
  diagnostics?: ReviewBundleDiagnosticsInput;
}

export interface VerificationBundleArtifactInput extends ArtifactGenerationOptions {
  projectId: string;
  verificationPlan: PacketSurfaceForFamily<WorkflowVerificationPlanPacket>;
  tenantLeakAudit?: TenantLeakAuditResult;
  issuesNext?: IssuesNextResult;
  sessionHandoff?: SessionHandoffResult;
  // 7.5 close for unused trust basis kinds. Both are optional because not
  // every verification call has a trace in scope; when one is present, the
  // generator emits `trust_run` / `trust_evaluation` basis refs and surfaces
  // the trust state in the payload.
  trustRun?: AnswerTrustRunRecord;
  trustEvaluation?: AnswerTrustEvaluationRecord;
}

const TASK_PREFLIGHT_VERSION = 1;
const IMPLEMENTATION_HANDOFF_VERSION = 1;
const REVIEW_BUNDLE_VERSION = 1;
const VERIFICATION_BUNDLE_VERSION = 1;
// Declared intended consumers for the artifact family. With 7.4 file export
// shipping across all four families, file_export is a declared capability on
// every artifact — whether a given tool call actually writes files is a
// separate caller opt-in through the `export` input.
const DEFAULT_ARTIFACT_CONSUMER_TARGETS = [
  "harness",
  "cli",
  "external_agent",
  "file_export",
] as const;
const DEFAULT_ARTIFACT_EXPORT_INTENT: ArtifactExportIntent = {
  exportable: true,
  defaultTargets: ["file_export"],
};

type ArtifactRenderingSource<TKind extends ArtifactKind, TPayload> = Pick<
  ArtifactBase<TKind, TPayload>,
  | "artifactId"
  | "kind"
  | "projectId"
  | "title"
  | "generatedAt"
  | "basis"
  | "freshness"
  | "consumerTargets"
  | "exportIntent"
  | "payload"
  | "supersedesArtifactId"
  | "metadata"
>;

type RecordedArtifact =
  | TaskPreflightArtifact
  | ImplementationHandoffArtifact
  | ReviewBundleArtifact
  | VerificationBundleArtifact;

function nowTimestamp(): string {
  return new Date().toISOString();
}

function ensureProjectMatch(projectId: string, packetProjectId: string, label: string): void {
  if (projectId !== packetProjectId) {
    throw new Error(`${label} projectId ${packetProjectId} does not match artifact projectId ${projectId}.`);
  }
}

function ensureImplementationBriefSurface(
  surface: WorkflowPacketSurface,
): asserts surface is PacketSurfaceForFamily<WorkflowImplementationBriefPacket> {
  if (surface.packet.family !== "implementation_brief") {
    throw new Error(`expected implementation_brief surface, received ${surface.packet.family}`);
  }
}

function ensureVerificationPlanSurface(
  surface: WorkflowPacketSurface,
): asserts surface is PacketSurfaceForFamily<WorkflowVerificationPlanPacket> {
  if (surface.packet.family !== "verification_plan") {
    throw new Error(`expected verification_plan surface, received ${surface.packet.family}`);
  }
}

function ensureImpactPacketSurface(
  surface: WorkflowPacketSurface,
): asserts surface is PacketSurfaceForFamily<WorkflowImpactPacket> {
  if (surface.packet.family !== "impact_packet") {
    throw new Error(`expected impact_packet surface, received ${surface.packet.family}`);
  }
}

function mergeBasisRefs(primary: readonly ArtifactBasisRef[], additional: readonly ArtifactBasisRef[] = []): ArtifactBasisRef[] {
  const merged = new Map<string, ArtifactBasisRef>();
  for (const ref of [...primary, ...additional]) {
    const existing = merged.get(ref.basisRefId);
    if (!existing) {
      merged.set(ref.basisRefId, ref);
      continue;
    }
    if (existing.fingerprint !== ref.fingerprint) {
      throw new Error(
        `basis ref collision for ${ref.basisRefId}: conflicting fingerprints ${existing.fingerprint} vs ${ref.fingerprint}`,
      );
    }
  }
  return [...merged.values()];
}

function createBasisRef(input: {
  kind: ArtifactBasisRef["kind"];
  sourceId: string;
  fingerprint: string;
  sourceOrigin: ArtifactBasisRef["sourceOrigin"];
  label?: string;
}): ArtifactBasisRef {
  return {
    basisRefId: `artifact_basis_${hashJson({ kind: input.kind, sourceId: input.sourceId })}`,
    kind: input.kind,
    sourceId: input.sourceId,
    fingerprint: input.fingerprint,
    sourceOrigin: input.sourceOrigin,
    ...(input.label ? { label: input.label } : {}),
  };
}

function buildWorkflowPacketBasisRef(surface: WorkflowPacketSurface): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_packet",
    sourceId: surface.packet.packetId,
    fingerprint: hashJson(surface.packet),
    sourceOrigin: "local",
    label: surface.packet.title,
  });
}

function buildChangePlanBasisRef(result: ChangePlanResult): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `change_plan:${hashJson({
      start: result.requestedStartEntity,
      target: result.requestedTargetEntity,
      direction: result.direction,
      traversalDepth: result.traversalDepth,
      includeHeuristicEdges: result.includeHeuristicEdges,
    })}`,
    fingerprint: hashJson(result),
    sourceOrigin: "local",
    label: `change plan ${result.requestedStartEntity.key} -> ${result.requestedTargetEntity.key}`,
  });
}

function buildFlowMapBasisRef(result: FlowMapResult): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `flow_map:${hashJson({
      start: result.requestedStartEntity,
      target: result.requestedTargetEntity,
      direction: result.direction,
      traversalDepth: result.traversalDepth,
      includeHeuristicEdges: result.includeHeuristicEdges,
    })}`,
    fingerprint: hashJson(result),
    sourceOrigin: "local",
    label: `flow map ${result.requestedStartEntity.key} -> ${result.requestedTargetEntity.key}`,
  });
}

function buildSessionHandoffBasisRef(result: SessionHandoffResult): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `session_handoff:${hashJson({
      sourceTraceLimit: result.basis.sourceTraceLimit,
      latestIndexRunId: result.basis.latestIndexRunId ?? null,
      schemaSnapshotId: result.basis.schemaSnapshotId ?? null,
      schemaFingerprint: result.basis.schemaFingerprint ?? null,
    })}`,
    fingerprint: hashJson(result),
    sourceOrigin: "local",
    label: "session handoff",
  });
}

function buildTenantLeakAuditBasisRef(result: TenantLeakAuditResult): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `tenant_leak_audit:${hashJson({
      latestIndexRunId: result.basis.latestIndexRunId ?? null,
      schemaSnapshotId: result.basis.schemaSnapshotId ?? null,
      schemaFingerprint: result.basis.schemaFingerprint ?? null,
      rolloutStage: result.rolloutStage,
    })}`,
    fingerprint: hashJson(result),
    sourceOrigin: "local",
    label: "tenant leak audit",
  });
}

function buildIssuesNextBasisRef(result: IssuesNextResult): ArtifactBasisRef {
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `issues_next:${hashJson({
      sourceTraceLimit: result.basis.sourceTraceLimit,
      latestIndexRunId: result.basis.latestIndexRunId ?? null,
      schemaSnapshotId: result.basis.schemaSnapshotId ?? null,
      schemaFingerprint: result.basis.schemaFingerprint ?? null,
    })}`,
    fingerprint: hashJson(result),
    sourceOrigin: "local",
    label: "issues next",
  });
}

// 7.5 close for `trust_run` / `trust_evaluation` basis kinds. Trust records
// are identity-bound by traceId (run) and evaluationId (evaluation). The
// fingerprint includes the provenance + hashes on the run and the full
// evaluation record so refresh detects any meaningful change.
function buildTrustRunBasisRef(run: AnswerTrustRunRecord): ArtifactBasisRef {
  return createBasisRef({
    kind: "trust_run",
    sourceId: `trust_run:${run.traceId}`,
    fingerprint: hashJson({
      traceId: run.traceId,
      targetId: run.targetId,
      packetHash: run.packetHash,
      rawPacketHash: run.rawPacketHash,
      answerHash: run.answerHash ?? null,
      environmentFingerprint: run.environmentFingerprint,
    }),
    sourceOrigin: "local",
    label: `trust run ${run.traceId}`,
  });
}

function buildTrustEvaluationBasisRef(
  evaluation: AnswerTrustEvaluationRecord,
): ArtifactBasisRef {
  return createBasisRef({
    kind: "trust_evaluation",
    sourceId: `trust_evaluation:${evaluation.evaluationId}`,
    fingerprint: hashJson(evaluation),
    sourceOrigin: "local",
    label: `trust evaluation ${evaluation.state}`,
  });
}

// 7.5 close for `workflow_followup`. Multiple followup records collapse into
// a single aggregate basis ref — the fingerprint covers the identity and
// creation order of every record so refresh notices additions / removals /
// reordering. One aggregate (vs. one-per-record) keeps artifact basis arrays
// readable and eval reason codes coherent.
function buildWorkflowFollowupBasisRef(
  followups: readonly WorkflowFollowupRecord[],
): ArtifactBasisRef {
  const fingerprintSeed = followups.map((record) => ({
    followupId: record.followupId,
    originQueryId: record.originQueryId,
    originActionId: record.originActionId,
    resultPacketFamily: record.resultPacketFamily,
    resultQueryId: record.resultQueryId,
    createdAt: record.createdAt,
  }));
  return createBasisRef({
    kind: "workflow_followup",
    sourceId: `workflow_followups:${hashJson({
      count: followups.length,
      latest: followups[0]?.followupId ?? null,
    })}`,
    fingerprint: hashJson(fingerprintSeed),
    sourceOrigin: "local",
    label: `workflow followups x${followups.length}`,
  });
}

// 7.5 close for the review_bundle diagnostics gap. Diagnostics runs are a
// workflow_result (rule-packs + alignment diagnostics executed against a
// bounded file set) — matches how tenant_leak_audit is treated. The
// fingerprint covers both the finding identities and the scope so refresh
// notices either scope drift or new findings.
function buildDiagnosticsBasisRef(
  findings: readonly AnswerSurfaceIssue[],
  focusFiles: readonly string[],
): ArtifactBasisRef {
  const scopeHash = hashJson({ focusFiles: [...focusFiles].sort() });
  return createBasisRef({
    kind: "workflow_result",
    sourceId: `diagnostics:${scopeHash}`,
    fingerprint: hashJson({
      scopeHash,
      findingIdentities: findings.map((finding) => finding.identity.matchBasedId).sort(),
    }),
    sourceOrigin: "local",
    label: "diagnostics",
  });
}

// Graph nodes expose filePath through `sourceRef` for file/route kinds and
// `sourceRef` of the form `path#line` for symbol kinds. Other kinds (rpc,
// table, etc.) have no useful file path for alignment diagnostics — return
// null and let the caller skip them.
function nodeFilePath(node: GraphNode): string | null {
  if (!node.sourceRef) return null;
  if (node.kind === "file" || node.kind === "route") {
    return node.sourceRef;
  }
  if (node.kind === "symbol") {
    const hashIdx = node.sourceRef.indexOf("#");
    if (hashIdx <= 0) return null;
    return node.sourceRef.slice(0, hashIdx);
  }
  return null;
}

function collectChangePlanFocusFiles(
  surfaces: readonly ChangePlanSurface[],
): string[] {
  const result = new Set<string>();
  for (const surface of surfaces) {
    const filePath = nodeFilePath(surface.node);
    if (filePath && filePath.trim().length > 0) {
      result.add(filePath);
    }
  }
  return [...result];
}

function buildArtifactId(kind: ArtifactKind, version: number, basis: readonly ArtifactBasisRef[]): string {
  const canonicalBasis = [...basis]
    .sort((left, right) => left.basisRefId.localeCompare(right.basisRefId))
    .map((ref) => ({
      basisRefId: ref.basisRefId,
      kind: ref.kind,
      sourceId: ref.sourceId,
      fingerprint: ref.fingerprint,
      sourceOrigin: ref.sourceOrigin,
    }));
  return `artifact_${kind}_${hashJson({
    kind,
    version,
    basis: canonicalBasis,
  })}`;
}

function defaultFreshness(generatedAt: string) {
  return {
    state: "fresh" as const,
    staleBehavior: DEFAULT_ARTIFACT_STALE_BEHAVIOR,
    staleBasisRefIds: [],
    evaluatedAt: generatedAt,
  };
}

function getPacketSectionEntryTexts(
  surface: WorkflowPacketSurface,
  sectionId: string | null | undefined,
): string[] {
  if (!sectionId) return [];
  return surface.packet.sections.find((section) => section.sectionId === sectionId)?.entries.map((entry) => entry.text) ?? [];
}

function createArtifactTextEntry(
  text: string,
  basisRefIds: string[],
  seed: unknown,
): ArtifactTextEntry {
  return {
    itemId: `artifact_entry_${hashJson(seed)}`,
    text,
    basisRefIds,
  };
}

function createArtifactReadItem(
  title: string,
  detail: string,
  basisRefIds: string[],
  seed: unknown,
): ArtifactReadItem {
  return {
    itemId: `artifact_read_${hashJson(seed)}`,
    title,
    detail,
    basisRefIds,
  };
}

function summarizeFlowMap(result: FlowMapResult | undefined): string | undefined {
  if (!result || !result.pathFound || result.steps.length === 0) {
    return undefined;
  }
  const labels = result.steps.map((step) => step.node.label);
  return `Current flow resolves through ${labels.join(" -> ")}.`;
}

function createTaskPreflightPayload(input: {
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  verificationPlan: PacketSurfaceForFamily<WorkflowVerificationPlanPacket>;
  changePlan: ChangePlanResult;
  flowMap?: FlowMapResult;
  implementationBriefBasisRef: ArtifactBasisRef;
  verificationPlanBasisRef: ArtifactBasisRef;
  changePlanBasisRef: ArtifactBasisRef;
}): TaskPreflightArtifact["payload"] {
  const implementationSummary =
    getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.summarySectionId)[0] ??
    input.implementationBrief.packet.title;
  const changeAreas = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.changeAreasSectionId,
  );
  const invariants = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.invariantsSectionId,
  );
  const risks = getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.risksSectionId);
  const baselineItems = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.baselineSectionId,
  );
  const verificationItems = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.verificationSectionId,
  );
  const pathOverview = summarizeFlowMap(input.flowMap);

  const readFirst: ArtifactReadItem[] = [
    createArtifactReadItem(
      "Start here",
      implementationSummary,
      [input.implementationBriefBasisRef.basisRefId],
      { kind: "summary", text: implementationSummary },
    ),
    ...changeAreas.slice(0, 2).map((text, index) =>
      createArtifactReadItem(
        `Change area ${index + 1}`,
        text,
        [input.implementationBriefBasisRef.basisRefId],
        { kind: "change_area", index, text },
      ),
    ),
    ...invariants.slice(0, 1).map((text, index) =>
      createArtifactReadItem(
        `Invariant ${index + 1}`,
        text,
        [input.implementationBriefBasisRef.basisRefId],
        { kind: "invariant", index, text },
      ),
    ),
  ].slice(0, 4);

  const stepBySurfaceId = new Map(input.changePlan.steps.map((step) => [step.surfaceId, step]));
  const likelyMoveSurfaces: ArtifactChangeSurface[] = [
    ...input.changePlan.directSurfaces.map((surface) => ({ surface, roleOrder: 0 })),
    ...input.changePlan.dependentSurfaces.slice(0, 2).map((surface) => ({ surface, roleOrder: 1 })),
  ]
    .sort((left, right) => left.roleOrder - right.roleOrder || left.surface.distance - right.surface.distance)
    .slice(0, 5)
    .map(({ surface }) => {
      const step = stepBySurfaceId.get(surface.surfaceId);
      return {
        surfaceId: surface.surfaceId,
        title: step?.title ?? surface.node.label,
        nodeLabel: surface.node.label,
        role: surface.role,
        dependsOnStepIds: step?.dependsOnStepIds ?? [],
        rationale: surface.rationale,
        containsHeuristicEdge: surface.containsHeuristicEdge,
        basisRefIds: [input.changePlanBasisRef.basisRefId],
      };
    });

  const verifyBeforeStart: ArtifactTextEntry[] = [
    ...baselineItems.slice(0, 1).map((text, index) =>
      createArtifactTextEntry(text, [input.verificationPlanBasisRef.basisRefId], {
        kind: "baseline",
        index,
        text,
      }),
    ),
    ...verificationItems.slice(0, 3).map((text, index) =>
      createArtifactTextEntry(text, [input.verificationPlanBasisRef.basisRefId], {
        kind: "verification",
        index,
        text,
      }),
    ),
  ];

  const activeRisks = risks.slice(0, 3).map((text, index) =>
    createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
      kind: "risk",
      index,
      text,
    }),
  );

  return {
    summary: [implementationSummary, pathOverview].filter(Boolean).join(" "),
    ...(pathOverview ? { pathOverview } : {}),
    readFirst,
    likelyMoveSurfaces,
    verifyBeforeStart,
    activeRisks,
  };
}

function createImplementationHandoffPayload(input: {
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  sessionHandoff: SessionHandoffResult;
  workflowFollowups?: readonly WorkflowFollowupRecord[];
  implementationBriefBasisRef: ArtifactBasisRef;
  sessionHandoffBasisRef: ArtifactBasisRef;
  workflowFollowupsBasisRef?: ArtifactBasisRef;
}): ImplementationHandoffArtifact["payload"] {
  const implementationSummary =
    getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.summarySectionId)[0] ??
    input.implementationBrief.packet.title;
  const changeAreas = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.changeAreasSectionId,
  );
  const invariants = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.invariantsSectionId,
  );
  const risks = getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.risksSectionId);
  const verificationItems = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.verificationSectionId,
  );
  const currentFocus = input.sessionHandoff.currentFocus;

  // Session-derived key context comes first so an agent receiving this
  // handoff immediately sees what's being worked on and how active the
  // session is. Brief-derived context fills the remaining capacity.
  const sessionContext: ArtifactTextEntry[] = [];
  if (currentFocus) {
    sessionContext.push(
      createArtifactTextEntry(
        `Current focus: ${currentFocus.queryText} — ${currentFocus.reason}`,
        [input.sessionHandoffBasisRef.basisRefId],
        { kind: "focus", traceId: currentFocus.traceId },
      ),
    );
  }
  const sessionSummary = input.sessionHandoff.summary;
  if (sessionSummary.unresolvedQueryCount > 0 || sessionSummary.queriesWithFollowups > 0) {
    sessionContext.push(
      createArtifactTextEntry(
        `Session momentum: ${sessionSummary.recentQueryCount} recent, ${sessionSummary.unresolvedQueryCount} unresolved, ${sessionSummary.queriesWithFollowups} with follow-ups.`,
        [input.sessionHandoffBasisRef.basisRefId],
        { kind: "session_summary" },
      ),
    );
  }

  const briefContext: ArtifactTextEntry[] = [
    createArtifactTextEntry(implementationSummary, [input.implementationBriefBasisRef.basisRefId], {
      kind: "summary",
      text: implementationSummary,
    }),
    ...changeAreas.slice(0, 2).map((text, index) =>
      createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
        kind: "change_area",
        index,
        text,
      }),
    ),
    ...invariants.slice(0, 1).map((text, index) =>
      createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
        kind: "invariant",
        index,
        text,
      }),
    ),
  ];

  const keyContext: ArtifactTextEntry[] = [...sessionContext, ...briefContext].slice(0, 5);

  const activeRisks = risks.slice(0, 3).map((text, index) =>
    createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
      kind: "risk",
      index,
      text,
    }),
  );

  const followUps: ArtifactTextEntry[] = [];
  if (currentFocus) {
    currentFocus.stopWhen.forEach((text, index) => {
      followUps.push(
        createArtifactTextEntry(
          `Continue until ${text}`,
          [input.sessionHandoffBasisRef.basisRefId],
          { kind: "focus_stop", index, text },
        ),
      );
    });
  }
  verificationItems.slice(0, 2).forEach((text, index) => {
    followUps.push(
      createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
        kind: "verification",
        index,
        text,
      }),
    );
  });
  if (followUps.length === 0) {
    followUps.push(
      createArtifactTextEntry(
        "Re-run the implementation brief basis before continuing if the current context has drifted.",
        [input.implementationBriefBasisRef.basisRefId, input.sessionHandoffBasisRef.basisRefId],
        { kind: "fallback_followup" },
      ),
    );
  }

  const summary = currentFocus
    ? `Continue with focus on ${currentFocus.queryText}. ${implementationSummary}`
    : `Resume from the current implementation brief. ${implementationSummary}`;

  const normalizedCurrentFocus: ImplementationHandoffCurrentFocus | undefined = currentFocus
    ? {
        traceId: currentFocus.traceId,
        queryText: currentFocus.queryText,
        reason: currentFocus.reason,
        stopWhen: currentFocus.stopWhen,
        basisRefIds: [input.sessionHandoffBasisRef.basisRefId],
      }
    : undefined;

  // 7.5 close: project workflow_followup records into typed prior-followup
  // entries so the handoff carries the continuation that R5/R6 tracking was
  // designed for. Only emits entries when both the records AND the basis ref
  // are present — the generator drops one without the other.
  const priorFollowups: ArtifactTextEntry[] = [];
  if (
    input.workflowFollowups &&
    input.workflowFollowups.length > 0 &&
    input.workflowFollowupsBasisRef
  ) {
    const basisRefIds = [input.workflowFollowupsBasisRef.basisRefId];
    input.workflowFollowups.forEach((record, index) => {
      priorFollowups.push(
        createArtifactTextEntry(
          `Prior follow-up: ${record.originPacketFamily} → ${record.resultPacketFamily} via ${record.executedToolName}`,
          basisRefIds,
          {
            kind: "prior_followup",
            index,
            followupId: record.followupId,
          },
        ),
      );
    });
  }

  return {
    summary,
    ...(normalizedCurrentFocus ? { currentFocus: normalizedCurrentFocus } : {}),
    keyContext,
    activeRisks,
    followUps,
    priorFollowups,
  };
}

// Dedup operator findings by message before projecting them into the
// artifact. `tenant_leak_audit` can legitimately emit multiple findings for
// the same call site when an RPC touches several protected tables (the
// operator tracks each (site, table) pair separately). The finding
// messages currently only reference the call site and RPC, so the
// projection reads as a duplicate bullet to a human reviewer. Collapse by
// message here — the operator output stays rich, the artifact stays readable.
function dedupeFindingsByMessage<T extends { message: string }>(findings: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const finding of findings) {
    if (seen.has(finding.message)) continue;
    seen.add(finding.message);
    out.push(finding);
  }
  return out;
}

function createTenantAuditFindingEntries(
  tenantLeakAudit: TenantLeakAuditResult | undefined,
  tenantLeakAuditBasisRef: ArtifactBasisRef | undefined,
): { direct: ArtifactTextEntry[]; weak: ArtifactTextEntry[] } {
  if (!tenantLeakAudit || !tenantLeakAuditBasisRef) {
    return { direct: [], weak: [] };
  }
  const basisRefIds = [tenantLeakAuditBasisRef.basisRefId];
  const directFindings = dedupeFindingsByMessage(
    tenantLeakAudit.findings.filter((finding) => finding.strength === "direct_evidence"),
  );
  const weakFindings = dedupeFindingsByMessage(
    tenantLeakAudit.findings.filter((finding) => finding.strength === "weak_signal"),
  );
  return {
    direct: directFindings.slice(0, 4).map((finding, index) =>
      createArtifactTextEntry(finding.message, basisRefIds, {
        kind: "tenant_direct",
        index,
        findingId: finding.findingId,
      }),
    ),
    weak: weakFindings.slice(0, 4).map((finding, index) =>
      createArtifactTextEntry(finding.message, basisRefIds, {
        kind: "tenant_weak",
        index,
        findingId: finding.findingId,
      }),
    ),
  };
}

function createReviewBundlePayload(input: {
  implementationBrief: PacketSurfaceForFamily<WorkflowImplementationBriefPacket>;
  changePlan: ChangePlanResult;
  flowMap?: FlowMapResult;
  tenantLeakAudit?: TenantLeakAuditResult;
  impactPacket?: PacketSurfaceForFamily<WorkflowImpactPacket>;
  diagnostics?: ReviewBundleDiagnosticsInput;
  implementationBriefBasisRef: ArtifactBasisRef;
  changePlanBasisRef: ArtifactBasisRef;
  tenantLeakAuditBasisRef?: ArtifactBasisRef;
  impactPacketBasisRef?: ArtifactBasisRef;
  diagnosticsBasisRef?: ArtifactBasisRef;
}): ReviewBundleArtifact["payload"] {
  const implementationSummary =
    getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.summarySectionId)[0] ??
    input.implementationBrief.packet.title;
  const changeAreas = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.changeAreasSectionId,
  );
  const invariants = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.invariantsSectionId,
  );
  const risks = getPacketSectionEntryTexts(input.implementationBrief, input.implementationBrief.packet.payload.risksSectionId);
  const verificationItems = getPacketSectionEntryTexts(
    input.implementationBrief,
    input.implementationBrief.packet.payload.verificationSectionId,
  );
  const pathOverview = summarizeFlowMap(input.flowMap);
  const { direct, weak } = createTenantAuditFindingEntries(
    input.tenantLeakAudit,
    input.tenantLeakAuditBasisRef,
  );

  const inspectFirst: ArtifactReadItem[] = [
    createArtifactReadItem(
      "Review summary",
      implementationSummary,
      [input.implementationBriefBasisRef.basisRefId],
      { kind: "review_summary", text: implementationSummary },
    ),
    ...changeAreas.slice(0, 2).map((text, index) =>
      createArtifactReadItem(
        `Inspect change area ${index + 1}`,
        text,
        [input.implementationBriefBasisRef.basisRefId],
        { kind: "review_change_area", index, text },
      ),
    ),
    ...invariants.slice(0, 1).map((text, index) =>
      createArtifactReadItem(
        `Protect invariant ${index + 1}`,
        text,
        [input.implementationBriefBasisRef.basisRefId],
        { kind: "review_invariant", index, text },
      ),
    ),
  ].slice(0, 4);

  const stepBySurfaceId = new Map(input.changePlan.steps.map((step) => [step.surfaceId, step]));
  const reviewSurfaces: ArtifactChangeSurface[] = [
    ...input.changePlan.directSurfaces.map((surface) => ({ surface, roleOrder: 0 })),
    ...input.changePlan.dependentSurfaces.slice(0, 2).map((surface) => ({ surface, roleOrder: 1 })),
  ]
    .sort((left, right) => left.roleOrder - right.roleOrder || left.surface.distance - right.surface.distance)
    .slice(0, 5)
    .map(({ surface }) => {
      const step = stepBySurfaceId.get(surface.surfaceId);
      return {
        surfaceId: surface.surfaceId,
        title: step?.title ?? surface.node.label,
        nodeLabel: surface.node.label,
        role: surface.role,
        dependsOnStepIds: step?.dependsOnStepIds ?? [],
        rationale: surface.rationale,
        containsHeuristicEdge: surface.containsHeuristicEdge,
        basisRefIds: [input.changePlanBasisRef.basisRefId],
      };
    });

  const reviewerChecks: ArtifactTextEntry[] = [
    ...invariants.slice(0, 2).map((text, index) =>
      createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
        kind: "review_check_invariant",
        index,
        text,
      }),
    ),
    ...verificationItems.slice(0, 2).map((text, index) =>
      createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
        kind: "review_check_verification",
        index,
        text,
      }),
    ),
  ];

  const activeRisks = risks.slice(0, 3).map((text, index) =>
    createArtifactTextEntry(text, [input.implementationBriefBasisRef.basisRefId], {
      kind: "review_risk",
      index,
      text,
    }),
  );

  // 7.5 close: impact_packet → impactZones entries. Each impact category
  // projects up to two entries so the bundle stays readable; the
  // impact_packet surface itself remains reachable via its basis ref if a
  // reviewer wants the full list.
  const impactZones: ArtifactTextEntry[] = [];
  if (input.impactPacket && input.impactPacketBasisRef) {
    const impactBasisRefIds = [input.impactPacketBasisRef.basisRefId];
    const impactPayload = input.impactPacket.packet.payload;
    const impactSectionTexts = getPacketSectionEntryTexts(
      input.impactPacket,
      impactPayload.impactSectionId,
    );
    const risksSectionTexts = getPacketSectionEntryTexts(
      input.impactPacket,
      impactPayload.risksSectionId,
    );
    const summarySectionTexts = getPacketSectionEntryTexts(
      input.impactPacket,
      impactPayload.summarySectionId,
    );
    const impactSummary = summarySectionTexts[0];
    if (impactSummary) {
      impactZones.push(
        createArtifactTextEntry(impactSummary, impactBasisRefIds, {
          kind: "impact_summary",
        }),
      );
    }
    impactSectionTexts.slice(0, 4).forEach((text, index) => {
      impactZones.push(
        createArtifactTextEntry(text, impactBasisRefIds, {
          kind: "impact_zone",
          index,
          text,
        }),
      );
    });
    risksSectionTexts.slice(0, 2).forEach((text, index) => {
      impactZones.push(
        createArtifactTextEntry(text, impactBasisRefIds, {
          kind: "impact_risk",
          index,
          text,
        }),
      );
    });
  }

  // 7.5 close: diagnostics findings → diagnosticFindings entries. Stays
  // bounded to a sensible count so a review_bundle with a noisy change
  // surface stays readable; the full finding set is reachable by rerunning
  // diagnostics directly.
  const diagnosticFindings: ArtifactTextEntry[] = [];
  if (input.diagnostics && input.diagnosticsBasisRef) {
    const diagnosticsBasisRefIds = [input.diagnosticsBasisRef.basisRefId];
    input.diagnostics.findings.slice(0, 8).forEach((finding, index) => {
      const location = finding.path
        ? ` (${finding.path}${typeof finding.line === "number" ? `:${finding.line}` : ""})`
        : "";
      diagnosticFindings.push(
        createArtifactTextEntry(
          `${finding.severity}/${finding.confidence} ${finding.code}: ${finding.message}${location}`,
          diagnosticsBasisRefIds,
          {
            kind: "diagnostic_finding",
            index,
            matchBasedId: finding.identity.matchBasedId,
          },
        ),
      );
    });
  }

  const summaryParts = [implementationSummary];
  if (pathOverview) summaryParts.push(pathOverview);
  if (impactZones.length > 0) {
    summaryParts.push(`Impact packet surfaces ${impactZones.length} entry(ies).`);
  }
  if (diagnosticFindings.length > 0) {
    summaryParts.push(`Diagnostics report ${diagnosticFindings.length} finding(s) on the change surface.`);
  }
  if (direct.length > 0) {
    summaryParts.push(`Operator review includes ${direct.length} direct tenant finding(s).`);
  } else if (weak.length > 0) {
    summaryParts.push(`Operator review includes ${weak.length} weak tenant signal(s).`);
  }

  return {
    summary: summaryParts.join(" "),
    ...(pathOverview ? { pathOverview } : {}),
    inspectFirst,
    reviewSurfaces,
    reviewerChecks,
    activeRisks,
    directOperatorFindings: direct,
    weakOperatorSignals: weak,
    impactZones,
    diagnosticFindings,
  };
}

function createVerificationBundlePayload(input: {
  verificationPlan: PacketSurfaceForFamily<WorkflowVerificationPlanPacket>;
  tenantLeakAudit?: TenantLeakAuditResult;
  issuesNext?: IssuesNextResult;
  sessionHandoff?: SessionHandoffResult;
  trustRun?: AnswerTrustRunRecord;
  trustEvaluation?: AnswerTrustEvaluationRecord;
  verificationPlanBasisRef: ArtifactBasisRef;
  tenantLeakAuditBasisRef?: ArtifactBasisRef;
  issuesNextBasisRef?: ArtifactBasisRef;
  sessionHandoffBasisRef?: ArtifactBasisRef;
  trustRunBasisRef?: ArtifactBasisRef;
  trustEvaluationBasisRef?: ArtifactBasisRef;
}): VerificationBundleArtifact["payload"] {
  const summaryText =
    getPacketSectionEntryTexts(input.verificationPlan, input.verificationPlan.packet.payload.summarySectionId)[0] ??
    input.verificationPlan.packet.title;
  const baselineItems = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.baselineSectionId,
  );
  const verificationItems = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.verificationSectionId,
  );
  const doneCriteria = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.doneCriteriaSectionId,
  );
  const rerunTriggers = getPacketSectionEntryTexts(
    input.verificationPlan,
    input.verificationPlan.packet.payload.rerunTriggerSectionId,
  );
  const { direct, weak } = createTenantAuditFindingEntries(
    input.tenantLeakAudit,
    input.tenantLeakAuditBasisRef,
  );

  const baselineChecks = baselineItems.slice(0, 2).map((text, index) =>
    createArtifactTextEntry(text, [input.verificationPlanBasisRef.basisRefId], {
      kind: "verification_baseline",
      index,
      text,
    }),
  );
  const requiredChecks = verificationItems.slice(0, 4).map((text, index) =>
    createArtifactTextEntry(text, [input.verificationPlanBasisRef.basisRefId], {
      kind: "verification_required",
      index,
      text,
    }),
  );

  const stopConditionsByText = new Map<string, ArtifactTextEntry>();
  const pushStopCondition = (text: string, basisRefIds: string[], seed: unknown) => {
    if (!stopConditionsByText.has(text)) {
      stopConditionsByText.set(text, createArtifactTextEntry(text, basisRefIds, seed));
    }
  };

  doneCriteria.forEach((text, index) => {
    pushStopCondition(text, [input.verificationPlanBasisRef.basisRefId], {
      kind: "verification_done",
      index,
      text,
    });
  });
  input.sessionHandoff?.currentFocus?.stopWhen.forEach((text, index) => {
    if (!input.sessionHandoffBasisRef) return;
    pushStopCondition(text, [input.sessionHandoffBasisRef.basisRefId], {
      kind: "session_stop",
      index,
      text,
    });
  });
  input.issuesNext?.currentIssue?.stopWhen.forEach((text, index) => {
    if (!input.issuesNextBasisRef) return;
    pushStopCondition(text, [input.issuesNextBasisRef.basisRefId], {
      kind: "issues_stop",
      index,
      text,
    });
  });
  if (stopConditionsByText.size === 0) {
    pushStopCondition(
      "Stop when the verification basis has been rerun and no unresolved verification signal remains.",
      [input.verificationPlanBasisRef.basisRefId],
      { kind: "verification_fallback_stop" },
    );
  }

  const changeManagementChecks: ArtifactTextEntry[] = [
    ...rerunTriggers.slice(0, 2).map((text, index) =>
      createArtifactTextEntry(text, [input.verificationPlanBasisRef.basisRefId], {
        kind: "verification_rerun_trigger",
        index,
        text,
      }),
    ),
  ];
  if (input.sessionHandoff?.currentFocus && input.sessionHandoffBasisRef) {
    changeManagementChecks.push(
      createArtifactTextEntry(
        `Current focus: ${input.sessionHandoff.currentFocus.queryText} (${input.sessionHandoff.currentFocus.reason})`,
        [input.sessionHandoffBasisRef.basisRefId],
        {
          kind: "verification_session_focus",
          traceId: input.sessionHandoff.currentFocus.traceId,
        },
      ),
    );
  }
  if (input.issuesNext?.currentIssue && input.issuesNextBasisRef) {
    changeManagementChecks.push(
      createArtifactTextEntry(
        `Current queued issue: ${input.issuesNext.currentIssue.queryText} (${input.issuesNext.currentIssue.reason})`,
        [input.issuesNextBasisRef.basisRefId],
        {
          kind: "verification_current_issue",
          traceId: input.issuesNext.currentIssue.traceId,
        },
      ),
    );
  }
  input.issuesNext?.queuedIssues.slice(0, 2).forEach((issue, index) => {
    if (!input.issuesNextBasisRef) return;
    changeManagementChecks.push(
      createArtifactTextEntry(
        `Queued issue ${index + 1}: ${issue.queryText} (${issue.reason})`,
        [input.issuesNextBasisRef.basisRefId],
        {
          kind: "verification_queued_issue",
          index,
          traceId: issue.traceId,
        },
      ),
    );
  });

  // 7.5 close: project the trust run + evaluation into a typed trustState
  // snapshot when both are in scope. Only emits when both records AND both
  // basis refs are present — the generator drops one without the other so
  // basisRefIds always point at live basis entries.
  let trustState: VerificationBundleTrustState | undefined;
  if (
    input.trustRun &&
    input.trustEvaluation &&
    input.trustRunBasisRef &&
    input.trustEvaluationBasisRef
  ) {
    trustState = {
      traceId: input.trustRun.traceId,
      state: input.trustEvaluation.state,
      scopeRelation: input.trustEvaluation.scopeRelation,
      reasons: input.trustEvaluation.reasons.map((reason) => `${reason.code}: ${reason.detail}`),
      evaluatedAt: input.trustEvaluation.createdAt,
      basisRefIds: [
        input.trustRunBasisRef.basisRefId,
        input.trustEvaluationBasisRef.basisRefId,
      ],
    };
  }

  const summaryParts = [summaryText];
  if (input.issuesNext?.currentIssue) {
    summaryParts.push(`Current issue: ${input.issuesNext.currentIssue.queryText}.`);
  } else if (input.sessionHandoff?.currentFocus) {
    summaryParts.push(`Current focus: ${input.sessionHandoff.currentFocus.queryText}.`);
  }
  if (trustState) {
    summaryParts.push(`Prior answer trust is ${trustState.state} for trace ${trustState.traceId}.`);
  }
  if (direct.length > 0) {
    summaryParts.push(`Do not close verification without resolving ${direct.length} direct tenant finding(s).`);
  }

  return {
    summary: summaryParts.join(" "),
    baselineChecks,
    requiredChecks,
    stopConditions: [...stopConditionsByText.values()],
    changeManagementChecks,
    directOperatorFindings: direct,
    weakOperatorSignals: weak,
    ...(trustState ? { trustState } : {}),
  };
}

function buildArtifactRenderings<TKind extends ArtifactKind, TPayload>(
  artifact: ArtifactRenderingSource<TKind, TPayload>,
  markdownBody: string,
): ArtifactRendering[] {
  const jsonProjection = {
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    projectId: artifact.projectId,
    title: artifact.title,
    generatedAt: artifact.generatedAt,
    basis: artifact.basis,
    freshness: artifact.freshness,
    consumerTargets: artifact.consumerTargets,
    exportIntent: artifact.exportIntent,
    payload: artifact.payload,
    ...(artifact.supersedesArtifactId ? { supersedesArtifactId: artifact.supersedesArtifactId } : {}),
    ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
  };
  return [
    { format: "json", body: JSON.stringify(jsonProjection, null, 2) },
    { format: "markdown", body: markdownBody },
  ];
}

function renderTaskPreflightMarkdown(artifact: Pick<TaskPreflightArtifact, "title" | "payload">): string {
  const lines = [`# ${artifact.title}`, "", artifact.payload.summary];
  if (artifact.payload.pathOverview) {
    lines.push("", `Flow: ${artifact.payload.pathOverview}`);
  }
  lines.push("", "## Read First");
  for (const item of artifact.payload.readFirst) {
    lines.push(`- ${item.title}: ${item.detail}`);
  }
  lines.push("", "## Likely Move Surfaces");
  if (artifact.payload.likelyMoveSurfaces.length === 0) {
    lines.push(
      "- _No graph-derived move surfaces — widen `traversalDepth`, pick closer entities, or verify the graph indexes the start/target kinds._",
    );
  } else {
    for (const surface of artifact.payload.likelyMoveSurfaces) {
      lines.push(`- ${surface.title}: ${surface.rationale}`);
    }
  }
  lines.push("", "## Verify Before Start");
  for (const item of artifact.payload.verifyBeforeStart) {
    lines.push(`- ${item.text}`);
  }
  if (artifact.payload.activeRisks.length > 0) {
    lines.push("", "## Active Risks");
    for (const item of artifact.payload.activeRisks) {
      lines.push(`- ${item.text}`);
    }
  }
  return lines.join("\n");
}

function renderImplementationHandoffMarkdown(
  artifact: Pick<ImplementationHandoffArtifact, "title" | "payload">,
): string {
  const lines = [`# ${artifact.title}`, "", artifact.payload.summary];
  if (artifact.payload.currentFocus) {
    lines.push("", "## Current Focus");
    lines.push(`- ${artifact.payload.currentFocus.queryText}`);
    lines.push(`- Reason: ${artifact.payload.currentFocus.reason}`);
    for (const stopCondition of artifact.payload.currentFocus.stopWhen) {
      lines.push(`- Stop when: ${stopCondition}`);
    }
  }
  lines.push("", "## Key Context");
  for (const item of artifact.payload.keyContext) {
    lines.push(`- ${item.text}`);
  }
  if (artifact.payload.activeRisks.length > 0) {
    lines.push("", "## Active Risks");
    for (const item of artifact.payload.activeRisks) {
      lines.push(`- ${item.text}`);
    }
  }
  lines.push("", "## Follow-Ups");
  for (const item of artifact.payload.followUps) {
    lines.push(`- ${item.text}`);
  }
  if (artifact.payload.priorFollowups.length > 0) {
    lines.push("", "## Prior Follow-Up Actions");
    for (const item of artifact.payload.priorFollowups) {
      lines.push(`- ${item.text}`);
    }
  }
  return lines.join("\n");
}

function renderReviewBundleMarkdown(artifact: Pick<ReviewBundleArtifact, "title" | "payload">): string {
  const lines = [`# ${artifact.title}`, "", artifact.payload.summary];
  if (artifact.payload.pathOverview) {
    lines.push("", `Flow: ${artifact.payload.pathOverview}`);
  }
  lines.push("", "## Inspect First");
  for (const item of artifact.payload.inspectFirst) {
    lines.push(`- ${item.title}: ${item.detail}`);
  }
  lines.push("", "## Review Surfaces");
  if (artifact.payload.reviewSurfaces.length === 0) {
    lines.push(
      "- _No graph-derived review surfaces — widen `traversalDepth`, pick closer entities, or verify the graph indexes the start/target kinds._",
    );
  } else {
    for (const surface of artifact.payload.reviewSurfaces) {
      lines.push(`- ${surface.title}: ${surface.rationale}`);
    }
  }
  lines.push("", "## Reviewer Checks");
  for (const item of artifact.payload.reviewerChecks) {
    lines.push(`- ${item.text}`);
  }
  if (artifact.payload.activeRisks.length > 0) {
    lines.push("", "## Active Risks");
    for (const item of artifact.payload.activeRisks) {
      lines.push(`- ${item.text}`);
    }
  }
  if (artifact.payload.directOperatorFindings.length > 0) {
    lines.push("", "## Direct Operator Findings");
    for (const item of artifact.payload.directOperatorFindings) {
      lines.push(`- ${item.text}`);
    }
  }
  if (artifact.payload.weakOperatorSignals.length > 0) {
    lines.push("", "## Weak Operator Signals");
    for (const item of artifact.payload.weakOperatorSignals) {
      lines.push(`- ${item.text}`);
    }
  }
  lines.push("", "## Impact Zones");
  if (artifact.payload.impactZones.length === 0) {
    lines.push(
      "- _No impact_packet entries resolved — verify the impact packet ran successfully and the change scope resolved to selected items._",
    );
  } else {
    for (const item of artifact.payload.impactZones) {
      lines.push(`- ${item.text}`);
    }
  }
  lines.push("", "## Diagnostic Findings");
  if (artifact.payload.diagnosticFindings.length === 0) {
    lines.push(
      "- _No diagnostics findings on the change surface — rule-packs and alignment diagnostics returned clean._",
    );
  } else {
    for (const item of artifact.payload.diagnosticFindings) {
      lines.push(`- ${item.text}`);
    }
  }
  return lines.join("\n");
}

function renderVerificationBundleMarkdown(
  artifact: Pick<VerificationBundleArtifact, "title" | "payload">,
): string {
  const lines = [`# ${artifact.title}`, "", artifact.payload.summary, "", "## Baseline Checks"];
  for (const item of artifact.payload.baselineChecks) {
    lines.push(`- ${item.text}`);
  }
  lines.push("", "## Required Checks");
  for (const item of artifact.payload.requiredChecks) {
    lines.push(`- ${item.text}`);
  }
  lines.push("", "## Stop Conditions");
  for (const item of artifact.payload.stopConditions) {
    lines.push(`- ${item.text}`);
  }
  if (artifact.payload.changeManagementChecks.length > 0) {
    lines.push("", "## Change-Management Checks");
    for (const item of artifact.payload.changeManagementChecks) {
      lines.push(`- ${item.text}`);
    }
  }
  if (artifact.payload.directOperatorFindings.length > 0) {
    lines.push("", "## Direct Operator Findings");
    for (const item of artifact.payload.directOperatorFindings) {
      lines.push(`- ${item.text}`);
    }
  }
  if (artifact.payload.weakOperatorSignals.length > 0) {
    lines.push("", "## Weak Operator Signals");
    for (const item of artifact.payload.weakOperatorSignals) {
      lines.push(`- ${item.text}`);
    }
  }
  if (artifact.payload.trustState) {
    const { trustState } = artifact.payload;
    lines.push("", "## Prior Answer Trust State");
    lines.push(`- Trace: ${trustState.traceId}`);
    lines.push(`- State: ${trustState.state}`);
    lines.push(`- Scope relation: ${trustState.scopeRelation}`);
    if (trustState.reasons.length > 0) {
      for (const reason of trustState.reasons) {
        lines.push(`- Reason: ${reason}`);
      }
    }
    lines.push(`- Evaluated at: ${trustState.evaluatedAt}`);
  }
  return lines.join("\n");
}

function renderTaskPreflightArtifact(
  artifact: Omit<TaskPreflightArtifact, "renderings">,
): TaskPreflightArtifact {
  return TaskPreflightArtifactSchema.parse({
    ...artifact,
    renderings: buildArtifactRenderings(artifact, renderTaskPreflightMarkdown(artifact)),
  });
}

function renderImplementationHandoffArtifact(
  artifact: Omit<ImplementationHandoffArtifact, "renderings">,
): ImplementationHandoffArtifact {
  return ImplementationHandoffArtifactSchema.parse({
    ...artifact,
    renderings: buildArtifactRenderings(artifact, renderImplementationHandoffMarkdown(artifact)),
  });
}

function renderReviewBundleArtifact(
  artifact: Omit<ReviewBundleArtifact, "renderings">,
): ReviewBundleArtifact {
  return ReviewBundleArtifactSchema.parse({
    ...artifact,
    renderings: buildArtifactRenderings(artifact, renderReviewBundleMarkdown(artifact)),
  });
}

function renderVerificationBundleArtifact(
  artifact: Omit<VerificationBundleArtifact, "renderings">,
): VerificationBundleArtifact {
  return VerificationBundleArtifactSchema.parse({
    ...artifact,
    renderings: buildArtifactRenderings(artifact, renderVerificationBundleMarkdown(artifact)),
  });
}

function replayRecordedArtifact<TArtifact extends RecordedArtifact>(artifact: TArtifact): TArtifact {
  const { renderings: _renderings, ...artifactWithoutRenderings } = artifact;
  if (artifact.kind === "task_preflight") {
    return renderTaskPreflightArtifact(
      artifactWithoutRenderings as Omit<TaskPreflightArtifact, "renderings">,
    ) as TArtifact;
  }
  if (artifact.kind === "implementation_handoff") {
    return renderImplementationHandoffArtifact(
      artifactWithoutRenderings as Omit<ImplementationHandoffArtifact, "renderings">,
    ) as TArtifact;
  }
  if (artifact.kind === "review_bundle") {
    return renderReviewBundleArtifact(
      artifactWithoutRenderings as Omit<ReviewBundleArtifact, "renderings">,
    ) as TArtifact;
  }
  return renderVerificationBundleArtifact(
    artifactWithoutRenderings as Omit<VerificationBundleArtifact, "renderings">,
  ) as TArtifact;
}

function diffBasisRefIds(
  previous: readonly ArtifactBasisRef[],
  next: readonly ArtifactBasisRef[],
): string[] {
  const previousById = new Map(previous.map((ref) => [ref.basisRefId, ref]));
  const nextById = new Map(next.map((ref) => [ref.basisRefId, ref]));
  const changed = new Set<string>();
  for (const [id, ref] of previousById) {
    const nextRef = nextById.get(id);
    if (!nextRef || nextRef.fingerprint !== ref.fingerprint) {
      changed.add(id);
    }
  }
  for (const id of nextById.keys()) {
    if (!previousById.has(id)) {
      changed.add(id);
    }
  }
  // Sorted for deterministic ordering — makes smoke assertions and 7.5 eval
  // aggregation independent of insertion order.
  return [...changed].sort();
}

function refreshArtifact<TArtifact extends RecordedArtifact>(
  previousArtifact: TArtifact,
  nextArtifact: TArtifact,
  replay: (artifact: TArtifact) => TArtifact,
): ArtifactRefreshResult<TArtifact> {
  if (previousArtifact.artifactId === nextArtifact.artifactId) {
    return {
      outcome: "unchanged",
      artifact: null,
      supersedesArtifactId: null,
      changedBasisRefIds: [],
      reason: "artifact basis and generator version are unchanged",
    };
  }

  const refreshedArtifact = replay({
    ...nextArtifact,
    supersedesArtifactId: previousArtifact.artifactId,
  });

  return {
    outcome: "refreshed",
    artifact: refreshedArtifact,
    supersedesArtifactId: previousArtifact.artifactId,
    changedBasisRefIds: diffBasisRefIds(previousArtifact.basis, nextArtifact.basis),
  };
}

export function generateTaskPreflightArtifact(input: TaskPreflightArtifactInput): TaskPreflightArtifact {
  ensureImplementationBriefSurface(input.implementationBrief);
  ensureVerificationPlanSurface(input.verificationPlan);
  ensureProjectMatch(input.projectId, input.implementationBrief.packet.projectId, "implementation_brief");
  ensureProjectMatch(input.projectId, input.verificationPlan.packet.projectId, "verification_plan");

  const generatedAt = input.generatedAt ?? nowTimestamp();
  const implementationBriefBasisRef = buildWorkflowPacketBasisRef(input.implementationBrief);
  const verificationPlanBasisRef = buildWorkflowPacketBasisRef(input.verificationPlan);
  const changePlanBasisRef = buildChangePlanBasisRef(input.changePlan);
  const primaryBasis = [
    implementationBriefBasisRef,
    verificationPlanBasisRef,
    changePlanBasisRef,
    ...(input.flowMap ? [buildFlowMapBasisRef(input.flowMap)] : []),
  ];
  const basis = mergeBasisRefs(primaryBasis, input.additionalBasis);
  const payload = createTaskPreflightPayload({
    implementationBrief: input.implementationBrief,
    verificationPlan: input.verificationPlan,
    changePlan: input.changePlan,
    flowMap: input.flowMap,
    implementationBriefBasisRef,
    verificationPlanBasisRef,
    changePlanBasisRef,
  });
  const artifactId = buildArtifactId("task_preflight", TASK_PREFLIGHT_VERSION, basis);
  return renderTaskPreflightArtifact({
    artifactId,
    kind: "task_preflight",
    projectId: input.projectId,
    title: "Task Preflight",
    generatedAt,
    basis,
    freshness: defaultFreshness(generatedAt),
    consumerTargets: [...DEFAULT_ARTIFACT_CONSUMER_TARGETS],
    exportIntent: DEFAULT_ARTIFACT_EXPORT_INTENT,
    payload,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export function refreshTaskPreflightArtifact(
  previousArtifact: TaskPreflightArtifact,
  input: TaskPreflightArtifactInput,
): ArtifactRefreshResult<TaskPreflightArtifact> {
  return refreshArtifact(previousArtifact, generateTaskPreflightArtifact(input), replayRecordedArtifact);
}

export function replayTaskPreflightArtifact(
  artifact: TaskPreflightArtifact,
): ArtifactReplayResult<TaskPreflightArtifact> {
  return {
    outcome: "replayed",
    artifact: replayRecordedArtifact(artifact),
  };
}

export function generateImplementationHandoffArtifact(
  input: ImplementationHandoffArtifactInput,
): ImplementationHandoffArtifact {
  ensureImplementationBriefSurface(input.implementationBrief);
  ensureProjectMatch(input.projectId, input.implementationBrief.packet.projectId, "implementation_brief");

  const generatedAt = input.generatedAt ?? nowTimestamp();
  const implementationBriefBasisRef = buildWorkflowPacketBasisRef(input.implementationBrief);
  const sessionHandoffBasisRef = buildSessionHandoffBasisRef(input.sessionHandoff);
  const workflowFollowups = input.workflowFollowups ?? [];
  const workflowFollowupsBasisRef =
    workflowFollowups.length > 0 ? buildWorkflowFollowupBasisRef(workflowFollowups) : undefined;
  const basis = mergeBasisRefs(
    [
      implementationBriefBasisRef,
      sessionHandoffBasisRef,
      ...(workflowFollowupsBasisRef ? [workflowFollowupsBasisRef] : []),
    ],
    input.additionalBasis,
  );
  const payload = createImplementationHandoffPayload({
    implementationBrief: input.implementationBrief,
    sessionHandoff: input.sessionHandoff,
    workflowFollowups,
    implementationBriefBasisRef,
    sessionHandoffBasisRef,
    ...(workflowFollowupsBasisRef ? { workflowFollowupsBasisRef } : {}),
  });
  const artifactId = buildArtifactId("implementation_handoff", IMPLEMENTATION_HANDOFF_VERSION, basis);
  return renderImplementationHandoffArtifact({
    artifactId,
    kind: "implementation_handoff",
    projectId: input.projectId,
    title: "Implementation Handoff",
    generatedAt,
    basis,
    freshness: defaultFreshness(generatedAt),
    consumerTargets: [...DEFAULT_ARTIFACT_CONSUMER_TARGETS],
    exportIntent: DEFAULT_ARTIFACT_EXPORT_INTENT,
    payload,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export function refreshImplementationHandoffArtifact(
  previousArtifact: ImplementationHandoffArtifact,
  input: ImplementationHandoffArtifactInput,
): ArtifactRefreshResult<ImplementationHandoffArtifact> {
  return refreshArtifact(previousArtifact, generateImplementationHandoffArtifact(input), replayRecordedArtifact);
}

export function replayImplementationHandoffArtifact(
  artifact: ImplementationHandoffArtifact,
): ArtifactReplayResult<ImplementationHandoffArtifact> {
  return {
    outcome: "replayed",
    artifact: replayRecordedArtifact(artifact),
  };
}

export function generateReviewBundleArtifact(input: ReviewBundleArtifactInput): ReviewBundleArtifact {
  ensureImplementationBriefSurface(input.implementationBrief);
  ensureProjectMatch(input.projectId, input.implementationBrief.packet.projectId, "implementation_brief");
  if (input.impactPacket) {
    if (input.impactPacket.packet.family !== "impact_packet") {
      throw new Error(
        `expected impact_packet surface, received ${input.impactPacket.packet.family}`,
      );
    }
    ensureProjectMatch(input.projectId, input.impactPacket.packet.projectId, "impact_packet");
  }

  const generatedAt = input.generatedAt ?? nowTimestamp();
  const implementationBriefBasisRef = buildWorkflowPacketBasisRef(input.implementationBrief);
  const changePlanBasisRef = buildChangePlanBasisRef(input.changePlan);
  const tenantLeakAuditBasisRef = input.tenantLeakAudit
    ? buildTenantLeakAuditBasisRef(input.tenantLeakAudit)
    : undefined;
  const impactPacketBasisRef = input.impactPacket
    ? buildWorkflowPacketBasisRef(input.impactPacket)
    : undefined;
  const diagnosticsBasisRef = input.diagnostics
    ? buildDiagnosticsBasisRef(input.diagnostics.findings, input.diagnostics.focusFiles)
    : undefined;
  const primaryBasis = [
    implementationBriefBasisRef,
    changePlanBasisRef,
    ...(input.flowMap ? [buildFlowMapBasisRef(input.flowMap)] : []),
    ...(tenantLeakAuditBasisRef ? [tenantLeakAuditBasisRef] : []),
    ...(impactPacketBasisRef ? [impactPacketBasisRef] : []),
    ...(diagnosticsBasisRef ? [diagnosticsBasisRef] : []),
  ];
  const basis = mergeBasisRefs(primaryBasis, input.additionalBasis);
  const payload = createReviewBundlePayload({
    implementationBrief: input.implementationBrief,
    changePlan: input.changePlan,
    flowMap: input.flowMap,
    tenantLeakAudit: input.tenantLeakAudit,
    impactPacket: input.impactPacket,
    diagnostics: input.diagnostics,
    implementationBriefBasisRef,
    changePlanBasisRef,
    ...(tenantLeakAuditBasisRef ? { tenantLeakAuditBasisRef } : {}),
    ...(impactPacketBasisRef ? { impactPacketBasisRef } : {}),
    ...(diagnosticsBasisRef ? { diagnosticsBasisRef } : {}),
  });
  const artifactId = buildArtifactId("review_bundle", REVIEW_BUNDLE_VERSION, basis);
  return renderReviewBundleArtifact({
    artifactId,
    kind: "review_bundle",
    projectId: input.projectId,
    title: "Review Bundle",
    generatedAt,
    basis,
    freshness: defaultFreshness(generatedAt),
    consumerTargets: [...DEFAULT_ARTIFACT_CONSUMER_TARGETS],
    exportIntent: DEFAULT_ARTIFACT_EXPORT_INTENT,
    payload,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export function refreshReviewBundleArtifact(
  previousArtifact: ReviewBundleArtifact,
  input: ReviewBundleArtifactInput,
): ArtifactRefreshResult<ReviewBundleArtifact> {
  return refreshArtifact(previousArtifact, generateReviewBundleArtifact(input), replayRecordedArtifact);
}

export function replayReviewBundleArtifact(
  artifact: ReviewBundleArtifact,
): ArtifactReplayResult<ReviewBundleArtifact> {
  return {
    outcome: "replayed",
    artifact: replayRecordedArtifact(artifact),
  };
}

export function generateVerificationBundleArtifact(
  input: VerificationBundleArtifactInput,
): VerificationBundleArtifact {
  ensureVerificationPlanSurface(input.verificationPlan);
  ensureProjectMatch(input.projectId, input.verificationPlan.packet.projectId, "verification_plan");

  const generatedAt = input.generatedAt ?? nowTimestamp();
  const verificationPlanBasisRef = buildWorkflowPacketBasisRef(input.verificationPlan);
  const tenantLeakAuditBasisRef = input.tenantLeakAudit
    ? buildTenantLeakAuditBasisRef(input.tenantLeakAudit)
    : undefined;
  const issuesNextBasisRef = input.issuesNext ? buildIssuesNextBasisRef(input.issuesNext) : undefined;
  const sessionHandoffBasisRef = input.sessionHandoff
    ? buildSessionHandoffBasisRef(input.sessionHandoff)
    : undefined;
  // Trust basis refs only emit when both the run AND evaluation are present.
  // One without the other is dropped — the payload shape explicitly requires
  // both to populate trustState, and the contract enforces basisRefIds point
  // at live basis entries.
  const trustRunBasisRef =
    input.trustRun && input.trustEvaluation ? buildTrustRunBasisRef(input.trustRun) : undefined;
  const trustEvaluationBasisRef =
    input.trustRun && input.trustEvaluation
      ? buildTrustEvaluationBasisRef(input.trustEvaluation)
      : undefined;
  const primaryBasis = [
    verificationPlanBasisRef,
    ...(tenantLeakAuditBasisRef ? [tenantLeakAuditBasisRef] : []),
    ...(issuesNextBasisRef ? [issuesNextBasisRef] : []),
    ...(sessionHandoffBasisRef ? [sessionHandoffBasisRef] : []),
    ...(trustRunBasisRef ? [trustRunBasisRef] : []),
    ...(trustEvaluationBasisRef ? [trustEvaluationBasisRef] : []),
  ];
  const basis = mergeBasisRefs(primaryBasis, input.additionalBasis);
  const payload = createVerificationBundlePayload({
    verificationPlan: input.verificationPlan,
    tenantLeakAudit: input.tenantLeakAudit,
    issuesNext: input.issuesNext,
    sessionHandoff: input.sessionHandoff,
    trustRun: input.trustRun,
    trustEvaluation: input.trustEvaluation,
    verificationPlanBasisRef,
    ...(tenantLeakAuditBasisRef ? { tenantLeakAuditBasisRef } : {}),
    ...(issuesNextBasisRef ? { issuesNextBasisRef } : {}),
    ...(sessionHandoffBasisRef ? { sessionHandoffBasisRef } : {}),
    ...(trustRunBasisRef ? { trustRunBasisRef } : {}),
    ...(trustEvaluationBasisRef ? { trustEvaluationBasisRef } : {}),
  });
  const artifactId = buildArtifactId("verification_bundle", VERIFICATION_BUNDLE_VERSION, basis);
  return renderVerificationBundleArtifact({
    artifactId,
    kind: "verification_bundle",
    projectId: input.projectId,
    title: "Verification Bundle",
    generatedAt,
    basis,
    freshness: defaultFreshness(generatedAt),
    consumerTargets: [...DEFAULT_ARTIFACT_CONSUMER_TARGETS],
    exportIntent: DEFAULT_ARTIFACT_EXPORT_INTENT,
    payload,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export function refreshVerificationBundleArtifact(
  previousArtifact: VerificationBundleArtifact,
  input: VerificationBundleArtifactInput,
): ArtifactRefreshResult<VerificationBundleArtifact> {
  return refreshArtifact(
    previousArtifact,
    generateVerificationBundleArtifact(input),
    replayRecordedArtifact,
  );
}

export function replayVerificationBundleArtifact(
  artifact: VerificationBundleArtifact,
): ArtifactReplayResult<VerificationBundleArtifact> {
  return {
    outcome: "replayed",
    artifact: replayRecordedArtifact(artifact),
  };
}

export async function implementationHandoffArtifactTool(
  input: ImplementationHandoffArtifactToolInput,
  options: ToolServiceOptions = {},
): Promise<ImplementationHandoffArtifactToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const implementationBrief = await generateWorkflowPacketSurfaceForQuery(
      {
        projectId: project.projectId,
        family: "implementation_brief",
        queryKind: input.queryKind,
        queryText: input.queryText,
        ...(input.queryArgs ? { queryArgs: input.queryArgs } : {}),
      },
      options,
    );
    ensureImplementationBriefSurface(implementationBrief);
    const sessionHandoff = buildSessionHandoffResult(projectStore, {
      sourceTraceLimit: input.sessionLimit,
    });
    // 7.5 close: attach recent workflow_followup records so handoff carries
    // the R5/R6 follow-on continuation. Query is project-scoped by limit;
    // the store orders results newest-first. Empty is legitimate (no prior
    // follow-ups) and the generator drops the basis ref in that case.
    const followupLimit = Math.max(1, Math.min(input.followupLimit ?? 3, 32));
    const workflowFollowups = projectStore.queryWorkflowFollowups({ limit: followupLimit });
    const result = generateImplementationHandoffArtifact({
      projectId: project.projectId,
      implementationBrief,
      sessionHandoff,
      workflowFollowups,
    });
    const exported = input.export?.file
      ? exportArtifactToFile(result, project.canonicalPath, input.export.file)
      : undefined;
    return {
      toolName: "implementation_handoff_artifact",
      projectId: project.projectId,
      result,
      ...(exported ? { exported } : {}),
    };
  });
}

export async function reviewBundleArtifactTool(
  input: ReviewBundleArtifactToolInput,
  options: ToolServiceOptions = {},
): Promise<ReviewBundleArtifactToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const baseWorkflowQuery = {
      projectId: project.projectId,
      queryKind: input.queryKind,
      queryText: input.queryText,
      ...(input.queryArgs ? { queryArgs: input.queryArgs } : {}),
    } as const;
    // 7.5 close: impact_packet defaults on. Fetching it fans out alongside
    // implementation_brief so the review_bundle composes the basis 7.0
    // advertised without a second round-trip. Callers can still opt out by
    // setting `includeImpactPacket: false` when they need a faster minimal
    // bundle.
    const wantsImpactPacket = input.includeImpactPacket !== false;
    const wantsDiagnostics = input.includeDiagnostics !== false;
    await options.progressReporter?.report({
      stage: "impact",
      message: "Collecting implementation, impact, graph, and optional tenant-audit context.",
      current: 1,
      total: 3,
    });
    const [
      implementationBrief,
      impactPacket,
      changePlanOutput,
      flowMapOutput,
      tenantLeakAuditOutput,
    ] = await Promise.all([
      generateWorkflowPacketSurfaceForQuery(
        {
          ...baseWorkflowQuery,
          family: "implementation_brief",
        },
        options,
      ),
      wantsImpactPacket
        ? generateWorkflowPacketSurfaceForQuery(
            {
              ...baseWorkflowQuery,
              family: "impact_packet",
            },
            options,
          )
        : Promise.resolve(null),
      changePlanTool(
        {
          projectId: project.projectId,
          startEntity: input.startEntity,
          targetEntity: input.targetEntity,
          ...(input.direction ? { direction: input.direction } : {}),
          ...(typeof input.traversalDepth === "number"
            ? { traversalDepth: input.traversalDepth }
            : {}),
          ...(input.edgeKinds ? { edgeKinds: input.edgeKinds } : {}),
          ...(typeof input.includeHeuristicEdges === "boolean"
            ? { includeHeuristicEdges: input.includeHeuristicEdges }
            : {}),
        },
        options,
      ),
      flowMapTool(
        {
          projectId: project.projectId,
          startEntity: input.startEntity,
          targetEntity: input.targetEntity,
          ...(input.direction ? { direction: input.direction } : {}),
          ...(typeof input.traversalDepth === "number"
            ? { traversalDepth: input.traversalDepth }
            : {}),
          ...(input.edgeKinds ? { edgeKinds: input.edgeKinds } : {}),
          ...(typeof input.includeHeuristicEdges === "boolean"
            ? { includeHeuristicEdges: input.includeHeuristicEdges }
            : {}),
        },
        options,
      ),
      input.includeTenantAudit
        ? tenantLeakAuditTool(
            {
              projectId: project.projectId,
              acknowledgeAdvisory: true,
              ...(typeof input.freshenTenantAudit === "boolean"
                ? { freshen: input.freshenTenantAudit }
                : {}),
            },
            options,
          )
        : Promise.resolve(null),
    ]);
    ensureImplementationBriefSurface(implementationBrief);
    if (impactPacket) {
      ensureImpactPacketSurface(impactPacket);
    }

    await options.progressReporter?.report({
      stage: "diagnostics",
      message: wantsDiagnostics ? "Collecting diagnostics for the review scope." : "Diagnostics disabled for this review bundle.",
      current: 2,
      total: 3,
    });

    // 7.5 close: run diagnostics scoped to the change plan's direct +
    // dependent surfaces. The same rule-packs + alignment diagnostics that
    // collectAnswerDiagnostics runs behind the answer loop. Empty focus
    // files → no findings → no basis ref (generator drops it). This keeps
    // noisy change scopes from inflating the bundle while still adopting
    // R4's rule-pack surface for review.
    let diagnostics: ReviewBundleDiagnosticsInput | undefined;
    if (wantsDiagnostics) {
      const focusFiles = collectChangePlanFocusFiles([
        ...changePlanOutput.result.directSurfaces,
        ...changePlanOutput.result.dependentSurfaces,
      ]);
      if (focusFiles.length > 0) {
        const findings = collectDiagnosticsForFiles({ projectStore, focusFiles });
        diagnostics = { findings, focusFiles };
      }
    }

    await options.progressReporter?.report({
      stage: "composing",
      message: "Composing the review bundle artifact.",
      current: 3,
      total: 3,
    });
    const result = generateReviewBundleArtifact({
      projectId: project.projectId,
      implementationBrief,
      changePlan: changePlanOutput.result,
      flowMap: flowMapOutput.result,
      ...(tenantLeakAuditOutput ? { tenantLeakAudit: tenantLeakAuditOutput.result } : {}),
      ...(impactPacket ? { impactPacket } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    });
    const exported = input.export?.file
      ? exportArtifactToFile(result, project.canonicalPath, input.export.file)
      : undefined;
    return {
      toolName: "review_bundle_artifact",
      projectId: project.projectId,
      result,
      ...(exported ? { exported } : {}),
    };
  });
}

export async function verificationBundleArtifactTool(
  input: VerificationBundleArtifactToolInput,
  options: ToolServiceOptions = {},
): Promise<VerificationBundleArtifactToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    await options.progressReporter?.report({
      stage: "verification_plan",
      message: "Generating the verification plan.",
      current: 1,
      total: 4,
    });
    const verificationPlan = await generateWorkflowPacketSurfaceForQuery(
      {
        projectId: project.projectId,
        family: "verification_plan",
        queryKind: input.queryKind,
        queryText: input.queryText,
        ...(input.queryArgs ? { queryArgs: input.queryArgs } : {}),
      },
      options,
    );
    ensureVerificationPlanSurface(verificationPlan);
    await options.progressReporter?.report({
      stage: "trust_state",
      message: "Resolving session context and trust-state basis.",
      current: 2,
      total: 4,
    });
    const sessionHandoff = input.includeSessionHandoff
      ? buildSessionHandoffResult(projectStore, { sourceTraceLimit: input.sessionLimit })
      : undefined;
    const issuesNext = input.includeIssuesNext
      ? buildIssuesNextResult(projectStore, { sourceTraceLimit: input.issuesLimit })
      : undefined;

    // 7.5 close for trust basis kinds. Effective traceId resolution:
    // 1. explicit `input.traceId` wins (verifier knows what they are signing off)
    // 2. otherwise sessionHandoff.currentFocus.traceId if session context is on
    // 3. otherwise issuesNext.currentIssue.traceId if queue context is on
    // If no traceId is reachable, trust refs are simply absent — the bundle
    // still works, the payload trustState field stays undefined.
    const effectiveTraceId =
      input.traceId ??
      sessionHandoff?.currentFocus?.traceId ??
      issuesNext?.currentIssue?.traceId ??
      undefined;
    const trustRun = effectiveTraceId
      ? projectStore.getAnswerTrustRun(effectiveTraceId)
      : null;
    const trustEvaluation = effectiveTraceId
      ? projectStore.getLatestAnswerTrustEvaluationForTrace(effectiveTraceId)
      : null;

    await options.progressReporter?.report({
      stage: "tenant_audit",
      message: input.includeTenantAudit ? "Running the optional tenant leak audit." : "Tenant leak audit disabled for this verification bundle.",
      current: 3,
      total: 4,
    });
    const tenantLeakAuditOutput = input.includeTenantAudit
      ? await tenantLeakAuditTool(
          {
            projectId: project.projectId,
            acknowledgeAdvisory: true,
            ...(typeof input.freshenTenantAudit === "boolean"
              ? { freshen: input.freshenTenantAudit }
              : {}),
          },
          options,
        )
      : null;

    await options.progressReporter?.report({
      stage: "composing",
      message: "Composing the verification bundle artifact.",
      current: 4,
      total: 4,
    });
    const result = generateVerificationBundleArtifact({
      projectId: project.projectId,
      verificationPlan,
      ...(sessionHandoff ? { sessionHandoff } : {}),
      ...(issuesNext ? { issuesNext } : {}),
      ...(tenantLeakAuditOutput ? { tenantLeakAudit: tenantLeakAuditOutput.result } : {}),
      ...(trustRun ? { trustRun } : {}),
      ...(trustEvaluation ? { trustEvaluation } : {}),
    });
    const exported = input.export?.file
      ? exportArtifactToFile(result, project.canonicalPath, input.export.file)
      : undefined;
    return {
      toolName: "verification_bundle_artifact",
      projectId: project.projectId,
      result,
      ...(exported ? { exported } : {}),
    };
  });
}

export async function taskPreflightArtifactTool(
  input: TaskPreflightArtifactToolInput,
  options: ToolServiceOptions = {},
): Promise<TaskPreflightArtifactToolOutput> {
  return withProjectContext(input, options, async ({ project }) => {
    const baseWorkflowQuery = {
      projectId: project.projectId,
      queryKind: input.queryKind,
      queryText: input.queryText,
      ...(input.queryArgs ? { queryArgs: input.queryArgs } : {}),
    } as const;
    const [implementationBrief, verificationPlan, changePlanOutput, flowMapOutput] = await Promise.all([
      generateWorkflowPacketSurfaceForQuery(
        {
          ...baseWorkflowQuery,
          family: "implementation_brief",
        },
        options,
      ),
      generateWorkflowPacketSurfaceForQuery(
        {
          ...baseWorkflowQuery,
          family: "verification_plan",
        },
        options,
      ),
      changePlanTool(
        {
          projectId: project.projectId,
          startEntity: input.startEntity,
          targetEntity: input.targetEntity,
          ...(input.direction ? { direction: input.direction } : {}),
          ...(typeof input.traversalDepth === "number"
            ? { traversalDepth: input.traversalDepth }
            : {}),
          ...(input.edgeKinds ? { edgeKinds: input.edgeKinds } : {}),
          ...(typeof input.includeHeuristicEdges === "boolean"
            ? { includeHeuristicEdges: input.includeHeuristicEdges }
            : {}),
        },
        options,
      ),
      flowMapTool(
        {
          projectId: project.projectId,
          startEntity: input.startEntity,
          targetEntity: input.targetEntity,
          ...(input.direction ? { direction: input.direction } : {}),
          ...(typeof input.traversalDepth === "number"
            ? { traversalDepth: input.traversalDepth }
            : {}),
          ...(input.edgeKinds ? { edgeKinds: input.edgeKinds } : {}),
          ...(typeof input.includeHeuristicEdges === "boolean"
            ? { includeHeuristicEdges: input.includeHeuristicEdges }
            : {}),
        },
        options,
      ),
    ]);
    ensureImplementationBriefSurface(implementationBrief);
    ensureVerificationPlanSurface(verificationPlan);
    const result = generateTaskPreflightArtifact({
      projectId: project.projectId,
      implementationBrief,
      verificationPlan,
      changePlan: changePlanOutput.result,
      flowMap: flowMapOutput.result,
    });
    const exported = input.export?.file
      ? exportArtifactToFile(result, project.canonicalPath, input.export.file)
      : undefined;
    return {
      toolName: "task_preflight_artifact",
      projectId: project.projectId,
      result,
      ...(exported ? { exported } : {}),
    };
  });
}
