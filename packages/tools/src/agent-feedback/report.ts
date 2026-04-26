import type {
  AgentFeedbackAggregate,
  AgentFeedbackEntry,
  AgentFeedbackReportToolInput,
  AgentFeedbackReportToolOutput,
  RuntimeUsefulnessGrade,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

/**
 * `agent_feedback_report` — read-only inspection over agent-authored
 * usefulness feedback. Feedback is stored as RuntimeUsefulnessEvent rows
 * with `decisionKind: "agent_feedback"`; this report presents that shared
 * telemetry table in the caller vocabulary used by `agent_feedback`.
 */

const DEFAULT_LIMIT = 50;

interface AgentFeedbackAggregateRow {
  family: string;
  full_count: number;
  partial_count: number;
  no_count: number;
  total_count: number;
}

interface AgentFeedbackEntryRow {
  event_id: string;
  captured_at: string;
  family: string;
  request_id: string;
  grade: RuntimeUsefulnessGrade;
  reason_codes_json: string;
  reason: string | null;
}

export async function agentFeedbackReportTool(
  input: AgentFeedbackReportToolInput,
  options: ToolServiceOptions = {},
): Promise<AgentFeedbackReportToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const warnings: string[] = [];
    const limit = input.limit ?? DEFAULT_LIMIT;

    const { sql, values } = buildWhereClause(project.projectId, input);

    const countRow = projectStore.db
      .prepare(`SELECT COUNT(*) AS count FROM mako_usefulness_events ${sql}`)
      .get(...values) as { count: number } | undefined;
    const feedbackInWindow = countRow?.count ?? 0;

    const byTool = projectStore.db
      .prepare(`
        SELECT
          family,
          SUM(CASE WHEN grade = 'full' THEN 1 ELSE 0 END) AS full_count,
          SUM(CASE WHEN grade = 'partial' THEN 1 ELSE 0 END) AS partial_count,
          SUM(CASE WHEN grade = 'no' THEN 1 ELSE 0 END) AS no_count,
          COUNT(*) AS total_count
        FROM mako_usefulness_events
        ${sql}
        GROUP BY family
        ORDER BY total_count DESC, family ASC
      `)
      .all(...values) as unknown as AgentFeedbackAggregateRow[];

    const entries = projectStore.db
      .prepare(`
        SELECT
          event_id,
          captured_at,
          family,
          request_id,
          grade,
          reason_codes_json,
          reason
        FROM mako_usefulness_events
        ${sql}
        ORDER BY captured_at DESC, event_id DESC
        LIMIT ?
      `)
      .all(...values, limit) as unknown as AgentFeedbackEntryRow[];

    const truncated = feedbackInWindow > entries.length;
    if (truncated) {
      warnings.push(
        `returning first ${entries.length} of ${feedbackInWindow} matching feedback entries; raise \`limit\` or narrow the filter to see more.`,
      );
    }

    return {
      toolName: "agent_feedback_report",
      projectId: project.projectId,
      feedbackInWindow,
      byTool: byTool.map(toAggregate),
      entries: entries.map(toEntry),
      truncated,
      warnings,
    };
  });
}

function buildWhereClause(
  projectId: string,
  input: AgentFeedbackReportToolInput,
): { sql: string; values: Array<string | RuntimeUsefulnessGrade> } {
  const clauses = ["project_id = ?", "decision_kind = 'agent_feedback'"];
  const values: Array<string | RuntimeUsefulnessGrade> = [projectId];

  if (input.referencedToolName) {
    clauses.push("family = ?");
    values.push(input.referencedToolName);
  }
  if (input.grade) {
    clauses.push("grade = ?");
    values.push(input.grade);
  }
  if (input.since) {
    clauses.push("captured_at >= ?");
    values.push(input.since);
  }
  if (input.until) {
    clauses.push("captured_at <= ?");
    values.push(input.until);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    values,
  };
}

function toAggregate(row: AgentFeedbackAggregateRow): AgentFeedbackAggregate {
  return {
    referencedToolName: row.family,
    full: Number(row.full_count),
    partial: Number(row.partial_count),
    no: Number(row.no_count),
    total: Number(row.total_count),
  };
}

function toEntry(row: AgentFeedbackEntryRow): AgentFeedbackEntry {
  return {
    eventId: row.event_id,
    capturedAt: row.captured_at,
    referencedToolName: row.family,
    referencedRequestId: row.request_id,
    grade: row.grade,
    reasonCodes: parseReasonCodes(row.reason_codes_json),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

function parseReasonCodes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  } catch {
    return [];
  }
}
