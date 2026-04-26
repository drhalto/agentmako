/**
 * Ad-hoc forgebench health check — runs a cross-section of mako tools against
 * the real forgebench project and prints any issues surfaced.
 *
 * Intentionally not a smoke. Written once to answer: "does mako surface real
 * issues in forgebench today?"
 */

import { openGlobalStore, openProjectStore } from "../packages/store/src/index.ts";
import { invokeTool } from "../packages/tools/src/registry.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";

interface ProblemFinding {
  tool: string;
  target: string;
  detail: string;
  severity: "high" | "medium" | "low" | "info";
}

async function main(): Promise<void> {
  // Resolve or register the forgebench project in the global store so tools can
  // find it by path.
  const globalStore = openGlobalStore();
  let projectId: string;
  try {
    const existing = globalStore.getProjectByPath(FORGEBENCH_PATH);
    if (existing) {
      projectId = existing.projectId;
      console.log(`forgebench already registered as ${projectId}`);
    } else {
      console.log(`forgebench not registered. Run \`agentmako connect ${FORGEBENCH_PATH}\` first.`);
      process.exit(1);
    }
  } finally {
    globalStore.close();
  }

  // Make sure the project has indexed state. If not, indexing is the user's job
  // — we will not silently re-index a real repo from an ad-hoc script.
  const projectStore = openProjectStore({ projectRoot: FORGEBENCH_PATH });
  const latestIndexRun = projectStore.getLatestIndexRun();
  const schemaSnapshot = projectStore.loadSchemaSnapshot();
  const fileCount = projectStore.listFiles().length;
  projectStore.close();

  console.log("\n--- forgebench index state ---");
  console.log(`  latest index run: ${latestIndexRun?.runId ?? "(none)"}`);
  console.log(`  schema snapshot:  ${schemaSnapshot?.snapshotId ?? "(none)"}`);
  console.log(`  indexed files:    ${fileCount}`);

  if (!latestIndexRun || fileCount === 0) {
    console.log("\nforgebench has no index. Run `agentmako connect` or a reindex first.");
    process.exit(1);
  }

  const findings: ProblemFinding[] = [];

  // --- tenant leak audit ----------------------------------------------------
  console.log("\n--- tenant_leak_audit ---");
  try {
    const output = (await invokeTool("tenant_leak_audit", {
      projectId,
      acknowledgeAdvisory: true,
    })) as {
      toolName: "tenant_leak_audit";
      result: {
        rolloutStage: string;
        summary: {
          protectedTableCount: number;
          directEvidenceCount: number;
          weakSignalCount: number;
          reviewedSurfaceCount: number;
        };
        findings: Array<{
          strength: "direct_evidence" | "weak_signal";
          surfaceKind: string;
          surfaceKey: string;
          code: string;
          message: string;
          evidenceRefs: string[];
        }>;
        warnings: string[];
      };
    };
    const { summary, findings: auditFindings, warnings } = output.result;
    console.log(
      `  protected tables: ${summary.protectedTableCount}, direct: ${summary.directEvidenceCount}, weak: ${summary.weakSignalCount}, reviewed-safe: ${summary.reviewedSurfaceCount}`,
    );
    for (const warning of warnings) console.log(`  warn: ${warning}`);
    for (const finding of auditFindings) {
      findings.push({
        tool: "tenant_leak_audit",
        target: `${finding.surfaceKind}:${finding.surfaceKey}`,
        detail: `[${finding.code}] ${finding.message}`,
        severity: finding.strength === "direct_evidence" ? "high" : "medium",
      });
    }
  } catch (error) {
    console.log(`  errored: ${(error as Error).message}`);
  }

  // --- session handoff ------------------------------------------------------
  console.log("\n--- session_handoff ---");
  try {
    const output = (await invokeTool("session_handoff", {
      projectId,
    })) as {
      toolName: "session_handoff";
      result: {
        summary: {
          recentQueryCount: number;
          unresolvedQueryCount: number;
          changedQueryCount: number;
          queriesWithFollowups: number;
        };
        currentFocus: {
          queryText: string;
          reasonCode: string;
          reason: string;
        } | null;
        warnings: string[];
      };
    };
    const { summary, currentFocus, warnings } = output.result;
    console.log(
      `  recent: ${summary.recentQueryCount}, unresolved: ${summary.unresolvedQueryCount}, changed: ${summary.changedQueryCount}, with-followups: ${summary.queriesWithFollowups}`,
    );
    if (currentFocus) {
      console.log(
        `  current focus [${currentFocus.reasonCode}]: ${currentFocus.queryText}`,
      );
      console.log(`    reason: ${currentFocus.reason}`);
      findings.push({
        tool: "session_handoff",
        target: currentFocus.queryText,
        detail: `[${currentFocus.reasonCode}] ${currentFocus.reason}`,
        severity: "medium",
      });
    } else {
      console.log("  no current focus (recent traces are stable or project has no recent queries)");
    }
    for (const warning of warnings) console.log(`  warn: ${warning}`);
  } catch (error) {
    console.log(`  errored: ${(error as Error).message}`);
  }

  // --- health trend ---------------------------------------------------------
  console.log("\n--- health_trend ---");
  try {
    const output = (await invokeTool("health_trend", {
      projectId,
    })) as {
      toolName: "health_trend";
      result: {
        summary: {
          enoughHistory: boolean;
          traceCount: number;
          unresolvedQueryCount: number;
          changedQueryCount: number;
          contradictedQueryCount: number;
        };
        metrics: Array<{
          metric: string;
          direction: string;
          interpretation: string;
        }>;
        warnings: string[];
      };
    };
    const { summary, metrics, warnings } = output.result;
    console.log(
      `  traces: ${summary.traceCount}, unresolved: ${summary.unresolvedQueryCount}, changed: ${summary.changedQueryCount}, contradicted: ${summary.contradictedQueryCount}, enough-history: ${summary.enoughHistory}`,
    );
    for (const metric of metrics) {
      if (metric.direction !== "flat" && metric.direction !== "insufficient_history") {
        console.log(`  ${metric.direction}: ${metric.interpretation}`);
        if (metric.direction === "up" && /contradicted|unresolved|changed/.test(metric.metric)) {
          findings.push({
            tool: "health_trend",
            target: metric.metric,
            detail: metric.interpretation,
            severity: "medium",
          });
        }
      }
    }
    for (const warning of warnings) console.log(`  warn: ${warning}`);
  } catch (error) {
    console.log(`  errored: ${(error as Error).message}`);
  }

  // --- issues_next ----------------------------------------------------------
  console.log("\n--- issues_next ---");
  try {
    const output = (await invokeTool("issues_next", {
      projectId,
    })) as {
      toolName: "issues_next";
      result: {
        summary: {
          recentQueryCount: number;
          candidateCount: number;
          queuedCount: number;
          suppressedStableCount: number;
        };
        currentIssue: { queryText: string; reasonCode: string; reason: string } | null;
        queuedIssues: Array<{ queryText: string; reasonCode: string; reason: string }>;
        warnings: string[];
      };
    };
    const { summary, currentIssue, queuedIssues, warnings } = output.result;
    console.log(
      `  candidates: ${summary.candidateCount}, queued: ${summary.queuedCount}, suppressed-stable: ${summary.suppressedStableCount}`,
    );
    if (currentIssue) {
      console.log(`  current [${currentIssue.reasonCode}]: ${currentIssue.queryText}`);
    }
    for (const issue of queuedIssues.slice(0, 5)) {
      console.log(`  queued [${issue.reasonCode}]: ${issue.queryText}`);
    }
    for (const warning of warnings) console.log(`  warn: ${warning}`);
  } catch (error) {
    console.log(`  errored: ${(error as Error).message}`);
  }

  // --- file_health on a few high-signal files -------------------------------
  console.log("\n--- file_health (sampled) ---");
  const sampleFiles = [
    "app/events/[id]/page.tsx",
    "app/dashboard/instructor/page.tsx",
    "lib/events/actions.ts",
    "lib/events/queries.ts",
    "lib/db/client.ts",
    "lib/support/queries.ts",
  ];
  for (const file of sampleFiles) {
    try {
      const output = (await invokeTool("file_health", {
        projectId,
        file,
      })) as {
        toolName: "file_health";
        result: {
          supportLevel: string;
          evidenceStatus: string;
          diagnostics?: Array<{
            severity: string;
            confidence: string;
            code: string;
            message: string;
            path?: string;
            line?: number;
          }>;
          trust?: { state: string };
        };
      };
      const diagnostics = output.result.diagnostics ?? [];
      const trustState = output.result.trust?.state ?? "(none)";
      console.log(
        `  ${file}: support=${output.result.supportLevel}, evidence=${output.result.evidenceStatus}, trust=${trustState}, diagnostics=${diagnostics.length}`,
      );
      for (const diagnostic of diagnostics) {
        console.log(
          `    [${diagnostic.severity}/${diagnostic.confidence}] ${diagnostic.code}: ${diagnostic.message}`,
        );
        findings.push({
          tool: "file_health",
          target: file,
          detail: `[${diagnostic.code}] ${diagnostic.message}`,
          severity:
            diagnostic.severity === "critical" || diagnostic.severity === "high"
              ? "high"
              : diagnostic.severity === "medium"
                ? "medium"
                : "low",
        });
      }
    } catch (error) {
      console.log(`  ${file}: errored — ${(error as Error).message}`);
    }
  }

  // --- summary --------------------------------------------------------------
  console.log("\n=== FINDINGS SUMMARY ===");
  const bySeverity = {
    high: findings.filter((f) => f.severity === "high"),
    medium: findings.filter((f) => f.severity === "medium"),
    low: findings.filter((f) => f.severity === "low"),
    info: findings.filter((f) => f.severity === "info"),
  };
  console.log(
    `  ${bySeverity.high.length} high, ${bySeverity.medium.length} medium, ${bySeverity.low.length} low`,
  );
  for (const group of (["high", "medium", "low"] as const)) {
    for (const finding of bySeverity[group]) {
      console.log(`  [${group}] ${finding.tool} :: ${finding.target}`);
      console.log(`         ${finding.detail}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
