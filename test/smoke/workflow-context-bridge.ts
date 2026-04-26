import assert from "node:assert/strict";
import {
  AnswerResultSchema,
  WorkflowContextBundleSchema,
  WorkflowPacketInputSchema,
  type AnswerResult,
  type EvidenceBlock,
  type WorkflowFileContextItem,
  type WorkflowContextItem,
} from "../../packages/contracts/src/index.ts";
import {
  buildWorkflowContextBundle,
  buildWorkflowPacketInput,
  extractWorkflowContextItems,
} from "../../packages/tools/src/index.ts";

function buildEvidence(): EvidenceBlock[] {
  return [
    {
      blockId: "ev-file",
      kind: "file",
      title: "app/events/[id]/page.tsx",
      sourceRef: "app/events/[id]/page.tsx:12",
      filePath: "app/events/[id]/page.tsx",
      line: 12,
      content: "export default async function EventPage() {}",
      metadata: {},
    },
    {
      blockId: "ev-symbol",
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
      title: "/api/events/[id]",
      sourceRef: "GET /api/events/[id]",
      filePath: "app/api/events/[id]/route.ts",
      line: 8,
      content: "GET /api/events/[id]",
      metadata: {
        isApi: true,
      },
    },
    {
      blockId: "ev-route-alt",
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
      blockId: "ev-route-bare",
      kind: "route",
      title: "/api/events/[id]/admin",
      sourceRef: "DELETE /api/events/[id]/admin",
      content: "DELETE /api/events/[id]/admin",
      metadata: {
        isApi: true,
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
      blockId: "ev-symbol-alt",
      kind: "symbol",
      title: "loadVisibleEvents",
      sourceRef: "lib/events/actions.ts:42",
      filePath: "lib/events/actions.ts",
      line: 42,
      content: "export async function loadVisibleEvents() {}",
      metadata: {
        exportName: "loadVisibleEvents",
      },
    },
  ];
}

function buildAnswerResult(): AnswerResult {
  const queryId = "query_workflow_bridge";
  return {
    queryId,
    projectId: "project_workflow_bridge",
    queryKind: "trace_file",
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer:
      "The events page reads from loadVisibleEvents, the API route handles GET /api/events/[id], and both depend on public.events.",
    answerConfidence: 0.93,
    candidateActions: [
      {
        actionId: "open_route",
        label: "Open route",
        description: "Inspect the event API route handler.",
        safeToAutomate: true,
      },
    ],
    packet: {
      queryId,
      projectId: "project_workflow_bridge",
      queryKind: "trace_file",
      queryText: "trace_file(app/events/[id]/page.tsx)",
      tierUsed: "standard",
      supportLevel: "native",
      evidenceStatus: "complete",
      evidenceConfidence: 0.95,
      missingInformation: ["Need to verify whether admin-only fields are filtered server-side."],
      stalenessFlags: ["schema_snapshot_lag"],
      evidence: buildEvidence(),
      generatedAt: "2026-04-19T09:00:00.000Z",
    },
    trust: {
      state: "changed",
      reasons: [
        {
          code: "meaningful_change_detected",
          detail: "The latest comparable run changed the supporting evidence set.",
        },
      ],
      basisTraceIds: ["trace_prior_events"],
      conflictingFacets: ["evidence_set"],
      scopeRelation: "same_scope",
      comparisonId: "comparison_events_bridge",
      clusterId: "cluster_events_bridge",
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
          codeHash: "codehash1",
          patternHash: "patternhash1",
        },
        metadata: {
          helperName: "loadVisibleEvents",
        },
      },
    ],
    ranking: {
      orderKey: 90,
      deEmphasized: true,
      reasons: [
        {
          severity: "low",
          confidence: "probable",
          category: "ranking",
          code: "ranking.trust_changed",
          message: "Changed trust state de-emphasized this answer.",
          evidenceRefs: ["comparison_events_bridge"],
          identity: {
            matchBasedId: "ranking.trust_changed:comparison_events_bridge",
            codeHash: "codehash2",
            patternHash: "patternhash2",
          },
        },
      ],
    },
  };
}

function contextByKind<K extends WorkflowContextItem["kind"]>(
  bundle: { items: WorkflowContextItem[] },
  kind: K,
): Extract<WorkflowContextItem, { kind: K }>[] {
  return bundle.items.filter(
    (item): item is Extract<WorkflowContextItem, { kind: K }> => item.kind === kind,
  );
}

function isFileItem(item: WorkflowContextItem): item is WorkflowFileContextItem {
  return item.kind === "file";
}

async function main(): Promise<void> {
  const result = buildAnswerResult();
  AnswerResultSchema.parse(result);

  const bundle = buildWorkflowContextBundle(result);
  WorkflowContextBundleSchema.parse(bundle);

  const repeated = buildWorkflowContextBundle(result);
  assert.deepEqual(
    bundle.items.map((item) => item.itemId),
    repeated.items.map((item) => item.itemId),
    "repeated extraction should keep stable context identities",
  );
  assert.deepEqual(extractWorkflowContextItems(result), bundle.items);

  assert.ok(bundle.primaryItemIds.includes("file:app/events/[id]/page.tsx"));
  assert.ok(bundle.primaryItemIds.includes("symbol:lib/events/actions.ts:loadVisibleEvents:42"));
  assert.ok(bundle.primaryItemIds.includes("route:GET /api/events/[id]"));
  assert.ok(bundle.primaryItemIds.includes("route:DELETE /api/events/[id]/admin"));
  assert.ok(bundle.primaryItemIds.includes("table:public.events"));
  assert.ok(bundle.primaryItemIds.includes("rpc:public.get_visible_events(uuid)"));

  assert.equal(contextByKind(bundle, "route").length, 2, "distinct routes should produce distinct route items");
  assert.equal(contextByKind(bundle, "symbol").length, 1, "equivalent symbol evidence should collapse to one symbol item");

  assert.ok(
    !bundle.items.some(
      (item) => item.kind === "file" && item.data.filePath === "DELETE /api/events/[id]/admin",
    ),
    "route evidence without a filePath must not be misread as a file item",
  );

  const mergedRoute = contextByKind(bundle, "route").find(
    (item): item is typeof item & { data: { routeKey: string } } =>
      item.kind === "route" && item.data.routeKey === "GET /api/events/[id]",
  );
  assert.ok(mergedRoute, "expected the collapsed route to remain in the bundle");
  assert.equal(
    (mergedRoute as { data: { handlerName: string | null } }).data.handlerName,
    "getEventRoute",
    "equivalent route evidence should merge complementary fields (handlerName) instead of keeping only the first-seen copy",
  );

  assert.ok(bundle.supportingItemIds.includes("answer:query_workflow_bridge"));
  assert.ok(bundle.supportingItemIds.includes("trust:query_workflow_bridge"));
  assert.ok(bundle.supportingItemIds.includes("comparison:comparison_events_bridge"));
  assert.ok(
    bundle.supportingItemIds.includes(
      "diagnostic:reuse.helper_bypass:app/events/[id]/page.tsx:loadVisibleEvents",
    ),
  );

  assert.deepEqual(bundle.openQuestions, [
    "Need to verify whether admin-only fields are filtered server-side.",
  ]);

  const answerPacket = contextByKind(bundle, "answer_packet")[0];
  assert.ok(answerPacket);
  assert.equal(answerPacket.data.rankingDeEmphasized, true);
  assert.deepEqual(answerPacket.data.rankingReasonCodes, ["ranking.trust_changed"]);

  const trustItem = contextByKind(bundle, "trust_evaluation")[0];
  assert.ok(trustItem);
  assert.equal(trustItem.data.state, "changed");
  assert.deepEqual(trustItem.data.reasonCodes, ["meaningful_change_detected"]);

  const comparisonItem = contextByKind(bundle, "comparison")[0];
  assert.ok(comparisonItem);
  assert.deepEqual(comparisonItem.data.summaryChanges.map((change) => change.code), ["evidence_removed"]);

  const diagnosticItem = contextByKind(bundle, "diagnostic")[0];
  assert.ok(diagnosticItem);
  assert.equal(diagnosticItem.data.code, "reuse.helper_bypass");

  const getRouteItem = contextByKind(bundle, "route").find(
    (item) => item.kind === "route" && item.data.routeKey === "GET /api/events/[id]",
  );
  assert.ok(getRouteItem);
  assert.deepEqual(getRouteItem.sourceRefs, [
    "GET /api/events/[id]",
    "route:app/api/events/[id]/route.ts",
  ]);

  const implementationBriefInput = {
    primaryFiles: bundle.items
      .filter((item) => bundle.primaryItemIds.includes(item.itemId))
      .filter(isFileItem)
      .map((item) => item.data.filePath),
    supportingDiagnostics: contextByKind(bundle, "diagnostic").map((item) => item.data.code),
    trustState: trustItem.data.state,
    openQuestions: bundle.openQuestions,
  };
  assert.deepEqual(implementationBriefInput, {
    primaryFiles: [
      "app/api/events/[id]/route.ts",
      "app/events/[id]/page.tsx",
      "lib/events/actions.ts",
    ],
    supportingDiagnostics: ["reuse.helper_bypass"],
    trustState: "changed",
    openQuestions: ["Need to verify whether admin-only fields are filtered server-side."],
  });

  const verificationPlanInput = {
    routeKeys: contextByKind(bundle, "route").map((item) => item.data.routeKey),
    rpcNames: contextByKind(bundle, "rpc").map((item) => item.data.rpcName),
    tables: contextByKind(bundle, "table").map((item) => item.data.tableName),
    comparisonCodes: comparisonItem.data.summaryChanges.map((change) => change.code),
  };
  assert.deepEqual(verificationPlanInput, {
    routeKeys: ["DELETE /api/events/[id]/admin", "GET /api/events/[id]"],
    rpcNames: ["get_visible_events"],
    tables: ["events"],
    comparisonCodes: ["evidence_removed"],
  });

  const packetInput = buildWorkflowPacketInput(bundle, {
    family: "implementation_brief",
    scope: "primary",
    focusKinds: ["diagnostic"],
    watchMode: "watch",
  });
  WorkflowPacketInputSchema.parse(packetInput);
  assert.equal(packetInput.family, "implementation_brief");
  assert.equal(packetInput.scope, "primary");
  assert.equal(packetInput.watchMode, "watch");
  assert.ok(packetInput.selectedItemIds.includes("file:app/events/[id]/page.tsx"));
  assert.ok(
    packetInput.selectedItemIds.includes(
      "diagnostic:reuse.helper_bypass:app/events/[id]/page.tsx:loadVisibleEvents",
    ),
    "focused supporting items should be included even when the base scope is primary",
  );
  assert.deepEqual(packetInput.focusedItemIds, [
    "diagnostic:reuse.helper_bypass:app/events/[id]/page.tsx:loadVisibleEvents",
  ]);

  const verificationPacketInput = buildWorkflowPacketInput(result, {
    family: "verification_plan",
  });
  WorkflowPacketInputSchema.parse(verificationPacketInput);
  assert.equal(verificationPacketInput.scope, "all");
  assert.equal(verificationPacketInput.watchMode, "off");
  assert.deepEqual(verificationPacketInput.focusedItemIds, verificationPacketInput.primaryItemIds);
  assert.ok(verificationPacketInput.selectedItemIds.includes("trust:query_workflow_bridge"));

  console.log("workflow-context-bridge: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
