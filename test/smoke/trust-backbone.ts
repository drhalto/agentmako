import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnswerResult, QueryKind } from "../../packages/contracts/src/index.ts";
import { resolveProjectDbPath } from "../../packages/config/src/index.ts";
import {
  openProjectStore,
  openSqliteDatabase,
} from "../../packages/store/src/index.ts";
import {
  PROJECT_MIGRATION_0001_INIT_SQL,
  PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL,
  PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL,
  PROJECT_MIGRATION_0004_SCHEMA_SNAPSHOT_READ_MODEL_SQL,
  PROJECT_MIGRATION_0005_SCHEMA_SNAPSHOT_SOURCE_KIND_SQL,
  PROJECT_MIGRATION_0006_ACTION_LOGGING_SQL,
  PROJECT_MIGRATION_0007_BENCHMARK_STORAGE_SQL,
  PROJECT_MIGRATION_0008_HARNESS_SQL,
  PROJECT_MIGRATION_0009_HARNESS_DELETE_GUARDS_SQL,
  PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL,
  PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL,
  PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL,
  PROJECT_MIGRATION_0013_SCHEMA_SNAPSHOT_BODIES_SQL,
  PROJECT_MIGRATION_0014_CHUNK_SEARCH_TEXT_SQL,
  PROJECT_MIGRATION_0015_SCHEMA_FUNCTION_REFS_SIGNATURE_SQL,
  PROJECT_MIGRATION_0016_HARNESS_SEMANTIC_UNITS_SQL,
  PROJECT_MIGRATION_0017_PROVIDER_CALLS_USAGE_SQL,
} from "../../packages/store/src/migration-sql.ts";

const LEGACY_PROJECT_MIGRATIONS = [
  { version: 1, name: "0001_project_init", sql: PROJECT_MIGRATION_0001_INIT_SQL },
  { version: 2, name: "0002_project_schema_snapshot", sql: PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL },
  { version: 3, name: "0003_project_db_binding_state", sql: PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL },
  { version: 4, name: "0004_project_schema_snapshot_read_model", sql: PROJECT_MIGRATION_0004_SCHEMA_SNAPSHOT_READ_MODEL_SQL },
  { version: 5, name: "0005_project_schema_snapshot_source_kind", sql: PROJECT_MIGRATION_0005_SCHEMA_SNAPSHOT_SOURCE_KIND_SQL },
  { version: 6, name: "0006_project_action_logging", sql: PROJECT_MIGRATION_0006_ACTION_LOGGING_SQL },
  { version: 7, name: "0007_project_benchmark_storage", sql: PROJECT_MIGRATION_0007_BENCHMARK_STORAGE_SQL },
  { version: 8, name: "0008_project_harness", sql: PROJECT_MIGRATION_0008_HARNESS_SQL },
  { version: 9, name: "0009_project_harness_delete_guards", sql: PROJECT_MIGRATION_0009_HARNESS_DELETE_GUARDS_SQL },
  { version: 10, name: "0010_project_harness_memories", sql: PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL },
  { version: 11, name: "0011_project_harness_embeddings", sql: PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL },
  { version: 12, name: "0012_project_harness_messages_archived", sql: PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL },
  { version: 13, name: "0013_project_schema_snapshot_bodies", sql: PROJECT_MIGRATION_0013_SCHEMA_SNAPSHOT_BODIES_SQL },
  { version: 14, name: "0014_project_chunk_search_text", sql: PROJECT_MIGRATION_0014_CHUNK_SEARCH_TEXT_SQL },
  { version: 15, name: "0015_project_schema_function_refs_signature", sql: PROJECT_MIGRATION_0015_SCHEMA_FUNCTION_REFS_SIGNATURE_SQL },
  { version: 16, name: "0016_project_harness_semantic_units", sql: PROJECT_MIGRATION_0016_HARNESS_SEMANTIC_UNITS_SQL },
  { version: 17, name: "0017_project_provider_calls_usage", sql: PROJECT_MIGRATION_0017_PROVIDER_CALLS_USAGE_SQL },
] as const;

function makeResult(args: {
  traceId: string;
  projectId: string;
  queryKind: QueryKind;
  queryText: string;
  answer?: string;
}): AnswerResult {
  const now = new Date().toISOString();
  const packet = {
    queryId: args.traceId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    queryText: args.queryText,
    tierUsed: "standard" as const,
    supportLevel: "native" as const,
    evidenceStatus: "complete" as const,
    evidenceConfidence: 0.92,
    missingInformation: [],
    stalenessFlags: [],
    evidence: [
      {
        blockId: `${args.traceId}-evidence`,
        kind: "file" as const,
        title: `${args.queryKind} evidence`,
        sourceRef: `${args.queryKind}:evidence`,
        filePath: "src/app.tsx",
        line: 1,
        content: `evidence for ${args.queryKind}`,
        score: 0.9,
      },
    ],
    generatedAt: now,
  };

  return {
    queryId: args.traceId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer: args.answer ?? `summary for ${args.queryText}`,
    answerConfidence: 0.92,
    packet,
    candidateActions: [],
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trust-backbone-"));
  process.env.MAKO_STATE_HOME = tmp;

  try {
    const projectRoot = path.join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });

    const store = openProjectStore({ projectRoot });
    try {
      const first = makeResult({
        traceId: "trace_same_1",
        projectId: "project-trust",
        queryKind: "trace_file",
        queryText: "trace_file(src/app.tsx)",
      });
      const second = makeResult({
        traceId: "trace_same_2",
        projectId: "project-trust",
        queryKind: "trace_file",
        queryText: " trace_file( src/app.tsx ) ",
      });
      const third = makeResult({
        traceId: "trace_other_1",
        projectId: "project-trust",
        queryKind: "trace_file",
        queryText: "trace_file(src/other.tsx)",
      });
      const benchmarkRun = makeResult({
        traceId: "trace_benchmark_1",
        projectId: "project-trust",
        queryKind: "trace_table",
        queryText: "trace_table(public.events)",
      });
      const freeFormFirst = makeResult({
        traceId: "trace_free_1",
        projectId: "project-trust",
        queryKind: "free_form",
        queryText: "  where is auth checked?  ",
      });
      const freeFormSecond = makeResult({
        traceId: "trace_free_2",
        projectId: "project-trust",
        queryKind: "free_form",
        queryText: "where   is auth checked?",
      });

      const indexRun = store.beginIndexRun("test");
      store.finishIndexRun(indexRun.runId, "succeeded");

      store.saveAnswerTrace(first);
      store.saveAnswerTrace(second);
      store.saveAnswerTrace(third);
      store.saveAnswerTrace(benchmarkRun, { provenance: "benchmark" });
      store.saveAnswerTrace(freeFormFirst);
      store.saveAnswerTrace(freeFormSecond);

      const firstRun = store.getAnswerTrustRun(first.queryId);
      const secondRun = store.getAnswerTrustRun(second.queryId);
      const thirdRun = store.getAnswerTrustRun(third.queryId);
      const benchmarkTrustRun = store.getAnswerTrustRun(benchmarkRun.queryId);
      const freeFormFirstRun = store.getAnswerTrustRun(freeFormFirst.queryId);
      const freeFormSecondRun = store.getAnswerTrustRun(freeFormSecond.queryId);

      assert.ok(firstRun, "expected first trust run to persist");
      assert.ok(secondRun, "expected second trust run to persist");
      assert.ok(thirdRun, "expected third trust run to persist");
      assert.ok(benchmarkTrustRun, "expected provenance-tagged trust run to persist");
      assert.ok(freeFormFirstRun, "expected first fallback trust run to persist");
      assert.ok(freeFormSecondRun, "expected second fallback trust run to persist");

      assert.equal(firstRun.target.normalizedQueryText, "src/app.tsx");
      assert.equal(secondRun.target.normalizedQueryText, "src/app.tsx");
      assert.equal(firstRun.targetId, secondRun.targetId, "expected comparable traces to share a target");
      assert.equal(secondRun.previousTraceId, firstRun.traceId, "expected latest comparable run to link backward");
      assert.equal(secondRun.packetHash, firstRun.packetHash, "expected canonical packet hash to ignore volatile packet fields");
      assert.notEqual(secondRun.rawPacketHash, firstRun.rawPacketHash, "expected raw packet hash to preserve original packet differences");
      assert.equal(secondRun.previousPacketHash, firstRun.packetHash, "expected packet hash chain to follow prior comparable run");
      assert.notEqual(thirdRun.targetId, firstRun.targetId, "expected different target text to create a new comparable target");
      assert.equal(benchmarkTrustRun.provenance, "benchmark");
      assert.deepEqual(firstRun.environmentFingerprint, {
        gitHead: null,
        schemaSnapshotId: null,
        schemaFingerprint: null,
        indexRunId: indexRun.runId,
      });
      assert.equal(firstRun.target.identity.kind, "file_target");
      assert.equal(benchmarkTrustRun.target.identity.kind, "table_target");
      assert.equal(benchmarkTrustRun.target.identity.schemaName, "public");
      assert.equal(benchmarkTrustRun.target.identity.tableName, "events");

      assert.equal(freeFormFirstRun.target.identity.kind, "fallback_target");
      assert.equal(freeFormSecondRun.target.identity.kind, "fallback_target");
      assert.equal(freeFormFirstRun.targetId, freeFormSecondRun.targetId, "expected fallback identity to normalize comparable free-form queries");

      const target = store.getAnswerComparableTarget(firstRun.targetId);
      assert.ok(target, "expected comparable target lookup by id");
      assert.equal(target.comparisonKey, firstRun.target.comparisonKey);
      assert.equal(target.normalizedQueryText, "src/app.tsx");

      const latest = store.getLatestComparableAnswerRun({
        projectId: "project-trust",
        queryKind: "trace_file",
        queryText: "trace_file(src/app.tsx)",
      });
      assert.ok(latest, "expected latest comparable run lookup to work");
      assert.equal(latest.traceId, second.queryId);

      const comparableHistory = store.listComparableAnswerRuns({ traceId: second.queryId });
      assert.equal(comparableHistory.length, 2, "expected exactly two comparable runs");
      assert.deepEqual(
        comparableHistory.map((run) => run.traceId),
        [second.queryId, first.queryId],
      );

      const sameHistoryByLocator = store.listComparableAnswerRuns({
        projectId: "project-trust",
        queryKind: "trace_file",
        queryText: "trace_file(src/app.tsx)",
      });
      assert.deepEqual(
        sameHistoryByLocator.map((run) => run.traceId),
        [second.queryId, first.queryId],
      );
    } finally {
      store.close();
    }

    const legacyProjectRoot = path.join(tmp, "legacy-project");
    mkdirSync(legacyProjectRoot, { recursive: true });
    const legacyDbPath = resolveProjectDbPath(legacyProjectRoot);
    const legacyDb = openSqliteDatabase(legacyDbPath, [...LEGACY_PROJECT_MIGRATIONS]);

    try {
      const legacy = makeResult({
        traceId: "legacy_trace_1",
        projectId: "legacy-project",
        queryKind: "trace_table",
        queryText: "trace_table(public.events)",
      });
      const legacySecond = makeResult({
        traceId: "legacy_trace_2",
        projectId: "legacy-project",
        queryKind: "trace_table",
        queryText: " trace_table( public.events ) ",
      });
      legacyDb.prepare(`
        INSERT INTO answer_traces(
          trace_id,
          query_kind,
          query_text,
          tier_used,
          evidence_status,
          support_level,
          answer_confidence,
          packet_json,
          answer_markdown,
          created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacy.queryId,
        legacy.queryKind,
        legacy.packet.queryText,
        legacy.tierUsed,
        legacy.evidenceStatus,
        legacy.supportLevel,
        legacy.answerConfidence ?? null,
        JSON.stringify(legacy.packet),
        legacy.answer ?? null,
        "2026-04-18T00:00:00.000Z",
      );
      legacyDb.prepare(`
        INSERT INTO answer_traces(
          trace_id,
          query_kind,
          query_text,
          tier_used,
          evidence_status,
          support_level,
          answer_confidence,
          packet_json,
          answer_markdown,
          created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacySecond.queryId,
        legacySecond.queryKind,
        legacySecond.packet.queryText,
        legacySecond.tierUsed,
        legacySecond.evidenceStatus,
        legacySecond.supportLevel,
        legacySecond.answerConfidence ?? null,
        JSON.stringify(legacySecond.packet),
        legacySecond.answer ?? null,
        "2026-04-18T00:01:00.000Z",
      );
    } finally {
      legacyDb.close();
    }

    const reopenedLegacyStore = openProjectStore({ projectRoot: legacyProjectRoot });
    try {
      const legacyRun = reopenedLegacyStore.getAnswerTrustRun("legacy_trace_1");
      const legacySecondRun = reopenedLegacyStore.getAnswerTrustRun("legacy_trace_2");
      assert.ok(legacyRun, "expected legacy answer trace to backfill into trust history");
      assert.ok(legacySecondRun, "expected second legacy answer trace to backfill into trust history");
      assert.equal(legacyRun.target.normalizedQueryText, "public.events");
      assert.equal(legacySecondRun.target.normalizedQueryText, "public.events");
      assert.ok(legacyRun.rawPacketHash.length > 0, "expected legacy backfill to persist raw packet hash");
      assert.deepEqual(legacyRun.environmentFingerprint, {
        gitHead: null,
        schemaSnapshotId: null,
        schemaFingerprint: null,
        indexRunId: null,
      });
      assert.equal(legacyRun.target.identity.kind, "table_target");
      assert.equal(legacySecondRun.previousTraceId, "legacy_trace_1");
      assert.equal(legacySecondRun.previousPacketHash, legacyRun.packetHash);

      const latestLegacy = reopenedLegacyStore.getLatestComparableAnswerRun({
        projectId: "legacy-project",
        queryKind: "trace_table",
        queryText: "trace_table(public.events)",
      });
      assert.ok(latestLegacy, "expected legacy comparable lookup to succeed after backfill");
      assert.equal(latestLegacy.traceId, "legacy_trace_2");
    } finally {
      reopenedLegacyStore.close();
    }

    console.log("trust-backbone: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
