import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectFinding, ReefLearningReviewToolOutput } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";

function now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-learning-review-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  const projectId = randomUUID();
  const toolService = createToolService();

  try {
    writeFixture(projectRoot);
    const { firstFinding, toolRunId } = seedProject(projectRoot, projectId);

    const result = await toolService.callTool("reef_learning_review", {
      projectId,
      changedFiles: ["lib/auth/session.ts"],
      resolvedFindingIds: [firstFinding.fingerprint],
      recentToolRunIds: [toolRunId],
      includeLowConfidence: true,
      limit: 20,
    }) as ReefLearningReviewToolOutput;

    assert.equal(result.toolName, "reef_learning_review");
    assert.equal(result.mode, "suggest");
    assert.equal(result.summary.changedFileCount, 1);
    assert.equal(result.summary.resolvedFindingCount, 1);
    assert.equal(result.summary.repeatedRuleCount, 1);
    assert.equal(result.summary.recentToolRunCount, 1);
    assert.equal(result.summary.feedbackSignalCount, 1);
    assert.ok(result.guardrails.some((guardrail) => guardrail.includes("never writes")));
    assert.ok(result.summary.suggestionCount >= 4);

    const sentinel = result.suggestions.find((suggestion) => suggestion.kind === "sentinel_rule");
    assert.ok(sentinel);
    assert.equal(sentinel.status, "proposed");
    assert.equal(sentinel.target?.findingFingerprint, firstFinding.fingerprint);
    assert.match(sentinel.draft?.path ?? "", /^\.mako\/rules\//);
    assert.match(sentinel.draft?.content ?? "", /Draft only/);

    assert.ok(result.suggestions.some((suggestion) =>
      suggestion.kind === "instruction_patch" &&
      suggestion.draft?.path === ".mako/instructions.md"
    ));
    assert.ok(result.suggestions.some((suggestion) =>
      suggestion.kind === "rule_pack_template" &&
      suggestion.sourceSignals.includes("repeated_rule_history")
    ));
    assert.ok(result.suggestions.some((suggestion) =>
      suggestion.kind === "project_convention_candidate"
    ));
    assert.ok(result.suggestions.some((suggestion) =>
      suggestion.kind === "session_recall_note" &&
      suggestion.evidenceRefs.includes(`tool_run:${toolRunId}`)
    ));
    assert.ok(result.suggestions.some((suggestion) =>
      suggestion.kind === "conjecture" &&
      suggestion.sourceSignals.includes("agent_feedback")
    ));

    const batch = await toolService.callTool("tool_batch", {
      projectId,
      ops: [{
        label: "learning",
        tool: "reef_learning_review",
        args: {
          changedFiles: ["lib/auth/session.ts"],
          includeLowConfidence: true,
        },
      }],
    });
    assert.equal(batch.toolName, "tool_batch");

    console.log("reef-learning-review: PASS");
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

function writeFixture(projectRoot: string): void {
  const fullPath = path.join(projectRoot, "lib", "auth", "session.ts");
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, "export function getSession() { return null; }\n", "utf8");
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-learning-review-smoke" }), "utf8");
}

function seedProject(projectRoot: string, projectId: string): { firstFinding: ProjectFinding; toolRunId: string } {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "reef-learning-review-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    const firstFinding = finding(projectId, store.computeReefSubjectFingerprint({
      kind: "diagnostic",
      path: "lib/auth/session.ts",
      code: "auth.helper_bypass",
    }), {
      filePath: "lib/auth/session.ts",
      line: 2,
      message: "Session route bypassed the auth helper.",
      status: "resolved",
    });
    const secondFinding = finding(projectId, store.computeReefSubjectFingerprint({
      kind: "diagnostic",
      path: "app/api/users/route.ts",
      code: "auth.helper_bypass",
    }), {
      filePath: "app/api/users/route.ts",
      line: 12,
      message: "Users route bypassed the auth helper.",
      status: "resolved",
    });
    const activeFinding = finding(projectId, store.computeReefSubjectFingerprint({
      kind: "diagnostic",
      path: "app/api/admin/route.ts",
      code: "auth.helper_bypass",
    }), {
      filePath: "app/api/admin/route.ts",
      line: 5,
      message: "Admin route bypasses the auth helper.",
      status: "active",
    });

    store.replaceReefFindingsForSource({
      projectId,
      source: "lint_files",
      overlay: "working_tree",
      findings: [firstFinding, secondFinding, activeFinding],
    });
    const toolRun = store.insertToolRun({
      projectId,
      toolName: "reef_ask",
      inputSummary: { question: "fix auth helper bypass" },
      outputSummary: { summary: "resolved auth helper bypass" },
      outcome: "success",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 20,
      requestId: "req-learning-review",
    });
    for (let i = 0; i < 205; i += 1) {
      store.insertToolRun({
        projectId,
        toolName: "context_packet",
        inputSummary: { request: `later run ${i}` },
        outputSummary: { summary: `later result ${i}` },
        outcome: "success",
        startedAt: now(1_000 + i),
        finishedAt: now(1_001 + i),
        durationMs: 5,
        requestId: `req-learning-review-later-${i}`,
      });
    }
    store.insertUsefulnessEvent({
      projectId,
      requestId: "req-learning-review",
      decisionKind: "agent_feedback",
      family: "context_packet",
      toolName: "agent_feedback",
      grade: "partial",
      reasonCodes: ["top_not_useful"],
      reason: "central files ranked above duplicate candidates",
    });
    return { firstFinding, toolRunId: toolRun.runId };
  } finally {
    store.close();
  }
}

function finding(
  projectId: string,
  subjectFingerprint: string,
  input: {
    filePath: string;
    line: number;
    message: string;
    status: ProjectFinding["status"];
  },
): ProjectFinding {
  return {
    projectId,
    fingerprint: `${input.status}:${input.filePath}:${input.line}`,
    source: "lint_files",
    subjectFingerprint,
    overlay: "working_tree",
    severity: "warning",
    status: input.status,
    filePath: input.filePath,
    line: input.line,
    ruleId: "auth.helper_bypass",
    freshness: {
      state: "fresh",
      checkedAt: now(),
      reason: "fixture finding",
    },
    capturedAt: now(),
    message: input.message,
    evidenceRefs: [`${input.filePath}:${input.line}`],
    factFingerprints: [],
  };
}

main().catch((error) => {
  console.error("reef-learning-review: FAIL");
  console.error(error);
  process.exit(1);
});
