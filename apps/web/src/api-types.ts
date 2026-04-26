import type {
  MessagePartKind,
  MessageRole,
  ProviderSpec,
} from "@mako-ai/harness-contracts";

/**
 * Thin re-export barrel so every UI surface imports types from one place.
 *
 * We re-export the zod-inferred types from `@mako-ai/harness-contracts` and
 * (a small subset of) `@mako-ai/contracts`. This is cheaper than writing
 * a codegen step and makes contract drift a TypeScript error in `pnpm
 * typecheck` rather than a runtime surprise.
 */

export type {
  HarnessTier,
  HarnessEvent,
  Session,
  SessionUsageSnapshot,
  MessageRole,
  MessagePartKind,
  PermissionRule,
  PermissionDecision,
  ProviderSpec,
  ModelSpec,
  TierResolution,
} from "@mako-ai/harness-contracts";

export type PermissionAction = "allow" | "deny" | "ask";
export type PermissionScope = "turn" | "session" | "project" | "global";

export type {
  AttachedProject,
  AnswerResult,
  ApiResponse,
} from "@mako-ai/contracts";

// -----------------------------------------------------------------------------
// Dashboard-shaped view models (not on the wire — they just bundle what the
// UI needs per surface). Keep narrow; every field must be reachable from an
// existing route.
// -----------------------------------------------------------------------------

export interface SessionSummary {
  id: string;
  title: string | null;
  tier: "no-agent" | "local-agent" | "cloud-agent";
  status: "active" | "idle" | "closed" | "error";
  createdAt: string;
  updatedAt: string;
  activeProvider: string | null;
  activeModel: string | null;
}

export interface TierEmbeddingStatus {
  ok: boolean;
  providerId?: string;
  modelId?: string;
  source?: string;
  reason?: string;
  attempted?: Array<{ providerId: string; modelId: string; reason: string }>;
}

export interface TierCompactionStatus {
  threshold: number;
  harnessVersion: string;
}

export interface TierStatus {
  current: "no-agent" | "local-agent" | "cloud-agent";
  reason: string;
  upgradePath: string[];
  embedding?: TierEmbeddingStatus;
  compaction?: TierCompactionStatus;
}

export interface MemoryHit {
  memoryId: string;
  text: string;
  category: string | null;
  tags: string[];
  createdAt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

export interface ProviderEntry {
  source: string;
  keyResolved: boolean;
  keySource: string | null;
  reachable: boolean | null;
  resolvedBaseURL: string | null;
  /**
   * Phase 3.9: local daemon discovery status. `null` for cloud providers.
   * `ok === false` with a populated `error` means the daemon is down /
   * unreachable; the UI can surface this next to the provider row.
   */
  localProbe?: { ok: boolean; models: number; error?: string } | null;
  spec: ProviderSpec;
}

export interface PersistedSessionMessage {
  id: string;
  role: MessageRole;
  archived: boolean;
  parts: Array<{ kind: MessagePartKind; payload: unknown }>;
}

export interface PendingPermissionRequest {
  requestId: string;
  permission: string;
  pattern: string;
}

export interface SessionResumeResult {
  sessionId: string;
  resumedFromOrdinal: number;
  eventCount: number;
  pendingApprovals: Array<{
    requestId: string;
    tool: string;
    requestOrdinal: number;
  }>;
}
