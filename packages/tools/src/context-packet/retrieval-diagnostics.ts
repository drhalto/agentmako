import type {
  ContextPacketLiveTextMiss,
  ContextPacketProviderRunDetail,
  ContextPacketProviderSkipDetail,
  ContextPacketRetrievalDiagnostics,
} from "@mako-ai/contracts";

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

export function buildContextPacketRetrievalDiagnostics(args: {
  providerRunDetails: readonly ContextPacketProviderRunDetail[];
  providersFailed: readonly string[];
  providersSkippedDetail: readonly ContextPacketProviderSkipDetail[];
  liveTextMisses: readonly ContextPacketLiveTextMiss[];
  totalContextCount: number;
  budgetExhausted: boolean;
}): ContextPacketRetrievalDiagnostics {
  const providerRunCount = args.providerRunDetails.length;
  const providerCandidateCount = args.providerRunDetails.reduce(
    (sum, detail) => sum + detail.candidateCount,
    0,
  );
  const zeroCandidateProviders = uniqueStrings(
    args.providerRunDetails
      .filter((detail) => detail.status === "success" && detail.candidateCount === 0)
      .map((detail) => detail.provider),
  );
  const failedProviders = uniqueStrings([
    ...args.providersFailed,
    ...args.providerRunDetails
      .filter((detail) => detail.status === "failed")
      .map((detail) => detail.provider),
  ]);
  const adaptiveSkippedProviders = uniqueStrings(
    args.providersSkippedDetail
      .filter((detail) => detail.adaptive)
      .map((detail) => detail.provider),
  );
  const slowestProvider = [...args.providerRunDetails]
    .sort((left, right) => right.durationMs - left.durationMs || right.candidateCount - left.candidateCount)
    .at(0);

  const recommendations: string[] = [];
  if (failedProviders.length > 0) {
    recommendations.push("Review provider warnings before relying on missing evidence from failed retrieval lanes.");
  }
  const scopedLiveTextMisses = args.liveTextMisses.filter((miss) => miss.scope === "file");
  if (scopedLiveTextMisses.length > 0) {
    recommendations.push("Quoted literal was not found in scoped current files; verify spelling/case or broaden live_text_search.");
  } else if (args.liveTextMisses.length > 0) {
    recommendations.push("Quoted literal was not found on the current filesystem; verify spelling/case or search related terms.");
  }
  if (args.totalContextCount === 0 && providerRunCount > 0 && providerCandidateCount === 0) {
    recommendations.push("All executed providers returned zero candidates; add focusFiles/focusSymbols or search exact text with live_text_search.");
  } else if (zeroCandidateProviders.length >= Math.max(3, Math.ceil(providerRunCount / 2))) {
    recommendations.push("Several providers returned no candidates; narrower anchors or quoted literals may improve recall.");
  }
  if (adaptiveSkippedProviders.length > 0) {
    recommendations.push("Adaptive routing narrowed retrieval; use expandableTools if broader context is needed.");
  }
  if (slowestProvider && slowestProvider.durationMs >= 250) {
    recommendations.push(`Provider ${slowestProvider.provider} dominated retrieval time; use focus anchors to reduce broad scans.`);
  }
  if (args.budgetExhausted) {
    recommendations.push("Context was budget-truncated; increase budgetTokens or narrow the request to inspect more candidates.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Provider coverage looks healthy; read cited files before editing exact lines.");
  }

  return {
    providerRunCount,
    providerCandidateCount,
    zeroCandidateProviders,
    failedProviders,
    adaptiveSkippedProviders,
    liveTextMisses: args.liveTextMisses.map((miss) => ({ ...miss })),
    ...(slowestProvider
      ? {
          slowestProvider: {
            provider: slowestProvider.provider,
            status: slowestProvider.status,
            candidateCount: slowestProvider.candidateCount,
            durationMs: slowestProvider.durationMs,
          },
        }
      : {}),
    recommendations,
  };
}
