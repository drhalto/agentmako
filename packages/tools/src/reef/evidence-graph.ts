import type {
  ContextPacketDatabaseObject,
  ContextPacketInstruction,
  ContextPacketReadableCandidate,
  ContextPacketRisk,
  ContextPacketRoute,
  ContextPacketSymbol,
  FactFreshness,
  FactProvenance,
  IndexFreshnessDetail,
  JsonObject,
  JsonValue,
  LiveTextSearchMatch,
  ProjectFact,
  ProjectConvention,
  ProjectFinding,
  ProjectOverlay,
  ReefDiagnosticRun,
  ReefCalculationDependency,
  ReefEvidenceGraph,
  ReefGraphEdge,
  ReefGraphEdgeKind,
  ReefGraphNode,
  ReefGraphNodeKind,
  ReefOpenLoop,
  ReefStructuralDefinition,
  ReefStructuralUsage,
  VerificationChangedFile,
  VerificationSourceState,
} from "@mako-ai/contracts";
import type { ReefConventionGraphEvidence } from "./convention-graph-evidence.js";
import type {
  ReefIndexedGraphEvidence,
  ReefIndexedGraphInteraction,
  ReefIndexedGraphSchemaUsage,
} from "./indexed-graph-evidence.js";
import type { ReefOperationalGraphEvidence } from "./operational-graph-evidence.js";

interface BuildReefEvidenceGraphInput {
  generatedAt?: string;
  revision?: number;
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  symbols: ContextPacketSymbol[];
  routes: ContextPacketRoute[];
  databaseObjects: ContextPacketDatabaseObject[];
  findings: ProjectFinding[];
  risks: ContextPacketRisk[];
  instructions: ContextPacketInstruction[];
  openLoops: ReefOpenLoop[];
  facts: ProjectFact[];
  indexedGraph?: ReefIndexedGraphEvidence;
  conventionGraph?: ReefConventionGraphEvidence;
  operationalGraph?: ReefOperationalGraphEvidence;
  whereUsed?: {
    query: string;
    targetKind?: string;
    definitions: ReefStructuralDefinition[];
    usages: ReefStructuralUsage[];
    relatedFindings: ProjectFinding[];
  };
  liveTextSearch?: {
    query: string;
    matches: LiveTextSearchMatch[];
    filesMatched: string[];
  };
  verification: {
    status: "fresh" | "stale" | "unknown" | "failed";
    sources: VerificationSourceState[];
    changedFiles: VerificationChangedFile[];
    suggestedActions: string[];
  };
  nodeLimit?: number;
  edgeLimit?: number;
}

interface PatchToolRunEvidence {
  filePaths: string[];
  findingFingerprints: string[];
}

const NODE_KIND_ORDER = new Map<ReefGraphNodeKind, number>([
  ["file", 0],
  ["symbol", 1],
  ["route", 2],
  ["component", 3],
  ["server_action", 4],
  ["table", 5],
  ["column", 6],
  ["index", 7],
  ["foreign_key", 8],
  ["rls_policy", 9],
  ["rpc", 10],
  ["trigger", 11],
  ["database_object", 12],
  ["finding", 13],
  ["diagnostic", 14],
  ["rule", 15],
  ["convention", 16],
  ["instruction", 17],
  ["import", 18],
  ["export", 19],
  ["session", 20],
  ["patch", 21],
  ["test", 22],
  ["command", 23],
]);

const EDGE_KIND_ORDER = new Map<ReefGraphEdgeKind, number>([
  ["defines", 0],
  ["imports", 1],
  ["exports", 2],
  ["handles_route", 3],
  ["calls", 4],
  ["renders", 5],
  ["reads_table", 6],
  ["writes_table", 7],
  ["calls_rpc", 8],
  ["references_column", 9],
  ["protected_by_policy", 10],
  ["violates_rule", 11],
  ["verified_by", 12],
  ["depends_on", 13],
  ["contains", 14],
  ["mentions", 15],
  ["resolved_by_patch", 16],
  ["similar_to", 17],
  ["duplicates_pattern", 18],
  ["acknowledged_as", 19],
  ["learned_from", 20],
]);

export function buildReefEvidenceGraph(input: BuildReefEvidenceGraphInput): ReefEvidenceGraph {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const builder = new EvidenceGraphBuilder(generatedAt, input.revision);

  for (const candidate of [...input.primaryContext, ...input.relatedContext]) {
    builder.addContextCandidate(candidate);
  }
  for (const symbol of input.symbols) {
    builder.addContextSymbol(symbol);
  }
  for (const route of input.routes) {
    builder.addContextRoute(route);
  }
  for (const object of input.databaseObjects) {
    builder.addContextDatabaseObject(object);
  }
  if (input.indexedGraph) {
    builder.addIndexedGraphEvidence(input.indexedGraph);
  }
  if (input.conventionGraph) {
    builder.addConventionGraphEvidence(input.conventionGraph);
  }
  if (input.operationalGraph) {
    builder.addOperationalGraphEvidence(input.operationalGraph);
  }
  for (const fact of input.facts) {
    builder.addProjectFact(fact);
  }
  for (const finding of input.findings) {
    builder.addProjectFinding(finding);
  }
  for (const risk of input.risks) {
    builder.addRisk(risk);
  }
  for (const instruction of input.instructions) {
    builder.addInstruction(instruction);
  }
  for (const loop of input.openLoops) {
    builder.addOpenLoop(loop);
  }
  if (input.whereUsed) {
    builder.addWhereUsed(input.whereUsed);
  }
  if (input.liveTextSearch) {
    builder.addLiveTextSearch(input.liveTextSearch);
  }
  builder.addVerification(input.verification);

  return builder.toGraph({
    nodeLimit: input.nodeLimit,
    edgeLimit: input.edgeLimit,
  });
}

class EvidenceGraphBuilder {
  private readonly nodes = new Map<string, ReefGraphNode>();
  private readonly edges = new Map<string, ReefGraphEdge>();
  private readonly warnings: string[] = [];

  constructor(
    private readonly generatedAt: string,
    private readonly revision: number | undefined,
  ) {}

  addContextCandidate(candidate: ContextPacketReadableCandidate): void {
    const freshness = freshnessFromIndex(candidate.freshness, this.generatedAt);
    const provenance = makeProvenance(candidate.source, this.generatedAt, dependenciesForPath(candidate.path), {
      strategy: candidate.strategy,
      whyIncluded: candidate.whyIncluded,
      evidenceRef: candidate.evidenceRef ?? null,
    });
    if (candidate.kind === "file" && candidate.path) {
      this.addFileNode(candidate.path, {
        source: candidate.source,
        confidence: candidate.confidence,
        freshness,
        provenance,
        data: jsonObject({
          lineStart: candidate.lineStart,
          lineEnd: candidate.lineEnd,
          score: candidate.score,
          metadata: candidate.metadata,
        }),
      });
      return;
    }
    if (candidate.kind === "symbol" && candidate.symbolName) {
      const symbolNodeId = this.addSymbolNode({
        path: candidate.path,
        symbolName: candidate.symbolName,
        source: candidate.source,
        confidence: candidate.confidence,
        freshness,
        provenance,
        data: jsonObject({
          lineStart: candidate.lineStart,
          lineEnd: candidate.lineEnd,
          score: candidate.score,
          metadata: candidate.metadata,
        }),
      });
      if (candidate.path) {
        const fileNodeId = this.addFileNode(candidate.path, {
          source: candidate.source,
          confidence: candidate.confidence,
          freshness,
          provenance,
        });
        this.addEdge("defines", fileNodeId, symbolNodeId, {
          source: candidate.source,
          confidence: candidate.confidence,
          freshness,
          provenance,
          label: "defines symbol",
        });
      }
      return;
    }
    if (candidate.kind === "route" && candidate.routeKey) {
      const routeNodeId = this.addRouteNode({
        routeKey: candidate.routeKey,
        path: candidate.path,
        source: candidate.source,
        confidence: candidate.confidence,
        freshness,
        provenance,
        data: jsonObject({
          lineStart: candidate.lineStart,
          lineEnd: candidate.lineEnd,
          score: candidate.score,
          metadata: candidate.metadata,
        }),
      });
      if (candidate.path) {
        const fileNodeId = this.addFileNode(candidate.path, {
          source: candidate.source,
          confidence: candidate.confidence,
          freshness,
          provenance,
        });
        this.addEdge("handles_route", fileNodeId, routeNodeId, {
          source: candidate.source,
          confidence: candidate.confidence,
          freshness,
          provenance,
          label: "handles route",
        });
      }
      return;
    }
    if (candidate.kind === "database_object" && candidate.databaseObjectName) {
      this.addDatabaseNode({
        kind: "database_object",
        schemaName: undefined,
        objectName: candidate.databaseObjectName,
        source: candidate.source,
        confidence: candidate.confidence,
        freshness,
        provenance,
        data: jsonObject({
          score: candidate.score,
          metadata: candidate.metadata,
        }),
      });
    }
  }

  addContextSymbol(symbol: ContextPacketSymbol): void {
    const freshness = unknownFreshness(this.generatedAt, "Context symbol freshness follows the enclosing index freshness gate.");
    const provenance = makeProvenance(symbol.source, this.generatedAt, dependenciesForPath(symbol.path), {
      whyIncluded: symbol.whyIncluded,
    });
    const symbolNodeId = this.addSymbolNode({
      path: symbol.path,
      symbolName: symbol.name,
      source: symbol.source,
      confidence: symbol.confidence,
      freshness,
      provenance,
      data: jsonObject({
        symbolKind: symbol.kind,
        lineStart: symbol.lineStart,
      }),
    });
    if (symbol.path) {
      const fileNodeId = this.addFileNode(symbol.path, {
        source: symbol.source,
        confidence: symbol.confidence,
        freshness,
        provenance,
      });
      this.addEdge("defines", fileNodeId, symbolNodeId, {
        source: symbol.source,
        confidence: symbol.confidence,
        freshness,
        provenance,
        label: "defines symbol",
      });
    }
  }

  addContextRoute(route: ContextPacketRoute): void {
    const freshness = unknownFreshness(this.generatedAt, "Context route freshness follows the enclosing index freshness gate.");
    const provenance = makeProvenance(route.source, this.generatedAt, dependenciesForPath(route.path), {
      whyIncluded: route.whyIncluded,
    });
    const routeNodeId = this.addRouteNode({
      routeKey: route.routeKey,
      path: route.path,
      source: route.source,
      confidence: route.confidence,
      freshness,
      provenance,
      data: jsonObject({ method: route.method }),
    });
    if (route.path) {
      const fileNodeId = this.addFileNode(route.path, {
        source: route.source,
        confidence: route.confidence,
        freshness,
        provenance,
      });
      this.addEdge("handles_route", fileNodeId, routeNodeId, {
        source: route.source,
        confidence: route.confidence,
        freshness,
        provenance,
        label: route.method ? `handles ${route.method}` : "handles route",
      });
    }
  }

  addContextDatabaseObject(object: ContextPacketDatabaseObject): void {
    const freshness = unknownFreshness(this.generatedAt, "Context database object freshness follows the enclosing index freshness gate.");
    const provenance = makeProvenance(object.source, this.generatedAt, [{ kind: "schema_snapshot" }], {
      whyIncluded: object.whyIncluded,
      objectType: object.objectType,
    });
    this.addDatabaseNode({
      kind: nodeKindForDatabaseObjectType(object.objectType),
      schemaName: object.schemaName,
      objectName: object.objectName,
      source: object.source,
      confidence: object.confidence,
      freshness,
      provenance,
      data: jsonObject({ objectType: object.objectType }),
    });
  }

  addIndexedGraphEvidence(indexedGraph: ReefIndexedGraphEvidence): void {
    this.warnings.push(...indexedGraph.warnings);
    const provenanceValue = makeProvenance(indexedGraph.source, this.generatedAt, [{ kind: "artifact_kind", artifactKind: "project_index" }], {
      graphSlice: "focused",
    });
    for (const file of indexedGraph.files) {
      this.addFileNode(file.path, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.9,
        freshness: indexedGraph.freshness,
        provenance: makeProvenance(indexedGraph.source, file.indexedAt, dependenciesForPath(file.path), {
          language: file.language,
          indexedAt: file.indexedAt,
          lastModifiedAt: file.lastModifiedAt ?? null,
        }),
        data: jsonObject({
          language: file.language,
          sizeBytes: file.sizeBytes,
          lineCount: file.lineCount,
          isGenerated: file.isGenerated,
          indexedAt: file.indexedAt,
          lastModifiedAt: file.lastModifiedAt,
        }),
      });
    }

    for (const symbol of indexedGraph.symbols) {
      const symbolProvenance = makeProvenance(indexedGraph.source, this.generatedAt, dependenciesForPath(symbol.filePath), {
        producer: "projectStore.listSymbolsForFile",
      });
      const fileNodeId = this.addFileNode(symbol.filePath, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: symbolProvenance,
      });
      const symbolNodeId = this.addSymbolNode({
        path: symbol.filePath,
        symbolName: symbol.name,
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: symbolProvenance,
        data: jsonObject({
          symbolKind: symbol.kind,
          exportName: symbol.exportName,
          lineStart: symbol.lineStart,
          lineEnd: symbol.lineEnd,
          signatureText: symbol.signatureText,
          metadata: symbol.metadata,
        }),
      });
      this.addEdge("defines", fileNodeId, symbolNodeId, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: symbolProvenance,
        label: "indexed symbol",
      });
      if (symbol.exportName) {
        this.addEdge("exports", fileNodeId, symbolNodeId, {
          source: indexedGraph.source,
          overlay: indexedGraph.overlay,
          confidence: 0.95,
          freshness: indexedGraph.freshness,
          provenance: symbolProvenance,
          label: symbol.exportName,
        });
      }
    }

    for (const edge of indexedGraph.imports) {
      const importProvenance = makeProvenance(indexedGraph.source, this.generatedAt, dependenciesForPath(edge.sourcePath), {
        producer: "projectStore.listImportsForFile/listDependentsForFile",
        targetPath: edge.targetPath,
        targetExists: edge.targetExists,
      });
      const sourceFileId = this.addFileNode(edge.sourcePath, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.9,
        freshness: indexedGraph.freshness,
        provenance: importProvenance,
      });
      const targetFileId = this.addFileNode(edge.targetPath, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: edge.targetExists ? 0.9 : 0.55,
        freshness: indexedGraph.freshness,
        provenance: importProvenance,
      });
      this.addEdge("imports", sourceFileId, targetFileId, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: edge.targetExists ? 0.9 : 0.55,
        freshness: indexedGraph.freshness,
        provenance: importProvenance,
        label: edge.specifier,
        data: jsonObject({
          specifier: edge.specifier,
          importKind: edge.importKind,
          isTypeOnly: edge.isTypeOnly,
          line: edge.line,
          targetExists: edge.targetExists,
        }),
      });
    }

    for (const interaction of indexedGraph.interactions) {
      this.addIndexedInteraction(interaction, indexedGraph);
    }

    for (const route of indexedGraph.routes) {
      const routeProvenance = makeProvenance(indexedGraph.source, this.generatedAt, dependenciesForPath(route.filePath), {
        producer: "projectStore.listRoutesForFile",
      });
      const fileNodeId = this.addFileNode(route.filePath, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: routeProvenance,
      });
      const routeNodeId = this.addRouteNode({
        routeKey: route.routeKey,
        path: route.filePath,
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: routeProvenance,
        data: jsonObject({
          framework: route.framework,
          pattern: route.pattern,
          method: route.method,
          handlerName: route.handlerName,
          isApi: route.isApi,
          metadata: route.metadata,
        }),
      });
      this.addEdge("handles_route", fileNodeId, routeNodeId, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: 0.95,
        freshness: indexedGraph.freshness,
        provenance: routeProvenance,
        label: route.method ?? "route",
      });
    }

    for (const usage of indexedGraph.schemaUsages) {
      this.addIndexedSchemaUsage(usage, indexedGraph, provenanceValue);
    }
  }

  addConventionGraphEvidence(conventionGraph: ReefConventionGraphEvidence): void {
    this.warnings.push(...conventionGraph.warnings);
    for (const convention of conventionGraph.conventions) {
      const conventionProvenance = makeProvenance(convention.source, this.generatedAt, conventionDependencies(convention), {
        id: convention.id,
        kind: convention.kind,
        status: convention.status,
        whyIncluded: convention.whyIncluded,
        evidence: convention.evidence,
      });
      const conventionNodeId = this.addConventionNode(convention, conventionGraph, conventionProvenance);
      const linkedFilePaths = new Set([
        ...(convention.filePath ? [convention.filePath] : []),
        ...convention.evidence.flatMap((evidence) => extractFilePaths(evidence)),
      ]);
      for (const filePath of linkedFilePaths) {
        const fileNodeId = this.addFileNode(filePath, {
          source: convention.source,
          overlay: conventionGraph.overlay,
          confidence: Math.min(0.9, convention.confidence),
          freshness: conventionGraph.freshness,
          provenance: makeProvenance(convention.source, this.generatedAt, dependenciesForPath(filePath), {
            conventionId: convention.id,
          }),
        });
        this.addEdge("depends_on", fileNodeId, conventionNodeId, {
          source: convention.source,
          overlay: conventionGraph.overlay,
          confidence: convention.confidence,
          freshness: conventionGraph.freshness,
          provenance: conventionProvenance,
          label: convention.kind,
        });
      }

      const ruleRef = ruleRefFromConvention(convention);
      if (ruleRef) {
        const ruleNodeId = this.addRuleNode(
          ruleRef.ruleId,
          ruleRef.source,
          conventionGraph.freshness,
          conventionProvenance,
        );
        this.addEdge("learned_from", conventionNodeId, ruleNodeId, {
          source: convention.source,
          overlay: conventionGraph.overlay,
          confidence: convention.confidence,
          freshness: conventionGraph.freshness,
          provenance: conventionProvenance,
          label: "rule descriptor",
        });
      }
    }
  }

  addOperationalGraphEvidence(operationalGraph: ReefOperationalGraphEvidence): void {
    this.warnings.push(...operationalGraph.warnings);
    for (const run of operationalGraph.diagnosticRuns) {
      const runProvenance = diagnosticRunProvenance(run);
      const runFreshness = diagnosticRunFreshness(run, operationalGraph);
      const diagnosticNodeId = this.addDiagnosticRunNode(run, runFreshness, runProvenance);
      if (run.command) {
        const commandNodeId = this.addCommandNode({
          id: operationalNodeId(isTestRun(run) ? "test" : "command", run.command),
          kind: isTestRun(run) ? "test" : "command",
          label: run.command,
          source: run.source,
          overlay: run.overlay,
          confidence: run.status === "succeeded" ? 0.9 : 0.65,
          freshness: runFreshness,
          provenance: runProvenance,
          data: jsonObject({
            runId: run.runId,
            source: run.source,
            status: run.status,
            durationMs: run.durationMs,
            cwd: run.cwd,
          }),
        });
        this.addEdge("verified_by", commandNodeId, diagnosticNodeId, {
          source: run.source,
          overlay: run.overlay,
          confidence: run.status === "succeeded" ? 0.9 : 0.65,
          freshness: runFreshness,
          provenance: runProvenance,
          label: run.status,
        });
        for (const filePath of requestedFilesForDiagnosticRun(run)) {
          const fileNodeId = this.addFileNode(filePath, {
            source: run.source,
            overlay: run.overlay,
            confidence: 0.75,
            freshness: runFreshness,
            provenance: makeProvenance(run.source, run.finishedAt, dependenciesForPath(filePath), {
              runId: run.runId,
            }),
          });
          this.addEdge("verified_by", fileNodeId, commandNodeId, {
            source: run.source,
            overlay: run.overlay,
            confidence: 0.75,
            freshness: runFreshness,
            provenance: runProvenance,
            label: run.source,
          });
        }
      }
    }

    for (const run of operationalGraph.toolRuns) {
      const freshness = {
        state: run.outcome === "success" ? "fresh" : "stale",
        checkedAt: run.finishedAt,
        reason: `Tool run ${run.toolName} completed with outcome ${run.outcome}.`,
      } satisfies FactFreshness;
      const runProvenance = makeProvenance("tool_runs", run.finishedAt, [], {
        runId: run.runId,
        toolName: run.toolName,
        requestId: run.requestId ?? null,
      });
      const commandNodeId = this.addCommandNode({
        id: `command:tool_run:${run.runId}`,
        kind: "command",
        label: run.toolName,
        source: "tool_runs",
        confidence: run.outcome === "success" ? 0.85 : 0.55,
        freshness,
        provenance: runProvenance,
        data: jsonObject({
          runId: run.runId,
          toolName: run.toolName,
          outcome: run.outcome,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          requestId: run.requestId,
          errorText: run.errorText,
        }),
      });
      if (run.requestId) {
        const sessionNodeId = this.addNode({
          id: `session:${run.requestId}`,
          kind: "session",
          label: run.requestId,
          source: "tool_runs",
          confidence: 0.75,
          freshness,
          provenance: runProvenance,
          data: jsonObject({ requestId: run.requestId }),
        });
        this.addEdge("calls", sessionNodeId, commandNodeId, {
          source: "tool_runs",
          confidence: 0.75,
          freshness,
          provenance: runProvenance,
          label: run.toolName,
        });
      }
      const patchEvidence = patchEvidenceFromToolRun(run);
      if (patchEvidence) {
        this.addToolRunPatch({
          run,
          commandNodeId,
          freshness,
          provenance: runProvenance,
          patchEvidence,
        });
      }
    }
  }

  addProjectFact(fact: ProjectFact): void {
    const subjectNode = this.addSubjectNode(fact);
    if (!subjectNode) return;

    if (fact.subject.kind === "import_edge") {
      const sourceFileId = this.addFileNode(fact.subject.sourcePath, {
        source: fact.source,
        overlay: fact.overlay,
        confidence: fact.confidence,
        freshness: fact.freshness,
        provenance: fact.provenance,
      });
      const targetFileId = this.addFileNode(fact.subject.targetPath, {
        source: fact.source,
        overlay: fact.overlay,
        confidence: fact.confidence,
        freshness: fact.freshness,
        provenance: fact.provenance,
      });
      this.addEdge("imports", sourceFileId, targetFileId, factEdgeOptions(fact, "imports"));
      return;
    }

    this.addDatabaseFactRelationships(fact, subjectNode);
  }

  addProjectFinding(finding: ProjectFinding): void {
    const findingNodeId = this.addFindingNode(finding);
    if (finding.filePath) {
      const provenanceValue = findingProvenance(finding);
      const fileNodeId = this.addFileNode(finding.filePath, {
        source: finding.source,
        overlay: finding.overlay,
        confidence: 0.95,
        freshness: finding.freshness,
        provenance: provenanceValue,
      });
      this.addEdge("violates_rule", fileNodeId, findingNodeId, {
        source: finding.source,
        overlay: finding.overlay,
        confidence: 0.95,
        freshness: finding.freshness,
        provenance: provenanceValue,
        label: finding.ruleId ?? finding.source,
      });
    }
    if (finding.ruleId) {
      const ruleNodeId = this.addRuleNode(finding.ruleId, finding.source, finding.freshness, findingProvenance(finding));
      this.addEdge("violates_rule", findingNodeId, ruleNodeId, {
        source: finding.source,
        overlay: finding.overlay,
        confidence: 0.9,
        freshness: finding.freshness,
        provenance: findingProvenance(finding),
        label: "reported by rule",
      });
    }
  }

  addRisk(risk: ContextPacketRisk): void {
    const freshness = unknownFreshness(this.generatedAt, "Risk freshness follows the context packet calculation.");
    const provenanceValue = makeProvenance(risk.source, this.generatedAt, [], {
      severity: risk.severity,
      recommendedHarnessStep: risk.recommendedHarnessStep ?? null,
    });
    const nodeId = this.addNode({
      id: `diagnostic:risk:${risk.code}`,
      kind: "diagnostic",
      label: risk.code,
      source: risk.source,
      confidence: risk.confidence,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({
        code: risk.code,
        reason: risk.reason,
        severity: risk.severity,
      }),
    });
    if (risk.code.includes("duplicate")) {
      for (const filePath of extractFilePaths(risk.reason)) {
        const fileNodeId = this.addFileNode(filePath, {
          source: risk.source,
          confidence: risk.confidence,
          freshness,
          provenance: provenanceValue,
        });
        this.addEdge("duplicates_pattern", fileNodeId, nodeId, {
          source: risk.source,
          confidence: risk.confidence,
          freshness,
          provenance: provenanceValue,
          label: "duplicate risk",
        });
      }
    }
  }

  addInstruction(instruction: ContextPacketInstruction): void {
    const freshness = unknownFreshness(this.generatedAt, "Instruction freshness follows the context packet calculation.");
    const provenanceValue = makeProvenance("reef_instructions", this.generatedAt, dependenciesForPath(instruction.path), {
      reason: instruction.reason,
      precedence: instruction.precedence,
    });
    const instructionNodeId = this.addNode({
      id: `instruction:${instruction.path}`,
      kind: "instruction",
      label: instruction.path,
      source: "reef_instructions",
      confidence: 0.85,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({
        path: instruction.path,
        appliesTo: instruction.appliesTo,
        excerpt: instruction.excerpt,
      }),
    });
    for (const filePath of instruction.appliesTo) {
      const fileNodeId = this.addFileNode(filePath, {
        source: "reef_instructions",
        confidence: 0.75,
        freshness,
        provenance: provenanceValue,
      });
      this.addEdge("depends_on", fileNodeId, instructionNodeId, {
        source: "reef_instructions",
        confidence: 0.75,
        freshness,
        provenance: provenanceValue,
        label: "scoped instruction",
      });
    }
  }

  addOpenLoop(loop: ReefOpenLoop): void {
    const freshness = unknownFreshness(this.generatedAt, "Open loop freshness follows the project_open_loops calculation.");
    const provenanceValue = makeProvenance(loop.source, this.generatedAt, dependenciesForPath(loop.filePath), {
      kind: loop.kind,
      severity: loop.severity,
      subjectFingerprint: loop.subjectFingerprint ?? null,
    });
    const diagnosticNodeId = this.addNode({
      id: `diagnostic:open_loop:${loop.id}`,
      kind: "diagnostic",
      label: loop.title,
      source: loop.source,
      confidence: 0.85,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({
        id: loop.id,
        kind: loop.kind,
        reason: loop.reason,
        suggestedActions: loop.suggestedActions,
        metadata: loop.metadata,
      }),
    });
    if (loop.filePath) {
      const fileNodeId = this.addFileNode(loop.filePath, {
        source: loop.source,
        confidence: 0.85,
        freshness,
        provenance: provenanceValue,
      });
      this.addEdge("verified_by", fileNodeId, diagnosticNodeId, {
        source: loop.source,
        confidence: 0.85,
        freshness,
        provenance: provenanceValue,
        label: loop.kind,
      });
    }
  }

  addWhereUsed(whereUsed: NonNullable<BuildReefEvidenceGraphInput["whereUsed"]>): void {
    const freshness = unknownFreshness(this.generatedAt, "Where-used freshness follows maintained Reef structural state.");
    const queryNodeId = this.addNode({
      id: `symbol:${whereUsed.query}`,
      kind: whereUsed.targetKind === "route" ? "route" : "symbol",
      label: whereUsed.query,
      source: "reef_where_used",
      confidence: 0.75,
      freshness,
      provenance: makeProvenance("reef_where_used", this.generatedAt, [], {
        query: whereUsed.query,
        targetKind: whereUsed.targetKind ?? null,
      }),
    });

    for (const definition of whereUsed.definitions) {
      const definitionProvenance = makeProvenance("reef_where_used", this.generatedAt, dependenciesForPath(definition.filePath), {
        producer: definition.source,
      });
      const definitionNodeId = definition.kind === "route"
        ? this.addRouteNode({
            routeKey: definition.name,
            path: definition.filePath,
            source: "reef_where_used",
            confidence: 0.9,
            freshness,
            provenance: definitionProvenance,
            data: jsonObject({
              lineStart: definition.lineStart,
              lineEnd: definition.lineEnd,
              metadata: definition.metadata,
            }),
          })
        : this.addSymbolNode({
            path: definition.filePath,
            symbolName: definition.name,
            source: "reef_where_used",
            confidence: 0.9,
            freshness,
            provenance: definitionProvenance,
            data: jsonObject({
              symbolKind: definition.kind,
              lineStart: definition.lineStart,
              lineEnd: definition.lineEnd,
              metadata: definition.metadata,
            }),
          });
      const fileNodeId = this.addFileNode(definition.filePath, {
        source: "reef_where_used",
        confidence: 0.9,
        freshness,
        provenance: definitionProvenance,
      });
      this.addEdge(definition.kind === "route" ? "handles_route" : "defines", fileNodeId, definitionNodeId, {
        source: "reef_where_used",
        confidence: 0.9,
        freshness,
        provenance: definitionProvenance,
        label: definition.kind,
      });
      this.addEdge("depends_on", queryNodeId, definitionNodeId, {
        source: "reef_where_used",
        confidence: 0.75,
        freshness,
        provenance: definitionProvenance,
        label: "resolved definition",
      });
    }

    for (const usage of whereUsed.usages) {
      this.addStructuralUsage(usage, queryNodeId);
    }
    for (const finding of whereUsed.relatedFindings) {
      this.addProjectFinding(finding);
    }
  }

  addLiveTextSearch(liveTextSearch: NonNullable<BuildReefEvidenceGraphInput["liveTextSearch"]>): void {
    const freshness = {
      state: "fresh",
      checkedAt: this.generatedAt,
      reason: "live_text_search read the current filesystem for this query.",
    } satisfies FactFreshness;
    const provenanceValue = makeProvenance("live_text_search", this.generatedAt, [], {
      query: liveTextSearch.query,
    });
    for (const filePath of liveTextSearch.filesMatched) {
      this.addFileNode(filePath, {
        source: "live_text_search",
        confidence: 1,
        freshness,
        provenance: makeProvenance("live_text_search", this.generatedAt, dependenciesForPath(filePath), {
          query: liveTextSearch.query,
        }),
      });
    }
    for (const match of liveTextSearch.matches) {
      const fileNodeId = this.addFileNode(match.filePath, {
        source: "live_text_search",
        confidence: 1,
        freshness,
        provenance: makeProvenance("live_text_search", this.generatedAt, dependenciesForPath(match.filePath), {
          query: liveTextSearch.query,
        }),
      });
      const diagnosticNodeId = this.addNode({
        id: `diagnostic:live_text_search:${match.filePath}:${match.line}:${match.column}:${stablePart(liveTextSearch.query)}`,
        kind: "diagnostic",
        label: `match ${liveTextSearch.query}`,
        source: "live_text_search",
        confidence: 1,
        freshness,
        provenance: provenanceValue,
        data: jsonObject({
          query: liveTextSearch.query,
          filePath: match.filePath,
          line: match.line,
          column: match.column,
          text: match.text,
        }),
      });
      this.addEdge("mentions", fileNodeId, diagnosticNodeId, {
        source: "live_text_search",
        confidence: 1,
        freshness,
        provenance: provenanceValue,
        label: "literal match",
      });
    }
  }

  addVerification(verification: BuildReefEvidenceGraphInput["verification"]): void {
    for (const source of verification.sources) {
      const freshness = freshnessFromVerification(source, this.generatedAt);
      const provenanceValue = makeProvenance(source.source, this.generatedAt, [{ kind: "diagnostic_source", source: source.source }], {
        status: source.status,
        reason: source.reason,
      });
      const diagnosticNodeId = this.addNode({
        id: `diagnostic:source:${source.source}`,
        kind: "diagnostic",
        label: source.source,
        source: source.source,
        confidence: source.status === "fresh" ? 0.95 : 0.65,
        freshness,
        provenance: provenanceValue,
        data: jsonObject({
          status: source.status,
          reason: source.reason,
          suggestedActions: source.suggestedActions,
          lastRunId: source.lastRun?.runId,
          lastRunStatus: source.lastRun?.status,
        }),
      });
      for (const changedFile of verification.changedFiles) {
        if (!changedFile.staleForSources.includes(source.source) && source.status !== "fresh") continue;
        const fileNodeId = this.addFileNode(changedFile.filePath, {
          source: source.source,
          confidence: 0.7,
          freshness,
          provenance: makeProvenance(source.source, this.generatedAt, dependenciesForPath(changedFile.filePath), {
            lastModifiedAt: changedFile.lastModifiedAt,
          }),
        });
        this.addEdge("verified_by", fileNodeId, diagnosticNodeId, {
          source: source.source,
          confidence: 0.7,
          freshness,
          provenance: provenanceValue,
          label: source.status,
        });
      }
    }
  }

  toGraph(limits: { nodeLimit?: number; edgeLimit?: number }): ReefEvidenceGraph {
    const allNodes = [...this.nodes.values()].sort(compareNodes);
    const allNodeIds = new Set(allNodes.map((node) => node.id));
    const allEdges = [...this.edges.values()]
      .filter((edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to))
      .sort(compareEdges);

    const returnedNodes = limits.nodeLimit === undefined ? allNodes : allNodes.slice(0, limits.nodeLimit);
    const returnedNodeIds = new Set(returnedNodes.map((node) => node.id));
    const edgesWithReturnedEndpoints = allEdges.filter((edge) =>
      returnedNodeIds.has(edge.from) && returnedNodeIds.has(edge.to)
    );
    const returnedEdges = limits.edgeLimit === undefined
      ? edgesWithReturnedEndpoints
      : edgesWithReturnedEndpoints.slice(0, limits.edgeLimit);
    const droppedNodes = allNodes.length - returnedNodes.length;
    const droppedEdges = allEdges.length - returnedEdges.length;
    const warnings = [...this.warnings];
    if (droppedNodes > 0) {
      warnings.push(`Reef evidence graph omitted ${droppedNodes} node(s) due to the graph node limit.`);
    }
    if (droppedEdges > 0) {
      warnings.push(`Reef evidence graph omitted ${droppedEdges} edge(s) due to graph caps or omitted endpoint nodes.`);
    }

    return {
      generatedAt: this.generatedAt,
      ...(this.revision !== undefined ? { revision: this.revision } : {}),
      nodes: returnedNodes,
      edges: returnedEdges,
      coverage: graphCoverage(returnedNodes, returnedEdges),
      truncated: {
        nodes: droppedNodes > 0,
        edges: droppedEdges > 0,
        returnedNodes: returnedNodes.length,
        totalNodes: allNodes.length,
        droppedNodes,
        returnedEdges: returnedEdges.length,
        totalEdges: allEdges.length,
        droppedEdges,
        ...(limits.nodeLimit !== undefined ? { nodeLimit: limits.nodeLimit } : {}),
        ...(limits.edgeLimit !== undefined ? { edgeLimit: limits.edgeLimit } : {}),
      },
      warnings,
    };
  }

  private addSubjectNode(fact: ProjectFact): string | undefined {
    switch (fact.subject.kind) {
      case "file":
        return this.addFileNode(fact.subject.path, factNodeOptions(fact));
      case "symbol": {
        const symbolNodeId = this.addSymbolNode({
          path: fact.subject.path,
          symbolName: fact.subject.symbolName,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
          data: jsonObject({
            factKind: fact.kind,
            line: fact.subject.line,
            factData: fact.data,
          }),
        });
        const fileNodeId = this.addFileNode(fact.subject.path, factNodeOptions(fact));
        this.addEdge("defines", fileNodeId, symbolNodeId, factEdgeOptions(fact, "defines"));
        return symbolNodeId;
      }
      case "route":
        return this.addRouteNode({
          routeKey: fact.subject.routeKey,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
          data: jsonObject({
            factKind: fact.kind,
            factData: fact.data,
          }),
        });
      case "schema_object":
        return this.addDatabaseFactNode(fact);
      case "import_edge":
        return undefined;
      case "diagnostic": {
        const diagnosticNodeId = this.addNode({
          id: `diagnostic:${fact.subject.path}:${fact.subject.ruleId ?? fact.subject.code ?? fact.fingerprint}`,
          kind: "diagnostic",
          label: fact.subject.ruleId ?? fact.subject.code ?? fact.kind,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
          data: jsonObject({
            factKind: fact.kind,
            path: fact.subject.path,
            ruleId: fact.subject.ruleId,
            code: fact.subject.code,
            factData: fact.data,
          }),
        });
        const fileNodeId = this.addFileNode(fact.subject.path, factNodeOptions(fact));
        this.addEdge("verified_by", fileNodeId, diagnosticNodeId, factEdgeOptions(fact, "verified_by"));
        return diagnosticNodeId;
      }
    }
  }

  private addDatabaseFactNode(fact: ProjectFact): string {
    const schemaName = factSchemaName(fact);
    const tableName = factTableName(fact);
    const node = databaseFactNodeDescriptor(fact, schemaName, tableName);
    return this.addDatabaseNode({
      ...node,
      source: fact.source,
      overlay: fact.overlay,
      confidence: fact.confidence,
      freshness: fact.freshness,
      provenance: fact.provenance,
      data: jsonObject({
        factKind: fact.kind,
        fingerprint: fact.fingerprint,
        factData: fact.data,
      }),
    });
  }

  private addDatabaseFactRelationships(fact: ProjectFact, subjectNodeId: string): void {
    if (!fact.kind.startsWith("db_")) return;
    const schemaName = factSchemaName(fact);
    const tableName = factTableName(fact);
    const tableNodeId = tableName
      ? this.addDatabaseNode({
          kind: "table",
          schemaName,
          objectName: tableName,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
          data: jsonObject({
            schemaName,
            tableName,
          }),
        })
      : undefined;

    if (tableNodeId && subjectNodeId !== tableNodeId) {
      const edgeKind = fact.kind === "db_rls_policy" ? "protected_by_policy" : "defines";
      this.addEdge(edgeKind, tableNodeId, subjectNodeId, factEdgeOptions(fact, edgeKind));
    }

    if (fact.kind === "db_usage") {
      const filePath = jsonString(fact.data?.filePath);
      const objectType = jsonString(fact.data?.objectType);
      if (filePath) {
        const fileNodeId = this.addFileNode(filePath, factNodeOptions(fact));
        const edgeKind = edgeKindForDbUsage(jsonString(fact.data?.usageKind), objectType);
        this.addEdge(edgeKind, fileNodeId, subjectNodeId, factEdgeOptions(fact, edgeKind));
      }
    }

    if (fact.kind === "db_rpc_table_ref") {
      const rpcName = jsonString(fact.data?.rpcName);
      const rpcSchema = jsonString(fact.data?.rpcSchema) ?? schemaName;
      const targetSchema = jsonString(fact.data?.targetSchema);
      const targetTable = jsonString(fact.data?.targetTable);
      if (rpcName && targetTable) {
        const rpcNodeId = this.addDatabaseNode({
          kind: "rpc",
          schemaName: rpcSchema,
          objectName: rpcName,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
          data: jsonObject({
            rpcName,
            argTypes: fact.data?.argTypes,
          }),
        });
        const targetTableNodeId = this.addDatabaseNode({
          kind: "table",
          schemaName: targetSchema,
          objectName: targetTable,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
        });
        this.addEdge("reads_table", rpcNodeId, targetTableNodeId, factEdgeOptions(fact, "reads_table"));
      }
    }

    if (fact.kind === "db_foreign_key") {
      const targetSchema = jsonString(fact.data?.targetSchema);
      const targetTable = jsonString(fact.data?.targetTable);
      const sourceSchema = jsonString(fact.data?.sourceSchema);
      const sourceTable = jsonString(fact.data?.sourceTable);
      const relatedSchema = targetSchema ?? sourceSchema;
      const relatedTable = targetTable ?? sourceTable;
      if (relatedTable) {
        const relatedTableNodeId = this.addDatabaseNode({
          kind: "table",
          schemaName: relatedSchema,
          objectName: relatedTable,
          source: fact.source,
          overlay: fact.overlay,
          confidence: fact.confidence,
          freshness: fact.freshness,
          provenance: fact.provenance,
        });
        this.addEdge("references_column", subjectNodeId, relatedTableNodeId, factEdgeOptions(fact, "references_column"));
      }
    }
  }

  private addIndexedInteraction(
    interaction: ReefIndexedGraphInteraction,
    indexedGraph: ReefIndexedGraphEvidence,
  ): void {
    const provenanceValue = makeProvenance(
      indexedGraph.source,
      this.generatedAt,
      dependenciesForPath(interaction.sourcePath),
      {
        producer: "reef_artifact:code_interactions",
        kind: interaction.kind,
        targetName: interaction.targetName,
        targetPath: interaction.targetPath ?? null,
      },
    );
    const sourceFileNodeId = this.addFileNode(interaction.sourcePath, {
      source: indexedGraph.source,
      overlay: indexedGraph.overlay,
      confidence: interaction.confidence,
      freshness: indexedGraph.freshness,
      provenance: provenanceValue,
    });
    const fromNodeId = interaction.sourceSymbolName
      ? this.addSymbolNode({
          path: interaction.sourcePath,
          symbolName: interaction.sourceSymbolName,
          source: indexedGraph.source,
          overlay: indexedGraph.overlay,
          confidence: Math.max(0.65, interaction.confidence - 0.05),
          freshness: indexedGraph.freshness,
          provenance: provenanceValue,
        })
      : sourceFileNodeId;
    if (interaction.sourceSymbolName) {
      this.addEdge("defines", sourceFileNodeId, fromNodeId, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: Math.max(0.65, interaction.confidence - 0.05),
        freshness: indexedGraph.freshness,
        provenance: provenanceValue,
        label: "interaction source",
      });
    }

    const targetName = interactionTargetName(interaction.targetName);
    const targetDefinitionVerified = indexedGraphDefinesInteractionTarget(interaction, indexedGraph);
    const toNodeId = interaction.kind === "render"
      ? this.addComponentNode({
          path: interaction.targetPath,
          componentName: targetName,
          source: indexedGraph.source,
          overlay: indexedGraph.overlay,
          confidence: targetDefinitionVerified ? interaction.confidence : Math.min(interaction.confidence, 0.78),
          freshness: indexedGraph.freshness,
          provenance: provenanceValue,
          data: jsonObject({
            targetName: interaction.targetName,
            importSpecifier: interaction.importSpecifier,
            definitionVerified: targetDefinitionVerified,
          }),
        })
      : this.addSymbolNode({
          path: interaction.targetPath,
          symbolName: targetName,
          source: indexedGraph.source,
          overlay: indexedGraph.overlay,
          confidence: targetDefinitionVerified ? interaction.confidence : Math.min(interaction.confidence, 0.78),
          freshness: indexedGraph.freshness,
          provenance: provenanceValue,
          data: jsonObject({
            targetName: interaction.targetName,
            importSpecifier: interaction.importSpecifier,
            definitionVerified: targetDefinitionVerified,
          }),
        });
    if (interaction.targetPath) {
      const targetFileNodeId = this.addFileNode(interaction.targetPath, {
        source: indexedGraph.source,
        overlay: indexedGraph.overlay,
        confidence: Math.max(0.65, interaction.confidence - 0.05),
        freshness: indexedGraph.freshness,
        provenance: makeProvenance(indexedGraph.source, this.generatedAt, dependenciesForPath(interaction.targetPath), {
          producer: "reef_artifact:code_interactions",
        }),
      });
      if (targetDefinitionVerified) {
        this.addEdge("defines", targetFileNodeId, toNodeId, {
          source: indexedGraph.source,
          overlay: indexedGraph.overlay,
          confidence: Math.max(0.65, interaction.confidence - 0.05),
          freshness: indexedGraph.freshness,
          provenance: provenanceValue,
          label: interaction.kind === "render" ? "verified render target" : "verified call target",
        });
      }
    }

    const edgeKind = interaction.kind === "render" ? "renders" : "calls";
    this.addEdge(edgeKind, fromNodeId, toNodeId, {
      source: indexedGraph.source,
      overlay: indexedGraph.overlay,
      confidence: interaction.confidence,
      freshness: indexedGraph.freshness,
      provenance: provenanceValue,
      label: interaction.targetName,
      data: jsonObject({
        line: interaction.line,
        targetName: interaction.targetName,
        targetPath: interaction.targetPath,
        importSpecifier: interaction.importSpecifier,
      }),
    });
  }

  private addIndexedSchemaUsage(
    usage: ReefIndexedGraphSchemaUsage,
    indexedGraph: ReefIndexedGraphEvidence,
    baseProvenance: FactProvenance,
  ): void {
    const usageProvenance = makeProvenance(indexedGraph.source, this.generatedAt, dependenciesForPath(usage.filePath), {
      producer: "projectStore.listSchemaUsages",
      schemaName: usage.schemaName,
      objectName: usage.objectName,
      parentObjectName: usage.parentObjectName ?? null,
    });
    const fileNodeId = this.addFileNode(usage.filePath, {
      source: indexedGraph.source,
      overlay: indexedGraph.overlay,
      confidence: 0.9,
      freshness: indexedGraph.freshness,
      provenance: usageProvenance,
    });
    const databaseNodeId = this.addDatabaseNode({
      kind: nodeKindForDatabaseObjectType(usage.objectType),
      schemaName: usage.schemaName,
      objectName: databaseUsageObjectName(usage),
      source: indexedGraph.source,
      overlay: indexedGraph.overlay,
      confidence: 0.9,
      freshness: indexedGraph.freshness,
      provenance: baseProvenance,
      data: jsonObject({
        objectType: usage.objectType,
        schemaName: usage.schemaName,
        objectName: usage.objectName,
        parentObjectName: usage.parentObjectName,
        dataType: usage.dataType,
        definition: usage.definition,
      }),
    });
    const edgeKind = edgeKindForDbUsage(usage.usageKind, usage.objectType);
    this.addEdge(edgeKind, fileNodeId, databaseNodeId, {
      source: indexedGraph.source,
      overlay: indexedGraph.overlay,
      confidence: 0.9,
      freshness: indexedGraph.freshness,
      provenance: usageProvenance,
      label: usage.usageKind,
      data: jsonObject({
        usageKind: usage.usageKind,
        line: usage.line,
        excerpt: usage.excerpt,
      }),
    });
  }

  private addStructuralUsage(usage: ReefStructuralUsage, targetNodeId: string): void {
    const freshness = unknownFreshness(this.generatedAt, "Structural usage freshness follows maintained Reef state.");
    const provenanceValue = makeProvenance("reef_where_used", this.generatedAt, dependenciesForPath(usage.filePath), {
      producer: usage.provenance.producer,
      revision: usage.provenance.revision ?? null,
      reason: usage.reason,
    });
    const fileNodeId = this.addFileNode(usage.filePath, {
      source: "reef_where_used",
      confidence: 0.85,
      freshness,
      provenance: provenanceValue,
    });
    if (usage.targetPath) {
      const targetFileNodeId = this.addFileNode(usage.targetPath, {
        source: "reef_where_used",
        confidence: 0.85,
        freshness,
        provenance: provenanceValue,
      });
      const edgeKind = usage.usageKind === "import" ? "imports" : "depends_on";
      this.addEdge(edgeKind, fileNodeId, targetFileNodeId, {
        source: "reef_where_used",
        confidence: 0.85,
        freshness,
        provenance: provenanceValue,
        label: usage.usageKind,
        data: jsonObject({
          specifier: usage.specifier,
          line: usage.line,
        }),
      });
    }
    this.addEdge(usage.usageKind === "text_reference" ? "mentions" : "depends_on", fileNodeId, targetNodeId, {
      source: "reef_where_used",
      confidence: 0.8,
      freshness,
      provenance: provenanceValue,
      label: usage.usageKind,
      data: jsonObject({
        specifier: usage.specifier,
        line: usage.line,
      }),
    });
  }

  private addFileNode(
    path: string,
    options: {
      source: string;
      overlay?: ProjectOverlay;
      confidence: number;
      freshness: FactFreshness;
      provenance: FactProvenance;
      data?: JsonObject;
    },
  ): string {
    return this.addNode({
      id: fileNodeId(path),
      kind: "file",
      label: path,
      source: options.source,
      ...(options.overlay ? { overlay: options.overlay } : {}),
      confidence: options.confidence,
      freshness: options.freshness,
      provenance: options.provenance,
      data: mergeJsonObjects(jsonObject({ path }), options.data),
    });
  }

  private addSymbolNode(args: {
    path?: string;
    symbolName: string;
    source: string;
    overlay?: ProjectOverlay;
    confidence: number;
    freshness: FactFreshness;
    provenance: FactProvenance;
    data?: JsonObject;
  }): string {
    return this.addNode({
      id: symbolNodeId(args.path, args.symbolName),
      kind: "symbol",
      label: args.path ? `${args.symbolName} (${args.path})` : args.symbolName,
      source: args.source,
      ...(args.overlay ? { overlay: args.overlay } : {}),
      confidence: args.confidence,
      freshness: args.freshness,
      provenance: args.provenance,
      data: mergeJsonObjects(jsonObject({
        path: args.path,
        symbolName: args.symbolName,
      }), args.data),
    });
  }

  private addComponentNode(args: {
    path?: string;
    componentName: string;
    source: string;
    overlay?: ProjectOverlay;
    confidence: number;
    freshness: FactFreshness;
    provenance: FactProvenance;
    data?: JsonObject;
  }): string {
    return this.addNode({
      id: componentNodeId(args.path, args.componentName),
      kind: "component",
      label: args.path ? `${args.componentName} (${args.path})` : args.componentName,
      source: args.source,
      ...(args.overlay ? { overlay: args.overlay } : {}),
      confidence: args.confidence,
      freshness: args.freshness,
      provenance: args.provenance,
      data: mergeJsonObjects(jsonObject({
        path: args.path,
        componentName: args.componentName,
      }), args.data),
    });
  }

  private addRouteNode(args: {
    routeKey: string;
    path?: string;
    source: string;
    overlay?: ProjectOverlay;
    confidence: number;
    freshness: FactFreshness;
    provenance: FactProvenance;
    data?: JsonObject;
  }): string {
    return this.addNode({
      id: routeNodeId(args.routeKey),
      kind: "route",
      label: args.routeKey,
      source: args.source,
      ...(args.overlay ? { overlay: args.overlay } : {}),
      confidence: args.confidence,
      freshness: args.freshness,
      provenance: args.provenance,
      data: mergeJsonObjects(jsonObject({
        routeKey: args.routeKey,
        path: args.path,
      }), args.data),
    });
  }

  private addDatabaseNode(args: {
    kind: ReefGraphNodeKind;
    schemaName?: string;
    objectName: string;
    source: string;
    overlay?: ProjectOverlay;
    confidence: number;
    freshness: FactFreshness;
    provenance: FactProvenance;
    data?: JsonObject;
  }): string {
    const label = [args.schemaName, args.objectName].filter(Boolean).join(".");
    return this.addNode({
      id: databaseNodeId(args.kind, args.schemaName, args.objectName),
      kind: args.kind,
      label,
      source: args.source,
      ...(args.overlay ? { overlay: args.overlay } : {}),
      confidence: args.confidence,
      freshness: args.freshness,
      provenance: args.provenance,
      data: mergeJsonObjects(jsonObject({
        schemaName: args.schemaName,
        objectName: args.objectName,
      }), args.data),
    });
  }

  private addFindingNode(finding: ProjectFinding): string {
    return this.addNode({
      id: findingNodeId(finding),
      kind: "finding",
      label: finding.ruleId ?? finding.message,
      source: finding.source,
      overlay: finding.overlay,
      confidence: 0.95,
      freshness: finding.freshness,
      provenance: findingProvenance(finding),
      data: jsonObject({
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        status: finding.status,
        filePath: finding.filePath,
        line: finding.line,
        ruleId: finding.ruleId,
        message: finding.message,
        factFingerprints: finding.factFingerprints,
      }),
    });
  }

  private addFindingFingerprintNode(
    fingerprint: string,
    freshness: FactFreshness,
    provenanceValue: FactProvenance,
  ): string {
    return this.addNode({
      id: `finding:${fingerprint}`,
      kind: "finding",
      label: fingerprint,
      source: "tool_runs",
      overlay: "working_tree",
      confidence: 0.55,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({ fingerprint }),
    });
  }

  private addRuleNode(
    ruleId: string,
    source: string,
    freshness: FactFreshness,
    provenanceValue: FactProvenance,
  ): string {
    return this.addNode({
      id: `rule:${ruleId}`,
      kind: "rule",
      label: ruleId,
      source,
      confidence: 0.9,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({ ruleId }),
    });
  }

  private addConventionNode(
    convention: ProjectConvention,
    conventionGraph: ReefConventionGraphEvidence,
    provenanceValue: FactProvenance,
  ): string {
    return this.addNode({
      id: conventionNodeId(convention.id),
      kind: "convention",
      label: convention.title,
      source: convention.source,
      overlay: conventionGraph.overlay,
      confidence: convention.confidence,
      freshness: conventionGraph.freshness,
      provenance: provenanceValue,
      data: jsonObject({
        id: convention.id,
        kind: convention.kind,
        status: convention.status,
        filePath: convention.filePath,
        whyIncluded: convention.whyIncluded,
        evidence: convention.evidence,
        metadata: convention.metadata,
      }),
    });
  }

  private addDiagnosticRunNode(
    run: ReefDiagnosticRun,
    freshness: FactFreshness,
    provenanceValue: FactProvenance,
  ): string {
    return this.addNode({
      id: `diagnostic:run:${run.runId}`,
      kind: "diagnostic",
      label: `${run.source} ${run.status}`,
      source: run.source,
      overlay: run.overlay,
      confidence: run.status === "succeeded" ? 0.9 : 0.6,
      freshness,
      provenance: provenanceValue,
      data: jsonObject({
        runId: run.runId,
        source: run.source,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        checkedFileCount: run.checkedFileCount,
        findingCount: run.findingCount,
        persistedFindingCount: run.persistedFindingCount,
        command: run.command,
        cwd: run.cwd,
        configPath: run.configPath,
        errorText: run.errorText,
        metadata: run.metadata,
      }),
    });
  }

  private addCommandNode(args: {
    id: string;
    kind: "command" | "test";
    label: string;
    source: string;
    overlay?: ProjectOverlay;
    confidence: number;
    freshness: FactFreshness;
    provenance: FactProvenance;
    data?: JsonObject;
  }): string {
    return this.addNode({
      id: args.id,
      kind: args.kind,
      label: args.label,
      source: args.source,
      ...(args.overlay ? { overlay: args.overlay } : {}),
      confidence: args.confidence,
      freshness: args.freshness,
      provenance: args.provenance,
      data: args.data,
    });
  }

  private addToolRunPatch(args: {
    run: ReefOperationalGraphEvidence["toolRuns"][number];
    commandNodeId: string;
    freshness: FactFreshness;
    provenance: FactProvenance;
    patchEvidence: PatchToolRunEvidence;
  }): void {
    const patchNodeId = this.addNode({
      id: `patch:tool_run:${args.run.runId}`,
      kind: "patch",
      label: args.run.toolName,
      source: "tool_runs",
      confidence: args.run.outcome === "success" ? 0.82 : 0.5,
      freshness: args.freshness,
      provenance: args.provenance,
      data: jsonObject({
        runId: args.run.runId,
        toolName: args.run.toolName,
        outcome: args.run.outcome,
        filePaths: args.patchEvidence.filePaths,
        findingFingerprints: args.patchEvidence.findingFingerprints,
      }),
    });
    this.addEdge("calls", args.commandNodeId, patchNodeId, {
      source: "tool_runs",
      confidence: args.run.outcome === "success" ? 0.8 : 0.5,
      freshness: args.freshness,
      provenance: args.provenance,
      label: "produced patch",
    });
    for (const filePath of args.patchEvidence.filePaths) {
      const fileNodeId = this.addFileNode(filePath, {
        source: "tool_runs",
        overlay: "working_tree",
        confidence: args.run.outcome === "success" ? 0.8 : 0.5,
        freshness: args.freshness,
        provenance: makeProvenance("tool_runs", args.run.finishedAt, dependenciesForPath(filePath), {
          runId: args.run.runId,
          toolName: args.run.toolName,
        }),
      });
      this.addEdge("mentions", patchNodeId, fileNodeId, {
        source: "tool_runs",
        overlay: "working_tree",
        confidence: args.run.outcome === "success" ? 0.8 : 0.5,
        freshness: args.freshness,
        provenance: args.provenance,
        label: "touched file",
      });
    }
    for (const fingerprint of args.patchEvidence.findingFingerprints) {
      const findingNodeId = this.addFindingFingerprintNode(fingerprint, args.freshness, args.provenance);
      this.addEdge("resolved_by_patch", findingNodeId, patchNodeId, {
        source: "tool_runs",
        overlay: "working_tree",
        confidence: args.run.outcome === "success" ? 0.72 : 0.45,
        freshness: args.freshness,
        provenance: args.provenance,
        label: "resolved by edit run",
      });
    }
  }

  private addNode(node: ReefGraphNode): string {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, this.withRevision(node));
      return node.id;
    }
    this.nodes.set(node.id, mergeNodes(existing, this.withRevision(node)));
    return node.id;
  }

  private addEdge(
    kind: ReefGraphEdgeKind,
    from: string,
    to: string,
    options: {
      source: string;
      overlay?: ProjectOverlay;
      confidence: number;
      freshness: FactFreshness;
      provenance: FactProvenance;
      label?: string;
      data?: JsonObject;
    },
  ): string {
    const edge: ReefGraphEdge = this.withRevision({
      id: edgeNodeId(kind, from, to, options.source, options.label),
      kind,
      from,
      to,
      source: options.source,
      ...(options.overlay ? { overlay: options.overlay } : {}),
      confidence: options.confidence,
      freshness: options.freshness,
      provenance: options.provenance,
      ...(options.label ? { label: options.label } : {}),
      ...(options.data ? { data: options.data } : {}),
    });
    const existing = this.edges.get(edge.id);
    this.edges.set(edge.id, existing ? mergeEdges(existing, edge) : edge);
    return edge.id;
  }

  private withRevision<T extends ReefGraphNode | ReefGraphEdge>(value: T): T {
    if (value.revision !== undefined || this.revision === undefined) return value;
    return { ...value, revision: this.revision };
  }
}

function factNodeOptions(fact: ProjectFact): {
  source: string;
  overlay: ProjectOverlay;
  confidence: number;
  freshness: FactFreshness;
  provenance: FactProvenance;
  data: JsonObject;
} {
  return {
    source: fact.source,
    overlay: fact.overlay,
    confidence: fact.confidence,
    freshness: fact.freshness,
    provenance: fact.provenance,
    data: jsonObject({
      factKind: fact.kind,
      fingerprint: fact.fingerprint,
      factData: fact.data,
    }),
  };
}

function factEdgeOptions(fact: ProjectFact, edgeKind: ReefGraphEdgeKind): {
  source: string;
  overlay: ProjectOverlay;
  confidence: number;
  freshness: FactFreshness;
  provenance: FactProvenance;
  label: string;
  data: JsonObject;
} {
  return {
    source: fact.source,
    overlay: fact.overlay,
    confidence: fact.confidence,
    freshness: fact.freshness,
    provenance: fact.provenance,
    label: edgeKind,
    data: jsonObject({
      factKind: fact.kind,
      fingerprint: fact.fingerprint,
    }),
  };
}

function databaseFactNodeDescriptor(
  fact: ProjectFact,
  schemaName: string | undefined,
  tableName: string | undefined,
): {
  kind: ReefGraphNodeKind;
  schemaName?: string;
  objectName: string;
} {
  const subjectObjectName = fact.subject.kind === "schema_object"
    ? fact.subject.objectName
    : jsonString(fact.data?.objectName) ?? fact.kind;
  switch (fact.kind) {
    case "db_table":
      return { kind: "table", ...(schemaName ? { schemaName } : {}), objectName: tableName ?? subjectObjectName };
    case "db_column": {
      const columnName = jsonString(fact.data?.columnName) ?? lastPart(subjectObjectName);
      return {
        kind: "column",
        ...(schemaName ? { schemaName } : {}),
        objectName: tableName && columnName ? `${tableName}.${columnName}` : subjectObjectName,
      };
    }
    case "db_index": {
      const indexName = jsonString(fact.data?.indexName) ?? lastPart(subjectObjectName);
      return {
        kind: "index",
        ...(schemaName ? { schemaName } : {}),
        objectName: tableName && indexName ? `${tableName}.${indexName}` : subjectObjectName,
      };
    }
    case "db_foreign_key": {
      const constraintName = jsonString(fact.data?.constraintName) ?? lastPart(subjectObjectName);
      return {
        kind: "foreign_key",
        ...(schemaName ? { schemaName } : {}),
        objectName: tableName && constraintName ? `${tableName}.${constraintName}` : subjectObjectName,
      };
    }
    case "db_rls_policy": {
      const policyName = jsonString(fact.data?.policyName) ?? lastPart(subjectObjectName);
      return {
        kind: "rls_policy",
        ...(schemaName ? { schemaName } : {}),
        objectName: tableName && policyName ? `${tableName}.${policyName}` : subjectObjectName,
      };
    }
    case "db_rpc": {
      const rpcName = jsonString(fact.data?.rpcName) ?? subjectObjectName;
      return { kind: "rpc", ...(schemaName ? { schemaName } : {}), objectName: rpcName };
    }
    case "db_trigger": {
      const triggerName = jsonString(fact.data?.triggerName) ?? lastPart(subjectObjectName);
      return {
        kind: "trigger",
        ...(schemaName ? { schemaName } : {}),
        objectName: tableName && triggerName ? `${tableName}.${triggerName}` : subjectObjectName,
      };
    }
    default:
      return {
        kind: nodeKindForDatabaseObjectType(jsonString(fact.data?.objectType)),
        ...(schemaName ? { schemaName } : {}),
        objectName: jsonString(fact.data?.objectName) ?? subjectObjectName,
      };
  }
}

function nodeKindForDatabaseObjectType(objectType: string | undefined): ReefGraphNodeKind {
  switch (objectType) {
    case "table":
      return "table";
    case "column":
      return "column";
    case "index":
      return "index";
    case "foreign_key":
      return "foreign_key";
    case "policy":
    case "rls_policy":
      return "rls_policy";
    case "rpc":
    case "function":
      return "rpc";
    case "trigger":
      return "trigger";
    default:
      return "database_object";
  }
}

function edgeKindForDbUsage(usageKind: string | undefined, objectType: string | undefined): ReefGraphEdgeKind {
  if (objectType === "rpc" || objectType === "function") return "calls_rpc";
  switch (usageKind) {
    case "write":
    case "insert":
    case "update":
    case "delete":
      return "writes_table";
    case "column":
      return "references_column";
    default:
      return "reads_table";
  }
}

function databaseUsageObjectName(usage: ReefIndexedGraphSchemaUsage): string {
  if (usage.parentObjectName && usage.objectType === "column") {
    return `${usage.parentObjectName}.${usage.objectName}`;
  }
  return usage.objectName;
}

function factSchemaName(fact: ProjectFact): string | undefined {
  return jsonString(fact.data?.schemaName) ??
    jsonString(fact.data?.rpcSchema) ??
    (fact.subject.kind === "schema_object" ? fact.subject.schemaName : undefined);
}

function factTableName(fact: ProjectFact): string | undefined {
  return jsonString(fact.data?.tableName) ??
    jsonString(fact.data?.targetTable) ??
    (fact.kind === "db_table" && fact.subject.kind === "schema_object" ? fact.subject.objectName : undefined) ??
    (fact.subject.kind === "schema_object" ? fact.subject.objectName.split(".")[0] : undefined);
}

function findingProvenance(finding: ProjectFinding): FactProvenance {
  return makeProvenance(finding.source, finding.capturedAt, [
    { kind: "diagnostic_source", source: finding.source },
    ...(finding.filePath ? [{ kind: "file" as const, path: finding.filePath }] : []),
  ], {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId ?? null,
    status: finding.status,
  });
}

function conventionDependencies(convention: ProjectConvention): ReefCalculationDependency[] {
  const dependencies: ReefCalculationDependency[] = [];
  if (convention.filePath) {
    dependencies.push({ kind: "file", path: convention.filePath });
  }
  for (const filePath of convention.evidence.flatMap((evidence) => extractFilePaths(evidence))) {
    if (!dependencies.some((dependency) => dependency.kind === "file" && dependency.path === filePath)) {
      dependencies.push({ kind: "file", path: filePath });
    }
  }
  if (convention.id.startsWith("rule:")) {
    dependencies.push({ kind: "artifact_kind", artifactKind: "reef_rule_descriptor" });
  }
  if (dependencies.length === 0) {
    dependencies.push({ kind: "artifact_kind", artifactKind: "project_conventions" });
  }
  return dependencies;
}

function ruleRefFromConvention(convention: ProjectConvention): { source: string; ruleId: string } | undefined {
  const match = /^rule:([^:]+):(.+)$/.exec(convention.id);
  if (!match) return undefined;
  return { source: match[1], ruleId: match[2] };
}

function diagnosticRunProvenance(run: ReefDiagnosticRun): FactProvenance {
  return makeProvenance(run.source, run.finishedAt, [
    { kind: "diagnostic_source", source: run.source },
    ...requestedFilesForDiagnosticRun(run).map((path) => ({ kind: "file" as const, path })),
  ], {
    runId: run.runId,
    command: run.command ?? null,
    status: run.status,
  });
}

function diagnosticRunFreshness(
  run: ReefDiagnosticRun,
  operationalGraph: ReefOperationalGraphEvidence,
): FactFreshness {
  if (run.cache) {
    return {
      state: run.cache.state === "fresh" ? "fresh" : run.cache.state === "stale" ? "stale" : "unknown",
      checkedAt: run.cache.checkedAt,
      reason: run.cache.reason,
    };
  }
  if (run.status === "succeeded") {
    return {
      state: "fresh",
      checkedAt: run.finishedAt,
      reason: "Diagnostic run succeeded; no cache staleness label was attached.",
    };
  }
  return {
    state: operationalGraph.freshness.state,
    checkedAt: run.finishedAt,
    reason: `Diagnostic run completed with status ${run.status}.`,
  };
}

function isTestRun(run: ReefDiagnosticRun): boolean {
  const text = `${run.source} ${run.command ?? ""}`.toLowerCase();
  return /\b(test|vitest|jest|playwright|pytest|mocha|cypress)\b/.test(text);
}

function patchEvidenceFromToolRun(
  run: ReefOperationalGraphEvidence["toolRuns"][number],
): PatchToolRunEvidence | undefined {
  const summaries = [run.inputSummary, run.outputSummary].filter((value): value is JsonValue => value !== undefined);
  const filePathKeys = new Set([
    "file",
    "files",
    "filepath",
    "filepaths",
    "path",
    "paths",
    "changedfile",
    "changedfiles",
    "createdfile",
    "createdfiles",
    "deletedfile",
    "deletedfiles",
    "modifiedfile",
    "modifiedfiles",
    "touchedfile",
    "touchedfiles",
    "updatedfile",
    "updatedfiles",
  ]);
  const mutationFileKeys = new Set([
    "changedfile",
    "changedfiles",
    "createdfile",
    "createdfiles",
    "deletedfile",
    "deletedfiles",
    "modifiedfile",
    "modifiedfiles",
    "touchedfile",
    "touchedfiles",
    "updatedfile",
    "updatedfiles",
  ]);
  const findingKeys = new Set([
    "finding",
    "findings",
    "findingfingerprint",
    "findingfingerprints",
    "resolvedfinding",
    "resolvedfindings",
    "resolvedfindingfingerprint",
    "resolvedfindingfingerprints",
  ]);
  const rawFileStrings = summaries.flatMap((summary) => stringsForKeys(summary, filePathKeys));
  const filePaths = uniqueSorted(rawFileStrings.flatMap((value) => extractFilePaths(value.replace(/\\/g, "/"))));
  const findingFingerprints = uniqueSorted(summaries.flatMap((summary) => stringsForKeys(summary, findingKeys)));
  const hasPatchKey = summaries.some((summary) => hasKey(summary, mutationFileKeys) || hasKey(summary, findingKeys));
  const patchLikeTool = /\b(apply_patch|patch|edit|write|replace|modify|move|rename|delete|create)\b/i.test(run.toolName);
  if (!patchLikeTool && !hasPatchKey) {
    return undefined;
  }
  if (filePaths.length === 0 && findingFingerprints.length === 0) {
    return undefined;
  }
  return { filePaths, findingFingerprints };
}

function stringsForKeys(value: JsonValue, keys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  collectStringsForKeys(value, keys, out);
  return out;
}

function collectStringsForKeys(value: JsonValue, keys: ReadonlySet<string>, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsForKeys(item, keys, out);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(normalizeSummaryKey(key))) {
      collectStringValues(child, out);
    }
    collectStringsForKeys(child, keys, out);
  }
}

function collectStringValues(value: JsonValue, out: string[]): void {
  if (typeof value === "string" && value.length > 0) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      collectStringValues(child, out);
    }
  }
}

function hasKey(value: JsonValue, keys: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasKey(item, keys));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(normalizeSummaryKey(key)) || hasKey(child, keys)) {
      return true;
    }
  }
  return false;
}

function normalizeSummaryKey(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, "");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function requestedFilesForDiagnosticRun(run: ReefDiagnosticRun): string[] {
  const requestedFiles = run.metadata?.requestedFiles;
  return Array.isArray(requestedFiles)
    ? requestedFiles.filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0)
    : [];
}

function makeProvenance(
  source: string,
  capturedAt: string,
  dependencies: ReefCalculationDependency[],
  metadata?: JsonObject,
): FactProvenance {
  return {
    source,
    capturedAt,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function dependenciesForPath(path: string | undefined): ReefCalculationDependency[] {
  return path ? [{ kind: "file", path }] : [];
}

function freshnessFromIndex(detail: IndexFreshnessDetail | undefined, generatedAt: string): FactFreshness {
  if (!detail) {
    return unknownFreshness(generatedAt, "No file-level freshness metadata was attached to this graph node.");
  }
  return {
    state: detail.state === "fresh"
      ? "fresh"
      : detail.state === "unknown" || detail.state === "unindexed"
        ? "unknown"
        : "stale",
    checkedAt: detail.liveMtime ?? detail.indexedAt ?? generatedAt,
    reason: detail.reason,
  };
}

function freshnessFromVerification(source: VerificationSourceState, generatedAt: string): FactFreshness {
  if (source.status === "fresh") {
    return {
      state: "fresh",
      checkedAt: source.lastRun?.finishedAt ?? generatedAt,
      reason: source.reason,
    };
  }
  if (source.status === "unknown" || source.status === "unavailable") {
    return {
      state: "unknown",
      checkedAt: source.lastRun?.finishedAt ?? generatedAt,
      reason: source.reason,
    };
  }
  return {
    state: "stale",
    checkedAt: source.lastRun?.finishedAt ?? generatedAt,
    reason: source.reason,
  };
}

function unknownFreshness(checkedAt: string, reason: string): FactFreshness {
  return {
    state: "unknown",
    checkedAt,
    reason,
  };
}

function fileNodeId(path: string): string {
  return `file:${path}`;
}

function symbolNodeId(path: string | undefined, symbolName: string): string {
  return path ? `symbol:${path}#${symbolName}` : `symbol:${symbolName}`;
}

function componentNodeId(path: string | undefined, componentName: string): string {
  return path ? `component:${path}#${componentName}` : `component:${componentName}`;
}

function routeNodeId(routeKey: string): string {
  return `route:${routeKey}`;
}

function databaseNodeId(kind: ReefGraphNodeKind, schemaName: string | undefined, objectName: string): string {
  return `${kind}:${[schemaName, objectName].filter(Boolean).join(".")}`;
}

function findingNodeId(finding: ProjectFinding): string {
  return `finding:${finding.fingerprint}`;
}

function conventionNodeId(conventionId: string): string {
  return `convention:${conventionId}`;
}

function operationalNodeId(kind: "command" | "test", value: string): string {
  return `${kind}:${stablePart(value)}`;
}

function edgeNodeId(kind: ReefGraphEdgeKind, from: string, to: string, source: string, label: string | undefined): string {
  return `${kind}:${from}->${to}:${source}${label ? `:${stablePart(label)}` : ""}`;
}

function stablePart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function jsonString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function lastPart(value: string): string | undefined {
  const parts = value.split(".");
  return parts.at(-1);
}

function interactionTargetName(value: string): string {
  return value.trim() || value;
}

function indexedGraphDefinesInteractionTarget(
  interaction: ReefIndexedGraphInteraction,
  indexedGraph: ReefIndexedGraphEvidence,
): boolean {
  if (!interaction.targetPath) {
    return false;
  }
  const targetName = interactionTargetName(interaction.targetName);
  return indexedGraph.symbols.some((symbol) =>
    symbol.filePath === interaction.targetPath &&
    (symbol.name === targetName || symbol.exportName === targetName)
  );
}

function jsonObject(entries: Record<string, JsonValue | undefined>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function mergeJsonObjects(left: JsonObject, right: JsonObject | undefined): JsonObject {
  return right ? { ...left, ...right } : left;
}

function mergeNodes(left: ReefGraphNode, right: ReefGraphNode): ReefGraphNode {
  const preferred = evidenceRank(right) > evidenceRank(left) ? right : left;
  const other = preferred === right ? left : right;
  return {
    ...preferred,
    confidence: Math.max(left.confidence, right.confidence),
    data: mergeJsonObjects(other.data ?? {}, preferred.data),
  };
}

function mergeEdges(left: ReefGraphEdge, right: ReefGraphEdge): ReefGraphEdge {
  const preferred = evidenceRank(right) > evidenceRank(left) ? right : left;
  const other = preferred === right ? left : right;
  return {
    ...preferred,
    confidence: Math.max(left.confidence, right.confidence),
    data: mergeJsonObjects(other.data ?? {}, preferred.data),
  };
}

function evidenceRank(item: { confidence: number; freshness: FactFreshness }): number {
  const freshnessScore = item.freshness.state === "fresh" ? 2 : item.freshness.state === "stale" ? 1 : 0;
  return freshnessScore * 10 + item.confidence;
}

function compareNodes(left: ReefGraphNode, right: ReefGraphNode): number {
  return (NODE_KIND_ORDER.get(left.kind) ?? 999) - (NODE_KIND_ORDER.get(right.kind) ?? 999) ||
    right.confidence - left.confidence ||
    left.id.localeCompare(right.id);
}

function compareEdges(left: ReefGraphEdge, right: ReefGraphEdge): number {
  return (EDGE_KIND_ORDER.get(left.kind) ?? 999) - (EDGE_KIND_ORDER.get(right.kind) ?? 999) ||
    right.confidence - left.confidence ||
    left.id.localeCompare(right.id);
}

function graphCoverage(nodes: ReefGraphNode[], edges: ReefGraphEdge[]): ReefEvidenceGraph["coverage"] {
  const nodeKinds: Record<string, number> = {};
  const edgeKinds: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  for (const node of nodes) {
    nodeKinds[node.kind] = (nodeKinds[node.kind] ?? 0) + 1;
    sourceCounts[node.source] = (sourceCounts[node.source] ?? 0) + 1;
  }
  for (const edge of edges) {
    edgeKinds[edge.kind] = (edgeKinds[edge.kind] ?? 0) + 1;
    sourceCounts[edge.source] = (sourceCounts[edge.source] ?? 0) + 1;
  }
  return { nodeKinds, edgeKinds, sourceCounts };
}

function extractFilePaths(text: string): string[] {
  const matches = text.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|md)\b/g);
  return matches ? [...new Set(matches)] : [];
}
