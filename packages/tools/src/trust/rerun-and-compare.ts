import {
  extractAnswerResultFromToolOutput as extractAnswerResult,
  isComposerQueryKind,
  type AnswerComparisonChange,
  type AnswerPacket,
  type AnswerResult,
  type JsonObject,
  type ProjectLocatorInput,
  type QueryKind,
  type SupportLevel,
  type ToolOutput,
} from "@mako-ai/contracts";
import { QUERY_PLANS } from "@mako-ai/engine";
import {
  createId,
  hashJson,
  hashText,
  type AnswerComparisonRecord,
  type AnswerTrustRunRecord,
  type SavedAnswerTraceRecord,
} from "@mako-ai/store";
import { MakoToolError } from "../errors.js";
import { invokeTool, runAnswerPacket } from "../registry.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { resolveTrustTargetAndRun } from "./common.js";

export interface RerunAndCompareInput extends ProjectLocatorInput {
  traceId?: string;
  targetId?: string;
}

export interface RerunAndCompareResult {
  priorTrace: SavedAnswerTraceRecord;
  priorRun: AnswerTrustRunRecord;
  currentTrace: SavedAnswerTraceRecord;
  currentRun: AnswerTrustRunRecord;
  comparison: AnswerComparisonRecord;
}

interface NormalizedEvidence {
  key: string;
  title: string;
  sourceRef: string;
  filePath?: string;
  line?: number;
  isFallback: boolean;
}

function isStrongComparableTrace(trace: SavedAnswerTraceRecord): boolean {
  return trace.evidenceStatus === "complete" && trace.supportLevel !== "best_effort";
}

function normalizeString(value: string | undefined | null): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeString(value)).filter((value) => value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function isFallbackEvidenceBlock(
  block: SavedAnswerTraceRecord["packet"]["evidence"][number],
): boolean {
  // Prefer the explicit metadata marker emitted by composers that want to
  // signal "we looked, found nothing structural." Fall back to the legacy
  // title heuristic so trust runs written before the metadata flag existed
  // still classify correctly on rerun.
  if (block.metadata && (block.metadata as { kind?: unknown }).kind === "fallback_evidence") {
    return true;
  }
  return block.line == null && block.title.toLowerCase().includes("no structural evidence");
}

function normalizeEvidence(trace: SavedAnswerTraceRecord): Map<string, NormalizedEvidence> {
  const entries = trace.packet.evidence.map((block) => {
    const normalized = {
      kind: block.kind,
      title: block.title,
      sourceRef: block.sourceRef,
      filePath: block.filePath ?? null,
      line: block.line ?? null,
      content: block.content,
      stale: block.stale ?? false,
      metadata: block.metadata ?? null,
    };
    const key = hashJson(normalized);
    return [
      key,
      {
        key,
        title: block.title,
        sourceRef: block.sourceRef,
        filePath: block.filePath,
        line: block.line,
        isFallback: isFallbackEvidenceBlock(block),
      },
    ] as const;
  });

  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return new Map(entries);
}

function describeEvidence(evidence: NormalizedEvidence): string {
  const location = evidence.filePath
    ? evidence.line
      ? `${evidence.filePath}:${evidence.line}`
      : evidence.filePath
    : evidence.sourceRef;
  return `${evidence.title} (${location})`;
}

function isFallbackReplacementEvidence(evidence: NormalizedEvidence): boolean {
  return evidence.isFallback;
}

function buildComparisonArtifacts(
  priorTrace: SavedAnswerTraceRecord,
  currentTrace: SavedAnswerTraceRecord,
  provenance: AnswerTrustRunRecord["provenance"],
): Pick<
  AnswerComparisonRecord,
  "summaryChanges" | "rawDelta" | "meaningfulChangeDetected" | "provenance"
> {
  const summaryChanges: AnswerComparisonChange[] = [];

  const priorMissing = normalizeStringSet(priorTrace.packet.missingInformation);
  const currentMissing = normalizeStringSet(currentTrace.packet.missingInformation);
  const missingAdded = currentMissing.filter((value) => !priorMissing.includes(value));
  const missingRemoved = priorMissing.filter((value) => !currentMissing.includes(value));

  const priorFlags = normalizeStringSet(priorTrace.packet.stalenessFlags);
  const currentFlags = normalizeStringSet(currentTrace.packet.stalenessFlags);
  const stalenessAdded = currentFlags.filter((value) => !priorFlags.includes(value));
  const stalenessRemoved = priorFlags.filter((value) => !currentFlags.includes(value));

  const priorEvidence = normalizeEvidence(priorTrace);
  const currentEvidence = normalizeEvidence(currentTrace);
  const addedEvidence = [...currentEvidence.values()].filter((item) => !priorEvidence.has(item.key));
  const removedEvidence = [...priorEvidence.values()].filter((item) => !currentEvidence.has(item.key));

  const priorAnswerHash = priorTrace.answerMarkdown ? hashText(priorTrace.answerMarkdown) : null;
  const currentAnswerHash = currentTrace.answerMarkdown ? hashText(currentTrace.answerMarkdown) : null;
  const answerMarkdownChanged = priorAnswerHash !== currentAnswerHash;

  if (priorTrace.evidenceStatus !== currentTrace.evidenceStatus) {
    summaryChanges.push({
      code: "answer_status_changed",
      detail: `evidence status moved from ${priorTrace.evidenceStatus} to ${currentTrace.evidenceStatus}`,
    });
  }

  if (priorTrace.supportLevel !== currentTrace.supportLevel) {
    summaryChanges.push({
      code: "support_level_changed",
      detail: `support level moved from ${priorTrace.supportLevel} to ${currentTrace.supportLevel}`,
    });
  }

  if ((priorTrace.answerConfidence ?? null) !== (currentTrace.answerConfidence ?? null)) {
    summaryChanges.push({
      code: "answer_confidence_changed",
      detail: `answer confidence moved from ${priorTrace.answerConfidence ?? "unset"} to ${currentTrace.answerConfidence ?? "unset"}`,
    });
  }

  if (missingAdded.length > 0) {
    summaryChanges.push({
      code: "missing_info_added",
      detail: `missing information added: ${missingAdded.join(", ")}`,
    });
  }

  if (missingRemoved.length > 0) {
    summaryChanges.push({
      code: "missing_info_removed",
      detail: `missing information removed: ${missingRemoved.join(", ")}`,
    });
  }

  if (stalenessAdded.length > 0) {
    summaryChanges.push({
      code: "staleness_flag_added",
      detail: `staleness flags added: ${stalenessAdded.join(", ")}`,
    });
  }

  if (stalenessRemoved.length > 0) {
    summaryChanges.push({
      code: "staleness_flag_removed",
      detail: `staleness flags removed: ${stalenessRemoved.join(", ")}`,
    });
  }

  if (addedEvidence.length > 0) {
    summaryChanges.push({
      code: "evidence_added",
      detail: `evidence added (${addedEvidence.length}): ${addedEvidence.map(describeEvidence).join(", ")}`,
    });
  }

  if (removedEvidence.length > 0) {
    summaryChanges.push({
      code: "evidence_removed",
      detail: `evidence removed (${removedEvidence.length}): ${removedEvidence.map(describeEvidence).join(", ")}`,
    });
  }

  const replacedWithFallbackOnly =
    addedEvidence.length > 0 && addedEvidence.every((item) => isFallbackReplacementEvidence(item));

  if (
    isStrongComparableTrace(priorTrace) &&
    isStrongComparableTrace(currentTrace) &&
    removedEvidence.length > 0 &&
    (addedEvidence.length === 0 || replacedWithFallbackOnly)
  ) {
    summaryChanges.push({
      code: "core_claim_conflict",
      detail: "same-target rerun removed strong evidence and only preserved fallback/no-structure support.",
    });
  }

  if (answerMarkdownChanged) {
    summaryChanges.push({
      code: "answer_markdown_changed",
      detail: "answer markdown changed while packet structure was re-evaluated separately",
    });
  }

  return {
    summaryChanges,
    rawDelta: {
      answer: {
        changed: answerMarkdownChanged,
        priorHash: priorAnswerHash,
        currentHash: currentAnswerHash,
      },
      packet: {
        evidenceStatus:
          priorTrace.evidenceStatus === currentTrace.evidenceStatus
            ? null
            : { before: priorTrace.evidenceStatus, after: currentTrace.evidenceStatus },
        supportLevel:
          priorTrace.supportLevel === currentTrace.supportLevel
            ? null
            : { before: priorTrace.supportLevel, after: currentTrace.supportLevel },
        answerConfidence:
          (priorTrace.answerConfidence ?? null) === (currentTrace.answerConfidence ?? null)
            ? null
            : { before: priorTrace.answerConfidence ?? null, after: currentTrace.answerConfidence ?? null },
        missingInformation: {
          added: missingAdded,
          removed: missingRemoved,
        },
        stalenessFlags: {
          added: stalenessAdded,
          removed: stalenessRemoved,
        },
        evidence: {
          added: addedEvidence.map((item) => ({
            key: item.key,
            title: item.title,
            sourceRef: item.sourceRef,
            filePath: item.filePath ?? null,
            line: item.line ?? null,
          })),
          removed: removedEvidence.map((item) => ({
            key: item.key,
            title: item.title,
            sourceRef: item.sourceRef,
            filePath: item.filePath ?? null,
            line: item.line ?? null,
          })),
        },
      },
    },
    meaningfulChangeDetected: summaryChanges.some((item) => item.code !== "answer_markdown_changed"),
    provenance,
  };
}

function createRerunPacket(
  trace: SavedAnswerTraceRecord,
  supportLevel: SupportLevel,
): AnswerPacket {
  const defaultTier = isComposerQueryKind(trace.queryKind)
    ? trace.packet.tierUsed
    : QUERY_PLANS[trace.queryKind].defaultTier;

  return {
    queryId: createId("query"),
    projectId: trace.packet.projectId,
    queryKind: trace.queryKind,
    queryText: trace.packet.queryText,
    tierUsed: defaultTier,
    supportLevel,
    evidenceStatus: "partial",
    evidenceConfidence: 0,
    missingInformation: [],
    stalenessFlags: [],
    evidence: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildComposerRerunInput(
  projectId: string,
  trace: SavedAnswerTraceRecord,
  run: AnswerTrustRunRecord,
): Record<string, unknown> {
  const identity = run.target.identity;

  switch (trace.queryKind) {
    case "trace_file":
      if (identity.kind !== "file_target" || typeof identity.filePath !== "string") break;
      return { projectId, file: identity.filePath };
    case "preflight_table":
    case "trace_table":
      if (identity.kind !== "table_target" || typeof identity.tableName !== "string") break;
      return {
        projectId,
        table: identity.tableName,
        schema: typeof identity.schemaName === "string" ? identity.schemaName : undefined,
      };
    case "trace_rpc":
      if (identity.kind !== "rpc_target" || typeof identity.rpcName !== "string") break;
      return {
        projectId,
        name: identity.rpcName,
        schema: typeof identity.schemaName === "string" ? identity.schemaName : undefined,
        argTypes: Array.isArray(identity.argTypes)
          ? identity.argTypes.filter((value): value is string => typeof value === "string")
          : undefined,
      };
    case "trace_edge":
      if (identity.kind !== "edge_target" || typeof identity.edgeName !== "string") break;
      return { projectId, name: identity.edgeName };
    case "trace_error":
      if (identity.kind !== "error_term_target" || typeof identity.term !== "string") break;
      return { projectId, term: identity.term };
    case "cross_search":
      return { projectId, term: run.target.normalizedQueryText };
    default:
      break;
  }

  throw new MakoToolError(400, "rerun_not_supported", `Rerun is not supported for ${trace.queryKind} targets yet.`);
}

export async function rerunAndCompare(
  input: RerunAndCompareInput,
  options: ToolServiceOptions = {},
): Promise<RerunAndCompareResult> {
  return withProjectContext(input, options, async ({ project, profile, projectStore }) => {
    const { run: priorRun } = resolveTrustTargetAndRun(projectStore, input);
    const priorTrace = projectStore.getAnswerTrace(priorRun.traceId);
    if (!priorTrace) {
      throw new MakoToolError(404, "trust_run_not_found", `Missing answer trace for trust run ${priorRun.traceId}.`);
    }

    const rerunOptions: ToolServiceOptions = {
      ...options,
      answerTraceOptions: {
        ...options.answerTraceOptions,
        provenance: "manual_rerun",
        identity: priorRun.target.identity,
      },
    };

    let currentResult: AnswerResult;
    if (isComposerQueryKind(priorTrace.queryKind)) {
      const extracted = extractAnswerResult(
        await invokeTool(
          priorTrace.queryKind,
          buildComposerRerunInput(project.projectId, priorTrace, priorRun),
          rerunOptions,
        ),
      );
      if (!extracted) {
        throw new Error("Tool output did not contain an AnswerResult.");
      }
      currentResult = extracted;
    } else {
      currentResult = await runAnswerPacket(
        createRerunPacket(priorTrace, profile?.supportLevel ?? priorTrace.supportLevel),
        rerunOptions,
      );
    }

    const currentTrace = projectStore.getAnswerTrace(currentResult.queryId);
    const currentRun = projectStore.getAnswerTrustRun(currentResult.queryId);
    if (!currentTrace || !currentRun) {
      throw new Error(`Manual rerun for ${priorRun.traceId} did not persist trust history.`);
    }
    if (currentRun.targetId !== priorRun.targetId) {
      throw new MakoToolError(
        409,
        "rerun_not_supported",
        `Manual rerun for ${priorRun.traceId} resolved to a different comparable target.`,
      );
    }

    const comparison = projectStore.insertAnswerComparison({
      targetId: priorRun.targetId,
      priorTraceId: priorRun.traceId,
      currentTraceId: currentRun.traceId,
      ...buildComparisonArtifacts(priorTrace, currentTrace, currentRun.provenance),
    });

    return {
      priorTrace,
      priorRun,
      currentTrace,
      currentRun,
      comparison,
    };
  });
}
