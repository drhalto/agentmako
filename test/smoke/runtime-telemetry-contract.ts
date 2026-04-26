import assert from "node:assert/strict";
import { z } from "zod";
import {
  RUNTIME_USEFULNESS_DECISION_KINDS,
  RuntimeRankingDecisionSchema,
  RuntimeRoutingDecisionSchema,
  RuntimeUsefulnessEventSchema,
  learnedDecisionEnvelopeSchema,
  type LearnedDecisionEnvelope,
  type RuntimeRankingDecision,
  type RuntimeRoutingDecision,
  type RuntimeUsefulnessEvent,
} from "../../packages/contracts/src/index.ts";

function buildUsefulnessEvent(): RuntimeUsefulnessEvent {
  return {
    eventId: "evt_01HXXXX",
    projectId: "proj_1",
    requestId: "req_1",
    traceId: "trace_1",
    capturedAt: "2026-04-22T12:00:00.000Z",
    decisionKind: "artifact_usefulness",
    family: "task_preflight",
    toolName: "task_preflight_artifact",
    grade: "full",
    reasonCodes: ["basis_complete", "preflight_has_verification_steps"],
    observedFollowupLinked: true,
    reason: "all basis refs present; verification steps derived from plan",
  };
}

function buildBaselineRankingDecision(): RuntimeRankingDecision {
  return {
    eventId: "evt_r1",
    projectId: "proj_1",
    requestId: "req_r1",
    capturedAt: "2026-04-22T12:00:00.000Z",
    inputs: [
      { candidateId: "tool_a", baselineRank: 0 },
      { candidateId: "tool_b", baselineRank: 1 },
      { candidateId: "tool_c", baselineRank: 2 },
    ],
    envelope: {
      surface: "tool_search_rank",
      policyVersion: "tool_search@v1",
      baseline: { orderedCandidateIds: ["tool_a", "tool_b", "tool_c"] },
      learnedDelta: {
        applied: false,
        reason: "below minimum-sample gate",
        boundedBy: "min-sample=100",
      },
      finalDecision: { orderedCandidateIds: ["tool_a", "tool_b", "tool_c"] },
    },
  };
}

function buildDeltaRankingDecision(): RuntimeRankingDecision {
  const base = buildBaselineRankingDecision();
  return {
    ...base,
    eventId: "evt_r2",
    requestId: "req_r2",
    envelope: {
      surface: "tool_search_rank",
      policyVersion: "tool_search@v1",
      experimentId: "exp_rank_v1",
      baseline: { orderedCandidateIds: ["tool_a", "tool_b", "tool_c"] },
      learnedDelta: {
        applied: true,
        reason: "learned prior promoted tool_b above tool_a",
        boundedBy: "max-rank-shift=3",
      },
      finalDecision: { orderedCandidateIds: ["tool_b", "tool_a", "tool_c"] },
    },
  };
}

function buildRoutingDecision(): RuntimeRoutingDecision {
  return {
    eventId: "evt_rt1",
    projectId: "proj_1",
    requestId: "req_rt1",
    capturedAt: "2026-04-22T12:00:00.000Z",
    candidates: ["verification_plan", "implementation_brief"],
    envelope: {
      surface: "packet_attachment",
      policyVersion: "attachment-policy@v1",
      baseline: { chosenCandidate: "verification_plan" },
      learnedDelta: {
        applied: false,
        reason: "no active experiment",
        boundedBy: "no-delta-allowed",
      },
      finalDecision: { chosenCandidate: "verification_plan" },
    },
  };
}

async function main(): Promise<void> {
  // Shipped decision kinds cover every evaluator family plus operator and
  // agent-authored feedback emissions.
  assert.deepEqual(
    [...RUNTIME_USEFULNESS_DECISION_KINDS].sort(),
    [
      "agent_feedback",
      "artifact_usefulness",
      "finding_ack",
      "packet_usefulness",
      "power_workflow_usefulness",
      "wrapper_usefulness",
    ],
    "RUNTIME_USEFULNESS_DECISION_KINDS must cover every evaluator family",
  );

  // --- RuntimeUsefulnessEvent ---

  const event = buildUsefulnessEvent();
  assert.doesNotThrow(() => RuntimeUsefulnessEventSchema.parse(event));

  // Optional fields can drop.
  const minimal: RuntimeUsefulnessEvent = {
    eventId: "evt_min",
    projectId: "proj_1",
    requestId: "req_min",
    capturedAt: "2026-04-22T12:00:00.000Z",
    decisionKind: "wrapper_usefulness",
    family: "tool_plane",
    grade: "partial",
    reasonCodes: ["tool_result_schema_valid"],
  };
  assert.doesNotThrow(() => RuntimeUsefulnessEventSchema.parse(minimal));

  // Empty family is rejected.
  assert.ok(
    !RuntimeUsefulnessEventSchema.safeParse({ ...event, family: "" }).success,
    "empty family must be rejected",
  );

  // Unknown decisionKind is rejected.
  assert.ok(
    !RuntimeUsefulnessEventSchema.safeParse({
      ...event,
      decisionKind: "not_a_kind" as unknown as RuntimeUsefulnessEvent["decisionKind"],
    }).success,
    "unknown decisionKind must be rejected",
  );

  // Unknown grade is rejected.
  assert.ok(
    !RuntimeUsefulnessEventSchema.safeParse({
      ...event,
      grade: "mystery" as unknown as RuntimeUsefulnessEvent["grade"],
    }).success,
    "unknown grade must be rejected",
  );

  // Non-ISO capturedAt is rejected — downstream SQLite ORDER BY and since/until
  // filters treat the column as ISO-8601; schema validation must enforce that.
  assert.ok(
    !RuntimeUsefulnessEventSchema.safeParse({
      ...event,
      capturedAt: "not-an-iso-string",
    }).success,
    "non-ISO capturedAt must be rejected",
  );
  assert.ok(
    !RuntimeUsefulnessEventSchema.safeParse({
      ...event,
      capturedAt: "2026-04-22 12:00:00",
    }).success,
    "space-separated date is not ISO-8601 and must be rejected",
  );

  // --- LearnedDecisionEnvelope: baseline === finalDecision when applied=false ---

  const baselineOnly = buildBaselineRankingDecision();
  assert.doesNotThrow(() => RuntimeRankingDecisionSchema.parse(baselineOnly));

  const drifted: RuntimeRankingDecision = {
    ...baselineOnly,
    envelope: {
      ...baselineOnly.envelope,
      finalDecision: { orderedCandidateIds: ["tool_b", "tool_a", "tool_c"] },
    },
  };
  assert.ok(
    !RuntimeRankingDecisionSchema.safeParse(drifted).success,
    "baseline must equal finalDecision when applied=false",
  );

  // Applied=true permits baseline !== finalDecision.
  const withDelta = buildDeltaRankingDecision();
  assert.doesNotThrow(() => RuntimeRankingDecisionSchema.parse(withDelta));

  // --- Audit triple: surface / policyVersion non-empty ---

  const emptySurface: RuntimeRankingDecision = {
    ...baselineOnly,
    envelope: { ...baselineOnly.envelope, surface: "" },
  };
  assert.ok(
    !RuntimeRankingDecisionSchema.safeParse(emptySurface).success,
    "empty envelope.surface must be rejected",
  );

  const emptyPolicyVersion: RuntimeRankingDecision = {
    ...baselineOnly,
    envelope: { ...baselineOnly.envelope, policyVersion: "" },
  };
  assert.ok(
    !RuntimeRankingDecisionSchema.safeParse(emptyPolicyVersion).success,
    "empty envelope.policyVersion must be rejected",
  );

  // experimentId is optional and absence is accepted.
  assert.ok(
    RuntimeRankingDecisionSchema.safeParse(baselineOnly).success,
    "envelope without experimentId must parse",
  );

  // --- boundedBy must be non-empty ---

  const emptyBoundedBy: RuntimeRankingDecision = {
    ...withDelta,
    envelope: {
      ...withDelta.envelope,
      learnedDelta: { ...withDelta.envelope.learnedDelta, boundedBy: "" },
    },
  };
  assert.ok(
    !RuntimeRankingDecisionSchema.safeParse(emptyBoundedBy).success,
    "empty boundedBy must be rejected",
  );

  // --- RuntimeRoutingDecision parses ---

  const routing = buildRoutingDecision();
  assert.doesNotThrow(() => RuntimeRoutingDecisionSchema.parse(routing));

  // Drift detection also applies to routing.
  const driftedRouting: RuntimeRoutingDecision = {
    ...routing,
    envelope: {
      ...routing.envelope,
      finalDecision: { chosenCandidate: "implementation_brief" },
    },
  };
  assert.ok(
    !RuntimeRoutingDecisionSchema.safeParse(driftedRouting).success,
    "routing baseline must equal finalDecision when applied=false",
  );

  // --- Factory returns a typed envelope usable for other payloads ---

  const CustomPayloadSchema = z.object({ pick: z.string().min(1) });
  const CustomEnvelopeSchema = learnedDecisionEnvelopeSchema(
    CustomPayloadSchema,
  );
  const customOk: LearnedDecisionEnvelope<
    z.infer<typeof CustomPayloadSchema>
  > = {
    surface: "custom_surface",
    policyVersion: "custom@v1",
    baseline: { pick: "a" },
    learnedDelta: {
      applied: false,
      reason: "baseline only",
      boundedBy: "static",
    },
    finalDecision: { pick: "a" },
  };
  assert.doesNotThrow(() => CustomEnvelopeSchema.parse(customOk));

  // A demotion envelope carries rollbackReason and applied=false; the
  // drift rule still applies (baseline matches finalDecision).
  const demotion: RuntimeRankingDecision = {
    ...baselineOnly,
    envelope: {
      ...baselineOnly.envelope,
      learnedDelta: {
        applied: false,
        reason: "rolled back to baseline",
        boundedBy: "demotion-trigger",
      },
      rollbackReason: "eval regression exceeded floor",
    },
  };
  assert.doesNotThrow(() => RuntimeRankingDecisionSchema.parse(demotion));

  // rollbackReason alongside applied=true is schema-rejected — when the
  // learned delta is active there is nothing to roll back.
  const rollbackWithActiveDelta: RuntimeRankingDecision = {
    ...withDelta,
    envelope: {
      ...withDelta.envelope,
      rollbackReason: "inconsistent — delta is active",
    },
  };
  assert.ok(
    !RuntimeRankingDecisionSchema.safeParse(rollbackWithActiveDelta).success,
    "rollbackReason alongside applied=true must be rejected",
  );

  console.log("runtime-telemetry-contract: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
