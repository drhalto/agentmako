import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { computeAstMatchFingerprint } from "../../packages/tools/src/finding-acks/fingerprint.ts";

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mako-finding-acks-"));
  try {
    const projectStore = openProjectStore({ projectRoot: tmpRoot });
    try {
      // --- AST fingerprint is deterministic and location-aware ---

      const fp1 = computeAstMatchFingerprint({
        filePath: "src/foo.tsx",
        lineStart: 10,
        lineEnd: 10,
        columnStart: 2,
        columnEnd: 20,
        matchText: "new Date()",
      });
      const fp2 = computeAstMatchFingerprint({
        filePath: "src/foo.tsx",
        lineStart: 10,
        lineEnd: 10,
        columnStart: 2,
        columnEnd: 20,
        matchText: "new Date()",
      });
      assert.equal(fp1, fp2, "identical input must yield identical fingerprint");

      const fp3 = computeAstMatchFingerprint({
        filePath: "src/foo.tsx",
        lineStart: 12,
        lineEnd: 12,
        columnStart: 2,
        columnEnd: 20,
        matchText: "new Date()",
      });
      assert.notEqual(
        fp1,
        fp3,
        "identical snippet at a different line must yield a distinct fingerprint",
      );

      const fp4 = computeAstMatchFingerprint({
        filePath: "src/bar.tsx",
        lineStart: 10,
        lineEnd: 10,
        columnStart: 2,
        columnEnd: 20,
        matchText: "new Date()",
      });
      assert.notEqual(
        fp1,
        fp4,
        "identical snippet in a different file must yield a distinct fingerprint",
      );

      // --- Insert + query round-trip ---

      const ack = projectStore.insertFindingAck({
        projectId: "proj_fixture",
        category: "hydration-check",
        subjectKind: "ast_match",
        filePath: "src/foo.tsx",
        fingerprint: fp1,
        status: "ignored",
        reason: "server component; new Date() is evaluated on the server",
        snippet: "new Date()",
        sourceToolName: "ast_find_pattern",
      });
      assert.ok(ack.ackId.startsWith("ack_"), "ackId auto-generated with prefix");
      assert.ok(ack.acknowledgedAt.length > 0, "acknowledgedAt auto-generated");
      assert.equal(ack.status, "ignored");
      assert.equal(ack.subjectKind, "ast_match");
      assert.equal(ack.filePath, "src/foo.tsx");

      const queried = projectStore.queryFindingAcks({ projectId: "proj_fixture" });
      assert.equal(queried.length, 1);
      assert.equal(queried[0]?.ackId, ack.ackId);

      // --- Batch fingerprint loader filters by (projectId, category) ---

      const fingerprints = projectStore.loadAcknowledgedFingerprints(
        "proj_fixture",
        "hydration-check",
      );
      assert.ok(
        fingerprints instanceof Set,
        "loadAcknowledgedFingerprints returns a Set",
      );
      assert.ok(fingerprints.has(fp1), "Set contains the acked fingerprint");
      assert.equal(fingerprints.size, 1);

      const otherCategory = projectStore.loadAcknowledgedFingerprints(
        "proj_fixture",
        "no-console",
      );
      assert.equal(otherCategory.size, 0, "unrelated category loads empty");

      // --- Status-agnostic filter: both ignored and accepted dedupe ---

      projectStore.insertFindingAck({
        projectId: "proj_fixture",
        category: "no-console",
        subjectKind: "diagnostic_issue",
        fingerprint: "mbid_console_log_1",
        status: "accepted",
        reason: "intentional debug log under dev flag",
        sourceToolName: "lint_files",
        sourceRuleId: "no-console",
        sourceIdentityMatchBasedId: "mbid_console_log_1",
      });

      const consoleFps = projectStore.loadAcknowledgedFingerprints(
        "proj_fixture",
        "no-console",
      );
      assert.ok(
        consoleFps.has("mbid_console_log_1"),
        "accepted-status ack still contributes to filter set",
      );

      // --- Duplicate (category, fingerprint) inserts both persist; loader dedupes ---

      projectStore.insertFindingAck({
        projectId: "proj_fixture",
        category: "no-console",
        subjectKind: "diagnostic_issue",
        fingerprint: "mbid_console_log_1",
        status: "ignored",
        reason: "superseded review decision",
      });
      const after = projectStore.queryFindingAcks({
        projectId: "proj_fixture",
        category: "no-console",
      });
      assert.equal(after.length, 2, "duplicate ack rows persist (append-only)");

      const consoleFpsDedup = projectStore.loadAcknowledgedFingerprints(
        "proj_fixture",
        "no-console",
      );
      assert.equal(
        consoleFpsDedup.size,
        1,
        "loadAcknowledgedFingerprints dedupes across duplicate rows",
      );

      // --- Aggregates ---

      const byCategory = projectStore.aggregateFindingAcksByCategory({
        projectId: "proj_fixture",
      });
      assert.equal(byCategory.length, 2);
      const noConsole = byCategory.find((row) => row.category === "no-console");
      assert.ok(noConsole, "no-console aggregate present");
      assert.equal(noConsole?.totalRows, 2);
      assert.equal(noConsole?.distinctFingerprints, 1);

      const byStatus = projectStore.aggregateFindingAcksByStatus({
        projectId: "proj_fixture",
      });
      const statusMap = new Map(byStatus.map((r) => [r.status, r.count]));
      assert.equal(statusMap.get("ignored"), 2);
      assert.equal(statusMap.get("accepted"), 1);

      const bySubject = projectStore.aggregateFindingAcksBySubjectKind({
        projectId: "proj_fixture",
      });
      const subjectMap = new Map(bySubject.map((r) => [r.subjectKind, r.count]));
      assert.equal(subjectMap.get("ast_match"), 1);
      assert.equal(subjectMap.get("diagnostic_issue"), 2);

      // --- ORDER BY acknowledged_at DESC ---

      const ordered = projectStore.queryFindingAcks({ projectId: "proj_fixture" });
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1]!;
        const cur = ordered[i]!;
        assert.ok(
          prev.acknowledgedAt >= cur.acknowledgedAt,
          `results must be ordered by acknowledgedAt DESC (index ${i})`,
        );
      }

      // --- Append-only triggers block UPDATE + DELETE ---

      assert.throws(
        () =>
          projectStore.db
            .prepare(`UPDATE finding_acks SET status = 'accepted' WHERE ack_id = ?`)
            .run(ack.ackId),
        /append-only/,
        "UPDATE on finding_acks must be blocked",
      );

      assert.throws(
        () =>
          projectStore.db
            .prepare(`DELETE FROM finding_acks WHERE ack_id = ?`)
            .run(ack.ackId),
        /append-only/,
        "DELETE on finding_acks must be blocked",
      );

      // --- Write-path schema validation rejects empty / unknown values ---

      assert.throws(
        () =>
          projectStore.insertFindingAck({
            projectId: "proj_fixture",
            category: "",
            subjectKind: "ast_match",
            fingerprint: "fp_x",
            status: "ignored",
            reason: "x",
          }),
        /category/,
        "empty category must be rejected at the store boundary",
      );

      assert.throws(
        () =>
          projectStore.insertFindingAck({
            projectId: "proj_fixture",
            category: "x",
            subjectKind: "ast_match",
            fingerprint: "fp_x",
            status: "ignored",
            reason: "",
          }),
        /reason/,
        "empty reason must be rejected at the store boundary",
      );

      assert.throws(
        () =>
          projectStore.insertFindingAck({
            projectId: "proj_fixture",
            category: "x",
            // @ts-expect-error intentional bad value
            subjectKind: "not_a_kind",
            fingerprint: "fp_x",
            status: "ignored",
            reason: "x",
          }),
        "unknown subjectKind must be rejected",
      );

      assert.throws(
        () =>
          projectStore.insertFindingAck({
            projectId: "proj_fixture",
            category: "x",
            subjectKind: "ast_match",
            fingerprint: "fp_x",
            // @ts-expect-error intentional bad value
            status: "mystery",
            reason: "x",
          }),
        "unknown status must be rejected",
      );

      console.log("finding-acks-storage: PASS");
    } finally {
      projectStore.close();
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
