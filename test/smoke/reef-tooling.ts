import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DiagnosticRefreshToolOutput,
  DbReefRefreshToolOutput,
  DbReviewCommentToolOutput,
  DbReviewCommentsToolOutput,
  FindingAckBatchToolOutput,
  ProjectFact,
  ProjectFactsToolOutput,
  ProjectFindingsToolOutput,
  ReefInstructionsToolOutput,
  ReefOverlayDiffToolOutput,
  ReefScoutToolOutput,
  RulePackValidateToolOutput,
  SchemaUsageToolOutput,
  ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS, ToolBatchInputSchema } from "../../packages/contracts/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

function now(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-tooling-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  writeFileSync(path.join(projectRoot, ".mako", "instructions.md"), "Baseline Mako instruction.\n", "utf8");
  writeFileSync(path.join(projectRoot, "AGENTS.md"), "Root agent instruction.\n", "utf8");
  writeFileSync(path.join(projectRoot, "src", "AGENTS.md"), "Source-scoped agent instruction.\n", "utf8");
  writeFileSync(path.join(projectRoot, "src", "index.ts"), "const value: string = 1;\n", "utf8");
  writeFileSync(path.join(projectRoot, ".mako", "rules", "smoke.yaml"), [
    "name: smoke-rules",
    "rules:",
    "  - id: smoke.no_console",
    "    category: trust",
    "    severity: medium",
    "    confidence: confirmed",
    "    languages: [ts]",
    "    message: Avoid console logging in committed code.",
    "    pattern: console.log($$$ARGS)",
    "",
  ].join("\n"), "utf8");
  writeFileSync(path.join(projectRoot, ".mako", "rules", "bad.yaml"), [
    "rules:",
    "  - id: smoke.bad_rule",
    "    category: trust",
    "    severity: medium",
    "    message: Missing pattern should fail validation.",
    "",
  ].join("\n"), "utf8");
  writeFileSync(path.join(projectRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  }, null, 2), "utf8");

  const seeded = await seedReefProject({ projectRoot });
  const globalStore = openGlobalStore();
  const toolService = createToolService();
  try {
    globalStore.saveProject({
      projectId: seeded.projectId,
      displayName: "reef-tooling-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
    seeded.store.saveProjectProfile({
      name: "reef-tooling-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "supabase",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: now(),
    });

    const subject = { kind: "file" as const, path: "src/index.ts" };
    const subjectFingerprint = seeded.store.computeReefSubjectFingerprint(subject);
    const makeFact = (args: {
      overlay: ProjectFact["overlay"];
      source: string;
      lineCount: number;
      sha256: string;
    }): ProjectFact => ({
      projectId: seeded.projectId,
      kind: "file_snapshot",
      subject,
      subjectFingerprint,
      overlay: args.overlay,
      source: args.source,
      confidence: 1,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: "file_snapshot",
        subjectFingerprint,
        overlay: args.overlay,
        source: args.source,
        data: { lineCount: args.lineCount, sha256: args.sha256 },
      }),
      freshness: {
        state: "fresh",
        checkedAt: now(),
        reason: "fixture",
      },
      provenance: {
        source: args.source,
        capturedAt: now(),
        dependencies: [{ kind: "file", path: subject.path }],
      },
      data: {
        state: "present",
        lineCount: args.lineCount,
        sha256: args.sha256,
      },
    });
    seeded.store.upsertReefFacts([
      makeFact({ overlay: "indexed", source: "indexer", lineCount: 1, sha256: "old" }),
      makeFact({ overlay: "working_tree", source: "working_tree_overlay", lineCount: 2, sha256: "new" }),
    ]);

    const diff = await toolService.callTool("reef_overlay_diff", {
      projectId: seeded.projectId,
      filePath: subject.path,
      kind: "file_snapshot",
    }) as ReefOverlayDiffToolOutput;
    assert.equal(diff.toolName, "reef_overlay_diff");
    assert.equal(diff.summary.changed, 1);
    assert.equal(diff.entries[0]?.status, "changed");
    assert.ok(diff.entries[0]?.changedDataKeys.includes("data.sha256"));
    assert.equal(diff.entries[0]?.leftFact, undefined);
    assert.equal(diff.entries[0]?.rightFact, undefined);

    const diffWithFacts = await toolService.callTool("reef_overlay_diff", {
      projectId: seeded.projectId,
      filePath: subject.path,
      kind: "file_snapshot",
      includeFacts: true,
    }) as ReefOverlayDiffToolOutput;
    assert.equal(diffWithFacts.entries[0]?.leftFact?.source, "indexer");
    assert.equal(diffWithFacts.entries[0]?.rightFact?.source, "working_tree_overlay");

    const instructions = await toolService.callTool("reef_instructions", {
      projectId: seeded.projectId,
      files: [subject.path],
    }) as ReefInstructionsToolOutput;
    assert.equal(instructions.toolName, "reef_instructions");
    assert.deepEqual(
      instructions.instructions.map((instruction) => instruction.path),
      [".mako/instructions.md", "AGENTS.md", "src/AGENTS.md"],
    );
    assert.equal(instructions.summary.derivedFactCount, 3);
    assert.ok(instructions.derivedFacts.every((fact) => fact.kind === "project_instruction"));

    const rulePacks = await toolService.callTool("rule_pack_validate", {
      projectId: seeded.projectId,
    }) as RulePackValidateToolOutput;
    assert.equal(rulePacks.toolName, "rule_pack_validate");
    assert.equal(rulePacks.summary.packCount, 2);
    assert.equal(rulePacks.summary.validPackCount, 1);
    assert.equal(rulePacks.summary.invalidPackCount, 1);
    assert.ok(rulePacks.rules.some((rule) => rule.id === "smoke.no_console"));
    assert.equal(rulePacks.rules.find((rule) => rule.id === "smoke.no_console")?.descriptor?.sourceNamespace, "rule_pack");

    const ackBatch = await toolService.callTool("finding_ack_batch", {
      projectId: seeded.projectId,
      category: "reef:smoke",
      subjectKind: "diagnostic_issue",
      reason: "fixture batch ack",
      rows: [
        { label: "one", fingerprint: "fingerprint-one", filePath: subject.path },
        { label: "two", fingerprint: "fingerprint-two", status: "accepted" },
      ],
    }) as FindingAckBatchToolOutput;
    assert.equal(ackBatch.toolName, "finding_ack_batch");
    assert.equal(ackBatch.summary.ackedRows, 2);
    assert.equal(ackBatch.summary.rejectedRows, 0);

    const diagnostic = await toolService.callTool("diagnostic_refresh", {
      projectId: seeded.projectId,
      sources: ["typescript"],
      files: [subject.path],
      maxFindings: 10,
      includeFindings: true,
    }) as DiagnosticRefreshToolOutput;
    assert.equal(diagnostic.toolName, "diagnostic_refresh");
    assert.equal(diagnostic.summary.executedSources, 1);
    assert.equal(diagnostic.results[0]?.source, "typescript");
    assert.equal(diagnostic.results[0]?.status, "succeeded");
    assert.ok(diagnostic.summary.totalFindings >= 1);
    assert.ok(diagnostic.findings?.some((finding) => finding.ruleId === "TS2322"));

    const schemaNow = now();
    seeded.store.saveSchemaSnapshot({
      snapshotId: `reef-db-${schemaNow}`,
      sourceMode: "repo_only",
      generatedAt: schemaNow,
      refreshedAt: schemaNow,
      fingerprint: "reef-db-smoke",
      freshnessStatus: "fresh",
      driftDetected: false,
      sources: [
        {
          kind: "sql_migration",
          path: "supabase/migrations/0001_init.sql",
          sha256: "fixture",
        },
      ],
      warnings: [],
      ir: {
        version: "1.0.0",
        schemas: {
          public: {
            tables: [
              {
                name: "users",
                schema: "public",
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 1 }],
                columns: [
                  {
                    name: "id",
                    dataType: "uuid",
                    nullable: false,
                    isPrimaryKey: true,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 2 }],
                  },
                  {
                    name: "team_id",
                    dataType: "uuid",
                    nullable: false,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 3 }],
                  },
                ],
                primaryKey: ["id"],
                indexes: [
                  {
                    name: "users_pkey",
                    unique: true,
                    primary: true,
                    columns: ["id"],
                  },
                  {
                    name: "idx_users_team_id",
                    unique: false,
                    primary: false,
                    columns: ["team_id"],
                  },
                ],
                foreignKeys: {
                  outbound: [
                    {
                      constraintName: "users_team_id_fkey",
                      columns: ["team_id"],
                      targetSchema: "public",
                      targetTable: "teams",
                      targetColumns: ["id"],
                      onUpdate: "NO ACTION",
                      onDelete: "CASCADE",
                    },
                  ],
                  inbound: [],
                },
                rls: {
                  rlsEnabled: true,
                  forceRls: false,
                  policies: [
                    {
                      name: "users_select_own_team",
                      mode: "PERMISSIVE",
                      command: "SELECT",
                      roles: ["authenticated"],
                      usingExpression: "team_id = auth.uid()",
                      withCheckExpression: null,
                    },
                  ],
                },
                triggers: [
                  {
                    name: "users_touch_updated_at",
                    enabled: true,
                    enabledMode: "O",
                    timing: "BEFORE",
                    events: ["UPDATE"],
                    bodyText: "EXECUTE FUNCTION touch_updated_at()",
                  },
                ],
              },
            ],
            views: [
              {
                name: "active_users",
                schema: "public",
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 40 }],
              },
            ],
            enums: [
              {
                name: "user_status",
                schema: "public",
                values: ["active", "disabled"],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 50 }],
              },
            ],
            rpcs: [
              {
                name: "touch_user",
                schema: "public",
                argTypes: ["uuid"],
                returnType: "void",
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_init.sql", line: 60 }],
                bodyText: "BEGIN UPDATE users SET team_id = team_id WHERE id = $1; END;",
              },
            ],
          },
        },
      },
    });

    const dbReef = await toolService.callTool("db_reef_refresh", {
      projectId: seeded.projectId,
      includeFacts: true,
      factsLimit: 500,
    }) as DbReefRefreshToolOutput;
    assert.equal(dbReef.toolName, "db_reef_refresh");
    assert.equal(dbReef.summary.tableCount, 1);
    assert.equal(dbReef.summary.columnCount, 2);
    assert.equal(dbReef.summary.indexCount, 2);
    assert.equal(dbReef.summary.foreignKeyCount, 1);
    assert.equal(dbReef.summary.rlsPolicyCount, 1);
    assert.equal(dbReef.summary.triggerCount, 1);
    assert.equal(dbReef.summary.enumCount, 1);
    assert.equal(dbReef.summary.rpcCount, 1);
    assert.ok(dbReef.summary.functionTableRefCount >= 1);
    assert.equal(dbReef.schemaFreshness.state, "fresh");
    assert.equal(dbReef.schemaFreshness.sourceFreshness, "fresh");
    assert.equal(dbReef.schemaFreshness.liveDbFreshness, "not_bound");
    assert.equal(dbReef.schemaFreshness.liveDbBound, false);
    assert.equal(dbReef.schemaFreshness.lastSnapshotAt, schemaNow);
    assert.equal(dbReef.factsTruncated, false);
    assert.ok(dbReef.facts?.some((fact) => fact.kind === "db_index" && fact.source === "db_reef_refresh"));
    assert.ok(dbReef.facts?.some((fact) => fact.provenance.metadata?.sourceFreshness === "fresh"));

    const snapshotOnlySchemaUsage = await toolService.callTool("schema_usage", {
      projectId: seeded.projectId,
      schema: "public",
      object: "active_users",
    }) as SchemaUsageToolOutput;
    assert.equal(snapshotOnlySchemaUsage.toolName, "schema_usage");
    assert.ok((snapshotOnlySchemaUsage.result.answer ?? "").includes("active_users"));

    const missingSchemaUsage = await toolService.answerQuestion(
      { projectId: seeded.projectId },
      "schema_usage",
      "public.user_roles",
    );
    assert.equal(missingSchemaUsage.evidenceStatus, "partial");
    assert.ok((missingSchemaUsage.answer ?? "").includes('No indexed schema object matched "public.user_roles"'));
    assert.ok(!(missingSchemaUsage.answer ?? "").includes("handle_new_user"));

    const cappedDbReef = await toolService.callTool("db_reef_refresh", {
      projectId: seeded.projectId,
      includeFacts: true,
      factsLimit: 2,
    }) as DbReefRefreshToolOutput;
    assert.equal(cappedDbReef.facts?.length, 2);
    assert.equal(cappedDbReef.factsTruncated, true);

    const dbIndexFacts = await toolService.callTool("project_facts", {
      projectId: seeded.projectId,
      source: "db_reef_refresh",
      kind: "db_index",
    }) as ProjectFactsToolOutput;
    assert.equal(dbIndexFacts.toolName, "project_facts");
    assert.equal(dbIndexFacts.totalReturned, 2);
    assert.ok(dbIndexFacts.facts.some((fact) => fact.data?.indexName === "idx_users_team_id"));

    const currentSchemaSnapshot = seeded.store.loadSchemaSnapshot();
    assert.ok(currentSchemaSnapshot);
    writeFileSync(path.join(projectRoot, ".mako", "project.json"), JSON.stringify({
      version: "2.0.0",
      projectId: seeded.projectId,
      root: ".",
      displayName: "reef-tooling-smoke",
      frameworks: ["unknown"],
      languages: ["typescript", "sql"],
      packageManager: "unknown",
      database: {
        kind: "supabase",
        mode: "live_refresh_enabled",
        schemaSources: [],
        generatedTypePaths: [],
        edgeFunctionPaths: [],
        liveBinding: {
          strategy: "env_var_ref",
          ref: "MAKO_REEF_TOOLING_DB_URL",
          enabled: true,
        },
      },
      indexing: {
        include: ["src"],
        exclude: [".mako", "node_modules"],
      },
      capabilities: {
        supportLevel: "best_effort",
        entryPoints: [],
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
      },
    }, null, 2), "utf8");
    const oldSnapshotAt = new Date(Date.now() - REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS - 1_000).toISOString();
    seeded.store.saveSchemaSnapshot({
      ...currentSchemaSnapshot,
      snapshotId: `reef-db-live-stale-${oldSnapshotAt}`,
      sourceMode: "live_refresh_enabled",
      generatedAt: oldSnapshotAt,
      refreshedAt: oldSnapshotAt,
      sources: [],
    });

    const staleLiveDbReef = await toolService.callTool("db_reef_refresh", {
      projectId: seeded.projectId,
      includeFacts: true,
      freshen: false,
    }) as DbReefRefreshToolOutput;
    assert.equal(staleLiveDbReef.schemaFreshness.state, "stale");
    assert.equal(staleLiveDbReef.schemaFreshness.sourceFreshness, "fresh");
    assert.equal(staleLiveDbReef.schemaFreshness.liveDbFreshness, "stale");
    assert.equal(staleLiveDbReef.schemaFreshness.liveDbBound, true);
    assert.equal(staleLiveDbReef.schemaFreshness.lastSnapshotAt, oldSnapshotAt);
    assert.equal(staleLiveDbReef.schemaFreshness.liveSnapshotMaxAgeMs, REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS);
    assert.ok((staleLiveDbReef.schemaFreshness.snapshotAgeMs ?? 0) > REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS);
    assert.ok(staleLiveDbReef.facts?.some((fact) => fact.freshness.state === "stale"));
    assert.ok(staleLiveDbReef.facts?.some((fact) => fact.provenance.metadata?.liveDbFreshness === "stale"));

    const staleSchemaProgrammatic = await toolService.callTool("diagnostic_refresh", {
      projectId: seeded.projectId,
      sources: ["programmatic_findings"],
      includeFindings: true,
    }) as DiagnosticRefreshToolOutput;
    assert.equal(staleSchemaProgrammatic.results[0]?.source, "programmatic_findings");
    assert.equal(staleSchemaProgrammatic.results[0]?.status, "succeeded");
    assert.ok(staleSchemaProgrammatic.findings?.some((finding) =>
      finding.ruleId === "schema_usage.stale_evidence" && finding.freshness.state === "stale"
    ));

    mkdirSync(path.join(projectRoot, "app", "api", "smoke"), { recursive: true });
    const routePath = path.join(projectRoot, "app", "api", "smoke", "route.ts");
    writeFileSync(routePath, [
      "export async function GET() {",
      "  await auth.getUser();",
      "  return Response.json({ ok: true });",
      "}",
      "",
    ].join("\n"), "utf8");
    const cleanProgrammatic = await toolService.callTool("diagnostic_refresh", {
      projectId: seeded.projectId,
      sources: ["programmatic_findings"],
      files: ["app/api/smoke/route.ts"],
      includeFindings: true,
    }) as DiagnosticRefreshToolOutput;
    assert.equal(cleanProgrammatic.results[0]?.totalFindings, 0);
    writeFileSync(routePath, [
      "export async function GET() {",
      "  return Response.json({ ok: true });",
      "}",
      "",
    ].join("\n"), "utf8");
    const routeProgrammatic = await toolService.callTool("diagnostic_refresh", {
      projectId: seeded.projectId,
      sources: ["programmatic_findings"],
      files: ["app/api/smoke/route.ts"],
      includeFindings: true,
    }) as DiagnosticRefreshToolOutput;
    assert.ok(routeProgrammatic.findings?.some((finding) => finding.ruleId === "git.unprotected_route"));
    const programmaticFindings = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
      source: "programmatic_findings",
    }) as ProjectFindingsToolOutput;
    assert.ok(programmaticFindings.findings.some((finding) =>
      finding.ruleId === "git.unprotected_route" && finding.filePath === "app/api/smoke/route.ts"
    ));

    const replicationComment = await toolService.callTool("db_review_comment", {
      projectId: seeded.projectId,
      objectType: "replication",
      objectName: "supabase_database_replication",
      category: "review",
      severity: "info",
      comment: "Supabase replication review note: check publication coverage before relying on realtime events.",
      tags: ["supabase", "replication"],
    }) as DbReviewCommentToolOutput;
    assert.equal(replicationComment.toolName, "db_review_comment");
    assert.equal(replicationComment.comment.target.objectType, "replication");
    assert.equal(replicationComment.comment.category, "review");
    assert.deepEqual(replicationComment.comment.tags, ["supabase", "replication"]);

    const replicationComments = await toolService.callTool("db_review_comments", {
      projectId: seeded.projectId,
      query: "replication",
      tag: "supabase",
    }) as DbReviewCommentsToolOutput;
    assert.equal(replicationComments.toolName, "db_review_comments");
    assert.equal(replicationComments.totalReturned, 1);
    assert.equal(replicationComments.comments[0]?.commentId, replicationComment.comment.commentId);

    const scoutReplication = await toolService.callTool("reef_scout", {
      projectId: seeded.projectId,
      query: "supabase replication realtime",
      limit: 5,
    }) as ReefScoutToolOutput;
    assert.ok(
      scoutReplication.candidates.some((candidate) =>
        candidate.id === `db_review_comment:${replicationComment.comment.commentId}`),
      "reef_scout should surface matching database review comments",
    );

    const batch = await toolService.callTool("tool_batch", {
      projectId: seeded.projectId,
      ops: [
        {
          label: "overlay",
          tool: "reef_overlay_diff",
          args: { filePath: subject.path, kind: "file_snapshot" },
          resultMode: "summary",
        },
        {
          label: "instructions",
          tool: "reef_instructions",
          args: { files: [subject.path] },
          resultMode: "summary",
        },
        {
          label: "rule-packs",
          tool: "rule_pack_validate",
          resultMode: "summary",
        },
        {
          label: "db-comments",
          tool: "db_review_comments",
          args: { query: "replication" },
          resultMode: "summary",
        },
      ],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.succeededOps, 4);
    assert.equal(batch.results[0]?.tool, "reef_overlay_diff");
    assert.equal(batch.results[1]?.tool, "reef_instructions");
    assert.equal(batch.results[2]?.tool, "rule_pack_validate");
    assert.equal(batch.results[3]?.tool, "db_review_comments");

    const mutationBatch = ToolBatchInputSchema.safeParse({
      projectId: seeded.projectId,
      ops: [{ label: "ack", tool: "finding_ack_batch", args: { rows: [] } }],
    });
    assert.equal(mutationBatch.success, false, "tool_batch schema should reject finding_ack_batch");

    console.log("reef-tooling: PASS");
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
