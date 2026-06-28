import type { MakoHelpToolOutput } from "@mako-ai/contracts";

export function makoHelpHints(output: MakoHelpToolOutput): string[] {
  const hints: string[] = [];
  const guide = output.retrievalPlanGuide;
  if (guide) {
    hints.push(`Retrieval-plan guide: after step ${guide.sourceStepId}, read ${guide.planPath}, ${guide.evidenceGapsPath}, and ${guide.recommendedFollowUpsPath}.`);
    hints.push(`Evidence gate: ${guide.evidenceGate}`);
    if (guide.preferToolBatch) {
      hints.push(`Use tool_batch when several read-only ${guide.recommendedFollowUpsPath} entries are recommended.`);
    }
    const strategies = guide.strategyActions.map((entry) => entry.strategy);
    if (strategies.length > 0) {
      hints.push(`Strategy actions available for: ${strategies.slice(0, 4).join(", ")}.`);
    }
  }

  const batchableCount = output.steps.filter((entry) => entry.batchable).length;
  if (batchableCount > 1) {
    hints.push(`${batchableCount} recipe step(s) are batchable; use batchHint.suggestedArgs after the first orienting result.`);
  }
  return hints;
}
