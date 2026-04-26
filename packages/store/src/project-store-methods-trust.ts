import type { EvidenceStatus, SupportLevel } from "@mako-ai/contracts";
import {
  ensureAnswerTrustClusterImpl,
  getAnswerComparisonByRunPairImpl,
  getAnswerComparisonImpl,
  getAnswerComparableTargetImpl,
  getAnswerTrustClusterImpl,
  getAnswerTrustEvaluationImpl,
  getAnswerTrustRunImpl,
  getLatestAnswerComparisonImpl,
  getLatestAnswerTrustEvaluationForTargetImpl,
  getLatestAnswerTrustEvaluationForTraceImpl,
  getLatestComparableAnswerRunImpl,
  insertAnswerComparisonImpl,
  insertAnswerTrustEvaluationImpl,
  listAnswerComparisonsImpl,
  listAnswerTrustClustersImpl,
  listAnswerTrustEvaluationsImpl,
  listComparableAnswerRunsImpl,
  type ComparableAnswerLocator,
} from "./project-store-trust.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  AnswerComparableTargetRecord,
  AnswerComparisonRecord,
  AnswerTrustClusterRecord,
  AnswerTrustEvaluationRecord,
  AnswerTrustRunRecord,
  SaveAnswerComparisonInput,
  SaveAnswerTrustEvaluationInput,
} from "./types.js";

export const projectStoreTrustMethods = {
  getAnswerTrustRun(this: ProjectStoreContext, traceId: string): AnswerTrustRunRecord | null {
    return getAnswerTrustRunImpl(this.db, traceId);
  },

  getAnswerComparableTarget(
    this: ProjectStoreContext,
    targetId: string,
  ): AnswerComparableTargetRecord | null {
    return getAnswerComparableTargetImpl(this.db, targetId);
  },

  getLatestComparableAnswerRun(
    this: ProjectStoreContext,
    locator: ComparableAnswerLocator,
  ): AnswerTrustRunRecord | null {
    return getLatestComparableAnswerRunImpl(this.db, locator);
  },

  listComparableAnswerRuns(
    this: ProjectStoreContext,
    args: ({ traceId: string; limit?: number } | (ComparableAnswerLocator & { limit?: number })),
  ): AnswerTrustRunRecord[] {
    return listComparableAnswerRunsImpl(this.db, args);
  },

  insertAnswerComparison(
    this: ProjectStoreContext,
    input: SaveAnswerComparisonInput,
  ): AnswerComparisonRecord {
    return insertAnswerComparisonImpl(this.db, input);
  },

  getAnswerComparison(
    this: ProjectStoreContext,
    comparisonId: string,
  ): AnswerComparisonRecord | null {
    return getAnswerComparisonImpl(this.db, comparisonId);
  },

  getAnswerComparisonByRunPair(
    this: ProjectStoreContext,
    args: { priorTraceId: string; currentTraceId: string },
  ): AnswerComparisonRecord | null {
    return getAnswerComparisonByRunPairImpl(this.db, args);
  },

  getLatestAnswerComparison(
    this: ProjectStoreContext,
    targetId: string,
  ): AnswerComparisonRecord | null {
    return getLatestAnswerComparisonImpl(this.db, targetId);
  },

  listAnswerComparisons(
    this: ProjectStoreContext,
    targetId: string,
    limit = 20,
  ): AnswerComparisonRecord[] {
    return listAnswerComparisonsImpl(this.db, { targetId, limit });
  },

  ensureAnswerTrustCluster(
    this: ProjectStoreContext,
    args: {
      targetId: string;
      packetHash: string;
      supportLevel: SupportLevel;
      evidenceStatus: EvidenceStatus;
      seenAt?: string;
      runCount?: number;
    },
  ): AnswerTrustClusterRecord {
    return ensureAnswerTrustClusterImpl(this.db, args);
  },

  getAnswerTrustCluster(
    this: ProjectStoreContext,
    clusterId: string,
  ): AnswerTrustClusterRecord | null {
    return getAnswerTrustClusterImpl(this.db, clusterId);
  },

  listAnswerTrustClusters(
    this: ProjectStoreContext,
    targetId: string,
    limit = 20,
  ): AnswerTrustClusterRecord[] {
    return listAnswerTrustClustersImpl(this.db, { targetId, limit });
  },

  insertAnswerTrustEvaluation(
    this: ProjectStoreContext,
    input: SaveAnswerTrustEvaluationInput,
  ): AnswerTrustEvaluationRecord {
    return insertAnswerTrustEvaluationImpl(this.db, input);
  },

  getAnswerTrustEvaluation(
    this: ProjectStoreContext,
    evaluationId: string,
  ): AnswerTrustEvaluationRecord | null {
    return getAnswerTrustEvaluationImpl(this.db, evaluationId);
  },

  getLatestAnswerTrustEvaluationForTrace(
    this: ProjectStoreContext,
    traceId: string,
  ): AnswerTrustEvaluationRecord | null {
    return getLatestAnswerTrustEvaluationForTraceImpl(this.db, traceId);
  },

  getLatestAnswerTrustEvaluationForTarget(
    this: ProjectStoreContext,
    targetId: string,
  ): AnswerTrustEvaluationRecord | null {
    return getLatestAnswerTrustEvaluationForTargetImpl(this.db, targetId);
  },

  listAnswerTrustEvaluations(
    this: ProjectStoreContext,
    targetId: string,
    limit = 50,
  ): AnswerTrustEvaluationRecord[] {
    return listAnswerTrustEvaluationsImpl(this.db, { targetId, limit });
  },
};

export type ProjectStoreTrustMethods = {
  [K in keyof typeof projectStoreTrustMethods]: OmitThisParameter<
    (typeof projectStoreTrustMethods)[K]
  >;
};
