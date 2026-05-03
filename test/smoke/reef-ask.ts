import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  FactSubject,
  ProjectFact,
  ProjectFinding,
  ReefAskToolOutput,
  ReefRuleDescriptor,
  ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { compileReefQuery, planReefQuery } from "../../packages/tools/src/reef/query-engine.ts";

function now(): string {
  return new Date().toISOString();
}

function writeFixtureFile(projectRoot: string, relPath: string, content: string): void {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content}\n`, "utf8");
}

function fileRecord(
  projectRoot: string,
  relPath: string,
  content: string,
  symbols: Array<{ name: string; kind: string; exportName?: string; lineStart?: number; lineEnd?: number }>,
  imports: Array<{ targetPath: string; specifier: string }>,
  routes: Array<{ routeKey: string; framework: string; pattern: string; method?: string; handlerName?: string; isApi?: boolean }> = [],
) {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  const stat = statSync(fullPath);
  return {
    path: relPath,
    sha256: relPath,
    language: "typescript" as const,
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
      importKind: "static" as const,
      isTypeOnly: false,
    })),
    routes,
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-ask-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  const projectId = randomUUID();
  const toolService = createToolService();

  try {
    seedProject(projectRoot, projectId);
    seedFinding(projectRoot, projectId);

    const result = await toolService.callTool("reef_ask", {
      projectId,
      question: "Plan the auth/session change that touches the user_profiles table",
      mode: "plan",
      focusFiles: ["lib/auth/session.ts"],
      focusDatabaseObjects: ["public.user_profiles"],
      maxOpenLoops: 10,
    }) as ReefAskToolOutput;

    assert.equal(result.toolName, "reef_ask");
    assert.equal(result.queryPlan.mode, "plan");
    assert.equal(result.evidence.mode, "compact");
    assert.equal(result.limits.evidenceMode, "compact");
    assert.equal(result.limits.maxEvidenceItemsPerSection, 40);
    assert.equal(result.evidence.sections.primaryContext.total, result.evidence.primaryContext.length);
    assert.ok(result.queryPlan.evidenceLanes.includes("codebase"));
    assert.ok(result.queryPlan.evidenceLanes.includes("database"));
    assert.ok(result.queryPlan.evidenceLanes.includes("conventions"));
    assert.ok(result.queryPlan.evidenceLanes.includes("operations"));
    assert.ok(result.evidence.primaryContext.length > 0);
    assert.ok(result.evidence.databaseObjects.some((object) =>
      object.schemaName === "public" &&
      object.objectName === "user_profiles"
    ));
    assert.ok(result.evidence.openLoops.some((loop) =>
      loop.kind === "active_finding" &&
      loop.filePath === "lib/auth/session.ts"
    ));
    const graph = result.evidence.graph;
    assert.equal(result.evidence.sections["graph.nodes"]?.returned, graph.nodes.length);
    assert.equal(result.evidence.sections["graph.edges"]?.returned, graph.edges.length);
    assert.equal(graph.truncated.returnedNodes, graph.nodes.length);
    assert.equal(graph.truncated.returnedEdges, graph.edges.length);
    assert.equal(result.queryPlan.graphSummary.returnedNodes, graph.nodes.length);
    assert.equal(result.queryPlan.graphSummary.returnedEdges, graph.edges.length);
    assert.equal(result.queryPlan.graphSummary.totalNodes, graph.truncated.totalNodes);
    assert.equal(result.queryPlan.graphSummary.totalEdges, graph.truncated.totalEdges);
    assert.deepEqual(result.queryPlan.graphSummary.nodeKinds, graph.coverage.nodeKinds);
    assert.ok(graph.coverage.nodeKinds.file >= 2);
    assert.ok(graph.coverage.nodeKinds.symbol >= 1);
    assert.ok(graph.coverage.nodeKinds.table >= 1);
    assert.ok(graph.coverage.nodeKinds.finding >= 1);
    const fileNode = graph.nodes.find((node) => node.id === "file:lib/auth/session.ts");
    assert.ok(fileNode);
    assert.ok(fileNode.provenance.dependencies?.some((dependency) =>
      dependency.kind === "file" &&
      dependency.path === "lib/auth/session.ts"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "symbol:lib/auth/session.ts#getSession" &&
      node.kind === "symbol"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "table:public.user_profiles" &&
      node.kind === "table" &&
      node.freshness.state === "fresh"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "column:public.user_profiles.subject" &&
      node.kind === "column"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "rls_policy:public.user_profiles.user_owner_policy" &&
      node.kind === "rls_policy"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "defines" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to === "symbol:lib/auth/session.ts#getSession"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "exports" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to === "symbol:lib/auth/session.ts#getSession"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "imports" &&
      edge.from === "file:app/api/session/route.ts" &&
      edge.to === "file:lib/auth/session.ts"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "route:GET /api/session" &&
      node.kind === "route"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "handles_route" &&
      edge.from === "file:app/api/session/route.ts" &&
      edge.to === "route:GET /api/session"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "reads_table" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to === "table:public.user_profiles"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "convention:profile:server_only:lib/auth/session.ts" &&
      node.kind === "convention"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "depends_on" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to === "convention:profile:server_only:lib/auth/session.ts"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "convention:rule:lint_files:auth.session_profile_rule" &&
      node.kind === "convention"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "learned_from" &&
      edge.from === "convention:rule:lint_files:auth.session_profile_rule" &&
      edge.to === "rule:auth.session_profile_rule"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "command:fixture lint_files" &&
      node.kind === "command"
    ));
    assert.ok(graph.nodes.some((node) =>
      node.id === "test:pnpm test -- --run lib/auth/session.ts" &&
      node.kind === "test"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "verified_by" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to === "test:pnpm test -- --run lib/auth/session.ts"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "verified_by" &&
      edge.from === "test:pnpm test -- --run lib/auth/session.ts" &&
      edge.to.startsWith("diagnostic:run:")
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "protected_by_policy" &&
      edge.from === "table:public.user_profiles" &&
      edge.to === "rls_policy:public.user_profiles.user_owner_policy"
    ));
    assert.ok(graph.edges.some((edge) =>
      edge.kind === "violates_rule" &&
      edge.from === "file:lib/auth/session.ts" &&
      edge.to.startsWith("finding:")
    ));
    assert.equal(result.evidence.verification.status, "fresh");
    const diagnosticSummary = result.answer.diagnosticSummary;
    assert.ok(diagnosticSummary);
    assert.equal(diagnosticSummary.gate, "review_required");
    assert.equal(diagnosticSummary.canClaimVerified, false);
    assert.equal(diagnosticSummary.verificationStatus, "fresh");
    assert.equal(diagnosticSummary.sourceCounts.fresh, 2);
    assert.equal(diagnosticSummary.openLoopCounts.warnings, 1);
    assert.ok(diagnosticSummary.sources.some((source) =>
      source.source === "lint_files" &&
      source.status === "fresh"
    ));
    assert.ok(diagnosticSummary.recentRuns.some((run) =>
      run.source === "lint_files" &&
      run.status === "succeeded"
    ));
    assert.ok(result.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "context_compile" &&
      entry.status === "included" &&
      entry.evidenceCount > 0
    ));
    assert.ok(result.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "live_text_search" &&
      entry.status === "skipped" &&
      entry.fallback?.includes("quoted literal")
    ));
    assert.ok(result.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "verification_state" &&
      entry.status === "included" &&
      entry.evidenceCount > 0
    ));
    assert.ok(result.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "project_conventions" &&
      entry.status === "included" &&
      entry.evidenceCount > 0
    ));
    assert.ok(result.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "reef_operations_graph" &&
      entry.status === "included" &&
      entry.evidenceCount > 0
    ));
    assert.ok(result.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "table_neighborhood" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));
    assert.ok(result.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "diagnostic_coverage" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));
    assert.ok(result.answer.decisionTrace.calculations.some((calculation) =>
      calculation.nodeId === "reef.query.table_neighborhood" &&
      calculation.status === "included"
    ));
    assert.deepEqual(result.answer.decisionTrace.lowConfidenceFallbacks, []);
    assert.match(result.answer.summary, /Reef found/);
    assert.match(result.answer.summary, /Diagnostic gate is review_required/);
    assert.equal(result.reefExecution.queryPath, "reef_materialized_view");

    const enginePlan = planReefQuery({
      projectId,
      question: "Plan the auth/session change that touches the user_profiles table",
      mode: "plan",
      focusFiles: ["lib/auth/session.ts"],
      focusDatabaseObjects: ["public.user_profiles"],
      includeVerification: false,
    });
    assert.equal(enginePlan.mode, "plan");
    assert.equal(enginePlan.contextInput.request, "Plan the auth/session change that touches the user_profiles table");
    assert.deepEqual(enginePlan.verificationFiles, ["lib/auth/session.ts"]);
    assert.equal(enginePlan.tableNeighborhood?.tableName, "user_profiles");

    const exactPlan = planReefQuery({
      projectId,
      question: "Find exact string supabase.rpc(",
      includeVerification: false,
    });
    assert.equal(exactPlan.liveTextSearch?.query, "supabase.rpc(");

    const rpcPlan = planReefQuery({
      projectId,
      question: "List all RPCs in the project",
      includeVerification: false,
    });
    assert.deepEqual(rpcPlan.reefFactQueries.map((query) => query.kind), ["db_rpc"]);

    const databaseObjectPlan = planReefQuery({
      projectId,
      question: "What columns and RLS policies are on user_profiles?",
      includeVerification: false,
    });
    assert.equal(databaseObjectPlan.databaseObject?.objectName, "user_profiles");
    assert.equal(databaseObjectPlan.tableNeighborhood?.tableName, "user_profiles");

    const rpcObjectPlan = planReefQuery({
      projectId,
      question: "What does RPC search_users touch?",
      includeVerification: false,
    });
    assert.equal(rpcObjectPlan.databaseObject?.objectName, "search_users");
    assert.equal(rpcObjectPlan.rpcNeighborhood?.rpcName, "search_users");

    const findingsPlan = planReefQuery({
      projectId,
      question: "Find durable auth bypass findings",
      includeVerification: false,
    });
    assert.ok(findingsPlan.projectFindings);

    const duplicatePlan = planReefQuery({
      projectId,
      question: "Find duplicate auth bypass findings",
      includeVerification: false,
    });
    assert.ok(duplicatePlan.projectFindings);
    assert.ok(duplicatePlan.duplicateCandidates);

    const whereUsedPlan = planReefQuery({
      projectId,
      question: "What uses getSession?",
      includeVerification: false,
    });
    assert.equal(whereUsedPlan.whereUsed?.query, "getSession");
    assert.equal(whereUsedPlan.whereUsed?.targetKind, "symbol");

    const compiled = await compileReefQuery({
      projectId,
      question: "Plan the auth/session change that touches the user_profiles table",
      mode: "plan",
      focusFiles: ["lib/auth/session.ts"],
      focusDatabaseObjects: ["public.user_profiles"],
      includeVerification: false,
    }, {});
    assert.equal(compiled.projectId, projectId);
    assert.equal("toolName" in compiled, false);
    assert.equal(compiled.freshness.diagnostics, "skipped");
    assert.ok(compiled.queryPlan.evidenceLanes.includes("database"));

    const exact = await toolService.callTool("reef_ask", {
      projectId,
      question: "Find exact string \"getSession\"",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(exact.queryPlan.evidenceLanes.includes("live_text"));
    const exactLiveTextSearch = exact.evidence.liveTextSearch;
    assert.ok(exactLiveTextSearch);
    assert.equal(exactLiveTextSearch.query, "getSession");
    assert.ok(exactLiveTextSearch.matches.some((match) => match.filePath === "lib/auth/session.ts"));
    const literalMatchesSummary = exact.answer.literalMatchesSummary;
    assert.ok(literalMatchesSummary);
    assert.equal(literalMatchesSummary.query, "getSession");
    assert.ok(literalMatchesSummary.files.some((file) =>
      file.filePath === "lib/auth/session.ts" &&
      file.matchCount > 0
    ));
    assert.ok(exact.queryPlan.engineSteps.some((step) =>
      step.name === "live_text_search" &&
      step.status === "included" &&
      step.returnedCount > 0
    ));
    assert.ok(exact.answer.decisionTrace.entries.some((entry) =>
      entry.lane === "live_text_search" &&
      entry.status === "included" &&
      entry.evidenceCount > 0
    ));

    const compactExact = await toolService.callTool("reef_ask", {
      projectId,
      question: "Find exact string \"getSession\"",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
      maxEvidenceItemsPerSection: 1,
    }) as ReefAskToolOutput;
    assert.equal(compactExact.evidence.liveTextSearch?.matches.length, 1);
    assert.equal(compactExact.evidence.sections["liveTextSearch.matches"]?.returned, 1);
    assert.equal(compactExact.evidence.sections["liveTextSearch.matches"]?.truncated, true);
    assert.ok(compactExact.warnings.some((warning) =>
      warning.includes("evidence payload compacted")
    ));

    const fullExact = await toolService.callTool("reef_ask", {
      projectId,
      question: "Find exact string \"getSession\"",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
      evidenceMode: "full",
      maxEvidenceItemsPerSection: 1,
    }) as ReefAskToolOutput;
    assert.equal(fullExact.evidence.mode, "full");
    assert.equal(fullExact.evidence.liveTextSearch?.matches.length, compactExact.evidence.sections["liveTextSearch.matches"]?.total);
    assert.equal(fullExact.evidence.sections["liveTextSearch.matches"]?.truncated, false);
    assert.ok(fullExact.warnings.every((warning) =>
      !warning.includes("evidence payload compacted")
    ));

    const whereUsed = await toolService.callTool("reef_ask", {
      projectId,
      question: "What uses getSession?",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(whereUsed.queryPlan.evidenceLanes.includes("usage"));
    const whereUsedEvidence = whereUsed.evidence.whereUsed;
    assert.ok(whereUsedEvidence);
    assert.ok(whereUsedEvidence.definitions.some((definition) =>
      definition.filePath === "lib/auth/session.ts" &&
      definition.name === "getSession"
    ));
    assert.ok(whereUsedEvidence.usages.some((usage) =>
      usage.filePath === "app/api/session/route.ts"
    ));
    const whereUsedSummary = whereUsed.answer.whereUsedSummary;
    assert.ok(whereUsedSummary);
    assert.equal(whereUsedSummary.query, "getSession");
    assert.ok(whereUsedSummary.usageCount > 0);
    assert.ok(whereUsed.queryPlan.engineSteps.some((step) =>
      step.name === "reef_where_used" &&
      step.status === "included" &&
      step.returnedCount > 0
    ));
    assert.ok(whereUsed.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "where_used" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));

    const rpcInventory = await toolService.callTool("reef_ask", {
      projectId,
      question: "List all RPCs in the project",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(rpcInventory.queryPlan.evidenceLanes.includes("facts"));
    assert.ok(rpcInventory.queryPlan.evidenceLanes.includes("database"));
    assert.ok(rpcInventory.evidence.facts.some((fact) =>
      fact.kind === "db_rpc" &&
      fact.data?.rpcName === "search_users"
    ));
    const inventorySummary = rpcInventory.answer.inventorySummary;
    assert.ok(inventorySummary);
    assert.equal(inventorySummary.byKind.db_rpc, 2);
    assert.ok(inventorySummary.items.some((item) =>
      item.kind === "db_rpc" &&
      item.name === "public.search_users(text)"
    ));
    assert.ok(rpcInventory.queryPlan.engineSteps.some((step) =>
      step.name === "reef_fact_inventory" &&
      step.status === "included" &&
      step.returnedCount >= 2
    ));

    const databaseObject = await toolService.callTool("reef_ask", {
      projectId,
      question: "What columns and RLS policies are on user_profiles?",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(databaseObject.queryPlan.evidenceLanes.includes("database"));
    assert.ok(databaseObject.queryPlan.evidenceLanes.includes("facts"));
    assert.ok(databaseObject.evidence.facts.some((fact) =>
      fact.kind === "db_column" &&
      fact.data?.columnName === "subject"
    ));
    const databaseObjectSummary = databaseObject.answer.databaseObjectSummary;
    assert.ok(databaseObjectSummary);
    assert.equal(databaseObjectSummary.objectName, "user_profiles");
    assert.equal(databaseObjectSummary.table?.rlsEnabled, true);
    assert.ok(databaseObjectSummary.columns.some((column) =>
      column.name === "subject" &&
      column.dataType === "text" &&
      column.nullable === false
    ));
    assert.ok(databaseObjectSummary.rlsPolicies.some((policy) =>
      policy.name === "user_owner_policy" &&
      policy.command === "select"
    ));
    assert.ok(databaseObject.queryPlan.engineSteps.some((step) =>
      step.name === "reef_database_object" &&
      step.status === "included" &&
      step.returnedCount > 0
    ));
    assert.ok(databaseObject.queryPlan.engineSteps.some((step) =>
      step.name === "reef_table_neighborhood" &&
      step.status === "included" &&
      step.returnedCount > 0
    ));
    assert.ok(databaseObject.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "table_neighborhood" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));
    const tableNeighborhood = databaseObject.evidence.tableNeighborhood;
    assert.ok(tableNeighborhood);
    assert.equal(tableNeighborhood.tableName, "user_profiles");
    assert.ok(tableNeighborhood.reads.entries.some((entry) =>
      entry.filePath === "lib/auth/session.ts"
    ));
    assert.equal(
      databaseObject.evidence.sections["tableNeighborhood.reads"]?.returned,
      tableNeighborhood.reads.entries.length,
    );
    assert.ok(databaseObject.evidence.sections["tableNeighborhood.dependentRpcs"]);

    const impact = await toolService.callTool("reef_ask", {
      projectId,
      question: "What is the impact of getSession?",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(impact.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "where_used" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));
    const impactCalculation = impact.queryPlan.calculations.find((calculation) =>
      calculation.queryKind === "impact"
    );
    assert.ok(impactCalculation);
    assert.equal(impactCalculation.status, "skipped");
    assert.match(impactCalculation.reason, /reef_diff_impact/);

    const durableFindings = await toolService.callTool("reef_ask", {
      projectId,
      question: "Find durable auth bypass findings",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(durableFindings.queryPlan.evidenceLanes.includes("findings"));
    assert.ok(durableFindings.evidence.findings.some((finding) =>
      finding.ruleId === "auth.session_profile_rule" &&
      finding.filePath === "lib/auth/session.ts"
    ));
    const findingsSummary = durableFindings.answer.findingsSummary;
    assert.ok(findingsSummary);
    assert.equal(findingsSummary.bySeverity.warning, 1);
    assert.ok(findingsSummary.items.some((finding) =>
      finding.ruleId === "auth.session_profile_rule" &&
      finding.filePath === "lib/auth/session.ts"
    ));
    assert.ok(durableFindings.queryPlan.engineSteps.some((step) =>
      step.name === "project_findings" &&
      step.status === "included" &&
      step.returnedCount > 0
    ));
    assert.ok(durableFindings.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "active_finding_status" &&
      calculation.status === "included" &&
      calculation.returnedCount > 0
    ));

    const duplicateFindings = await toolService.callTool("reef_ask", {
      projectId,
      question: "Find duplicate auth bypass findings",
      includeOpenLoops: false,
      includeVerification: false,
      includeInstructions: false,
      includeRisks: false,
    }) as ReefAskToolOutput;
    assert.ok(duplicateFindings.queryPlan.calculations.some((calculation) =>
      calculation.queryKind === "duplicate_candidates" &&
      calculation.status === "included"
    ));

    const batch = await toolService.callTool("tool_batch", {
      projectId,
      ops: [{
        label: "ask",
        tool: "reef_ask",
        args: {
          question: "What knows about user_profiles?",
          focusDatabaseObjects: ["public.user_profiles"],
          includeVerification: false,
        },
      }],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.succeededOps, 1);
    assert.equal(batch.results[0]?.tool, "reef_ask");

    console.log("reef-ask: PASS");
  } finally {
    toolService.close();
    if (priorStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = priorStateHome;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function seedProject(projectRoot: string, projectId: string): void {
  const sessionContent = [
    "export async function getSession() {",
    "  return { userId: 'u1', role: 'admin' };",
    "}",
  ].join("\n");
  const routeContent = [
    "import { getSession } from '../../../lib/auth/session';",
    "export async function GET() {",
    "  return Response.json(await getSession());",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-ask-smoke" }), "utf8");
  writeFixtureFile(projectRoot, "lib/auth/session.ts", sessionContent);
  writeFixtureFile(projectRoot, "app/api/session/route.ts", routeContent);
  writeFixtureFile(projectRoot, "AGENTS.md", "Auth and database changes must preserve user profile access rules.");

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "reef-ask-smoke",
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
      name: "reef-ask-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: ["lib/auth/session.ts"],
      authGuardSymbols: ["getSession"],
      supportLevel: "best_effort",
      detectedAt: now(),
    });
    store.replaceIndexSnapshot({
      files: [
        fileRecord(
          projectRoot,
          "lib/auth/session.ts",
          sessionContent,
          [{ name: "getSession", kind: "function", exportName: "getSession", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "app/api/session/route.ts",
          routeContent,
          [{ name: "GET", kind: "function", exportName: "GET", lineStart: 2, lineEnd: 4 }],
          [{ targetPath: "lib/auth/session.ts", specifier: "../../../lib/auth/session" }],
          [{
            routeKey: "GET /api/session",
            framework: "nextjs",
            pattern: "/api/session",
            method: "GET",
            handlerName: "GET",
            isApi: true,
          }],
        ),
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
        line: 2,
        excerpt: "return { userId: 'u1', role: 'admin' };",
      }],
    });
    store.saveReefDiagnosticRun({
      projectId,
      source: "lint_files",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 5,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture lint_files",
      cwd: projectRoot,
      metadata: { requestedFiles: ["lib/auth/session.ts"] },
    });
    store.saveReefDiagnosticRun({
      projectId,
      source: "vitest",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 17,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "pnpm test -- --run lib/auth/session.ts",
      cwd: projectRoot,
      metadata: { requestedFiles: ["lib/auth/session.ts"] },
    });
    const rpcFacts = [
      dbRpcFact(store, projectId, "search_users", ["text"]),
      dbRpcFact(store, projectId, "sync_user_profile", ["uuid"]),
      dbSchemaFact(store, projectId, "db_table", "user_profiles", {
        schemaName: "public",
        tableName: "user_profiles",
        columnCount: 3,
        primaryKey: ["id"],
        indexCount: 1,
        outboundForeignKeyCount: 0,
        inboundForeignKeyCount: 0,
        rlsEnabled: true,
        forceRls: false,
        policyCount: 1,
        triggerCount: 0,
      }),
      dbSchemaFact(store, projectId, "db_column", "user_profiles.id", {
        schemaName: "public",
        tableName: "user_profiles",
        columnName: "id",
        dataType: "uuid",
        nullable: false,
        defaultExpression: null,
        isPrimaryKey: true,
      }),
      dbSchemaFact(store, projectId, "db_column", "user_profiles.subject", {
        schemaName: "public",
        tableName: "user_profiles",
        columnName: "subject",
        dataType: "text",
        nullable: false,
        defaultExpression: null,
        isPrimaryKey: false,
      }),
      dbSchemaFact(store, projectId, "db_rls_policy", "user_profiles.user_owner_policy", {
        schemaName: "public",
        tableName: "user_profiles",
        policyName: "user_owner_policy",
        mode: "permissive",
        command: "select",
        roles: ["authenticated"],
        usingExpression: "auth.uid() = id",
        withCheckExpression: null,
      }),
    ];
    store.upsertReefFacts(rpcFacts);
    store.saveReefRuleDescriptors([authRuleDescriptor()]);
  } finally {
    store.close();
  }
}

function authRuleDescriptor(): ReefRuleDescriptor {
  return {
    id: "auth.session_profile_rule",
    version: "1.0.0",
    source: "lint_files",
    sourceNamespace: "lint",
    type: "problem",
    severity: "warning",
    title: "Session profile access",
    description: "Auth session helpers own profile access rules.",
    factKinds: ["diagnostic"],
    enabledByDefault: true,
  };
}

function dbRpcFact(
  store: ReturnType<typeof openProjectStore>,
  projectId: string,
  rpcName: string,
  argTypes: string[],
): ProjectFact {
  const subject: FactSubject = {
    kind: "schema_object",
    schemaName: "public",
    objectName: `${rpcName}(${argTypes.join(",")})`,
  };
  const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
  const data = {
    schemaName: "public",
    rpcName,
    argTypes,
    returnType: "jsonb",
    hasBodyText: true,
  };
  return {
    projectId,
    kind: "db_rpc",
    subject,
    subjectFingerprint,
    overlay: "indexed",
    source: "db_reef_refresh",
    confidence: 0.98,
    fingerprint: store.computeReefFactFingerprint({
      projectId,
      kind: "db_rpc",
      subjectFingerprint,
      overlay: "indexed",
      source: "db_reef_refresh",
      data,
    }),
    freshness: {
      state: "fresh",
      checkedAt: now(),
      reason: "fixture DB Reef fact",
    },
    provenance: {
      source: "db_reef_refresh",
      capturedAt: now(),
      dependencies: [{ kind: "schema_snapshot" }],
    },
    data,
  };
}

function dbSchemaFact(
  store: ReturnType<typeof openProjectStore>,
  projectId: string,
  kind: string,
  objectName: string,
  data: NonNullable<ProjectFact["data"]>,
): ProjectFact {
  const subject: FactSubject = {
    kind: "schema_object",
    schemaName: "public",
    objectName,
  };
  const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
  return {
    projectId,
    kind,
    subject,
    subjectFingerprint,
    overlay: "indexed",
    source: "db_reef_refresh",
    confidence: 0.98,
    fingerprint: store.computeReefFactFingerprint({
      projectId,
      kind,
      subjectFingerprint,
      overlay: "indexed",
      source: "db_reef_refresh",
      data,
    }),
    freshness: {
      state: "fresh",
      checkedAt: now(),
      reason: "fixture DB Reef fact",
    },
    provenance: {
      source: "db_reef_refresh",
      capturedAt: now(),
      dependencies: [{ kind: "schema_snapshot" }],
    },
    data,
  };
}

function seedFinding(projectRoot: string, projectId: string): void {
  const store = openProjectStore({ projectRoot });
  try {
    const subject = {
      kind: "diagnostic" as const,
      path: "lib/auth/session.ts",
      code: "auth.session_profile_rule",
    };
    const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
    const finding: ProjectFinding = {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "lint_files",
        ruleId: "auth.session_profile_rule",
        subjectFingerprint,
        message: "Session helper owns profile access rules.",
      }),
      source: "lint_files",
      subjectFingerprint,
      overlay: "working_tree",
      severity: "warning",
      status: "active",
      filePath: "lib/auth/session.ts",
      line: 2,
      ruleId: "auth.session_profile_rule",
      freshness: {
        state: "fresh",
        checkedAt: now(),
        reason: "fixture active finding",
      },
      capturedAt: now(),
      message: "Session helper owns profile access rules.",
      factFingerprints: [],
    };
    store.replaceReefFindingsForSource({
      projectId,
      source: "lint_files",
      overlay: "working_tree",
      findings: [finding],
    });
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error("reef-ask: FAIL");
  console.error(error);
  process.exit(1);
});
