import { randomUUID } from "node:crypto";
import type {
  FindingAck,
  FindingAckPreview,
  FindingAckToolInput,
  FindingAckToolOutput,
  RuntimeUsefulnessEvent,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { createRuntimeTelemetryEmitter } from "../runtime-telemetry/emit.js";

/**
 * `finding_ack` — mutation tool that appends one row to the finding_acks
 * ledger. Handler defaults for optional input fields:
 *
 * - `status` defaults to `"ignored"` when omitted. This matches the most
 *   common caller intent: "I have reviewed this match; stop surfacing it."
 *   Callers who want to record reviewed-but-kept should pass
 *   `status: "accepted"` explicitly.
 *
 * The ledger is append-only; duplicate `(projectId, category, fingerprint)`
 * inserts are allowed and persist as separate rows. Query-time filtering
 * dedupes by fingerprint.
 *
 * Every successful ack emits one `RuntimeUsefulnessEvent` row with
 * `decisionKind: "finding_ack"` so R8.5 failure clustering can aggregate
 * "this rule/category is acked N% of the time". Telemetry write failures
 * are swallowed — a failed telemetry row must never fail the ack itself.
 */

const ackLogger = createLogger("mako-tools", { component: "finding_ack" });

export interface InsertFindingAckWithTelemetryInput {
  projectId: string;
  projectStore: ProjectStore;
  input: AckInsertInput;
  requestId?: string;
  telemetryToolName?: "finding_ack" | "finding_ack_batch";
}

export type AckInsertInput = Omit<FindingAckToolInput, "projectId" | "projectRef" | "preview">;

export function buildFindingAckPreview(input: AckInsertInput): FindingAckPreview {
  return {
    category: input.category,
    subjectKind: input.subjectKind,
    ...(input.filePath ? { filePath: input.filePath } : {}),
    fingerprint: input.fingerprint,
    ...(input.snippet ? { snippet: input.snippet } : {}),
    status: input.status ?? "ignored",
    reason: input.reason,
    ...(input.acknowledgedBy ? { acknowledgedBy: input.acknowledgedBy } : {}),
    ...(input.sourceToolName ? { sourceToolName: input.sourceToolName } : {}),
    ...(input.sourceRuleId ? { sourceRuleId: input.sourceRuleId } : {}),
    ...(input.sourceIdentityMatchBasedId
      ? { sourceIdentityMatchBasedId: input.sourceIdentityMatchBasedId }
      : {}),
  };
}

export function insertFindingAckWithTelemetry(
  args: InsertFindingAckWithTelemetryInput,
): FindingAck {
  const status = args.input.status ?? "ignored";

  const ack = args.projectStore.insertFindingAck({
    projectId: args.projectId,
    category: args.input.category,
    subjectKind: args.input.subjectKind,
    ...(args.input.filePath ? { filePath: args.input.filePath } : {}),
    fingerprint: args.input.fingerprint,
    status,
    reason: args.input.reason,
    ...(args.input.acknowledgedBy ? { acknowledgedBy: args.input.acknowledgedBy } : {}),
    ...(args.input.snippet ? { snippet: args.input.snippet } : {}),
    ...(args.input.sourceToolName ? { sourceToolName: args.input.sourceToolName } : {}),
    ...(args.input.sourceRuleId ? { sourceRuleId: args.input.sourceRuleId } : {}),
    ...(args.input.sourceIdentityMatchBasedId
      ? { sourceIdentityMatchBasedId: args.input.sourceIdentityMatchBasedId }
      : {}),
  });

  // Runtime telemetry emission. `family` is the ack's category; the
  // reasonCodes carry status plus the source rule id (when set) so R8.5
  // can aggregate by rule deterministically. Grade is "full" on success;
  // there is no partial-ack state.
  const reasonCodes: string[] = [status];
  if (ack.sourceRuleId) {
    reasonCodes.push(ack.sourceRuleId);
  }

  const event: RuntimeUsefulnessEvent = {
    eventId: randomUUID(),
    projectId: args.projectId,
    requestId: args.requestId ?? `req_${randomUUID()}`,
    capturedAt: new Date().toISOString(),
    decisionKind: "finding_ack",
    family: ack.category,
    toolName: args.telemetryToolName ?? "finding_ack",
    grade: "full",
    reasonCodes,
    ...(ack.sourceToolName
      ? { reason: `ack from ${ack.sourceToolName}` }
      : {}),
  };

  const emit = createRuntimeTelemetryEmitter({
    insert: (input) => args.projectStore.insertUsefulnessEvent(input),
    logger: (msg, err) =>
      ackLogger.warn(msg, {
        ackId: ack.ackId,
        error: err instanceof Error ? err.message : String(err),
      }),
  });
  emit(event);

  return ack;
}

export async function findingAckTool(
  input: FindingAckToolInput,
  options: ToolServiceOptions = {},
): Promise<FindingAckToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const ackInput: AckInsertInput = {
      category: input.category,
      subjectKind: input.subjectKind,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      fingerprint: input.fingerprint,
      ...(input.status ? { status: input.status } : {}),
      reason: input.reason,
      ...(input.acknowledgedBy ? { acknowledgedBy: input.acknowledgedBy } : {}),
      ...(input.snippet ? { snippet: input.snippet } : {}),
      ...(input.sourceToolName ? { sourceToolName: input.sourceToolName } : {}),
      ...(input.sourceRuleId ? { sourceRuleId: input.sourceRuleId } : {}),
      ...(input.sourceIdentityMatchBasedId
        ? { sourceIdentityMatchBasedId: input.sourceIdentityMatchBasedId }
        : {}),
    };

    if (input.preview ?? true) {
      return {
        toolName: "finding_ack",
        projectId: project.projectId,
        preview: true,
        wouldApply: buildFindingAckPreview(ackInput),
      };
    }

    const ack = insertFindingAckWithTelemetry({
      projectId: project.projectId,
      requestId: options.requestContext?.requestId ?? `req_${randomUUID()}`,
      projectStore,
      input: ackInput,
    });

    return {
      toolName: "finding_ack",
      projectId: project.projectId,
      preview: false,
      ack,
    };
  });
}
