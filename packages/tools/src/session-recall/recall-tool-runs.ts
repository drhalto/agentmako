import type {
  RecallToolRunsToolInput,
  RecallToolRunsToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

const DEFAULT_RECALL_TOOL_RUNS_LIMIT = 50;
const MAX_RECALL_TOOL_RUNS_LIMIT = 500;
const DEFAULT_RECALL_WINDOW_DAYS = 30;

export async function recallToolRunsTool(
  input: RecallToolRunsToolInput,
  options: ToolServiceOptions = {},
): Promise<RecallToolRunsToolOutput> {
  const generatedAt = new Date();
  const limit = normalizeLimit(input.limit, DEFAULT_RECALL_TOOL_RUNS_LIMIT, MAX_RECALL_TOOL_RUNS_LIMIT);
  const since = input.since ?? daysAgoIso(generatedAt, DEFAULT_RECALL_WINDOW_DAYS);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const result = projectStore.recallToolRuns({
      projectId: project.projectId,
      toolName: input.toolName,
      outcome: input.outcome,
      requestId: input.requestId,
      since,
      until: input.until,
      limit,
      includePayload: input.includePayload,
    });
    const truncated = result.matchCount > result.toolRuns.length;
    const warnings = truncated
      ? [`recall_tool_runs truncated ${result.matchCount} matches to limit ${limit}. Narrow filters or increase limit.`]
      : [];

    return {
      toolName: "recall_tool_runs",
      projectId: project.projectId,
      generatedAt: generatedAt.toISOString(),
      matchCount: result.matchCount,
      truncated,
      toolRuns: result.toolRuns,
      warnings,
    };
  });
}

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (value == null) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.trunc(value)), max);
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
