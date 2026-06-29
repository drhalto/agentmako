import { randomUUID } from "node:crypto";
import type {
  JsonObject,
  JsonValue,
  ToolBatchInput,
  ToolBatchResult,
  ToolBatchToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

function asJsonObject(value: unknown): JsonObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonValues(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value as JsonValue[] : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function countSummary(value: unknown): JsonObject {
  return { count: jsonArray(value).length };
}

function compactReefFeatureFlowSummary(value: Record<string, unknown>): JsonObject {
  const files = jsonArray(value.files).map(jsonRecord).filter((file): file is Record<string, unknown> => Boolean(file));
  const routes = jsonArray(value.routes).map(jsonRecord).filter((route): route is Record<string, unknown> => Boolean(route));
  const databaseObjects = jsonArray(value.databaseObjects).map(jsonRecord).filter((object): object is Record<string, unknown> => Boolean(object));
  const findings = jsonArray(value.findings).map(jsonRecord).filter((finding): finding is Record<string, unknown> => Boolean(finding));
  const links = jsonArray(value.links).map(jsonRecord).filter((link): link is Record<string, unknown> => Boolean(link));
  const coverage = jsonRecord(value.coverage);

  return {
    seedCount: numberValue(value.seedCount) ?? 0,
    fileCount: numberValue(value.fileCount) ?? 0,
    routeCount: numberValue(value.routeCount) ?? 0,
    databaseObjectCount: numberValue(value.databaseObjectCount) ?? 0,
    findingCount: numberValue(value.findingCount) ?? 0,
    linkCount: numberValue(value.linkCount) ?? 0,
    files: files.slice(0, 5).map((file) => ({
      filePath: stringValue(file.filePath) ?? "",
      role: stringValue(file.role) ?? "",
      score: numberValue(file.score) ?? 0,
      reasons: jsonValues(file.reasons).slice(0, 5),
      routeCount: numberValue(file.routeCount) ?? 0,
      outboundImportCount: numberValue(file.outboundImportCount) ?? 0,
      inboundImportCount: numberValue(file.inboundImportCount) ?? 0,
      schemaUsageCount: numberValue(file.schemaUsageCount) ?? 0,
      findingCount: numberValue(file.findingCount) ?? 0,
    })),
    routes: routes.slice(0, 5).map((route) => {
      const out: JsonObject = {
        routeKey: stringValue(route.routeKey) ?? "",
        filePath: stringValue(route.filePath) ?? "",
        pattern: stringValue(route.pattern) ?? "",
        isApi: booleanValue(route.isApi) ?? false,
      };
      const method = stringValue(route.method);
      if (method) out.method = method;
      return out;
    }),
    databaseObjects: databaseObjects.slice(0, 5).map((object) => {
      const out: JsonObject = {
        kind: stringValue(object.kind) ?? "",
        objectName: stringValue(object.objectName) ?? "",
        fileCount: numberValue(object.fileCount) ?? 0,
        reasons: jsonValues(object.reasons).slice(0, 5),
      };
      const schemaName = stringValue(object.schemaName);
      if (schemaName) out.schemaName = schemaName;
      const tableName = stringValue(object.tableName);
      if (tableName) out.tableName = tableName;
      const freshness = jsonRecord(object.freshness);
      const freshnessState = stringValue(freshness?.state);
      if (freshnessState) out.freshness = { state: freshnessState };
      return out;
    }),
    findings: findings.slice(0, 5).map((finding) => {
      const out: JsonObject = {
        source: stringValue(finding.source) ?? "",
        severity: stringValue(finding.severity) ?? "",
        message: stringValue(finding.message) ?? "",
      };
      const ruleId = stringValue(finding.ruleId);
      if (ruleId) out.ruleId = ruleId;
      const filePath = stringValue(finding.filePath);
      if (filePath) out.filePath = filePath;
      const line = numberValue(finding.line);
      if (line != null) out.line = line;
      return out;
    }),
    links: links.slice(0, 5).map((link) => ({
      from: stringValue(link.from) ?? "",
      to: stringValue(link.to) ?? "",
      kind: stringValue(link.kind) ?? "",
      confidence: numberValue(link.confidence) ?? 0,
      reason: stringValue(link.reason) ?? "",
    })),
    coverage: {
      importDepth: numberValue(coverage?.importDepth) ?? 0,
      seedKinds: jsonValues(coverage?.seedKinds),
      databaseEvidenceKinds: jsonValues(coverage?.databaseEvidenceKinds),
      findingCount: numberValue(coverage?.findingCount) ?? 0,
      staleDatabaseObjectCount: numberValue(coverage?.staleDatabaseObjectCount) ?? 0,
    },
    truncated: booleanValue(value.truncated) ?? false,
    warnings: jsonValues(value.warnings),
  } satisfies JsonObject;
}

function compactReefCalculation(value: unknown): JsonObject | undefined {
  const calculation = jsonRecord(value);
  if (!calculation) return undefined;
  return {
    nodeId: stringValue(calculation.nodeId) ?? "",
    queryKind: stringValue(calculation.queryKind) ?? "",
    lane: stringValue(calculation.lane) ?? "",
    status: stringValue(calculation.status) ?? "",
    returnedCount: numberValue(calculation.returnedCount) ?? 0,
    reason: stringValue(calculation.reason) ?? "",
  };
}

function compactReefAskSummary(value: JsonObject): JsonObject | undefined {
  if (value.toolName !== "reef_ask") {
    return undefined;
  }

  const answer = jsonRecord(value.answer);
  const queryPlan = jsonRecord(value.queryPlan);
  const evidence = jsonRecord(value.evidence);
  const freshness = jsonRecord(value.freshness);
  const limits = jsonRecord(value.limits);
  const decisionTrace = jsonRecord(answer?.decisionTrace);
  const diagnosticSummary = jsonRecord(answer?.diagnosticSummary);
  const inventorySummary = jsonRecord(answer?.inventorySummary);
  const databaseObjectSummary = jsonRecord(answer?.databaseObjectSummary);
  const findingsSummary = jsonRecord(answer?.findingsSummary);
  const literalMatchesSummary = jsonRecord(answer?.literalMatchesSummary);
  const whereUsedSummary = jsonRecord(answer?.whereUsedSummary);
  const featureFlowSummary = jsonRecord(answer?.featureFlowSummary);

  const summary: JsonObject = {
    toolName: "reef_ask",
    question: stringValue(value.question) ?? "",
    answer: {
      summary: stringValue(answer?.summary) ?? "",
      confidence: stringValue(answer?.confidence) ?? "low",
      confidenceReasons: jsonArray(answer?.confidenceReasons).filter((item): item is string => typeof item === "string"),
      ...(diagnosticSummary
        ? {
            diagnostic: {
              gate: stringValue(diagnosticSummary.gate) ?? "unknown",
              canClaimVerified: booleanValue(diagnosticSummary.canClaimVerified) ?? false,
              verificationStatus: stringValue(diagnosticSummary.verificationStatus) ?? "unknown",
              blockerCount: numberValue(diagnosticSummary.blockerCount) ?? 0,
              changedFileCount: numberValue(diagnosticSummary.changedFileCount) ?? 0,
              openLoopCounts: asJsonObject(diagnosticSummary.openLoopCounts) ?? {},
              sourceCounts: asJsonObject(diagnosticSummary.sourceCounts) ?? {},
            },
          }
        : {}),
      ...(inventorySummary
        ? {
            inventory: {
              total: numberValue(inventorySummary.total) ?? 0,
              byKind: asJsonObject(inventorySummary.byKind) ?? {},
              staleCount: numberValue(inventorySummary.staleCount) ?? 0,
              truncated: booleanValue(inventorySummary.truncated) ?? false,
            },
          }
        : {}),
      ...(databaseObjectSummary
        ? {
            databaseObject: {
              schemaName: stringValue(databaseObjectSummary.schemaName) ?? "",
              objectName: stringValue(databaseObjectSummary.objectName) ?? "",
              factCount: numberValue(databaseObjectSummary.factCount) ?? 0,
              staleCount: numberValue(databaseObjectSummary.staleCount) ?? 0,
              columns: countSummary(databaseObjectSummary.columns),
              indexes: countSummary(databaseObjectSummary.indexes),
              foreignKeys: countSummary(databaseObjectSummary.foreignKeys),
              rlsPolicies: countSummary(databaseObjectSummary.rlsPolicies),
              triggers: countSummary(databaseObjectSummary.triggers),
              usages: countSummary(databaseObjectSummary.usages),
              truncated: booleanValue(databaseObjectSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(findingsSummary
        ? {
            findings: {
              total: numberValue(findingsSummary.total) ?? 0,
              bySeverity: asJsonObject(findingsSummary.bySeverity) ?? {},
              bySource: asJsonObject(findingsSummary.bySource) ?? {},
              staleCount: numberValue(findingsSummary.staleCount) ?? 0,
              truncated: booleanValue(findingsSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(literalMatchesSummary
        ? {
            literalMatches: {
              query: stringValue(literalMatchesSummary.query) ?? "",
              totalMatches: numberValue(literalMatchesSummary.totalMatches) ?? 0,
              fileCount: numberValue(literalMatchesSummary.fileCount) ?? 0,
              files: countSummary(literalMatchesSummary.files),
              truncated: booleanValue(literalMatchesSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(whereUsedSummary
        ? {
            whereUsed: {
              query: stringValue(whereUsedSummary.query) ?? "",
              targetKind: stringValue(whereUsedSummary.targetKind) ?? "",
              definitionCount: numberValue(whereUsedSummary.definitionCount) ?? 0,
              usageCount: numberValue(whereUsedSummary.usageCount) ?? 0,
              relatedFindingCount: numberValue(whereUsedSummary.relatedFindingCount) ?? 0,
              byUsageKind: asJsonObject(whereUsedSummary.byUsageKind) ?? {},
              truncated: booleanValue(whereUsedSummary.truncated) ?? false,
            },
          }
        : {}),
      ...(featureFlowSummary
        ? { featureFlow: compactReefFeatureFlowSummary(featureFlowSummary) }
        : {}),
      ...(decisionTrace
        ? {
            decisionTrace: {
              entries: jsonArray(decisionTrace.entries)
                .map(jsonRecord)
                .filter((entry): entry is Record<string, unknown> => Boolean(entry))
                .map((entry) => ({
                  lane: stringValue(entry.lane) ?? "",
                  status: stringValue(entry.status) ?? "",
                  evidenceCount: numberValue(entry.evidenceCount) ?? 0,
                  ...(stringValue(entry.fallback) ? { fallback: stringValue(entry.fallback) } : {}),
                })),
              lowConfidenceFallbacks: jsonValues(decisionTrace.lowConfidenceFallbacks),
            },
          }
        : {}),
      nextQueries: jsonValues(answer?.nextQueries),
      suggestedNextActions: jsonValues(answer?.suggestedNextActions),
    },
    queryPlan: {
      mode: stringValue(queryPlan?.mode) ?? "",
      intent: stringValue(queryPlan?.intent) ?? "",
      evidenceLanes: jsonValues(queryPlan?.evidenceLanes),
      ...(queryPlan?.engineSteps
        ? {
            engineSteps: jsonArray(queryPlan.engineSteps)
              .map(jsonRecord)
              .filter((step): step is Record<string, unknown> => Boolean(step))
              .map((step) => ({
                name: stringValue(step.name) ?? "",
                status: stringValue(step.status) ?? "",
                returnedCount: numberValue(step.returnedCount) ?? 0,
              })),
          }
        : {}),
      ...(queryPlan?.calculations
        ? {
            calculations: jsonArray(queryPlan.calculations)
              .map(compactReefCalculation)
              .filter((calculation): calculation is JsonObject => Boolean(calculation))
              .slice(0, 12),
          }
        : {}),
    },
    freshness: (freshness as JsonObject | undefined) ?? {},
    evidence: {
      mode: stringValue(evidence?.mode) ?? "",
      sections: (jsonRecord(evidence?.sections) as JsonObject | undefined) ?? {},
    },
    limits: (limits as JsonObject | undefined) ?? {},
    warnings: jsonValues(value.warnings),
  };
  return summary;
}

function compactRepoMapSummary(value: JsonObject): JsonObject | undefined {
  if (value.toolName !== "repo_map") {
    return undefined;
  }

  const files = jsonArray(value.files).map(jsonRecord).filter((file): file is Record<string, unknown> => Boolean(file));
  return {
    toolName: "repo_map",
    projectId: stringValue(value.projectId) ?? "",
    tokenBudget: numberValue(value.tokenBudget) ?? 0,
    estimatedTokens: numberValue(value.estimatedTokens) ?? 0,
    totalFilesIndexed: numberValue(value.totalFilesIndexed) ?? 0,
    totalFilesEligible: numberValue(value.totalFilesEligible) ?? 0,
    truncatedByBudget: booleanValue(value.truncatedByBudget) ?? false,
    truncatedByMaxFiles: booleanValue(value.truncatedByMaxFiles) ?? false,
    topFiles: files.slice(0, 5).map((file) => {
      const topFile: JsonObject = {
        filePath: stringValue(file.filePath) ?? "",
        score: numberValue(file.score) ?? 0,
        graphRankScore: numberValue(file.graphRankScore) ?? 0,
        graphRankMode: stringValue(file.graphRankMode) ?? "",
        graphRankDirection: stringValue(file.graphRankDirection) ?? "",
        inboundCount: numberValue(file.inboundCount) ?? 0,
        outboundCount: numberValue(file.outboundCount) ?? 0,
        symbolsIncluded: countSummary(file.symbolsIncluded),
        symbolsTotal: numberValue(file.symbolsTotal) ?? 0,
      };
      const focusRelation = stringValue(file.focusRelation);
      if (focusRelation) topFile.focusRelation = focusRelation;
      const focusDistance = numberValue(file.focusDistance);
      if (focusDistance != null) topFile.focusDistance = focusDistance;
      const dependencyDistance = numberValue(file.dependencyDistance);
      if (dependencyDistance != null) topFile.dependencyDistance = dependencyDistance;
      const dependentDistance = numberValue(file.dependentDistance);
      if (dependentDistance != null) topFile.dependentDistance = dependentDistance;
      return topFile;
    }),
    warnings: jsonValues(value.warnings),
  } satisfies JsonObject;
}

function compactSupportingSignal(value: unknown): JsonObject | undefined {
  const signal = jsonRecord(value);
  if (!signal) return undefined;
  const out: JsonObject = {
    source: stringValue(signal.source) ?? "",
    strategy: stringValue(signal.strategy) ?? "",
  };
  const confidence = numberValue(signal.confidence);
  if (confidence != null) out.confidence = confidence;
  const score = numberValue(signal.score);
  if (score != null) out.score = score;
  for (const key of ["path", "symbolName", "routeKey", "databaseObjectName", "whyIncluded"]) {
    const entry = stringValue(signal[key]);
    if (entry) out[key] = entry;
  }
  for (const key of ["lineStart", "lineEnd"]) {
    const entry = numberValue(signal[key]);
    if (entry != null) out[key] = entry;
  }
  const metadata = compactContextMetadata(signal.metadata, { includeSupportingSignals: false });
  if (metadata) out.metadata = metadata;
  return out;
}

function compactContextMetadata(
  value: unknown,
  options: { includeSupportingSignals?: boolean } = {},
): JsonObject | undefined {
  const record = jsonRecord(value);
  if (!record) return undefined;
  const out: JsonObject = {};
  for (const key of [
    "graphDepth",
    "graphPath",
    "graphRankMode",
    "graphRankDirection",
    "graphRankScore",
    "graphTraversalMode",
    "focusRelation",
    "focusDistance",
    "dependencyDistance",
    "dependentDistance",
    "corroboratedSignalCount",
    "corroborationBonus",
    "query",
    "queryKind",
    "text",
    "column",
    "matchText",
    "submatchCount",
    "overlay",
    "evidenceConfidenceLabel",
    "liveTextProvider",
    "scope",
    "scopePath",
  ]) {
    const entry = record[key];
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      if (entry != null) out[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      out[key] = jsonValues(entry).slice(0, 6);
    }
  }
  if (options.includeSupportingSignals !== false) {
    const supportingSignals = jsonArray(record.supportingSignals);
    const compactedSignals = supportingSignals
      .map(compactSupportingSignal)
      .filter((signal): signal is JsonObject => Boolean(signal))
      .slice(0, 4);
    if (compactedSignals.length > 0) {
      out.supportingSignals = {
        count: supportingSignals.length,
        top: compactedSignals,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function compactContextCandidate(value: unknown): JsonObject | undefined {
  const candidate = jsonRecord(value);
  if (!candidate) return undefined;
  const out: JsonObject = {
    kind: stringValue(candidate.kind) ?? "",
    source: stringValue(candidate.source) ?? "",
    strategy: stringValue(candidate.strategy) ?? "",
    confidence: numberValue(candidate.confidence) ?? 0,
    score: numberValue(candidate.score) ?? 0,
  };
  for (const key of ["path", "symbolName", "routeKey", "databaseObjectName", "evidenceRef", "whyIncluded"]) {
    const entry = stringValue(candidate[key]);
    if (entry) out[key] = entry;
  }
  for (const key of ["lineStart", "lineEnd"]) {
    const entry = numberValue(candidate[key]);
    if (entry != null) out[key] = entry;
  }
  const freshness = jsonRecord(candidate.freshness);
  const freshnessState = stringValue(freshness?.state);
  if (freshnessState) out.freshness = { state: freshnessState };
  const compactMetadata = compactContextMetadata(candidate.metadata);
  if (compactMetadata) out.metadata = compactMetadata;
  return out;
}

function compactExpandableTool(value: unknown): JsonObject | undefined {
  const tool = jsonRecord(value);
  if (!tool) return undefined;
  return {
    toolName: stringValue(tool.toolName) ?? "",
    suggestedArgs: asJsonObject(tool.suggestedArgs) ?? {},
    readOnly: booleanValue(tool.readOnly) ?? true,
    reason: stringValue(tool.reason) ?? "",
    whenToUse: stringValue(tool.whenToUse) ?? "",
  };
}

function compactOmittedRequestedAnchor(value: unknown): JsonObject | undefined {
  const anchor = jsonRecord(value);
  if (!anchor) return undefined;
  return {
    kind: stringValue(anchor.kind) ?? "",
    value: stringValue(anchor.value) ?? "",
    reason: stringValue(anchor.reason) ?? "",
    candidateId: stringValue(anchor.candidateId) ?? "",
    score: numberValue(anchor.score) ?? 0,
    ...(stringValue(anchor.path) ? { path: stringValue(anchor.path) } : {}),
  };
}

function compactContextGraphSummary(value: unknown): JsonObject | undefined {
  const graph = jsonRecord(value);
  if (!graph) return undefined;
  const files = jsonArray(graph.files)
    .map(jsonRecord)
    .filter((file): file is Record<string, unknown> => Boolean(file));
  const edges = jsonArray(graph.edges)
    .map(jsonRecord)
    .filter((edge): edge is Record<string, unknown> => Boolean(edge));
  return {
    anchorFiles: jsonValues(graph.anchorFiles),
    returnedFileCount: numberValue(graph.returnedFileCount) ?? 0,
    edgeCount: numberValue(graph.edgeCount) ?? 0,
    dependencyFileCount: numberValue(graph.dependencyFileCount) ?? 0,
    dependentFileCount: numberValue(graph.dependentFileCount) ?? 0,
    bidirectionalFileCount: numberValue(graph.bidirectionalFileCount) ?? 0,
    centralFileCount: numberValue(graph.centralFileCount) ?? 0,
    unknownRelationFileCount: numberValue(graph.unknownRelationFileCount) ?? 0,
    files: files.slice(0, 8).map((file) => {
      const out: JsonObject = {
        filePath: stringValue(file.filePath) ?? "",
        relation: stringValue(file.relation) ?? "",
        sourceCount: numberValue(file.sourceCount) ?? 0,
        sources: jsonValues(file.sources),
        strategies: jsonValues(file.strategies),
        score: numberValue(file.score) ?? 0,
        confidence: numberValue(file.confidence) ?? 0,
        reasons: jsonValues(file.reasons).slice(0, 3),
      };
      const distance = numberValue(file.distance);
      if (distance != null) out.distance = distance;
      const pathEvidence = jsonArray(file.pathEvidence)
        .map(jsonRecord)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .slice(0, 3)
        .map((entry) => {
          const evidence: JsonObject = {
            anchorFile: stringValue(entry.anchorFile) ?? "",
            targetFile: stringValue(entry.targetFile) ?? "",
            relation: stringValue(entry.relation) ?? "",
            distance: numberValue(entry.distance) ?? 0,
            path: jsonValues(entry.path),
            source: stringValue(entry.source) ?? "",
            strategy: stringValue(entry.strategy) ?? "",
            reason: stringValue(entry.reason) ?? "",
          };
          return evidence;
        });
      if (pathEvidence.length > 0) {
        out.pathEvidence = pathEvidence;
        out.pathEvidenceCount = numberValue(file.pathEvidenceCount) ?? pathEvidence.length;
      }
      return out;
    }),
    edges: edges.slice(0, 8).map((edge) => {
      const out: JsonObject = {
        from: stringValue(edge.from) ?? "",
        to: stringValue(edge.to) ?? "",
        relation: stringValue(edge.relation) ?? "",
        specifier: stringValue(edge.specifier) ?? "",
        importKind: stringValue(edge.importKind) ?? "",
        isTypeOnly: booleanValue(edge.isTypeOnly) ?? false,
      };
      const line = numberValue(edge.line);
      if (line != null) out.line = line;
      return out;
    }),
    truncated: booleanValue(graph.truncated) ?? false,
    warnings: jsonValues(graph.warnings),
  } satisfies JsonObject;
}

function compactRequestCoverage(value: unknown): JsonObject | undefined {
  const coverage = jsonRecord(value);
  if (!coverage) return undefined;
  const items = jsonArray(coverage.items)
    .map(jsonRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const byKind = jsonRecord(coverage.byKind);
  return {
    status: stringValue(coverage.status) ?? "",
    requestedCount: numberValue(coverage.requestedCount) ?? 0,
    coveredCount: numberValue(coverage.coveredCount) ?? 0,
    uncoveredCount: numberValue(coverage.uncoveredCount) ?? 0,
    notCheckedCount: numberValue(coverage.notCheckedCount) ?? 0,
    byKind: asJsonObject(byKind) ?? {},
    items: items.slice(0, 12).map((item) => ({
      kind: stringValue(item.kind) ?? "",
      value: stringValue(item.value) ?? "",
      status: stringValue(item.status) ?? "",
      matchedBy: jsonValues(item.matchedBy).slice(0, 4),
      reason: stringValue(item.reason) ?? "",
    })),
    recommendations: jsonValues(coverage.recommendations).slice(0, 5),
  } satisfies JsonObject;
}

function compactMakoHelpStep(value: unknown): JsonObject | undefined {
  const recipeStep = jsonRecord(value);
  if (!recipeStep) return undefined;
  return {
    id: stringValue(recipeStep.id) ?? "",
    phase: stringValue(recipeStep.phase) ?? "",
    toolName: stringValue(recipeStep.toolName) ?? "",
    title: stringValue(recipeStep.title) ?? "",
    whenToUse: stringValue(recipeStep.whenToUse) ?? "",
    suggestedArgs: asJsonObject(recipeStep.suggestedArgs) ?? {},
    readOnly: booleanValue(recipeStep.readOnly) ?? true,
    batchable: booleanValue(recipeStep.batchable) ?? false,
  } satisfies JsonObject;
}

function compactRetrievalPlanGuide(value: unknown): JsonObject | undefined {
  const guide = jsonRecord(value);
  if (!guide) return undefined;
  return {
    sourceStepId: stringValue(guide.sourceStepId) ?? "",
    planPath: stringValue(guide.planPath) ?? "",
    recommendedToolsPath: stringValue(guide.recommendedToolsPath) ?? "",
    recommendedFollowUpsPath: stringValue(guide.recommendedFollowUpsPath) ?? "",
    expandableToolsPath: stringValue(guide.expandableToolsPath) ?? "",
    requiredEvidencePath: stringValue(guide.requiredEvidencePath) ?? "",
    evidenceGapsPath: stringValue(guide.evidenceGapsPath) ?? "",
    preferToolBatch: booleanValue(guide.preferToolBatch) ?? false,
    evidenceGate: stringValue(guide.evidenceGate) ?? "",
    strategyActions: jsonArray(guide.strategyActions)
      .map(jsonRecord)
      .filter((action): action is Record<string, unknown> => Boolean(action))
      .slice(0, 4)
      .map((action) => ({
        strategy: stringValue(action.strategy) ?? "",
        action: stringValue(action.action) ?? "",
      })),
  } satisfies JsonObject;
}

function compactMakoHelpSummary(value: JsonObject): JsonObject | undefined {
  if (value.toolName !== "mako_help") {
    return undefined;
  }

  const steps = jsonArray(value.steps)
    .map(compactMakoHelpStep)
    .filter((recipeStep): recipeStep is JsonObject => Boolean(recipeStep));
  const batchHint = jsonRecord(value.batchHint);
  const batchArgs = jsonRecord(batchHint?.suggestedArgs);
  const batchOps = jsonArray(batchArgs?.ops)
    .map(jsonRecord)
    .filter((op): op is Record<string, unknown> => Boolean(op));
  const retrievalPlanGuide = compactRetrievalPlanGuide(value.retrievalPlanGuide);

  return {
    toolName: "mako_help",
    task: stringValue(value.task) ?? "",
    recipeId: stringValue(value.recipeId) ?? "",
    summary: stringValue(value.summary) ?? "",
    steps: {
      count: steps.length,
      top: steps.slice(0, 8),
    },
    batchHint: {
      toolName: stringValue(batchHint?.toolName) ?? "tool_batch",
      eligibleStepIds: jsonValues(batchHint?.eligibleStepIds),
        suggestedArgs: {
          verbosity: stringValue(batchArgs?.verbosity) ?? "",
          continueOnError: booleanValue(batchArgs?.continueOnError) ?? true,
          maxConcurrency: numberValue(batchArgs?.maxConcurrency) ?? 0,
          ops: batchOps.slice(0, 8).map((op) => ({
            label: stringValue(op.label) ?? "",
            tool: stringValue(op.tool) ?? "",
          resultMode: stringValue(op.resultMode) ?? "",
        })),
      },
    },
    ...(retrievalPlanGuide ? { retrievalPlanGuide } : { retrievalPlanGuide: null }),
    notes: jsonValues(value.notes).slice(0, 8),
  } satisfies JsonObject;
}

function withSourceHints(summary: JsonObject, value: JsonObject): JsonObject {
  const hints = jsonValues(value._hints).slice(0, 8);
  return hints.length > 0
    ? { ...summary, _hints: hints }
    : summary;
}

function compactContextPacketSummary(value: JsonObject): JsonObject | undefined {
  if (value.toolName !== "context_packet") {
    return undefined;
  }

  const intent = jsonRecord(value.intent);
  const limits = jsonRecord(value.limits);
  const freshnessGate = jsonRecord(value.freshnessGate);
  const indexFreshness = jsonRecord(value.indexFreshness);
  const evidenceQuality = jsonRecord(value.evidenceQuality);
  const retrievalDiagnostics = jsonRecord(value.retrievalDiagnostics);
  const retrievalPlan = jsonRecord(retrievalDiagnostics?.retrievalPlan);
  const retrievalEvidenceGate = jsonRecord(retrievalPlan?.evidenceGate);
  const graphSummary = compactContextGraphSummary(value.graphSummary);
  const requestCoverage = compactRequestCoverage(value.requestCoverage);
  const primaryContext = jsonArray(value.primaryContext)
    .map(compactContextCandidate)
    .filter((candidate): candidate is JsonObject => Boolean(candidate));
  const relatedContext = jsonArray(value.relatedContext)
    .map(compactContextCandidate)
    .filter((candidate): candidate is JsonObject => Boolean(candidate));
  const expandableTools = jsonArray(value.expandableTools)
    .map(compactExpandableTool)
    .filter((tool): tool is JsonObject => Boolean(tool));

  return {
    toolName: "context_packet",
    projectId: stringValue(value.projectId) ?? "",
    request: stringValue(value.request) ?? "",
    mode: stringValue(value.mode) ?? "",
    intent: {
      primaryFamily: stringValue(intent?.primaryFamily) ?? "",
      entities: asJsonObject(jsonRecord(intent?.entities)) ?? {},
    },
    primaryContext: {
      count: primaryContext.length,
      top: primaryContext.slice(0, 5),
    },
    relatedContext: {
      count: relatedContext.length,
      top: relatedContext.slice(0, 5),
    },
    activeFindings: countSummary(value.activeFindings),
    symbols: countSummary(value.symbols),
    routes: countSummary(value.routes),
    databaseObjects: countSummary(value.databaseObjects),
    ...(graphSummary ? { graphSummary } : {}),
    ...(requestCoverage ? { requestCoverage } : {}),
    risks: {
      count: jsonArray(value.risks).length,
      top: jsonArray(value.risks).map(jsonRecord).filter((risk): risk is Record<string, unknown> => Boolean(risk)).slice(0, 5).map((risk) => ({
        code: stringValue(risk.code) ?? "",
        severity: stringValue(risk.severity) ?? "",
        confidence: numberValue(risk.confidence) ?? 0,
        source: stringValue(risk.source) ?? "",
      })),
    },
    scopedInstructions: countSummary(value.scopedInstructions),
    expandableTools: {
      count: expandableTools.length,
      top: expandableTools.slice(0, 5),
    },
    freshnessGate: {
      status: stringValue(freshnessGate?.status) ?? "",
      source: stringValue(freshnessGate?.source) ?? "",
    },
    ...(evidenceQuality
      ? {
          evidenceQuality: {
            label: stringValue(evidenceQuality.label) ?? "",
            score: numberValue(evidenceQuality.score) ?? 0,
            recommendedAction: stringValue(evidenceQuality.recommendedAction) ?? "",
            reasons: jsonValues(evidenceQuality.reasons).slice(0, 5),
            totalContextCount: numberValue(evidenceQuality.totalContextCount) ?? 0,
            freshContextCount: numberValue(evidenceQuality.freshContextCount) ?? 0,
            staleContextCount: numberValue(evidenceQuality.staleContextCount) ?? 0,
            unknownFreshnessCount: numberValue(evidenceQuality.unknownFreshnessCount) ?? 0,
            corroboratedContextCount: numberValue(evidenceQuality.corroboratedContextCount) ?? 0,
            requestCoverage: asJsonObject(jsonRecord(evidenceQuality.requestCoverage)) ?? {},
            graph: asJsonObject(jsonRecord(evidenceQuality.graph)) ?? {},
          },
        }
      : {}),
    ...(indexFreshness
      ? {
          indexFreshness: {
            state: stringValue(indexFreshness.state) ?? "",
            checkedAt: stringValue(indexFreshness.checkedAt) ?? "",
          },
        }
      : {}),
    ...(retrievalDiagnostics
      ? {
          retrievalDiagnostics: {
            retrievalPlan: {
              level: stringValue(retrievalPlan?.level) ?? "",
              strategy: stringValue(retrievalPlan?.strategy) ?? "",
              confidence: numberValue(retrievalPlan?.confidence) ?? 0,
              signals: jsonValues(retrievalPlan?.signals).slice(0, 8),
              evidenceGate: {
                status: stringValue(retrievalEvidenceGate?.status) ?? "",
                canAnswerFromPacket: booleanValue(retrievalEvidenceGate?.canAnswerFromPacket) ?? false,
                canEditFromPacket: booleanValue(retrievalEvidenceGate?.canEditFromPacket) ?? false,
                blockingReasons: jsonValues(retrievalEvidenceGate?.blockingReasons).slice(0, 8),
                advisoryReasons: jsonValues(retrievalEvidenceGate?.advisoryReasons).slice(0, 8),
              },
              evidenceGaps: jsonArray(retrievalPlan?.evidenceGaps)
                .map(jsonRecord)
                .filter((gap): gap is Record<string, unknown> => Boolean(gap))
                .slice(0, 8)
                .map((gap) => ({
                  kind: stringValue(gap.kind) ?? "",
                  severity: stringValue(gap.severity) ?? "",
                  message: stringValue(gap.message) ?? "",
                  recommendedTools: jsonValues(gap.recommendedTools).slice(0, 4),
                  anchors: jsonArray(gap.anchors)
                    .map(compactOmittedRequestedAnchor)
                    .filter((anchor): anchor is JsonObject => Boolean(anchor))
                    .slice(0, 6),
                })),
              requiredEvidence: jsonValues(retrievalPlan?.requiredEvidence).slice(0, 8),
              recommendedTools: jsonValues(retrievalPlan?.recommendedTools).slice(0, 8),
              recommendedFollowUps: jsonArray(retrievalPlan?.recommendedFollowUps)
                .map(compactExpandableTool)
                .filter((tool): tool is JsonObject => Boolean(tool))
                .slice(0, 8),
              nextStep: stringValue(retrievalPlan?.nextStep) ?? "",
            },
            providerRunCount: numberValue(retrievalDiagnostics.providerRunCount) ?? 0,
            providerCandidateCount: numberValue(retrievalDiagnostics.providerCandidateCount) ?? 0,
            providerExecutionMode: stringValue(retrievalDiagnostics.providerExecutionMode) ?? "",
            totalProviderDurationMs: numberValue(retrievalDiagnostics.totalProviderDurationMs) ?? 0,
            zeroCandidateProviders: jsonValues(retrievalDiagnostics.zeroCandidateProviders).slice(0, 8),
            failedProviders: jsonValues(retrievalDiagnostics.failedProviders).slice(0, 8),
            adaptiveSkippedProviders: jsonValues(retrievalDiagnostics.adaptiveSkippedProviders).slice(0, 8),
            liveTextMisses: jsonArray(retrievalDiagnostics.liveTextMisses)
              .map(jsonRecord)
              .filter((miss): miss is Record<string, unknown> => Boolean(miss))
              .slice(0, 8)
              .map((miss) => {
                const out: JsonObject = {
                  query: stringValue(miss.query) ?? "",
                  queryKind: stringValue(miss.queryKind) ?? "quoted_text",
                  scope: stringValue(miss.scope) ?? "",
                };
                const scopePath = stringValue(miss.scopePath);
                if (scopePath) out.scopePath = scopePath;
                return out;
              }),
            slowestProvider: asJsonObject(retrievalDiagnostics.slowestProvider) ?? {},
            recommendations: jsonValues(retrievalDiagnostics.recommendations).slice(0, 5),
          },
        }
      : {}),
    limits: {
      budgetTokens: numberValue(limits?.budgetTokens) ?? 0,
      returnedTokenEstimate: numberValue(limits?.returnedTokenEstimate) ?? 0,
      maxPrimaryContext: numberValue(limits?.maxPrimaryContext) ?? 0,
      maxRelatedContext: numberValue(limits?.maxRelatedContext) ?? 0,
      providersRun: jsonValues(limits?.providersRun),
      providersRunDetail: jsonArray(limits?.providersRunDetail)
        .map(jsonRecord)
        .filter((detail): detail is Record<string, unknown> => Boolean(detail))
        .slice(0, 12)
        .map((detail) => ({
          provider: stringValue(detail.provider) ?? "",
          status: stringValue(detail.status) ?? "",
          candidateCount: numberValue(detail.candidateCount) ?? 0,
          durationMs: numberValue(detail.durationMs) ?? 0,
        })),
      providersSkipped: jsonValues(limits?.providersSkipped),
      providersSkippedDetail: jsonArray(limits?.providersSkippedDetail)
        .map(jsonRecord)
        .filter((detail): detail is Record<string, unknown> => Boolean(detail))
        .slice(0, 8)
        .map((detail) => ({
          provider: stringValue(detail.provider) ?? "",
          reason: stringValue(detail.reason) ?? "",
          adaptive: booleanValue(detail.adaptive) ?? false,
        })),
      providersFailed: jsonValues(limits?.providersFailed),
      candidatesConsidered: numberValue(limits?.candidatesConsidered) ?? 0,
      rankedCandidateCount: numberValue(limits?.rankedCandidateCount) ?? 0,
      candidatesReturned: numberValue(limits?.candidatesReturned) ?? 0,
      selectionLimitHit: booleanValue(limits?.selectionLimitHit) ?? false,
      candidatesOmittedByLimit: numberValue(limits?.candidatesOmittedByLimit) ?? 0,
      requestedAnchorsOmitted: numberValue(limits?.requestedAnchorsOmitted) ?? 0,
      omittedRequestedAnchors: jsonArray(limits?.omittedRequestedAnchors)
        .map(compactOmittedRequestedAnchor)
        .filter((anchor): anchor is JsonObject => Boolean(anchor))
        .slice(0, 8),
      supportingSignalsOmitted: numberValue(limits?.supportingSignalsOmitted) ?? 0,
    },
    warnings: jsonValues(value.warnings),
  } satisfies JsonObject;
}

function summarizeJsonObject(value: JsonObject): JsonObject {
  const reefAskSummary = compactReefAskSummary(value);
  if (reefAskSummary) return withSourceHints(reefAskSummary, value);
  const repoMapSummary = compactRepoMapSummary(value);
  if (repoMapSummary) return withSourceHints(repoMapSummary, value);
  const contextPacketSummary = compactContextPacketSummary(value);
  if (contextPacketSummary) return withSourceHints(contextPacketSummary, value);
  const makoHelpSummary = compactMakoHelpSummary(value);
  if (makoHelpSummary) return withSourceHints(makoHelpSummary, value);

  const summary: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      summary[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      summary[key] = { count: entry.length };
      continue;
    }
    if (typeof entry === "object") {
      summary[key] = { keys: Object.keys(entry).slice(0, 12) };
    }
  }
  return withSourceHints(summary, value);
}

function rejectedResult(
  op: ToolBatchInput["ops"][number],
  durationMs: number,
  code: NonNullable<ToolBatchResult["error"]>["code"],
  message: string,
): ToolBatchResult {
  return {
    label: op.label,
    tool: op.tool,
    ok: false,
    durationMs,
    error: { code, message },
  };
}

async function runBoundedConcurrentOps(
  ops: readonly ToolBatchInput["ops"][number][],
  maxConcurrency: number,
  runOp: (op: ToolBatchInput["ops"][number]) => Promise<ToolBatchResult>,
): Promise<ToolBatchResult[]> {
  const results: Array<ToolBatchResult | undefined> = new Array(ops.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, ops.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const op = ops[index];
        if (!op) return;
        results[index] = await runOp(op);
      }
    }),
  );
  return results.filter((result): result is ToolBatchResult => Boolean(result));
}

function emitToolBatchTelemetry(args: {
  projectStore: import("@mako-ai/store").ProjectStore;
  projectId: string;
  requestId?: string;
  results: readonly ToolBatchResult[];
}): void {
  try {
    const succeeded = args.results.filter((result) => result.ok).length;
    const failed = args.results.length - succeeded;
    args.projectStore.insertUsefulnessEvent({
      eventId: randomUUID(),
      projectId: args.projectId,
      requestId: args.requestId ?? `req_${randomUUID()}`,
      decisionKind: "wrapper_usefulness",
      family: "tool_batch",
      toolName: "tool_batch",
      grade: failed === 0 ? "full" : succeeded > 0 ? "partial" : "no",
      reasonCodes: [
        succeeded > 0 ? "ops_succeeded" : "no_ops_succeeded",
        failed > 0 ? "ops_failed_or_rejected" : "no_ops_failed",
      ],
      reason: `tool_batch completed ${succeeded}/${args.results.length} operation(s).`,
    });
  } catch {
    // Telemetry must never affect the tool result.
  }
}

export async function toolBatchTool(
  input: ToolBatchInput,
  options: ToolServiceOptions = {},
): Promise<ToolBatchToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const maxOps = Math.min(input.maxOps ?? 8, input.ops.length);
    const ops = input.ops.slice(0, maxOps);
    const continueOnError = input.continueOnError ?? true;
    const executionMode: ToolBatchToolOutput["summary"]["executionMode"] = continueOnError ? "parallel" : "sequential";
    const maxConcurrency = executionMode === "parallel"
      ? Math.min(input.maxConcurrency ?? 8, ops.length)
      : 1;
    const concurrencyLimited = executionMode === "parallel" && ops.length > maxConcurrency;
    const warnings: string[] = [];
    if (input.ops.length > maxOps) {
      warnings.push(`truncated: ${input.ops.length - maxOps} operation(s) were skipped by maxOps.`);
    }

    const { getToolDefinition } = await import("../tool-definitions.js");
    const { invokeTool } = await import("../registry.js");

    const runOp = async (op: ToolBatchInput["ops"][number]): Promise<ToolBatchResult> => {
      const opStartedAtMs = Date.now();
      if ((op.tool as string) === "tool_batch") {
        return rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "recursive_batch_rejected",
          "tool_batch cannot call itself.",
        );
      }

      const definition = getToolDefinition(op.tool);
      if (!definition) {
        return rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "unknown_tool",
          `Unknown tool: ${op.tool}`,
        );
      }

      if ("mutation" in definition.annotations) {
        return rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "mutation_rejected",
          `${op.tool} is a mutation tool and cannot be called from read-only tool_batch.`,
        );
      }

      try {
        const args = {
          ...(op.args ?? {}),
          projectId: project.projectId,
        };
        const output = await invokeTool(op.tool, args, options);
        const result = asJsonObject(output);
        const summarizeResult = op.resultMode === "summary" ||
          (op.resultMode !== "full" && input.verbosity === "compact");
        return {
          label: op.label,
          tool: op.tool,
          ok: true,
          durationMs: Math.max(0, Date.now() - opStartedAtMs),
          ...(result && summarizeResult ? { resultSummary: summarizeJsonObject(result) } : {}),
          ...(result && !summarizeResult ? { result } : {}),
        };
      } catch (error) {
        return rejectedResult(
          op,
          Math.max(0, Date.now() - opStartedAtMs),
          "tool_error",
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    const results: ToolBatchResult[] = [];
    if (continueOnError) {
      results.push(...await runBoundedConcurrentOps(ops, maxConcurrency, runOp));
    } else {
      for (const op of ops) {
        const result = await runOp(op);
        results.push(result);
        if (!result.ok) break;
      }
    }

    const succeededOps = results.filter((result) => result.ok).length;
    const rejectedOps = results.filter((result) =>
      result.error?.code === "mutation_rejected" ||
      result.error?.code === "recursive_batch_rejected" ||
      result.error?.code === "unknown_tool"
    ).length;
    const failedOps = results.length - succeededOps;
    const totalOpDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
    const slowestResult = [...results].sort((left, right) => right.durationMs - left.durationMs).at(0);
    const slowestOp = slowestResult
      ? {
          label: slowestResult.label,
          tool: slowestResult.tool,
          durationMs: slowestResult.durationMs,
          ok: slowestResult.ok,
        }
      : null;

    emitToolBatchTelemetry({
      projectStore,
      projectId: project.projectId,
      requestId: options.requestContext?.requestId,
      results,
    });

    return {
      toolName: "tool_batch",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      results,
      summary: {
        requestedOps: input.ops.length,
        executedOps: results.length,
        succeededOps,
        failedOps,
        rejectedOps,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        totalOpDurationMs,
        slowestOp,
        executionMode,
        maxConcurrency,
        concurrencyLimited,
      },
      warnings,
    };
  });
}
