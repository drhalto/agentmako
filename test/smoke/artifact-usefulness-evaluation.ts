import assert from "node:assert/strict";
import type {
  ChangePlanResult,
  FlowMapResult,
  ImplementationHandoffArtifact,
  IssuesNextResult,
  ReviewBundleArtifact,
  SessionHandoffResult,
  TaskPreflightArtifact,
  TenantLeakAuditResult,
  VerificationBundleArtifact,
  WorkflowImpactPacket,
  WorkflowImplementationBriefPacket,
  WorkflowPacketSurface,
  WorkflowVerificationPlanPacket,
} from "../../packages/contracts/src/index.ts";
import {
  decideArtifactExposure,
  decideArtifactWrapperExposure,
  evaluateArtifactUsefulness,
  evaluateArtifactWrapperUsefulness,
  generateImplementationHandoffArtifact,
  generateReviewBundleArtifact,
  generateTaskPreflightArtifact,
  generateVerificationBundleArtifact,
  summarizeArtifactPromotionMetrics,
  summarizeArtifactWrapperPromotionMetrics,
} from "../../packages/tools/src/index.ts";

/**
 * 7.5 artifact + wrapper usefulness evaluation smoke.
 *
 * Covers all four shipped artifact families and both shipped wrapper
 * families (tool_plane, file_export). Asserts:
 *
 * - grade + reason codes are what the 7.5 scoring rules say
 * - basis-close payload sections lift the grade (workflow_followup,
 *   impact_packet, diagnostics, trustState)
 * - promotion metrics aggregate correctly
 * - exposure decisions follow the policy table
 * - wrapper eval grades independently from the artifact it delivered
 *
 * Fixtures are minimal in-memory inputs — the evaluator operates on
 * typed artifacts, not live project state, so there's no need to seed
 * a real project here.
 */

function createImplementationBriefSurface(): WorkflowPacketSurface & {
  packet: WorkflowImplementationBriefPacket;
} {
  const packet: WorkflowImplementationBriefPacket = {
    packetId: "workflow_packet_impl_1",
    family: "implementation_brief",
    title: "Implementation Brief",
    queryId: "query_impl_1",
    projectId: "proj_1",
    basis: {
      scope: "primary",
      watchMode: "off",
      selectedItemIds: ["file:app/routes/events.tsx"],
      focusedItemIds: ["file:app/routes/events.tsx"],
      primaryItemIds: ["file:app/routes/events.tsx"],
      supportingItemIds: [],
    },
    sections: [
      {
        sectionId: "section_summary",
        kind: "summary",
        title: "Summary",
        entries: [
          { entryId: "entry_summary", text: "Start in app/routes/events.tsx.", citationIds: [] },
        ],
      },
      {
        sectionId: "section_change_areas",
        kind: "change_areas",
        title: "Change Areas",
        entries: [
          { entryId: "entry_change_1", text: "Update app/routes/events.tsx first.", citationIds: [] },
        ],
      },
      {
        sectionId: "section_invariants",
        kind: "invariants",
        title: "Invariants",
        entries: [
          { entryId: "entry_invariant_1", text: "Preserve the events fetch path.", citationIds: [] },
        ],
      },
      {
        sectionId: "section_risks",
        kind: "risks",
        title: "Risks",
        entries: [
          { entryId: "entry_risk_1", text: "Regression risk on events fetch.", citationIds: [] },
        ],
      },
      {
        sectionId: "section_verification",
        kind: "verification",
        title: "Verification",
        entries: [
          { entryId: "entry_verify_1", text: "Trace the events route after the edit.", citationIds: [] },
        ],
      },
    ],
    citations: [],
    assumptions: [],
    openQuestions: [],
    payload: {
      summarySectionId: "section_summary",
      changeAreasSectionId: "section_change_areas",
      invariantsSectionId: "section_invariants",
      risksSectionId: "section_risks",
      verificationSectionId: "section_verification",
    },
  };
  return {
    packet,
    rendered: "Impl brief rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: null, reusableContext: "resource" },
    watch: { mode: "off", stablePacketId: packet.packetId, refreshReason: "manual", refreshTriggers: [] },
  };
}

function createVerificationPlanSurface(): WorkflowPacketSurface & {
  packet: WorkflowVerificationPlanPacket;
} {
  const packet: WorkflowVerificationPlanPacket = {
    packetId: "workflow_packet_verify_1",
    family: "verification_plan",
    title: "Verification Plan",
    queryId: "query_verify_1",
    projectId: "proj_1",
    basis: {
      scope: "primary",
      watchMode: "off",
      selectedItemIds: ["file:app/routes/events.tsx"],
      focusedItemIds: ["file:app/routes/events.tsx"],
      primaryItemIds: ["file:app/routes/events.tsx"],
      supportingItemIds: [],
    },
    sections: [
      {
        sectionId: "verify_summary",
        kind: "summary",
        title: "Summary",
        entries: [{ entryId: "v_sum", text: "Verify events route and RPC.", citationIds: [] }],
      },
      {
        sectionId: "verify_baseline",
        kind: "baseline",
        title: "Baseline",
        entries: [{ entryId: "v_base", text: "Capture current route output.", citationIds: [] }],
      },
      {
        sectionId: "verify_steps",
        kind: "verification",
        title: "Verification",
        entries: [
          { entryId: "v_step_1", text: "Re-run the route.", citationIds: [] },
          { entryId: "v_step_2", text: "Re-run the RPC.", citationIds: [] },
        ],
      },
      {
        sectionId: "verify_done",
        kind: "done_criteria",
        title: "Done",
        entries: [{ entryId: "v_done", text: "Stop when route + RPC both resolve.", citationIds: [] }],
      },
      {
        sectionId: "verify_rerun",
        kind: "rerun_triggers",
        title: "Rerun",
        entries: [
          { entryId: "v_rerun", text: "Refresh if the route handler changes.", citationIds: [] },
        ],
      },
    ],
    citations: [],
    assumptions: [],
    openQuestions: [],
    payload: {
      summarySectionId: "verify_summary",
      baselineSectionId: "verify_baseline",
      verificationSectionId: "verify_steps",
      doneCriteriaSectionId: "verify_done",
      rerunTriggerSectionId: "verify_rerun",
    },
  };
  return {
    packet,
    rendered: "Verify plan rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: "prompt", reusableContext: null },
    watch: { mode: "off", stablePacketId: packet.packetId, refreshReason: "manual", refreshTriggers: [] },
  };
}

function createImpactPacketSurface(): WorkflowPacketSurface & { packet: WorkflowImpactPacket } {
  const packet: WorkflowImpactPacket = {
    packetId: "workflow_packet_impact_1",
    family: "impact_packet",
    title: "Impact Packet",
    queryId: "query_impact_1",
    projectId: "proj_1",
    basis: {
      scope: "primary",
      watchMode: "off",
      selectedItemIds: ["file:app/routes/events.tsx"],
      focusedItemIds: ["file:app/routes/events.tsx"],
      primaryItemIds: ["file:app/routes/events.tsx"],
      supportingItemIds: [],
    },
    sections: [
      {
        sectionId: "impact_summary",
        kind: "summary",
        title: "Summary",
        entries: [{ entryId: "imp_sum", text: "Change touches events route + RPC + table.", citationIds: [] }],
      },
      {
        sectionId: "impact_zones",
        kind: "impact",
        title: "Impact",
        entries: [
          { entryId: "imp_direct", text: "Direct: events route handler.", citationIds: [] },
          { entryId: "imp_adjacent", text: "Adjacent: refresh_events RPC.", citationIds: [] },
        ],
      },
      {
        sectionId: "impact_risks",
        kind: "risks",
        title: "Risks",
        entries: [{ entryId: "imp_risk", text: "Schema fingerprint may move.", citationIds: [] }],
      },
    ],
    citations: [],
    assumptions: [],
    openQuestions: [],
    payload: {
      summarySectionId: "impact_summary",
      impactSectionId: "impact_zones",
      risksSectionId: "impact_risks",
      directImpactItemIds: ["file:app/routes/events.tsx"],
      adjacentImpactItemIds: [],
      uncertainImpactItemIds: [],
    },
  };
  return {
    packet,
    rendered: "Impact packet rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: null, reusableContext: "resource" },
    watch: { mode: "off", stablePacketId: packet.packetId, refreshReason: "manual", refreshTriggers: [] },
  };
}

function createChangePlan(): ChangePlanResult {
  return {
    requestedStartEntity: { kind: "route", key: "GET /events" },
    requestedTargetEntity: { kind: "table", key: "public.events" },
    resolvedStartNode: { nodeId: "n_route", kind: "route", key: "GET /events", label: "GET /events" },
    resolvedTargetNode: { nodeId: "n_table", kind: "table", key: "public.events", label: "public.events" },
    direction: "downstream",
    traversalDepth: 6,
    includeHeuristicEdges: true,
    pathFound: true,
    directSurfaces: [
      {
        surfaceId: "surf_route",
        node: { nodeId: "n_route", kind: "route", key: "GET /events", label: "GET /events" },
        role: "direct",
        distance: 0,
        rationale: "Entry point.",
        via: [],
        containsHeuristicEdge: false,
      },
    ],
    dependentSurfaces: [],
    steps: [
      {
        stepId: "step_1",
        title: "Change route",
        surfaceId: "surf_route",
        dependsOnStepIds: [],
        rationale: "Entry point.",
      },
    ],
    containsHeuristicEdge: false,
    graphBasis: {
      strategy: "whole_project",
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
    },
    warnings: [],
  };
}

function createFlowMap(): FlowMapResult {
  return {
    requestedStartEntity: { kind: "route", key: "GET /events" },
    requestedTargetEntity: { kind: "table", key: "public.events" },
    resolvedStartNode: { nodeId: "n_route", kind: "route", key: "GET /events", label: "GET /events" },
    resolvedTargetNode: { nodeId: "n_table", kind: "table", key: "public.events", label: "public.events" },
    direction: "downstream",
    traversalDepth: 6,
    includeHeuristicEdges: true,
    pathFound: true,
    steps: [
      { stepIndex: 0, node: { nodeId: "n_route", kind: "route", key: "GET /events", label: "GET /events" }, boundary: "route" },
      { stepIndex: 1, node: { nodeId: "n_table", kind: "table", key: "public.events", label: "public.events" }, boundary: "data" },
    ],
    transitions: [],
    majorBoundaryKinds: ["route", "data"],
    containsHeuristicEdge: false,
    graphBasis: {
      strategy: "whole_project",
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
    },
    warnings: [],
  };
}

function createSessionHandoff(): SessionHandoffResult {
  return {
    generatedAt: "2026-04-22T00:00:00.000Z",
    basis: {
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
      sourceTraceLimit: 8,
    },
    summary: { recentQueryCount: 3, unresolvedQueryCount: 1, changedQueryCount: 1, queriesWithFollowups: 1 },
    currentFocus: {
      traceId: "trace_current",
      targetId: "target_events",
      comparisonId: null,
      queryKind: "trace_file",
      queryText: "trace app/routes/events.tsx",
      createdAt: "2026-04-22T00:00:00.000Z",
      supportLevel: "native",
      evidenceStatus: "complete",
      trustState: "changed",
      meaningfulChangeDetected: true,
      followupCount: 1,
      lastFollowupAt: "2026-04-22T00:05:00.000Z",
      signalCodes: ["trust_changed"],
      isCurrentFocus: true,
      reasonCode: "trust_changed",
      reason: "Recent trace output changed.",
      stopWhen: ["trust becomes stable"],
    },
    recentQueries: [],
    warnings: [],
  };
}

function createIssuesNext(): IssuesNextResult {
  return {
    generatedAt: "2026-04-22T00:00:00.000Z",
    basis: {
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
      sourceTraceLimit: 8,
    },
    summary: {
      recentQueryCount: 4,
      candidateCount: 2,
      activeCount: 1,
      queuedCount: 1,
      truncatedQueuedCount: 0,
      suppressedStableCount: 2,
      queriesWithFollowups: 1,
    },
    currentIssue: null,
    queuedIssues: [],
    warnings: [],
  };
}

function createTenantLeakAudit(): TenantLeakAuditResult {
  return {
    advisoryOnly: true,
    rolloutStage: "opt_in",
    basis: { latestIndexRunId: "idx_1", schemaSnapshotId: "snap_1", schemaFingerprint: "schema_fp_1" },
    tenantSignals: ["tenant_id"],
    protectedTables: [],
    findings: [
      {
        findingId: "f_direct",
        strength: "direct_evidence",
        surfaceKind: "table",
        surfaceKey: "public.events",
        code: "table_rls_disabled",
        message: "public.events has tenant-keyed data without RLS enabled.",
        evidenceRefs: [],
        tenantSignals: ["tenant_id"],
      },
    ],
    reviewedSurfaces: [],
    summary: {
      protectedTableCount: 1,
      directEvidenceCount: 1,
      weakSignalCount: 0,
      reviewedSurfaceCount: 0,
    },
    warnings: [],
  };
}

async function main(): Promise<void> {
  const brief = createImplementationBriefSurface();
  const verify = createVerificationPlanSurface();
  const changePlan = createChangePlan();
  const flowMap = createFlowMap();
  const sessionHandoff = createSessionHandoff();
  const issuesNext = createIssuesNext();
  const tenantLeakAudit = createTenantLeakAudit();
  const impactPacket = createImpactPacketSurface();

  // === task_preflight ===
  const taskPreflight: TaskPreflightArtifact = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    verificationPlan: verify,
    changePlan,
    flowMap,
    generatedAt: "2026-04-22T01:00:00.000Z",
  });
  const preflightEval = evaluateArtifactUsefulness(taskPreflight);
  assert.equal(preflightEval.kind, "task_preflight");
  assert.equal(preflightEval.eligible, true);
  assert.equal(
    preflightEval.grade,
    "full",
    "task_preflight with all sections should grade full",
  );
  assert.ok(preflightEval.reasonCodes.includes("basis_complete"));
  assert.ok(preflightEval.reasonCodes.includes("preflight_has_read_items"));
  assert.ok(preflightEval.reasonCodes.includes("preflight_has_change_surfaces"));
  assert.ok(preflightEval.reasonCodes.includes("preflight_has_verification_steps"));
  assert.ok(preflightEval.reason.length > 0, "reason string must be non-empty");

  // Empty-surface preflight degrades to partial — still has read items + verify
  // steps, but no change surfaces.
  const emptySurfacePreflight = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    verificationPlan: verify,
    changePlan: { ...changePlan, directSurfaces: [], dependentSurfaces: [], steps: [], pathFound: false },
    flowMap,
    generatedAt: "2026-04-22T01:05:00.000Z",
  });
  const emptyPreflightEval = evaluateArtifactUsefulness(emptySurfacePreflight);
  assert.ok(emptyPreflightEval.reasonCodes.includes("preflight_empty_surfaces"));
  assert.notEqual(
    emptyPreflightEval.grade,
    "no",
    "empty-surface preflight still has read items + verify steps, should be partial or better",
  );

  // === implementation_handoff ===
  const handoffWithoutFollowups: ImplementationHandoffArtifact = generateImplementationHandoffArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    sessionHandoff,
    generatedAt: "2026-04-22T01:10:00.000Z",
  });
  const handoffEvalWithoutFollowups = evaluateArtifactUsefulness(handoffWithoutFollowups);
  assert.equal(handoffEvalWithoutFollowups.kind, "implementation_handoff");
  assert.equal(handoffEvalWithoutFollowups.grade, "full");
  assert.ok(handoffEvalWithoutFollowups.reasonCodes.includes("handoff_current_focus_present"));
  assert.ok(handoffEvalWithoutFollowups.reasonCodes.includes("handoff_key_context_present"));
  assert.ok(!handoffEvalWithoutFollowups.reasonCodes.includes("handoff_prior_followups_present"));

  const handoffWithFollowups = generateImplementationHandoffArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    sessionHandoff,
    workflowFollowups: [
      {
        followupId: "f_1",
        projectId: "proj_1",
        originQueryId: "query_impl_1",
        originActionId: "action_1",
        originPacketFamily: "implementation_brief" as const,
        originQueryKind: "trace_file" as const,
        executedToolName: "change_plan",
        executedInput: {},
        resultPacketId: "p_impact",
        resultPacketFamily: "impact_packet" as const,
        resultQueryId: "q_impact",
        createdAt: "2026-04-22T00:30:00.000Z",
      },
    ],
    generatedAt: "2026-04-22T01:15:00.000Z",
  });
  const handoffEvalWithFollowups = evaluateArtifactUsefulness(handoffWithFollowups);
  assert.ok(
    handoffEvalWithFollowups.reasonCodes.includes("handoff_prior_followups_present"),
    "workflow_followup basis must lift a reason code",
  );

  // === review_bundle ===
  const thinReview: ReviewBundleArtifact = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    changePlan,
    flowMap,
    tenantLeakAudit,
    generatedAt: "2026-04-22T01:20:00.000Z",
  });
  const thinReviewEval = evaluateArtifactUsefulness(thinReview);
  assert.equal(thinReviewEval.kind, "review_bundle");
  assert.ok(!thinReviewEval.reasonCodes.includes("review_impact_zones_present"));
  assert.ok(!thinReviewEval.reasonCodes.includes("review_diagnostic_findings_present"));

  const fullReview = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief: brief,
    changePlan,
    flowMap,
    tenantLeakAudit,
    impactPacket,
    diagnostics: {
      findings: [
        {
          severity: "medium",
          confidence: "probable",
          category: "producer_consumer_drift",
          code: "events_route_rpc_drift",
          message: "Consumer expects fields the RPC no longer returns.",
          path: "app/routes/events.tsx",
          line: 42,
          evidenceRefs: [],
          identity: { matchBasedId: "m_1", codeHash: "h_1", patternHash: "p_1" },
        },
      ],
      focusFiles: ["app/routes/events.tsx"],
    },
    generatedAt: "2026-04-22T01:25:00.000Z",
  });
  const fullReviewEval = evaluateArtifactUsefulness(fullReview);
  assert.ok(fullReviewEval.reasonCodes.includes("review_impact_zones_present"));
  assert.ok(fullReviewEval.reasonCodes.includes("review_diagnostic_findings_present"));
  assert.equal(fullReviewEval.grade, "full");

  // === verification_bundle ===
  const verifyWithoutTrust: VerificationBundleArtifact = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan: verify,
    tenantLeakAudit,
    issuesNext,
    sessionHandoff,
    generatedAt: "2026-04-22T01:30:00.000Z",
  });
  const verifyEvalNoTrust = evaluateArtifactUsefulness(verifyWithoutTrust);
  assert.equal(verifyEvalNoTrust.kind, "verification_bundle");
  assert.ok(!verifyEvalNoTrust.reasonCodes.includes("verify_trust_state_present"));

  const verifyWithTrust = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan: verify,
    tenantLeakAudit,
    issuesNext,
    sessionHandoff,
    trustRun: {
      traceId: "trace_current",
      targetId: "target_events",
      provenance: "interactive",
      packetHash: "phash",
      rawPacketHash: "rphash",
      environmentFingerprint: {
        gitHead: "abc",
        schemaSnapshotId: "snap_1",
        schemaFingerprint: "schema_fp_1",
        indexRunId: "idx_1",
      },
      createdAt: "2026-04-22T00:00:00.000Z",
      target: {
        targetId: "target_events",
        projectId: "proj_1",
        queryKind: "trace_file",
        normalizedQueryText: "trace app/routes/events.tsx",
        comparisonKey: "target_events_key",
        identity: { kind: "file", file: "app/routes/events.tsx" },
        firstSeenAt: "2026-04-22T00:00:00.000Z",
        lastSeenAt: "2026-04-22T00:00:00.000Z",
      },
    },
    trustEvaluation: {
      evaluationId: "eval_1",
      targetId: "target_events",
      traceId: "trace_current",
      comparisonId: "comp_1",
      state: "changed",
      reasons: [{ code: "meaningful_change_detected", detail: "Recent rerun changed answer." }],
      basisTraceIds: [],
      conflictingFacets: [],
      scopeRelation: "same_scope",
      createdAt: "2026-04-22T00:30:00.000Z",
    },
    generatedAt: "2026-04-22T01:35:00.000Z",
  });
  const verifyEvalWithTrust = evaluateArtifactUsefulness(verifyWithTrust);
  assert.ok(verifyEvalWithTrust.reasonCodes.includes("verify_trust_state_present"));
  assert.ok(
    verifyEvalWithTrust.reasonCodes.includes("verify_trust_state_unstable"),
    "trust state 'changed' must mark the bundle as unstable",
  );

  // === Metrics + exposure ===
  const allEvals = [
    preflightEval,
    emptyPreflightEval,
    handoffEvalWithoutFollowups,
    handoffEvalWithFollowups,
    thinReviewEval,
    fullReviewEval,
    verifyEvalNoTrust,
    verifyEvalWithTrust,
  ];
  const metrics = summarizeArtifactPromotionMetrics(allEvals);
  assert.equal(metrics.length, 4, "metrics must summarize all four artifact kinds");
  for (const m of metrics) {
    assert.equal(m.eligibleCount, 2, `${m.kind} should have 2 evaluations in this fixture`);
    assert.ok(m.helpfulRate != null && m.helpfulRate > 0, `${m.kind} should have positive helpful rate`);
  }

  for (const m of metrics) {
    const decision = decideArtifactExposure(m);
    assert.equal(decision.kind, m.kind);
    assert.ok(
      ["default", "opt_in", "dark", "not_promoted"].includes(decision.exposure),
      "exposure must be a valid state",
    );
    assert.ok(decision.rationale.length > 0);
  }

  // task_preflight specifically — both evals pass the threshold so it should
  // resolve to target (default).
  const preflightMetrics = metrics.find((m) => m.kind === "task_preflight")!;
  const preflightExposure = decideArtifactExposure(preflightMetrics);
  assert.equal(
    preflightExposure.exposure,
    "default",
    "task_preflight with full+partial grades should resolve to default exposure",
  );
  assert.equal(preflightExposure.promotionPath, "target_met");

  // === Wrapper eval ===
  const toolDelivered = evaluateArtifactWrapperUsefulness({
    family: "tool_plane",
    artifactKind: "task_preflight",
    toolCallDelivered: true,
    schemaValid: true,
    basisComplete: true,
  });
  assert.equal(toolDelivered.grade, "full");
  assert.ok(toolDelivered.reasonCodes.includes("tool_call_delivered"));
  assert.ok(toolDelivered.reasonCodes.includes("tool_result_schema_valid"));

  const toolFailed = evaluateArtifactWrapperUsefulness({
    family: "tool_plane",
    artifactKind: "review_bundle",
    toolCallFailed: true,
  });
  assert.equal(toolFailed.grade, "no");
  assert.ok(toolFailed.reasonCodes.includes("tool_call_failed"));

  const exportSucceeded = evaluateArtifactWrapperUsefulness({
    family: "file_export",
    artifactKind: "review_bundle",
    exportRequested: true,
    exportedFileCount: 3,
  });
  assert.equal(exportSucceeded.grade, "partial");
  assert.ok(exportSucceeded.reasonCodes.includes("export_files_written"));

  const exportRejected = evaluateArtifactWrapperUsefulness({
    family: "file_export",
    artifactKind: "review_bundle",
    exportRequested: true,
    exportRejected: true,
  });
  assert.equal(exportRejected.grade, "no");
  assert.ok(exportRejected.reasonCodes.includes("export_path_rejected"));

  const wrapperMetrics = summarizeArtifactWrapperPromotionMetrics([
    toolDelivered,
    toolFailed,
    exportSucceeded,
    exportRejected,
  ]);
  assert.equal(
    wrapperMetrics.length,
    3,
    "wrapper metrics must group by (family, artifactKind) — 3 groups here",
  );
  for (const m of wrapperMetrics) {
    const decision = decideArtifactWrapperExposure(m);
    assert.equal(decision.family, m.family);
    assert.equal(decision.artifactKind, m.artifactKind);
    assert.ok(
      ["default", "opt_in", "dark", "not_promoted"].includes(decision.exposure),
      "wrapper exposure must be valid state",
    );
  }

  console.log("artifact-usefulness-evaluation: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
