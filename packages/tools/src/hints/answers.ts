import type { AnswerResult } from "@mako-ai/contracts";

export interface AnswerLikeOutput {
  result?: unknown;
}

function isAnswerResult(value: unknown): value is AnswerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { packet?: unknown };
  return Boolean(candidate.packet && typeof candidate.packet === "object");
}

export function answerToolHints(toolName: string, output: AnswerLikeOutput): string[] {
  if (!isAnswerResult(output.result)) return [];
  const result = output.result;

  const hints: string[] = [];
  const evidence = Array.isArray(result.packet.evidence) ? result.packet.evidence.length : 0;
  if (evidence === 0) {
    hints.push(
      `${toolName} returned no evidence — try ask for routing or live_text_search for literal matches.`,
    );
  }
  if (Array.isArray(result.diagnostics) && result.diagnostics.length > 0) {
    const severe = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "critical" || diagnostic.severity === "high",
    );
    if (severe.length > 0) {
      hints.push(
        `${severe.length} high-severity diagnostic(s) flagged on this answer — review before declaring it resolved.`,
      );
    } else {
      // Medium/low diagnostics are heuristic leads; don't present them as
      // blockers on an otherwise clean answer.
      hints.push(
        `${result.diagnostics.length} heuristic diagnostic lead(s) attached — worth checking, not confirmed defects.`,
      );
    }
  }
  return hints;
}
