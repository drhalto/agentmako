import {
  beginIndexRunImpl,
  finishIndexRunImpl,
  getIndexRunImpl,
  getLatestIndexRunImpl,
  getScanStatsImpl,
  replaceFileIndexRowsImpl,
  replaceIndexSnapshotImpl,
} from "./project-store-index.js";
import { insertLifecycleEventImpl, queryLifecycleEventsImpl } from "./project-store-lifecycle.js";
import { insertToolRunImpl, queryToolRunsImpl } from "./project-store-tool-runs.js";
import {
  insertWorkflowFollowupImpl,
  queryWorkflowFollowupsImpl,
} from "./project-store-workflow-followups.js";
import {
  aggregateUsefulnessEventsByDecisionKindImpl,
  aggregateUsefulnessEventsByFamilyImpl,
  aggregateUsefulnessEventsByGradeImpl,
  countUsefulnessEventsImpl,
  insertUsefulnessEventImpl,
  queryUsefulnessEventsImpl,
} from "./project-store-runtime-telemetry.js";
import {
  aggregateFindingAcksByCategoryImpl,
  aggregateFindingAcksByFilePathImpl,
  aggregateFindingAcksByStatusImpl,
  aggregateFindingAcksBySubjectKindImpl,
  countFindingAcksImpl,
  insertFindingAckImpl,
  loadAcknowledgedFingerprintsImpl,
  queryFindingAcksImpl,
} from "./project-store-finding-acks.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  FindingAckAggregationFilter,
  FindingAckCategoryFingerprintCount,
  FindingAckFilePathCount,
  FindingAckInsert,
  FindingAckRecord,
  FindingAckStatusCount,
  FindingAckSubjectKindCount,
  IndexRunRecord,
  IndexRunStats,
  IndexSnapshot,
  LifecycleEventInsert,
  LifecycleEventRecord,
  ProjectScanStats,
  QueryFindingAcksOptions,
  QueryLifecycleEventsOptions,
  QueryToolRunsOptions,
  QueryUsefulnessEventsOptions,
  QueryWorkflowFollowupsOptions,
  ReplaceFileIndexRowsInput,
  ToolRunInsert,
  ToolRunRecord,
  UsefulnessEventAggregationFilter,
  UsefulnessEventDecisionKindCount,
  UsefulnessEventFamilyCount,
  UsefulnessEventGradeCount,
  UsefulnessEventInsert,
  UsefulnessEventRecord,
  WorkflowFollowupInsert,
  WorkflowFollowupRecord,
} from "./types.js";

export const projectStoreIndexMethods = {
  beginIndexRun(this: ProjectStoreContext, triggerSource: string): IndexRunRecord {
    return beginIndexRunImpl(this.db, triggerSource);
  },

  getIndexRun(this: ProjectStoreContext, runId: string): IndexRunRecord | null {
    return getIndexRunImpl(this.db, runId);
  },

  getLatestIndexRun(this: ProjectStoreContext): IndexRunRecord | null {
    return getLatestIndexRunImpl(this.db);
  },

  finishIndexRun(
    this: ProjectStoreContext,
    runId: string,
    status: IndexRunRecord["status"],
    stats?: IndexRunStats,
    errorText?: string,
  ): IndexRunRecord {
    return finishIndexRunImpl(this.db, runId, status, stats, errorText);
  },

  insertLifecycleEvent(
    this: ProjectStoreContext,
    input: LifecycleEventInsert,
  ): LifecycleEventRecord {
    return insertLifecycleEventImpl(this.db, input);
  },

  queryLifecycleEvents(
    this: ProjectStoreContext,
    options: QueryLifecycleEventsOptions = {},
  ): LifecycleEventRecord[] {
    return queryLifecycleEventsImpl(this.db, options);
  },

  insertToolRun(this: ProjectStoreContext, input: ToolRunInsert): ToolRunRecord {
    return insertToolRunImpl(this.db, input);
  },

  queryToolRuns(
    this: ProjectStoreContext,
    options: QueryToolRunsOptions = {},
  ): ToolRunRecord[] {
    return queryToolRunsImpl(this.db, options);
  },

  insertWorkflowFollowup(
    this: ProjectStoreContext,
    input: WorkflowFollowupInsert,
  ): WorkflowFollowupRecord {
    return insertWorkflowFollowupImpl(this.db, input);
  },

  queryWorkflowFollowups(
    this: ProjectStoreContext,
    options: QueryWorkflowFollowupsOptions = {},
  ): WorkflowFollowupRecord[] {
    return queryWorkflowFollowupsImpl(this.db, options);
  },

  insertUsefulnessEvent(
    this: ProjectStoreContext,
    input: UsefulnessEventInsert,
  ): UsefulnessEventRecord {
    return insertUsefulnessEventImpl(this.db, input);
  },

  queryUsefulnessEvents(
    this: ProjectStoreContext,
    options: QueryUsefulnessEventsOptions = {},
  ): UsefulnessEventRecord[] {
    return queryUsefulnessEventsImpl(this.db, options);
  },

  countUsefulnessEvents(
    this: ProjectStoreContext,
    filter: UsefulnessEventAggregationFilter = {},
  ): number {
    return countUsefulnessEventsImpl(this.db, filter);
  },

  aggregateUsefulnessEventsByDecisionKind(
    this: ProjectStoreContext,
    filter: UsefulnessEventAggregationFilter = {},
  ): UsefulnessEventDecisionKindCount[] {
    return aggregateUsefulnessEventsByDecisionKindImpl(this.db, filter);
  },

  aggregateUsefulnessEventsByFamily(
    this: ProjectStoreContext,
    filter: UsefulnessEventAggregationFilter = {},
  ): UsefulnessEventFamilyCount[] {
    return aggregateUsefulnessEventsByFamilyImpl(this.db, filter);
  },

  aggregateUsefulnessEventsByGrade(
    this: ProjectStoreContext,
    filter: UsefulnessEventAggregationFilter = {},
  ): UsefulnessEventGradeCount[] {
    return aggregateUsefulnessEventsByGradeImpl(this.db, filter);
  },

  insertFindingAck(
    this: ProjectStoreContext,
    input: FindingAckInsert,
  ): FindingAckRecord {
    return insertFindingAckImpl(this.db, input);
  },

  queryFindingAcks(
    this: ProjectStoreContext,
    options: QueryFindingAcksOptions = {},
  ): FindingAckRecord[] {
    return queryFindingAcksImpl(this.db, options);
  },

  countFindingAcks(
    this: ProjectStoreContext,
    filter: FindingAckAggregationFilter = {},
  ): number {
    return countFindingAcksImpl(this.db, filter);
  },

  loadAcknowledgedFingerprints(
    this: ProjectStoreContext,
    projectId: string,
    category: string,
  ): Set<string> {
    return loadAcknowledgedFingerprintsImpl(this.db, projectId, category);
  },

  aggregateFindingAcksByCategory(
    this: ProjectStoreContext,
    filter: FindingAckAggregationFilter = {},
  ): FindingAckCategoryFingerprintCount[] {
    return aggregateFindingAcksByCategoryImpl(this.db, filter);
  },

  aggregateFindingAcksByStatus(
    this: ProjectStoreContext,
    filter: FindingAckAggregationFilter = {},
  ): FindingAckStatusCount[] {
    return aggregateFindingAcksByStatusImpl(this.db, filter);
  },

  aggregateFindingAcksBySubjectKind(
    this: ProjectStoreContext,
    filter: FindingAckAggregationFilter = {},
  ): FindingAckSubjectKindCount[] {
    return aggregateFindingAcksBySubjectKindImpl(this.db, filter);
  },

  aggregateFindingAcksByFilePath(
    this: ProjectStoreContext,
    filter: FindingAckAggregationFilter = {},
  ): FindingAckFilePathCount[] {
    return aggregateFindingAcksByFilePathImpl(this.db, filter);
  },

  replaceIndexSnapshot(this: ProjectStoreContext, snapshot: IndexSnapshot): ProjectScanStats {
    return replaceIndexSnapshotImpl(this.db, snapshot);
  },

  replaceFileIndexRows(this: ProjectStoreContext, input: ReplaceFileIndexRowsInput): ProjectScanStats {
    return replaceFileIndexRowsImpl(this.db, input);
  },

  getScanStats(this: ProjectStoreContext): ProjectScanStats {
    return getScanStatsImpl(this.db);
  },
};

export type ProjectStoreIndexMethods = {
  [K in keyof typeof projectStoreIndexMethods]: OmitThisParameter<
    (typeof projectStoreIndexMethods)[K]
  >;
};
