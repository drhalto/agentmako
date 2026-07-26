import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  ContextPacketToolOutputSchema,
  ToolBatchToolOutputSchema,
  type AuthPathToolOutput,
  type ContextPacketToolOutput,
  type JsonObject,
  type ProjectFinding,
  type ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { assessContextPacketEvidenceQuality } from "../../packages/tools/src/context-packet/evidence-quality.ts";
import { detectContextPacketIntent } from "../../packages/tools/src/context-packet/intent.ts";
import { rankContextCandidates } from "../../packages/tools/src/context-packet/ranking.ts";
import { buildContextPacketRequestCoverage } from "../../packages/tools/src/context-packet/request-coverage.ts";
import { buildContextPacketRetrievalDiagnostics } from "../../packages/tools/src/context-packet/retrieval-diagnostics.ts";
import type { ContextPacketCandidateSeed } from "../../packages/tools/src/context-packet/types.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { TOOL_DEFINITIONS, invokeTool } from "../../packages/tools/src/registry.ts";

const TOOL_INPUT_SCHEMAS = new Map(TOOL_DEFINITIONS.map((definition) => [
  definition.name,
  definition.inputSchema,
]));

function assertExpandableToolsHaveValidArgs(packet: ContextPacketToolOutput, label: string): void {
  for (const tool of packet.expandableTools) {
    const schema = TOOL_INPUT_SCHEMAS.get(tool.toolName);
    assert.ok(schema, `${label}: expandable tool ${tool.toolName} should be registered`);
    const result = schema.safeParse(tool.suggestedArgs);
    assert.equal(
      result.success,
      true,
      `${label}: ${tool.toolName} suggestedArgs should satisfy its input schema${
        result.success ? "" : `: ${result.error.message}`
      }`,
    );
  }

  const followUps = packet.retrievalDiagnostics.retrievalPlan.recommendedFollowUps;
  assert.deepEqual(
    followUps.map((tool) => tool.toolName),
    packet.retrievalDiagnostics.retrievalPlan.recommendedTools,
    `${label}: retrieval-plan executable follow-ups should mirror recommended tool order`,
  );
  for (const tool of followUps) {
    const schema = TOOL_INPUT_SCHEMAS.get(tool.toolName);
    assert.ok(schema, `${label}: recommended follow-up ${tool.toolName} should be registered`);
    const result = schema.safeParse(tool.suggestedArgs);
    assert.equal(
      result.success,
      true,
      `${label}: ${tool.toolName} recommendedFollowUps suggestedArgs should satisfy its input schema${
        result.success ? "" : `: ${result.error.message}`
      }`,
    );
    assert.ok(
      packet.expandableTools.some((expandableTool) =>
        expandableTool.toolName === tool.toolName &&
        JSON.stringify(expandableTool.suggestedArgs) === JSON.stringify(tool.suggestedArgs)
      ),
      `${label}: recommended follow-up ${tool.toolName} should reference a generated expandableTool entry`,
    );
  }
}

function batchExpansionOps(packet: ContextPacketToolOutput, label: string): Array<Record<string, unknown>> {
  const batchTool = packet.expandableTools.find((tool) => tool.toolName === "tool_batch");
  assert.ok(batchTool, `${label}: expected a tool_batch expansion`);
  const args = batchTool.suggestedArgs as { verbosity?: unknown; continueOnError?: unknown; maxConcurrency?: unknown; ops?: unknown };
  assert.equal(args.verbosity, "compact", `${label}: tool_batch should use compact summaries`);
  assert.equal(args.continueOnError, true, `${label}: tool_batch should continue on independent op errors`);
  assert.equal(typeof args.maxConcurrency, "number", `${label}: tool_batch should include a bounded concurrency cap`);
  assert.ok(Array.isArray(args.ops), `${label}: tool_batch should include ops`);
  assert.equal(
    args.maxConcurrency,
    Math.min(8, Math.max(1, args.ops.length)),
    `${label}: tool_batch maxConcurrency should be bounded by generated op count`,
  );
  return args.ops as Array<Record<string, unknown>>;
}

async function assertGeneratedBatchExpansionExecutes(
  packet: ContextPacketToolOutput,
  label: string,
  hotIndexCache: ReturnType<typeof createHotIndexCache>,
): Promise<void> {
  const batchTool = packet.expandableTools.find((tool) => tool.toolName === "tool_batch");
  assert.ok(batchTool, `${label}: expected a tool_batch expansion`);
  const expectedOps = batchExpansionOps(packet, label);
  const output = await invokeTool(
    "tool_batch",
    batchTool.suggestedArgs,
    {
      hotIndexCache,
      requestContext: { requestId: `req_generated_batch_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}` },
    },
  ) as ToolBatchToolOutput;

  ToolBatchToolOutputSchema.parse(output);
  assert.equal(output.summary.requestedOps, expectedOps.length, `${label}: generated batch should request every op`);
  assert.equal(output.summary.executedOps, expectedOps.length, `${label}: generated batch should execute every op`);
  assert.equal(output.summary.succeededOps, expectedOps.length, `${label}: generated batch should succeed every op`);
  assert.equal(output.summary.failedOps, 0, `${label}: generated batch should not fail ops`);
  assert.equal(output.summary.rejectedOps, 0, `${label}: generated batch should not reject ops`);
  assert.equal(output.summary.executionMode, "parallel", `${label}: generated batch should use parallel execution`);
  assert.equal(
    output.summary.maxConcurrency,
    Math.min(8, Math.max(1, expectedOps.length)),
    `${label}: generated batch should report the suggested concurrency cap`,
  );
  assert.equal(
    output.summary.concurrencyLimited,
    expectedOps.length > output.summary.maxConcurrency,
    `${label}: generated batch should report whether concurrency was limited`,
  );
  assert.deepEqual(
    output.results.map((result) => result.label),
    expectedOps.map((op) => op.label),
    `${label}: generated batch results should preserve suggested op order`,
  );
  assert.equal(
    output.results.every((result) => result.ok === true),
    true,
    `${label}: every generated batch op should be ok`,
  );
  assert.equal(
    output.results.every((result) =>
      result.resultSummary != null &&
      typeof result.resultSummary === "object" &&
      !Array.isArray(result.resultSummary)
    ),
    true,
    `${label}: generated batch ops should return compact summaries`,
  );
}

function estimateReadableCandidateTokens(candidate: ContextPacketToolOutput["primaryContext"][number]): number {
  return Math.max(1, Math.ceil(JSON.stringify(candidate).length / 4));
}

function returnedContextTokenEstimate(ranked: ReturnType<typeof rankContextCandidates>): number {
  return [...ranked.primaryContext, ...ranked.relatedContext]
    .reduce((total, candidate) => total + estimateReadableCandidateTokens(candidate), 0);
}

function assertRankingBudgetChargesFinalMergedPayload(): void {
  const primarySeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/budget/first.ts",
    lineStart: 1,
    lineEnd: 1,
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: "primary literal match",
    confidence: 0.95,
    baseScore: 200,
  };
  const supportingSeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: primarySeed.path,
    lineStart: primarySeed.lineStart,
    lineEnd: primarySeed.lineEnd,
    source: "import_graph_provider",
    strategy: "deterministic_graph",
    whyIncluded: "supporting import graph signal",
    confidence: 0.6,
    metadata: {
      graphDepth: 1,
      seedPath: "app/budget/anchor.ts",
    },
  };
  const secondSeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/budget/second.ts",
    lineStart: 1,
    lineEnd: 1,
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: "second literal match",
    confidence: 0.9,
    baseScore: 80,
  };

  const rankWithBudget = (budgetTokens: number) =>
    rankContextCandidates(
      [primarySeed, supportingSeed, secondSeed],
      {
        maxPrimaryContext: 4,
        maxRelatedContext: 4,
        budgetTokens,
        freshnessPolicy: "report",
        freshnessByPath: new Map(),
        focusFiles: new Set(),
        changedFiles: new Set(),
        focusSymbols: new Set(),
        focusRoutes: new Set(),
        focusDatabaseObjects: new Set(),
        request: "budget final merged payload",
      },
    );

  const constrained = rankWithBudget(190);
  assert.deepEqual(
    constrained.primaryContext.map((candidate) => candidate.path),
    ["app/budget/first.ts", "app/budget/second.ts"],
    "ranking budget should prefer distinct compact context before optional supporting-signal metadata",
  );
  assert.ok(
    returnedContextTokenEstimate(constrained) <= 190,
    "ranking budget should charge the final returned candidate payload",
  );
  assert.ok(
    constrained.returnedTokenEstimate <= 190,
    "ranking result should expose the final returned token estimate",
  );
  assert.equal(
    constrained.supportingSignalsOmitted,
    1,
    "ranking result should report supporting signals omitted by budget compaction",
  );
  assert.equal(
    Array.isArray(constrained.primaryContext[0]?.metadata?.supportingSignals),
    false,
    "supporting signals should be omitted when they would make final context exceed budget",
  );

  const roomy = rankWithBudget(220);
  assert.deepEqual(
    roomy.primaryContext.map((candidate) => candidate.path),
    ["app/budget/first.ts", "app/budget/second.ts"],
  );
  assert.ok(
    returnedContextTokenEstimate(roomy) <= 220,
    "roomy ranking budget should still fit the final enriched payload",
  );
  assert.ok(roomy.returnedTokenEstimate <= 220);
  assert.equal(roomy.supportingSignalsOmitted, 0);
  assert.equal(
    Array.isArray(roomy.primaryContext[0]?.metadata?.supportingSignals),
    true,
    "supporting signals should be retained when final budget has room",
  );

  const crowded = rankContextCandidates(
    [
      primarySeed,
      supportingSeed,
      secondSeed,
      {
        kind: "file",
        path: "app/budget/third.ts",
        lineStart: 1,
        lineEnd: 1,
        source: "live_text_provider",
        strategy: "exact_match",
        whyIncluded: "third literal match",
        confidence: 0.88,
        baseScore: 60,
      },
    ],
    {
      maxPrimaryContext: 4,
      maxRelatedContext: 4,
      budgetTokens: 120,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(),
      changedFiles: new Set(),
      focusSymbols: new Set(),
      focusRoutes: new Set(),
      focusDatabaseObjects: new Set(),
      request: "budget final merged payload",
    },
  );
  assert.equal(crowded.candidatesReturned, 2);
  assert.equal(crowded.budgetExhausted, true);
  assert.ok(crowded.returnedTokenEstimate <= 120);
  assert.equal(crowded.supportingSignalsOmitted, 1);
  assert.deepEqual(
    crowded.primaryContext.map((candidate) => candidate.path),
    ["app/budget/first.ts", "app/budget/second.ts"],
    "ranking budget should truncate lower-ranked compact candidates once the final budget is full",
  );

  const tinyBudget = rankWithBudget(1);
  assert.equal(
    tinyBudget.candidatesReturned,
    1,
    "ranking should still return one best candidate when every candidate exceeds budget",
  );
  assert.equal(
    tinyBudget.budgetExhausted,
    true,
    "ranking should report budget exhaustion when the first returned candidate exceeds budget",
  );
  assert.ok(
    tinyBudget.returnedTokenEstimate > 1,
    "tiny-budget ranking should expose that returned context exceeded the requested budget",
  );

  const countLimited = rankContextCandidates(
    [
      primarySeed,
      supportingSeed,
      secondSeed,
      {
        kind: "file",
        path: "app/budget/third.ts",
        lineStart: 1,
        lineEnd: 1,
        source: "live_text_provider",
        strategy: "exact_match",
        whyIncluded: "third literal match",
        confidence: 0.88,
        baseScore: 60,
      },
    ],
    {
      maxPrimaryContext: 1,
      maxRelatedContext: 1,
      budgetTokens: 1_000,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(),
      changedFiles: new Set(),
      focusSymbols: new Set(),
      focusRoutes: new Set(),
      focusDatabaseObjects: new Set(),
      request: "selection limit final payload",
    },
  );
  assert.equal(countLimited.budgetExhausted, false);
  assert.equal(countLimited.selectionLimitHit, true);
  assert.equal(countLimited.rankedCandidateCount, 3);
  assert.equal(countLimited.candidatesOmittedByLimit, 1);
  assert.equal(countLimited.candidatesReturned, 2);
}

function assertSupportingSignalsPreserveLiveQueryKind(): void {
  const indexedSeed: ContextPacketCandidateSeed = {
    kind: "symbol",
    path: "src/auth.ts",
    lineStart: 2,
    lineEnd: 2,
    symbolName: "getSession",
    source: "symbol_provider",
    strategy: "symbol_reference",
    whyIncluded: "indexed symbol reference",
    confidence: 0.95,
    rankScoreOverride: 500,
  };
  const liveSeed: ContextPacketCandidateSeed = {
    kind: "symbol",
    path: indexedSeed.path,
    lineStart: indexedSeed.lineStart,
    lineEnd: indexedSeed.lineEnd,
    symbolName: indexedSeed.symbolName,
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: "live symbol match",
    confidence: 0.4,
    rankScoreOverride: 10,
    metadata: {
      query: "getSession",
      queryKind: "symbol",
      overlay: "live_filesystem",
    },
  };

  const ranked = rankContextCandidates(
    [indexedSeed, liveSeed],
    {
      maxPrimaryContext: 4,
      maxRelatedContext: 4,
      budgetTokens: 1_000,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(["src/auth.ts"]),
      changedFiles: new Set(),
      focusSymbols: new Set(["getSession"]),
      focusRoutes: new Set(),
      focusDatabaseObjects: new Set(),
      request: "inspect getSession",
    },
  );

  const supportingSignals = ranked.primaryContext[0]?.metadata?.supportingSignals;
  assert.ok(Array.isArray(supportingSignals), "merged context should retain supporting signals");
  const liveSignal = supportingSignals.find((signal): signal is JsonObject =>
    typeof signal === "object" &&
    signal != null &&
    !Array.isArray(signal) &&
    signal.source === "live_text_provider"
  );
  assert.ok(liveSignal, "merged context should include the live text signal");
  assert.equal(
    typeof liveSignal.metadata === "object" &&
      liveSignal.metadata != null &&
      !Array.isArray(liveSignal.metadata)
      ? liveSignal.metadata.queryKind
      : undefined,
    "symbol",
    "live supporting-signal metadata should preserve queryKind",
  );
  assert.equal(
    typeof liveSignal.metadata === "object" &&
      liveSignal.metadata != null &&
      !Array.isArray(liveSignal.metadata)
      ? liveSignal.metadata.query
      : undefined,
    "getSession",
    "live supporting-signal metadata should preserve query",
  );
}

function assertRankingPreservesExplicitFileAnchors(): void {
  const changedSeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/anchors/changed.ts",
    source: "file_provider",
    strategy: "exact_match",
    whyIncluded: "changedFiles named this file",
    confidence: 0.4,
  };
  const focusSeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/anchors/focus.ts",
    source: "file_provider",
    strategy: "exact_match",
    whyIncluded: "focusFiles named this file",
    confidence: 0.4,
  };
  const noisySeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/anchors/noisy.ts",
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: "unrelated high-score literal match",
    confidence: 0.99,
    baseScore: 1_000,
  };

  const ranked = rankContextCandidates(
    [noisySeed, focusSeed, changedSeed],
    {
      maxPrimaryContext: 1,
      maxRelatedContext: 1,
      budgetTokens: 1_000,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(["app/anchors/focus.ts"]),
      changedFiles: new Set(["app/anchors/changed.ts"]),
      focusSymbols: new Set(),
      focusRoutes: new Set(),
      focusDatabaseObjects: new Set(),
      request: "explicit file anchors should stay visible",
    },
  );

  assert.deepEqual(
    ranked.primaryContext.map((candidate) => candidate.path),
    ["app/anchors/changed.ts"],
    "changedFiles anchors should fill primary context before non-anchor high-score candidates",
  );
  assert.deepEqual(
    ranked.relatedContext.map((candidate) => candidate.path),
    ["app/anchors/focus.ts"],
    "focusFiles anchors should fill related context before non-anchor high-score candidates",
  );
  assert.equal(ranked.selectionLimitHit, true);
  assert.equal(ranked.candidatesOmittedByLimit, 1);
  assert.equal(ranked.requestedAnchorsOmitted, 0);
  assert.deepEqual(ranked.omittedRequestedAnchors, []);
}

function assertRankingPreservesExplicitNonFileAnchors(): void {
  const symbolSeed: ContextPacketCandidateSeed = {
    kind: "symbol",
    path: "lib/auth/session.ts",
    symbolName: "getSession",
    source: "symbol_provider",
    strategy: "symbol_reference",
    whyIncluded: "focusSymbols named this symbol",
    confidence: 0.4,
  };
  const routeSeed: ContextPacketCandidateSeed = {
    kind: "route",
    path: "app/api/auth/callback/route.ts",
    routeKey: "GET /api/auth/callback",
    source: "route_provider",
    strategy: "exact_match",
    whyIncluded: "focusRoutes named this route",
    confidence: 0.4,
    metadata: {
      pattern: "/api/auth/callback",
    },
  };
  const databaseSeed: ContextPacketCandidateSeed = {
    kind: "database_object",
    databaseObjectName: "public.user_profiles",
    source: "schema_provider",
    strategy: "schema_usage",
    whyIncluded: "focusDatabaseObjects named this table",
    confidence: 0.4,
  };
  const noisySeed: ContextPacketCandidateSeed = {
    kind: "file",
    path: "app/anchors/noisy.ts",
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: "unrelated high-score literal match",
    confidence: 0.99,
    baseScore: 1_000,
  };

  const ranked = rankContextCandidates(
    [noisySeed, databaseSeed, routeSeed, symbolSeed],
    {
      maxPrimaryContext: 2,
      maxRelatedContext: 1,
      budgetTokens: 1_000,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(),
      changedFiles: new Set(),
      focusSymbols: new Set(["getsession"]),
      focusRoutes: new Set(["/api/auth/callback"]),
      focusDatabaseObjects: new Set(["public.user_profiles"]),
      request: "explicit non-file anchors should stay visible",
    },
  );

  assert.deepEqual(
    [...ranked.primaryContext, ...ranked.relatedContext].map((candidate) => candidate.kind),
    ["symbol", "route", "database_object"],
    "explicit symbol, route, and database anchors should survive count pressure before noisy non-anchors",
  );
  assert.equal(ranked.selectionLimitHit, true);
  assert.equal(ranked.candidatesOmittedByLimit, 1);
  assert.equal(ranked.requestedAnchorsOmitted, 0);
  assert.deepEqual(ranked.omittedRequestedAnchors, []);

  const limitedRanked = rankContextCandidates(
    [noisySeed, databaseSeed, routeSeed, symbolSeed],
    {
      maxPrimaryContext: 1,
      maxRelatedContext: 1,
      budgetTokens: 1_000,
      freshnessPolicy: "report",
      freshnessByPath: new Map(),
      focusFiles: new Set(),
      changedFiles: new Set(),
      focusSymbols: new Set(["getsession"]),
      focusRoutes: new Set(["/api/auth/callback"]),
      focusDatabaseObjects: new Set(["public.user_profiles"]),
      request: "explicit non-file anchors should report omitted requested anchors",
    },
  );
  assert.deepEqual(
    [...limitedRanked.primaryContext, ...limitedRanked.relatedContext].map((candidate) => candidate.kind),
    ["symbol", "route"],
    "explicit non-file anchors should retain priority order when limits are tighter than requested anchors",
  );
  assert.equal(limitedRanked.selectionLimitHit, true);
  assert.equal(limitedRanked.candidatesOmittedByLimit, 2);
  assert.equal(limitedRanked.requestedAnchorsOmitted, 1);
  assert.deepEqual(
    limitedRanked.omittedRequestedAnchors.map((anchor) => ({
      kind: anchor.kind,
      value: anchor.value,
      reason: anchor.reason,
    })),
    [{
      kind: "database_object",
      value: "public.user_profiles",
      reason: "selection_limit",
    }],
    "ranking should report requested anchors that were ranked but squeezed out by count limits",
  );
}

function assertRequestCoverageTracksLiveQueryKind(): void {
  const coverage = buildContextPacketRequestCoverage({
    input: {
      request: 'verify "SharedCoverageNeedle"',
    },
    intent: {
      primaryFamily: "unknown",
      families: [],
      entities: {
        files: [],
        symbols: [],
        routes: [],
        databaseObjects: [],
        quotedText: ["SharedCoverageNeedle"],
        keywords: [],
      },
    },
    candidates: [],
    liveTextMisses: [],
    liveTextCheckedQueries: [{ query: "SharedCoverageNeedle", queryKind: "symbol" }],
    liveTextRan: true,
  });

  assert.ok(
    coverage.items.some((item) =>
      item.kind === "quoted_text" &&
      item.value === "SharedCoverageNeedle" &&
      item.status === "not_checked"
    ),
    "symbol live checks should not satisfy quoted-literal checked coverage for the same text",
  );
}

function assertRequestCoverageReadsLiveSupportingSignals(): void {
  const coverage = buildContextPacketRequestCoverage({
    input: {
      request: 'verify "MergedLiteralNeedle"',
    },
    intent: {
      primaryFamily: "unknown",
      families: [],
      entities: {
        files: [],
        symbols: [],
        routes: [],
        databaseObjects: [],
        quotedText: ["MergedLiteralNeedle", "SymbolOnlyNeedle"],
        keywords: [],
      },
    },
    candidates: [{
      id: "file:src/example.ts:1",
      kind: "file",
      path: "src/example.ts",
      lineStart: 1,
      lineEnd: 1,
      source: "file_provider",
      strategy: "exact_match",
      whyIncluded: "indexed file won ranking merge",
      confidence: 0.8,
      score: 120,
      metadata: {
        supportingSignals: [{
          source: "live_text_provider",
          strategy: "exact_match",
          path: "src/example.ts",
          lineStart: 1,
          whyIncluded: "live literal supporting signal",
          confidence: 0.9,
          score: 90,
          metadata: {
            query: "MergedLiteralNeedle",
            queryKind: "quoted_text",
          },
        }, {
          source: "live_text_provider",
          strategy: "exact_match",
          path: "src/example.ts",
          lineStart: 2,
          symbolName: "SymbolOnlyNeedle",
          whyIncluded: "live symbol supporting signal",
          confidence: 0.9,
          score: 80,
          metadata: {
            query: "SymbolOnlyNeedle",
            queryKind: "symbol",
          },
        }],
      },
    }],
    liveTextMisses: [],
    liveTextCheckedQueries: [
      { query: "MergedLiteralNeedle", queryKind: "quoted_text" },
      { query: "SymbolOnlyNeedle", queryKind: "symbol" },
    ],
    liveTextRan: true,
  });

  assert.ok(
    coverage.items.some((item) =>
      item.kind === "quoted_text" &&
      item.value === "MergedLiteralNeedle" &&
      item.status === "covered" &&
      item.matchedBy.some((ref) => ref.startsWith("live_text_provider:"))
    ),
    "quoted literals verified as merged live supporting signals should satisfy request coverage",
  );
  assert.ok(
    coverage.items.some((item) =>
      item.kind === "quoted_text" &&
      item.value === "SymbolOnlyNeedle" &&
      item.status === "not_checked"
    ),
    "live symbol supporting signals should not satisfy quoted-literal coverage for the same text",
  );
}

function assertIntentExpandsCompoundRepoTerms(): void {
  const intent = detectContextPacketIntent({
    request: "debug getTenantDashboardRole access regression in app/dashboard/UserRolePanel.tsx",
    focusSymbols: ["getTenantDashboardRole"],
  });

  assert.equal(intent.primaryFamily, "debug_auth_state");
  assert.deepEqual(
    intent.entities.files,
    ["app/dashboard/UserRolePanel.tsx"],
    "intent detection should preserve full .tsx file paths instead of truncating to .ts",
  );
  assert.deepEqual(
    ["tenant", "dashboard", "role", "access"].every((keyword) => intent.entities.keywords.includes(keyword)),
    true,
    "intent detection should expand compound identifiers and paths into retrieval keywords",
  );
  assert.equal(
    intent.entities.keywords.includes("get"),
    false,
    "intent detection should not keep generic method-prefix keywords from compound identifiers",
  );

  const pronounIntent = detectContextPacketIntent({
    request: "Understand what QRGenerator does and where it is used",
  });
  assert.ok(
    pronounIntent.entities.symbols.includes("QRGenerator"),
    "intent detection should retain the named code symbol from pronoun-style usage questions",
  );
  assert.equal(
    ["Understand", "What", "it"].some((symbol) => pronounIntent.entities.symbols.includes(symbol)),
    false,
    "intent detection should not promote interrogatives or pronouns to symbols",
  );

  const codeSymbolIntent = detectContextPacketIntent({
    request: "Trace reef_ask and feature_flow before changing auth/role behavior or database objects.",
    focusSymbols: ["reef_ask"],
  });
  assert.deepEqual(
    codeSymbolIntent.entities.databaseObjects,
    [],
    "snake_case code symbols should not be misclassified as database objects without a database-target cue",
  );

  const databaseIntent = detectContextPacketIntent({
    request: "What columns and RLS policies are on user_profiles, and what calls public.get_user_role?",
  });
  assert.ok(databaseIntent.entities.databaseObjects.includes("user_profiles"));
  assert.ok(databaseIntent.entities.databaseObjects.includes("public.get_user_role"));

  const broadPlanningIntent = detectContextPacketIntent({
    request: "What files, role sources, route boundaries, and database objects matter if I change tenant-scoped dashboard role checks?",
  });
  assert.ok(["role", "tenant", "dashboard"].every((keyword) => broadPlanningIntent.entities.keywords.includes(keyword)));
  assert.equal(
    ["files", "sources", "route", "boundaries", "database", "objects", "matter", "change", "checks"]
      .some((keyword) => broadPlanningIntent.entities.keywords.includes(keyword)),
    false,
    "retrieval keywords should omit task-control and evidence-category words that produce generic exact matches",
  );
}

function writeFixtureFile(projectRoot: string, relPath: string, content: string): string {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content}\n`);
  return fullPath;
}

function fileRecord(
  projectRoot: string,
  relPath: string,
  content: string,
  language: "typescript" | "tsx",
  symbols: Array<{ name: string; kind: string; exportName?: string; lineStart?: number; lineEnd?: number }>,
  imports: Array<{ targetPath: string; specifier: string }>,
  routes: Array<{ routeKey: string; pattern: string; method?: string; handlerName?: string; isApi?: boolean }> = [],
) {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  const stat = statSync(fullPath);
  return {
    path: relPath,
    sha256: relPath,
    language,
    sizeBytes: Buffer.byteLength(`${content}\n`),
    lineCount: `${content}\n`.split("\n").length,
    lastModifiedAt: stat.mtime.toISOString(),
    chunks: [{
      chunkKind: "file" as const,
      name: relPath,
      lineStart: 1,
      lineEnd: content.split("\n").length,
      content,
    }],
    symbols,
    imports: imports.map((edge) => ({
      targetPath: edge.targetPath,
      specifier: edge.specifier,
      importKind: "static",
      isTypeOnly: false,
    })),
    routes: routes.map((route) => ({
      framework: "nextjs",
      ...route,
    })),
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "context-packet-smoke" }));

  const routeContent = [
    "import { getSession } from '../../../../lib/auth/session';",
    "export async function GET() {",
    "  const session = await getSession();",
    "  return Response.json({ user: session.user });",
    "}",
  ].join("\n");
  const sessionContent = [
    "import type { UserSession } from '../../types/auth';",
    "export async function getSession(): Promise<UserSession> {",
    "  return { user: { id: 'u1', role: 'admin' } };",
    "}",
  ].join("\n");
  const typeContent = [
    "export interface UserSession {",
    "  user: { id: string; role: string };",
    "}",
  ].join("\n");
  const loginContent = [
    "export function LoginButton() {",
    "  return <button>Login</button>;",
    "}",
  ].join("\n");
  const dashboardLayoutContent = [
    "export default async function DashboardLayout({ profile, children }: { profile: { role: string }; children: unknown }) {",
    "  if (profile.role !== 'admin') {",
    "    return null;",
    "  }",
    "  return children;",
    "}",
  ].join("\n");
  const adminEndorsementCreateContent = [
    "export function AdminEndorsementCreatePage() {",
    "  const roleCheck = 'admin endorsement create duplicate role check';",
    "  return <section>{roleCheck}</section>;",
    "}",
  ].join("\n");
  const instructorEndorsementCreateContent = [
    "export function InstructorEndorsementCreatePage() {",
    "  const roleCheck = 'instructor endorsement create duplicate role check';",
    "  return <section>{roleCheck}</section>;",
    "}",
  ].join("\n");
  const centralButtonContent = [
    "export function Button({ children }: { children: unknown }) {",
    "  return <button>{children}</button>;",
    "}",
  ].join("\n");
  const generatedButtonConsumers = Array.from({ length: 40 }, (_, index) => ({
    relPath: `app/generated/page-${index}.tsx`,
    symbolName: `GeneratedPage${index}`,
    content: [
      "import { Button } from '../../components/ui/button';",
      `export function GeneratedPage${index}() {`,
      `  return <Button>Generated ${index}</Button>;`,
      "}",
    ].join("\n"),
  }));
  const fairnessHubImports = Array.from({ length: 8 }, (_, index) => ({
    targetPath: `app/fairness/deps/dep-${index}.ts`,
    specifier: `./deps/dep-${index}`,
  }));
  const fairnessHubDependents = Array.from({ length: 8 }, (_, index) => ({
    relPath: `app/fairness/consumers/consumer-${index}.ts`,
    symbolName: `fairnessConsumer${index}`,
    content: [
      "import { fairnessHub } from '../hub';",
      `export function fairnessConsumer${index}() {`,
      "  return fairnessHub();",
      "}",
    ].join("\n"),
    imports: [{ targetPath: "app/fairness/hub.ts", specifier: "../hub" }],
  }));
  const fairnessDependencyFiles = Array.from({ length: 8 }, (_, depIndex) => ({
    relPath: `app/fairness/deps/dep-${depIndex}.ts`,
    symbolName: `fairnessDep${depIndex}`,
    content: [
      ...Array.from({ length: 8 }, (_, leafIndex) =>
        `import { fairnessLeaf${depIndex}_${leafIndex} } from '../leaves/leaf-${depIndex}-${leafIndex}';`
      ),
      `export function fairnessDep${depIndex}() {`,
      `  return ${Array.from({ length: 8 }, (_, leafIndex) => `fairnessLeaf${depIndex}_${leafIndex}()`).join(" + ")};`,
      "}",
    ].join("\n"),
    imports: Array.from({ length: 8 }, (_, leafIndex) => ({
      targetPath: `app/fairness/leaves/leaf-${depIndex}-${leafIndex}.ts`,
      specifier: `../leaves/leaf-${depIndex}-${leafIndex}`,
    })),
  }));
  const fairnessLeafFiles = Array.from({ length: 8 }, (_, depIndex) =>
    Array.from({ length: 8 }, (_, leafIndex) => ({
      relPath: `app/fairness/leaves/leaf-${depIndex}-${leafIndex}.ts`,
      symbolName: `fairnessLeaf${depIndex}_${leafIndex}`,
      content: [
        `export function fairnessLeaf${depIndex}_${leafIndex}() {`,
        `  return ${depIndex * 10 + leafIndex};`,
        "}",
      ].join("\n"),
      imports: [],
    }))
  ).flat();
  const wideGraphFiles = [
    {
      relPath: "app/fairness/wide.ts",
      symbolName: "fairnessWide",
      content: [
        ...Array.from({ length: 12 }, (_, index) =>
          `import { fairnessWideDep${index} } from './wide/dep-${index}';`
        ),
        "export function fairnessWide() {",
        `  return ${Array.from({ length: 12 }, (_, index) => `fairnessWideDep${index}()`).join(" + ")};`,
        "}",
      ].join("\n"),
      imports: Array.from({ length: 12 }, (_, index) => ({
        targetPath: `app/fairness/wide/dep-${index}.ts`,
        specifier: `./wide/dep-${index}`,
      })),
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      relPath: `app/fairness/wide/dep-${index}.ts`,
      symbolName: `fairnessWideDep${index}`,
      content: [
        `export function fairnessWideDep${index}() {`,
        `  return ${index};`,
        "}",
      ].join("\n"),
      imports: [],
    })),
  ];
  const graphFairnessFiles = [
    {
      relPath: "app/fairness/hub.ts",
      symbolName: "fairnessHub",
      content: [
        ...fairnessHubImports.map((edge, index) =>
          `import { fairnessDep${index} } from '${edge.specifier}';`
        ),
        "export function fairnessHub() {",
        `  return ${Array.from({ length: 8 }, (_, index) => `fairnessDep${index}()`).join(" + ")};`,
        "}",
      ].join("\n"),
      imports: fairnessHubImports,
    },
    ...fairnessDependencyFiles,
    ...fairnessLeafFiles,
    ...fairnessHubDependents,
    {
      relPath: "app/fairness/target.ts",
      symbolName: "fairnessTarget",
      content: [
        "import { fairnessTargetLeaf } from './target-leaf';",
        "export function fairnessTarget() {",
        "  return fairnessTargetLeaf();",
        "}",
      ].join("\n"),
      imports: [{ targetPath: "app/fairness/target-leaf.ts", specifier: "./target-leaf" }],
    },
    {
      relPath: "app/fairness/target-leaf.ts",
      symbolName: "fairnessTargetLeaf",
      content: [
        "export function fairnessTargetLeaf() {",
        "  return 999;",
        "}",
      ].join("\n"),
      imports: [],
    },
    ...wideGraphFiles,
  ];

  writeFixtureFile(projectRoot, "app/api/auth/callback/route.ts", routeContent);
  writeFixtureFile(projectRoot, "app/dashboard/layout.tsx", dashboardLayoutContent);
  writeFixtureFile(projectRoot, "app/dashboard/admin/endorsements/create/client-page.tsx", adminEndorsementCreateContent);
  writeFixtureFile(projectRoot, "app/dashboard/instructor/endorsements/create/client-page.tsx", instructorEndorsementCreateContent);
  writeFixtureFile(projectRoot, "lib/auth/session.ts", sessionContent);
  writeFixtureFile(projectRoot, "types/auth.ts", typeContent);
  writeFixtureFile(projectRoot, "components/LoginButton.tsx", loginContent);
  writeFixtureFile(projectRoot, "components/ui/button.tsx", centralButtonContent);
  for (const consumer of generatedButtonConsumers) {
    writeFixtureFile(projectRoot, consumer.relPath, consumer.content);
  }
  for (const file of graphFairnessFiles) {
    writeFixtureFile(projectRoot, file.relPath, file.content);
  }
  writeFixtureFile(projectRoot, "AGENTS.md", "Auth changes must preserve session and user type contracts.");

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "context-packet-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "context-packet-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: ["app/api/auth/callback/route.ts"],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: ["getSession"],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
    const run = store.beginIndexRun("smoke_seed");
    store.replaceIndexSnapshot({
      files: [
        fileRecord(
          projectRoot,
          "app/api/auth/callback/route.ts",
          routeContent,
          "typescript",
          [{ name: "GET", kind: "function", exportName: "GET", lineStart: 2, lineEnd: 5 }],
          [{ targetPath: "lib/auth/session.ts", specifier: "../../../../lib/auth/session" }],
          [{
            routeKey: "GET /api/auth/callback",
            pattern: "/api/auth/callback",
            method: "GET",
            handlerName: "GET",
            isApi: true,
          }],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/layout.tsx",
          dashboardLayoutContent,
          "tsx",
          [{ name: "DashboardLayout", kind: "function", exportName: "default", lineStart: 1, lineEnd: 6 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/admin/endorsements/create/client-page.tsx",
          adminEndorsementCreateContent,
          "tsx",
          [{ name: "AdminEndorsementCreatePage", kind: "function", exportName: "AdminEndorsementCreatePage", lineStart: 1, lineEnd: 4 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/instructor/endorsements/create/client-page.tsx",
          instructorEndorsementCreateContent,
          "tsx",
          [{ name: "InstructorEndorsementCreatePage", kind: "function", exportName: "InstructorEndorsementCreatePage", lineStart: 1, lineEnd: 4 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "lib/auth/session.ts",
          sessionContent,
          "typescript",
          [{ name: "getSession", kind: "function", exportName: "getSession", lineStart: 2, lineEnd: 4 }],
          [{ targetPath: "types/auth.ts", specifier: "../../types/auth" }],
        ),
        fileRecord(
          projectRoot,
          "types/auth.ts",
          typeContent,
          "typescript",
          [{ name: "UserSession", kind: "interface", exportName: "UserSession", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "components/LoginButton.tsx",
          loginContent,
          "tsx",
          [{ name: "LoginButton", kind: "function", exportName: "LoginButton", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "components/ui/button.tsx",
          centralButtonContent,
          "tsx",
          [{ name: "Button", kind: "function", exportName: "Button", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        ...generatedButtonConsumers.map((consumer) => fileRecord(
          projectRoot,
          consumer.relPath,
          consumer.content,
          "tsx",
          [{ name: consumer.symbolName, kind: "function", exportName: consumer.symbolName, lineStart: 2, lineEnd: 4 }],
          [{ targetPath: "components/ui/button.tsx", specifier: "../../components/ui/button" }],
        )),
        ...graphFairnessFiles.map((file) => fileRecord(
          projectRoot,
          file.relPath,
          file.content,
          "typescript",
          [{
            name: file.symbolName,
            kind: "function",
            exportName: file.symbolName,
            lineStart: file.imports.length + 1,
            lineEnd: file.content.split("\n").length,
          }],
          file.imports,
        )),
      ],
      schemaObjects: [{
        objectKey: "table:public.user_profiles",
        objectType: "table",
        schemaName: "public",
        objectName: "user_profiles",
      }],
      schemaUsages: [{
        objectKey: "table:public.user_profiles",
        filePath: "lib/auth/session.ts",
        usageKind: "read",
        line: 3,
        excerpt: "return { user: { id: 'u1', role: 'admin' } };",
      }],
    });
    const findingSubject = {
      kind: "diagnostic" as const,
      path: "lib/auth/session.ts",
      code: "typescript:TS2322",
    };
    const findingSubjectFingerprint = store.computeReefSubjectFingerprint(findingSubject);
    const capturedAt = new Date().toISOString();
    const activeFinding: ProjectFinding = {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "typescript",
        ruleId: "TS2322",
        subjectFingerprint: findingSubjectFingerprint,
        message: "UserSession user.role type no longer matches route expectations.",
      }),
      source: "typescript",
      subjectFingerprint: findingSubjectFingerprint,
      overlay: "working_tree",
      severity: "warning",
      status: "active",
      filePath: "lib/auth/session.ts",
      line: 3,
      ruleId: "TS2322",
      freshness: {
        state: "fresh",
        checkedAt: capturedAt,
        reason: "fixture active finding",
      },
      capturedAt,
      message: "UserSession user.role type no longer matches route expectations.",
      factFingerprints: [],
    };
    const dashboardSubject = {
      kind: "diagnostic" as const,
      path: "app/dashboard/layout.tsx",
      code: "identity.boundary_mismatch",
    };
    const dashboardSubjectFingerprint = store.computeReefSubjectFingerprint(dashboardSubject);
    const dashboardFinding: ProjectFinding = {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "cross_search",
        ruleId: "identity.boundary_mismatch",
        subjectFingerprint: dashboardSubjectFingerprint,
        message: "Dashboard layout role guard does not match page access checks.",
      }),
      source: "cross_search",
      subjectFingerprint: dashboardSubjectFingerprint,
      overlay: "indexed",
      severity: "warning",
      status: "active",
      filePath: "app/dashboard/layout.tsx",
      line: 2,
      ruleId: "identity.boundary_mismatch",
      freshness: {
        state: "fresh",
        checkedAt: capturedAt,
        reason: "fixture dashboard finding",
      },
      capturedAt,
      message: "Dashboard layout role guard does not match page access checks.",
      factFingerprints: [],
    };
    const noiseFindings: ProjectFinding[] = Array.from({ length: 250 }, (_, index) => {
      const path = `noise/noise-${index}.ts`;
      const subjectFingerprint = store.computeReefSubjectFingerprint({
        kind: "diagnostic",
        path,
        code: `typescript:TS9${index}`,
      });
      return {
        projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "typescript",
          ruleId: `TS9${index}`,
          subjectFingerprint,
          message: `Unrelated noisy diagnostic ${index}.`,
        }),
        source: "typescript",
        subjectFingerprint,
        overlay: "working_tree",
        severity: "error",
        status: "active",
        filePath: path,
        line: 1,
        ruleId: `TS9${index}`,
        freshness: {
          state: "fresh",
          checkedAt: capturedAt,
          reason: "fixture noise finding",
        },
        capturedAt,
        message: `Unrelated noisy diagnostic ${index}.`,
        factFingerprints: [],
      };
    });
    store.replaceReefFindingsForSource({
      projectId,
      source: "typescript",
      overlay: "working_tree",
      findings: [activeFinding, ...noiseFindings],
    });
    store.replaceReefFindingsForSource({
      projectId,
      source: "cross_search",
      overlay: "indexed",
      findings: [dashboardFinding],
    });
    store.finishIndexRun(run.runId, "succeeded");
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  assertRankingBudgetChargesFinalMergedPayload();
  assertSupportingSignalsPreserveLiveQueryKind();
  assertRankingPreservesExplicitFileAnchors();
  assertRankingPreservesExplicitNonFileAnchors();
  assertRequestCoverageTracksLiveQueryKind();
  assertRequestCoverageReadsLiveSupportingSignals();
  assertIntentExpandsCompoundRepoTerms();

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-context-packet-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  const originalReefBacked = process.env.MAKO_REEF_BACKED;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  mkdirSync(projectRoot, { recursive: true });

  const projectId = randomUUID();
  const hotIndexCache = createHotIndexCache();

  try {
    seedProject(projectRoot, projectId);

    const packet = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "my auth route is broken after changing the user type",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache, requestContext: { requestId: "req_context_packet_smoke" } },
    ) as ContextPacketToolOutput;

    ContextPacketToolOutputSchema.parse(packet);
    assertExpandableToolsHaveValidArgs(packet, "primary packet");
    assert.equal(packet.toolName, "context_packet");
    assert.equal(packet.projectId, projectId);
    assert.equal(packet.mode, "explore");
    assert.equal(packet.modePolicy.includeRisks, true);
    assert.deepEqual(packet.limits.providersSkipped, ["repo_map_provider"]);
    assert.ok(
      packet.retrievalDiagnostics.providersSkippedDetail.some((detail) =>
        detail.provider === "repo_map_provider" &&
        detail.adaptive &&
        detail.reason.includes("focus/changed file anchors")
      ),
      "focused auth debugging should explain adaptive repo-map pruning",
    );
    assert.equal(packet.intent.primaryFamily, "debug_auth_state");
    assert.ok(packet.intent.families.some((entry) => entry.family === "debug_route"));
    assert.ok(packet.intent.families.some((entry) => entry.family === "debug_type_contract"));
    assert.ok(packet.primaryContext.length > 0, "packet should return primary context");
    assert.equal(packet.primaryContext.every((candidate) => ["file", "symbol", "route", "database_object"].includes(candidate.kind)), true);

    const contextPaths = new Set([...packet.primaryContext, ...packet.relatedContext].flatMap((candidate) => candidate.path ?? []));
    assert.ok(contextPaths.has("app/api/auth/callback/route.ts"), "route handler should be in context");
    assert.ok(
      contextPaths.has("lib/auth/session.ts") || contextPaths.has("types/auth.ts"),
      "auth session or type file should be in context",
    );
    assert.ok(
      packet.graphSummary.anchorFiles.includes("app/api/auth/callback/route.ts"),
      "graph summary should preserve explicit focus files as graph anchors",
    );
    assert.ok(
      packet.graphSummary.files.some((file) =>
        file.filePath === "app/api/auth/callback/route.ts" &&
        file.relation === "anchor" &&
        file.distance === 0
      ),
      "graph summary should label the focused route file as an anchor",
    );
    assert.ok(
      packet.graphSummary.files.some((file) =>
        file.filePath === "lib/auth/session.ts" &&
        (file.relation === "dependency" || file.relation === "bidirectional")
      ),
      "graph summary should label imported auth/session code as dependency context",
    );
    assert.ok(
      packet.graphSummary.edges.some((edge) =>
        edge.from === "app/api/auth/callback/route.ts" &&
        edge.to === "lib/auth/session.ts" &&
        edge.relation === "anchor_dependency"
      ),
      "graph summary should expose import edges from anchors to returned dependencies",
    );
    assert.ok(
      packet.graphSummary.dependencyFileCount + packet.graphSummary.bidirectionalFileCount > 0,
      "graph summary should count dependency-related files",
    );
    assert.equal(packet.requestCoverage.status, "complete");
    assert.equal(packet.requestCoverage.uncoveredCount, 0);
    assert.ok(
      packet.requestCoverage.items.some((item) =>
        item.kind === "file" &&
        item.value === "app/api/auth/callback/route.ts" &&
        item.status === "covered" &&
        item.matchedBy.length > 0
      ),
      "request coverage should prove the explicit focus file is represented",
    );
    assert.ok(packet.routes.some((route) => route.routeKey === "GET /api/auth/callback"));
    assert.ok(packet.symbols.some((symbol) => symbol.name === "getSession" || symbol.name === "UserSession"));
    assert.ok(packet.databaseObjects.some((object) => object.objectName === "user_profiles"));
    assert.ok(packet.activeFindings.some((finding) =>
      finding.source === "typescript" &&
      finding.ruleId === "TS2322" &&
      finding.filePath === "lib/auth/session.ts"
    ));
    assert.ok(packet.risks.some((risk) => risk.code === "auth_state_flow"));
    assert.ok(packet.risks.some((risk) => risk.code === "type_contract_mismatch"));
    assert.ok(packet.scopedInstructions.some((instruction) => instruction.path === "AGENTS.md"));
    assert.ok(packet.recommendedHarnessPattern.some((step) => step.includes("auth/session")));
    assert.equal(packet.indexFreshness?.state, "fresh");
    assert.equal(packet.freshnessGate.status, "skipped");
    assert.equal(packet.freshnessGate.source, "metadata");
    assert.equal(packet.freshnessGate.indexFreshness.state, "fresh");
    assert.ok(
      packet.evidenceQuality.label === "strong" || packet.evidenceQuality.label === "usable",
      `primary packet should be strong or usable evidence; got ${packet.evidenceQuality.label}`,
    );
    assert.ok(packet.evidenceQuality.score > 0.5, "primary packet should have a useful evidence score");
    assert.equal(
      packet.evidenceQuality.totalContextCount,
      packet.primaryContext.length + packet.relatedContext.length,
      "evidence quality should count returned context",
    );
    assert.equal(packet.evidenceQuality.freshness.indexState, "fresh");
    assert.equal(packet.evidenceQuality.freshness.gateStatus, "skipped");
    assert.equal(packet.evidenceQuality.requestCoverage.status, "complete");
    assert.equal(packet.evidenceQuality.requestCoverage.unresolvedCount, 0);
    assert.equal(packet.evidenceQuality.graph.status, "not_requested");
    assert.equal(typeof packet.limits.returnedTokenEstimate, "number");
    assert.equal(typeof packet.limits.rankedCandidateCount, "number");
    assert.equal(typeof packet.limits.selectionLimitHit, "boolean");
    assert.equal(typeof packet.limits.candidatesOmittedByLimit, "number");
    assert.equal(typeof packet.limits.requestedAnchorsOmitted, "number");
    assert.equal(Array.isArray(packet.limits.omittedRequestedAnchors), true);
    assert.equal(typeof packet.limits.supportingSignalsOmitted, "number");
    assert.ok(packet.limits.returnedTokenEstimate > 0);
    assert.ok(
      packet.evidenceQuality.reasons.some((reason) => reason.includes("primary")),
      "evidence quality should explain context coverage",
    );
    const packetIndexFreshness = packet.indexFreshness;
    assert.ok(packetIndexFreshness, "primary packet should include index freshness for evidence-quality scoring");
    const assessPacketQuality = (overrides: {
      budgetExhausted?: boolean;
      selectionLimitHit?: boolean;
      requestedAnchorsOmitted?: number;
      supportingSignalsOmitted?: number;
    }) => assessContextPacketEvidenceQuality({
      request: packet.request,
      primaryContext: packet.primaryContext,
      relatedContext: packet.relatedContext,
      graphSummary: packet.graphSummary,
      freshnessGate: packet.freshnessGate,
      indexFreshness: packetIndexFreshness,
      providersFailed: [],
      budgetExhausted: overrides.budgetExhausted ?? false,
      selectionLimitHit: overrides.selectionLimitHit ?? false,
      requestedAnchorsOmitted: overrides.requestedAnchorsOmitted ?? 0,
      supportingSignalsOmitted: overrides.supportingSignalsOmitted ?? 0,
      changedFilesMissingOverlayCount: 0,
      requestCoverage: packet.requestCoverage,
    });
    const untruncatedQuality = assessPacketQuality({});
    const omittedAnchorQuality = assessPacketQuality({
      selectionLimitHit: true,
      requestedAnchorsOmitted: 1,
    });
    assert.equal(
      omittedAnchorQuality.label,
      "partial",
      "evidence quality should downgrade packet quality when requested anchors were omitted",
    );
    assert.ok(
      omittedAnchorQuality.score < untruncatedQuality.score,
      "omitted requested anchors should reduce evidence quality score",
    );
    assert.ok(
      omittedAnchorQuality.reasons.some((reason) =>
        reason.includes("requested anchor") && reason.includes("omitted")
      ),
      "evidence quality should explain omitted requested anchors",
    );
    assert.ok(
      omittedAnchorQuality.recommendedAction.includes("omitted requested anchors"),
      "evidence quality should steer omitted-anchor packets toward anchor-specific follow-ups",
    );
    const selectionLimitedQuality = assessPacketQuality({ selectionLimitHit: true });
    assert.ok(
      selectionLimitedQuality.score < untruncatedQuality.score,
      "selection-limit truncation should reduce evidence quality score",
    );
    assert.ok(
      selectionLimitedQuality.recommendedAction.includes("maxPrimaryContext/maxRelatedContext"),
      "evidence quality should steer selection-limit truncation toward inspecting omitted ranked candidates",
    );
    const compactedSignalQuality = assessPacketQuality({ supportingSignalsOmitted: 2 });
    assert.ok(
      compactedSignalQuality.reasons.some((reason) =>
        reason.includes("supporting provider signal") && reason.includes("omitted")
      ),
      "evidence quality should explain compacted supporting signals",
    );
    assert.ok(
      compactedSignalQuality.recommendedAction.includes("full provenance"),
      "evidence quality should steer compacted supporting signals toward provenance follow-ups",
    );
    assert.ok(packet.retrievalDiagnostics.providerRunCount > 0, "retrieval diagnostics should count provider runs");
    assert.ok(
      packet.retrievalDiagnostics.providerCandidateCount >= packet.limits.candidatesConsidered,
      "retrieval diagnostics should summarize provider candidate volume",
    );
    assert.equal(
      packet.retrievalDiagnostics.providerExecutionMode,
      "serial",
      "retrieval diagnostics should expose provider execution mode for latency interpretation",
    );
    assert.equal(
      packet.retrievalDiagnostics.totalProviderDurationMs,
      packet.limits.providersRunDetail.reduce((sum, detail) => sum + detail.durationMs, 0),
      "retrieval diagnostics should aggregate provider duration",
    );
    assert.ok(
      !packet.retrievalDiagnostics.slowestProvider ||
        packet.retrievalDiagnostics.slowestProvider.durationMs === Math.max(
          ...packet.limits.providersRunDetail.map((detail) => detail.durationMs),
        ),
      "retrieval diagnostics should expose the slowest provider",
    );
    assert.equal(
      packet.retrievalDiagnostics.retrievalPlan.level,
      "issue_to_edit_localization",
      "focused auth debugging should be classified as an edit-localization retrieval task",
    );
    assert.equal(
      packet.retrievalDiagnostics.retrievalPlan.strategy,
      "entity_lookup",
      "focused auth debugging should prefer entity lookup before broader graph expansion",
    );
    assert.ok(
      packet.retrievalDiagnostics.retrievalPlan.signals.includes("focus_files:1"),
      "retrieval plan should expose focus-file routing signals",
    );
    assert.ok(
      packet.retrievalDiagnostics.retrievalPlan.requiredEvidence.some((item) => item.includes("target file")),
      "edit-localization retrieval plan should name the target-file evidence requirement",
    );
    assert.equal(
      packet.retrievalDiagnostics.retrievalPlan.evidenceGate.status,
      "follow_up_recommended",
      "edit-localization packets with generated follow-ups should recommend follow-up before edit claims",
    );
    assert.ok(
      packet.retrievalDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "edit_localization" &&
        gap.severity === "advisory" &&
        gap.recommendedTools.includes("tool_batch")
      ),
      "edit-localization retrieval plan should expose the follow-up reason as a typed evidence gap",
    );
    assert.equal(packet.retrievalDiagnostics.retrievalPlan.evidenceGate.canAnswerFromPacket, true);
    assert.equal(packet.retrievalDiagnostics.retrievalPlan.evidenceGate.canEditFromPacket, false);
    assert.deepEqual(
      packet.retrievalDiagnostics.retrievalPlan.recommendedTools.slice(0, 2),
      ["tool_batch", "live_text_search"],
      "edit-localization retrieval plan should name available follow-up tools from the generated expansions",
    );
    assert.deepEqual(
      packet.retrievalDiagnostics.retrievalPlan.recommendedFollowUps.slice(0, 2).map((tool) => tool.toolName),
      ["tool_batch", "live_text_search"],
      "edit-localization retrieval plan should include executable follow-ups in recommended order",
    );
    assert.ok(
      packet.retrievalDiagnostics.recommendations.length > 0,
      "retrieval diagnostics should include at least one recommendation",
    );
    assert.ok(
      packet.retrievalDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("tool_batch expansion")
      ),
      "retrieval diagnostics should mention the compact batch expansion when it is available",
    );
    const untruncatedDiagnostics = buildContextPacketRetrievalDiagnostics({
      mode: packet.mode,
      intent: packet.intent,
      requestCoverage: packet.requestCoverage,
      graphQuality: packet.evidenceQuality.graph,
      changedFileCount: 0,
      focusFileCount: 1,
      expandableTools: packet.expandableTools,
      providerRunDetails: packet.limits.providersRunDetail,
      providersFailed: [],
      providersSkippedDetail: packet.limits.providersSkippedDetail,
      liveTextMisses: [],
      totalContextCount: packet.primaryContext.length + packet.relatedContext.length,
      budgetExhausted: false,
      selectionLimitHit: false,
      candidatesOmittedByLimit: 0,
      requestedAnchorsOmitted: 0,
      supportingSignalsOmitted: 0,
    });
    const compactedSignalDiagnostics = buildContextPacketRetrievalDiagnostics({
      mode: packet.mode,
      intent: packet.intent,
      requestCoverage: packet.requestCoverage,
      graphQuality: packet.evidenceQuality.graph,
      changedFileCount: 0,
      focusFileCount: 1,
      expandableTools: packet.expandableTools,
      providerRunDetails: packet.limits.providersRunDetail,
      providersFailed: [],
      providersSkippedDetail: packet.limits.providersSkippedDetail,
      liveTextMisses: [],
      totalContextCount: packet.primaryContext.length + packet.relatedContext.length,
      budgetExhausted: false,
      selectionLimitHit: false,
      candidatesOmittedByLimit: 0,
      requestedAnchorsOmitted: 0,
      supportingSignalsOmitted: 2,
    });
    assert.ok(
      compactedSignalDiagnostics.retrievalPlan.signals.includes("supporting_signals_omitted:2"),
      "retrieval diagnostics should expose supporting-signal budget compaction as a planning signal",
    );
    assert.ok(
      compactedSignalDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "context_budget" &&
        gap.severity === "advisory" &&
        gap.message.includes("supporting signal")
      ),
      "retrieval diagnostics should expose omitted supporting signals as a typed budget evidence gap",
    );
    assert.ok(
      compactedSignalDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("supporting provider signals")
      ),
      "retrieval diagnostics should recommend follow-ups when supporting signals were compacted",
    );
    assert.ok(
      compactedSignalDiagnostics.retrievalPlan.evidenceGate.advisoryReasons.some((reason) =>
        reason.includes("supporting signal")
      ),
      "supporting-signal compaction should keep the evidence gate advisory instead of silently satisfied",
    );
    assert.ok(
      compactedSignalDiagnostics.retrievalPlan.nextStep.includes("full provenance"),
      "supporting-signal compaction should steer the next step toward provenance follow-ups",
    );
    assert.ok(
      compactedSignalDiagnostics.retrievalPlan.confidence < untruncatedDiagnostics.retrievalPlan.confidence,
      "supporting-signal compaction should reduce retrieval-plan confidence",
    );
    const budgetLimitedDiagnostics = buildContextPacketRetrievalDiagnostics({
      mode: packet.mode,
      intent: packet.intent,
      requestCoverage: packet.requestCoverage,
      graphQuality: packet.evidenceQuality.graph,
      changedFileCount: 0,
      focusFileCount: 1,
      expandableTools: packet.expandableTools,
      providerRunDetails: packet.limits.providersRunDetail,
      providersFailed: [],
      providersSkippedDetail: packet.limits.providersSkippedDetail,
      liveTextMisses: [],
      totalContextCount: packet.primaryContext.length + packet.relatedContext.length,
      budgetExhausted: true,
      selectionLimitHit: false,
      candidatesOmittedByLimit: 0,
      requestedAnchorsOmitted: 0,
      supportingSignalsOmitted: 0,
    });
    assert.ok(
      budgetLimitedDiagnostics.retrievalPlan.signals.includes("budget_exhausted"),
      "retrieval diagnostics should expose token-budget truncation as a planning signal",
    );
    assert.ok(
      budgetLimitedDiagnostics.retrievalPlan.evidenceGate.advisoryReasons.some((reason) =>
        reason.includes("budget-truncated")
      ),
      "budget truncation should keep the evidence gate advisory instead of silently satisfied",
    );
    assert.ok(
      budgetLimitedDiagnostics.retrievalPlan.nextStep.includes("budgetTokens"),
      "budget truncation should steer the next step toward increasing budget or narrowing the request",
    );
    assert.ok(
      budgetLimitedDiagnostics.retrievalPlan.confidence < untruncatedDiagnostics.retrievalPlan.confidence,
      "budget truncation should reduce retrieval-plan confidence",
    );
    const countLimitedDiagnostics = buildContextPacketRetrievalDiagnostics({
      mode: packet.mode,
      intent: packet.intent,
      requestCoverage: packet.requestCoverage,
      graphQuality: packet.evidenceQuality.graph,
      changedFileCount: 0,
      focusFileCount: 1,
      expandableTools: packet.expandableTools,
      providerRunDetails: packet.limits.providersRunDetail,
      providersFailed: [],
      providersSkippedDetail: packet.limits.providersSkippedDetail,
      liveTextMisses: [],
      totalContextCount: packet.primaryContext.length + packet.relatedContext.length,
      budgetExhausted: false,
      selectionLimitHit: true,
      candidatesOmittedByLimit: 3,
      requestedAnchorsOmitted: 1,
      supportingSignalsOmitted: 0,
    });
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.signals.includes("selection_limit_omitted:3"),
      "retrieval diagnostics should expose max-context selection truncation as a planning signal",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.signals.includes("requested_anchors_omitted:1"),
      "retrieval diagnostics should expose requested anchors omitted by context limits as a planning signal",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "context_budget" &&
        gap.severity === "advisory" &&
        gap.message.includes("maxPrimaryContext")
      ),
      "retrieval diagnostics should expose max-context selection truncation as a typed evidence gap",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "context_budget" &&
        gap.severity === "blocking" &&
        gap.message.includes("requested anchor")
      ),
      "retrieval diagnostics should expose omitted requested anchors as a blocking typed budget evidence gap",
    );
    assert.ok(
      countLimitedDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("maxPrimaryContext/maxRelatedContext")
      ),
      "retrieval diagnostics should recommend raising limits or follow-ups when ranked candidates were omitted",
    );
    assert.ok(
      countLimitedDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("requested anchors")
      ),
      "retrieval diagnostics should recommend raising limits or anchor follow-ups when requested anchors were omitted",
    );
    assert.equal(
      countLimitedDiagnostics.retrievalPlan.evidenceGate.status,
      "follow_up_required",
      "omitted requested anchors should require corrective retrieval before packet-only claims",
    );
    assert.equal(countLimitedDiagnostics.retrievalPlan.evidenceGate.canAnswerFromPacket, false);
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.evidenceGate.blockingReasons.some((reason) =>
        reason.includes("ranked but omitted")
      ),
      "omitted requested anchors should be visible as an evidence-gate blocking reason",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.evidenceGate.advisoryReasons.some((reason) =>
        reason.includes("maxPrimaryContext/maxRelatedContext")
      ),
      "selection-limit truncation should be visible as an evidence-gate advisory reason",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.nextStep.includes("omitted requested anchors"),
      "omitted requested anchors should steer the next step toward anchor-specific follow-ups",
    );
    assert.ok(
      countLimitedDiagnostics.retrievalPlan.confidence < untruncatedDiagnostics.retrievalPlan.confidence,
      "omitted requested anchors should reduce retrieval-plan confidence",
    );
    assert.ok(packet.limits.providersRun.includes("hot_hint_index"));
    const hotHintRunDetail = packet.limits.providersRunDetail.find((detail) => detail.provider === "hot_hint_index");
    assert.ok(hotHintRunDetail, "provider run details should include hot_hint_index");
    assert.equal(hotHintRunDetail.status, "success");
    assert.equal(typeof hotHintRunDetail.candidateCount, "number");
    assert.equal(typeof hotHintRunDetail.durationMs, "number");
    assert.equal(hotIndexCache.size(), 1, "first call should build one hot index");
    const exploreToolNames = packet.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      exploreToolNames.includes("repo_map"),
      "explore mode should recommend repo_map",
    );
    assert.equal(
      exploreToolNames.includes("imports_deps"),
      false,
      "generic explore expansions should not recommend imports_deps without a graph-gap file anchor",
    );
    assert.equal(
      exploreToolNames.includes("imports_impact"),
      false,
      "generic explore expansions should not recommend imports_impact without a graph-gap file anchor",
    );
    const exploreRepoMap = packet.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.ok(exploreRepoMap, "explore mode should attach a repo_map expansion entry");
    assert.deepEqual(
      (exploreRepoMap.suggestedArgs as { focusFiles?: unknown }).focusFiles,
      ["app/api/auth/callback/route.ts"],
      "repo_map suggestedArgs should preserve focusFiles as graph personalization anchors",
    );
    const exploreBatchOps = batchExpansionOps(packet, "primary packet");
    assert.deepEqual(
      exploreBatchOps.map((op) => op.tool),
      ["repo_map", "live_text_search", "project_open_loops", "evidence_confidence"],
      "explore packet should batch its independent read-only follow-ups",
    );
    assert.equal(
      exploreBatchOps.every((op) => op.resultMode === "summary"),
      true,
      "batched context-packet follow-ups should request compact result summaries",
    );
    await assertGeneratedBatchExpansionExecutes(packet, "primary packet", hotIndexCache);
    assert.ok(
      exploreToolNames.includes("project_open_loops"),
      "explore mode should recommend project_open_loops",
    );
    assert.equal(
      exploreToolNames.includes("verification_state"),
      false,
      "explore mode should not surface verification_state",
    );

    const noHintsCache = createHotIndexCache();
    try {
      const noHintsPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find auth session type context",
          focusFiles: ["app/api/auth/callback/route.ts"],
          includeLiveHints: false,
        },
        { hotIndexCache: noHintsCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(noHintsPacket, "no-hints packet");
      assert.equal(noHintsCache.size(), 0, "includeLiveHints=false should not build the hot index");
      assert.equal(
        noHintsPacket.limits.providersSkipped.includes("hot_hint_index"),
        true,
        "includeLiveHints=false should skip the hot hint provider",
      );
      assert.equal(
        noHintsPacket.limits.providersRun.includes("hot_hint_index"),
        false,
        "includeLiveHints=false should not report hot_hint_index as run",
      );
    } finally {
      noHintsCache.flush();
    }

    const quotedLiteralPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is \"Login\" rendered?",
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(quotedLiteralPacket, "quoted literal packet");
    assert.equal(
      quotedLiteralPacket.retrievalDiagnostics.retrievalPlan.level,
      "code_understanding",
      "literal lookup without edit anchors should remain a code-understanding retrieval task",
    );
    assert.equal(
      quotedLiteralPacket.retrievalDiagnostics.retrievalPlan.strategy,
      "hybrid",
      "quoted identifiers should use hybrid literal and entity retrieval planning",
    );
    assert.ok(
      quotedLiteralPacket.retrievalDiagnostics.retrievalPlan.recommendedTools.includes("live_text_search"),
      "literal lookup retrieval plan should recommend the generated live_text_search follow-up",
    );
    assert.ok(
      quotedLiteralPacket.retrievalDiagnostics.retrievalPlan.recommendedFollowUps.some((tool) =>
        tool.toolName === "live_text_search" &&
        (tool.suggestedArgs as { query?: unknown }).query === "Login"
      ),
      "literal lookup retrieval plan should include the concrete live_text_search args",
    );
    const literalLiveTextSearch = quotedLiteralPacket.expandableTools.find((tool) => tool.toolName === "live_text_search");
    assert.ok(literalLiveTextSearch, "context_packet should recommend live_text_search for exact follow-up checks");
    assert.ok(
      quotedLiteralPacket.limits.providersSkipped.includes("live_text_provider"),
      "includeLiveHints=false should skip the live text provider for quoted literals",
    );
    assert.ok(
      quotedLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "Login" &&
        item.status === "not_checked"
      ),
      "request coverage should mark quoted literals as not checked when live text is disabled",
    );
    assert.deepEqual(
      literalLiveTextSearch.suggestedArgs,
      {
        projectId,
        query: "Login",
        fixedStrings: true,
        maxMatches: 50,
      },
      "live_text_search suggestedArgs should search the quoted literal, not the whole prose request",
    );

    const liveLiteralPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is \"Login\" rendered?",
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(liveLiteralPacket, "live literal packet");
    assert.ok(
      liveLiteralPacket.limits.providersRun.includes("live_text_provider"),
      "quoted literals should run the bounded live text provider when live hints are enabled",
    );
    const liveLiteralCandidate = liveLiteralPacket.primaryContext.find((candidate) =>
      candidate.source === "live_text_provider" &&
      candidate.path === "components/LoginButton.tsx"
    );
    assert.ok(
      liveLiteralCandidate,
      "live text provider should return the current-disk file containing the quoted literal",
    );
    assert.equal(liveLiteralCandidate.strategy, "exact_match");
    assert.equal(liveLiteralCandidate.metadata?.query, "Login");
    assert.equal(liveLiteralCandidate.metadata?.overlay, "live_filesystem");
    assert.equal(liveLiteralCandidate.metadata?.evidenceConfidenceLabel, "verified_live");
    assert.equal(typeof liveLiteralCandidate.lineStart, "number");
    assert.ok(
      typeof liveLiteralCandidate.metadata?.text === "string" &&
        liveLiteralCandidate.metadata.text.includes("Login"),
      "live text candidate should include the matched current-disk line",
    );
    assert.ok(
      liveLiteralPacket.evidenceQuality.liveOverlayContextCount > 0,
      "live text matches should count as live evidence quality",
    );
    assert.ok(
      liveLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "Login" &&
        item.status === "covered" &&
        item.matchedBy.some((ref) => ref.includes("live_text_provider"))
      ),
      "request coverage should mark live text literals as covered by current filesystem evidence",
    );

    const cappedLiteralPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "verify \"Login\" \"duplicate role check\" \"missing capped marker\" \"unsearched capped marker\"",
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(cappedLiteralPacket, "capped literal packet");
    assert.ok(
      cappedLiteralPacket.warnings.some((warning) =>
        warning.includes("quoted literal search capped at 3 of 4")
      ),
      "live text provider should warn when quoted literal checks are capped",
    );
    assert.ok(
      cappedLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "unsearched capped marker" &&
        item.status === "not_checked"
      ),
      "quoted literals omitted by the live text cap should be marked not_checked",
    );
    assert.ok(
      cappedLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "missing capped marker" &&
        item.status === "uncovered"
      ),
      "quoted literals searched and missed should remain uncovered",
    );
    assert.equal(
      cappedLiteralPacket.retrievalDiagnostics.liveTextMisses.some((miss) =>
        miss.query === "unsearched capped marker"
      ),
      false,
      "capped literals should not be reported as live text misses when they were never searched",
    );
    assert.ok(
      cappedLiteralPacket.requestCoverage.recommendations.some((recommendation) =>
        recommendation.includes("Enable live hints or run live_text_search")
      ),
      "request coverage should recommend explicit live search for capped not-checked literals",
    );

    const scopedLiteralCache = createHotIndexCache();
    try {
      const scopedLiveLiteralPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check\"",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedLiveLiteralPacket, "scoped live literal packet");
      assert.equal(
        scopedLiteralCache.size(),
        0,
        "scoped quoted literal routing should not build a hot index",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRun.includes("hot_hint_index"),
        false,
        "scoped quoted literal routing should skip broad hot hints",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRun.includes("repo_map_provider"),
        false,
        "scoped quoted literal routing should skip centrality-ranked repo map context",
      );
      for (const provider of [
        "file_provider",
        "route_provider",
        "schema_provider",
        "symbol_provider",
        "import_graph_provider",
      ]) {
        assert.equal(
          scopedLiveLiteralPacket.limits.providersRun.includes(provider),
          false,
          `scoped live literal hit should not run ${provider}`,
        );
        assert.equal(
          scopedLiveLiteralPacket.limits.providersSkipped.includes(provider),
          true,
          `scoped live literal hit should report ${provider} as skipped`,
        );
      }
      assert.equal(
        scopedLiveLiteralPacket.limits.providersSkipped.includes("hot_hint_index"),
        true,
        "scoped quoted literal routing should report the hot hint skip",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersSkipped.includes("repo_map_provider"),
        true,
        "scoped quoted literal routing should report the repo map skip",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "hot_hint_index" && detail.adaptive &&
          detail.reason.includes("Scoped live exact matches")
        ),
        "provider skip details should explain adaptive hot hint routing",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "repo_map_provider" && detail.adaptive &&
          detail.reason.includes("Scoped live exact matches")
        ),
        "provider skip details should explain adaptive repo map routing",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "file_provider" && detail.adaptive &&
          detail.reason.includes("Scoped live exact matches")
        ),
        "provider skip details should explain data-driven semantic provider pruning",
      );
      assert.ok(
        scopedLiveLiteralPacket.retrievalDiagnostics.adaptiveSkippedProviders.includes("file_provider") &&
          scopedLiveLiteralPacket.retrievalDiagnostics.adaptiveSkippedProviders.includes("hot_hint_index"),
        "retrieval diagnostics should summarize adaptive skips",
      );
      assert.deepEqual(
        scopedLiveLiteralPacket.retrievalDiagnostics.providersSkippedDetail,
        scopedLiveLiteralPacket.limits.providersSkippedDetail,
        "retrieval diagnostics should expose model-facing skip reasons without requiring limits inspection",
      );
      assert.ok(
        scopedLiveLiteralPacket.retrievalDiagnostics.providersSkippedDetail.some((detail) =>
          detail.provider === "repo_map_provider" &&
          detail.adaptive &&
          detail.reason.includes("Scoped live exact matches")
        ),
        "retrieval diagnostics should include adaptive skip reasons",
      );
      assert.ok(
        scopedLiveLiteralPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
          recommendation.includes("Adaptive routing")
        ),
        "retrieval diagnostics should recommend expanding when adaptive routing narrowed retrieval",
      );
      const scopedLiveRunDetail = scopedLiveLiteralPacket.limits.providersRunDetail.find((detail) =>
        detail.provider === "live_text_provider"
      );
      assert.ok(scopedLiveRunDetail, "scoped literal packets should include live_text_provider run detail");
      assert.equal(scopedLiveRunDetail.status, "success");
      assert.ok(scopedLiveRunDetail.candidateCount > 0, "live text run detail should count exact matches");
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRunDetail.some((detail) =>
          detail.provider === "file_provider"
        ),
        false,
        "pruned semantic providers should not appear in provider run details",
      );
      const scopedLiveCandidates = scopedLiveLiteralPacket.primaryContext.filter((candidate) =>
        candidate.source === "live_text_provider"
      );
      assert.ok(scopedLiveCandidates.length > 0, "scoped quoted literal should return live text candidates");
      assert.equal(
        scopedLiveCandidates.every((candidate) =>
          candidate.path === "app/dashboard/admin/endorsements/create/client-page.tsx" &&
          candidate.metadata?.scopePath === "app/dashboard/admin/endorsements/create/client-page.tsx"
        ),
        true,
        "live text provider should scope quoted literal searches to explicit focus files",
      );
      assert.equal(
        scopedLiveCandidates.some((candidate) =>
          candidate.path === "app/dashboard/instructor/endorsements/create/client-page.tsx"
        ),
        false,
        "scoped live literal search should not return matches from unanchored files",
      );

      const scopedGraphLiteralPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check\" dependency graph",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedGraphLiteralPacket, "scoped graph literal packet");
      assert.equal(
        scopedGraphLiteralPacket.limits.providersRun.includes("live_text_provider"),
        true,
        "scoped graph literal packets should still run live exact evidence",
      );
      assert.equal(
        scopedGraphLiteralPacket.limits.providersRun.includes("import_graph_provider"),
        true,
        "scoped live exact hits should keep import graph retrieval when the request asks for graph evidence",
      );
      assert.equal(
        scopedGraphLiteralPacket.limits.providersRun.includes("repo_map_provider"),
        true,
        "scoped live exact hits should keep graph-ranked repo map context for graph evidence requests",
      );
      assert.equal(
        scopedGraphLiteralPacket.limits.providersSkipped.includes("import_graph_provider"),
        false,
        "graph evidence requests should not report import graph as adaptively skipped",
      );
      assert.equal(
        scopedGraphLiteralPacket.limits.providersSkipped.includes("repo_map_provider"),
        false,
        "graph evidence requests should not report repo map as adaptively skipped",
      );
      assert.ok(
        scopedGraphLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "file_provider" &&
          detail.adaptive &&
          detail.reason.includes("graph providers stayed enabled")
        ),
        "semantic provider skip details should explain that graph providers stayed enabled",
      );
      assert.equal(
        scopedGraphLiteralPacket.retrievalDiagnostics.retrievalPlan.strategy,
        "graph_expansion",
        "scoped graph literal packets should keep graph-expansion retrieval planning",
      );

      const scopedLiveSymbolPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "inspect AdminEndorsementCreatePage current file",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
          focusSymbols: ["AdminEndorsementCreatePage"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedLiveSymbolPacket, "scoped live symbol packet");
      assert.equal(
        scopedLiveSymbolPacket.limits.providersRun.includes("live_text_provider"),
        true,
        "scoped focus symbols should run bounded live text verification",
      );
      assert.equal(
        scopedLiveSymbolPacket.limits.providersRun.includes("file_provider"),
        false,
        "scoped live symbol hits should skip indexed fallback providers",
      );
      const scopedLiveSymbolCandidate = scopedLiveSymbolPacket.primaryContext.find((candidate) =>
        candidate.source === "live_text_provider" &&
        candidate.kind === "symbol" &&
        candidate.symbolName === "AdminEndorsementCreatePage"
      );
      assert.ok(scopedLiveSymbolCandidate, "live text provider should return scoped symbol evidence");
      assert.equal(scopedLiveSymbolCandidate.path, "app/dashboard/admin/endorsements/create/client-page.tsx");
      assert.equal(scopedLiveSymbolCandidate.metadata?.queryKind, "symbol");
      assert.equal(scopedLiveSymbolCandidate.metadata?.scopePath, "app/dashboard/admin/endorsements/create/client-page.tsx");
      assert.ok(
        scopedLiveSymbolPacket.requestCoverage.items.some((item) =>
          item.kind === "symbol" &&
          item.value === "AdminEndorsementCreatePage" &&
          item.status === "covered" &&
          item.matchedBy.some((ref) => ref.includes("live_text_provider"))
        ),
        "request coverage should mark scoped live symbols as covered by current filesystem evidence",
      );

      const prioritizedFocusSymbolPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "verify \"duplicate role check\" \"missing scoped marker\" \"unsearched focus symbol marker\"",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
          focusSymbols: ["AdminEndorsementCreatePage"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(prioritizedFocusSymbolPacket, "prioritized focus symbol packet");
      assert.ok(
        prioritizedFocusSymbolPacket.warnings.some((warning) =>
          warning.includes("quoted literal search capped at 2 of 3")
        ),
        "explicit focus symbols should reserve live-text capacity before lower-priority quoted literals",
      );
      assert.ok(
        [...prioritizedFocusSymbolPacket.primaryContext, ...prioritizedFocusSymbolPacket.relatedContext].some((candidate) =>
          candidate.source === "live_text_provider" &&
          candidate.kind === "symbol" &&
          candidate.symbolName === "AdminEndorsementCreatePage" &&
          candidate.metadata?.queryKind === "symbol"
        ),
        "focused symbols should still receive current-disk live evidence when quoted literals hit the cap",
      );
      assert.ok(
        prioritizedFocusSymbolPacket.requestCoverage.items.some((item) =>
          item.kind === "symbol" &&
          item.value === "AdminEndorsementCreatePage" &&
          item.status === "covered" &&
          item.matchedBy.some((ref) => ref.includes("live_text_provider"))
        ),
        "request coverage should preserve current-disk focused-symbol coverage under live query caps",
      );
      assert.ok(
        prioritizedFocusSymbolPacket.requestCoverage.items.some((item) =>
          item.kind === "quoted_text" &&
          item.value === "unsearched focus symbol marker" &&
          item.status === "not_checked"
        ),
        "quoted literals omitted after explicit symbol priority should be marked not_checked",
      );
      assert.equal(
        prioritizedFocusSymbolPacket.retrievalDiagnostics.liveTextMisses.some((miss) =>
          miss.query === "unsearched focus symbol marker"
        ),
        false,
        "quoted literals omitted by explicit symbol priority should not be reported as live text misses",
      );

      const mixedScopedLiveLiteralPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check\" and \"missing scoped marker\"",
          focusFiles: [
            "app/dashboard/admin/endorsements/create/client-page.tsx",
            "app/dashboard/instructor/endorsements/create/client-page.tsx",
          ],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(mixedScopedLiveLiteralPacket, "mixed scoped live literal packet");
      assert.ok(
        mixedScopedLiveLiteralPacket.limits.providersRun.includes("file_provider"),
        "mixed scoped literal hits and misses should keep indexed fallback providers enabled",
      );
      assert.ok(
        mixedScopedLiveLiteralPacket.limits.providersRun.includes("hot_hint_index"),
        "mixed scoped literal hits and misses should keep broad hot hints enabled",
      );
      assert.ok(
        mixedScopedLiveLiteralPacket.limits.providersRun.includes("repo_map_provider"),
        "mixed scoped literal hits and misses should keep repo-map fallback enabled",
      );
      const mixedScopedHits = [...mixedScopedLiveLiteralPacket.primaryContext, ...mixedScopedLiveLiteralPacket.relatedContext]
        .filter((candidate) =>
          candidate.source === "live_text_provider" &&
          candidate.metadata?.query === "duplicate role check"
        )
        .map((candidate) => candidate.metadata?.scopePath)
        .sort();
      assert.deepEqual(
        mixedScopedHits,
        [
          "app/dashboard/admin/endorsements/create/client-page.tsx",
          "app/dashboard/instructor/endorsements/create/client-page.tsx",
        ],
        "bounded live literal search should preserve scoped hits from multiple focus files",
      );
      assert.deepEqual(
        mixedScopedLiveLiteralPacket.retrievalDiagnostics.liveTextMisses
          .filter((miss) => miss.query === "missing scoped marker")
          .map((miss) => miss.scopePath),
        [
          "app/dashboard/admin/endorsements/create/client-page.tsx",
          "app/dashboard/instructor/endorsements/create/client-page.tsx",
        ],
        "bounded live literal search should reassemble scoped misses in deterministic focus-file order",
      );
      assert.ok(
        mixedScopedLiveLiteralPacket.requestCoverage.items.some((item) =>
          item.kind === "quoted_text" &&
          item.value === "missing scoped marker" &&
          item.status === "uncovered"
        ),
        "mixed scoped literal packets should keep missed literals visible in request coverage",
      );

      const scopedLiveLiteralMissPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check typo\"",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedLiveLiteralMissPacket, "scoped live literal miss packet");
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("file_provider"),
        "scoped literal misses should still run indexed fallback providers",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("hot_hint_index"),
        "scoped literal misses should keep broad hot hint fallback enabled",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("repo_map_provider"),
        "scoped literal misses should keep repo-map fallback enabled",
      );
      assert.equal(
        scopedLiteralCache.size(),
        1,
        "scoped literal misses should build a hot index for broad fallback",
      );
      const scopedLiveMissRunDetail = scopedLiveLiteralMissPacket.limits.providersRunDetail.find((detail) =>
        detail.provider === "live_text_provider"
      );
      assert.ok(scopedLiveMissRunDetail, "scoped literal misses should include live_text_provider run detail");
      assert.equal(scopedLiveMissRunDetail.candidateCount, 0);
      assert.ok(
        scopedLiveLiteralMissPacket.retrievalDiagnostics.liveTextMisses.some((miss) =>
          miss.query === "duplicate role check typo" &&
          miss.scope === "file" &&
          miss.scopePath === "app/dashboard/admin/endorsements/create/client-page.tsx"
        ),
        "retrieval diagnostics should report scoped live literal misses",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
          recommendation.includes("Quoted literal was not found in scoped current files")
        ),
        "scoped live literal misses should recommend spelling/case verification or broader live search",
      );
      assert.equal(scopedLiveLiteralMissPacket.requestCoverage.status, "partial");
      assert.ok(
        scopedLiveLiteralMissPacket.requestCoverage.items.some((item) =>
          item.kind === "quoted_text" &&
          item.value === "duplicate role check typo" &&
          item.status === "uncovered"
        ),
        "request coverage should mark scoped literal misses as uncovered",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.requestCoverage.recommendations.some((recommendation) =>
          recommendation.includes("Broaden live_text_search")
        ),
        "request coverage should recommend broader live search for uncovered literals",
      );
      const scopedMissLiveTextSearch = scopedLiveLiteralMissPacket.expandableTools.find((tool) =>
        tool.toolName === "live_text_search"
      );
      assert.ok(scopedMissLiveTextSearch, "scoped live literal misses should recommend broad live_text_search");
      assert.deepEqual(
        scopedMissLiveTextSearch.suggestedArgs,
        {
          projectId,
          query: "duplicate role check typo",
          fixedStrings: true,
          maxMatches: 50,
        },
        "scoped miss live_text_search should broaden the missed literal to the project filesystem",
      );
      assert.ok(
        scopedMissLiveTextSearch.reason.includes("did not find") &&
          scopedMissLiveTextSearch.reason.includes("app/dashboard/admin/endorsements/create/client-page.tsx"),
        "scoped miss live_text_search should explain the scoped current-file miss",
      );
    } finally {
      scopedLiteralCache.flush();
    }

    const weakPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "implement",
        request: "zzzz_no_context_match_987654",
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.equal(weakPacket.evidenceQuality.label, "weak");
    assert.equal(weakPacket.evidenceQuality.totalContextCount, 0);
    assert.equal(
      weakPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.status,
      "follow_up_required",
      "zero-context packet should require follow-up before answering",
    );
    assert.equal(weakPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.canAnswerFromPacket, false);
    assert.ok(
      weakPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.blockingReasons.some((reason) =>
        reason.includes("No deterministic context")
      ),
      "zero-context gate should explain the missing evidence",
    );
    assert.equal(weakPacket.retrievalDiagnostics.providerCandidateCount, 0);
    assert.ok(
      weakPacket.retrievalDiagnostics.zeroCandidateProviders.length > 0,
      "weak packets should report providers that returned zero candidates",
    );
    assert.ok(
      weakPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("All executed providers returned zero candidates")
      ),
      "weak packets should recommend better anchors when all providers miss",
    );
    assert.ok(
      weakPacket.evidenceQuality.reasons.some((reason) => reason.includes("No deterministic context")),
      "weak evidence quality should explain that no deterministic context matched",
    );

    const duplicatePacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "find duplicate endorsement create role checks",
        includeLiveHints: false,
        maxPrimaryContext: 2,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const duplicatePaths = new Set(duplicatePacket.primaryContext.flatMap((candidate) => candidate.path ?? []));
    assert.equal(
      duplicatePacket.primaryContext.some((candidate) => candidate.strategy === "centrality_rank"),
      false,
      "duplicate discovery should not rank centrality candidates as primary context",
    );
    assert.ok(
      duplicatePaths.has("app/dashboard/admin/endorsements/create/client-page.tsx") ||
        duplicatePaths.has("app/dashboard/instructor/endorsements/create/client-page.tsx"),
      "duplicate discovery should prioritize directly matching peripheral files",
    );
    assert.equal(
      [...duplicatePacket.primaryContext, ...duplicatePacket.relatedContext].some((candidate) =>
        candidate.strategy === "centrality_rank" &&
        candidate.metadata?.graphRankMode === "global"
      ),
      false,
      "anchored duplicate discovery should not spend bounded context on unrelated global graph hubs",
    );

    const graphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect callback dependency graph",
        focusFiles: ["app/api/auth/callback/route.ts"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const graphContext = [...graphPacket.primaryContext, ...graphPacket.relatedContext];
    const transitiveTypeCandidate = graphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.ok(
      transitiveTypeCandidate,
      `focused graph expansion should surface transitive dependencies of the route; got ${JSON.stringify(
        graphContext.map((candidate) => ({
          path: candidate.path,
          source: candidate.source,
          strategy: candidate.strategy,
          score: candidate.score,
          metadata: candidate.metadata,
        })).slice(0, 12),
      )}`,
    );
    assert.equal(
      transitiveTypeCandidate?.strategy,
      "deterministic_graph",
      "context graph should explain transitive dependencies through the import graph provider",
    );
    assert.equal(
      transitiveTypeCandidate?.metadata?.graphDepth,
      2,
      "transitive dependency should report its import-graph depth",
    );
    assert.deepEqual(
      transitiveTypeCandidate?.metadata?.graphPath,
      ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
      "transitive dependency should retain the focused graph path",
    );
    const transitiveGraphFile = graphPacket.graphSummary.files.find((file) => file.filePath === "types/auth.ts");
    assert.ok(
      transitiveGraphFile,
      "graph summary should include the transitive dependency file",
    );
    assert.equal(
      transitiveGraphFile?.pathEvidenceCount,
      1,
      "graph summary should count path-level provenance for transitive dependencies",
    );
    assert.deepEqual(
      transitiveGraphFile?.pathEvidence?.[0]?.path,
      ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
      "graph summary should expose the dependency path that made the transitive file relevant",
    );
    assert.equal(
      transitiveGraphFile?.pathEvidence?.[0]?.distance,
      2,
      "graph summary path evidence should expose dependency distance",
    );
    assert.equal(
      transitiveGraphFile?.pathEvidence?.[0]?.source,
      "import_graph_provider",
      "graph summary path evidence should preserve the provider source",
    );
    assert.equal(
      typeof transitiveTypeCandidate?.metadata?.corroborationBonus,
      "number",
      "merged candidates should expose the bounded corroboration boost",
    );
    assert.ok(
      Number(transitiveTypeCandidate?.metadata?.corroborationBonus ?? 0) > 0,
      "independent supporting evidence should increase the merged candidate score",
    );
    assert.ok(
      Number(transitiveTypeCandidate?.metadata?.corroboratedSignalCount ?? 0) >= 2,
      "merged candidates should report how many signals contributed",
    );
    const transitiveSupportingSignals = transitiveTypeCandidate?.metadata?.supportingSignals;
    assert.equal(
      Array.isArray(transitiveSupportingSignals),
      true,
      "merged candidates should retain compact supporting provider signals",
    );
    assert.equal(
      Array.isArray(transitiveSupportingSignals) &&
        transitiveSupportingSignals.some((signal) =>
          typeof signal === "object" &&
          signal != null &&
          !Array.isArray(signal) &&
          signal.source === "repo_map_provider" &&
          typeof signal.metadata === "object" &&
          signal.metadata != null &&
          !Array.isArray(signal.metadata) &&
          signal.metadata.graphRankMode === "personalized" &&
          signal.metadata.graphRankDirection === "bidirectional" &&
          signal.metadata.focusRelation === "dependency" &&
          signal.metadata.dependencyDistance === 2
        ),
      true,
      "transitive dependency should retain PageRank support after provider merge",
    );
    assert.equal(
      graphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.metadata?.graphRankMode === "personalized"
      ) ||
        (Array.isArray(transitiveSupportingSignals) &&
          transitiveSupportingSignals.some((signal) =>
            typeof signal === "object" &&
            signal != null &&
            !Array.isArray(signal) &&
            signal.source === "repo_map_provider" &&
            typeof signal.metadata === "object" &&
            signal.metadata != null &&
            !Array.isArray(signal.metadata) &&
            signal.metadata.graphRankMode === "personalized" &&
            signal.metadata.graphRankDirection === "bidirectional" &&
            signal.metadata.focusRelation === "dependency" &&
            signal.metadata.dependencyDistance === 2
          )),
      true,
      "repo_map_provider should still report personalized graph ranking when focus files seed the graph",
    );
    assert.equal(
      graphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.path === "components/ui/button.tsx"
      ),
      false,
      "personalized graph ranking should avoid unrelated global hubs",
    );
    assert.equal(graphPacket.evidenceQuality.graph.status, "connected");
    assert.ok(
      graphPacket.evidenceQuality.graph.edgeCount > 0 ||
        graphPacket.evidenceQuality.graph.connectedFileCount > 0,
      "connected graph quality should prove edge or relation evidence was returned",
    );

    const cappedGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect wide dependency graph",
        focusFiles: ["app/fairness/wide.ts"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 16,
        budgetTokens: 8000,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(cappedGraphPacket, "capped graph packet");
    assert.equal(
      cappedGraphPacket.evidenceQuality.graph.status,
      "connected",
      "bounded graph traversal can still return connected evidence",
    );
    assert.ok(
      cappedGraphPacket.warnings.some((warning) =>
        warning.includes("import_graph_provider") &&
        warning.includes("app/fairness/wide.ts") &&
        warning.includes("capped at 8 of 12 edge")
      ),
      "wide graph traversal should report the per-node edge cap in packet warnings",
    );
    assert.ok(
      cappedGraphPacket.graphSummary.warnings.some((warning) =>
        warning.includes("import_graph_provider") &&
        warning.includes("app/fairness/wide.ts") &&
        warning.includes("capped at 8 of 12 edge")
      ),
      "graph summary should retain provider cap warnings for evidence assessment",
    );
    assert.ok(
      cappedGraphPacket.evidenceQuality.graph.warningCount > 0,
      "evidence quality should count graph traversal warnings",
    );
    assert.ok(
      cappedGraphPacket.evidenceQuality.reasons.some((reason) =>
        reason.includes("graph evidence warning") &&
        reason.includes("bounded or incomplete traversal")
      ),
      "evidence quality should explain bounded graph traversal",
    );
    assert.ok(
      cappedGraphPacket.evidenceQuality.recommendedAction.includes("bounded"),
      "bounded graph evidence should steer agents away from exhaustive dependency claims",
    );
    assert.ok(
      cappedGraphPacket.retrievalDiagnostics.retrievalPlan.signals.some((signal) =>
        signal.startsWith("graph_warnings:")
      ),
      "retrieval plan should expose bounded graph evidence as a machine-readable signal",
    );
    assert.ok(
      cappedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.advisoryReasons.some((reason) =>
        reason.includes("warning-labeled or bounded")
      ),
      "retrieval gate should recommend follow-up when graph traversal was capped",
    );
    assert.ok(
      cappedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "graph_evidence" &&
        gap.severity === "advisory" &&
        gap.message.includes("exhaustive")
      ),
      "retrieval plan should expose bounded graph traversal as a typed advisory gap",
    );

    const fairMultiSeedGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect multi-anchor dependency graph fairness",
        focusFiles: ["app/fairness/hub.ts", "app/fairness/target.ts"],
        includeLiveHints: false,
        maxPrimaryContext: 16,
        maxRelatedContext: 60,
        budgetTokens: 12000,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const fairMultiSeedContext = [
      ...fairMultiSeedGraphPacket.primaryContext,
      ...fairMultiSeedGraphPacket.relatedContext,
    ];
    assert.ok(
      fairMultiSeedContext.some((candidate) =>
        candidate.source === "import_graph_provider" &&
        candidate.path === "app/fairness/deps/dep-0.ts" &&
        candidate.metadata?.seedPath === "app/fairness/hub.ts"
      ),
      "multi-seed graph retrieval should still return context from the high-fanout first seed",
    );
    const fairTargetLeafCandidate = fairMultiSeedContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.path === "app/fairness/target-leaf.ts"
    );
    const fairImportGraphSeedOrder = fairMultiSeedContext
      .filter((candidate) => candidate.source === "import_graph_provider")
      .map((candidate) => candidate.metadata?.seedPath);
    assert.ok(
      fairImportGraphSeedOrder.slice(0, 4).includes("app/fairness/target.ts"),
      `multi-seed graph ranking should diversify graph candidates across seeds early; got ${JSON.stringify(
        fairImportGraphSeedOrder.slice(0, 12),
      )}`,
    );
    assert.ok(
      fairTargetLeafCandidate,
      `multi-seed graph retrieval should not let the first seed exhaust the graph budget; got ${JSON.stringify(
        fairMultiSeedContext
          .filter((candidate) => candidate.source === "import_graph_provider")
          .map((candidate) => ({
            path: candidate.path,
            seedPath: candidate.metadata?.seedPath,
            graphDepth: candidate.metadata?.graphDepth,
          }))
          .slice(0, 24),
      )}`,
    );
    assert.equal(
      fairTargetLeafCandidate?.metadata?.seedPath,
      "app/fairness/target.ts",
      "later seed graph candidates should retain the seed path that produced them",
    );
    assert.equal(
      fairTargetLeafCandidate?.metadata?.graphTraversalMode,
      "round_robin_frontier",
      "import graph metadata should expose balanced frontier traversal",
    );

    const isolatedGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect isolated dashboard layout dependency graph",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(isolatedGraphPacket, "isolated graph packet");
    const isolatedGraphContext = [...isolatedGraphPacket.primaryContext, ...isolatedGraphPacket.relatedContext];
    const isolatedRepoMapSignals: Array<Record<string, unknown>> = [];
    for (const candidate of isolatedGraphContext) {
      if (candidate.source === "repo_map_provider") {
        isolatedRepoMapSignals.push(candidate as unknown as Record<string, unknown>);
      }
      const supportingSignals = candidate.metadata?.supportingSignals;
      if (Array.isArray(supportingSignals)) {
        for (const signal of supportingSignals) {
          if (typeof signal !== "object" || signal == null || Array.isArray(signal)) continue;
          const signalRecord = signal as Record<string, unknown>;
          if (signalRecord.source === "repo_map_provider") {
            isolatedRepoMapSignals.push(signalRecord);
          }
        }
      }
    }
    assert.ok(
      isolatedRepoMapSignals.length > 0,
      "isolated focus file should still receive personalized repo_map support for the seed file",
    );
    assert.equal(
      isolatedRepoMapSignals.every((signal) => {
        const signalMetadata = signal.metadata;
        if (typeof signalMetadata !== "object" || signalMetadata == null || Array.isArray(signalMetadata)) {
          return false;
        }
        const metadataRecord = signalMetadata as Record<string, unknown>;
        return metadataRecord.graphRankMode === "personalized" &&
          metadataRecord.graphRankDirection === "bidirectional" &&
          metadataRecord.focusRelation === "self" &&
          metadataRecord.focusDistance === 0 &&
          Number(metadataRecord.graphRankScore ?? 0) > 0.1;
      }),
      true,
      "personalized repo_map signals should omit unrelated zero-rank files for isolated focus anchors",
    );
    assert.equal(isolatedGraphPacket.evidenceQuality.graph.status, "isolated");
    assert.equal(isolatedGraphPacket.evidenceQuality.label, "partial");
    assert.ok(
      isolatedGraphPacket.evidenceQuality.reasons.some((reason) =>
        reason.includes("isolated graph evidence")
      ),
      "evidence quality should explain isolated graph evidence for dependency-graph requests",
    );
    assert.ok(
      isolatedGraphPacket.evidenceQuality.recommendedAction.includes("file-local context"),
      "isolated graph evidence should steer agents away from broad dependency claims",
    );
    const isolatedGraphExpansionTools = isolatedGraphPacket.expandableTools.slice(0, 4);
    assert.deepEqual(
      isolatedGraphExpansionTools.slice(0, 2).map((tool) => tool.toolName),
      ["imports_deps", "imports_impact"],
      "isolated graph evidence should prioritize direct dependency and impact follow-up tools",
    );
    assert.equal(
      (isolatedGraphExpansionTools[0]?.suggestedArgs as { file?: unknown }).file,
      "app/dashboard/layout.tsx",
      "imports_deps graph-gap follow-up should target the isolated anchor file",
    );
    assert.equal(
      (isolatedGraphExpansionTools[1]?.suggestedArgs as { file?: unknown; depth?: unknown }).file,
      "app/dashboard/layout.tsx",
      "imports_impact graph-gap follow-up should target the isolated anchor file",
    );
    assert.equal(
      (isolatedGraphExpansionTools[1]?.suggestedArgs as { depth?: unknown }).depth,
      3,
      "imports_impact graph-gap follow-up should use a bounded transitive depth",
    );
    assert.ok(
      isolatedGraphExpansionTools.some((tool) => tool.toolName === "reef_where_used"),
      "isolated graph evidence should also suggest maintained usage evidence",
    );
    assert.equal(
      isolatedGraphPacket.expandableTools[4]?.toolName,
      "tool_batch",
      "isolated graph evidence should keep direct graph tools first and then offer a batched shortcut",
    );
    assert.deepEqual(
      batchExpansionOps(isolatedGraphPacket, "isolated graph packet").map((op) => op.tool),
      ["imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      "isolated graph batch should bundle the direct dependency, impact, map, and usage follow-ups",
    );
    await assertGeneratedBatchExpansionExecutes(isolatedGraphPacket, "isolated graph packet", hotIndexCache);
    assert.equal(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.level,
      "broader_context_retrieval",
      "dependency graph requests should be classified as broader context retrieval",
    );
    assert.equal(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.strategy,
      "graph_expansion",
      "dependency graph requests should prefer graph expansion",
    );
    assert.ok(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.requiredEvidence.some((item) =>
        item.includes("dependency graph")
      ),
      "broader context retrieval should require dependency graph evidence",
    );
    assert.deepEqual(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.recommendedTools.slice(0, 5),
      ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      "graph retrieval plan should name the generated graph follow-up tools in priority order",
    );
    assert.deepEqual(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.recommendedFollowUps.slice(0, 5).map((tool) => tool.toolName),
      ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      "graph retrieval plan should include executable graph follow-ups in priority order",
    );
    assert.equal(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.status,
      "follow_up_required",
      "isolated graph evidence should require follow-up before dependency claims",
    );
    assert.equal(isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.canAnswerFromPacket, false);
    assert.ok(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGate.blockingReasons.some((reason) =>
        reason.includes("isolated")
      ),
      "isolated graph gate should explain the graph evidence gap",
    );
    assert.ok(
      isolatedGraphPacket.retrievalDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.kind === "graph_evidence" &&
        gap.severity === "blocking" &&
        gap.recommendedTools.includes("imports_impact")
      ),
      "isolated graph plan should expose the graph gap with executable follow-up tools",
    );
    assert.ok(
      isolatedGraphPacket.retrievalDiagnostics.recommendations[0]?.includes("Use the tool_batch expansion"),
      "partial graph evidence should recommend the compact batch before broad dependency claims",
    );

    const routeOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect callback dependency graph",
        focusRoutes: ["/api/auth/callback"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const routeOnlyRepoMap = routeOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (routeOnlyRepoMap?.suggestedArgs as { focusRoutes?: unknown } | undefined)?.focusRoutes,
      ["/api/auth/callback"],
      "repo_map suggestedArgs should preserve focusRoutes anchors",
    );
    const routeOnlyGraphContext = [...routeOnlyGraphPacket.primaryContext, ...routeOnlyGraphPacket.relatedContext];
    const routeOnlyTypeCandidate = routeOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.equal(
      routeOnlyTypeCandidate?.metadata?.graphDepth,
      2,
      "focusRoutes alone should seed transitive import graph expansion",
    );
    assert.deepEqual(
      routeOnlyTypeCandidate?.metadata?.graphPath,
      ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
      "route-focused graph expansion should preserve the route handler path",
    );
    const routeOnlySeedSources = routeOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(routeOnlySeedSources),
      true,
      "route-focused graph expansion should explain which focus target seeded the graph",
    );
    assert.equal(
      Array.isArray(routeOnlySeedSources) &&
        routeOnlySeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_route" &&
          source.term === "/api/auth/callback"
        ),
      true,
      "route-focused graph expansion should retain focusRoutes provenance",
    );
    assert.equal(
      routeOnlyGraphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.metadata?.graphRankMode === "personalized"
      ) ||
        (Array.isArray(routeOnlyTypeCandidate?.metadata?.supportingSignals) &&
          routeOnlyTypeCandidate.metadata.supportingSignals.some((signal) =>
            typeof signal === "object" &&
            signal != null &&
            !Array.isArray(signal) &&
            signal.source === "repo_map_provider" &&
            typeof signal.metadata === "object" &&
            signal.metadata != null &&
            !Array.isArray(signal.metadata) &&
            signal.metadata.graphRankMode === "personalized" &&
            signal.metadata.graphRankDirection === "bidirectional" &&
            signal.metadata.focusRelation === "dependency" &&
            signal.metadata.dependencyDistance === 2
          )),
      true,
      "focusRoutes alone should personalize PageRank around the route handler file",
    );

    const symbolOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect session type dependency graph",
        focusSymbols: ["getSession"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const symbolOnlyRepoMap = symbolOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (symbolOnlyRepoMap?.suggestedArgs as { focusSymbols?: unknown } | undefined)?.focusSymbols,
      ["getSession"],
      "repo_map suggestedArgs should preserve focusSymbols anchors",
    );
    const symbolOnlyGraphContext = [...symbolOnlyGraphPacket.primaryContext, ...symbolOnlyGraphPacket.relatedContext];
    const symbolOnlyTypeCandidate = symbolOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.ok(
      symbolOnlyTypeCandidate,
      `focusSymbols alone should seed import graph expansion from the symbol file; got ${JSON.stringify(
        symbolOnlyGraphContext.map((candidate) => ({
          path: candidate.path,
          source: candidate.source,
          strategy: candidate.strategy,
          metadata: candidate.metadata,
        })).slice(0, 12),
      )}`,
    );
    assert.equal(
      symbolOnlyTypeCandidate?.metadata?.graphDepth,
      1,
      "focusSymbols alone should report the import graph depth from the symbol file",
    );
    assert.deepEqual(
      symbolOnlyTypeCandidate?.metadata?.graphPath,
      ["lib/auth/session.ts", "types/auth.ts"],
      "symbol-focused graph expansion should preserve the symbol owner path",
    );
    const symbolSeedSources = symbolOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(symbolSeedSources) &&
        symbolSeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_symbol" &&
          source.term === "getSession" &&
          source.symbolName === "getSession"
        ),
      true,
      "symbol-focused graph expansion should retain focusSymbols provenance",
    );

    const schemaOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect user profile type dependency graph",
        focusDatabaseObjects: ["public.user_profiles"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const schemaOnlyRepoMap = schemaOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (schemaOnlyRepoMap?.suggestedArgs as { focusDatabaseObjects?: unknown } | undefined)?.focusDatabaseObjects,
      ["public.user_profiles"],
      "repo_map suggestedArgs should preserve focusDatabaseObjects anchors",
    );
    const schemaOnlyGraphContext = [...schemaOnlyGraphPacket.primaryContext, ...schemaOnlyGraphPacket.relatedContext];
    const schemaOnlyTypeCandidate = schemaOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.equal(
      schemaOnlyTypeCandidate?.metadata?.graphDepth,
      1,
      "focusDatabaseObjects alone should seed import graph expansion from schema usage files",
    );
    const schemaSeedSources = schemaOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(schemaSeedSources) &&
        schemaSeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_database_object" &&
          source.term === "public.user_profiles" &&
          source.databaseObjectName === "public.user_profiles" &&
          source.usageKind === "read"
        ),
      true,
      "schema-focused graph expansion should retain focusDatabaseObjects provenance",
    );

    const unresolvedFocusPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect missing graph anchors",
        focusFiles: ["missing/file.ts"],
        focusRoutes: ["/api/not-real"],
        focusSymbols: ["missingSymbolForGraphSeed"],
        focusDatabaseObjects: ["public.missing_table"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(unresolvedFocusPacket, "unresolved focus packet");
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus file is not indexed") && warning.includes("missing/file.ts")
      ),
      "missing focusFiles should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus route did not resolve") && warning.includes("/api/not-real")
      ),
      "missing focusRoutes should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus symbol did not resolve") && warning.includes("missingSymbolForGraphSeed")
      ),
      "missing focusSymbols should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus database object did not resolve") && warning.includes("public.missing_table")
      ),
      "missing focusDatabaseObjects should produce an unresolved graph seed warning",
    );
    assert.equal(unresolvedFocusPacket.requestCoverage.status, "missing");
    assert.equal(unresolvedFocusPacket.requestCoverage.coveredCount, 0);
    assert.equal(unresolvedFocusPacket.evidenceQuality.label, "weak");
    assert.equal(unresolvedFocusPacket.evidenceQuality.requestCoverage.status, "missing");
    assert.equal(unresolvedFocusPacket.evidenceQuality.requestCoverage.unresolvedCount, 4);
    assert.ok(
      unresolvedFocusPacket.evidenceQuality.reasons.some((reason) =>
        reason.includes("4/4 requested anchor(s) are uncovered or unchecked")
      ),
      "evidence quality should explain unresolved requested anchors",
    );
    assert.ok(
      unresolvedFocusPacket.evidenceQuality.recommendedAction.includes("Do not rely"),
      "evidence quality should steer agents away from broad fallback context when anchors miss",
    );
    for (const [kind, value] of [
      ["file", "missing/file.ts"],
      ["route", "/api/not-real"],
      ["symbol", "missingSymbolForGraphSeed"],
      ["database_object", "public.missing_table"],
    ] as const) {
      assert.ok(
        unresolvedFocusPacket.requestCoverage.items.some((item) =>
          item.kind === kind &&
          item.value === value &&
          item.status === "uncovered"
        ),
        `request coverage should report unresolved ${kind} anchor ${value}`,
      );
    }
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { term?: unknown };
        return tool.toolName === "cross_search" &&
          args.term === "missing/file.ts" &&
          tool.reason.includes("not covered");
      }),
      "uncovered file anchors should suggest cross_search with the missing path",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { route?: unknown };
        return tool.toolName === "route_context" &&
          args.route === "/api/not-real" &&
          tool.reason.includes("not covered");
      }),
      "uncovered route anchors should suggest route_context with the missing route",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { query?: unknown; targetKind?: unknown };
        return tool.toolName === "reef_where_used" &&
          args.query === "missingSymbolForGraphSeed" &&
          args.targetKind === "symbol";
      }),
      "uncovered symbol anchors should suggest reef_where_used with targetKind=symbol",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { schemaName?: unknown; tableName?: unknown };
        return tool.toolName === "table_neighborhood" &&
          args.schemaName === "public" &&
          args.tableName === "missing_table" &&
          tool.reason.includes("not covered");
      }),
      "uncovered database anchors should suggest table_neighborhood with parsed schema/table args",
    );
    assert.equal(
      unresolvedFocusPacket.expandableTools.some((tool) =>
        (tool.toolName === "imports_deps" || tool.toolName === "imports_impact") &&
        (tool.suggestedArgs as { file?: unknown }).file === "missing/file.ts"
      ),
      false,
      "unresolved focus files should not produce imports_deps/imports_impact follow-ups against missing paths",
    );
    const unresolvedRepoMapCandidates = [
      ...unresolvedFocusPacket.primaryContext,
      ...unresolvedFocusPacket.relatedContext,
    ].filter((candidate) => candidate.source === "repo_map_provider");
    assert.ok(
      unresolvedRepoMapCandidates.length > 0,
      "unresolved graph anchors should still allow broad repo map fallback context",
    );
    assert.equal(
      unresolvedRepoMapCandidates.every((candidate) =>
        candidate.metadata?.graphRankMode === "global" &&
        candidate.metadata?.graphPersonalizationSeedCount === 0
      ),
      true,
      "unresolved graph anchors should not be reported as personalized repo map seeds",
    );

    const dashboardPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "review dashboard auth role checks",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeRisks: true,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.ok(
      dashboardPacket.risks.some((risk) =>
        risk.source === "open_loop" &&
        risk.code === "identity.boundary_mismatch" &&
        risk.reason.includes("app/dashboard/layout.tsx")
      ),
      "context_packet risks should include relevant active Reef findings",
    );
    assert.equal(
      dashboardPacket.limits.providersRun.includes("repo_map_provider"),
      false,
      "focused non-graph review packets should skip broad repo-map ranking",
    );
    assert.ok(
      dashboardPacket.limits.providersSkipped.includes("repo_map_provider"),
      "focused non-graph review packets should report repo_map_provider as skipped",
    );
    assert.ok(
      dashboardPacket.retrievalDiagnostics.providersSkippedDetail.some((detail) =>
        detail.provider === "repo_map_provider" &&
        detail.adaptive &&
        detail.reason.includes("focus/changed file anchors")
      ),
      "retrieval diagnostics should explain focused-file repo-map pruning",
    );
    assert.ok(
      dashboardPacket.retrievalDiagnostics.adaptiveSkippedProviders.includes("repo_map_provider"),
      "retrieval diagnostics should summarize focused-file repo-map pruning as adaptive",
    );
    const confidenceFilteredRiskPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "review dashboard auth role checks",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeRisks: true,
        risksMinConfidence: 0.93,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.ok(
      confidenceFilteredRiskPacket.risks.length > 0,
      "high-confidence risks should still be returned",
    );
    assert.ok(
      confidenceFilteredRiskPacket.risks.every((risk) => risk.confidence >= 0.93),
      "risksMinConfidence should filter lower-confidence risk noise",
    );
    assert.ok(
      confidenceFilteredRiskPacket.risks.some((risk) => risk.source === "open_loop"),
      "high-confidence open-loop risks should survive the confidence floor",
    );

    const implementPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "implement",
        request: "implement the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(implementPacket, "implement packet");
    assert.equal(implementPacket.mode, "implement");
    assert.ok(implementPacket.limits.providersSkipped.includes("repo_map_provider"));
    assert.equal(implementPacket.limits.providersRun.includes("repo_map_provider"), false);
    const implementToolNames = implementPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      implementToolNames.includes("lint_files"),
      "implement mode should recommend lint_files",
    );
    assert.ok(
      implementToolNames.includes("ast_find_pattern"),
      "implement mode should recommend ast_find_pattern",
    );
    assert.equal(
      implementToolNames.includes("route_context"),
      false,
      "implement mode should not recommend route_context without a route anchor",
    );
    assert.equal(
      implementToolNames.includes("table_neighborhood"),
      false,
      "implement mode should not recommend table_neighborhood without a table anchor",
    );
    assert.equal(
      implementToolNames.includes("repo_map"),
      false,
      "implement mode should not recommend repo_map",
    );
    const implementAstFindPattern = implementPacket.expandableTools.find((tool) => tool.toolName === "ast_find_pattern");
    assert.deepEqual(
      implementAstFindPattern?.suggestedArgs,
      {
        projectId,
        pattern: "implement the auth callback user type fix",
        maxMatches: 50,
      },
      "ast_find_pattern suggestedArgs should match the strict schema",
    );
    const implementLintFiles = implementPacket.expandableTools.find((tool) => tool.toolName === "lint_files");
    assert.deepEqual(
      implementLintFiles?.suggestedArgs,
      {
        projectId,
        files: ["app/api/auth/callback/route.ts"],
      },
      "lint_files suggestedArgs should include required files",
    );

    const planPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "plan",
        request: "plan the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
        focusRoutes: ["/api/auth/callback"],
        focusDatabaseObjects: ["public.user_profiles"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(planPacket, "plan packet");
    const planToolNames = planPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(planToolNames.includes("change_plan"), "plan mode should recommend change_plan");
    assert.ok(planToolNames.includes("route_context"), "plan mode should recommend route_context");
    assert.ok(
      planToolNames.includes("table_neighborhood"),
      "plan mode should recommend table_neighborhood",
    );
    const planChangePlan = planPacket.expandableTools.find((tool) => tool.toolName === "change_plan");
    assert.deepEqual(
      planChangePlan?.suggestedArgs,
      {
        projectId,
        startEntity: { kind: "file", key: "app/api/auth/callback/route.ts" },
        targetEntity: { kind: "route", key: "/api/auth/callback" },
        direction: "both",
        traversalDepth: 3,
        includeHeuristicEdges: true,
      },
      "change_plan suggestedArgs should provide strict graph node locators",
    );
    const planRouteContext = planPacket.expandableTools.find((tool) => tool.toolName === "route_context");
    assert.ok(planRouteContext, "plan mode should attach a route_context entry");
    assert.equal(
      (planRouteContext?.suggestedArgs as { route?: unknown } | undefined)?.route,
      "/api/auth/callback",
      "route_context suggestedArgs should reflect focusRoutes",
    );
    assert.ok(
      planPacket.requestCoverage.items.some((item) =>
        item.kind === "route" &&
        item.value === "/api/auth/callback" &&
        item.status === "covered" &&
        item.matchedBy.some((ref) => ref.includes("GET /api/auth/callback") || ref.includes("/api/auth/callback"))
      ),
      "route request coverage should treat method-qualified route evidence as covering the exact route path",
    );
    const planTableNeighborhood = planPacket.expandableTools.find((tool) => tool.toolName === "table_neighborhood");
    assert.deepEqual(
      planTableNeighborhood?.suggestedArgs,
      {
        projectId,
        schemaName: "public",
        tableName: "user_profiles",
      },
      "table_neighborhood suggestedArgs should include required schema/table inputs",
    );

    const omittedAnchorPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "plan",
        request: "plan getSession, the auth callback route, and the user profile table together",
        focusSymbols: ["getSession"],
        focusRoutes: ["/api/auth/callback"],
        focusDatabaseObjects: ["public.user_profiles"],
        maxPrimaryContext: 1,
        maxRelatedContext: 1,
        budgetTokens: 1_000,
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    ContextPacketToolOutputSchema.parse(omittedAnchorPacket);
    assertExpandableToolsHaveValidArgs(omittedAnchorPacket, "omitted anchor packet");
    assert.ok(
      omittedAnchorPacket.limits.omittedRequestedAnchors.some((anchor) =>
        anchor.kind === "database_object" &&
        anchor.value === "public.user_profiles" &&
        anchor.reason === "selection_limit"
      ),
      "tight packets should report requested anchors that were ranked but omitted by selection limits",
    );
    const omittedTableNeighborhood = omittedAnchorPacket.expandableTools.find((tool) => {
      const args = tool.suggestedArgs as { schemaName?: unknown; tableName?: unknown; maxPerSection?: unknown };
      return tool.toolName === "table_neighborhood" &&
        args.schemaName === "public" &&
        args.tableName === "user_profiles" &&
        args.maxPerSection === 20 &&
        tool.reason.includes("ranked but omitted");
    });
    assert.ok(
      omittedTableNeighborhood,
      "ranked-but-omitted database anchors should get a concrete table_neighborhood follow-up",
    );
    const omittedAnchorGap = omittedAnchorPacket.retrievalDiagnostics.retrievalPlan.evidenceGaps.find((gap) =>
      gap.kind === "context_budget" &&
      gap.severity === "blocking" &&
      gap.message.includes("public.user_profiles")
    );
    assert.ok(
      omittedAnchorGap,
      "retrieval diagnostics should name the exact requested anchor omitted from returned context",
    );
    assert.deepEqual(
      omittedAnchorGap?.anchors?.map((anchor) => ({
        kind: anchor.kind,
        value: anchor.value,
        reason: anchor.reason,
      })),
      [{
        kind: "database_object",
        value: "public.user_profiles",
        reason: "selection_limit",
      }],
      "omitted-anchor evidence gaps should carry machine-readable anchor details",
    );
    assert.ok(
      omittedAnchorPacket.retrievalDiagnostics.retrievalPlan.recommendedTools.includes("table_neighborhood"),
      "retrieval plan should recommend the anchor-specific omitted table follow-up",
    );
    assert.ok(
      omittedAnchorPacket.retrievalDiagnostics.retrievalPlan.recommendedFollowUps.some((tool) => {
        const args = tool.suggestedArgs as { schemaName?: unknown; tableName?: unknown; maxPerSection?: unknown };
        return tool.toolName === "table_neighborhood" &&
          args.schemaName === "public" &&
          args.tableName === "user_profiles" &&
          args.maxPerSection === 20;
      }),
      "retrieval plan should expose the omitted-anchor table_neighborhood follow-up as executable",
    );
    assert.ok(
      batchExpansionOps(omittedAnchorPacket, "omitted anchor packet").some((op) => {
        const args = op.args as { schemaName?: unknown; tableName?: unknown; maxPerSection?: unknown } | undefined;
        return op.tool === "table_neighborhood" &&
          args?.schemaName === "public" &&
          args.tableName === "user_profiles" &&
          args.maxPerSection === 20;
      }),
      "generated tool_batch should preserve the omitted-anchor table_neighborhood expansion",
    );

    const routePrefixPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "plan",
        request: "plan the auth callback route prefix",
        focusRoutes: ["/api/auth"],
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.ok(
      routePrefixPacket.routes.some((route) => route.routeKey === "GET /api/auth/callback"),
      "prefix packet fixture should include a neighboring concrete route candidate",
    );
    assert.ok(
      routePrefixPacket.requestCoverage.items.some((item) =>
        item.kind === "route" &&
        item.value === "/api/auth" &&
        item.status === "uncovered"
      ),
      "route request coverage should not treat neighboring route prefixes as covered",
    );
    assert.ok(
      routePrefixPacket.expandableTools.some((tool) =>
        tool.toolName === "route_context" &&
        (tool.suggestedArgs as { route?: unknown }).route === "/api/auth" &&
        tool.reason.includes("not covered")
      ),
      "uncovered route prefixes should keep an explicit route_context follow-up",
    );

    const reviewPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "review",
        request: "review the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(reviewPacket, "review packet");
    const reviewToolNames = reviewPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      reviewToolNames.includes("verification_state"),
      "review mode should recommend verification_state",
    );
    assert.ok(reviewToolNames.includes("lint_files"), "review mode should recommend lint_files");
    assert.equal(
      reviewToolNames.includes("ast_find_pattern"),
      false,
      "review mode should not recommend ast_find_pattern",
    );
    assert.equal(
      batchExpansionOps(reviewPacket, "review packet").some((op) => op.tool === "lint_files"),
      false,
      "review batch should not include mutation-oriented lint_files follow-ups",
    );

    const coercedAuthPath = await invokeTool(
      "auth_path",
      JSON.stringify({
        projectId,
        route: "/api/auth/callback",
      }),
      { hotIndexCache, requestContext: { requestId: "req_auth_path_coerced_smoke" } },
    ) as AuthPathToolOutput;
    assert.equal(coercedAuthPath.toolName, "auth_path");
    assert.equal(coercedAuthPath.projectId, projectId);
    assert.equal(coercedAuthPath.matched, true);

    const missingAuthPath = await invokeTool(
      "auth_path",
      {
        projectId,
        route: "/api/does-not-exist",
      },
      { hotIndexCache, requestContext: { requestId: "req_auth_path_fallback_smoke" } },
    ) as AuthPathToolOutput;
    assert.equal(missingAuthPath.toolName, "auth_path");
    assert.equal(missingAuthPath.matched, false);
    assert.match(missingAuthPath.reason ?? "", /No indexed match found/);
    assert.equal(missingAuthPath.fallbackReason, missingAuthPath.reason);
    assert.equal(missingAuthPath.suggestedNext?.tool, "cross_search");
    assert.equal(missingAuthPath.suggestedNext?.args.term, "/api/does-not-exist");

    const coercedTransportPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is getSession used by the auth callback?",
        focusSymbols: JSON.stringify(["getSession"]),
        focusRoutes: JSON.stringify(["/api/auth/callback"]),
        focusDatabaseObjects: JSON.stringify(["public.user_profiles"]),
        maxPrimaryContext: "5",
        maxRelatedContext: "3",
        budgetTokens: "1024",
        includeRisks: "false",
      },
      { hotIndexCache, requestContext: { requestId: "req_context_packet_coerced_smoke" } },
    ) as ContextPacketToolOutput;
    assert.equal(coercedTransportPacket.toolName, "context_packet");
    assert.equal(coercedTransportPacket.modePolicy.includeRisks, false);
    assert.ok(coercedTransportPacket.limits.budgetTokens <= 1024);
    assert.ok(coercedTransportPacket.primaryContext.length <= 5);

    await invokeTool(
      "context_packet",
      { projectId, request: "where is the login button?" },
      { hotIndexCache },
    );
    assert.equal(hotIndexCache.size(), 1, "second call should reuse the hot index for same run");

    process.env.MAKO_REEF_BACKED = "legacy";
    try {
      const legacyPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "my auth route is broken after changing the user type",
          focusFiles: ["app/api/auth/callback/route.ts"],
        },
        { hotIndexCache },
      ) as ContextPacketToolOutput;
      assert.equal(legacyPacket.activeFindings.length, 0);
      assert.ok(legacyPacket.warnings.some((warning) => warning.includes("MAKO_REEF_BACKED")));
    } finally {
      restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    }

    const restartedHotIndexCache = createHotIndexCache();
    try {
      const restartedPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "my auth route is broken after restart",
          focusFiles: ["app/api/auth/callback/route.ts"],
        },
        { hotIndexCache: restartedHotIndexCache },
      ) as ContextPacketToolOutput;
      assert.ok(restartedPacket.limits.providersRun.includes("hot_hint_index"));
      assert.equal(
        restartedHotIndexCache.size(),
        1,
        "fresh hot-index cache should rebuild from durable indexed facts",
      );
    } finally {
      restartedHotIndexCache.flush();
    }

    await invokeTool(
      "working_tree_overlay",
      { projectId, files: ["components/LoginButton.tsx"] },
      { hotIndexCache },
    );
    const overlayPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "the login button changed",
        changedFiles: ["components/LoginButton.tsx"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(overlayPacket, "overlay packet");
    const overlayCandidate = [...overlayPacket.primaryContext, ...overlayPacket.relatedContext]
      .find((candidate) => candidate.path === "components/LoginButton.tsx");
    assert.equal(overlayCandidate?.metadata?.overlay, "working_tree");
    assert.equal(overlayCandidate?.metadata?.overlaySource, "working_tree_overlay");
    assert.ok(overlayPacket.limits.providersRun.includes("working_tree_overlay"));

    const fallbackPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "auth route changed",
        changedFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(fallbackPacket, "overlay fallback packet");
    assert.ok(
      fallbackPacket.warnings.some((warning) => warning.includes("no working-tree overlay facts")),
      "changed files without overlay facts should be called out",
    );
    assert.notEqual(
      fallbackPacket.evidenceQuality.label,
      "strong",
      "changed files without overlay facts should not be marked strong evidence",
    );
    assert.ok(
      fallbackPacket.evidenceQuality.reasons.some((reason) => reason.includes("lack working-tree overlay facts")),
      "evidence quality should explain missing overlay facts",
    );
    assert.ok(
      fallbackPacket.expandableTools.some((tool) => tool.toolName === "working_tree_overlay" && tool.readOnly === false),
      "context_packet should recommend the overlay mutation without running it",
    );
    assert.equal(
      batchExpansionOps(fallbackPacket, "overlay fallback packet").some((op) => op.tool === "working_tree_overlay"),
      false,
      "overlay fallback batch should not include mutation-oriented working_tree_overlay follow-ups",
    );

    writeFixtureFile(
      projectRoot,
      "app/dashboard/admin/endorsements/create/client-page.tsx",
      [
        "export function AdminEndorsementRenamedPage() {",
        "  const roleCheck = 'admin endorsement create duplicate role check';",
        "  return <section>{roleCheck}</section>;",
        "}",
      ].join("\n"),
    );
    const staleSymbolPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect AdminEndorsementCreatePage current file after rename",
        focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        focusSymbols: ["AdminEndorsementCreatePage"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(staleSymbolPacket, "stale symbol packet");
    assert.ok(
      staleSymbolPacket.retrievalDiagnostics.liveTextMisses.some((miss) =>
        miss.query === "AdminEndorsementCreatePage" &&
        miss.queryKind === "symbol" &&
        miss.scope === "file" &&
        miss.scopePath === "app/dashboard/admin/endorsements/create/client-page.tsx"
      ),
      "retrieval diagnostics should report scoped current-file misses for requested symbols",
    );
    assert.ok(
      staleSymbolPacket.requestCoverage.items.some((item) =>
        item.kind === "symbol" &&
        item.value === "AdminEndorsementCreatePage" &&
        item.status === "uncovered" &&
        item.matchedBy.length === 0
      ),
      "current-disk symbol misses should prevent stale indexed symbol matches from satisfying request coverage",
    );
    assert.ok(
      staleSymbolPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("Focused symbol was not found in scoped current files")
      ),
      "retrieval diagnostics should recommend rename/deletion checks for scoped symbol misses",
    );
    assert.ok(
      staleSymbolPacket.retrievalDiagnostics.retrievalPlan.evidenceGaps.some((gap) =>
        gap.message.includes("requested symbol") &&
        gap.message.includes("scoped current files")
      ),
      "retrieval-plan evidence gaps should distinguish scoped symbol misses from quoted literal misses",
    );

    writeFixtureFile(
      projectRoot,
      "lib/auth/session.ts",
      [
        "import type { UserSession } from '../../types/auth';",
        "export async function getSession(): Promise<UserSession> {",
        "  return { user: { id: 'u2', role: 'manager', stale: true } };",
        "}",
      ].join("\n"),
    );
    const stalePacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "auth session stale index check",
        focusFiles: ["lib/auth/session.ts"],
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(stalePacket, "stale packet");
    assert.equal(stalePacket.indexFreshness?.state, "dirty");
    assert.equal(stalePacket.evidenceQuality.freshness.indexState, "dirty");
    assert.ok(
      stalePacket.evidenceQuality.staleContextCount > 0,
      "stale context should be counted in evidence quality",
    );
    assert.notEqual(
      stalePacket.evidenceQuality.label,
      "strong",
      "stale indexed context should not be marked strong evidence",
    );
    assert.ok(
      stalePacket.evidenceQuality.reasons.some((reason) => reason.includes("Indexed evidence freshness is dirty")),
      "evidence quality should explain stale indexed freshness",
    );
    assert.ok(
      stalePacket.warnings.some((warning) => warning.includes("stale, deleted, unindexed, or unknown")),
      "stale indexed files should still produce the existing warning",
    );

    const store = openProjectStore({ projectRoot });
    try {
      const events = store.queryUsefulnessEvents({
        decisionKind: "packet_usefulness",
        family: "context_packet",
      });
      assert.ok(events.length >= 1, "context_packet should emit packet usefulness telemetry");
      assert.equal(events.some((event) => event.requestId === "req_context_packet_smoke"), true);
      const primaryEvent = events.find((event) => event.requestId === "req_context_packet_smoke");
      assert.ok(primaryEvent, "primary context_packet telemetry event should be queryable by requestId");
      assert.ok(
        primaryEvent.reasonCodes.includes("retrieval_level_issue_to_edit_localization"),
        "context_packet telemetry should include retrieval-plan level",
      );
      assert.ok(
        primaryEvent.reasonCodes.includes("retrieval_strategy_entity_lookup"),
        "context_packet telemetry should include retrieval-plan strategy",
      );
      assert.ok(
        primaryEvent.reasonCodes.includes("evidence_gate_follow_up_recommended"),
        "context_packet telemetry should include evidence-gate status",
      );
      assert.ok(
        primaryEvent.reasonCodes.includes("recommended_followups_available"),
        "context_packet telemetry should indicate executable follow-ups were available",
      );
      assert.ok(
        primaryEvent.reasonCodes.includes("evidence_gap_edit_localization_advisory"),
        "context_packet telemetry should include retrieval evidence-gap reason codes",
      );
      assert.ok(
        primaryEvent.reason?.includes("retrieval gate follow_up_recommended"),
        "context_packet telemetry reason should summarize retrieval gate state",
      );
    } finally {
      store.close();
    }

    console.log("context-packet: PASS");
  } finally {
    hotIndexCache.flush();
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
    restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
