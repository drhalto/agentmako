import assert from "node:assert/strict";
import type {
  ArtifactBasisRef,
  ChangePlanResult,
  FlowMapResult,
  ImplementationHandoffArtifact,
  IssuesNextResult,
  ReviewBundleArtifact,
  SessionHandoffResult,
  TaskPreflightArtifact,
  TenantLeakAuditResult,
  VerificationBundleArtifact,
  WorkflowImplementationBriefPacket,
  WorkflowPacketSurface,
  WorkflowVerificationPlanPacket,
} from "../../packages/contracts/src/index.ts";
import {
  ImplementationHandoffArtifactSchema,
  ReviewBundleArtifactSchema,
  TaskPreflightArtifactSchema,
  VerificationBundleArtifactSchema,
} from "../../packages/contracts/src/index.ts";
import {
  generateImplementationHandoffArtifact,
  generateReviewBundleArtifact,
  generateTaskPreflightArtifact,
  generateVerificationBundleArtifact,
  refreshImplementationHandoffArtifact,
  refreshReviewBundleArtifact,
  refreshTaskPreflightArtifact,
  refreshVerificationBundleArtifact,
  replayImplementationHandoffArtifact,
  replayReviewBundleArtifact,
  replayTaskPreflightArtifact,
  replayVerificationBundleArtifact,
} from "../../packages/tools/src/index.ts";

function parseJsonRendering(
  artifact:
    | TaskPreflightArtifact
    | ImplementationHandoffArtifact
    | ReviewBundleArtifact
    | VerificationBundleArtifact,
) {
  const jsonRendering = artifact.renderings.find((rendering) => rendering.format === "json");
  assert.ok(jsonRendering, "artifact should include a canonical json rendering");
  return JSON.parse(jsonRendering.body) as Record<string, unknown>;
}

function createImplementationBriefSurface(): WorkflowPacketSurface & { packet: WorkflowImplementationBriefPacket } {
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
        entries: [{ entryId: "entry_summary", text: "Start in app/routes/events.tsx and keep the events flow aligned.", citationIds: [] }],
      },
      {
        sectionId: "section_change_areas",
        kind: "change_areas",
        title: "Change Areas",
        entries: [
          { entryId: "entry_change_1", text: "Change app/routes/events.tsx first.", citationIds: [] },
          { entryId: "entry_change_2", text: "Review public.refresh_events() before adding a parallel path.", citationIds: [] },
        ],
      },
      {
        sectionId: "section_invariants",
        kind: "invariants",
        title: "Invariants",
        entries: [{ entryId: "entry_invariant_1", text: "Preserve the canonical events fetch path.", citationIds: [] }],
      },
      {
        sectionId: "section_risks",
        kind: "risks",
        title: "Risks",
        entries: [{ entryId: "entry_risk_1", text: "Current diagnostic E_QUERY shows a regression risk in app/routes/events.tsx.", citationIds: [] }],
      },
      {
        sectionId: "section_verification",
        kind: "verification",
        title: "Verification",
        entries: [{ entryId: "entry_verification_1", text: "Trace the events route again after the edit.", citationIds: [] }],
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
    rendered: "Implementation brief rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: null, reusableContext: "resource" },
    watch: { mode: "off", stablePacketId: packet.packetId, refreshReason: "manual", refreshTriggers: [] },
  };
}

function createVerificationPlanSurface(): WorkflowPacketSurface & { packet: WorkflowVerificationPlanPacket } {
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
        entries: [{ entryId: "verify_summary_entry", text: "Verify the events route and RPC before landing the change.", citationIds: [] }],
      },
      {
        sectionId: "verify_baseline",
        kind: "baseline",
        title: "Baseline",
        entries: [{ entryId: "verify_baseline_entry", text: "Capture the current events route output before editing.", citationIds: [] }],
      },
      {
        sectionId: "verify_steps",
        kind: "verification",
        title: "Verification",
        entries: [
          { entryId: "verify_step_1", text: "Re-run the events route and confirm it still resolves cleanly.", citationIds: [] },
          { entryId: "verify_step_2", text: "Re-run public.refresh_events() and confirm the same table path is used.", citationIds: [] },
        ],
      },
      {
        sectionId: "verify_done",
        kind: "done_criteria",
        title: "Done Criteria",
        entries: [{ entryId: "verify_done_entry", text: "Stop when the route and RPC both resolve cleanly after the edit.", citationIds: [] }],
      },
      {
        sectionId: "verify_rerun",
        kind: "rerun_triggers",
        title: "Rerun Triggers",
        entries: [{ entryId: "verify_rerun_entry", text: "Refresh if the route handler or RPC signature changes.", citationIds: [] }],
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
    rendered: "Verification plan rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: "prompt", reusableContext: null },
    watch: { mode: "off", stablePacketId: packet.packetId, refreshReason: "manual", refreshTriggers: [] },
    handoff: {
      current: "Re-run the events route and confirm it still resolves cleanly.",
      stopWhen: "Stop when the route and RPC both resolve cleanly after the edit.",
      refreshWhen: "Refresh if the route handler or RPC signature changes.",
    },
  };
}

function createChangePlan(): ChangePlanResult {
  return {
    requestedStartEntity: { kind: "route", key: "GET /events" },
    requestedTargetEntity: { kind: "table", key: "public.events" },
    resolvedStartNode: { nodeId: "graph_node_route", kind: "route", key: "GET /events", label: "GET /events" },
    resolvedTargetNode: { nodeId: "graph_node_table", kind: "table", key: "public.events", label: "public.events" },
    direction: "downstream",
    traversalDepth: 6,
    includeHeuristicEdges: true,
    pathFound: true,
    directSurfaces: [
      {
        surfaceId: "change_surface_route",
        node: { nodeId: "graph_node_route", kind: "route", key: "GET /events", label: "GET /events" },
        role: "direct",
        distance: 0,
        rationale: "GET /events is the route entrypoint for the change.",
        via: [],
        containsHeuristicEdge: false,
      },
      {
        surfaceId: "change_surface_rpc",
        node: { nodeId: "graph_node_rpc", kind: "rpc", key: "public.refresh_events()", label: "public.refresh_events()" },
        role: "direct",
        distance: 1,
        rationale: "public.refresh_events() sits on the direct path to the table.",
        via: [],
        containsHeuristicEdge: true,
      },
    ],
    dependentSurfaces: [
      {
        surfaceId: "change_surface_file",
        node: { nodeId: "graph_node_file", kind: "file", key: "app/routes/events.tsx", label: "app/routes/events.tsx" },
        role: "dependent",
        distance: 1,
        rationale: "app/routes/events.tsx sits adjacent to the route via serves_route.",
        via: [],
        containsHeuristicEdge: false,
      },
    ],
    steps: [
      {
        stepId: "change_step_route",
        title: "Change route GET /events",
        surfaceId: "change_surface_route",
        dependsOnStepIds: [],
        rationale: "GET /events is the route entrypoint for the change.",
      },
      {
        stepId: "change_step_rpc",
        title: "Change RPC public.refresh_events()",
        surfaceId: "change_surface_rpc",
        dependsOnStepIds: ["change_step_route"],
        rationale: "public.refresh_events() sits on the direct path to the table.",
      },
      {
        stepId: "change_step_file",
        title: "Recheck file app/routes/events.tsx",
        surfaceId: "change_surface_file",
        dependsOnStepIds: ["change_step_route"],
        rationale: "app/routes/events.tsx sits adjacent to the route via serves_route.",
      },
    ],
    recommendedFollowOn: {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason: "After the graph-derived change scope is clear, a compact implementation brief is the best next artifact.",
    },
    containsHeuristicEdge: true,
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
    resolvedStartNode: { nodeId: "graph_node_route", kind: "route", key: "GET /events", label: "GET /events" },
    resolvedTargetNode: { nodeId: "graph_node_table", kind: "table", key: "public.events", label: "public.events" },
    direction: "downstream",
    traversalDepth: 6,
    includeHeuristicEdges: true,
    pathFound: true,
    steps: [
      { stepIndex: 0, node: { nodeId: "graph_node_route", kind: "route", key: "GET /events", label: "GET /events" }, boundary: "route" },
      {
        stepIndex: 1,
        node: { nodeId: "graph_node_rpc", kind: "rpc", key: "public.refresh_events()", label: "public.refresh_events()" },
        boundary: "rpc",
        reachedViaHop: {
          hopIndex: 0,
          direction: "downstream",
          fromNode: { nodeId: "graph_node_route", kind: "route", key: "GET /events", label: "GET /events" },
          toNode: { nodeId: "graph_node_rpc", kind: "rpc", key: "public.refresh_events()", label: "public.refresh_events()" },
          edge: {
            edgeId: "graph_edge_calls_rpc",
            kind: "calls_rpc",
            fromNodeId: "graph_node_route",
            toNodeId: "graph_node_rpc",
            exactness: "heuristic",
            provenance: { source: "schema_usage", evidenceRefs: ["usage_ref_1"] },
          },
          explanation: "GET /events connects downstream to public.refresh_events() via calls_rpc.",
        },
      },
      {
        stepIndex: 2,
        node: { nodeId: "graph_node_table", kind: "table", key: "public.events", label: "public.events" },
        boundary: "data",
        reachedViaHop: {
          hopIndex: 1,
          direction: "downstream",
          fromNode: { nodeId: "graph_node_rpc", kind: "rpc", key: "public.refresh_events()", label: "public.refresh_events()" },
          toNode: { nodeId: "graph_node_table", kind: "table", key: "public.events", label: "public.events" },
          edge: {
            edgeId: "graph_edge_touches_table",
            kind: "touches_table",
            fromNodeId: "graph_node_rpc",
            toNodeId: "graph_node_table",
            exactness: "exact",
            provenance: { source: "function_table_ref", evidenceRefs: ["ref_1"] },
          },
          explanation: "public.refresh_events() touches public.events.",
        },
      },
    ],
    transitions: [],
    majorBoundaryKinds: ["route", "rpc", "data"],
    containsHeuristicEdge: true,
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
    generatedAt: "2026-04-21T00:00:00.000Z",
    basis: {
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
      sourceTraceLimit: 8,
    },
    summary: {
      recentQueryCount: 3,
      unresolvedQueryCount: 1,
      changedQueryCount: 1,
      queriesWithFollowups: 1,
    },
    currentFocus: {
      traceId: "trace_current",
      targetId: "target_events",
      comparisonId: "comparison_events",
      queryKind: "trace_file",
      queryText: "trace app/routes/events.tsx",
      createdAt: "2026-04-21T00:00:00.000Z",
      supportLevel: "native",
      evidenceStatus: "complete",
      trustState: "changed",
      meaningfulChangeDetected: true,
      followupCount: 1,
      lastFollowupAt: "2026-04-21T00:05:00.000Z",
      signalCodes: ["trust_changed", "followup_in_progress"],
      isCurrentFocus: true,
      reasonCode: "trust_changed",
      reason: "Recent trace output changed and still has active follow-up momentum.",
      stopWhen: ["trust becomes stable or superseded"],
    },
    recentQueries: [],
    warnings: [],
  };
}

function createIssuesNext(): IssuesNextResult {
  return {
    generatedAt: "2026-04-21T00:00:00.000Z",
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
    currentIssue: {
      traceId: "trace_current",
      targetId: "target_events",
      comparisonId: "comparison_events",
      queryKind: "trace_file",
      queryText: "trace app/routes/events.tsx",
      createdAt: "2026-04-21T00:00:00.000Z",
      supportLevel: "native",
      evidenceStatus: "complete",
      trustState: "changed",
      meaningfulChangeDetected: true,
      followupCount: 1,
      lastFollowupAt: "2026-04-21T00:05:00.000Z",
      signalCodes: ["trust_changed", "followup_in_progress"],
      reasonCode: "trust_changed",
      reason: "Recent trace output changed and still has active follow-up momentum.",
      stopWhen: ["trust becomes stable or superseded"],
    },
    queuedIssues: [
      {
        traceId: "trace_verify",
        targetId: "target_rpc",
        comparisonId: "comparison_rpc",
        queryKind: "trace_rpc",
        queryText: "trace public.refresh_events()",
        createdAt: "2026-04-20T23:50:00.000Z",
        supportLevel: "native",
        evidenceStatus: "complete",
        trustState: "stale",
        meaningfulChangeDetected: false,
        followupCount: 0,
        lastFollowupAt: null,
        signalCodes: ["trust_stale"],
        reasonCode: "trust_stale",
        reason: "The last trace is stale and should be rerun before closing verification.",
        stopWhen: ["trust becomes stable or superseded"],
      },
    ],
    warnings: [],
  };
}

function createTenantLeakAudit(): TenantLeakAuditResult {
  return {
    advisoryOnly: true,
    rolloutStage: "opt_in",
    basis: {
      latestIndexRunId: "idx_1",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
    },
    tenantSignals: ["tenant_id"],
    protectedTables: [
      {
        tableKey: "public.events",
        tenantColumns: ["tenant_id"],
        rlsEnabled: false,
        policyCount: 0,
        evidenceRefs: ["table:public.events"],
      },
    ],
    findings: [
      {
        findingId: "finding_direct_1",
        strength: "direct_evidence",
        surfaceKind: "table",
        surfaceKey: "public.events",
        code: "table_rls_disabled",
        message: "public.events has tenant-keyed data without RLS enabled.",
        evidenceRefs: ["table:public.events"],
        tenantSignals: ["tenant_id"],
      },
      {
        findingId: "finding_weak_1",
        strength: "weak_signal",
        surfaceKind: "rpc",
        surfaceKey: "public.refresh_events()",
        code: "rpc_touches_protected_table_without_tenant_signal",
        message: "public.refresh_events() touches public.events without an explicit tenant signal in the body.",
        evidenceRefs: ["rpc:public.refresh_events()"],
        tenantSignals: [],
      },
    ],
    reviewedSurfaces: [],
    recommendedFollowOn: {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason: "Direct tenant findings need an implementation brief before remediation.",
    },
    summary: {
      protectedTableCount: 1,
      directEvidenceCount: 1,
      weakSignalCount: 1,
      reviewedSurfaceCount: 0,
    },
    warnings: [],
  };
}

async function main(): Promise<void> {
  const implementationBrief = createImplementationBriefSurface();
  const verificationPlan = createVerificationPlanSurface();
  const changePlan = createChangePlan();
  const flowMap = createFlowMap();
  const sessionHandoff = createSessionHandoff();
  const issuesNext = createIssuesNext();
  const tenantLeakAudit = createTenantLeakAudit();

  const taskPreflight = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan,
    flowMap,
    generatedAt: "2026-04-21T01:00:00.000Z",
  });

  assert.doesNotThrow(() => TaskPreflightArtifactSchema.parse(taskPreflight));
  assert.equal(taskPreflight.kind, "task_preflight");
  assert.equal(taskPreflight.basis.length, 4);
  assert.equal(taskPreflight.payload.readFirst[0]?.title, "Start here");
  assert.equal(taskPreflight.payload.likelyMoveSurfaces[0]?.title, "Change route GET /events");
  assert.equal(taskPreflight.payload.verifyBeforeStart[0]?.text, "Capture the current events route output before editing.");
  const taskPreflightJson = parseJsonRendering(taskPreflight);
  assert.equal(taskPreflightJson.artifactId, taskPreflight.artifactId);
  assert.equal(taskPreflightJson.projectId, taskPreflight.projectId);

  const unchangedRefresh = refreshTaskPreflightArtifact(taskPreflight, {
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan,
    flowMap,
    generatedAt: "2026-04-21T01:05:00.000Z",
  });
  assert.equal(unchangedRefresh.outcome, "unchanged");
  assert.equal(unchangedRefresh.artifact, null);
  assert.deepEqual(
    unchangedRefresh.changedBasisRefIds,
    [],
    "unchanged refresh must report no changed basis refs",
  );

  const changedChangePlan: ChangePlanResult = {
    ...changePlan,
    directSurfaces: [
      ...changePlan.directSurfaces,
      {
        surfaceId: "change_surface_table",
        node: { nodeId: "graph_node_table", kind: "table", key: "public.events", label: "public.events" },
        role: "direct",
        distance: 2,
        rationale: "public.events is part of the direct path and now moves directly.",
        via: [],
        containsHeuristicEdge: false,
      },
    ],
  };
  const refreshedTaskPreflight = refreshTaskPreflightArtifact(taskPreflight, {
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan: changedChangePlan,
    flowMap,
    generatedAt: "2026-04-21T01:10:00.000Z",
  });
  assert.equal(refreshedTaskPreflight.outcome, "refreshed");
  assert.equal(refreshedTaskPreflight.supersedesArtifactId, taskPreflight.artifactId);
  assert.notEqual(refreshedTaskPreflight.artifact?.artifactId, taskPreflight.artifactId);
  assert.equal(
    parseJsonRendering(refreshedTaskPreflight.artifact!).supersedesArtifactId,
    taskPreflight.artifactId,
  );
  // Only the change plan fingerprint moved — the refresh result must name
  // exactly that basis ref and no others.
  const changedChangePlanBasisId = taskPreflight.basis.find(
    (ref) => ref.kind === "workflow_result" && ref.label?.startsWith("change plan"),
  )?.basisRefId;
  assert.ok(changedChangePlanBasisId, "expected the task preflight to carry a change_plan basis ref");
  assert.deepEqual(
    refreshedTaskPreflight.changedBasisRefIds,
    [changedChangePlanBasisId],
    "refresh must report the change_plan basis ref as the only one that moved",
  );

  const replayedTaskPreflight = replayTaskPreflightArtifact(taskPreflight);
  assert.equal(replayedTaskPreflight.outcome, "replayed");
  assert.equal(replayedTaskPreflight.artifact?.artifactId, taskPreflight.artifactId);
  assert.equal(replayedTaskPreflight.artifact?.generatedAt, taskPreflight.generatedAt);
  assert.deepEqual(replayedTaskPreflight.artifact?.payload, taskPreflight.payload);

  // Empty change plan must still produce a valid artifact — the graph
  // legitimately returns no surfaces for some real questions, so the
  // artifact should ship with an empty likelyMoveSurfaces array and the
  // markdown renderer should surface the empty state explicitly instead
  // of throwing a generic "Array must contain at least 1 element" error.
  const emptyChangePlan: ChangePlanResult = {
    ...changePlan,
    directSurfaces: [],
    dependentSurfaces: [],
    steps: [],
    pathFound: false,
    containsHeuristicEdge: false,
  };
  const emptySurfacePreflight = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan: emptyChangePlan,
    flowMap,
    generatedAt: "2026-04-21T03:00:00.000Z",
  });
  assert.doesNotThrow(() => TaskPreflightArtifactSchema.parse(emptySurfacePreflight));
  assert.deepEqual(
    emptySurfacePreflight.payload.likelyMoveSurfaces,
    [],
    "empty change plan must still produce a valid payload with an empty surfaces array",
  );
  const emptyPreflightMarkdown = emptySurfacePreflight.renderings.find(
    (r) => r.format === "markdown",
  )?.body ?? "";
  assert.match(
    emptyPreflightMarkdown,
    /No graph-derived move surfaces/,
    "empty-surface markdown must explain the empty state instead of leaving the section blank",
  );

  // Basis ordering must not change artifact identity. `additionalBasis` order
  // is the caller-controlled knob we can exercise at this layer.
  const extraRefA: ArtifactBasisRef = {
    basisRefId: "artifact_basis_extra_a",
    kind: "reference_document",
    sourceId: "extra_a",
    fingerprint: "fp_a",
    sourceOrigin: "reference",
  };
  const extraRefB: ArtifactBasisRef = {
    basisRefId: "artifact_basis_extra_b",
    kind: "reference_document",
    sourceId: "extra_b",
    fingerprint: "fp_b",
    sourceOrigin: "reference",
  };
  const orderedAB = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan,
    flowMap,
    generatedAt: "2026-04-21T02:00:00.000Z",
    additionalBasis: [extraRefA, extraRefB],
  });
  const orderedBA = generateTaskPreflightArtifact({
    projectId: "proj_1",
    implementationBrief,
    verificationPlan,
    changePlan,
    flowMap,
    generatedAt: "2026-04-21T02:00:00.000Z",
    additionalBasis: [extraRefB, extraRefA],
  });
  assert.equal(
    orderedAB.artifactId,
    orderedBA.artifactId,
    "artifact identity must be order-independent across basis refs",
  );

  // Basis ref collisions with conflicting fingerprints must be rejected
  // rather than silently dropped.
  const conflictingExtraRef: ArtifactBasisRef = {
    ...extraRefA,
    fingerprint: "fp_a_conflict",
  };
  assert.throws(
    () =>
      generateTaskPreflightArtifact({
        projectId: "proj_1",
        implementationBrief,
        verificationPlan,
        changePlan,
        flowMap,
        generatedAt: "2026-04-21T02:05:00.000Z",
        additionalBasis: [extraRefA, conflictingExtraRef],
      }),
    /basis ref collision/,
    "duplicate basisRefIds with conflicting fingerprints must throw",
  );

  const implementationHandoff = generateImplementationHandoffArtifact({
    projectId: "proj_1",
    implementationBrief,
    sessionHandoff,
    generatedAt: "2026-04-21T01:00:00.000Z",
  });
  assert.doesNotThrow(() => ImplementationHandoffArtifactSchema.parse(implementationHandoff));
  assert.equal(implementationHandoff.kind, "implementation_handoff");
  assert.equal(implementationHandoff.basis.length, 2);
  assert.equal(implementationHandoff.payload.currentFocus?.traceId, "trace_current");
  assert.match(implementationHandoff.payload.summary, /Continue with focus on trace app\/routes\/events\.tsx/);
  assert.ok(implementationHandoff.payload.followUps.some((entry) => entry.text.includes("trust becomes stable or superseded")));
  // Session context must be surfaced in keyContext so a receiving agent
  // sees "what's being worked on" before "what's in the brief."
  const keyContextTexts = implementationHandoff.payload.keyContext.map((entry) => entry.text);
  assert.ok(
    keyContextTexts.some((text) => text.startsWith("Current focus:") && text.includes("trace app/routes/events.tsx")),
    "keyContext must carry the current session focus",
  );
  assert.ok(
    keyContextTexts.some((text) => text.startsWith("Session momentum:") && text.includes("1 unresolved")),
    "keyContext must carry session momentum summary when non-trivial",
  );
  const sessionHandoffBasisId = implementationHandoff.basis.find((ref) => ref.label === "session handoff")
    ?.basisRefId;
  assert.ok(sessionHandoffBasisId, "expected session_handoff basis ref on the handoff artifact");
  const sessionKeyContextEntries = implementationHandoff.payload.keyContext.filter((entry) =>
    entry.basisRefIds.includes(sessionHandoffBasisId),
  );
  assert.ok(
    sessionKeyContextEntries.length >= 2,
    "at least two keyContext entries must be tagged to the session_handoff basis (focus + momentum)",
  );
  const implementationHandoffJson = parseJsonRendering(implementationHandoff);
  assert.equal(implementationHandoffJson.artifactId, implementationHandoff.artifactId);
  assert.equal(implementationHandoffJson.projectId, implementationHandoff.projectId);

  const unchangedHandoff = refreshImplementationHandoffArtifact(implementationHandoff, {
    projectId: "proj_1",
    implementationBrief,
    sessionHandoff,
    generatedAt: "2026-04-21T01:05:00.000Z",
  });
  assert.equal(unchangedHandoff.outcome, "unchanged");
  assert.deepEqual(unchangedHandoff.changedBasisRefIds, []);

  const changedSessionHandoff: SessionHandoffResult = {
    ...sessionHandoff,
    currentFocus: {
      ...sessionHandoff.currentFocus!,
      reason: "Recent trace output still changed after the latest rerun.",
      stopWhen: ["trust becomes stable or superseded", "comparison no longer reports meaningful change"],
    },
  };
  const refreshedHandoff = refreshImplementationHandoffArtifact(implementationHandoff, {
    projectId: "proj_1",
    implementationBrief,
    sessionHandoff: changedSessionHandoff,
    generatedAt: "2026-04-21T01:10:00.000Z",
  });
  assert.equal(refreshedHandoff.outcome, "refreshed");
  assert.equal(refreshedHandoff.supersedesArtifactId, implementationHandoff.artifactId);
  assert.equal(
    parseJsonRendering(refreshedHandoff.artifact!).supersedesArtifactId,
    implementationHandoff.artifactId,
  );
  const changedSessionHandoffBasisId = implementationHandoff.basis.find(
    (ref) => ref.label === "session handoff",
  )?.basisRefId;
  assert.ok(changedSessionHandoffBasisId, "expected session_handoff basis ref");
  assert.deepEqual(
    refreshedHandoff.changedBasisRefIds,
    [changedSessionHandoffBasisId],
    "refresh must name only the session_handoff basis ref as moved",
  );

  const replayedHandoff = replayImplementationHandoffArtifact(implementationHandoff);
  assert.equal(replayedHandoff.outcome, "replayed");
  assert.equal(replayedHandoff.artifact?.artifactId, implementationHandoff.artifactId);
  assert.equal(replayedHandoff.artifact?.generatedAt, implementationHandoff.generatedAt);
  assert.deepEqual(replayedHandoff.artifact?.payload, implementationHandoff.payload);

  const reviewBundle = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief,
    changePlan,
    flowMap,
    tenantLeakAudit,
    generatedAt: "2026-04-21T01:00:00.000Z",
  });
  assert.doesNotThrow(() => ReviewBundleArtifactSchema.parse(reviewBundle));
  assert.equal(reviewBundle.kind, "review_bundle");
  assert.equal(reviewBundle.basis.length, 4);
  assert.equal(reviewBundle.payload.inspectFirst[0]?.title, "Review summary");
  assert.equal(reviewBundle.payload.directOperatorFindings[0]?.text, "public.events has tenant-keyed data without RLS enabled.");
  assert.equal(
    reviewBundle.payload.weakOperatorSignals[0]?.text,
    "public.refresh_events() touches public.events without an explicit tenant signal in the body.",
  );
  const reviewBundleJson = parseJsonRendering(reviewBundle);
  assert.equal(reviewBundleJson.artifactId, reviewBundle.artifactId);
  assert.equal(reviewBundleJson.projectId, reviewBundle.projectId);

  const refreshedReviewBundle = refreshReviewBundleArtifact(reviewBundle, {
    projectId: "proj_1",
    implementationBrief,
    changePlan: changedChangePlan,
    flowMap,
    tenantLeakAudit,
    generatedAt: "2026-04-21T01:10:00.000Z",
  });
  assert.equal(refreshedReviewBundle.outcome, "refreshed");
  assert.equal(refreshedReviewBundle.supersedesArtifactId, reviewBundle.artifactId);
  assert.equal(
    parseJsonRendering(refreshedReviewBundle.artifact!).supersedesArtifactId,
    reviewBundle.artifactId,
  );
  const reviewChangePlanBasisId = reviewBundle.basis.find(
    (ref) => ref.kind === "workflow_result" && ref.label?.startsWith("change plan"),
  )?.basisRefId;
  assert.ok(reviewChangePlanBasisId, "expected review bundle to carry a change_plan basis ref");
  assert.deepEqual(
    refreshedReviewBundle.changedBasisRefIds,
    [reviewChangePlanBasisId],
    "review refresh must name only the change_plan basis ref as moved",
  );

  const replayedReviewBundle = replayReviewBundleArtifact(reviewBundle);
  assert.equal(replayedReviewBundle.outcome, "replayed");
  assert.equal(replayedReviewBundle.artifact?.artifactId, reviewBundle.artifactId);
  assert.deepEqual(replayedReviewBundle.artifact?.payload, reviewBundle.payload);

  // Review bundle must also survive an empty change plan — same rationale
  // as task_preflight above. Ships with an empty reviewSurfaces array plus
  // an empty-state marker in the markdown.
  const emptySurfaceReview = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief,
    changePlan: emptyChangePlan,
    flowMap,
    tenantLeakAudit,
    generatedAt: "2026-04-21T03:05:00.000Z",
  });
  assert.doesNotThrow(() => ReviewBundleArtifactSchema.parse(emptySurfaceReview));
  assert.deepEqual(emptySurfaceReview.payload.reviewSurfaces, []);
  const emptyReviewMarkdown = emptySurfaceReview.renderings.find((r) => r.format === "markdown")?.body ?? "";
  assert.match(
    emptyReviewMarkdown,
    /No graph-derived review surfaces/,
    "empty-surface review markdown must explain the empty state",
  );

  const verificationBundle = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan,
    tenantLeakAudit,
    issuesNext,
    sessionHandoff,
    generatedAt: "2026-04-21T01:00:00.000Z",
  });
  assert.doesNotThrow(() => VerificationBundleArtifactSchema.parse(verificationBundle));
  assert.equal(verificationBundle.kind, "verification_bundle");
  assert.equal(verificationBundle.basis.length, 4);
  assert.equal(
    verificationBundle.payload.baselineChecks[0]?.text,
    "Capture the current events route output before editing.",
  );
  assert.ok(
    verificationBundle.payload.stopConditions.some((item) =>
      item.text.includes("route and RPC both resolve cleanly after the edit"),
    ),
  );
  assert.ok(
    verificationBundle.payload.changeManagementChecks.some((item) =>
      item.text.includes("Current queued issue: trace app/routes/events.tsx"),
    ),
  );
  assert.equal(
    verificationBundle.payload.directOperatorFindings[0]?.text,
    "public.events has tenant-keyed data without RLS enabled.",
  );
  const verificationBundleJson = parseJsonRendering(verificationBundle);
  assert.equal(verificationBundleJson.artifactId, verificationBundle.artifactId);
  assert.equal(verificationBundleJson.projectId, verificationBundle.projectId);

  const changedTenantLeakAudit: TenantLeakAuditResult = {
    ...tenantLeakAudit,
    findings: [
      ...tenantLeakAudit.findings,
      {
        findingId: "finding_weak_2",
        strength: "weak_signal",
        surfaceKind: "route",
        surfaceKey: "GET /events",
        code: "route_rpc_usage_missing_tenant_signal",
        message: "GET /events still reaches the protected RPC path without an explicit tenant guard.",
        evidenceRefs: ["route:GET /events"],
        tenantSignals: [],
      },
    ],
    summary: {
      ...tenantLeakAudit.summary,
      weakSignalCount: 2,
    },
  };
  const refreshedVerificationBundle = refreshVerificationBundleArtifact(verificationBundle, {
    projectId: "proj_1",
    verificationPlan,
    tenantLeakAudit: changedTenantLeakAudit,
    issuesNext,
    sessionHandoff,
    generatedAt: "2026-04-21T01:10:00.000Z",
  });
  assert.equal(refreshedVerificationBundle.outcome, "refreshed");
  assert.equal(refreshedVerificationBundle.supersedesArtifactId, verificationBundle.artifactId);
  assert.equal(
    parseJsonRendering(refreshedVerificationBundle.artifact!).supersedesArtifactId,
    verificationBundle.artifactId,
  );
  const tenantAuditBasisId = verificationBundle.basis.find(
    (ref) => ref.label === "tenant leak audit",
  )?.basisRefId;
  assert.ok(tenantAuditBasisId, "expected verification bundle to carry a tenant_leak_audit basis ref");
  assert.deepEqual(
    refreshedVerificationBundle.changedBasisRefIds,
    [tenantAuditBasisId],
    "verification refresh must name only the tenant_leak_audit basis ref as moved",
  );

  const replayedVerificationBundle = replayVerificationBundleArtifact(verificationBundle);
  assert.equal(replayedVerificationBundle.outcome, "replayed");
  assert.equal(replayedVerificationBundle.artifact?.artifactId, verificationBundle.artifactId);
  assert.deepEqual(replayedVerificationBundle.artifact?.payload, verificationBundle.payload);

  // Finding A regression: when tenant_leak_audit surfaces the same finding
  // message multiple times (e.g. an RPC touching two protected tables
  // produces one weak finding per (site, table) pair, each with identical
  // messages because the message only references the call site), the
  // artifact payload must dedupe by message so the rendered markdown
  // doesn't repeat the same bullet.
  const duplicateAudit: TenantLeakAuditResult = {
    ...tenantLeakAudit,
    findings: [
      {
        findingId: "finding_dupe_weak_1",
        strength: "weak_signal",
        surfaceKind: "rpc",
        surfaceKey: "public.refresh_events()",
        code: "rpc_touches_protected_table_without_tenant_signal",
        message: "RPC `public.refresh_events()` touches protected tables without a tenant signal.",
        evidenceRefs: ["rpc:public.refresh_events()"],
        tenantSignals: [],
      },
      {
        findingId: "finding_dupe_weak_2",
        strength: "weak_signal",
        surfaceKind: "rpc",
        surfaceKey: "public.refresh_events()",
        code: "rpc_touches_protected_table_without_tenant_signal",
        // Same message — different metadata (different table) but the
        // human-facing projection is identical.
        message: "RPC `public.refresh_events()` touches protected tables without a tenant signal.",
        evidenceRefs: ["rpc:public.refresh_events()"],
        tenantSignals: [],
      },
      {
        findingId: "finding_dupe_weak_3",
        strength: "weak_signal",
        surfaceKind: "rpc",
        surfaceKey: "public.other_rpc()",
        code: "rpc_touches_protected_table_without_tenant_signal",
        message: "RPC `public.other_rpc()` is a genuinely distinct signal.",
        evidenceRefs: [],
        tenantSignals: [],
      },
    ],
  };
  const reviewWithDupes = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief,
    changePlan,
    flowMap,
    tenantLeakAudit: duplicateAudit,
    generatedAt: "2026-04-21T04:00:00.000Z",
  });
  assert.equal(
    reviewWithDupes.payload.weakOperatorSignals.length,
    2,
    "duplicate tenant-audit messages must collapse to one artifact entry per unique message",
  );
  assert.ok(
    reviewWithDupes.payload.weakOperatorSignals.some((e) => e.text.includes("public.refresh_events()")),
  );
  assert.ok(
    reviewWithDupes.payload.weakOperatorSignals.some((e) => e.text.includes("public.other_rpc()")),
  );
  const verificationWithDupes = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan,
    tenantLeakAudit: duplicateAudit,
    generatedAt: "2026-04-21T04:00:00.000Z",
  });
  assert.equal(
    verificationWithDupes.payload.weakOperatorSignals.length,
    2,
    "verification bundle must also dedupe duplicate tenant-audit messages",
  );

  // ---------------------------------------------------------------
  // 7.5 close coverage — wired basis kinds + payload projections.
  //
  // These exercise the paths that were declared in ARTIFACT_BASIS_KINDS
  // and in the 7.0 disambiguation table but not actually emitted by 7.1 /
  // 7.2 generators. 7.5 eval has to grade against the real basis; these
  // smokes ensure the basis actually reaches the artifact.
  // ---------------------------------------------------------------

  // implementation_handoff: workflow_followup basis + priorFollowups payload
  const workflowFollowups = [
    {
      followupId: "followup_1",
      projectId: "proj_1",
      originQueryId: "query_impl_1",
      originActionId: "action_1",
      originPacketFamily: "implementation_brief" as const,
      originQueryKind: "trace_file" as const,
      executedToolName: "change_plan",
      executedInput: { startEntity: { kind: "route", key: "GET /events" } },
      resultPacketId: "packet_result_1",
      resultPacketFamily: "impact_packet" as const,
      resultQueryId: "query_impact_1",
      createdAt: "2026-04-21T01:30:00.000Z",
    },
    {
      followupId: "followup_2",
      projectId: "proj_1",
      originQueryId: "query_impl_1",
      originActionId: "action_2",
      originPacketFamily: "implementation_brief" as const,
      originQueryKind: "trace_file" as const,
      executedToolName: "flow_map",
      executedInput: { startEntity: { kind: "route", key: "GET /events" } },
      resultPacketId: "packet_result_2",
      resultPacketFamily: "verification_plan" as const,
      resultQueryId: "query_verify_2",
      createdAt: "2026-04-21T01:35:00.000Z",
    },
  ];
  const handoffWithFollowups = generateImplementationHandoffArtifact({
    projectId: "proj_1",
    implementationBrief,
    sessionHandoff,
    workflowFollowups,
    generatedAt: "2026-04-21T05:00:00.000Z",
  });
  assert.doesNotThrow(() => ImplementationHandoffArtifactSchema.parse(handoffWithFollowups));
  assert.equal(
    handoffWithFollowups.basis.length,
    3,
    "implementation_handoff must carry a workflow_followup basis ref when followups are present",
  );
  const followupBasisRef = handoffWithFollowups.basis.find((ref) => ref.kind === "workflow_followup");
  assert.ok(followupBasisRef, "workflow_followup basis kind must appear");
  assert.equal(
    handoffWithFollowups.payload.priorFollowups.length,
    2,
    "priorFollowups must surface one entry per workflow_followup record",
  );
  assert.ok(
    handoffWithFollowups.payload.priorFollowups.every((entry) =>
      entry.basisRefIds.includes(followupBasisRef!.basisRefId),
    ),
    "priorFollowups entries must be tagged to the workflow_followup basis ref",
  );

  // review_bundle: impact_packet basis + diagnostics basis + payload sections
  const impactPacketSurface: WorkflowPacketSurface = {
    packet: {
      packetId: "workflow_packet_impact_1",
      family: "impact_packet" as const,
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
          entries: [{ entryId: "impact_summary_entry", text: "Change touches the events route, RPC, and table.", citationIds: [] }],
        },
        {
          sectionId: "impact_zones",
          kind: "impact",
          title: "Impact",
          entries: [
            { entryId: "impact_zone_1", text: "Direct: app/routes/events.tsx imports `useEvents` hook.", citationIds: [] },
            { entryId: "impact_zone_2", text: "Adjacent: public.refresh_events() RPC path", citationIds: [] },
          ],
        },
        {
          sectionId: "impact_risks",
          kind: "risks",
          title: "Risks",
          entries: [{ entryId: "impact_risk_1", text: "Schema fingerprint change could move the RPC signature.", citationIds: [] }],
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
    },
    rendered: "Impact packet rendered",
    surfacePlan: { generateWith: "tool", guidedConsumption: null, reusableContext: "resource" },
    watch: { mode: "off", stablePacketId: "workflow_packet_impact_1", refreshReason: "manual", refreshTriggers: [] },
  };
  const diagnosticsInput = {
    findings: [
      {
        severity: "medium" as const,
        confidence: "probable" as const,
        category: "producer_consumer_drift" as const,
        code: "events_route_rpc_signature_drift",
        message: "GET /events consumer expects fields the RPC no longer returns.",
        path: "app/routes/events.tsx",
        line: 42,
        evidenceRefs: ["ts_aware:events"],
        identity: {
          matchBasedId: "identity_match_1",
          codeHash: "hash_1",
          patternHash: "pattern_1",
        },
      },
    ],
    focusFiles: ["app/routes/events.tsx"],
  };
  const reviewWithFullBasis = generateReviewBundleArtifact({
    projectId: "proj_1",
    implementationBrief,
    changePlan,
    flowMap,
    tenantLeakAudit,
    impactPacket: impactPacketSurface as typeof impactPacketSurface & { packet: { family: "impact_packet" } },
    diagnostics: diagnosticsInput,
    generatedAt: "2026-04-21T05:10:00.000Z",
  });
  assert.doesNotThrow(() => ReviewBundleArtifactSchema.parse(reviewWithFullBasis));
  assert.equal(
    reviewWithFullBasis.basis.length,
    6,
    "review_bundle with full close must carry 6 basis refs (brief + change_plan + flow_map + tenant_audit + impact_packet + diagnostics)",
  );
  const impactPacketBasisRef = reviewWithFullBasis.basis.find(
    (ref) => ref.kind === "workflow_packet" && ref.label === "Impact Packet",
  );
  assert.ok(impactPacketBasisRef, "impact_packet basis ref must appear (kind=workflow_packet)");
  const diagnosticsBasisRef = reviewWithFullBasis.basis.find(
    (ref) => ref.kind === "workflow_result" && ref.label === "diagnostics",
  );
  assert.ok(diagnosticsBasisRef, "diagnostics basis ref must appear (kind=workflow_result, label=diagnostics)");
  assert.ok(
    reviewWithFullBasis.payload.impactZones.length > 0,
    "impactZones must surface entries when impact_packet is present",
  );
  assert.ok(
    reviewWithFullBasis.payload.impactZones.every((entry) =>
      entry.basisRefIds.includes(impactPacketBasisRef!.basisRefId),
    ),
    "impactZones entries must be tagged to the impact_packet basis ref",
  );
  assert.equal(
    reviewWithFullBasis.payload.diagnosticFindings.length,
    1,
    "diagnosticFindings must surface one entry per finding",
  );
  assert.ok(
    reviewWithFullBasis.payload.diagnosticFindings[0]?.text.includes("events_route_rpc_signature_drift"),
    "diagnosticFindings text must include the finding code",
  );
  assert.ok(
    reviewWithFullBasis.payload.diagnosticFindings.every((entry) =>
      entry.basisRefIds.includes(diagnosticsBasisRef!.basisRefId),
    ),
    "diagnosticFindings entries must be tagged to the diagnostics basis ref",
  );

  // verification_bundle: trust_run + trust_evaluation basis + trustState payload
  const trustRun = {
    traceId: "trace_current",
    targetId: "target_events",
    provenance: "interactive" as const,
    packetHash: "packet_hash_abc",
    rawPacketHash: "raw_packet_hash_abc",
    answerHash: "answer_hash_abc",
    environmentFingerprint: {
      gitHead: "abc123",
      schemaSnapshotId: "snap_1",
      schemaFingerprint: "schema_fp_1",
      indexRunId: "idx_1",
    },
    createdAt: "2026-04-21T01:00:00.000Z",
    target: {
      targetId: "target_events",
      projectId: "proj_1",
      queryKind: "trace_file" as const,
      normalizedQueryText: "trace app/routes/events.tsx",
      comparisonKey: "target_events_key",
      identity: { kind: "file", file: "app/routes/events.tsx" },
      firstSeenAt: "2026-04-21T00:00:00.000Z",
      lastSeenAt: "2026-04-21T01:00:00.000Z",
    },
  };
  const trustEvaluation = {
    evaluationId: "eval_1",
    targetId: "target_events",
    traceId: "trace_current",
    comparisonId: "comparison_events",
    state: "changed" as const,
    reasons: [
      { code: "meaningful_change_detected" as const, detail: "Recent rerun produced new evidence." },
    ],
    basisTraceIds: ["trace_prior"],
    conflictingFacets: [],
    scopeRelation: "same_scope" as const,
    createdAt: "2026-04-21T01:30:00.000Z",
  };
  const verificationWithTrust = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan,
    tenantLeakAudit,
    issuesNext,
    sessionHandoff,
    trustRun,
    trustEvaluation,
    generatedAt: "2026-04-21T05:20:00.000Z",
  });
  assert.doesNotThrow(() => VerificationBundleArtifactSchema.parse(verificationWithTrust));
  assert.equal(
    verificationWithTrust.basis.length,
    6,
    "verification_bundle with trust close must carry 6 basis refs (+ trust_run + trust_evaluation)",
  );
  const trustRunBasisRef = verificationWithTrust.basis.find((ref) => ref.kind === "trust_run");
  assert.ok(trustRunBasisRef, "trust_run basis kind must appear");
  const trustEvaluationBasisRef = verificationWithTrust.basis.find((ref) => ref.kind === "trust_evaluation");
  assert.ok(trustEvaluationBasisRef, "trust_evaluation basis kind must appear");
  assert.ok(verificationWithTrust.payload.trustState, "payload.trustState must be populated when trust refs are present");
  assert.equal(verificationWithTrust.payload.trustState!.state, "changed");
  assert.equal(verificationWithTrust.payload.trustState!.traceId, "trace_current");
  assert.deepEqual(
    verificationWithTrust.payload.trustState!.basisRefIds.sort(),
    [trustRunBasisRef!.basisRefId, trustEvaluationBasisRef!.basisRefId].sort(),
    "trustState.basisRefIds must point at both trust_run and trust_evaluation basis refs",
  );

  // 7.5 asymmetric input: if trustRun is present but trustEvaluation is not
  // (or vice versa), neither basis ref is emitted and trustState stays
  // absent. This keeps the contract invariant (basisRefIds point at live
  // basis entries) honest.
  const verificationWithRunOnly = generateVerificationBundleArtifact({
    projectId: "proj_1",
    verificationPlan,
    tenantLeakAudit,
    trustRun,
    // no trustEvaluation
    generatedAt: "2026-04-21T05:30:00.000Z",
  });
  assert.doesNotThrow(() => VerificationBundleArtifactSchema.parse(verificationWithRunOnly));
  assert.equal(
    verificationWithRunOnly.payload.trustState,
    undefined,
    "trustState must be absent when only one of trustRun/trustEvaluation is provided",
  );
  assert.ok(
    !verificationWithRunOnly.basis.some((ref) => ref.kind === "trust_run" || ref.kind === "trust_evaluation"),
    "neither trust basis kind must emit when only one of trustRun/trustEvaluation is present",
  );

  console.log("artifact-generators: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
