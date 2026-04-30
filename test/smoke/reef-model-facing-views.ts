import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  EvidenceConfidenceToolOutput,
  EvidenceConflictsToolOutput,
  ContextPacketToolOutput,
  FilePreflightToolOutput,
  JsonObject,
  ProjectConventionsToolOutput,
  ProjectFact,
  ProjectFinding,
  ProjectOpenLoopsToolOutput,
  ReefInspectToolOutput,
  ReefRuleDescriptor,
  ReefScoutToolOutput,
  RuleMemoryToolOutput,
  ToolBatchToolOutput,
  VerificationStateToolOutput,
} from "../../packages/contracts/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { readReefOperations } from "../../services/indexer/src/reef-operation-log.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

function now(): string {
  return new Date().toISOString();
}

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-model-views-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  const seeded = await seedReefProject({ projectRoot });
  const globalStore = openGlobalStore();
  const toolService = createToolService();
  try {
    globalStore.saveProject({
      projectId: seeded.projectId,
      displayName: "reef-model-facing-views-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });

    const routePath = "src/routes/auth.ts";
    const subject = { kind: "file" as const, path: routePath };
    const subjectFingerprint = seeded.store.computeReefSubjectFingerprint(subject);
    const fresh = { state: "fresh" as const, checkedAt: now(), reason: "fixture fresh" };
    const stale = { state: "stale" as const, checkedAt: now(), reason: "fixture stale indexed snapshot" };

    seeded.store.saveProjectProfile({
      name: "reef-model-facing-views-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "supabase",
      srcRoot: ".",
      entryPoints: [routePath],
      pathAliases: {},
      middlewareFiles: ["middleware.ts"],
      serverOnlyModules: ["src/server/session.ts"],
      authGuardSymbols: ["verifySession"],
      supportLevel: "native",
      detectedAt: now(),
    });
    const indexRun = seeded.store.beginIndexRun("smoke_seed");
    seeded.store.replaceIndexSnapshot({
      files: [
        {
          path: routePath,
          sha256: "auth-route",
          language: "typescript",
          sizeBytes: 220,
          lineCount: 9,
          chunks: [{
            chunkKind: "file",
            name: routePath,
            lineStart: 1,
            lineEnd: 9,
            content: "export async function verifySession() { return true; }\nexport async function GET() { return verifySession(); }",
          }],
          symbols: [
            {
              name: "verifySession",
              kind: "function",
              exportName: "verifySession",
              lineStart: 1,
              lineEnd: 1,
              signatureText: "export async function verifySession()",
            },
            {
              name: "GET",
              kind: "function",
              exportName: "GET",
              lineStart: 2,
              lineEnd: 2,
              signatureText: "export async function GET()",
            },
          ],
          imports: [],
          routes: [{
            routeKey: "GET /auth",
            framework: "next",
            pattern: "/auth",
            method: "GET",
            handlerName: "GET",
            isApi: true,
          }],
        },
        {
          path: "src/generated/database.types.ts",
          sha256: "generated-db-types",
          language: "typescript",
          sizeBytes: 80,
          lineCount: 2,
          isGenerated: true,
          chunks: [{
            chunkKind: "file",
            name: "src/generated/database.types.ts",
            lineStart: 1,
            lineEnd: 2,
            content: "export type Database = { public: unknown };",
          }],
          symbols: [],
          imports: [],
          routes: [],
        },
      ],
      schemaObjects: [{
        objectKey: "table:public.user_profiles",
        objectType: "table",
        schemaName: "public",
        objectName: "user_profiles",
      }],
      schemaUsages: [{
        objectKey: "table:public.user_profiles",
        filePath: routePath,
        usageKind: "read",
        line: 2,
        excerpt: "verifySession reads user_profiles",
      }],
    });
    seeded.store.finishIndexRun(indexRun.runId, "succeeded");

    const makeFact = (args: {
      kind: string;
      source: string;
      overlay: ProjectFact["overlay"];
      confidence: number;
      freshness: ProjectFact["freshness"];
      data: JsonObject;
    }): ProjectFact => ({
      projectId: seeded.projectId,
      kind: args.kind,
      subject,
      subjectFingerprint,
      overlay: args.overlay,
      source: args.source,
      confidence: args.confidence,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: args.kind,
        subjectFingerprint,
        overlay: args.overlay,
        source: args.source,
        data: args.data,
      }),
      freshness: args.freshness,
      provenance: {
        source: args.source,
        capturedAt: now(),
        dependencies: [{ kind: "file", path: routePath }],
      },
      data: args.data,
    });

    const schemaSubject = { kind: "schema_object" as const, schemaName: "public", objectName: "user_profiles" };
    const schemaSubjectFingerprint = seeded.store.computeReefSubjectFingerprint(schemaSubject);
    const schemaFact: ProjectFact = {
      projectId: seeded.projectId,
      kind: "db_rls_policy",
      subject: schemaSubject,
      subjectFingerprint: schemaSubjectFingerprint,
      overlay: "working_tree",
      source: "db_reef_refresh",
      confidence: 0.99,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: "db_rls_policy",
        subjectFingerprint: schemaSubjectFingerprint,
        overlay: "working_tree",
        source: "db_reef_refresh",
        data: {
          table: "user_profiles",
          note: "auth route verifySession dashboard flow policy",
        },
      }),
      freshness: fresh,
      provenance: {
        source: "db_reef_refresh",
        capturedAt: now(),
        dependencies: [{ kind: "schema_snapshot", source: "fixture" }],
      },
      data: {
        table: "user_profiles",
        note: "auth route verifySession dashboard flow policy",
      },
    };

    const facts = [
      schemaFact,
      makeFact({
        kind: "file_snapshot",
        source: "working_tree_overlay",
        overlay: "working_tree",
        confidence: 1,
        freshness: fresh,
        data: {
          state: "present",
          sizeBytes: 120,
          lineCount: 12,
          sha256: "fixture-live",
          lastModifiedAt: now(),
        },
      }),
      makeFact({
        kind: "file_snapshot",
        source: "indexer",
        overlay: "indexed",
        confidence: 0.8,
        freshness: stale,
        data: {
          state: "present",
          sizeBytes: 100,
          lineCount: 8,
          sha256: "fixture-indexed",
          lastModifiedAt: secondsAgo(600),
        },
      }),
      makeFact({
        kind: "convention:auth_guard",
        source: "reef_rule:conventions",
        overlay: "working_tree",
        confidence: 0.9,
        freshness: fresh,
        data: {
          conventionKind: "auth_guard",
          title: "Routes require verifySession",
          status: "accepted",
          reason: "fixture convention",
        },
      }),
      makeFact({
        kind: "evidence_conflict",
        source: "agent_feedback:incorrect_evidence",
        overlay: "working_tree",
        confidence: 0.95,
        freshness: fresh,
        data: {
          conflictKind: "phantom_line",
          reason: "AST result pointed at a line that live text search could not confirm",
        },
      }),
    ];
    seeded.store.upsertReefFacts(facts);

    const authRule: ReefRuleDescriptor = {
      id: "auth.unprotected_route",
      version: "1.0.0",
      source: "reef_rule:auth.unprotected_route",
      sourceNamespace: "reef_rule",
      type: "problem",
      severity: "error",
      title: "Unprotected route",
      description: "Route files must call verifySession before returning private data.",
      factKinds: ["route_auth_signal"],
      dependsOnFactKinds: ["route_auth_signal"],
      tags: ["auth", "route"],
      enabledByDefault: true,
    };
    const conflictRule: ReefRuleDescriptor = {
      id: "evidence.phantom_line",
      version: "1.0.0",
      source: "agent_feedback:incorrect_evidence",
      sourceNamespace: "agent_feedback",
      type: "problem",
      severity: "warning",
      title: "Incorrect evidence",
      description: "A prior evidence result was contradicted by live verification.",
      factKinds: ["evidence_conflict"],
      tags: ["conflict", "phantom"],
      enabledByDefault: true,
    };
    seeded.store.saveReefRuleDescriptors([authRule, conflictRule]);

    const authFindingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: authRule.source,
      ruleId: authRule.id,
      subjectFingerprint,
      message: "UNPROTECTED: src/routes/auth.ts - no auth guard detected",
    });
    const conflictFindingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: conflictRule.source,
      ruleId: conflictRule.id,
      subjectFingerprint,
      message: "phantom evidence for src/routes/auth.ts",
    });
    const resolvedFindingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: "reef_rule:resolved.fixture",
      ruleId: "resolved.fixture",
      subjectFingerprint,
      message: "resolved fixture finding",
    });
    const findings: ProjectFinding[] = [
      {
        projectId: seeded.projectId,
        fingerprint: authFindingFingerprint,
        source: authRule.source,
        subjectFingerprint,
        overlay: "working_tree",
        severity: "error",
        status: "active",
        filePath: routePath,
        line: 8,
        ruleId: authRule.id,
        freshness: fresh,
        capturedAt: now(),
        message: "UNPROTECTED: src/routes/auth.ts - no auth guard detected",
        factFingerprints: [facts[2].fingerprint],
      },
      {
        projectId: seeded.projectId,
        fingerprint: conflictFindingFingerprint,
        source: conflictRule.source,
        subjectFingerprint,
        overlay: "working_tree",
        severity: "warning",
        status: "active",
        filePath: routePath,
        line: 30,
        ruleId: conflictRule.id,
        freshness: fresh,
        capturedAt: now(),
        message: "phantom evidence for src/routes/auth.ts",
        factFingerprints: [facts[3].fingerprint],
      },
      {
        projectId: seeded.projectId,
        fingerprint: resolvedFindingFingerprint,
        source: "reef_rule:resolved.fixture",
        subjectFingerprint,
        overlay: "working_tree",
        severity: "info",
        status: "resolved",
        filePath: routePath,
        line: 2,
        ruleId: "resolved.fixture",
        freshness: fresh,
        capturedAt: now(),
        message: "resolved fixture finding",
        factFingerprints: [],
      },
    ];
    for (const [source, group] of groupBy(findings, (finding) => finding.source)) {
      seeded.store.replaceReefFindingsForSource({
        projectId: seeded.projectId,
        source,
        overlay: "working_tree",
        findings: group,
      });
    }
    seeded.store.insertFindingAck({
      projectId: seeded.projectId,
      category: "reef:auth",
      subjectKind: "diagnostic_issue",
      filePath: routePath,
      fingerprint: authFindingFingerprint,
      status: "accepted",
      reason: "fixture acknowledgement",
      sourceToolName: "project_findings",
      sourceRuleId: authRule.id,
    });

    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "eslint",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: secondsAgo(120),
      finishedAt: secondsAgo(110),
      durationMs: 20,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture eslint",
      cwd: projectRoot,
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "typescript",
      overlay: "working_tree",
      status: "ran_with_error",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 15,
      checkedFileCount: 1,
      findingCount: 1,
      persistedFindingCount: 1,
      command: "fixture tsc",
      cwd: projectRoot,
      errorText: "fixture typecheck failure",
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "lint_files",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: secondsAgo(120),
      finishedAt: secondsAgo(110),
      durationMs: 20,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture stale lint",
      cwd: projectRoot,
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "lint_files",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 20,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture fresh lint",
      cwd: projectRoot,
    });

    const scout = await toolService.callTool("reef_scout", {
      projectId: seeded.projectId,
      query: "auth route verifySession",
      focusFiles: [routePath],
    }) as ReefScoutToolOutput;
    assert.equal(scout.toolName, "reef_scout");
    assert.ok(scout.candidates.some((candidate) => candidate.filePath === routePath));
    assert.notEqual(
      scout.candidates[0]?.id,
      `fact:${schemaFact.fingerprint}`,
      "app-flow scout queries should not rank schema facts ahead of app evidence just because text overlaps",
    );
    assertReefExecution(scout.reefExecution, "reef_scout", "allow_stale_labeled");

    const schemaScout = await toolService.callTool("reef_scout", {
      projectId: seeded.projectId,
      query: "rls policy table user_profiles",
    }) as ReefScoutToolOutput;
    assert.equal(
      schemaScout.candidates[0]?.id,
      `fact:${schemaFact.fingerprint}`,
      "schema scout queries should still rank schema evidence first",
    );

    const inspect = await toolService.callTool("reef_inspect", {
      projectId: seeded.projectId,
      filePath: routePath,
    }) as ReefInspectToolOutput;
    assert.equal(inspect.toolName, "reef_inspect");
    assert.ok(inspect.summary.factCount >= 4);
    assert.ok(inspect.summary.findingCount >= 2);
    assertReefExecution(inspect.reefExecution, "reef_inspect", "allow_stale_labeled");

    const loops = await toolService.callTool("project_open_loops", {
      projectId: seeded.projectId,
      cacheStalenessMs: 30_000,
    }) as ProjectOpenLoopsToolOutput;
    assert.ok(loops.loops.some((loop) => loop.kind === "stale_fact"));
    assert.ok(loops.loops.some((loop) => loop.kind === "failed_diagnostic_run"));
    assert.ok(loops.loops.some((loop) => loop.kind === "active_finding"));
    assert.ok(!loops.loops.some((loop) => loop.kind === "stale_diagnostic_run" && loop.source === "lint_files"));
    assertReefExecution(loops.reefExecution, "project_open_loops", "allow_stale_labeled");
    const loopsWithStringLimit = await toolService.callTool("project_open_loops", {
      projectId: seeded.projectId,
      limit: "3",
      cacheStalenessMs: "30000",
    }) as ProjectOpenLoopsToolOutput;
    assert.equal(loopsWithStringLimit.loops.length, 3);
    const loopsWithAcknowledged = await toolService.callTool("project_open_loops", {
      projectId: seeded.projectId,
      includeAcknowledged: true,
      cacheStalenessMs: 30_000,
    }) as ProjectOpenLoopsToolOutput;
    assert.ok(loopsWithAcknowledged.loops.some((loop) => loop.metadata?.status === "acknowledged"));
    assert.ok(!loopsWithAcknowledged.loops.some((loop) => loop.id === `finding:${resolvedFindingFingerprint}`));

    const verification = await toolService.callTool("verification_state", {
      projectId: seeded.projectId,
      cacheStalenessMs: 30_000,
    }) as VerificationStateToolOutput;
    assert.equal(verification.toolName, "verification_state");
    assert.equal(verification.status, "failed");
    assert.ok(verification.changedFiles.some((file) => file.filePath === routePath && file.staleForSources.includes("eslint")));
    assertReefExecution(verification.reefExecution, "verification_state", "allow_stale_labeled");

    const preflight = await toolService.callTool("file_preflight", {
      projectId: seeded.projectId,
      filePath: routePath,
      cacheStalenessMs: 30_000,
    }) as FilePreflightToolOutput;
    assert.equal(preflight.toolName, "file_preflight");
    assert.equal(preflight.filePath, routePath);
    assert.ok(preflight.findings.some((finding) => finding.status === "active" && finding.fingerprint === conflictFindingFingerprint));
    assert.ok(preflight.findings.some((finding) => finding.status === "acknowledged" && finding.fingerprint === authFindingFingerprint));
    assert.ok(preflight.diagnostics.staleSources.includes("eslint"));
    assert.ok(preflight.diagnostics.failedSources.includes("typescript"));
    assert.ok(preflight.diagnostics.changedFile?.staleForSources.includes("eslint"));
    assert.ok(preflight.diagnostics.recentRuns.length >= 3);
    assert.ok(preflight.conventions.some((convention) => convention.kind === "auth_guard"));
    assert.equal(preflight.ackHistory[0]?.fingerprint, authFindingFingerprint);
    assert.equal(preflight.summary.ackCount, 1);
    assertReefExecution(preflight.reefExecution, "file_preflight", "allow_stale_labeled");

    const scopedSource = "scoped_fixture";
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: scopedSource,
      overlay: "working_tree",
      status: "succeeded",
      startedAt: secondsAgo(120),
      finishedAt: secondsAgo(110),
      durationMs: 20,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture scoped route run",
      cwd: projectRoot,
      metadata: {
        requestedFiles: [routePath],
        requestedFileCount: 1,
      },
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: scopedSource,
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 10,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture scoped unrelated run",
      cwd: projectRoot,
      metadata: {
        requestedFiles: ["src/generated/database.types.ts"],
        requestedFileCount: 1,
      },
    });
    const scopedVerification = await toolService.callTool("verification_state", {
      projectId: seeded.projectId,
      files: [routePath],
      sources: [scopedSource],
      cacheStalenessMs: 30_000,
    }) as VerificationStateToolOutput;
    assert.equal(scopedVerification.status, "stale");
    assert.ok(scopedVerification.changedFiles.some((file) =>
      file.filePath === routePath && file.staleForSources.includes(scopedSource)
    ));
    assert.ok((JSON.stringify(scopedVerification.recentRuns[0]?.metadata?.requestedFiles) ?? "").includes(routePath));

    const scopedPreflight = await toolService.callTool("file_preflight", {
      projectId: seeded.projectId,
      filePath: routePath,
      sources: [scopedSource],
      cacheStalenessMs: 30_000,
    }) as FilePreflightToolOutput;
    assert.equal(scopedPreflight.diagnostics.status, "stale");
    assert.ok(scopedPreflight.diagnostics.changedFile?.staleForSources.includes(scopedSource));
    assert.ok((JSON.stringify(scopedPreflight.diagnostics.recentRuns[0]?.metadata?.requestedFiles) ?? "").includes(routePath));

    const conventions = await toolService.callTool("project_conventions", {
      projectId: seeded.projectId,
      kind: "auth_guard",
    }) as ProjectConventionsToolOutput;
    assert.ok(conventions.conventions.some((convention) => convention.status === "accepted"));

    const allConventions = await toolService.callTool("project_conventions", {
      projectId: seeded.projectId,
    }) as ProjectConventionsToolOutput;
    assert.ok(allConventions.conventions.some((convention) =>
      convention.source === "project_profile" &&
      convention.kind === "auth_guard" &&
      convention.evidence.includes("verifySession")
    ));
    assert.ok(allConventions.conventions.some((convention) =>
      convention.source === "index:routes" &&
      convention.kind === "route_pattern"
    ));
    assert.ok(allConventions.conventions.some((convention) =>
      convention.source === "index:files" &&
      convention.kind === "generated_path"
    ));
    assert.ok(allConventions.conventions.some((convention) =>
      convention.source === "index:schema_usage" &&
      convention.kind === "schema_pattern"
    ));

    const contextPacket = await toolService.callTool("context_packet", {
      projectId: seeded.projectId,
      request: "fix auth route verifySession",
      focusFiles: [routePath],
    }) as ContextPacketToolOutput;
    assertReefExecution(contextPacket.reefExecution, "context_packet", "allow_stale_labeled");
    assert.ok(contextPacket.limits.providersRun.includes("reef_convention"));
    assert.ok([...contextPacket.primaryContext, ...contextPacket.relatedContext].some((candidate) =>
      candidate.source === "reef_convention"
      && candidate.metadata?.conventionKind === "auth_guard"
      && candidate.metadata?.evidenceConfidenceLabel === "verified_live",
    ));

    const ruleMemory = await toolService.callTool("rule_memory", {
      projectId: seeded.projectId,
      sourceNamespace: "reef_rule",
    }) as RuleMemoryToolOutput;
    const authMemory = ruleMemory.entries.find((entry) => entry.ruleId === authRule.id);
    assert.ok(authMemory);
    assert.equal(authMemory.counts.acknowledged, 1);

    const confidence = await toolService.callTool("evidence_confidence", {
      projectId: seeded.projectId,
      filePath: routePath,
    }) as EvidenceConfidenceToolOutput;
    assert.ok(confidence.items.some((item) => item.confidenceLabel === "verified_live"));
    assert.ok(confidence.items.some((item) => item.confidenceLabel === "stale_indexed"));
    assert.ok(confidence.items.some((item) => item.confidenceLabel === "contradicted"));
    assertReefExecution(confidence.reefExecution, "evidence_confidence", "allow_stale_labeled");

    const conflicts = await toolService.callTool("evidence_conflicts", {
      projectId: seeded.projectId,
      filePath: routePath,
    }) as EvidenceConflictsToolOutput;
    assert.ok(conflicts.conflicts.some((conflict) => conflict.conflictKind === "stale_indexed_evidence"));
    assert.ok(conflicts.conflicts.some((conflict) => conflict.conflictKind === "phantom_line"));
    assertReefExecution(conflicts.reefExecution, "evidence_conflicts", "allow_stale_labeled");

    const batch = await toolService.callTool("tool_batch", {
      projectId: seeded.projectId,
      ops: [
        { label: "scout", tool: "reef_scout", args: { query: "auth route" }, resultMode: "summary" },
        { label: "loops", tool: "project_open_loops", resultMode: "summary" },
        { label: "confidence", tool: "evidence_confidence", args: { filePath: routePath }, resultMode: "summary" },
      ],
      verbosity: "compact",
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.executedOps, 3);
    assert.equal(batch.summary.succeededOps, 3);

    const queryPathOperations = await readReefOperations({}, {
      projectId: seeded.projectId,
      kind: "query_path",
      limit: 50,
    });
    const loggedTools = new Set(queryPathOperations.map((operation) => operation.data?.toolName));
    assert.ok(loggedTools.has("reef_scout"));
    assert.ok(loggedTools.has("reef_inspect"));
    assert.ok(loggedTools.has("context_packet"));
    assert.ok(loggedTools.has("project_open_loops"));
    assert.ok(loggedTools.has("verification_state"));
    assert.ok(loggedTools.has("file_preflight"));
    assert.ok(loggedTools.has("evidence_confidence"));
    assert.ok(loggedTools.has("evidence_conflicts"));

    console.log("reef-model-facing-views: PASS");
  } finally {
    toolService.close();
    globalStore.close();
    await seeded.cleanup();
    if (priorStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = priorStateHome;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function assertReefExecution(
  reefExecution: ReefScoutToolOutput["reefExecution"],
  toolName: string,
  freshnessPolicy: ReefScoutToolOutput["reefExecution"]["freshnessPolicy"],
): void {
  assert.equal(reefExecution.reefMode, "auto", `${toolName} should use auto mode by default`);
  assert.equal(reefExecution.serviceMode, "direct", `${toolName} should report direct store read without a service`);
  assert.equal(reefExecution.queryPath, "reef_materialized_view");
  assert.equal(reefExecution.freshnessPolicy, freshnessPolicy);
  assert.equal(reefExecution.fallback?.used, true);
  assert.ok(reefExecution.operationId, `${toolName} should record a query-path operation`);
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
