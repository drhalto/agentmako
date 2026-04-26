import type { MakoConfig } from "@mako-ai/config";
import type {
  AttachedProject,
  DbBindingStatus,
  IndexFreshnessSummary,
  ProjectManifest,
  ProjectProfile,
  SchemaSnapshotWarning,
  SchemaSnapshotSummary,
} from "@mako-ai/contracts";
import type { IndexRunRecord, ProjectIndexStatus, ProjectScanStats, ProjectStoreCache } from "@mako-ai/store";

export interface IndexerOptions {
  configOverrides?: Partial<MakoConfig>;
  projectStoreCache?: ProjectStoreCache;
  triggerSource?: string;
}

export interface AttachProjectResult {
  project: AttachedProject;
  profile: ProjectProfile;
  manifest: ProjectManifest;
  manifestPath: string;
  resolvedRootPath: string;
  globalDbPath: string;
  projectDbPath: string;
}

export interface IndexProjectResult {
  project: AttachedProject;
  profile: ProjectProfile;
  manifest: ProjectManifest;
  manifestPath: string;
  run: IndexRunRecord;
  stats: ProjectScanStats;
  schemaSnapshot: SchemaSnapshotSummary;
  schemaSnapshotWarnings: SchemaSnapshotWarning[];
  globalDbPath: string;
  projectDbPath: string;
}

export interface RefreshProjectPathsResult extends IndexProjectResult {
  mode: "paths" | "full";
  refreshedPaths: string[];
  deletedPaths: string[];
  fallbackReason?: string;
}

export interface DetachProjectResult {
  project: AttachedProject;
  detachedAt: string;
  purged: boolean;
  removedPaths: string[];
}

export interface ProjectStatusResult extends ProjectIndexStatus {
  manifest: ProjectManifest | null;
  manifestPath: string;
  schemaSnapshot: SchemaSnapshotSummary;
  codeIndexFreshness: IndexFreshnessSummary;
  dbBinding: DbBindingStatus;
  /**
   * Phase 3.9: 30-day rolling sum of `harness_provider_calls.cost_usd_micro`
   * for sessions attached to this project. `null` for brand-new projects
   * that haven't recorded any model calls yet. Micro-USD so the dashboard
   * can format to `$0.XX` without float drift.
   */
  costUsdMicro30d: number | null;
}
