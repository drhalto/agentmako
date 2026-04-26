import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectFact, ProjectFinding, ReefRuleDescriptor } from "../../packages/contracts/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

function now(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-store-foundation-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  const seeded = await seedReefProject({ projectRoot });
  try {
    const subject = { kind: "file" as const, path: "src/secure-route.ts" };
    const subjectFingerprint = seeded.store.computeReefSubjectFingerprint(subject);
    const freshness = { state: "fresh" as const, checkedAt: now(), reason: "fixture" };
    const provenance = {
      source: "reef_rule:auth.unprotected_route",
      capturedAt: now(),
      dependencies: [{ kind: "file" as const, path: subject.path }],
    };
    const baseFact = {
      projectId: seeded.projectId,
      kind: "route_auth_signal",
      subject,
      subjectFingerprint,
      overlay: "working_tree" as const,
      source: "reef_rule:auth.unprotected_route",
      confidence: 0.92,
      freshness,
      provenance,
    };
    const factOne: ProjectFact = {
      ...baseFact,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: baseFact.kind,
        subjectFingerprint,
        overlay: baseFact.overlay,
        source: baseFact.source,
        data: { guarded: false },
      }),
      data: { guarded: false },
    };
    const factTwo: ProjectFact = {
      ...baseFact,
      confidence: 0.99,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: baseFact.kind,
        subjectFingerprint,
        overlay: baseFact.overlay,
        source: baseFact.source,
        data: { guarded: true },
      }),
      data: { guarded: true },
    };

    seeded.store.upsertReefFacts([factOne]);
    seeded.store.upsertReefFacts([factTwo]);
    const facts = seeded.store.queryReefFacts({
      projectId: seeded.projectId,
      kind: "route_auth_signal",
    });
    assert.equal(facts.length, 1, "facts should replace by source/kind/subject instead of growing");
    assert.equal(facts[0]?.fingerprint, factTwo.fingerprint);
    assert.equal(facts[0]?.confidence, 0.99);
    assert.throws(
      () => seeded.store.upsertReefFacts([{ ...factTwo, overlay: "preview" }]),
      /preview.*cannot be persisted/,
      "preview overlay must stay in-memory only",
    );
    assert.throws(
      () =>
        seeded.store.upsertReefFacts([
          {
            ...factTwo,
            subject: { kind: "file", path: path.join(projectRoot, "src", "escape.ts") },
          },
        ]),
      /project-relative path/,
      "Reef facts must not persist absolute project paths",
    );

    const rule: ReefRuleDescriptor = {
      id: "auth.unprotected_route",
      version: "1.0.0",
      source: "reef_rule:auth.unprotected_route",
      sourceNamespace: "reef_rule",
      type: "problem",
      severity: "error",
      title: "Unprotected route",
      description: "Route has no detected auth guard.",
      docs: { body: "Routes that mutate private data need an auth guard." },
      factKinds: ["route_auth_signal"],
      dependsOnFactKinds: ["route_auth_signal"],
      fixable: false,
      tags: ["auth", "route"],
      enabledByDefault: true,
    };
    assert.deepEqual(seeded.store.listReefRuleDescriptors(), []);
    seeded.store.saveReefRuleDescriptors([rule]);
    assert.deepEqual(seeded.store.listReefRuleDescriptors(), [rule]);

    const findingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: rule.source,
      ruleId: rule.id,
      subjectFingerprint,
      message: "UNPROTECTED: src/secure-route.ts — no auth guard detected",
      evidenceRefs: [factTwo.fingerprint],
    });
    const finding: ProjectFinding = {
      projectId: seeded.projectId,
      fingerprint: findingFingerprint,
      source: rule.source,
      subjectFingerprint,
      overlay: "working_tree",
      severity: "error",
      status: "active",
      filePath: subject.path,
      line: 12,
      ruleId: rule.id,
      freshness,
      capturedAt: now(),
      message: "UNPROTECTED: src/secure-route.ts — no auth guard detected",
      factFingerprints: [factTwo.fingerprint],
    };
    seeded.store.replaceReefFindingsForSource({
      projectId: seeded.projectId,
      source: rule.source,
      overlay: "working_tree",
      findings: [finding],
    });

    const active = seeded.store.queryReefFindings({ projectId: seeded.projectId });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.status, "active");

    seeded.store.insertFindingAck({
      projectId: seeded.projectId,
      category: "reef:auth",
      subjectKind: "diagnostic_issue",
      filePath: subject.path,
      fingerprint: findingFingerprint,
      status: "accepted",
      reason: "fixture acknowledgement",
      sourceToolName: "project_findings",
      sourceRuleId: rule.id,
    });

    const acknowledged = seeded.store.queryReefFindings({
      projectId: seeded.projectId,
      status: "acknowledged",
    });
    assert.equal(acknowledged.length, 1);
    assert.equal(acknowledged[0]?.fingerprint, findingFingerprint);
    assert.equal(acknowledged[0]?.status, "acknowledged");
    assert.equal(
      seeded.store.queryReefFindings({ projectId: seeded.projectId, status: "active" }).length,
      0,
      "acknowledged active rows should not also appear as active",
    );

    seeded.store.replaceReefFindingsForSource({
      projectId: seeded.projectId,
      source: rule.source,
      overlay: "working_tree",
      subjectFingerprints: [subjectFingerprint],
      findings: [],
      reason: "fixture rerun cleared finding",
    });

    const resolved = seeded.store.queryReefFindings({
      projectId: seeded.projectId,
      includeResolved: true,
      status: "resolved",
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.fingerprint, findingFingerprint);
    assert.equal(resolved[0]?.status, "resolved");

    const fileFindings = seeded.store.queryReefFindings({
      projectId: seeded.projectId,
      filePath: subject.path,
      includeResolved: true,
    });
    assert.equal(fileFindings.length, 1);

    console.log("reef-store-foundation: PASS");
  } finally {
    await seeded.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
