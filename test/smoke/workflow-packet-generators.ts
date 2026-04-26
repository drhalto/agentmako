import assert from "node:assert/strict";
import {
  AnswerResultSchema,
  type AnswerResult,
  type EvidenceBlock,
  type WorkflowContextItemKind,
  type WorkflowPacket,
} from "../../packages/contracts/src/index.ts";
import {
  assertWorkflowPacketIntegrity,
  buildWorkflowPacketInput,
  formatWorkflowPacket,
  generateWorkflowPacket,
} from "../../packages/tools/src/index.ts";

function buildEvidence(): EvidenceBlock[] {
  return [
    {
      blockId: "ev-page",
      kind: "file",
      title: "app/events/[id]/page.tsx",
      sourceRef: "app/events/[id]/page.tsx:12",
      filePath: "app/events/[id]/page.tsx",
      line: 12,
      content: "export default async function EventPage() {}",
      metadata: {},
    },
    {
      blockId: "ev-helper",
      kind: "symbol",
      title: "function loadVisibleEvents",
      sourceRef: "lib/events/actions.ts:42",
      filePath: "lib/events/actions.ts",
      line: 42,
      content: "export async function loadVisibleEvents() {}",
      metadata: {
        exportName: "loadVisibleEvents",
      },
    },
    {
      blockId: "ev-route",
      kind: "route",
      title: "/api/events/[id] → getEventRoute",
      sourceRef: "route:app/api/events/[id]/route.ts",
      filePath: "app/api/events/[id]/route.ts",
      line: 8,
      content: "GET /api/events/[id]",
      metadata: {
        isApi: true,
      },
    },
    {
      blockId: "ev-rpc",
      kind: "trace",
      title: "public.get_visible_events",
      sourceRef: "rpc:public.get_visible_events",
      content: "select * from public.get_visible_events($1)",
      metadata: {
        schemaName: "public",
        rpcName: "get_visible_events",
        argTypes: ["uuid"],
      },
    },
    {
      blockId: "ev-table",
      kind: "schema",
      title: "public.events",
      sourceRef: "schema:public.events",
      content: "table public.events",
      metadata: {
        schemaName: "public",
        tableName: "events",
      },
    },
  ];
}

function buildAnswerResult(): AnswerResult {
  const queryId = "query_workflow_packet_phase51";
  return {
    queryId,
    projectId: "project_workflow_packet_phase51",
    queryKind: "trace_file",
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer:
      "The events page bypasses the shared helper while the route and RPC already define the expected path.",
    answerConfidence: 0.95,
    candidateActions: [
      {
        actionId: "open_file",
        label: "Open file",
        description: "Inspect the event page.",
        safeToAutomate: true,
      },
    ],
    packet: {
      queryId,
      projectId: "project_workflow_packet_phase51",
      queryKind: "trace_file",
      queryText: "trace_file(app/events/[id]/page.tsx)",
      tierUsed: "standard",
      supportLevel: "native",
      evidenceStatus: "complete",
      evidenceConfidence: 0.97,
      missingInformation: ["Need to verify whether admin-only event fields are filtered server-side."],
      stalenessFlags: [],
      evidence: buildEvidence(),
      generatedAt: "2026-04-19T10:15:00.000Z",
    },
    trust: {
      state: "changed",
      reasons: [
        {
          code: "meaningful_change_detected",
          detail: "The latest comparable run changed the supporting evidence set.",
        },
      ],
      basisTraceIds: ["trace_prev_phase51"],
      conflictingFacets: ["evidence_set"],
      scopeRelation: "same_scope",
      comparisonId: "comparison_phase51",
      clusterId: "cluster_phase51",
      comparisonSummary: [
        {
          code: "evidence_removed",
          detail: "A prior helper reference disappeared from the latest run.",
        },
      ],
      issues: [],
    },
    diagnostics: [
      {
        severity: "medium",
        confidence: "confirmed",
        category: "rpc_helper_reuse",
        code: "reuse.helper_bypass",
        message: "The page bypasses the shared get_visible_events helper.",
        path: "app/events/[id]/page.tsx",
        producerPath: "lib/events/actions.ts",
        consumerPath: "app/events/[id]/page.tsx",
        line: 12,
        evidenceRefs: ["app/events/[id]/page.tsx:12", "lib/events/actions.ts:42"],
        identity: {
          matchBasedId: "reuse.helper_bypass:app/events/[id]/page.tsx:loadVisibleEvents",
          codeHash: "codehash51",
          patternHash: "patternhash51",
        },
        metadata: {
          helperName: "loadVisibleEvents",
        },
      },
    ],
  };
}

function buildSparseAnswerResult(): AnswerResult {
  const queryId = "query_workflow_packet_phase51_sparse";
  return {
    queryId,
    projectId: "project_workflow_packet_phase51",
    queryKind: "free_form",
    tierUsed: "standard",
    supportLevel: "best_effort",
    evidenceStatus: "partial",
    answer: "No concrete reusable surface was identified yet.",
    answerConfidence: 0.4,
    candidateActions: [],
    packet: {
      queryId,
      projectId: "project_workflow_packet_phase51",
      queryKind: "free_form",
      queryText: "where is the reusable event flow?",
      tierUsed: "standard",
      supportLevel: "best_effort",
      evidenceStatus: "partial",
      evidenceConfidence: 0.2,
      missingInformation: ["Need a concrete file, symbol, or route before planning a safe edit."],
      stalenessFlags: [],
      evidence: [],
      generatedAt: "2026-04-19T10:18:00.000Z",
    },
  };
}

function buildReferencePrecedents() {
  return [
    {
      repoName: "codex-main",
      path: "codex-rs/collaboration-mode-templates/templates/plan.md",
      startLine: 1,
      endLine: 32,
      excerpt: "Summary, interface changes, tests, and assumptions for the implementation plan.",
      searchKind: "ref_file" as const,
      score: 0.82,
      vecRank: 1,
      ftsRank: 2,
    },
    {
      repoName: "cody-public-snapshot-main",
      path: "lib/shared/src/codebase-context/messages.ts",
      startLine: 40,
      endLine: 84,
      excerpt: "Typed context items for codebase-aware assistance.",
      searchKind: "ref_search" as const,
      score: 0.67,
      vecRank: 2,
      ftsRank: 1,
    },
  ];
}

function assertCompact(packet: WorkflowPacket, maxEntriesPerSection: number, maxEntryLength: number): void {
  for (const section of packet.sections) {
    assert.ok(
      section.entries.length <= maxEntriesPerSection,
      `${packet.family} section ${section.title} should stay compact`,
    );
    for (const entry of section.entries) {
      assert.ok(
        entry.text.length <= maxEntryLength,
        `${packet.family} entry in ${section.title} should stay concise`,
      );
    }
  }
}

async function main(): Promise<void> {
  const result = buildAnswerResult();
  const referencePrecedents = buildReferencePrecedents();
  const primaryInputWithoutReferences = buildWorkflowPacketInput(result, {
    family: "precedent_pack",
    scope: "primary",
  });
  const primaryInputWithReferences = buildWorkflowPacketInput(result, {
    family: "precedent_pack",
    scope: "primary",
    referencePrecedents,
  });
  AnswerResultSchema.parse(result);
  assert.ok(
    primaryInputWithReferences.selectedItems.some((item) => item.kind === "reference_precedent"),
    "reference precedents should remain selected even in primary-scope packet inputs",
  );
  assert.deepEqual(
    primaryInputWithReferences.selectedItems.find((item) => item.kind === "trust_evaluation"),
    primaryInputWithoutReferences.selectedItems.find((item) => item.kind === "trust_evaluation"),
    "reference precedents must not change the local trust evaluation context",
  );
  assert.deepEqual(
    primaryInputWithReferences.selectedItems.find((item) => item.kind === "comparison"),
    primaryInputWithoutReferences.selectedItems.find((item) => item.kind === "comparison"),
    "reference precedents must not change the local comparison context",
  );
  const workflowRecipeRequest = {
    family: "workflow_recipe" as const,
    scope: "all" as const,
    focusKinds: ["file", "diagnostic", "symbol"] as WorkflowContextItemKind[],
  };

  const implementationBrief = await generateWorkflowPacket(result, {
    family: "implementation_brief",
    scope: "all",
    focusKinds: ["file", "diagnostic", "symbol"],
  });
  assert.equal(implementationBrief.family, "implementation_brief");
  assert.ok(implementationBrief.sections.length <= 5, "implementation brief should stay compact");
  assertCompact(implementationBrief, 4, 180);
  assert.ok(
    implementationBrief.sections.some((section) => section.title === "Change Areas"),
    "implementation brief should include change areas",
  );
  assert.ok(
    implementationBrief.sections.some((section) => section.title === "Acceptance And Verification"),
    "implementation brief should include verification guidance",
  );
  assert.ok(
    implementationBrief.citations.some((citation) => citation.itemId === "file:app/events/[id]/page.tsx"),
  );
  assert.deepEqual(implementationBrief.openQuestions, [
    "Need to verify whether admin-only event fields are filtered server-side.",
  ]);

  const precedentPack = await generateWorkflowPacket(result, {
    family: "precedent_pack",
    scope: "all",
    focusKinds: ["symbol", "rpc", "route", "table"],
  });
  assert.equal(precedentPack.family, "precedent_pack");
  assert.ok(precedentPack.payload.canonicalPrecedentItemIds.length === 1);
  assert.equal(
    precedentPack.payload.canonicalPrecedentItemIds[0],
    "symbol:lib/events/actions.ts:loadVisibleEvents:42",
    "the shared helper should win as the canonical precedent",
  );
  assert.ok(
    precedentPack.payload.secondaryPrecedentItemIds.includes("rpc:public.get_visible_events(uuid)"),
  );
  assert.ok(
    precedentPack.sections.some((section) => section.title === "Precedents"),
    "precedent pack should expose the ranked precedents",
  );
  assert.ok(
    precedentPack.sections.some((section) => section.title === "Gaps And Caveats"),
    "precedent pack should surface reuse caveats",
  );
  assertCompact(precedentPack, 4, 180);

  const precedentPackWithReferences = await generateWorkflowPacket(result, {
    family: "precedent_pack",
    scope: "all",
    focusKinds: ["symbol", "rpc", "route", "table"],
    referencePrecedents,
  });
  assert.equal(
    precedentPackWithReferences.payload.canonicalPrecedentItemIds[0],
    "symbol:lib/events/actions.ts:loadVisibleEvents:42",
    "strong local precedents should still outrank external references",
  );
  assert.ok(
    precedentPackWithReferences.payload.referencePrecedentItemIds.includes(
      "reference:codex-main:codex-rs/collaboration-mode-templates/templates/plan.md:1-32:ref_file",
    ),
    "reference precedents should remain visible as advisory secondary context",
  );
  assert.ok(
    precedentPackWithReferences.assumptions.includes(
      "Reference repo precedents are advisory only and do not change local trust state.",
    ),
    "reference-backed precedent packs should make the advisory trust boundary explicit",
  );

  const renderedBrief = formatWorkflowPacket(implementationBrief);
  const renderedPrecedent = formatWorkflowPacket(precedentPack);
  const renderedReferencePrecedent = formatWorkflowPacket(precedentPackWithReferences);
  assert.ok(renderedBrief.includes("Implementation Brief"));
  assert.ok(renderedPrecedent.includes("Precedent Pack"));
  assert.ok(renderedPrecedent.includes("loadVisibleEvents"));
  assert.ok(renderedPrecedent.includes("reuse.helper_bypass"));
  assert.ok(renderedReferencePrecedent.includes("via reference repo: codex-main"));

  const impactPacket = await generateWorkflowPacket(result, {
    family: "impact_packet",
    scope: "all",
    focusKinds: ["file", "route", "diagnostic"],
  });
  assert.equal(impactPacket.family, "impact_packet");
  assertCompact(impactPacket, 10, 200);
  assert.ok(
    impactPacket.payload.directImpactItemIds.includes("file:app/events/[id]/page.tsx"),
    "the events page should be part of the direct impact set",
  );
  assert.ok(
    impactPacket.payload.adjacentImpactItemIds.includes("symbol:lib/events/actions.ts:loadVisibleEvents:42"),
    "the shared helper should appear as adjacent impact",
  );
  assert.ok(
    impactPacket.payload.uncertainImpactItemIds.includes(
      "diagnostic:reuse.helper_bypass:app/events/[id]/page.tsx:loadVisibleEvents",
    ),
    "the current diagnostic should stay in the uncertain impact bucket",
  );
  assert.ok(
    impactPacket.sections.some((section) => section.title === "Risks And Caveats"),
    "impact packet should surface trust and diagnostic caveats",
  );
  assert.deepEqual(impactPacket.openQuestions, [
    "Need to verify whether admin-only event fields are filtered server-side.",
  ]);

  const verificationPlan = await generateWorkflowPacket(result, {
    family: "verification_plan",
    scope: "all",
    focusKinds: ["file", "symbol", "diagnostic"],
  });
  assert.equal(verificationPlan.family, "verification_plan");
  assertCompact(verificationPlan, 5, 220);
  assert.ok(
    verificationPlan.sections.some((section) => section.title === "Baseline And Current State"),
    "verification plan should make the baseline explicit",
  );
  assert.ok(
    verificationPlan.sections.some((section) => section.kind === "baseline"),
    "verification plan should use a dedicated baseline section kind",
  );
  assert.ok(
    verificationPlan.sections.some((section) => section.title === "Done Criteria"),
    "verification plan should have explicit done criteria",
  );
  assert.ok(
    verificationPlan.sections.some((section) => section.title === "Rerun And Refresh Triggers"),
    "verification plan should make rerun triggers explicit",
  );
  assert.ok(
    verificationPlan.sections.some((section) => section.kind === "rerun_triggers"),
    "verification plan should use a dedicated rerun-trigger section kind",
  );
  assert.ok(
    verificationPlan.sections.some((section) =>
      section.entries.some((entry) => entry.text.includes("Rerun and compare again")),
    ),
    "verification plan should include an explicit rerun/recompare trigger",
  );
  assert.ok(
    verificationPlan.sections.some((section) =>
      section.entries.some((entry) => entry.text.includes("Current diagnostic findings are gone")),
    ),
    "verification plan should make done criteria explicit instead of implied",
  );
  assert.ok(
    verificationPlan.sections.some((section) =>
      section.entries.some((entry) => entry.text.includes("trust state as changed")),
    ),
    "verification plan should surface the current trust caveat explicitly",
  );
  assert.ok(
    verificationPlan.sections.some((section) =>
      section.entries.some((entry) => entry.metadata?.verificationKind === "rerun_trigger"),
    ),
    "verification plan entries should carry machine-readable verification metadata",
  );

  const workflowRecipe = await generateWorkflowPacket(result, {
    ...workflowRecipeRequest,
  });
  assert.equal(workflowRecipe.family, "workflow_recipe");
  assert.equal(workflowRecipe.metadata?.recipeKind, "debug_fix");
  assertCompact(workflowRecipe, 5, 220);
  assert.equal(workflowRecipe.payload.steps.length, 5);
  assert.equal(
    workflowRecipe.payload.steps.filter((step) => step.status === "in_progress").length,
    1,
    "workflow recipe should have exactly one active step",
  );
  assert.ok(
    workflowRecipe.payload.steps.every((step) => step.verification.length > 0),
    "every workflow recipe step should have explicit verification",
  );
  assert.ok(
    workflowRecipe.payload.steps.every((step) => step.stopConditions.length > 0),
    "every workflow recipe step should have explicit stop conditions",
  );
  assert.ok(
    workflowRecipe.payload.steps.some((step) => step.rerunTriggers.length > 0),
    "workflow recipe should carry explicit rerun triggers when trust/compare state exists",
  );
  assert.ok(
    workflowRecipe.sections.some((section) => section.kind === "steps"),
    "workflow recipe should expose a step section",
  );
  assert.ok(
    workflowRecipe.sections.some((section) =>
      section.entries.some((entry) => entry.metadata?.status === "in_progress"),
    ),
    "workflow recipe step entries should carry machine-readable status",
  );

  const renderedRecipe = formatWorkflowPacket(workflowRecipe);
  assert.ok(renderedRecipe.includes("Workflow Recipe"));
  assert.ok(renderedRecipe.includes("Capture the current failure or drift"));
  assert.ok(renderedRecipe.includes("Verify:"));
  assert.ok(renderedRecipe.includes("Stop when:"));
  assert.ok(renderedRecipe.includes("Refresh when:"));

  const sparseResult = buildSparseAnswerResult();
  AnswerResultSchema.parse(sparseResult);

  const sparseBrief = await generateWorkflowPacket(sparseResult, {
    family: "implementation_brief",
    scope: "all",
  });
  const sparseSummary = sparseBrief.sections.find((section) => section.title === "Summary");
  assert.ok(sparseSummary, "sparse brief should still render a summary");
  assert.equal(
    sparseSummary?.entries[0]?.text,
    "Use the selected context as the immediate change brief.",
  );
  assert.ok(
    sparseBrief.sections.every((section) => section.title !== "Risks"),
    "sparse brief should not invent a risks section without trust or diagnostics",
  );

  const sparsePrecedent = await generateWorkflowPacket(sparseResult, {
    family: "precedent_pack",
    scope: "all",
  });
  assert.deepEqual(sparsePrecedent.payload.canonicalPrecedentItemIds, []);
  assert.ok(
    sparsePrecedent.sections.some((section) =>
      section.entries.some((entry) => entry.text.includes("No strong reusable precedent")),
    ),
    "sparse precedent packs should expose the weak-precedent gap explicitly",
  );
  assert.equal(sparsePrecedent.citations.length, 0);

  const sparseReferencePrecedent = await generateWorkflowPacket(sparseResult, {
    family: "precedent_pack",
    scope: "all",
    referencePrecedents,
  });
  assert.deepEqual(sparseReferencePrecedent.payload.canonicalPrecedentItemIds, [
    "reference:codex-main:codex-rs/collaboration-mode-templates/templates/plan.md:1-32:ref_file",
  ]);
  assert.ok(
    sparseReferencePrecedent.payload.referencePrecedentItemIds.includes(
      "reference:codex-main:codex-rs/collaboration-mode-templates/templates/plan.md:1-32:ref_file",
    ),
    "reference-backed sparse precedent packs should track the external canonical precedent",
  );
  assert.ok(
    sparseReferencePrecedent.sections.some((section) =>
      section.entries.some((entry) => entry.text.includes("No strong local precedent is present")),
    ),
    "reference-backed sparse precedent packs should explain why the external precedent is being used",
  );
  assert.ok(
    sparseReferencePrecedent.assumptions.includes(
      "Reference repo precedents are advisory only and do not change local trust state.",
    ),
  );

  const sparseImpact = await generateWorkflowPacket(sparseResult, {
    family: "impact_packet",
    scope: "all",
  });
  assert.deepEqual(sparseImpact.payload.directImpactItemIds, []);
  assert.deepEqual(sparseImpact.payload.adjacentImpactItemIds, []);
  assert.deepEqual(sparseImpact.payload.uncertainImpactItemIds, []);

  const sparseVerification = await generateWorkflowPacket(sparseResult, {
    family: "verification_plan",
    scope: "all",
  });
  assert.ok(
    sparseVerification.sections.some((section) => section.title === "Baseline And Current State"),
    "sparse verification plans should still include a current-state baseline",
  );
  assert.ok(
    sparseVerification.sections.some((section) => section.title === "Done Criteria"),
    "sparse verification plans should still include explicit done criteria",
  );

  const sparseRecipe = await generateWorkflowPacket(sparseResult, {
    family: "workflow_recipe",
    scope: "all",
  });
  assert.equal(sparseRecipe.metadata?.recipeKind, "review_verify");
  assert.equal(
    sparseRecipe.payload.steps.filter((step) => step.status === "in_progress").length,
    1,
    "sparse workflow recipes should still keep a single active step",
  );
  assert.ok(
    sparseRecipe.payload.steps.every((step) => step.verification.length > 0),
    "sparse workflow recipes should still make verification explicit",
  );
  assert.ok(
    sparseRecipe.payload.steps.every((step) => step.stopConditions.length > 0),
    "sparse workflow recipes should still make stop conditions explicit",
  );

  const workflowRecipeInput = buildWorkflowPacketInput(result, workflowRecipeRequest);
  const invalidActiveRecipe = structuredClone(workflowRecipe);
  invalidActiveRecipe.payload.steps[1] = {
    ...invalidActiveRecipe.payload.steps[1],
    status: "in_progress",
  };
  assert.throws(
    () => assertWorkflowPacketIntegrity(invalidActiveRecipe, workflowRecipeInput),
    /exactly one in_progress recipe step/,
  );

  const invalidVerificationRecipe = structuredClone(workflowRecipe);
  invalidVerificationRecipe.payload.steps[0] = {
    ...invalidVerificationRecipe.payload.steps[0],
    verification: [],
  };
  assert.throws(
    () => assertWorkflowPacketIntegrity(invalidVerificationRecipe, workflowRecipeInput),
    /must include verification rules/,
  );

  console.log("workflow-packet-generators: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
