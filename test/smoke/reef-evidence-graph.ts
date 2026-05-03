import assert from "node:assert/strict";
import type {
  FactFreshness,
  FactProvenance,
  ReefEvidenceGraph,
} from "../../packages/contracts/src/index.ts";
import { ReefEvidenceGraphSchema } from "../../packages/contracts/src/index.ts";
import { buildReefEvidenceGraph } from "../../packages/tools/src/reef/evidence-graph.ts";

const GENERATED_AT = "2026-05-03T12:00:00.000Z";
const PROJECT_ID = "project-graph-smoke";
const SOURCE_FILE = "src/auth/session.ts";
const TARGET_FILE = "src/db/client.ts";
const COMPONENT_FILE = "src/components/session-badge.tsx";
const TEST_COMMAND = "pnpm test -- --run src/auth/session.test.ts";

type GraphInput = Parameters<typeof buildReefEvidenceGraph>[0];

const fresh: FactFreshness = {
  state: "fresh",
  checkedAt: GENERATED_AT,
  reason: "Smoke fixture is current.",
};

const stale: FactFreshness = {
  state: "stale",
  checkedAt: GENERATED_AT,
  reason: "Smoke fixture intentionally marks diagnostics stale.",
};

const provenance: FactProvenance = {
  source: "smoke",
  capturedAt: GENERATED_AT,
  dependencies: [{ kind: "file", path: SOURCE_FILE }],
};

function makeInput(limits: Pick<GraphInput, "nodeLimit" | "edgeLimit"> = {}): GraphInput {
  return {
    generatedAt: GENERATED_AT,
    revision: 7,
    primaryContext: [],
    relatedContext: [],
    symbols: [],
    routes: [],
    databaseObjects: [],
    findings: [{
      projectId: PROJECT_ID,
      fingerprint: "finding-helper-bypass",
      source: "rule_pack:reuse.helper_bypass",
      subjectFingerprint: "file:src/auth/session.ts",
      overlay: "indexed",
      severity: "warning",
      status: "active",
      filePath: SOURCE_FILE,
      line: 12,
      ruleId: "reuse.helper_bypass",
      freshness: fresh,
      capturedAt: GENERATED_AT,
      message: "Session code bypasses the canonical auth helper.",
      factFingerprints: [],
    }],
    risks: [],
    instructions: [],
    openLoops: [],
    facts: [],
    indexedGraph: {
      source: "project_index",
      overlay: "indexed",
      freshness: fresh,
      files: [
        {
          path: SOURCE_FILE,
          language: "typescript",
          sizeBytes: 420,
          lineCount: 24,
          isGenerated: false,
          indexedAt: GENERATED_AT,
          lastModifiedAt: GENERATED_AT,
        },
        {
          path: TARGET_FILE,
          language: "typescript",
          sizeBytes: 180,
          lineCount: 9,
          isGenerated: false,
          indexedAt: GENERATED_AT,
          lastModifiedAt: GENERATED_AT,
        },
        {
          path: COMPONENT_FILE,
          language: "tsx",
          sizeBytes: 220,
          lineCount: 11,
          isGenerated: false,
          indexedAt: GENERATED_AT,
          lastModifiedAt: GENERATED_AT,
        },
      ],
      symbols: [{
        filePath: SOURCE_FILE,
        name: "getSession",
        kind: "function",
        exportName: "getSession",
        lineStart: 3,
        lineEnd: 14,
        signatureText: "export async function getSession()",
      }],
      imports: [{
        sourcePath: SOURCE_FILE,
        targetPath: TARGET_FILE,
        specifier: "@/db/client",
        importKind: "static",
        isTypeOnly: false,
        line: 1,
        targetExists: true,
      }],
      interactions: [
        {
          kind: "call",
          sourcePath: SOURCE_FILE,
          sourceSymbolName: "getSession",
          targetName: "createClient",
          targetPath: TARGET_FILE,
          importSpecifier: "@/db/client",
          line: 7,
          confidence: 0.84,
        },
        {
          kind: "render",
          sourcePath: SOURCE_FILE,
          sourceSymbolName: "SessionPanel",
          targetName: "SessionBadge",
          targetPath: COMPONENT_FILE,
          importSpecifier: "@/components/session-badge",
          line: 18,
          confidence: 0.86,
        },
      ],
      routes: [{
        filePath: SOURCE_FILE,
        routeKey: "GET /api/session",
        framework: "next",
        pattern: "/api/session",
        method: "GET",
        handlerName: "GET",
        isApi: true,
      }],
      schemaUsages: [{
        objectType: "table",
        schemaName: "public",
        objectName: "user_profiles",
        filePath: SOURCE_FILE,
        usageKind: "read",
        line: 8,
        excerpt: "from('user_profiles')",
      }],
      warnings: ["indexed warning"],
    },
    conventionGraph: {
      source: "project_conventions",
      overlay: "indexed",
      freshness: fresh,
      conventions: [{
        id: "rule:reef:reuse.helper_bypass",
        kind: "helper_usage",
        title: "Use canonical auth helpers",
        status: "accepted",
        source: "project_conventions",
        confidence: 0.86,
        whyIncluded: "Auth files should call through the canonical helper.",
        filePath: SOURCE_FILE,
        evidence: [`${SOURCE_FILE}:12`],
      }],
      warnings: [],
    },
    operationalGraph: {
      source: "reef_operations",
      overlay: "working_tree",
      freshness: stale,
      diagnosticRuns: [{
        runId: "run-tests-1",
        projectId: PROJECT_ID,
        source: "vitest",
        overlay: "working_tree",
        status: "succeeded",
        startedAt: GENERATED_AT,
        finishedAt: GENERATED_AT,
        durationMs: 1200,
        checkedFileCount: 1,
        findingCount: 0,
        persistedFindingCount: 0,
        command: TEST_COMMAND,
        cwd: "C:/repo",
        metadata: { requestedFiles: [SOURCE_FILE] },
      }],
      toolRuns: [{
        runId: "tool-run-1",
        projectId: PROJECT_ID,
        toolName: "reef_ask",
        inputSummary: { question: "where is session auth verified?" },
        outputSummary: { graphNodes: 12 },
        outcome: "success",
        startedAt: GENERATED_AT,
        finishedAt: GENERATED_AT,
        durationMs: 32,
        requestId: "request-1",
      }, {
        runId: "tool-run-2",
        projectId: PROJECT_ID,
        toolName: "apply_patch",
        inputSummary: { changedFiles: [SOURCE_FILE] },
        outputSummary: { resolvedFindingFingerprints: ["finding-helper-bypass"] },
        outcome: "success",
        startedAt: GENERATED_AT,
        finishedAt: GENERATED_AT,
        durationMs: 45,
        requestId: "request-1",
      }, {
        runId: "tool-run-3",
        projectId: PROJECT_ID,
        toolName: "write_file",
        inputSummary: { note: "summary without retained file paths" },
        outputSummary: { ok: true },
        outcome: "success",
        startedAt: GENERATED_AT,
        finishedAt: GENERATED_AT,
        durationMs: 25,
        requestId: "request-1",
      }],
      warnings: [],
    },
    verification: {
      status: "stale",
      sources: [{
        source: "eslint",
        status: "stale",
        reason: "Changed file has not been linted.",
        suggestedActions: ["Run eslint for the changed file."],
      }],
      changedFiles: [{
        filePath: SOURCE_FILE,
        lastModifiedAt: GENERATED_AT,
        staleForSources: ["eslint"],
      }],
      suggestedActions: ["Run eslint for the changed file."],
    },
    ...limits,
  };
}

function assertNoDanglingEdges(graph: ReefEvidenceGraph): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.from), `${edge.id} has missing from-node ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `${edge.id} has missing to-node ${edge.to}`);
  }
}

function assertUniqueIds(graph: ReefEvidenceGraph): void {
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length);
}

async function main(): Promise<void> {
  const full = buildReefEvidenceGraph(makeInput());
  ReefEvidenceGraphSchema.parse(full);
  assertUniqueIds(full);
  assertNoDanglingEdges(full);

  assert.equal(full.generatedAt, GENERATED_AT);
  assert.equal(full.revision, 7);
  assert.equal(full.truncated.nodes, false);
  assert.equal(full.truncated.edges, false);
  assert.ok(full.warnings.includes("indexed warning"));
  assert.ok(full.coverage.nodeKinds.file >= 2);
  assert.ok(full.coverage.nodeKinds.symbol >= 1);
  assert.ok(full.coverage.nodeKinds.route >= 1);
  assert.ok(full.coverage.nodeKinds.component >= 1);
  assert.ok(full.coverage.nodeKinds.table >= 1);
  assert.ok(full.coverage.nodeKinds.finding >= 1);
  assert.ok(full.coverage.nodeKinds.convention >= 1);
  assert.ok(full.coverage.nodeKinds.rule >= 1);
  assert.ok(full.coverage.nodeKinds.diagnostic >= 2);
  assert.ok(full.coverage.nodeKinds.test >= 1);
  assert.ok(full.coverage.nodeKinds.command >= 1);
  assert.ok(full.coverage.nodeKinds.session >= 1);
  assert.ok(full.coverage.nodeKinds.patch >= 1);
  assert.ok(full.coverage.edgeKinds.imports >= 1);
  assert.ok(full.coverage.edgeKinds.exports >= 1);
  assert.ok(full.coverage.edgeKinds.handles_route >= 1);
  assert.ok(full.coverage.edgeKinds.renders >= 1);
  assert.ok(full.coverage.edgeKinds.reads_table >= 1);
  assert.ok(full.coverage.edgeKinds.violates_rule >= 1);
  assert.ok(full.coverage.edgeKinds.learned_from >= 1);
  assert.ok(full.coverage.edgeKinds.verified_by >= 2);
  assert.ok(full.coverage.edgeKinds.calls >= 1);
  assert.ok(full.coverage.edgeKinds.resolved_by_patch >= 1);

  const sourceFile = full.nodes.find((node) => node.id === `file:${SOURCE_FILE}`);
  assert.ok(sourceFile);
  assert.equal(sourceFile.freshness.state, "fresh");
  assert.ok(sourceFile.provenance.dependencies?.some((dependency) =>
    dependency.kind === "file" &&
    dependency.path === SOURCE_FILE
  ) ?? false);
  assert.ok(full.nodes.some((node) => node.id === `symbol:${SOURCE_FILE}#getSession`));
  assert.ok(full.nodes.some((node) => node.id === `component:${COMPONENT_FILE}#SessionBadge`));
  assert.ok(full.nodes.some((node) => node.id === "route:GET /api/session"));
  assert.ok(full.nodes.some((node) => node.id === "table:public.user_profiles"));
  assert.ok(full.nodes.some((node) => node.id === "finding:finding-helper-bypass"));
  assert.ok(full.nodes.some((node) => node.id === "convention:rule:reef:reuse.helper_bypass"));
  assert.ok(full.nodes.some((node) => node.id === "rule:reuse.helper_bypass"));
  assert.ok(full.nodes.some((node) =>
    node.id === `test:${TEST_COMMAND}` &&
    node.freshness.state === "fresh"
  ));
  assert.ok(full.nodes.some((node) => node.id === "command:tool_run:tool-run-1"));
  assert.ok(full.nodes.some((node) => node.id === "patch:tool_run:tool-run-2"));
  assert.ok(!full.nodes.some((node) => node.id === "patch:tool_run:tool-run-3"));
  assert.ok(full.nodes.some((node) => node.id === "session:request-1"));
  assert.ok(full.nodes.some((node) =>
    node.id === "diagnostic:source:eslint" &&
    node.freshness.state === "stale"
  ));
  assert.ok(!full.edges.some((edge) =>
    edge.kind === "defines" &&
    edge.from === `file:${TARGET_FILE}` &&
    edge.to === `symbol:${TARGET_FILE}#createClient`
  ));

  const capped = buildReefEvidenceGraph(makeInput({ nodeLimit: 4, edgeLimit: 3 }));
  ReefEvidenceGraphSchema.parse(capped);
  assertUniqueIds(capped);
  assertNoDanglingEdges(capped);
  assert.equal(capped.nodes.length, 4);
  assert.equal(capped.edges.length <= 3, true);
  assert.equal(capped.truncated.nodes, true);
  assert.equal(capped.truncated.edges, true);
  assert.equal(capped.truncated.returnedNodes, capped.nodes.length);
  assert.equal(capped.truncated.returnedEdges, capped.edges.length);
  assert.ok(capped.truncated.totalNodes > capped.truncated.returnedNodes);
  assert.ok(capped.truncated.totalEdges > capped.truncated.returnedEdges);
  assert.ok(capped.warnings.some((warning) => warning.includes("omitted")));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
