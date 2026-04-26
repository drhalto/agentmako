import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TraceFileToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { formatAnswerResultAsSarif, formatSurfaceIssuesAsSarif } from "../../packages/tools/src/sarif.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "sarif-output-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "sarif-output-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const dashboardContent = [
    "export interface InstructorDashboardData {",
    "  attendance_window: string | null;",
    "}",
    "",
    "export async function loadAdminDashboard(tenantId: string): Promise<InstructorDashboardData> {",
    "  const rows = await supabase.from(\"event_registrations\").select(\"id\");",
    "  return {",
    "    attendanceWindow: null,",
    "  } as InstructorDashboardData;",
    "}",
  ].join("\n");

  const clientContent = [
    "export const supabase = {",
    "  from() { return { select() { return null; } }; },",
    "};",
  ].join("\n");

  const eventsRouteContent = [
    "import { supabase } from \"../../../lib/client\";",
    "",
    "export async function GET() {",
    "  return supabase.from(\"events\").select(\"*\");",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "dashboard.ts"), `${dashboardContent}\n`);
  writeFileSync(path.join(projectRoot, "lib", "client.ts"), `${clientContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), `${eventsRouteContent}\n`);

  const projectStore = openProjectStore({ projectRoot });
  try {
    projectStore.saveProjectProfile({
      name: "sarif-output-smoke",
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
          path: "lib/dashboard.ts",
          sha256: "dash",
          language: "typescript",
          sizeBytes: dashboardContent.length,
          lineCount: dashboardContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/dashboard.ts",
              lineStart: 1,
              lineEnd: dashboardContent.split("\n").length,
              content: dashboardContent,
            },
          ],
          symbols: [
            {
              name: "loadAdminDashboard",
              kind: "function",
              exportName: "loadAdminDashboard",
              lineStart: 5,
              lineEnd: 10,
              signatureText: "export async function loadAdminDashboard(tenantId: string)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "lib/client.ts",
          sha256: "client",
          language: "typescript",
          sizeBytes: clientContent.length,
          lineCount: clientContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/client.ts",
              lineStart: 1,
              lineEnd: clientContent.split("\n").length,
              content: clientContent,
            },
          ],
          symbols: [],
          imports: [],
          routes: [],
        },
        {
          path: "app/api/events/route.ts",
          sha256: "route",
          language: "typescript",
          sizeBytes: eventsRouteContent.length,
          lineCount: eventsRouteContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/api/events/route.ts",
              lineStart: 1,
              lineEnd: eventsRouteContent.split("\n").length,
              content: eventsRouteContent,
            },
          ],
          symbols: [],
          imports: [
            {
              targetPath: "lib/client.ts",
              specifier: "../../../lib/client",
              importKind: "relative",
              isTypeOnly: false,
              line: 1,
            },
          ],
          routes: [
            {
              routeKey: "route:app/api/events/route.ts",
              framework: "next",
              pattern: "/api/events",
              method: "GET",
              handlerName: "GET",
              isApi: true,
            },
          ],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
    const indexRun = projectStore.beginIndexRun("sarif-smoke");
    projectStore.finishIndexRun(indexRun.runId, "succeeded");
  } finally {
    projectStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-sarif-output-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    // --- 1. End-to-end: trace_file against a file with a drift diagnostic ---
    const output = (await invokeTool("trace_file", {
      projectId,
      file: "lib/dashboard.ts",
    })) as TraceFileToolOutput;
    const result = output.result;

    assert.ok(result.diagnostics && result.diagnostics.length > 0, "expected at least one diagnostic for seeded drift");
    assert.ok(result.trust, "expected trust surface on seeded result");
    assert.ok(result.ranking, "expected ranking surface on seeded result");

    const sarif = formatAnswerResultAsSarif(result, {
      toolVersion: "0.1.0-smoke",
    });

    // --- 2. Top-level shape ---
    assert.equal(sarif.version, "2.1.0");
    assert.ok(sarif.$schema.includes("sarif-schema-2.1.0"));
    assert.equal(sarif.runs.length, 1);

    const run = sarif.runs[0]!;
    assert.equal(run.tool.driver.name, "mako-ai");
    assert.equal(run.tool.driver.version, "0.1.0-smoke");
    assert.ok(run.tool.driver.rules.length > 0, "expected at least one rule descriptor");
    assert.equal(run.invocations?.[0]?.executionSuccessful, true);

    // --- 3. Rules are deduped by id ---
    const ruleIds = run.tool.driver.rules.map((rule) => rule.id);
    assert.equal(new Set(ruleIds).size, ruleIds.length, "expected SARIF rules to be deduped by id");

    // --- 4. Each result references a valid rule index ---
    for (const sarifResult of run.results) {
      assert.ok(
        sarifResult.ruleIndex >= 0 && sarifResult.ruleIndex < run.tool.driver.rules.length,
        "ruleIndex must point at a valid rule",
      );
      assert.equal(run.tool.driver.rules[sarifResult.ruleIndex]!.id, sarifResult.ruleId);
    }

    // --- 5. partialFingerprints carry the identity triple ---
    for (const sarifResult of run.results) {
      const fp = sarifResult.partialFingerprints;
      assert.ok(typeof fp.matchBasedId === "string" && fp.matchBasedId.length > 0);
      assert.ok(typeof fp.codeHash === "string" && fp.codeHash.length > 0);
      assert.ok(typeof fp.patternHash === "string" && fp.patternHash.length > 0);
    }

    // --- 6. At least one result has a primary location with a real path ---
    const resultsWithLocation = run.results.filter((item) => (item.locations ?? []).length > 0);
    assert.ok(resultsWithLocation.length > 0, "expected at least one SARIF result with a location");

    // --- 7. Level mapping covers the severity range that's present ---
    const levels = new Set(run.results.map((item) => item.level));
    for (const level of levels) {
      assert.ok(
        ["note", "warning", "error"].includes(level),
        `unexpected SARIF level: ${level}`,
      );
    }

    // --- 8. Result-level properties carry trust context ---
    const firstResult = run.results[0]!;
    assert.equal(firstResult.properties?.queryKind, result.queryKind);
    assert.equal(firstResult.properties?.projectId, projectId);
    assert.ok(firstResult.properties?.trustState, "expected trustState in SARIF result properties");

    // --- 9. Standalone formatter: dedupe by identity when passed duplicates ---
    const duplicate = result.diagnostics![0]!;
    const dupeLog = formatSurfaceIssuesAsSarif([duplicate, duplicate, duplicate]);
    assert.equal(dupeLog.runs[0]!.results.length, 1, "standalone formatter dedupes repeated matchBasedId values");
    assert.equal(dupeLog.runs[0]!.tool.driver.rules.length, 1, "rule descriptors dedupe by code");

    // --- 10. JSON round-trip: log must serialize and reparse identically ---
    const roundTrip = JSON.parse(JSON.stringify(sarif));
    assert.equal(roundTrip.version, "2.1.0");
    assert.equal(roundTrip.runs[0].results.length, run.results.length);

    console.log("sarif-output: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
