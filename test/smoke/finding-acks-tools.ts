/**
 * `finding_ack` + `finding_acks_report` smoke — mutation + query tools
 * on the shared tool plane. Verifies round-trip, default handling,
 * append-only duplicates, aggregate counts, and telemetry emission.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  FindingAckToolOutput,
  FindingAcksReportToolOutput,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "finding-acks-tools-smoke",
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
      name: "finding-acks-tools-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-finding-acks-tools-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  // --- 1. Ack an AST match with default status ---

  const ackOne = (await invokeTool("finding_ack", {
    projectId,
    category: "hydration-check",
    subjectKind: "ast_match",
    filePath: "src/foo.tsx",
    fingerprint: "ast_fp_1",
    reason: "server component; new Date() is evaluated on the server",
    snippet: "new Date()",
    sourceToolName: "ast_find_pattern",
  })) as FindingAckToolOutput;
  assert.equal(ackOne.toolName, "finding_ack");
  assert.equal(ackOne.projectId, projectId);
  assert.equal(
    ackOne.ack.status,
    "ignored",
    "status defaults to 'ignored' at handler level",
  );
  assert.equal(ackOne.ack.category, "hydration-check");
  assert.equal(ackOne.ack.subjectKind, "ast_match");
  assert.equal(ackOne.ack.fingerprint, "ast_fp_1");
  assert.ok(ackOne.ack.ackId.startsWith("ack_"));
  assert.ok(ackOne.ack.acknowledgedAt.length > 0);

  // --- 2. Ack a diagnostic with explicit accepted + sourceRuleId ---

  const ackTwo = (await invokeTool("finding_ack", {
    projectId,
    category: "no-console",
    subjectKind: "diagnostic_issue",
    fingerprint: "mbid_console_1",
    status: "accepted",
    reason: "intentional debug log behind dev flag",
    sourceToolName: "lint_files",
    sourceRuleId: "no-console",
    sourceIdentityMatchBasedId: "mbid_console_1",
  })) as FindingAckToolOutput;
  assert.equal(ackTwo.ack.status, "accepted");
  assert.equal(ackTwo.ack.sourceRuleId, "no-console");

  // --- 3. Append-only: duplicate (category, fingerprint) insert persists ---

  const ackThree = (await invokeTool("finding_ack", {
    projectId,
    category: "no-console",
    subjectKind: "diagnostic_issue",
    fingerprint: "mbid_console_1",
    status: "ignored",
    reason: "superseded review decision",
  })) as FindingAckToolOutput;
  assert.notEqual(
    ackTwo.ack.ackId,
    ackThree.ack.ackId,
    "duplicate insert must produce a distinct ackId",
  );

  // --- 4. Report returns aggregates and acks ---

  const report = (await invokeTool("finding_acks_report", {
    projectId,
  })) as FindingAcksReportToolOutput;
  assert.equal(report.toolName, "finding_acks_report");
  assert.equal(report.acksInWindow, 3, "three acks total");
  assert.equal(report.acks.length, 3, "three acks returned (below limit)");
  assert.equal(report.truncated, false);

  const noConsoleCat = report.byCategory.find((row) => row.category === "no-console");
  assert.ok(noConsoleCat, "no-console category aggregate present");
  assert.equal(noConsoleCat?.totalRows, 2);
  assert.equal(
    noConsoleCat?.distinctFingerprints,
    1,
    "duplicate fingerprint collapses in distinctFingerprints",
  );

  const statusMap = new Map(report.byStatus.map((r) => [r.status, r.count]));
  assert.equal(statusMap.get("ignored"), 2);
  assert.equal(statusMap.get("accepted"), 1);

  const subjectMap = new Map(
    report.bySubjectKind.map((r) => [r.subjectKind, r.count]),
  );
  assert.equal(subjectMap.get("ast_match"), 1);
  assert.equal(subjectMap.get("diagnostic_issue"), 2);

  // --- 5. Report honors category filter ---

  const hydrationOnly = (await invokeTool("finding_acks_report", {
    projectId,
    category: "hydration-check",
  })) as FindingAcksReportToolOutput;
  assert.equal(hydrationOnly.acksInWindow, 1);
  assert.equal(hydrationOnly.acks.length, 1);
  assert.equal(hydrationOnly.acks[0]?.category, "hydration-check");

  // --- 6. Report honors status filter ---

  const acceptedOnly = (await invokeTool("finding_acks_report", {
    projectId,
    status: "accepted",
  })) as FindingAcksReportToolOutput;
  assert.equal(acceptedOnly.acksInWindow, 1);
  assert.equal(acceptedOnly.acks[0]?.status, "accepted");

  // --- 7. Report returns reverse-chronological order ---

  for (let i = 1; i < report.acks.length; i++) {
    const prev = report.acks[i - 1]!;
    const cur = report.acks[i]!;
    assert.ok(
      prev.acknowledgedAt >= cur.acknowledgedAt,
      `acks must be ordered by acknowledgedAt DESC (index ${i})`,
    );
  }

  // --- 8. Telemetry emission: one RuntimeUsefulnessEvent per ack ---

  const projectStore = openProjectStore({ projectRoot });
  try {
    const events = projectStore.queryUsefulnessEvents({
      projectId,
      decisionKind: "finding_ack",
    });
    assert.equal(events.length, 3, "one event per ack call");

    const hydrationEvent = events.find((e) => e.family === "hydration-check");
    assert.ok(hydrationEvent, "hydration-check telemetry event present");
    assert.equal(hydrationEvent?.grade, "full");
    assert.equal(hydrationEvent?.toolName, "finding_ack");
    assert.deepEqual(
      hydrationEvent?.reasonCodes,
      ["ignored"],
      "reasonCodes = [status] when sourceRuleId is unset",
    );

    const noConsoleAccepted = events.find(
      (e) => e.family === "no-console" && e.reasonCodes.includes("accepted"),
    );
    assert.ok(noConsoleAccepted, "no-console accepted event present");
    assert.deepEqual(
      noConsoleAccepted?.reasonCodes,
      ["accepted", "no-console"],
      "reasonCodes = [status, sourceRuleId] when sourceRuleId is set",
    );
  } finally {
    projectStore.close();
  }

  console.log("finding-acks-tools: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
