import { z } from "zod";

/**
 * 8.0 Runtime Telemetry Contract.
 *
 * Typed shape for usefulness / ranking / routing signals that interactive
 * runtime flows will emit at decision time. Mirrors the eval runner's typed
 * output (see `packages/tools/src/evals/runner.ts`) rather than inventing a
 * parallel grading system — 8.1 write paths capture the existing
 * `evaluateArtifactUsefulness` / `evaluatePowerWorkflowUsefulness` /
 * `evaluateWorkflowPacketUsefulness` output into rows shaped like this.
 *
 * This phase is contract-only: no runtime caller reads or writes these
 * types yet. 8.1 adds the write paths, 8.2 adds the read models.
 *
 * Rules (from phase-8.0):
 *
 * - `grade` is enumerated here (`full` / `partial` / `no`), mirroring the
 *   shipped evaluator grade space exactly.
 * - `reasonCodes` is `string[]` rather than a union: the per-family
 *   evaluators already own the vocabulary and the contract deliberately
 *   does not re-declare it. 8.1 callers should only emit codes that the
 *   source evaluator produced.
 * - `LearnedDecisionEnvelope.surface` + `policyVersion` + `experimentId`
 *   are the audit triple: given any envelope, a reviewer must be able to
 *   trace back to which learned policy produced the delta.
 * - `baseline === finalDecision` when `learnedDelta.applied === false`.
 * - `rollbackReason` is only present when the envelope came from an
 *   active demotion window.
 */

// ===== RuntimeUsefulnessEvent =====

export const RUNTIME_USEFULNESS_DECISION_KINDS = [
  "artifact_usefulness",
  "power_workflow_usefulness",
  "packet_usefulness",
  "wrapper_usefulness",
  "finding_ack",
  "agent_feedback",
] as const;

export type RuntimeUsefulnessDecisionKind =
  (typeof RUNTIME_USEFULNESS_DECISION_KINDS)[number];

export const RuntimeUsefulnessDecisionKindSchema = z.enum([
  ...RUNTIME_USEFULNESS_DECISION_KINDS,
]);

export type RuntimeUsefulnessGrade = "full" | "partial" | "no";

export const RuntimeUsefulnessGradeSchema = z.enum(["full", "partial", "no"]);

export interface RuntimeUsefulnessEvent {
  eventId: string;
  projectId: string;
  requestId: string;
  traceId?: string;
  capturedAt: string;

  decisionKind: RuntimeUsefulnessDecisionKind;

  family: string;
  toolName?: string;

  grade: RuntimeUsefulnessGrade;
  reasonCodes: string[];

  observedFollowupLinked?: boolean;
  reason?: string;
}

export const RuntimeUsefulnessEventSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  requestId: z.string().min(1),
  traceId: z.string().min(1).optional(),
  capturedAt: z.string().datetime({ offset: true }),

  decisionKind: RuntimeUsefulnessDecisionKindSchema,

  family: z.string().min(1),
  toolName: z.string().min(1).optional(),

  grade: RuntimeUsefulnessGradeSchema,
  reasonCodes: z.array(z.string().min(1)),

  observedFollowupLinked: z.boolean().optional(),
  reason: z.string().min(1).optional(),
}) satisfies z.ZodType<RuntimeUsefulnessEvent>;

// ===== LearnedDecisionEnvelope =====

/**
 * Shared shape every learned surface emits, across ranking, routing,
 * promotion, and failure-clustering experiments.
 *
 * Generic over `T` (the decision payload). Callers build the concrete
 * schema through {@link learnedDecisionEnvelopeSchema} so `baseline` and
 * `finalDecision` validate against the same payload shape.
 */
export interface LearnedDecisionEnvelope<T> {
  surface: string;
  policyVersion: string;
  experimentId?: string;

  baseline: T;
  learnedDelta: {
    applied: boolean;
    reason: string;
    boundedBy: string;
  };
  finalDecision: T;
  rollbackReason?: string;
}

const LearnedDeltaSchema = z.object({
  applied: z.boolean(),
  reason: z.string().min(1),
  boundedBy: z.string().min(1),
});

/**
 * Build the envelope schema for a concrete payload type.
 *
 * The schema enforces `baseline === finalDecision` when
 * `learnedDelta.applied === false` via `.superRefine`. Equality is tested
 * by JSON-serialization, which is sufficient for the pure-data payloads
 * Roadmap 8 ships.
 */
export function learnedDecisionEnvelopeSchema<T>(
  payloadSchema: z.ZodType<T>,
): z.ZodType<LearnedDecisionEnvelope<T>> {
  const base = z.object({
    surface: z.string().min(1),
    policyVersion: z.string().min(1),
    experimentId: z.string().min(1).optional(),

    baseline: payloadSchema,
    learnedDelta: LearnedDeltaSchema,
    finalDecision: payloadSchema,
    rollbackReason: z.string().min(1).optional(),
  });

  return base.superRefine((env, ctx) => {
    if (!env.learnedDelta.applied) {
      if (
        JSON.stringify(env.baseline) !== JSON.stringify(env.finalDecision)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalDecision"],
          message:
            "baseline must equal finalDecision when learnedDelta.applied === false",
        });
      }
    }
    // rollbackReason captures "decision reverted to baseline after a
    // demotion fired." A non-null rollbackReason alongside
    // learnedDelta.applied === true is schema-rejected because the
    // delta is still active and there is nothing to roll back.
    if (env.rollbackReason !== undefined && env.learnedDelta.applied) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rollbackReason"],
        message:
          "rollbackReason may only be present when learnedDelta.applied === false",
      });
    }
  }) as unknown as z.ZodType<LearnedDecisionEnvelope<T>>;
}

// ===== RuntimeRankingDecision =====

export interface RuntimeRankingDecisionInput {
  candidateId: string;
  baselineRank: number;
}

export interface RankingDecisionPayload {
  orderedCandidateIds: string[];
}

export interface RuntimeRankingDecision {
  eventId: string;
  projectId: string;
  requestId: string;
  capturedAt: string;
  inputs: RuntimeRankingDecisionInput[];
  envelope: LearnedDecisionEnvelope<RankingDecisionPayload>;
}

const RuntimeRankingDecisionInputSchema = z.object({
  candidateId: z.string().min(1),
  baselineRank: z.number().int().nonnegative(),
});

const RankingDecisionPayloadSchema = z.object({
  orderedCandidateIds: z.array(z.string().min(1)),
});

export const RuntimeRankingDecisionSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  requestId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  inputs: z.array(RuntimeRankingDecisionInputSchema),
  envelope: learnedDecisionEnvelopeSchema(RankingDecisionPayloadSchema),
}) satisfies z.ZodType<RuntimeRankingDecision>;

// ===== RuntimeRoutingDecision =====

export interface RoutingDecisionPayload {
  chosenCandidate: string;
}

export interface RuntimeRoutingDecision {
  eventId: string;
  projectId: string;
  requestId: string;
  capturedAt: string;
  candidates: string[];
  envelope: LearnedDecisionEnvelope<RoutingDecisionPayload>;
}

const RoutingDecisionPayloadSchema = z.object({
  chosenCandidate: z.string().min(1),
});

export const RuntimeRoutingDecisionSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  requestId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  candidates: z.array(z.string().min(1)),
  envelope: learnedDecisionEnvelopeSchema(RoutingDecisionPayloadSchema),
}) satisfies z.ZodType<RuntimeRoutingDecision>;
