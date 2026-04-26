import type {
  FindingAck,
  FindingAckBatchRejectedRow,
  FindingAckBatchRow,
  FindingAckBatchToolInput,
  FindingAckBatchToolOutput,
  FindingAckToolInput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { insertFindingAckWithTelemetry } from "./ack.js";

type AckInsertInput = Omit<FindingAckToolInput, "projectId" | "projectRef">;

export async function findingAckBatchTool(
  input: FindingAckBatchToolInput,
  options: ToolServiceOptions = {},
): Promise<FindingAckBatchToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const acks: FindingAck[] = [];
    const rejected: FindingAckBatchRejectedRow[] = [];
    const warnings: string[] = [];
    const continueOnError = input.continueOnError ?? true;

    for (const [index, row] of input.rows.entries()) {
      const merged = mergeAckRow(input, row);
      if (!merged.ok) {
        rejected.push({
          index,
          ...(row.label ? { label: row.label } : {}),
          ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
          reason: merged.reason,
        });
        if (!continueOnError) {
          warnings.push("stopped after the first rejected ack row");
          break;
        }
        continue;
      }

      try {
        const ack = insertFindingAckWithTelemetry({
          projectId: project.projectId,
          projectStore,
          input: merged.input,
          requestId: options.requestContext?.requestId,
          telemetryToolName: "finding_ack_batch",
        });
        acks.push(ack);
      } catch (error) {
        rejected.push({
          index,
          ...(row.label ? { label: row.label } : {}),
          ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
          reason: error instanceof Error ? error.message : String(error),
        });
        if (!continueOnError) {
          warnings.push("stopped after the first failed ack insert");
          break;
        }
      }
    }

    return {
      toolName: "finding_ack_batch",
      projectId: project.projectId,
      acks,
      rejected,
      summary: {
        requestedRows: input.rows.length,
        ackedRows: acks.length,
        rejectedRows: rejected.length,
      },
      warnings,
    };
  });
}

function mergeAckRow(
  input: FindingAckBatchToolInput,
  row: FindingAckBatchRow,
): { ok: true; input: AckInsertInput } | { ok: false; reason: string } {
  const category = row.category ?? input.category;
  const subjectKind = row.subjectKind ?? input.subjectKind;
  const reason = row.reason ?? input.reason;

  if (!category) {
    return { ok: false, reason: "category is required on the row or batch input" };
  }
  if (!subjectKind) {
    return { ok: false, reason: "subjectKind is required on the row or batch input" };
  }
  if (!reason) {
    return { ok: false, reason: "reason is required on the row or batch input" };
  }

  return {
    ok: true,
    input: {
      category,
      subjectKind,
      ...(row.filePath ? { filePath: row.filePath } : {}),
      fingerprint: row.fingerprint,
      ...(row.snippet ? { snippet: row.snippet } : {}),
      ...(row.status ?? input.status ? { status: row.status ?? input.status } : {}),
      reason,
      ...(row.acknowledgedBy ?? input.acknowledgedBy
        ? { acknowledgedBy: row.acknowledgedBy ?? input.acknowledgedBy }
        : {}),
      ...(row.sourceToolName ?? input.sourceToolName
        ? { sourceToolName: row.sourceToolName ?? input.sourceToolName }
        : {}),
      ...(row.sourceRuleId ?? input.sourceRuleId
        ? { sourceRuleId: row.sourceRuleId ?? input.sourceRuleId }
        : {}),
      ...(row.sourceIdentityMatchBasedId
        ? { sourceIdentityMatchBasedId: row.sourceIdentityMatchBasedId }
        : {}),
    },
  };
}
