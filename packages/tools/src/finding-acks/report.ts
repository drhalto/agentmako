import type {
  FindingAcksReportToolInput,
  FindingAcksReportToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

/**
 * `finding_acks_report` — read-only view over the finding_acks ledger.
 *
 * Aggregates run on the full matching set via SQL GROUP BY on the store
 * side so counts stay accurate regardless of table size. The returned
 * acks list is separately bounded by `limit` (default 100, cap 500).
 * `acksInWindow` is the true matching-row count (not page size) so
 * operators can see when truncation is happening.
 */

const DEFAULT_LIMIT = 100;

export async function findingAcksReportTool(
  input: FindingAcksReportToolInput,
  options: ToolServiceOptions = {},
): Promise<FindingAcksReportToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const warnings: string[] = [];
    const limit = input.limit ?? DEFAULT_LIMIT;

    const filter = {
      projectId: project.projectId,
      ...(input.category ? { category: input.category } : {}),
      ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
    };

    const acksInWindow = projectStore.countFindingAcks(filter);
    const byCategory = projectStore.aggregateFindingAcksByCategory(filter);
    const byStatus = projectStore.aggregateFindingAcksByStatus(filter);
    const bySubjectKind = projectStore.aggregateFindingAcksBySubjectKind(filter);
    const byFilePath = projectStore.aggregateFindingAcksByFilePath(filter);

    const acks = projectStore.queryFindingAcks({ ...filter, limit });
    const truncated = acksInWindow > acks.length;
    if (truncated) {
      warnings.push(
        `returning first ${acks.length} of ${acksInWindow} matching acks; raise \`limit\` or narrow the filter to see more.`,
      );
    }

    return {
      toolName: "finding_acks_report",
      projectId: project.projectId,
      acksInWindow,
      byCategory,
      byStatus,
      bySubjectKind,
      byFilePath,
      acks,
      truncated,
      warnings,
    };
  });
}
