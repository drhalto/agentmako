import {
  TRUST_STATE_RANK,
  type CandidateAction,
  type AnswerRankingSurface,
  type AnswerResult,
  type AnswerSurfaceIssue,
  type AnswerTrustReason,
  type AnswerTrustState,
  type AnswerTrustSurface,
  type JsonObject,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore } from "@mako-ai/store";
import { buildSurfaceIssue } from "../diagnostics/common.js";
import { collectAnswerDiagnostics } from "../diagnostics/index.js";
import { captureRuntimePacketUsefulnessForAnswerResult } from "../runtime-telemetry/capture.js";
import {
  buildCompanionPacketAttachmentReason,
  decideCompanionPacket,
} from "../workflow-packets/attachment-policy.js";
import { generateWorkflowPacket } from "../workflow-packets/generators.js";
import { buildWorkflowPacketSurface } from "../workflow-packets/surface-common.js";
import { evaluateTrustState } from "./evaluate-trust-state.js";

const workflowPacketLogger = createLogger("mako-tools", { component: "workflow-packets" });

interface Input {
  result: AnswerResult;
  projectStore: ProjectStore;
  options?: import("../runtime.js").ToolServiceOptions;
}

export async function persistAndEnrichAnswerResult(input: Input): Promise<AnswerResult> {
  try {
    input.projectStore.saveAnswerTrace(input.result, input.options?.answerTraceOptions ?? {});
    const enriched = await enrichAnswerResultSurface(input);
    // Phase 8.1b: capture packet usefulness at answer time. Fire-and-forget;
    // the emitter swallows any failure so telemetry never breaks the answer.
    captureRuntimePacketUsefulnessForAnswerResult({
      answerResult: enriched,
      projectStore: input.projectStore,
      requestId: input.options?.requestContext?.requestId ?? enriched.queryId,
    });
    return enriched;
  } catch {
    // Trust enrichment and trace persistence are additive. If this layer fails,
    // return the raw answer result instead of breaking the tool call.
    return input.result;
  }
}

export async function enrichAnswerResultSurface(input: Input): Promise<AnswerResult> {
  const trustRun = input.projectStore.getAnswerTrustRun(input.result.queryId);
  if (!trustRun) {
    return input.result;
  }

  const trustSnapshot = await evaluateTrustState(
    {
      projectId: input.result.projectId,
      traceId: trustRun.traceId,
    },
    input.options,
  );

  const diagnostics = collectAnswerDiagnostics({
    projectStore: input.projectStore,
    result: input.result,
  });
  const trust = buildTrustSurface({
    snapshot: trustSnapshot,
    diagnostics,
  });
  const ranking = buildAnswerRankingSurface(trust.state, diagnostics);
  const enriched: AnswerResult = {
    ...input.result,
    trust,
    diagnostics,
    ranking,
  };
  const companionPacket = await buildCompanionPacket(enriched);
  if (!companionPacket) {
    return enriched;
  }

  return {
    ...enriched,
    candidateActions: attachCompanionHandoffAction(enriched.candidateActions, companionPacket, enriched),
    companionPacket,
  } as AnswerResult;
}

async function buildCompanionPacket(result: AnswerResult) {
  const decision = decideCompanionPacket(result);
  if (!decision) {
    return undefined;
  }

  workflowPacketLogger.info("workflow_packet.companion_decision", {
    queryKind: decision.trigger.queryKind,
    supportLevel: decision.trigger.supportLevel,
    evidenceStatus: decision.trigger.evidenceStatus,
    trustState: decision.trigger.trustState,
    family: decision.family,
  });

  try {
    const packet = await generateWorkflowPacket(result, {
      family: decision.family,
      scope: "primary",
    });
    return buildWorkflowPacketSurface(packet, {
      attachmentReason: buildCompanionPacketAttachmentReason(decision),
      attachmentDecision: decision,
    });
  } catch {
    // Companion packets are additive. Keep the enriched answer if packet
    // generation fails instead of dropping trust/diagnostic output.
    return undefined;
  }
}

function attachCompanionHandoffAction(
  candidateActions: readonly CandidateAction[],
  companionPacket: NonNullable<AnswerResult["companionPacket"]>,
  result: Pick<AnswerResult, "projectId" | "queryId" | "queryKind" | "packet">,
): CandidateAction[] {
  if (!companionPacket.handoff) {
    return [...candidateActions];
  }

  const actionId = `workflow_handoff:${companionPacket.packet.family}:${result.queryId}`;
  const workflowAction: CandidateAction = {
    actionId,
    label: companionPacket.packet.family === "workflow_recipe" ? "Follow workflow recipe" : "Follow verification plan",
    description: describeCompanionHandoff(companionPacket),
    safeToAutomate: false,
    execute: buildCompanionPacketActionExecution(companionPacket, result, actionId),
  };

  const dedupeKey = normalizeActionKey(workflowAction);
  const filtered = candidateActions.filter((action) => normalizeActionKey(action) !== dedupeKey);
  return [workflowAction, ...filtered];
}

function describeCompanionHandoff(
  companionPacket: NonNullable<AnswerResult["companionPacket"]>,
): string {
  if (!companionPacket.handoff) {
    return "Follow the attached workflow guidance.";
  }

  const parts = [
    `Current: ${companionPacket.handoff.current}`,
    `Stop when: ${companionPacket.handoff.stopWhen}`,
  ];
  if (companionPacket.handoff.refreshWhen) {
    parts.push(`Refresh when: ${companionPacket.handoff.refreshWhen}`);
  }
  return parts.join(". ");
}

function normalizeActionKey(action: Pick<CandidateAction, "label" | "description">): string {
  return `${action.label}\u0000${action.description}`.trim().toLowerCase();
}

function buildCompanionPacketActionExecution(
  companionPacket: NonNullable<AnswerResult["companionPacket"]>,
  result: Pick<AnswerResult, "projectId" | "queryId" | "queryKind" | "packet">,
  actionId: string,
): CandidateAction["execute"] {
  const queryTarget = resolveCompanionPacketQueryTarget(result.queryKind, result.packet.queryText);
  const input: JsonObject = {
    projectId: result.projectId,
    family: companionPacket.packet.family,
    queryKind: result.queryKind,
    queryText: queryTarget.queryText,
    ...(queryTarget.queryArgs ? { queryArgs: queryTarget.queryArgs } : {}),
    scope: companionPacket.packet.basis.scope,
    ...(companionPacket.packet.basis.focusedItemIds.length > 0
      ? { focusItemIds: companionPacket.packet.basis.focusedItemIds }
      : {}),
    followup: {
      originQueryId: result.queryId,
      originActionId: actionId,
      originPacketId: companionPacket.packet.packetId,
      originPacketFamily: companionPacket.packet.family,
      originQueryKind: result.queryKind,
    },
  };

  return {
    toolName: "workflow_packet",
    input,
  };
}

function resolveCompanionPacketQueryTarget(
  queryKind: Pick<AnswerResult, "queryKind">["queryKind"],
  packetQueryText: string,
): { queryText: string; queryArgs?: JsonObject } {
  switch (queryKind) {
    case "file_health": {
      const trimmed = packetQueryText.trim();
      return {
        queryText: trimmed,
        queryArgs: { file: trimmed },
      };
    }
    case "trace_file": {
      const parsed = parseWrappedQuery("trace_file", packetQueryText);
      if (!parsed) {
        break;
      }
      return {
        queryText: parsed,
        queryArgs: { file: parsed },
      };
    }
    case "trace_table": {
      const parsed = parseWrappedQuery("trace_table", packetQueryText);
      if (!parsed) {
        break;
      }
      const qualified = parseQualifiedName(parsed);
      return {
        queryText: qualified.name,
        queryArgs: qualified.schema
          ? { table: qualified.name, schema: qualified.schema }
          : { table: qualified.name },
      };
    }
    case "trace_rpc": {
      const parsed = parseTraceRpcQuery(packetQueryText);
      if (!parsed) {
        break;
      }
      return {
        queryText: parsed.name,
        queryArgs: {
          name: parsed.name,
          ...(parsed.schema ? { schema: parsed.schema } : {}),
          ...(parsed.argTypes.length > 0 ? { argTypes: parsed.argTypes } : {}),
        },
      };
    }
  }

  return { queryText: packetQueryText };
}

function parseWrappedQuery(prefix: string, value: string): string | null {
  const trimmed = value.trim();
  const expectedPrefix = `${prefix}(`;
  if (!trimmed.startsWith(expectedPrefix) || !trimmed.endsWith(")")) {
    return null;
  }
  const inner = trimmed.slice(expectedPrefix.length, -1).trim();
  return inner.length > 0 ? inner : null;
}

function parseQualifiedName(value: string): { schema: string | null; name: string } {
  const trimmed = value.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return { schema: null, name: trimmed };
  }
  return {
    schema: trimmed.slice(0, dotIndex).trim() || null,
    name: trimmed.slice(dotIndex + 1).trim(),
  };
}

function parseTraceRpcQuery(
  value: string,
): { schema: string | null; name: string; argTypes: string[] } | null {
  const inner = parseWrappedQuery("trace_rpc", value);
  if (!inner) {
    return null;
  }

  const parenIndex = inner.indexOf("(");
  if (parenIndex < 0) {
    const qualified = parseQualifiedName(inner);
    return {
      schema: qualified.schema,
      name: qualified.name,
      argTypes: [],
    };
  }

  if (!inner.endsWith(")")) {
    return null;
  }

  const qualified = parseQualifiedName(inner.slice(0, parenIndex).trim());
  const argText = inner.slice(parenIndex + 1, -1).trim();
  return {
    schema: qualified.schema,
    name: qualified.name,
    argTypes:
      argText.length === 0
        ? []
        : argText
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
  };
}

function buildTrustSurface(args: {
  snapshot: Awaited<ReturnType<typeof evaluateTrustState>>;
  diagnostics: AnswerSurfaceIssue[];
}): AnswerTrustSurface {
  const { snapshot, diagnostics } = args;
  const issues = [
    ...snapshot.evaluation.reasons.map((reason) => trustReasonToIssue(reason, snapshot.evaluation.state)),
    ...diagnostics,
  ];

  return {
    state: snapshot.evaluation.state,
    reasons: snapshot.evaluation.reasons,
    basisTraceIds: snapshot.evaluation.basisTraceIds,
    conflictingFacets: snapshot.evaluation.conflictingFacets,
    scopeRelation: snapshot.evaluation.scopeRelation,
    comparisonId: snapshot.evaluation.comparisonId,
    clusterId: snapshot.evaluation.clusterId,
    comparisonSummary: snapshot.comparison?.summaryChanges ?? [],
    issues,
  };
}

function trustReasonToIssue(reason: AnswerTrustReason, state: AnswerTrustState): AnswerSurfaceIssue {
  const severity = trustStateSeverity(state);
  return buildSurfaceIssue({
    category: "trust",
    code: `trust.${reason.code}`,
    message: reason.detail,
    severity,
    confidence: "confirmed",
    evidenceRefs: [],
    matchKey: {
      state,
      reasonCode: reason.code,
    },
    codeFingerprint: {
      state,
      reason,
    },
    metadata: {
      state,
    },
  });
}

export function buildAnswerRankingSurface(
  state: AnswerTrustState,
  diagnostics: AnswerSurfaceIssue[],
): AnswerRankingSurface {
  const reasons: AnswerSurfaceIssue[] = [];
  let orderKey = baseRankForState(state);
  let deEmphasized = state === "stale" || state === "contradicted" || state === "insufficient_evidence" || state === "superseded";

  if (state !== "stable" && state !== "changed") {
    reasons.push(
      buildSurfaceIssue({
        category: "ranking",
        code: `rank.deemphasize_${state}`,
        message: `This answer is de-emphasized because its trust state is \`${state}\`.`,
        severity: state === "contradicted" ? "critical" : state === "insufficient_evidence" ? "high" : "medium",
        confidence: "confirmed",
        evidenceRefs: [],
        matchKey: {
          state,
        },
        codeFingerprint: {
          state,
        },
      }),
    );
  }

  const diagnosticPenalty = diagnostics.some(
    (diagnostic) =>
      (diagnostic.severity === "high" || diagnostic.severity === "critical") &&
      diagnostic.confidence !== "possible",
  );
  if (diagnosticPenalty) {
    orderKey -= 10;
    // Aging alone is NOT de-emphasized — it's the "review soon" middle state.
    // But aging + high-confidence alignment diagnostics is a real signal that
    // the answer should drop below cleaner comparable history.
    deEmphasized = deEmphasized || state === "aging";
    reasons.push(
      buildSurfaceIssue({
        category: "ranking",
        code: "rank.diagnostic_penalty",
        message: "High-confidence alignment diagnostics lower this answer's ranking relative to cleaner comparable history.",
        severity: "medium",
        confidence: "confirmed",
        evidenceRefs: diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs).slice(0, 8),
        matchKey: {
          state,
          diagnosticIds: diagnostics.map((diagnostic) => diagnostic.identity.matchBasedId).sort(),
        },
        codeFingerprint: diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          confidence: diagnostic.confidence,
        })),
      }),
    );
  }

  return {
    orderKey,
    deEmphasized,
    reasons,
  };
}

function baseRankForState(state: AnswerTrustState): number {
  return TRUST_STATE_RANK[state] ?? 0;
}

function trustStateSeverity(state: AnswerTrustState): AnswerSurfaceIssue["severity"] {
  switch (state) {
    case "contradicted":
      return "critical";
    case "insufficient_evidence":
    case "stale":
      return "high";
    case "aging":
    case "superseded":
      return "medium";
    default:
      return "low";
  }
}
