import type {
  ContextPacketIntent,
  ContextPacketReadableCandidate,
  ContextPacketRisk,
  IndexFreshnessSummary,
} from "@mako-ai/contracts";

function addUnique(out: string[], value: string): void {
  if (!out.includes(value)) out.push(value);
}

export function buildRecommendedHarnessPattern(args: {
  intent: ContextPacketIntent;
  candidates: readonly ContextPacketReadableCandidate[];
  risks: readonly ContextPacketRisk[];
  indexFreshness?: IndexFreshnessSummary;
}): string[] {
  const steps: string[] = [];
  const dirty = args.indexFreshness != null && args.indexFreshness.state !== "fresh";
  if (dirty) {
    addUnique(steps, "Refresh or live-verify stale indexed evidence before editing.");
  }

  addUnique(steps, "Read primaryContext files first, in score order.");
  addUnique(steps, "Use symbols, routes, and databaseObjects as anchors for normal harness search.");

  switch (args.intent.primaryFamily) {
    case "debug_route":
      addUnique(steps, "Trace the matched route handler through its imports before broad text search.");
      break;
    case "debug_type_contract":
      addUnique(steps, "Search references for exported types and validate the narrowest typecheck target after edits.");
      break;
    case "debug_auth_state":
      addUnique(steps, "Follow auth/session state from creation to consumption before changing UI or route code.");
      break;
    case "debug_database_usage":
      addUnique(steps, "Inspect databaseObjects and their callers before editing schema or query code.");
      break;
    case "debug_ui_behavior":
      addUnique(steps, "Classify client/server boundaries and verify render-time values in primary UI files.");
      break;
    case "implement_feature":
      addUnique(steps, "Find the closest existing precedent in relatedContext before adding new structure.");
      break;
    case "review_change":
      addUnique(steps, "Compare changedFiles against dependents and run the smallest relevant verification command.");
      break;
    case "find_precedent":
      addUnique(steps, "Use relatedContext as examples, then confirm differences with normal harness search.");
      break;
    case "unknown":
      break;
  }

  for (const risk of args.risks) {
    if (risk.recommendedHarnessStep) {
      addUnique(steps, risk.recommendedHarnessStep);
    }
  }

  if (args.candidates.length > 0) {
    addUnique(steps, "Inspect relatedContext only when primaryContext does not explain the issue.");
  }
  addUnique(steps, "Use live_text_search to verify exact strings or line numbers after edits.");
  return steps;
}
