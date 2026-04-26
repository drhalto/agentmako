import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerEnvironmentFingerprint,
  AnswerPacket,
  AnswerTrustRunProvenance,
  JsonObject,
  QueryKind,
  SupportLevel,
  EvidenceStatus,
} from "@mako-ai/contracts";
import { hashJson } from "./hash.js";
import { parseJson } from "./json.js";
import { getLatestIndexRunImpl } from "./project-store-index.js";
import { loadSchemaSnapshotImpl } from "./project-store-snapshots.js";
import type { AnswerComparableTargetRecord } from "./types.js";

export interface AnswerComparableTargetRow {
  target_id: string;
  project_id: string;
  query_kind: QueryKind;
  normalized_query_text: string;
  comparison_key: string;
  identity_json: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface TrustBackfillRow {
  trace_id: string;
  project_id: string | null;
  query_kind: QueryKind;
  query_text: string;
  packet_json: string;
  answer_markdown: string | null;
  provenance: AnswerTrustRunProvenance | null;
  environment_fingerprint_json: string | null;
  created_at: string;
}

export interface ComparableAnswerLocator {
  projectId: string;
  queryKind: QueryKind;
  queryText: string;
  identity?: JsonObject;
}

export const UNKNOWN_ENVIRONMENT_FINGERPRINT: AnswerEnvironmentFingerprint = {
  gitHead: null,
  schemaSnapshotId: null,
  schemaFingerprint: null,
  indexRunId: null,
};

export function mapComparableTargetRow(row: AnswerComparableTargetRow | undefined): AnswerComparableTargetRecord | null {
  if (!row) return null;
  return {
    targetId: row.target_id,
    projectId: row.project_id,
    queryKind: row.query_kind,
    normalizedQueryText: row.normalized_query_text,
    comparisonKey: row.comparison_key,
    identity: parseJson<JsonObject>(row.identity_json, {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeComparableQueryText(queryKind: QueryKind, queryText: string): string {
  const trimmed = normalizeWhitespace(queryText);
  const prefix = `${queryKind}(`;
  if (trimmed.startsWith(prefix) && trimmed.endsWith(")")) {
    return normalizeWhitespace(trimmed.slice(prefix.length, -1));
  }
  return trimmed;
}

function parseQualifiedObjectName(value: string): { schemaName: string | null; objectName: string } | null {
  const trimmed = normalizeWhitespace(value);
  if (trimmed === "") return null;
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return { schemaName: null, objectName: trimmed };
  }
  return {
    schemaName: trimmed.slice(0, dotIndex),
    objectName: trimmed.slice(dotIndex + 1),
  };
}

function inferComparableTargetIdentity(queryKind: QueryKind, queryText: string): JsonObject | undefined {
  const normalizedQueryText = normalizeComparableQueryText(queryKind, queryText);
  if (normalizedQueryText === "") return undefined;

  switch (queryKind) {
    case "trace_file":
    case "file_health":
      return {
        kind: "file_target",
        filePath: normalizedQueryText,
      };
    case "route_trace":
      return {
        kind: "route_target",
        routePath: normalizedQueryText,
      };
    case "auth_path":
      return {
        kind: "auth_path_target",
        subject: normalizedQueryText,
      };
    case "schema_usage": {
      const qualified = parseQualifiedObjectName(normalizedQueryText);
      if (!qualified) return undefined;
      return {
        kind: "schema_object_target",
        schemaName: qualified.schemaName,
        objectName: qualified.objectName,
      };
    }
    case "trace_table":
    case "preflight_table": {
      const qualified = parseQualifiedObjectName(normalizedQueryText);
      if (!qualified) return undefined;
      return {
        kind: "table_target",
        schemaName: qualified.schemaName,
        tableName: qualified.objectName,
      };
    }
    case "trace_rpc": {
      const hasArgs = normalizedQueryText.includes("(") && normalizedQueryText.endsWith(")");
      const qualifiedName = hasArgs
        ? normalizedQueryText.slice(0, normalizedQueryText.indexOf("(")).trim()
        : normalizedQueryText;
      const argList = hasArgs
        ? normalizedQueryText
            .slice(normalizedQueryText.indexOf("(") + 1, -1)
            .split(",")
            .map((value) => normalizeWhitespace(value))
            .filter((value) => value.length > 0)
        : [];
      const qualified = parseQualifiedObjectName(qualifiedName);
      if (!qualified) return undefined;
      return {
        kind: "rpc_target",
        schemaName: qualified.schemaName,
        rpcName: qualified.objectName,
        argTypes: argList,
      };
    }
    case "trace_edge":
      return {
        kind: "edge_target",
        edgeName: normalizedQueryText,
      };
    case "trace_error":
      return {
        kind: "error_term_target",
        term: normalizedQueryText,
      };
    default:
      return undefined;
  }
}

export function buildComparableAnswerIdentity(locator: ComparableAnswerLocator): {
  normalizedQueryText: string;
  comparisonKey: string;
  identity: JsonObject;
} {
  const normalizedQueryText = normalizeComparableQueryText(locator.queryKind, locator.queryText);
  const inferredIdentity = locator.identity ?? inferComparableTargetIdentity(locator.queryKind, locator.queryText);
  const identity: JsonObject = inferredIdentity
    ? {
        projectId: locator.projectId,
        queryKind: locator.queryKind,
        ...inferredIdentity,
      }
    : {
        kind: "fallback_target",
        projectId: locator.projectId,
        queryKind: locator.queryKind,
        normalizedQueryText,
      };
  return {
    normalizedQueryText,
    comparisonKey: hashJson(identity),
    identity,
  };
}

function normalizeStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter((value) => value.length > 0))].sort();
}

function normalizeEvidenceBlocksForHash(evidence: AnswerPacket["evidence"]): JsonObject[] {
  const normalized = evidence.map((block) => ({
    kind: block.kind,
    title: block.title,
    sourceRef: block.sourceRef,
    filePath: block.filePath ?? null,
    line: block.line ?? null,
    content: block.content,
    stale: block.stale ?? false,
    metadata: block.metadata ?? null,
  }));

  normalized.sort((left, right) => {
    const leftKey = hashJson(left);
    const rightKey = hashJson(right);
    return leftKey.localeCompare(rightKey);
  });

  return normalized;
}

function canonicalizeAnswerPacket(packet: AnswerPacket): JsonObject {
  return {
    projectId: packet.projectId,
    queryKind: packet.queryKind,
    queryText: normalizeComparableQueryText(packet.queryKind, packet.queryText),
    supportLevel: packet.supportLevel,
    evidenceStatus: packet.evidenceStatus,
    missingInformation: normalizeStringSet(packet.missingInformation),
    stalenessFlags: normalizeStringSet(packet.stalenessFlags),
    evidence: normalizeEvidenceBlocksForHash(packet.evidence),
  };
}

export function getPacketHashes(packet: AnswerPacket): { packetHash: string; rawPacketHash: string } {
  return {
    packetHash: hashJson(canonicalizeAnswerPacket(packet)),
    rawPacketHash: hashJson(packet),
  };
}

export function normalizeEnvironmentFingerprint(
  fingerprint?: Partial<AnswerEnvironmentFingerprint> | null,
): AnswerEnvironmentFingerprint {
  return {
    gitHead: fingerprint?.gitHead ?? null,
    schemaSnapshotId: fingerprint?.schemaSnapshotId ?? null,
    schemaFingerprint: fingerprint?.schemaFingerprint ?? null,
    indexRunId: fingerprint?.indexRunId ?? null,
  };
}

function tryResolveGitHead(projectRoot: string | undefined): string | null {
  if (!projectRoot) {
    return null;
  }

  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function buildEnvironmentFingerprint(
  db: DatabaseSync,
  projectRoot?: string,
): AnswerEnvironmentFingerprint {
  const snapshot = loadSchemaSnapshotImpl(db);
  const latestIndexRun = getLatestIndexRunImpl(db);
  return {
    gitHead: tryResolveGitHead(projectRoot),
    schemaSnapshotId: snapshot?.snapshotId ?? null,
    schemaFingerprint: snapshot?.fingerprint ?? null,
    indexRunId: latestIndexRun?.runId ?? null,
  };
}

export function parseStoredPacket(row: TrustBackfillRow): AnswerPacket {
  return parseJson<AnswerPacket>(row.packet_json, {
    queryId: row.trace_id,
    projectId: row.project_id ?? "",
    queryKind: row.query_kind,
    queryText: row.query_text,
    tierUsed: "standard",
    supportLevel: "best_effort" satisfies SupportLevel,
    evidenceStatus: "partial" satisfies EvidenceStatus,
    evidenceConfidence: 0,
    missingInformation: [],
    stalenessFlags: [],
    evidence: [],
    generatedAt: row.created_at,
  });
}

export function findPreviousTrustRun(
  db: DatabaseSync,
  targetId: string,
  excludeTraceId?: string,
): { traceId: string; packetHash: string } | undefined {
  const statement = excludeTraceId
    ? db.prepare(`
        SELECT trace_id, packet_hash
        FROM answer_trust_runs
        WHERE target_id = ?
          AND trace_id <> ?
        ORDER BY created_at DESC, trace_id DESC
        LIMIT 1
      `)
    : db.prepare(`
        SELECT trace_id, packet_hash
        FROM answer_trust_runs
        WHERE target_id = ?
        ORDER BY created_at DESC, trace_id DESC
        LIMIT 1
      `);

  const row = (excludeTraceId
    ? statement.get(targetId, excludeTraceId)
    : statement.get(targetId)) as { trace_id: string; packet_hash: string } | undefined;

  if (!row) return undefined;
  return {
    traceId: row.trace_id,
    packetHash: row.packet_hash,
  };
}
