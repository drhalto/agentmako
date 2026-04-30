import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TraceFileToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import {
  compileRulePacks,
  discoverRulePacks,
  loadRulePackFromFile,
  runRulePacks,
} from "../../packages/tools/src/rule-packs/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "rule-packs-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "lib", "auth"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "admin", "users", "roles"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "admin", "users", "compliant"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "rule-packs-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const targetContent = [
    "export function processUserRequest(userId: string) {",
    "  sensitiveQuery(userId);",
    "  auditLog(userId);",
    "}",
  ].join("\n");
  const helperContent = [
    "export async function enforceAccountStatus(userId: string) {",
    "  return { userId };",
    "}",
  ].join("\n");
  const bypassContent = [
    "export async function updateRole(supabase: any, userId: string) {",
    "  const profile = await supabase.from(\"profiles\").select(\"id\").eq(\"id\", userId);",
    "  return profile;",
    "}",
  ].join("\n");
  const compliantContent = [
    "import { enforceAccountStatus } from \"../../../../../lib/auth/dal\";",
    "export async function updateRole(supabase: any, userId: string) {",
    "  await enforceAccountStatus(userId);",
    "  return supabase.from(\"profiles\").select(\"id\");",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "target.ts"), `${targetContent}\n`);
  writeFileSync(path.join(projectRoot, "lib", "auth", "dal.ts"), `${helperContent}\n`);
  writeFileSync(
    path.join(projectRoot, "app", "api", "admin", "users", "roles", "route.ts"),
    `${bypassContent}\n`,
  );
  writeFileSync(
    path.join(projectRoot, "app", "api", "admin", "users", "compliant", "route.ts"),
    `${compliantContent}\n`,
  );

  const rulePack = [
    "name: smoke-custom-rules",
    "rules:",
    "  - id: smoke.sensitive_query_user_scope",
    "    category: identity_key_mismatch",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts, tsx]",
    "    message: 'Sensitive query receives `{{capture.ARG}}` — confirm it is tenant-scoped'",
    "    pattern: sensitiveQuery($ARG)",
    "    metadata:",
    "      cwe: 'CWE-284'",
    "      reference: 'internal://security/tenant-scope-guide'",
    "  - id: smoke.auth.helper_bypass",
    "    category: rpc_helper_reuse",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts]",
    "    message: 'Direct profiles query should go through enforceAccountStatus'",
    "    pattern: $CLIENT.from(\"profiles\")",
    "    canonicalHelper:",
    "      symbol: enforceAccountStatus",
    "      path: lib/auth/dal.ts",
  ].join("\n");

  writeFileSync(path.join(projectRoot, ".mako", "rules", "security.yaml"), `${rulePack}\n`);

  const projectStore = openProjectStore({ projectRoot });
  try {
    projectStore.saveProjectProfile({
      name: "rule-packs-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });

    projectStore.replaceIndexSnapshot({
      files: [
        {
          path: "lib/target.ts",
          sha256: "target",
          language: "typescript",
          sizeBytes: targetContent.length,
          lineCount: targetContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/target.ts",
              lineStart: 1,
              lineEnd: targetContent.split("\n").length,
              content: targetContent,
            },
          ],
          symbols: [
            {
              name: "processUserRequest",
              kind: "function",
              exportName: "processUserRequest",
              lineStart: 1,
              lineEnd: 4,
              signatureText: "export function processUserRequest(userId: string)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "lib/auth/dal.ts",
          sha256: "helper",
          language: "typescript",
          sizeBytes: helperContent.length,
          lineCount: helperContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/auth/dal.ts",
              lineStart: 1,
              lineEnd: helperContent.split("\n").length,
              content: helperContent,
            },
          ],
          symbols: [
            {
              name: "enforceAccountStatus",
              kind: "function",
              exportName: "enforceAccountStatus",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export async function enforceAccountStatus(userId: string)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "app/api/admin/users/roles/route.ts",
          sha256: "bypass",
          language: "typescript",
          sizeBytes: bypassContent.length,
          lineCount: bypassContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/api/admin/users/roles/route.ts",
              lineStart: 1,
              lineEnd: bypassContent.split("\n").length,
              content: bypassContent,
            },
          ],
          symbols: [],
          imports: [],
          routes: [],
        },
        {
          path: "app/api/admin/users/compliant/route.ts",
          sha256: "compliant",
          language: "typescript",
          sizeBytes: compliantContent.length,
          lineCount: compliantContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/api/admin/users/compliant/route.ts",
              lineStart: 1,
              lineEnd: compliantContent.split("\n").length,
              content: compliantContent,
            },
          ],
          symbols: [],
          imports: [
            {
              specifier: "../../../../../lib/auth/dal",
              targetPath: "lib/auth/dal.ts",
              importKind: "named",
              isTypeOnly: false,
            },
          ],
          routes: [],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
    const indexRun = projectStore.beginIndexRun("rule-packs-smoke");
    projectStore.finishIndexRun(indexRun.runId, "succeeded");
  } finally {
    projectStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-rule-packs-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    // --- 1. Direct loader: parse the seeded pack ---
    const direct = loadRulePackFromFile(
      path.join(projectRoot, ".mako", "rules", "security.yaml"),
    );
    assert.equal(direct.pack.name, "smoke-custom-rules");
    assert.equal(direct.pack.rules.length, 2);
    assert.equal(direct.pack.rules[0]!.id, "smoke.sensitive_query_user_scope");
    assert.equal(direct.pack.rules[0]!.pattern, "sensitiveQuery($ARG)");
    assert.deepEqual(direct.pack.rules[1]!.canonicalHelper, {
      symbol: "enforceAccountStatus",
      path: "lib/auth/dal.ts",
      mode: "absent_in_consumer",
    });

    // --- 2. Discovery walks .mako/rules ---
    const discovered = discoverRulePacks(projectRoot);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]!.sourcePath, direct.sourcePath);

    // --- 3. Compile resolves defaults (confidence stays confirmed) ---
    const compiled = compileRulePacks(discovered);
    assert.equal(compiled.length, 2);
    assert.equal(compiled[0]!.confidence, "confirmed");
    assert.deepEqual(compiled[0]!.languages, ["ts", "tsx"]);
    assert.deepEqual(compiled[0]!.patterns, ["sensitiveQuery($ARG)"]);
    const helperBypassRule = compiled.find((rule) => rule.id === "smoke.auth.helper_bypass");
    assert.ok(helperBypassRule, "expected helper-bypass rule to compile");
    assert.deepEqual(helperBypassRule.canonicalHelper, {
      symbol: "enforceAccountStatus",
      path: "lib/auth/dal.ts",
      mode: "absent_in_consumer",
    });

    // --- 4. Direct evaluator emits issues for matches ---
    const projectStore = openProjectStore({ projectRoot });
    try {
      const directIssues = runRulePacks({
        rules: compiled,
        projectStore,
        focusFiles: ["lib/target.ts"],
      });
      assert.equal(directIssues.length, 1, "expected exactly one match in lib/target.ts");
      const directIssue = directIssues[0]!;
      assert.equal(directIssue.code, "smoke.sensitive_query_user_scope");
      assert.equal(directIssue.severity, "high");
      assert.equal(directIssue.category, "identity_key_mismatch");
      assert.equal(directIssue.confidence, "confirmed");
      assert.equal(directIssue.path, "lib/target.ts");
      assert.equal(directIssue.line, 2);
      assert.equal(
        directIssue.message,
        "Sensitive query receives `userId` — confirm it is tenant-scoped",
        "capture interpolation should substitute {{capture.ARG}} with the matched text",
      );
      assert.equal((directIssue.metadata as { cwe?: unknown } | undefined)?.cwe, "CWE-284");
      assert.equal(
        (directIssue.metadata as { ruleSource?: unknown } | undefined)?.ruleSource,
        direct.sourcePath,
      );

      const crossFileIssues = runRulePacks({
        rules: compiled,
        projectStore,
        focusFiles: [
          "app/api/admin/users/roles/route.ts",
          "app/api/admin/users/compliant/route.ts",
          "lib/auth/dal.ts",
        ],
      });
      assert.equal(crossFileIssues.length, 1, "expected only the helper-bypass consumer to fire");
      const crossFileIssue = crossFileIssues[0]!;
      assert.equal(crossFileIssue.code, "smoke.auth.helper_bypass");
      assert.equal(crossFileIssue.category, "rpc_helper_reuse");
      assert.equal(crossFileIssue.path, "app/api/admin/users/roles/route.ts");
      assert.equal(crossFileIssue.producerPath, "lib/auth/dal.ts");
      assert.equal(crossFileIssue.consumerPath, "app/api/admin/users/roles/route.ts");
      assert.ok(
        crossFileIssue.evidenceRefs.includes("lib/auth/dal.ts"),
        "producer path should be included in evidence refs",
      );
      assert.deepEqual(
        (crossFileIssue.metadata as { canonicalHelper?: unknown } | undefined)?.canonicalHelper,
        {
          symbol: "enforceAccountStatus",
          path: "lib/auth/dal.ts",
          mode: "absent_in_consumer",
        },
      );
    } finally {
      projectStore.close();
    }

    // --- 5. End-to-end via trace_file: the custom rule fires alongside built-ins ---
    const output = (await invokeTool("trace_file", {
      projectId,
      file: "lib/target.ts",
    })) as TraceFileToolOutput;
    const result = output.result;
    const codes = (result.diagnostics ?? []).map((issue) => issue.code);
    assert.ok(
      codes.includes("smoke.sensitive_query_user_scope"),
      "expected custom rule to appear in trace_file diagnostics",
    );

    // --- 6. Invalid YAML throws a clean RulePackLoadError ---
    const badPath = path.join(projectRoot, ".mako", "rules", "bad.yaml");
    writeFileSync(
      badPath,
      [
        "rules:",
        "  - id: bad.missing_pattern",
        "    category: trust",
        "    severity: medium",
        "    message: 'no pattern declared'",
      ].join("\n"),
    );
    try {
      loadRulePackFromFile(badPath);
      assert.fail("expected schema validation error for pattern-less rule");
    } catch (error) {
      assert.match(
        (error as Error).message,
        /rule must declare a `pattern` or a non-empty `patterns` array/,
      );
    }

    console.log("rule-packs: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
