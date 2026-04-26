import { RUNTIME_USEFULNESS_DECISION_KINDS } from "@mako-ai/contracts";
import type {
  RuntimeTelemetryReportDecisionKindCount,
  RuntimeTelemetryReportGradeCount,
  RuntimeTelemetryReportToolInput,
  RuntimeTelemetryReportToolOutput,
  RuntimeUsefulnessGrade,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

/**
 * `runtime_telemetry_report` — read-only inspection surface over
 * `mako_usefulness_events`.
 *
 * Aggregates are computed via SQL `GROUP BY` on the store side so they
 * stay accurate regardless of table size. The returned event list is
 * separately bounded by the caller's `limit` (default 100, cap 500).
 * `eventsInWindow` is the true matching-row count — not a page size —
 * so operators can see when truncation is happening.
 */

const DEFAULT_LIMIT = 100;
const ALL_GRADES: RuntimeUsefulnessGrade[] = ["full", "partial", "no"];

export async function runtimeTelemetryReportTool(
  input: RuntimeTelemetryReportToolInput,
  options: ToolServiceOptions = {},
): Promise<RuntimeTelemetryReportToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const warnings: string[] = [];
    const limit = input.limit ?? DEFAULT_LIMIT;

    const filter = {
      projectId: project.projectId,
      decisionKind: input.decisionKind,
      family: input.family,
      requestId: input.requestId,
      since: input.since,
      until: input.until,
    };

    // Aggregates run on the full matching set via SQL GROUP BY.
    const eventsInWindow = projectStore.countUsefulnessEvents(filter);
    const byDecisionKind = fillZeroDecisionKinds(
      projectStore.aggregateUsefulnessEventsByDecisionKind(filter),
    );
    const byFamily = projectStore.aggregateUsefulnessEventsByFamily(filter);
    const byGrade = fillZeroGrades(
      projectStore.aggregateUsefulnessEventsByGrade(filter),
    );

    // Event list is the only shape that pages; aggregates stay honest.
    const events = projectStore.queryUsefulnessEvents({ ...filter, limit });
    const truncated = eventsInWindow > events.length;
    if (truncated) {
      warnings.push(
        `returning first ${events.length} of ${eventsInWindow} matching events; raise \`limit\` or narrow the filter to see more.`,
      );
    }

    return {
      toolName: "runtime_telemetry_report",
      projectId: project.projectId,
      eventsInWindow,
      byDecisionKind,
      byFamily,
      byGrade,
      events,
      truncated,
      warnings,
    };
  });
}

// Ensure every shipped decision kind appears in the aggregate row even
// when its count is zero. Operators reading the report want to see the
// zero, not infer it from absence.
function fillZeroDecisionKinds(
  rows: readonly RuntimeTelemetryReportDecisionKindCount[],
): RuntimeTelemetryReportDecisionKindCount[] {
  const existing = new Map<string, number>(
    rows.map((row) => [row.decisionKind, row.count]),
  );
  const filled = RUNTIME_USEFULNESS_DECISION_KINDS.map((decisionKind) => ({
    decisionKind,
    count: existing.get(decisionKind) ?? 0,
  }));
  return filled.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.decisionKind.localeCompare(right.decisionKind);
  });
}

function fillZeroGrades(
  rows: readonly RuntimeTelemetryReportGradeCount[],
): RuntimeTelemetryReportGradeCount[] {
  const existing = new Map<string, number>(
    rows.map((row) => [row.grade, row.count]),
  );
  const filled = ALL_GRADES.map((grade) => ({
    grade,
    count: existing.get(grade) ?? 0,
  }));
  return filled.sort((left, right) => right.count - left.count);
}

