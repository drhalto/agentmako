import type { ReefScoutToolOutput } from "@mako-ai/contracts";

const LOW_CONFIDENCE_THRESHOLD = 0.5;

function candidateConfidence(candidate: unknown): number | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = (candidate as { confidence?: unknown }).confidence;
  return typeof value === "number" ? value : undefined;
}

export function reefScoutHints(output: ReefScoutToolOutput): string[] {
  const hints: string[] = [];
  const candidates = Array.isArray(output.candidates) ? output.candidates : [];
  if (candidates.length === 0) {
    hints.push(
      "No reef candidates matched — broaden the query or call reef_inspect on a known fingerprint.",
    );
    return hints;
  }
  const lowConfidence = candidates.filter((candidate) => {
    const score = candidateConfidence(candidate);
    return score !== undefined && score < LOW_CONFIDENCE_THRESHOLD;
  }).length;
  if (lowConfidence > 0) {
    hints.push(
      `${lowConfidence} low-confidence candidate(s) — run diagnostic_refresh or db_reef_refresh before relying on them.`,
    );
  }
  const suggested = Array.isArray(output.suggestedActions) ? output.suggestedActions.length : 0;
  if (suggested > 0) {
    hints.push(
      `${suggested} suggested action(s) included — review them before chaining further tools.`,
    );
  }
  return hints;
}
