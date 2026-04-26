import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createApiService } from "../../services/api/src/service.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import {
  extractImplementationHandoffArtifactFromToolOutput,
  extractReviewBundleArtifactFromToolOutput,
  extractTaskPreflightArtifactFromToolOutput,
  extractVerificationBundleArtifactFromToolOutput,
} from "../../packages/contracts/src/tools.ts";
import {
  evaluateWorkflowPacketUsefulness,
  shouldPromoteWorkflowPacketAttachment,
  summarizeWorkflowPacketPromotionMetrics,
} from "../../packages/tools/src/workflow-packets/usefulness.ts";

function hasSharedSchemaRefs(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") {
    return false;
  }
  const record = schema as Record<string, unknown>;
  return (
    typeof record.$ref === "string"
    || (typeof record.definitions === "object" && record.definitions !== null && Object.keys(record.definitions as Record<string, unknown>).length > 0)
    || (typeof record.$defs === "object" && record.$defs !== null && Object.keys(record.$defs as Record<string, unknown>).length > 0)
  );
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-api-answer-question-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectFile = "src/foo.ts";
  const projectSymbolKey = `${projectFile}:foo:1:foo`;
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "api-answer-question-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, projectFile), "export const foo = 1;\n");

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "api-answer-question-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const projectStore = openProjectStore({ projectRoot });
    try {
      projectStore.saveProjectProfile({
        name: "api-answer-question-smoke",
        rootPath: projectRoot,
        framework: "unknown",
        orm: "unknown",
        srcRoot: "src",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "best_effort",
        detectedAt: new Date().toISOString(),
      });

      projectStore.replaceIndexSnapshot({
        files: [
          {
            path: projectFile,
            sha256: "cafebabe",
            language: "typescript",
            sizeBytes: 22,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                name: projectFile,
                lineStart: 1,
                lineEnd: 1,
                content: "export const foo = 1;",
              },
            ],
            symbols: [
              {
                name: "foo",
                kind: "constant",
                exportName: "foo",
                lineStart: 1,
                lineEnd: 1,
                signatureText: "export const foo = 1",
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      projectStore.beginIndexRun("smoke");
    } finally {
      projectStore.close();
    }

    const api = createApiService();
    try {
      const tools = api.listTools();
      const taskPreflightArtifactTool = tools.find((tool) => tool.name === "task_preflight_artifact");
      assert.ok(taskPreflightArtifactTool, "expected task_preflight_artifact to be registered");
      assert.equal(taskPreflightArtifactTool?.category, "artifact");
      const implementationHandoffArtifactTool = tools.find((tool) => tool.name === "implementation_handoff_artifact");
      assert.ok(implementationHandoffArtifactTool, "expected implementation_handoff_artifact to be registered");
      assert.equal(implementationHandoffArtifactTool?.category, "artifact");
      const reviewBundleArtifactTool = tools.find((tool) => tool.name === "review_bundle_artifact");
      assert.ok(reviewBundleArtifactTool, "expected review_bundle_artifact to be registered");
      assert.equal(reviewBundleArtifactTool?.category, "artifact");
      const verificationBundleArtifactTool = tools.find((tool) => tool.name === "verification_bundle_artifact");
      assert.ok(verificationBundleArtifactTool, "expected verification_bundle_artifact to be registered");
      assert.equal(verificationBundleArtifactTool?.category, "artifact");
      const routeTraceTool = tools.find((tool) => tool.name === "route_trace");
      assert.ok(routeTraceTool, "expected route_trace to be registered");
      assert.equal(
        hasSharedSchemaRefs(reviewBundleArtifactTool?.inputSchema),
        true,
        "artifact tool schemas should emit shared root refs",
      );
      assert.equal(
        hasSharedSchemaRefs(routeTraceTool?.inputSchema),
        false,
        "non-artifact tool schemas should stay inlined",
      );
      const result = await api.askQuestion(
        { projectId },
        "file_health",
        projectFile,
      );

      assert.equal(result.queryKind, "file_health");
      assert.equal(result.packet.queryKind, "file_health");
      assert.equal(result.packet.queryText, projectFile);
      assert.equal(result.packet.supportLevel, "best_effort");
      assert.ok(result.companionPacket, "expected file_health answers to attach a companion workflow packet");
      assert.equal(result.companionPacket?.packet.family, "verification_plan");
      assert.match(
        result.companionPacket?.attachmentReason ?? "",
        /queryKind=file_health/,
        "expected the companion packet to explain why it attached",
      );
      assert.deepEqual(result.companionPacket?.attachmentDecision, {
        family: "verification_plan",
        trigger: {
          queryKind: "file_health",
          supportLevel: "best_effort",
          evidenceStatus: "complete",
          trustState: "insufficient_evidence",
        },
      });
      assert.ok(result.companionPacket?.handoff, "expected the companion packet to expose a compact handoff");
      assert.ok((result.companionPacket?.handoff?.current.length ?? 0) > 0);
      assert.ok((result.companionPacket?.handoff?.stopWhen.length ?? 0) > 0);
      assert.ok(result.candidateActions.length > 0, "expected at least one candidate action");
      assert.equal(result.candidateActions[0]?.label, "Follow verification plan");
      assert.match(
        result.candidateActions[0]?.description ?? "",
        /Current:/,
        "expected the first candidate action to come from the companion handoff",
      );
      assert.match(result.candidateActions[0]?.description ?? "", /Stop when:/);
      assert.equal(result.candidateActions[0]?.execute?.toolName, "workflow_packet");
      assert.equal(result.candidateActions[0]?.execute?.input.family, "verification_plan");
      assert.equal(result.candidateActions[0]?.execute?.input.queryKind, "file_health");
      assert.equal(result.candidateActions[0]?.execute?.input.queryText, projectFile);
      assert.deepEqual(result.candidateActions[0]?.execute?.input.queryArgs, {
        file: projectFile,
      });
      assert.deepEqual(result.candidateActions[0]?.execute?.input.followup, {
        originQueryId: result.queryId,
        originActionId: result.candidateActions[0]?.actionId,
        originPacketId: result.companionPacket?.packet.packetId ?? null,
        originPacketFamily: "verification_plan",
        originQueryKind: "file_health",
      });
      const handoffArtifactAction = result.candidateActions.find(
        (action) => action.execute?.toolName === "implementation_handoff_artifact",
      );
      assert.equal(
        handoffArtifactAction,
        undefined,
        "expected the answer surface to keep a single primary next action instead of showing a second handoff-shaped artifact action",
      );
      assert.match(
        result.companionPacket?.rendered ?? "",
        /## Verification/,
        "expected the companion packet to render a verification plan",
      );
      const followupOutput = await api.callTool(
        "workflow_packet",
        result.candidateActions[0]!.execute!.input as never,
      );
      assert.equal((followupOutput as { toolName: string }).toolName, "workflow_packet");
      const implementationHandoffOutput = await api.callTool(
        "implementation_handoff_artifact",
        {
          projectId,
          queryKind: "file_health",
          queryText: projectFile,
          queryArgs: {
            file: projectFile,
          },
        } as never,
      );
      const implementationHandoffArtifact = extractImplementationHandoffArtifactFromToolOutput(
        implementationHandoffOutput,
      );
      assert.ok(implementationHandoffArtifact, "expected the implementation handoff tool to return an artifact");
      assert.equal(implementationHandoffArtifact?.kind, "implementation_handoff");
      assert.equal(implementationHandoffArtifact?.projectId, projectId);
      assert.ok((implementationHandoffArtifact?.basis.length ?? 0) >= 2);
      assert.ok(
        implementationHandoffArtifact?.renderings.some((rendering) => rendering.format === "json"),
        "expected a canonical json rendering",
      );
      assert.ok(
        implementationHandoffArtifact?.renderings.some((rendering) => rendering.format === "markdown"),
        "expected a markdown rendering for CLI/harness surfacing",
      );
      const taskPreflightOutput = await api.callTool("task_preflight_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: {
          file: projectFile,
        },
        startEntity: {
          kind: "file",
          key: projectFile,
        },
        targetEntity: {
          kind: "symbol",
          key: projectSymbolKey,
        },
      });
      const taskPreflightArtifact = extractTaskPreflightArtifactFromToolOutput(taskPreflightOutput);
      assert.ok(taskPreflightArtifact, "expected the task preflight tool to return an artifact");
      assert.equal(taskPreflightArtifact?.kind, "task_preflight");
      assert.equal(taskPreflightArtifact?.projectId, projectId);
      assert.ok((taskPreflightArtifact?.basis.length ?? 0) >= 3);
      assert.ok(
        taskPreflightArtifact?.renderings.some((rendering) => rendering.format === "json"),
        "expected task preflight to include a canonical json rendering",
      );
      assert.ok(
        taskPreflightArtifact?.renderings.some((rendering) => rendering.format === "markdown"),
        "expected task preflight to include a markdown rendering",
      );
      const reviewBundleOutput = await api.callTool("review_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: {
          file: projectFile,
        },
        startEntity: {
          kind: "file",
          key: projectFile,
        },
        targetEntity: {
          kind: "symbol",
          key: projectSymbolKey,
        },
      });
      const reviewBundleArtifact = extractReviewBundleArtifactFromToolOutput(reviewBundleOutput);
      assert.ok(reviewBundleArtifact, "expected the review bundle tool to return an artifact");
      assert.equal(reviewBundleArtifact?.kind, "review_bundle");
      assert.equal(reviewBundleArtifact?.projectId, projectId);
      assert.ok((reviewBundleArtifact?.basis.length ?? 0) >= 2);
      assert.ok(
        reviewBundleArtifact?.renderings.some((rendering) => rendering.format === "json"),
        "expected review bundle to include a canonical json rendering",
      );
      assert.ok(
        reviewBundleArtifact?.renderings.some((rendering) => rendering.format === "markdown"),
        "expected review bundle to include a markdown rendering",
      );
      const verificationBundleDefault = await api.callTool("verification_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: {
          file: projectFile,
        },
      });
      const verificationBundleDefaultArtifact = extractVerificationBundleArtifactFromToolOutput(
        verificationBundleDefault,
      );
      assert.ok(
        verificationBundleDefaultArtifact,
        "expected the verification bundle tool to return an artifact",
      );
      assert.equal(
        verificationBundleDefaultArtifact?.basis.length,
        1,
        "default verification_bundle basis should contain only the verification plan when no include flags are set",
      );

      const verificationBundleOutput = await api.callTool("verification_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: {
          file: projectFile,
        },
        includeSessionHandoff: true,
        includeIssuesNext: true,
      });
      const verificationBundleArtifact = extractVerificationBundleArtifactFromToolOutput(
        verificationBundleOutput,
      );
      assert.ok(
        verificationBundleArtifact,
        "expected the verification bundle tool to return an artifact",
      );
      assert.equal(verificationBundleArtifact?.kind, "verification_bundle");
      assert.equal(verificationBundleArtifact?.projectId, projectId);
      assert.ok(
        (verificationBundleArtifact?.basis.length ?? 0) >= 2,
        "explicit opt-in to session / issues context should expand the basis",
      );
      assert.ok(
        verificationBundleArtifact?.renderings.some((rendering) => rendering.format === "json"),
        "expected verification bundle to include a canonical json rendering",
      );
      assert.ok(
        verificationBundleArtifact?.renderings.some((rendering) => rendering.format === "markdown"),
        "expected verification bundle to include a markdown rendering",
      );
      await assert.rejects(
        () =>
          api.callTool("implementation_handoff_artifact", {
            projectId,
            queryKind: "file_health",
            queryText: projectFile,
            queryArgs: {
              file: projectFile,
            },
            sessionLimits: 5,
          } as never),
        /tool input validation failed/i,
        "implementation_handoff_artifact input should reject typo fields",
      );
      await assert.rejects(
        () =>
          api.callTool("verification_bundle_artifact", {
            projectId,
            queryKind: "file_health",
            queryText: projectFile,
            queryArgs: {
              file: projectFile,
            },
            issueLimits: 5,
          } as never),
        /tool input validation failed/i,
        "verification_bundle_artifact input should reject typo fields",
      );
      const projectStore = openProjectStore({ projectRoot });
      try {
        const followups = projectStore.queryWorkflowFollowups({
          originQueryId: result.queryId,
          originActionId: result.candidateActions[0]!.actionId,
          limit: 10,
        });
        assert.equal(followups.length, 1, "expected one workflow follow-up row after executing the guided action");
        assert.equal(followups[0]?.executedToolName, "workflow_packet");
        assert.equal(followups[0]?.originPacketFamily, "verification_plan");
        assert.equal(followups[0]?.resultPacketFamily, "verification_plan");
        assert.ok((followups[0]?.resultQueryId.length ?? 0) > 0);
        const usefulness = evaluateWorkflowPacketUsefulness(result, {
          observedFollowupCount: followups.length,
        });
        assert.equal(usefulness.grade, "full");
        assert.ok(usefulness.reasonCodes.includes("followup_action_taken"));
        assert.equal(usefulness.observedFollowupCount, 1);
        const noObservedFollowupMetrics = summarizeWorkflowPacketPromotionMetrics([
          {
            ...usefulness,
            observedFollowupCount: 0,
          },
        ]);
        assert.equal(
          noObservedFollowupMetrics.actualFollowupRate,
          null,
          "actualFollowupRate should stay null until mako has observed a real followed action",
        );
        assert.equal(
          shouldPromoteWorkflowPacketAttachment(noObservedFollowupMetrics, {
            minEligibleCount: 1,
            minHelpedRate: 1,
            minNoNoiseRate: 1,
            minActualFollowupRate: 0.5,
          }),
          true,
          "null actual-followup rate should not block early promotion",
        );
        const observedFollowupMetrics = summarizeWorkflowPacketPromotionMetrics([usefulness]);
        assert.equal(observedFollowupMetrics.actualFollowupTakenCount, 1);
        assert.equal(observedFollowupMetrics.actualFollowupRate, 1);
        assert.equal(
          shouldPromoteWorkflowPacketAttachment(observedFollowupMetrics, {
            minEligibleCount: 1,
            minHelpedRate: 1,
            minNoNoiseRate: 1,
            minActualFollowupRate: 0.5,
          }),
          true,
        );
        assert.equal(
          shouldPromoteWorkflowPacketAttachment(observedFollowupMetrics, {
            minEligibleCount: 1,
            minHelpedRate: 1,
            minNoNoiseRate: 1,
            minActualFollowupRate: 1.1,
          }),
          false,
          "observed follow-up should become a real promotion gate once a threshold is configured",
        );
      } finally {
        projectStore.close();
      }
      assert.ok(
        !result.packet.missingInformation.includes("Evidence synthesis is not implemented yet in v1 foundation."),
        "askQuestion should not use the legacy CLI packet defaults",
      );
    } finally {
      api.close();
    }

    console.log("api-answer-question: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
