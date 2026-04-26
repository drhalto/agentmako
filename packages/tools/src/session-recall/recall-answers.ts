import type {
  RecallAnswersToolInput,
  RecallAnswersToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

const DEFAULT_RECALL_ANSWERS_LIMIT = 5;
const MAX_RECALL_ANSWERS_LIMIT = 100;
const DEFAULT_RECALL_WINDOW_DAYS = 30;

export async function recallAnswersTool(
  input: RecallAnswersToolInput,
  options: ToolServiceOptions = {},
): Promise<RecallAnswersToolOutput> {
  const generatedAt = new Date();
  const limit = normalizeLimit(input.limit, DEFAULT_RECALL_ANSWERS_LIMIT, MAX_RECALL_ANSWERS_LIMIT);
  const since = input.since ?? daysAgoIso(generatedAt, DEFAULT_RECALL_WINDOW_DAYS);

  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const result = projectStore.recallAnswers({
      projectId: project.projectId,
      query: input.query,
      queryKind: input.queryKind,
      supportLevel: input.supportLevel,
      trustState: input.trustState,
      since,
      until: input.until,
      limit,
    });
    const truncated = result.matchCount > result.answers.length;
    const warnings = truncated
      ? [`recall_answers truncated ${result.matchCount} matches to limit ${limit}. Narrow filters or increase limit.`]
      : [];

    return {
      toolName: "recall_answers",
      projectId: project.projectId,
      generatedAt: generatedAt.toISOString(),
      matchCount: result.matchCount,
      truncated,
      answers: result.answers,
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
