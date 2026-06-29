import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolBatchInputSchema, ToolBatchToolOutputSchema, type ToolBatchToolOutput } from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { getToolDefinition, invokeTool, registerToolDefinition } from "../../packages/tools/src/registry.ts";
import { indexProject } from "../../services/indexer/src/index.ts";

function record(value: unknown): Record<string, unknown> {
  assert.equal(value != null && typeof value === "object" && !Array.isArray(value), true);
  return value as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  writeFileSync(
    path.join(projectRoot, "src", "profile.ts"),
    [
      "export interface UserProfile { id: string; displayName: string }",
      "export function loadProfile(): UserProfile { return { id: 'u1', displayName: 'Ava' }; }",
    ].join("\n"),
  );

  const projectStoreCache = createProjectStoreCache();
  const hotIndexCache = createHotIndexCache();

  try {
    const indexed = await indexProject(projectRoot, { projectStoreCache });
    const originalStatusDefinition = getToolDefinition("project_index_status");
    assert.ok(originalStatusDefinition, "project_index_status definition should exist");

    let parallelStartedCount = 0;
    let releaseParallelOps: () => void = () => undefined;
    const allParallelOpsStarted = new Promise<void>((resolve) => {
      releaseParallelOps = resolve;
    });
    registerToolDefinition({
      ...originalStatusDefinition,
      execute: async (input) => {
        parallelStartedCount += 1;
        if (parallelStartedCount === 3) releaseParallelOps();
        await allParallelOpsStarted;
        const parsed = record(input);
        return {
          toolName: "project_index_status",
          projectId: String(parsed.projectId),
          projectRoot,
          indexFreshness: { state: "fresh" },
          warnings: [],
        };
      },
    });
    try {
      const parallelOutput = await Promise.race([
        invokeTool(
          "tool_batch",
          {
            projectId: indexed.project.projectId,
            verbosity: "compact",
            continueOnError: true,
            maxConcurrency: 3,
            ops: [
              { label: "parallel-a", tool: "project_index_status", args: { includeUnindexed: false } },
              { label: "parallel-b", tool: "project_index_status", args: { includeUnindexed: false } },
              { label: "parallel-c", tool: "project_index_status", args: { includeUnindexed: false } },
            ],
          },
          {
            projectStoreCache,
            hotIndexCache,
            requestContext: { requestId: "req_tool_batch_parallel_smoke" },
          },
        ) as Promise<ToolBatchToolOutput>,
        sleep(1000).then(() => {
          throw new Error("tool_batch continueOnError=true should start independent ops concurrently");
        }),
      ]);
      assert.equal(parallelStartedCount, 3);
      ToolBatchToolOutputSchema.parse(parallelOutput);
      assert.equal(parallelOutput.summary.succeededOps, 3);
      assert.equal(parallelOutput.summary.executionMode, "parallel");
      assert.equal(parallelOutput.summary.maxConcurrency, 3);
      assert.equal(parallelOutput.summary.concurrencyLimited, false);
      assert.equal(
        parallelOutput.summary.totalOpDurationMs,
        parallelOutput.results.reduce((sum, result) => sum + result.durationMs, 0),
      );
      assert.ok(parallelOutput.summary.slowestOp, "parallel batch should report the slowest op");
      assert.deepEqual(
        parallelOutput.results.map((result) => result.label),
        ["parallel-a", "parallel-b", "parallel-c"],
        "parallel tool_batch results should preserve input order",
      );
    } finally {
      registerToolDefinition(originalStatusDefinition);
    }

    let boundedActiveCount = 0;
    let boundedMaxActiveCount = 0;
    registerToolDefinition({
      ...originalStatusDefinition,
      execute: async (input) => {
        boundedActiveCount += 1;
        boundedMaxActiveCount = Math.max(boundedMaxActiveCount, boundedActiveCount);
        await sleep(25);
        boundedActiveCount -= 1;
        const parsed = record(input);
        return {
          toolName: "project_index_status",
          projectId: String(parsed.projectId),
          projectRoot,
          indexFreshness: { state: "fresh" },
          warnings: [],
        };
      },
    });
    try {
      const boundedOutput = await invokeTool(
        "tool_batch",
        {
          projectId: indexed.project.projectId,
          continueOnError: true,
          maxConcurrency: 2,
          ops: [
            { label: "bounded-a", tool: "project_index_status", args: { includeUnindexed: false } },
            { label: "bounded-b", tool: "project_index_status", args: { includeUnindexed: false } },
            { label: "bounded-c", tool: "project_index_status", args: { includeUnindexed: false } },
            { label: "bounded-d", tool: "project_index_status", args: { includeUnindexed: false } },
          ],
        },
        {
          projectStoreCache,
          hotIndexCache,
          requestContext: { requestId: "req_tool_batch_bounded_parallel_smoke" },
        },
      ) as ToolBatchToolOutput;
      ToolBatchToolOutputSchema.parse(boundedOutput);
      assert.equal(boundedOutput.summary.succeededOps, 4);
      assert.equal(boundedOutput.summary.executionMode, "parallel");
      assert.equal(boundedOutput.summary.maxConcurrency, 2);
      assert.equal(boundedOutput.summary.concurrencyLimited, true);
      assert.equal(
        boundedOutput.summary.totalOpDurationMs,
        boundedOutput.results.reduce((sum, result) => sum + result.durationMs, 0),
      );
      const boundedSlowestDuration = Math.max(...boundedOutput.results.map((result) => result.durationMs));
      assert.equal(boundedOutput.summary.slowestOp?.durationMs, boundedSlowestDuration);
      assert.ok(boundedMaxActiveCount <= 2, `expected max 2 active ops, saw ${boundedMaxActiveCount}`);
      assert.deepEqual(
        boundedOutput.results.map((result) => result.label),
        ["bounded-a", "bounded-b", "bounded-c", "bounded-d"],
        "bounded parallel tool_batch results should preserve input order",
      );
    } finally {
      registerToolDefinition(originalStatusDefinition);
    }

    let failFastStartedCount = 0;
    registerToolDefinition({
      ...originalStatusDefinition,
      execute: async () => {
        failFastStartedCount += 1;
        throw new Error("synthetic status failure");
      },
    });
    try {
      const failFastOutput = await invokeTool(
        "tool_batch",
        {
          projectId: indexed.project.projectId,
          continueOnError: false,
          ops: [
            { label: "fail-fast-a", tool: "project_index_status", args: { includeUnindexed: false } },
            { label: "fail-fast-b", tool: "project_index_status", args: { includeUnindexed: false } },
          ],
        },
        {
          projectStoreCache,
          hotIndexCache,
          requestContext: { requestId: "req_tool_batch_fail_fast_smoke" },
        },
      ) as ToolBatchToolOutput;
      ToolBatchToolOutputSchema.parse(failFastOutput);
      assert.equal(failFastStartedCount, 1);
      assert.equal(failFastOutput.summary.executedOps, 1);
      assert.equal(failFastOutput.summary.failedOps, 1);
      assert.equal(failFastOutput.summary.executionMode, "sequential");
      assert.equal(failFastOutput.summary.maxConcurrency, 1);
      assert.equal(failFastOutput.summary.concurrencyLimited, false);
      assert.equal(failFastOutput.summary.totalOpDurationMs, failFastOutput.results[0]?.durationMs);
      assert.equal(failFastOutput.summary.slowestOp?.label, "fail-fast-a");
      assert.equal(failFastOutput.results[0]?.error?.code, "tool_error");
    } finally {
      registerToolDefinition(originalStatusDefinition);
    }

    registerToolDefinition({
      ...originalStatusDefinition,
      execute: async () => ({
        toolName: "context_packet",
        projectId: indexed.project.projectId,
        request: 'verify "MergedBatchNeedle"',
        mode: "explore",
        intent: {
          primaryFamily: "code_understanding",
          entities: {
            files: [],
            symbols: [],
            routes: [],
            databaseObjects: [],
            quotedText: ["MergedBatchNeedle"],
          },
        },
        primaryContext: [{
          id: "file:src/auth.ts:2",
          kind: "file",
          path: "src/auth.ts",
          lineStart: 2,
          lineEnd: 2,
          source: "file_provider",
          strategy: "exact_match",
          whyIncluded: "indexed file won the merge",
          confidence: 0.78,
          score: 118,
          metadata: {
            corroboratedSignalCount: 3,
            supportingSignals: [{
              source: "live_text_provider",
              strategy: "exact_match",
              path: "src/auth.ts",
              lineStart: 2,
              whyIncluded: "live literal corroborated the file",
              confidence: 0.9,
              score: 90,
              metadata: {
                query: "MergedBatchNeedle",
                queryKind: "quoted_text",
                overlay: "live_filesystem",
                evidenceConfidenceLabel: "verified_live",
                scopePath: "src/auth.ts",
              },
            }, {
              source: "repo_map_provider",
              strategy: "centrality_rank",
              path: "src/auth.ts",
              whyIncluded: "graph rank corroborated the file",
              confidence: 0.55,
              score: 42,
              metadata: {
                graphRankMode: "personalized",
                graphRankDirection: "bidirectional",
                graphRankScore: 42,
              },
            }],
          },
        }],
        relatedContext: [],
        activeFindings: [],
        symbols: [],
        routes: [],
        databaseObjects: [],
        risks: [],
        scopedInstructions: [],
        expandableTools: [],
        freshnessGate: { status: "fresh", source: "index" },
        limits: {},
        warnings: [],
      }),
    });
    try {
      const mergedSignalOutput = await invokeTool(
        "tool_batch",
        {
          projectId: indexed.project.projectId,
          verbosity: "compact",
          ops: [
            { label: "merged-signals", tool: "project_index_status", args: { includeUnindexed: false } },
          ],
        },
        {
          projectStoreCache,
          hotIndexCache,
          requestContext: { requestId: "req_tool_batch_merged_signal_summary_smoke" },
        },
      ) as ToolBatchToolOutput;
      ToolBatchToolOutputSchema.parse(mergedSignalOutput);
      const mergedSummary = record(mergedSignalOutput.results[0]?.resultSummary);
      assert.equal(mergedSummary.toolName, "context_packet");
      const mergedPrimaryContext = record(mergedSummary.primaryContext);
      const mergedTopCandidate = record((mergedPrimaryContext.top as unknown[])[0]);
      const mergedMetadata = record(mergedTopCandidate.metadata);
      const supportingSignals = record(mergedMetadata.supportingSignals);
      assert.equal(supportingSignals.count, 2);
      const topSignals = supportingSignals.top as unknown[];
      assert.equal(Array.isArray(topSignals), true);
      const liveSignal = record(topSignals[0]);
      assert.equal(liveSignal.source, "live_text_provider");
      assert.equal(liveSignal.path, "src/auth.ts");
      const liveSignalMetadata = record(liveSignal.metadata);
      assert.equal(liveSignalMetadata.query, "MergedBatchNeedle");
      assert.equal(liveSignalMetadata.queryKind, "quoted_text");
      assert.equal(liveSignalMetadata.scopePath, "src/auth.ts");
      assert.ok(
        topSignals.some((signal) => record(signal).source === "repo_map_provider"),
        "compact context_packet summaries should preserve graph supporting-signal provenance",
      );
    } finally {
      registerToolDefinition(originalStatusDefinition);
    }

    const output = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        maxOps: 10,
        ops: [
          { label: "status", tool: "project_index_status", args: { includeUnindexed: false } },
          { label: "map", tool: "repo_map", args: { maxFiles: 3 }, resultMode: "full" },
          { label: "focused-map", tool: "repo_map", args: { focusFiles: ["src/auth.ts"], maxFiles: 3 } },
          { label: "packet", tool: "context_packet", args: { request: "auth user session type broke" } },
          {
            label: "omitted-focus-packet",
            tool: "context_packet",
            args: {
              request: "compare auth and profile files",
              focusFiles: ["src/auth.ts", "src/profile.ts"],
              maxPrimaryContext: 1,
              maxRelatedContext: 0,
              includeLiveHints: false,
            },
          },
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
          {
            label: "symbol-packet",
            tool: "context_packet",
            args: {
              request: "inspect getSession current file",
              focusFiles: ["src/auth.ts"],
              focusSymbols: ["getSession"],
            },
          },
          {
            label: "symbol-miss-packet",
            tool: "context_packet",
            args: {
              request: "inspect MissingSessionSymbol current file",
              focusFiles: ["src/auth.ts"],
              focusSymbols: ["MissingSessionSymbol"],
            },
          },
          {
            label: "help",
            tool: "mako_help",
            args: { task: "understand feature wiring", focusFiles: ["src/auth.ts"], maxSteps: 3 },
          },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_smoke" },
      },
    ) as ToolBatchToolOutput;

    ToolBatchToolOutputSchema.parse(output);
    assert.equal(output.toolName, "tool_batch");
    assert.equal(output.summary.requestedOps, 10);
    assert.equal(output.summary.executedOps, 10);
    assert.equal(output.summary.succeededOps, 10);
    assert.equal(output.summary.rejectedOps, 0);
    assert.equal(output.summary.executionMode, "parallel");
    assert.equal(output.summary.maxConcurrency, 8);
    assert.equal(output.summary.concurrencyLimited, true);
    assert.equal(
      output.summary.totalOpDurationMs,
      output.results.reduce((sum, result) => sum + result.durationMs, 0),
    );
    assert.ok(output.summary.slowestOp, "tool_batch summary should report slowest op metadata");
    assert.equal(output.results.find((result) => result.label === "status")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "map")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "focused-map")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "omitted-focus-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "literal-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "literal-miss-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "symbol-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "symbol-miss-packet")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "help")?.ok, true);
    assert.ok(
      output.results.find((result) => result.label === "status")?.resultSummary,
      "compact verbosity should return a summary for ops without resultMode: full",
    );
    assert.ok(output.results.find((result) => result.label === "map")?.result, "resultMode: full should keep full payload");
    const focusedMapSummary = record(output.results.find((result) => result.label === "focused-map")?.resultSummary);
    assert.equal(focusedMapSummary.toolName, "repo_map");
    assert.equal(focusedMapSummary.totalFilesIndexed, 3);
    assert.equal(focusedMapSummary.topFiles instanceof Array, true);
    const focusedMapTopFile = record((focusedMapSummary.topFiles as unknown[])[0]);
    assert.equal(focusedMapTopFile.filePath, "src/auth.ts");
    assert.equal(focusedMapTopFile.graphRankMode, "personalized");
    assert.equal(focusedMapTopFile.graphRankDirection, "bidirectional");
    assert.equal(focusedMapTopFile.focusRelation, "self");
    assert.equal(focusedMapTopFile.focusDistance, 0);
    assert.deepEqual(focusedMapTopFile.symbolsIncluded, { count: 2 });
    const helpSummary = record(output.results.find((result) => result.label === "help")?.resultSummary);
    assert.equal(helpSummary.toolName, "mako_help");
    assert.equal(helpSummary.recipeId, "general_orientation");
    assert.equal(Array.isArray(helpSummary._hints), true);
    assert.ok(
      (helpSummary._hints as unknown[]).some((hint) =>
        typeof hint === "string" && hint.includes("Retrieval-plan guide")
      ),
      "compact mako_help summary should preserve model-facing hints",
    );
    const helpSteps = record(helpSummary.steps);
    assert.equal(helpSteps.count, 3);
    assert.equal(helpSteps.top instanceof Array, true);
    assert.ok(
      (helpSteps.top as unknown[]).some((entry) => {
        const helpStep = record(entry);
        const suggestedArgs = record(helpStep.suggestedArgs);
        return helpStep.id === "context" &&
          helpStep.toolName === "context_packet" &&
          Array.isArray(suggestedArgs.focusFiles) &&
          (suggestedArgs.focusFiles as unknown[]).includes("src/auth.ts");
      }),
      "compact mako_help summary should preserve context step suggestedArgs",
    );
    const helpBatchHint = record(helpSummary.batchHint);
    assert.equal(Array.isArray(helpBatchHint.eligibleStepIds), true);
    const helpBatchArgs = record(helpBatchHint.suggestedArgs);
    assert.equal(helpBatchArgs.verbosity, "compact");
    assert.equal(typeof helpBatchArgs.maxConcurrency, "number");
    assert.equal(Array.isArray(helpBatchArgs.ops), true);
    const helpGuide = record(helpSummary.retrievalPlanGuide);
    assert.equal(helpGuide.sourceStepId, "context");
    assert.equal(helpGuide.planPath, "retrievalDiagnostics.retrievalPlan");
    assert.equal(helpGuide.recommendedToolsPath, "retrievalDiagnostics.retrievalPlan.recommendedTools");
    assert.equal(helpGuide.recommendedFollowUpsPath, "retrievalDiagnostics.retrievalPlan.recommendedFollowUps");
    assert.equal(helpGuide.evidenceGapsPath, "retrievalDiagnostics.retrievalPlan.evidenceGaps");
    assert.equal(helpGuide.preferToolBatch, true);
    assert.equal(Array.isArray(helpGuide.strategyActions), true);
    const packetSummary = record(output.results.find((result) => result.label === "packet")?.resultSummary);
    assert.equal(packetSummary.toolName, "context_packet");
    assert.equal(packetSummary.request, "auth user session type broke");
    assert.equal(Array.isArray(packetSummary._hints), true);
    assert.ok(
      (packetSummary._hints as unknown[]).some((hint) =>
        typeof hint === "string" && hint.includes("Retrieval plan:")
      ),
      "compact context_packet summary should preserve model-facing retrieval hints",
    );
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
    const retrievalPlanSummary = record(retrievalDiagnosticsSummary.retrievalPlan);
    assert.equal(typeof retrievalPlanSummary.level, "string");
    assert.equal(typeof retrievalPlanSummary.strategy, "string");
    assert.equal(typeof retrievalPlanSummary.confidence, "number");
    const retrievalEvidenceGateSummary = record(retrievalPlanSummary.evidenceGate);
    assert.equal(typeof retrievalEvidenceGateSummary.status, "string");
    assert.equal(typeof retrievalEvidenceGateSummary.canAnswerFromPacket, "boolean");
    assert.equal(typeof retrievalEvidenceGateSummary.canEditFromPacket, "boolean");
    assert.equal(Array.isArray(retrievalEvidenceGateSummary.blockingReasons), true);
    assert.equal(Array.isArray(retrievalEvidenceGateSummary.advisoryReasons), true);
    assert.equal(Array.isArray(retrievalPlanSummary.evidenceGaps), true);
    assert.ok(
      (retrievalPlanSummary.evidenceGaps as unknown[]).some((entry) => typeof record(entry).kind === "string"),
      "compact context_packet summary should preserve retrieval evidence gaps",
    );
    assert.equal(Array.isArray(retrievalPlanSummary.requiredEvidence), true);
    assert.equal(Array.isArray(retrievalPlanSummary.recommendedTools), true);
    assert.equal(Array.isArray(retrievalPlanSummary.recommendedFollowUps), true);
    assert.ok(
      (retrievalPlanSummary.recommendedFollowUps as unknown[]).some((entry) => record(entry).toolName === "tool_batch"),
      "compact context_packet summary should preserve executable retrieval-plan follow-ups",
    );
    assert.equal(typeof retrievalPlanSummary.nextStep, "string");
    assert.equal(typeof retrievalDiagnosticsSummary.providerRunCount, "number");
    assert.equal(typeof retrievalDiagnosticsSummary.providerCandidateCount, "number");
    assert.equal(Array.isArray(retrievalDiagnosticsSummary.recommendations), true);
    const packetLimits = record(packetSummary.limits);
    assert.equal(Array.isArray(packetLimits.providersRun), true);
    assert.equal(Array.isArray(packetLimits.providersRunDetail), true);
    assert.equal(typeof packetLimits.returnedTokenEstimate, "number");
    assert.equal(typeof packetLimits.rankedCandidateCount, "number");
    assert.equal(typeof packetLimits.candidatesReturned, "number");
    assert.equal(typeof packetLimits.selectionLimitHit, "boolean");
    assert.equal(typeof packetLimits.candidatesOmittedByLimit, "number");
    assert.equal(typeof packetLimits.requestedAnchorsOmitted, "number");
    assert.equal(Array.isArray(packetLimits.omittedRequestedAnchors), true);
    assert.equal(typeof packetLimits.supportingSignalsOmitted, "number");
    const omittedFocusPacketSummary = record(output.results.find((result) => result.label === "omitted-focus-packet")?.resultSummary);
    const omittedFocusLimits = record(omittedFocusPacketSummary.limits);
    assert.ok(
      Number(omittedFocusLimits.requestedAnchorsOmitted) > 0,
      "compact context_packet summary should preserve omitted requested-anchor counts",
    );
    const omittedFocusAnchors = omittedFocusLimits.omittedRequestedAnchors as unknown[];
    assert.ok(
      omittedFocusAnchors.some((anchor) => {
        const entry = record(anchor);
        return entry.kind === "file" &&
          entry.reason === "selection_limit" &&
          (entry.value === "src/auth.ts" || entry.value === "src/profile.ts");
      }),
      "compact context_packet summary should preserve omitted requested file anchors in limits",
    );
    const omittedFocusDiagnostics = record(omittedFocusPacketSummary.retrievalDiagnostics);
    const omittedFocusPlan = record(omittedFocusDiagnostics.retrievalPlan);
    const omittedFocusGap = (omittedFocusPlan.evidenceGaps as unknown[])
      .map(record)
      .find((gap) =>
        gap.kind === "context_budget" &&
        gap.severity === "blocking" &&
        Array.isArray(gap.anchors) &&
        (gap.anchors as unknown[]).length > 0
      );
    assert.ok(
      omittedFocusGap,
      "compact context_packet summary should preserve omitted-anchor retrieval evidence gaps",
    );
    assert.ok(
      ((omittedFocusGap?.anchors ?? []) as unknown[]).some((anchor) => {
        const entry = record(anchor);
        return entry.kind === "file" &&
          entry.reason === "selection_limit" &&
          (entry.value === "src/auth.ts" || entry.value === "src/profile.ts");
      }),
      "compact retrieval evidence gaps should keep machine-readable omitted anchors",
    );
    assert.ok(
      (omittedFocusGap?.recommendedTools as unknown[]).includes("cross_search"),
      "compact retrieval evidence gaps should keep the omitted file anchor follow-up tool",
    );
    assert.ok(
      (omittedFocusPlan.recommendedTools as unknown[]).includes("cross_search"),
      "compact retrieval plans should keep omitted-anchor recommended tools",
    );
    assert.ok(
      (omittedFocusPlan.recommendedFollowUps as unknown[]).some((followUp) => {
        const entry = record(followUp);
        const suggestedArgs = record(entry.suggestedArgs);
        return entry.toolName === "cross_search" &&
          (suggestedArgs.term === "src/auth.ts" || suggestedArgs.term === "src/profile.ts");
      }),
      "compact retrieval plans should keep executable omitted-anchor follow-ups",
    );
    const literalPacketSummary = record(output.results.find((result) => result.label === "literal-packet")?.resultSummary);
    const literalPrimaryContextSummary = record(literalPacketSummary.primaryContext);
    const literalTop = record((literalPrimaryContextSummary.top as unknown[])[0]);
    assert.equal(literalTop.source, "live_text_provider");
    const literalMetadata = record(literalTop.metadata);
    assert.equal(literalMetadata.query, "u1");
    assert.equal(literalMetadata.overlay, "live_filesystem");
    assert.equal(literalMetadata.evidenceConfidenceLabel, "verified_live");
    assert.equal(literalMetadata.scopePath, "src/auth.ts");
    const symbolPacketSummary = record(output.results.find((result) => result.label === "symbol-packet")?.resultSummary);
    const symbolPrimaryContextSummary = record(symbolPacketSummary.primaryContext);
    const symbolTop = record((symbolPrimaryContextSummary.top as unknown[])[0]);
    assert.equal(symbolTop.source, "live_text_provider");
    assert.equal(symbolTop.kind, "symbol");
    assert.equal(symbolTop.symbolName, "getSession");
    const symbolMetadata = record(symbolTop.metadata);
    assert.equal(symbolMetadata.query, "getSession");
    assert.equal(symbolMetadata.queryKind, "symbol");
    assert.equal(symbolMetadata.overlay, "live_filesystem");
    assert.equal(symbolMetadata.evidenceConfidenceLabel, "verified_live");
    assert.equal(symbolMetadata.scopePath, "src/auth.ts");
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
          entry.distance === 0 &&
          entry.pathEvidenceCount === 1 &&
          (entry.pathEvidence as unknown[]).some((evidence) => {
            const pathEvidence = record(evidence);
            return pathEvidence.anchorFile === "src/auth.ts" &&
              pathEvidence.targetFile === "src/auth.ts" &&
              pathEvidence.distance === 0 &&
              (pathEvidence.path as unknown[]).includes("src/auth.ts");
          });
      }),
      "compact context_packet summary should keep graph file relation labels and path provenance",
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
          entry.queryKind === "quoted_text" &&
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
    const symbolMissPacketSummary = record(output.results.find((result) => result.label === "symbol-miss-packet")?.resultSummary);
    const symbolMissDiagnostics = record(symbolMissPacketSummary.retrievalDiagnostics);
    const symbolMisses = symbolMissDiagnostics.liveTextMisses as unknown[];
    assert.ok(
      symbolMisses.some((miss) => {
        const entry = record(miss);
        return entry.query === "MissingSessionSymbol" &&
          entry.queryKind === "symbol" &&
          entry.scope === "file" &&
          entry.scopePath === "src/auth.ts";
      }),
      "compact context_packet summary should preserve scoped live symbol miss kinds",
    );
    assert.ok(
      (symbolMissDiagnostics.recommendations as unknown[]).some((recommendation) =>
        typeof recommendation === "string" &&
        recommendation.includes("Focused symbol was not found in scoped current files")
      ),
      "compact context_packet summary should preserve scoped symbol miss recommendations",
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
        maxConcurrency: "2",
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
    assert.equal(coercedTransportOutput.summary.maxConcurrency, 2);
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
              includeTrace: true,
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
    const queryPlan = record(reefSummary.queryPlan);
    assert.equal(reefAnswer.decisionTrace, undefined);
    assert.equal(queryPlan.engineSteps, undefined);
    assert.equal(queryPlan.calculations, undefined);
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
