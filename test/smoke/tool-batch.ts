import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolBatchInputSchema, type ToolBatchToolOutput } from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { indexProject } from "../../services/indexer/src/index.ts";

function record(value: unknown): Record<string, unknown> {
  assert.equal(value != null && typeof value === "object" && !Array.isArray(value), true);
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-tool-batch-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "tool-batch-smoke" }));
  writeFileSync(
    path.join(projectRoot, "src", "auth.ts"),
    [
      "export interface UserSession { id: string }",
      "export function getSession(): UserSession { return { id: 'u1' }; }",
    ].join("\n"),
  );

  const projectStoreCache = createProjectStoreCache();
  const hotIndexCache = createHotIndexCache();

  try {
    const indexed = await indexProject(projectRoot, { projectStoreCache });
    const output = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        ops: [
          { label: "status", tool: "project_index_status", args: { includeUnindexed: false } },
          { label: "map", tool: "repo_map", args: { maxFiles: 3 }, resultMode: "full" },
          { label: "focused-map", tool: "repo_map", args: { focusFiles: ["src/auth.ts"], maxFiles: 3 } },
          { label: "packet", tool: "context_packet", args: { request: "auth user session type broke" } },
          {
            label: "literal-packet",
            tool: "context_packet",
            args: { request: "find \"u1\"", focusFiles: ["src/auth.ts"] },
          },
          {
            label: "literal-miss-packet",
            tool: "context_packet",
            args: { request: "find \"missing-u9\"", focusFiles: ["src/auth.ts"] },
          },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_smoke" },
      },
    ) as ToolBatchToolOutput;

    assert.equal(output.toolName, "tool_batch");
    assert.equal(output.summary.requestedOps, 6);
    assert.equal(output.summary.executedOps, 6);
    assert.equal(output.summary.succeededOps, 6);
    assert.equal(output.summary.rejectedOps, 0);
    assert.equal(output.results.find((result) => result.label === "status")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "map")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "focused-map")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "literal-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "literal-miss-packet")?.ok, true);
    assert.ok(
      output.results.find((result) => result.label === "status")?.resultSummary,
      "compact verbosity should return a summary for ops without resultMode: full",
    );
    assert.ok(output.results.find((result) => result.label === "map")?.result, "resultMode: full should keep full payload");
    const focusedMapSummary = record(output.results.find((result) => result.label === "focused-map")?.resultSummary);
    assert.equal(focusedMapSummary.toolName, "repo_map");
    assert.equal(focusedMapSummary.totalFilesIndexed, 2);
    assert.equal(focusedMapSummary.topFiles instanceof Array, true);
    const focusedMapTopFile = record((focusedMapSummary.topFiles as unknown[])[0]);
    assert.equal(focusedMapTopFile.filePath, "src/auth.ts");
    assert.equal(focusedMapTopFile.graphRankMode, "personalized");
    assert.equal(focusedMapTopFile.graphRankDirection, "bidirectional");
    assert.equal(focusedMapTopFile.focusRelation, "self");
    assert.equal(focusedMapTopFile.focusDistance, 0);
    assert.deepEqual(focusedMapTopFile.symbolsIncluded, { count: 2 });
    const packetSummary = record(output.results.find((result) => result.label === "packet")?.resultSummary);
    assert.equal(packetSummary.toolName, "context_packet");
    assert.equal(packetSummary.request, "auth user session type broke");
    const primaryContextSummary = record(packetSummary.primaryContext);
    assert.equal(typeof primaryContextSummary.count, "number");
    assert.equal(primaryContextSummary.top instanceof Array, true);
    assert.ok((primaryContextSummary.top as unknown[]).length > 0, "compact context_packet summary should keep top primary candidates");
    const primaryContextTop = record((primaryContextSummary.top as unknown[])[0]);
    assert.equal(typeof primaryContextTop.kind, "string");
    assert.equal(typeof primaryContextTop.source, "string");
    assert.equal(typeof primaryContextTop.strategy, "string");
    assert.equal(typeof primaryContextTop.score, "number");
    assert.equal(typeof primaryContextTop.confidence, "number");
    assert.equal(
      primaryContextTop.path === undefined || typeof primaryContextTop.path === "string",
      true,
      "compact context_packet candidate should preserve path when present",
    );
    const expandableToolsSummary = record(packetSummary.expandableTools);
    assert.equal(expandableToolsSummary.top instanceof Array, true);
    assert.ok(
      (expandableToolsSummary.top as unknown[]).some((tool) => record(tool).toolName === "repo_map"),
      "compact context_packet summary should keep top expansion tools",
    );
    const evidenceQualitySummary = record(packetSummary.evidenceQuality);
    assert.equal(typeof evidenceQualitySummary.label, "string");
    assert.equal(typeof evidenceQualitySummary.score, "number");
    assert.equal(Array.isArray(evidenceQualitySummary.reasons), true);
    assert.equal(typeof evidenceQualitySummary.recommendedAction, "string");
    assert.equal(typeof evidenceQualitySummary.totalContextCount, "number");
    assert.equal(typeof evidenceQualitySummary.freshContextCount, "number");
    const evidenceQualityCoverageSummary = record(evidenceQualitySummary.requestCoverage);
    assert.equal(typeof evidenceQualityCoverageSummary.status, "string");
    assert.equal(typeof evidenceQualityCoverageSummary.unresolvedCount, "number");
    const evidenceQualityGraphSummary = record(evidenceQualitySummary.graph);
    assert.equal(typeof evidenceQualityGraphSummary.status, "string");
    assert.equal(typeof evidenceQualityGraphSummary.edgeCount, "number");
    const graphSummary = record(packetSummary.graphSummary);
    assert.equal(typeof graphSummary.returnedFileCount, "number");
    assert.equal(graphSummary.files instanceof Array, true);
    assert.equal(graphSummary.edges instanceof Array, true);
    const requestCoverageSummary = record(packetSummary.requestCoverage);
    assert.equal(typeof requestCoverageSummary.status, "string");
    assert.equal(typeof requestCoverageSummary.requestedCount, "number");
    assert.equal(requestCoverageSummary.items instanceof Array, true);
    const retrievalDiagnosticsSummary = record(packetSummary.retrievalDiagnostics);
    assert.equal(typeof retrievalDiagnosticsSummary.providerRunCount, "number");
    assert.equal(typeof retrievalDiagnosticsSummary.providerCandidateCount, "number");
    assert.equal(Array.isArray(retrievalDiagnosticsSummary.recommendations), true);
    const packetLimits = record(packetSummary.limits);
    assert.equal(Array.isArray(packetLimits.providersRun), true);
    assert.equal(Array.isArray(packetLimits.providersRunDetail), true);
    assert.equal(typeof packetLimits.candidatesReturned, "number");
    const literalPacketSummary = record(output.results.find((result) => result.label === "literal-packet")?.resultSummary);
    const literalPrimaryContextSummary = record(literalPacketSummary.primaryContext);
    const literalTop = record((literalPrimaryContextSummary.top as unknown[])[0]);
    assert.equal(literalTop.source, "live_text_provider");
    const literalMetadata = record(literalTop.metadata);
    assert.equal(literalMetadata.query, "u1");
    assert.equal(literalMetadata.overlay, "live_filesystem");
    assert.equal(literalMetadata.evidenceConfidenceLabel, "verified_live");
    assert.equal(literalMetadata.scopePath, "src/auth.ts");
    const literalGraphSummary = record(literalPacketSummary.graphSummary);
    assert.ok(
      (literalGraphSummary.anchorFiles as unknown[]).includes("src/auth.ts"),
      "compact context_packet summary should keep graph anchors",
    );
    assert.ok(
      (literalGraphSummary.files as unknown[]).some((file) => {
        const entry = record(file);
        return entry.filePath === "src/auth.ts" &&
          entry.relation === "anchor" &&
          entry.distance === 0;
      }),
      "compact context_packet summary should keep graph file relation labels",
    );
    const literalRequestCoverage = record(literalPacketSummary.requestCoverage);
    assert.equal(literalRequestCoverage.status, "complete");
    assert.ok(
      (literalRequestCoverage.items as unknown[]).some((item) => {
        const entry = record(item);
        return entry.kind === "quoted_text" &&
          entry.value === "u1" &&
          entry.status === "covered" &&
          (entry.matchedBy as unknown[]).some((ref) => typeof ref === "string" && ref.includes("live_text_provider"));
      }),
      "compact context_packet summary should preserve covered quoted literal request coverage",
    );
    const literalPacketLimits = record(literalPacketSummary.limits);
    const literalRetrievalDiagnostics = record(literalPacketSummary.retrievalDiagnostics);
    assert.ok(
      (literalRetrievalDiagnostics.adaptiveSkippedProviders as unknown[]).includes("file_provider"),
      "compact context_packet summary should preserve adaptive skipped provider diagnostics",
    );
    assert.ok(
      (literalRetrievalDiagnostics.recommendations as unknown[]).some((recommendation) =>
        typeof recommendation === "string" && recommendation.includes("Adaptive routing")
      ),
      "compact context_packet summary should preserve retrieval recommendations",
    );
    const literalRunDetail = literalPacketLimits.providersRunDetail as unknown[];
    assert.equal(Array.isArray(literalRunDetail), true);
    assert.ok(
      literalRunDetail.some((detail) => {
        const entry = record(detail);
        return entry.provider === "live_text_provider" &&
          entry.status === "success" &&
          Number(entry.candidateCount) > 0 &&
          typeof entry.durationMs === "number";
      }),
      "compact context_packet summary should preserve live provider run details",
    );
    const literalSkippedDetail = literalPacketLimits.providersSkippedDetail as unknown[];
    assert.equal(Array.isArray(literalSkippedDetail), true);
    assert.ok(
      literalSkippedDetail.some((detail) => {
        const entry = record(detail);
        return entry.provider === "hot_hint_index" && entry.adaptive === true;
      }),
      "compact context_packet summary should preserve adaptive skip details",
    );
    assert.ok(
      literalSkippedDetail.some((detail) => {
        const entry = record(detail);
        return entry.provider === "file_provider" && entry.adaptive === true;
      }),
      "compact context_packet summary should preserve data-driven scoped literal pruning",
    );
    const literalMissPacketSummary = record(output.results.find((result) => result.label === "literal-miss-packet")?.resultSummary);
    const literalMissDiagnostics = record(literalMissPacketSummary.retrievalDiagnostics);
    const literalMisses = literalMissDiagnostics.liveTextMisses as unknown[];
    assert.ok(
      literalMisses.some((miss) => {
        const entry = record(miss);
        return entry.query === "missing-u9" &&
          entry.scope === "file" &&
          entry.scopePath === "src/auth.ts";
      }),
      "compact context_packet summary should preserve scoped live literal misses",
    );
    assert.ok(
      (literalMissDiagnostics.recommendations as unknown[]).some((recommendation) =>
        typeof recommendation === "string" &&
        recommendation.includes("Quoted literal was not found in scoped current files")
      ),
      "compact context_packet summary should preserve scoped miss recommendations",
    );
    const literalMissCoverage = record(literalMissPacketSummary.requestCoverage);
    assert.equal(literalMissCoverage.status, "partial");
    const literalMissQuality = record(literalMissPacketSummary.evidenceQuality);
    const literalMissQualityCoverage = record(literalMissQuality.requestCoverage);
    assert.equal(literalMissQualityCoverage.status, "partial");
    assert.equal(literalMissQualityCoverage.unresolvedCount, 1);
    assert.ok(
      (literalMissCoverage.items as unknown[]).some((item) => {
        const entry = record(item);
        return entry.kind === "quoted_text" &&
          entry.value === "missing-u9" &&
          entry.status === "uncovered";
      }),
      "compact context_packet summary should preserve uncovered request coverage items",
    );
    const literalMissExpandableTools = record(literalMissPacketSummary.expandableTools);
    assert.ok(
      (literalMissExpandableTools.top as unknown[]).some((tool) => {
        const entry = record(tool);
        const suggestedArgs = record(entry.suggestedArgs);
        return entry.toolName === "live_text_search" &&
          suggestedArgs.query === "missing-u9" &&
          typeof entry.reason === "string" &&
          entry.reason.includes("did not find");
      }),
      "compact context_packet summary should preserve scoped miss live_text_search expansion",
    );

    const coercedTransportOutput = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        continueOnError: "true",
        ops: JSON.stringify([
          { label: "status", tool: "project_index_status", args: { includeUnindexed: "false" } },
          {
            label: "ast",
            tool: "ast_find_pattern",
            args: {
              pattern: "export function $NAME()",
              languages: JSON.stringify(["ts"]),
              maxMatches: "5",
            },
          },
        ]),
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_coerced_smoke" },
      },
    ) as ToolBatchToolOutput;

    assert.equal(coercedTransportOutput.summary.requestedOps, 2);
    assert.equal(coercedTransportOutput.summary.succeededOps, 2);
    assert.equal(coercedTransportOutput.results.find((result) => result.label === "status")?.ok, true);
    assert.equal(coercedTransportOutput.results.find((result) => result.label === "ast")?.ok, true);

    const noMatchLiveSearch = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        ops: [
          {
            label: "live-no-match",
            tool: "live_text_search",
            args: {
              query: "definitely_not_present_tool_batch_smoke",
              fixedStrings: true,
              pathGlob: "src/**/*.ts",
              maxMatches: 5,
            },
          },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_live_no_match_smoke" },
      },
    ) as ToolBatchToolOutput;

    const liveNoMatchResult = noMatchLiveSearch.results.find((result) => result.label === "live-no-match");
    assert.equal(noMatchLiveSearch.summary.succeededOps, 1);
    assert.equal(liveNoMatchResult?.ok, true);
    assert.deepEqual(liveNoMatchResult?.resultSummary?.matches, { count: 0 });
    assert.deepEqual(liveNoMatchResult?.resultSummary?.filesMatched, { count: 0 });

    const reefAskBatch = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        ops: [
          {
            label: "reef",
            tool: "reef_ask",
            args: {
              question: 'Find exact string "UserSession"',
              includeOpenLoops: false,
              includeVerification: false,
              includeInstructions: false,
              includeRisks: false,
              maxEvidenceItemsPerSection: 1,
            },
          },
          {
            label: "reef-flow",
            tool: "reef_ask",
            args: {
              question: "Plan the auth session change",
              mode: "plan",
              focusFiles: ["src/auth.ts"],
              focusSymbols: ["getSession"],
              includeOpenLoops: false,
              includeVerification: false,
              includeInstructions: false,
              includeRisks: false,
              maxEvidenceItemsPerSection: 2,
            },
          },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_reef_ask_smoke" },
      },
    ) as ToolBatchToolOutput;

    const reefResult = reefAskBatch.results.find((result) => result.label === "reef");
    assert.equal(reefAskBatch.summary.succeededOps, 2);
    assert.equal(reefResult?.ok, true);
    assert.equal(reefResult?.result, undefined);
    assert.ok(reefResult?.resultSummary, "compact reef_ask batch op should return a tailored summary");
    const reefSummary = record(reefResult?.resultSummary);
    assert.equal(reefSummary.toolName, "reef_ask");
    assert.equal(reefSummary.question, 'Find exact string "UserSession"');
    const reefAnswer = record(reefSummary.answer);
    assert.equal(typeof reefAnswer.summary, "string");
    assert.equal(reefAnswer.keys, undefined);
    assert.equal(typeof reefAnswer.confidence, "string");
    const decisionTrace = record(reefAnswer.decisionTrace);
    assert.equal(Array.isArray(decisionTrace.entries), true);
    const queryPlan = record(reefSummary.queryPlan);
    assert.equal(Array.isArray(queryPlan.engineSteps), true);
    assert.equal(Array.isArray(queryPlan.calculations), true);
    const evidence = record(reefSummary.evidence);
    assert.equal(evidence.mode, "compact");
    assert.equal(evidence.primaryContext, undefined);
    const sections = record(evidence.sections);
    const liveTextSection = record(sections["liveTextSearch.matches"]);
    assert.equal(liveTextSection.returned, 1);
    assert.equal(liveTextSection.truncated, true);

    const reefFlowResult = reefAskBatch.results.find((result) => result.label === "reef-flow");
    assert.equal(reefFlowResult?.ok, true);
    assert.equal(reefFlowResult?.result, undefined);
    const reefFlowSummary = record(reefFlowResult?.resultSummary);
    const reefFlowQueryPlan = record(reefFlowSummary.queryPlan);
    assert.equal(Array.isArray(reefFlowQueryPlan.calculations), true);
    assert.ok(
      (reefFlowQueryPlan.calculations as unknown[]).some((calculation) => {
        const recordCalculation = record(calculation);
        return recordCalculation.queryKind === "feature_flow" &&
          recordCalculation.status === "included" &&
          Number(recordCalculation.returnedCount) > 0;
      }),
      "compact reef_ask summary should keep planned calculation status for feature-flow",
    );
    const reefFlowAnswer = record(reefFlowSummary.answer);
    const featureFlow = record(reefFlowAnswer.featureFlow);
    assert.equal(typeof featureFlow.fileCount, "number");
    assert.ok(Number(featureFlow.fileCount) > 0, "compact reef_ask summary should keep feature-flow file counts");
    assert.equal(featureFlow.files instanceof Array, true);
    assert.ok(
      (featureFlow.files as unknown[]).some((file) => record(file).filePath === "src/auth.ts"),
      "compact reef_ask summary should keep top feature-flow files",
    );
    const featureFlowCoverage = record(featureFlow.coverage);
    assert.equal(Array.isArray(featureFlowCoverage.seedKinds), true);
    assert.ok(
      (featureFlowCoverage.seedKinds as unknown[]).includes("file"),
      "compact reef_ask summary should keep feature-flow seed kinds",
    );
    assert.equal(Array.isArray(featureFlow.links), true);

    const mutationInput = ToolBatchInputSchema.safeParse({
      projectId: indexed.project.projectId,
      ops: [{ label: "refresh", tool: "project_index_refresh", args: { mode: "force" } }],
    });
    assert.equal(mutationInput.success, false, "tool_batch schema should exclude mutation tools");

    const recursiveInput = ToolBatchInputSchema.safeParse({
      projectId: indexed.project.projectId,
      ops: [{ label: "recursive", tool: "tool_batch", args: { ops: [] } }],
    });
    assert.equal(recursiveInput.success, false, "tool_batch schema should exclude recursive tool_batch ops");

    const store = openProjectStore({ projectRoot });
    try {
      const events = store.queryUsefulnessEvents({
        decisionKind: "wrapper_usefulness",
        family: "tool_batch",
      });
      assert.ok(events.length >= 1, "tool_batch should emit wrapper telemetry");
      assert.equal(events.some((event) => event.requestId === "req_tool_batch_smoke"), true);
    } finally {
      store.close();
    }

    console.log("tool-batch: PASS");
  } finally {
    hotIndexCache.flush();
    projectStoreCache.flush();
    if (originalStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = originalStateHome;
    }
    if (originalStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = originalStateDirName;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
