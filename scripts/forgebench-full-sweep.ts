/**
 * Full-coverage sweep: every public mako tool against the real forgebench
 * project. Reports per-tool: ok / expected_skip / error, a compact summary
 * of findings, and wall-clock duration. No mutation — read-only catalog run.
 */

import { openGlobalStore } from "../packages/store/src/index.ts";
import { invokeTool } from "../packages/tools/src/registry.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";

interface ToolRun {
  tool: string;
  ok: boolean;
  expectedSkip?: boolean;
  durationMs: number;
  summary: string;
  error?: string;
}

type ToolConfig = {
  tool: string;
  input: Record<string, unknown>;
  summarize: (result: any) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
  // Some tools legitimately fail without a live DB binding or external state.
  // Marking them `expectedFail` downgrades a failure from "broken" to "skip".
  expectedFailPrefix?: string;
};

async function main(): Promise<void> {
  const globalStore = openGlobalStore();
  let projectId: string;
  try {
    const existing = globalStore.getProjectByPath(FORGEBENCH_PATH);
    if (!existing) {
      console.log("forgebench not registered. Run scripts/forgebench-register.ts first.");
      process.exit(1);
    }
    projectId = existing.projectId;
  } finally {
    globalStore.close();
  }

  const configs: ToolConfig[] = [
    // ---- answer family ---------------------------------------------------
    {
      tool: "file_health",
      input: { projectId, file: "lib/events/actions.ts" },
      summarize: (r) =>
        `support=${r.result.supportLevel}, evidence=${r.result.evidenceStatus}, diag=${(r.result.diagnostics ?? []).length}, trust=${r.result.trust?.state ?? "(none)"}, companion=${r.result.companionPacket?.packet.family ?? "(none)"}`,
    },
    {
      tool: "route_trace",
      input: { projectId, route: "/api/events" },
      summarize: (r) =>
        `support=${r.result.supportLevel}, evidence=${r.result.evidenceStatus}, evidenceCount=${r.result.packet.evidence.length}`,
    },
    {
      tool: "schema_usage",
      input: { projectId, object: "events", schema: "public" },
      summarize: (r) =>
        `support=${r.result.supportLevel}, evidence=${r.result.evidenceStatus}, evidenceCount=${r.result.packet.evidence.length}`,
    },
    {
      tool: "auth_path",
      input: { projectId, route: "/dashboard/admin" },
      summarize: (r) =>
        `support=${r.result.supportLevel}, evidence=${r.result.evidenceStatus}, evidenceCount=${r.result.packet.evidence.length}`,
    },
    // ---- imports family --------------------------------------------------
    {
      tool: "imports_deps",
      input: { projectId, file: "lib/events/actions.ts" },
      summarize: (r) => `imports=${r.imports.length}, unresolved=${r.unresolved.length}`,
    },
    {
      tool: "imports_impact",
      input: { projectId, file: "lib/events/queries.ts" },
      summarize: (r) => `impacted=${r.impactedFiles.length}, depth=${r.depth}`,
    },
    {
      tool: "imports_hotspots",
      input: { projectId, limit: 5 },
      summarize: (r) =>
        `top5=${r.hotspots
          .slice(0, 5)
          .map((h: any) => `${h.filePath}(${h.totalConnections})`)
          .join(", ")}`,
    },
    {
      tool: "imports_cycles",
      input: { projectId },
      summarize: (r) => `cycles=${r.cycles.length}`,
    },
    // ---- symbols family --------------------------------------------------
    {
      tool: "symbols_of",
      input: { projectId, file: "lib/events/actions.ts" },
      summarize: (r) => `symbols=${r.symbols.length}, warnings=${r.warnings.length}`,
    },
    {
      tool: "exports_of",
      input: { projectId, file: "lib/events/actions.ts" },
      summarize: (r) => `exports=${r.exports.length}, warnings=${r.warnings.length}`,
    },
    // ---- db family (no live binding in this run — expected to fail) ------
    {
      tool: "db_ping",
      input: { projectId },
      summarize: (r) => `connected=${r.connected}, platform=${r.platform}`,
      expectedFailPrefix: "no-db-binding",
    },
    {
      tool: "db_columns",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) => `columns=${r.columns.length}`,
      expectedFailPrefix: "no-db-binding",
    },
    {
      tool: "db_fk",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) => `outbound=${r.outbound.length}, inbound=${r.inbound.length}`,
      expectedFailPrefix: "no-db-binding",
    },
    {
      tool: "db_rls",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) => `rls=${r.rlsEnabled}, policies=${r.policies.length}`,
      expectedFailPrefix: "no-db-binding",
    },
    {
      tool: "db_rpc",
      input: { projectId, name: "get_visible_events" },
      summarize: (r) => `args=${r.args.length}, returns=${r.returns}`,
      expectedFailPrefix: "no-db-binding",
    },
    {
      tool: "db_table_schema",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) =>
        `columns=${r.columns.length}, indexes=${r.indexes.length}, policies=${r.rls.policies.length}`,
      expectedFailPrefix: "no-db-binding",
    },
    // ---- composer family -------------------------------------------------
    {
      tool: "trace_file",
      input: { projectId, file: "app/events/[id]/page.tsx" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}, trust=${r.result.trust?.state ?? "(none)"}`,
    },
    {
      tool: "preflight_table",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}, support=${r.result.supportLevel}`,
    },
    {
      tool: "cross_search",
      input: { projectId, term: "refresh_events" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}`,
    },
    {
      tool: "trace_edge",
      input: { projectId, name: "send-registration-email" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}`,
    },
    {
      tool: "trace_error",
      input: { projectId, term: "Registration capacity check failed" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}`,
    },
    {
      tool: "trace_table",
      input: { projectId, table: "events", schema: "public" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}`,
    },
    {
      tool: "trace_rpc",
      input: { projectId, name: "register_for_event" },
      summarize: (r) => `evidence=${r.result.packet.evidence.length}`,
    },
    // ---- router ----------------------------------------------------------
    {
      tool: "ask",
      input: { projectId, question: "where does /api/events get handled" },
      summarize: (r) => `mode=${r.mode}, selected=${r.selectedTool}, confidence=${r.confidence}`,
    },
    // ---- graph (6.0-6.2) -------------------------------------------------
    {
      tool: "graph_neighbors",
      input: {
        projectId,
        startEntities: [{ kind: "file", key: "lib/events/actions.ts" }],
        direction: "both",
        traversalDepth: 2,
      },
      summarize: (r) =>
        `resolved=${r.result.resolvedStartNodes.length}, neighbors=${r.result.neighbors.length}, basis=${r.result.graphBasis.strategy}`,
    },
    {
      tool: "graph_path",
      input: {
        projectId,
        startEntity: { kind: "file", key: "app/events/[id]/page.tsx" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 6,
        includeHeuristicEdges: true,
      },
      summarize: (r) =>
        `pathFound=${r.result.pathFound}, hops=${r.result.hops.length}, heuristic=${r.result.containsHeuristicEdge}${r.result.noPathReason ? `, noPathReason=${r.result.noPathReason}` : ""}`,
    },
    {
      tool: "flow_map",
      input: {
        projectId,
        startEntity: { kind: "file", key: "app/events/[id]/page.tsx" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 6,
        includeHeuristicEdges: true,
      },
      summarize: (r) =>
        `pathFound=${r.result.pathFound}, steps=${r.result.steps.length}, boundaries=${JSON.stringify(r.result.majorBoundaryKinds)}`,
    },
    {
      tool: "change_plan",
      input: {
        projectId,
        startEntity: { kind: "file", key: "app/events/[id]/page.tsx" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 6,
        includeHeuristicEdges: true,
      },
      summarize: (r) =>
        `direct=${r.result.directSurfaces.length}, dependent=${r.result.dependentSurfaces.length}, steps=${r.result.steps.length}`,
    },
    // ---- operator (6.3) + project intelligence (6.4) ---------------------
    {
      tool: "tenant_leak_audit",
      input: { projectId, acknowledgeAdvisory: true },
      summarize: (r) => {
        const s = r.result.summary;
        return `protected=${s.protectedTableCount}, direct=${s.directEvidenceCount}, weak=${s.weakSignalCount}, reviewed-safe=${s.reviewedSurfaceCount}`;
      },
    },
    {
      tool: "session_handoff",
      input: { projectId },
      summarize: (r) => {
        const s = r.result.summary;
        const focus = r.result.currentFocus
          ? `focus=${r.result.currentFocus.reasonCode}:${r.result.currentFocus.queryText}`
          : "focus=(none)";
        return `recent=${s.recentQueryCount}, unresolved=${s.unresolvedQueryCount}, ${focus}`;
      },
    },
    {
      tool: "health_trend",
      input: { projectId },
      summarize: (r) => {
        const s = r.result.summary;
        return `traces=${s.traceCount}, enoughHistory=${s.enoughHistory}, metrics=${r.result.metrics.length}`;
      },
    },
    {
      tool: "issues_next",
      input: { projectId },
      summarize: (r) => {
        const s = r.result.summary;
        return `candidates=${s.candidateCount}, queued=${s.queuedCount}, suppressedStable=${s.suppressedStableCount}`;
      },
    },
    // ---- bounded investigation (6.5) -------------------------------------
    {
      tool: "suggest",
      input: {
        projectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      },
      summarize: (r) =>
        `strategy=${r.result.strategy}, stop=${r.result.stopReason}, steps=${r.result.steps.length}`,
    },
    {
      tool: "investigate",
      input: {
        projectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      },
      summarize: (r) =>
        `strategy=${r.result.strategy}, stop=${r.result.stopReason}, executed=${r.result.executedStepCount}/${r.result.budget}, followOn=${r.result.followOnHints.length}`,
    },
    // ---- workflow packet (5.4) -------------------------------------------
    {
      tool: "workflow_packet",
      input: {
        projectId,
        family: "verification_plan",
        queryKind: "trace_file",
        queryText: "app/events/[id]/page.tsx",
      },
      summarize: (r) =>
        `family=${r.result.packet.family}, watch=${r.result.watch.mode}, refreshTriggers=${r.result.watch.refreshTriggers.length}`,
    },
    // ---- generated artifacts (7.0-7.4) -----------------------------------
    {
      tool: "implementation_handoff_artifact",
      input: {
        projectId,
        queryKind: "file_health",
        queryText: "lib/events/actions.ts",
        queryArgs: { file: "lib/events/actions.ts" },
      },
      summarize: (r) => {
        const art = r.result;
        const idTail = art.artifactId.slice(-12);
        const basisKinds = art.basis.map((b: any) => b.kind).join(",");
        const formats = art.renderings.map((x: any) => x.format).join(",");
        const focus = art.payload.currentFocus ? "yes" : "no";
        return `id=...${idTail}, basis=${art.basis.length}[${basisKinds}], renderings=${formats}, focus=${focus}, followUps=${art.payload.followUps.length}`;
      },
    },
    {
      tool: "task_preflight_artifact",
      // Uses the "natural" route→table pair that originally crashed at the
      // min(1) schema check. After the empty-surface fix, the artifact
      // ships with `likelyMoveSurfaces=0` and the markdown renderer
      // surfaces the empty-state message explicitly. This is the
      // regression test for Finding 3 from forgebench-triage.md.
      input: {
        projectId,
        queryKind: "route_trace",
        queryText: "GET /api/events",
        queryArgs: { route: "/api/events" },
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 6,
        includeHeuristicEdges: true,
      },
      summarize: (r) => {
        const art = r.result;
        const idTail = art.artifactId.slice(-12);
        const formats = art.renderings.map((x: any) => x.format).join(",");
        return `id=...${idTail}, basis=${art.basis.length}, renderings=${formats}, readFirst=${art.payload.readFirst.length}, surfaces=${art.payload.likelyMoveSurfaces.length}, verify=${art.payload.verifyBeforeStart.length}, risks=${art.payload.activeRisks.length}`;
      },
    },
    {
      tool: "review_bundle_artifact",
      input: {
        projectId,
        queryKind: "route_trace",
        queryText: "GET /api/events",
        queryArgs: { route: "/api/events" },
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 6,
        includeHeuristicEdges: true,
        includeTenantAudit: true,
      },
      summarize: (r) => {
        const art = r.result;
        const idTail = art.artifactId.slice(-12);
        const formats = art.renderings.map((x: any) => x.format).join(",");
        return `id=...${idTail}, basis=${art.basis.length}, renderings=${formats}, inspect=${art.payload.inspectFirst.length}, surfaces=${art.payload.reviewSurfaces.length}, checks=${art.payload.reviewerChecks.length}, direct=${art.payload.directOperatorFindings.length}, weak=${art.payload.weakOperatorSignals.length}`;
      },
    },
    {
      tool: "verification_bundle_artifact",
      input: {
        projectId,
        queryKind: "trace_file",
        queryText: "app/events/[id]/page.tsx",
        queryArgs: { file: "app/events/[id]/page.tsx" },
        includeTenantAudit: true,
        includeSessionHandoff: true,
        includeIssuesNext: true,
      },
      summarize: (r) => {
        const art = r.result;
        const idTail = art.artifactId.slice(-12);
        const formats = art.renderings.map((x: any) => x.format).join(",");
        return `id=...${idTail}, basis=${art.basis.length}, renderings=${formats}, baseline=${art.payload.baselineChecks.length}, required=${art.payload.requiredChecks.length}, stop=${art.payload.stopConditions.length}, change=${art.payload.changeManagementChecks.length}, direct=${art.payload.directOperatorFindings.length}`;
      },
    },
  ];

  const runs: ToolRun[] = [];
  for (const config of configs) {
    const start = Date.now();
    try {
      const output = await invokeTool(config.tool, config.input);
      const summary = config.summarize(output as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      runs.push({
        tool: config.tool,
        ok: true,
        durationMs: Date.now() - start,
        summary,
      });
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error);
      // Unwrap MakoToolError.details.issues so validation failures aren't
      // reported as just "Tool input validation failed." — unhelpful for
      // iteration.
      const details = (error as { details?: { issues?: Array<{ path: string; message: string }> } })?.details;
      const issuesSummary = details?.issues
        ?.map((i) => `${i.path || "(root)"}: ${i.message}`)
        .join("; ");
      const message = issuesSummary ? `${baseMessage} [${issuesSummary}]` : baseMessage;
      runs.push({
        tool: config.tool,
        ok: false,
        expectedSkip:
          config.expectedFailPrefix != null &&
          (message.includes("database") ||
            message.includes("db binding") ||
            message.includes("live") ||
            message.includes("not bound") ||
            message.includes("DbPing") ||
            message.toLowerCase().includes("connection")),
        durationMs: Date.now() - start,
        summary: "(errored)",
        error: message,
      });
    }
  }

  // ---- report ----------------------------------------------------------------
  const ok = runs.filter((r) => r.ok);
  const expectedSkip = runs.filter((r) => !r.ok && r.expectedSkip);
  const broken = runs.filter((r) => !r.ok && !r.expectedSkip);

  console.log(`\nprojectId: ${projectId}`);
  console.log(`tools invoked: ${runs.length}`);
  console.log(`  ok:        ${ok.length}`);
  console.log(`  expected skip (no-db-binding): ${expectedSkip.length}`);
  console.log(`  BROKEN:    ${broken.length}`);

  console.log("\n--- OK ---");
  for (const run of ok) {
    console.log(`  [${String(run.durationMs).padStart(5)}ms] ${run.tool.padEnd(24)} ${run.summary}`);
  }

  if (expectedSkip.length > 0) {
    console.log("\n--- EXPECTED SKIP (no DB binding) ---");
    for (const run of expectedSkip) {
      console.log(`  ${run.tool.padEnd(24)} ${run.error?.slice(0, 120) ?? ""}`);
    }
  }

  if (broken.length > 0) {
    console.log("\n!!! BROKEN !!!");
    for (const run of broken) {
      console.log(`  ${run.tool}`);
      console.log(`    ${run.error}`);
    }
    process.exit(2);
  }

  console.log("\n✅ no broken tools.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
