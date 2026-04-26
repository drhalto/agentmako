import assert from "node:assert/strict";
import {
  AnswerResultSchema,
  WorkflowPacketSchema,
  type AnswerResult,
  type EvidenceBlock,
  type WorkflowImplementationBriefPacket,
  type WorkflowPacketGenerator,
} from "../../packages/contracts/src/index.ts";
import {
  WorkflowPacketRegistry,
  assertWorkflowPacketIntegrity,
  buildWorkflowContextBundle,
  buildWorkflowPacketBasis,
  buildWorkflowPacketCitation,
  buildWorkflowPacketId,
  buildWorkflowPacketInput,
  buildWorkflowPacketSection,
  formatWorkflowPacket,
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
  ];
}

function buildAnswerResult(): AnswerResult {
  const queryId = "query_workflow_packet_phase50";
  return {
    queryId,
    projectId: "project_workflow_packet_phase50",
    queryKind: "trace_file",
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer: "The event page bypasses the shared helper and should be aligned before further changes.",
    answerConfidence: 0.94,
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
      projectId: "project_workflow_packet_phase50",
      queryKind: "trace_file",
      queryText: "trace_file(app/events/[id]/page.tsx)",
      tierUsed: "standard",
      supportLevel: "native",
      evidenceStatus: "complete",
      evidenceConfidence: 0.96,
      missingInformation: ["Need to verify whether admin-only fields are filtered server-side."],
      stalenessFlags: [],
      evidence: buildEvidence(),
      generatedAt: "2026-04-19T09:30:00.000Z",
    },
    trust: {
      state: "stable",
      reasons: [
        {
          code: "no_meaningful_change",
          detail: "The latest comparable run matches the current evidence.",
        },
      ],
      basisTraceIds: ["trace_prior_events"],
      conflictingFacets: [],
      scopeRelation: "same_scope",
      comparisonId: "comparison_phase50",
      clusterId: "cluster_phase50",
      comparisonSummary: [],
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
          codeHash: "codehash50",
          patternHash: "patternhash50",
        },
        metadata: {
          helperName: "loadVisibleEvents",
        },
      },
    ],
  };
}

function createImplementationBriefGenerator(): WorkflowPacketGenerator<"implementation_brief"> {
  return {
    family: "implementation_brief",
    generate(input): WorkflowImplementationBriefPacket {
      const packetId = buildWorkflowPacketId(input, { version: 1 });
      const fileItem = input.selectedItems.find((item) => item.kind === "file");
      const diagnosticItem = input.selectedItems.find((item) => item.kind === "diagnostic");
      const symbolItem = input.selectedItems.find((item) => item.kind === "symbol");

      assert.ok(fileItem, "expected a primary file item");
      assert.ok(diagnosticItem, "expected a diagnostic item");
      assert.ok(symbolItem, "expected a symbol item");

      const fileCitation = buildWorkflowPacketCitation({
        packetId,
        item: fileItem,
        rationale: "Primary change zone.",
      });
      const diagnosticCitation = buildWorkflowPacketCitation({
        packetId,
        item: diagnosticItem,
        rationale: "Risk that should not be reintroduced.",
      });
      const symbolCitation = buildWorkflowPacketCitation({
        packetId,
        item: symbolItem,
        rationale: "Canonical helper to preserve.",
      });

      const summarySection = buildWorkflowPacketSection({
        packetId,
        kind: "summary",
        title: "Summary",
        entries: [
          {
            text: "Update the event page to follow the shared helper path instead of bypassing it.",
            citationIds: [fileCitation.citationId, diagnosticCitation.citationId],
            metadata: {
              priority: "high",
            },
          },
        ],
      });
      const changeAreasSection = buildWorkflowPacketSection({
        packetId,
        kind: "change_areas",
        title: "Change Areas",
        entries: [
          {
            text: "Start with app/events/[id]/page.tsx because that is the current bypass point.",
            citationIds: [fileCitation.citationId],
          },
        ],
      });
      const invariantsSection = buildWorkflowPacketSection({
        packetId,
        kind: "invariants",
        title: "Invariants",
        entries: [
          {
            text: "Preserve loadVisibleEvents as the canonical helper path while changing the page.",
            citationIds: [symbolCitation.citationId],
          },
        ],
      });
      const risksSection = buildWorkflowPacketSection({
        packetId,
        kind: "risks",
        title: "Risks",
        entries: [
          {
            text: "Do not reintroduce helper bypass logic while touching the page.",
            citationIds: [diagnosticCitation.citationId],
          },
        ],
      });
      const verificationSection = buildWorkflowPacketSection({
        packetId,
        kind: "verification",
        title: "Verification",
        entries: [
          {
            text: "Trace the page again after the edit and confirm the helper bypass diagnostic disappears.",
            citationIds: [diagnosticCitation.citationId],
          },
        ],
      });

      return {
        packetId,
        family: "implementation_brief",
        title: "Implementation Brief: Events Page Helper Alignment",
        queryId: input.queryId,
        projectId: input.projectId,
        basis: buildWorkflowPacketBasis(input),
        sections: [
          summarySection,
          changeAreasSection,
          invariantsSection,
          risksSection,
          verificationSection,
        ],
        citations: [fileCitation, diagnosticCitation, symbolCitation],
        assumptions: ["loadVisibleEvents remains the canonical shared helper."],
        openQuestions: [...input.openQuestions],
        payload: {
          summarySectionId: summarySection.sectionId,
          changeAreasSectionId: changeAreasSection.sectionId,
          invariantsSectionId: invariantsSection.sectionId,
          risksSectionId: risksSection.sectionId,
          verificationSectionId: verificationSection.sectionId,
        },
      };
    },
  };
}

async function main(): Promise<void> {
  const result = buildAnswerResult();
  AnswerResultSchema.parse(result);

  const bundle = buildWorkflowContextBundle(result);
  const packetInput = buildWorkflowPacketInput(bundle, {
    family: "implementation_brief",
    scope: "all",
    focusKinds: ["file", "diagnostic", "symbol"],
  });

  const registry = new WorkflowPacketRegistry([createImplementationBriefGenerator()]);
  assert.deepEqual(registry.listFamilies(), ["implementation_brief"]);

  const firstPacket = await registry.generate(packetInput);
  const secondPacket = await registry.generate(packetInput);
  WorkflowPacketSchema.parse(firstPacket);

  assert.equal(firstPacket.packetId, secondPacket.packetId, "packet ids should be stable");
  assert.deepEqual(
    firstPacket.citations.map((citation) => citation.citationId),
    secondPacket.citations.map((citation) => citation.citationId),
    "citations should be stable across repeated generation",
  );
  assert.ok(firstPacket.sections.every((section) => section.entries.length > 0));
  assert.deepEqual(firstPacket.sections[0]?.entries[0]?.metadata, {
    priority: "high",
  });

  assert.throws(
    () =>
      assertWorkflowPacketIntegrity(
        {
          ...firstPacket,
          basis: {
            ...firstPacket.basis,
            scope: "primary",
          },
        },
        packetInput,
      ),
    /does not match the input basis/i,
  );
  assert.throws(
    () =>
      assertWorkflowPacketIntegrity(
        {
          ...firstPacket,
          citations: [
            {
              ...firstPacket.citations[0]!,
              itemId: "file:missing.ts",
            },
            ...firstPacket.citations.slice(1),
          ],
        },
        packetInput,
      ),
    /cites unknown item/i,
  );

  const rendered = formatWorkflowPacket(firstPacket);
  assert.ok(rendered.includes("# Implementation Brief: Events Page Helper Alignment"));
  assert.ok(rendered.includes("## Summary"));
  assert.ok(rendered.includes("## Citations"));
  assert.ok(rendered.includes("workflow_citation_"));
  assert.ok(rendered.includes("Need to verify whether admin-only fields are filtered server-side."));

  console.log("workflow-packets: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
