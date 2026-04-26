import type {
  AnswerResult,
  DbBindingTestStatus,
  SchemaSnapshot,
  SchemaTable,
} from "@mako-ai/contracts";
import {
  findFileImpl,
  getAnswerTraceImpl,
  getFileContentImpl,
  getFileDetailImpl,
  getSchemaObjectDetailImpl,
  getSchemaTableSnapshotImpl,
  getStatusImpl,
  listAllImportEdgesImpl,
  listDependentsForFileImpl,
  listFilesImpl,
  listFunctionTableRefsImpl,
  listImportsForFileImpl,
  listRecentAnswerTracesImpl,
  listRoutesForFileImpl,
  listRoutesImpl,
  listSchemaObjectsImpl,
  listSchemaUsagesImpl,
  listSymbolsForFileImpl,
  loadDbBindingStateImpl,
  markDbBindingRefreshedImpl,
  markDbBindingVerifiedImpl,
  saveAnswerTraceImpl,
  saveDbBindingTestResultImpl,
  searchCodeChunksImpl,
  searchFilesImpl,
  searchRoutesImpl,
  searchSchemaBodiesImpl,
  searchSchemaObjectsImpl,
  type CodeChunkHit,
  type FunctionTableRef,
  type SchemaBodyHit,
} from "./project-store-queries.js";
import {
  clearSchemaSnapshotImpl,
  loadSchemaSnapshotImpl,
  markSchemaSnapshotDriftImpl,
  markSchemaSnapshotVerifiedImpl,
  saveSchemaSnapshotImpl,
} from "./project-store-snapshots.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  DbBindingStateRecord,
  FileDetailRecord,
  FileImportLink,
  FileSearchMatch,
  FileSummaryRecord,
  ProjectIndexStatus,
  ProjectProfileRecord,
  QueryAnswerTracesOptions,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SavedAnswerTraceRecord,
  SaveAnswerTrustRunOptions,
  SchemaObjectDetail,
  SchemaUsageMatch,
  SymbolRecord,
} from "./types.js";

type ProjectStoreStatusContext = ProjectStoreContext & {
  loadProjectProfile(): ProjectProfileRecord | null;
};

export const projectStoreQueryMethods = {
  findFile(this: ProjectStoreContext, fileQuery: string): FileSummaryRecord | null {
    return findFileImpl(this.db, fileQuery, this.prepared.bind(this));
  },

  searchFiles(
    this: ProjectStoreContext,
    queryText: string,
    limit = 5,
    options: { mode?: "prefix_and" | "phrase" } = {},
  ): FileSearchMatch[] {
    return searchFilesImpl(this.db, queryText, limit, options);
  },

  searchCodeChunks(
    this: ProjectStoreContext,
    queryText: string,
    options: { limit?: number; symbolOnly?: boolean; mode?: "prefix_and" | "phrase" } = {},
  ): CodeChunkHit[] {
    return searchCodeChunksImpl(this.db, queryText, options);
  },

  searchSchemaBodies(this: ProjectStoreContext, term: string, limit = 20): SchemaBodyHit[] {
    return searchSchemaBodiesImpl(this.db, term, limit);
  },

  listFunctionTableRefs(
    this: ProjectStoreContext,
    filter: {
      rpcSchema?: string;
      rpcName?: string;
      rpcKind?: "function" | "procedure";
      argTypes?: string[];
      targetSchema?: string;
      tableName?: string;
    } = {},
  ): FunctionTableRef[] {
    return listFunctionTableRefsImpl(this.db, filter);
  },

  getSchemaTableSnapshot(
    this: ProjectStoreContext,
    schemaName: string,
    tableName: string,
  ): SchemaTable | null {
    return getSchemaTableSnapshotImpl(this.db, schemaName, tableName);
  },

  searchRoutes(
    this: ProjectStoreContext,
    queryText: string,
    limit = 5,
  ): ResolvedRouteRecord[] {
    return searchRoutesImpl(this.db, queryText, limit);
  },

  listRoutes(this: ProjectStoreContext): ResolvedRouteRecord[] {
    return listRoutesImpl(this.db, this.prepared.bind(this));
  },

  listFiles(this: ProjectStoreContext): FileSummaryRecord[] {
    return listFilesImpl(this.db, this.prepared.bind(this));
  },

  listAllImportEdges(this: ProjectStoreContext): FileImportLink[] {
    return listAllImportEdgesImpl(this.db);
  },

  listImportsForFile(this: ProjectStoreContext, filePath: string): FileImportLink[] {
    return listImportsForFileImpl(this.db, filePath);
  },

  listDependentsForFile(this: ProjectStoreContext, filePath: string): FileImportLink[] {
    return listDependentsForFileImpl(this.db, filePath);
  },

  listRoutesForFile(this: ProjectStoreContext, filePath: string): ResolvedRouteRecord[] {
    return listRoutesForFileImpl(this.db, filePath);
  },

  listSymbolsForFile(this: ProjectStoreContext, filePath: string): SymbolRecord[] {
    return listSymbolsForFileImpl(this.db, filePath, this.prepared.bind(this));
  },

  getFileContent(this: ProjectStoreContext, filePath: string): string | null {
    return getFileContentImpl(this.db, filePath, this.prepared.bind(this));
  },

  getFileDetail(this: ProjectStoreContext, fileQuery: string): FileDetailRecord | null {
    return getFileDetailImpl(this.db, fileQuery);
  },

  searchSchemaObjects(
    this: ProjectStoreContext,
    queryText: string,
    limit = 5,
  ): ResolvedSchemaObjectRecord[] {
    return searchSchemaObjectsImpl(this.db, queryText, limit);
  },

  listSchemaObjects(this: ProjectStoreContext): ResolvedSchemaObjectRecord[] {
    return listSchemaObjectsImpl(this.db);
  },

  listSchemaUsages(this: ProjectStoreContext, objectId: number): SchemaUsageMatch[] {
    return listSchemaUsagesImpl(this.db, objectId);
  },

  getSchemaObjectDetail(this: ProjectStoreContext, queryText: string): SchemaObjectDetail | null {
    return getSchemaObjectDetailImpl(this.db, queryText);
  },

  saveSchemaSnapshot(this: ProjectStoreContext, snapshot: SchemaSnapshot): void {
    return saveSchemaSnapshotImpl(this.db, snapshot);
  },

  loadSchemaSnapshot(this: ProjectStoreContext): SchemaSnapshot | null {
    return loadSchemaSnapshotImpl(this.db);
  },

  clearSchemaSnapshot(this: ProjectStoreContext): void {
    return clearSchemaSnapshotImpl(this.db);
  },

  markSchemaSnapshotVerified(this: ProjectStoreContext, args: { verifiedAt: string }): void {
    return markSchemaSnapshotVerifiedImpl(this.db, args);
  },

  markSchemaSnapshotDrift(this: ProjectStoreContext, args: { driftDetectedAt: string }): void {
    return markSchemaSnapshotDriftImpl(this.db, args);
  },

  loadDbBindingState(this: ProjectStoreContext): DbBindingStateRecord {
    return loadDbBindingStateImpl(this.db);
  },

  saveDbBindingTestResult(
    this: ProjectStoreContext,
    args: {
      status: DbBindingTestStatus;
      testedAt: string;
      error?: string;
      serverVersion?: string;
      currentUser?: string;
    },
  ): void {
    return saveDbBindingTestResultImpl(this.db, args);
  },

  markDbBindingVerified(this: ProjectStoreContext, args: { verifiedAt: string }): void {
    return markDbBindingVerifiedImpl(this.db, args);
  },

  markDbBindingRefreshed(this: ProjectStoreContext, args: { refreshedAt: string }): void {
    return markDbBindingRefreshedImpl(this.db, args);
  },

  saveAnswerTrace(
    this: ProjectStoreContext,
    result: AnswerResult,
    options: SaveAnswerTrustRunOptions = {},
  ): SavedAnswerTraceRecord {
    return saveAnswerTraceImpl(this.db, result, {
      ...options,
      projectRoot: this.projectRoot,
    });
  },

  getAnswerTrace(this: ProjectStoreContext, traceId: string): SavedAnswerTraceRecord | null {
    return getAnswerTraceImpl(this.db, traceId);
  },

  listRecentAnswerTraces(
    this: ProjectStoreContext,
    options: QueryAnswerTracesOptions = {},
  ): SavedAnswerTraceRecord[] {
    return listRecentAnswerTracesImpl(this.db, options);
  },

  getStatus(
    this: ProjectStoreStatusContext,
    project: ProjectIndexStatus["project"],
  ): ProjectIndexStatus {
    return getStatusImpl(this.db, project, () => this.loadProjectProfile());
  },
};

export type ProjectStoreQueryMethods = {
  [K in keyof typeof projectStoreQueryMethods]: OmitThisParameter<
    (typeof projectStoreQueryMethods)[K]
  >;
};
