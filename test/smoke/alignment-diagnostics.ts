import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CrossSearchToolOutput,
  FileFindingsToolOutput,
  ProjectFindingsToolOutput,
  TraceFileToolOutput,
} from "../../packages/contracts/src/index.ts";
import { buildSurfaceIssue } from "../../packages/tools/src/diagnostics/common.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  const fixtureSizeBytes = (content: string) => Buffer.byteLength(`${content}\n`, "utf8");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "alignment-diagnostics-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "components", "dashboard"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "dashboard", "admin"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "dashboard"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "alignment-diagnostics-smoke",
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
    "  events?: { title: string } | null;",
    "}",
    "",
    "export async function loadVisibleEvents() {",
    "  return supabase.rpc(\"get_visible_events\");",
    "}",
    "",
    "export async function loadAdminDashboard(tenantId: string): Promise<InstructorDashboardData> {",
    "  const rows = await supabase.from(\"event_registrations\").select(\"id, event:event_id(title)\");",
    "  return {",
    "    attendanceWindow: null,",
    "    events: rows.data?.[0]?.events ?? null,",
    "  } as InstructorDashboardData;",
    "}",
  ].join("\n");

  const authContent = [
    "export async function getCurrentUserRole() {",
    "  return \"admin\";",
    "}",
  ].join("\n");

  const auditContent = [
    "export function recordAudit(tenantAuditLog: string) {",
    "  return tenantAuditLog;",
    "}",
  ].join("\n");

  const summaryContent = [
    "export interface DashboardSummary {",
    "  events: string[];",
    "}",
  ].join("\n");

  const layoutContent = [
    "export default async function DashboardLayout({ profile, children }: { profile: { role: string }; children: unknown }) {",
    "  if (profile.role !== \"admin\") {",
    "    return null;",
    "  }",
    "  return children;",
    "}",
  ].join("\n");

  const adminPageContent = [
    "import { loadAdminDashboard } from \"../../../lib/dashboard\";",
    "import { getCurrentUserRole } from \"../../../lib/auth\";",
    "import { recordAudit } from \"../../../lib/audit\";",
    "",
    "export default async function AdminPage({ profile }: { profile: { id: string } }) {",
    "  const role = await getCurrentUserRole();",
    "  if (role !== \"admin\") {",
    "    return null;",
    "  }",
    "  recordAudit(profile.id);",
    "  return loadAdminDashboard(profile.id);",
    "}",
  ].join("\n");

  const clientContent = [
    "export const supabase = {",
    "  from() { return { select() { return null; } }; },",
    "  rpc() { return null; },",
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
  writeFileSync(path.join(projectRoot, "lib", "auth.ts"), `${authContent}\n`);
  writeFileSync(path.join(projectRoot, "lib", "audit.ts"), `${auditContent}\n`);
  writeFileSync(path.join(projectRoot, "lib", "client.ts"), `${clientContent}\n`);
  writeFileSync(path.join(projectRoot, "components", "dashboard", "summary.tsx"), `${summaryContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "dashboard", "layout.tsx"), `${layoutContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "dashboard", "admin", "page.tsx"), `${adminPageContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), `${eventsRouteContent}\n`);

  const projectStore = openProjectStore({ projectRoot });
  try {
    projectStore.saveProjectProfile({
      name: "alignment-diagnostics-smoke",
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
          sha256: "dashboard",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(dashboardContent),
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
              name: "InstructorDashboardData",
              kind: "interface",
              exportName: "InstructorDashboardData",
              lineStart: 1,
              lineEnd: 4,
              signatureText: "export interface InstructorDashboardData",
            },
            {
              name: "loadVisibleEvents",
              kind: "function",
              exportName: "loadVisibleEvents",
              lineStart: 6,
              lineEnd: 8,
              signatureText: "export async function loadVisibleEvents()",
            },
            {
              name: "loadAdminDashboard",
              kind: "function",
              exportName: "loadAdminDashboard",
              lineStart: 10,
              lineEnd: 16,
              signatureText: "export async function loadAdminDashboard(tenantId: string)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "lib/auth.ts",
          sha256: "auth",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(authContent),
          lineCount: authContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/auth.ts",
              lineStart: 1,
              lineEnd: authContent.split("\n").length,
              content: authContent,
            },
          ],
          symbols: [
            {
              name: "getCurrentUserRole",
              kind: "function",
              exportName: "getCurrentUserRole",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export async function getCurrentUserRole()",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "lib/audit.ts",
          sha256: "audit",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(auditContent),
          lineCount: auditContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "lib/audit.ts",
              lineStart: 1,
              lineEnd: auditContent.split("\n").length,
              content: auditContent,
            },
          ],
          symbols: [
            {
              name: "recordAudit",
              kind: "function",
              exportName: "recordAudit",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export function recordAudit(tenantAuditLog: string)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "lib/client.ts",
          sha256: "client",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(clientContent),
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
          path: "components/dashboard/summary.tsx",
          sha256: "dashboard-summary",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(summaryContent),
          lineCount: summaryContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "components/dashboard/summary.tsx",
              lineStart: 1,
              lineEnd: summaryContent.split("\n").length,
              content: summaryContent,
            },
          ],
          symbols: [
            {
              name: "DashboardSummary",
              kind: "interface",
              exportName: "DashboardSummary",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export interface DashboardSummary",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "app/dashboard/layout.tsx",
          sha256: "layout",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(layoutContent),
          lineCount: layoutContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/dashboard/layout.tsx",
              lineStart: 1,
              lineEnd: layoutContent.split("\n").length,
              content: layoutContent,
            },
          ],
          symbols: [
            {
              name: "DashboardLayout",
              kind: "function",
              exportName: "default",
              lineStart: 1,
              lineEnd: 6,
              signatureText: "export default async function DashboardLayout(...)",
            },
          ],
          imports: [],
          routes: [],
        },
        {
          path: "app/dashboard/admin/page.tsx",
          sha256: "admin-page",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(adminPageContent),
          lineCount: adminPageContent.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/dashboard/admin/page.tsx",
              lineStart: 1,
              lineEnd: adminPageContent.split("\n").length,
              content: adminPageContent,
            },
          ],
          symbols: [
            {
              name: "AdminPage",
              kind: "function",
              exportName: "default",
              lineStart: 4,
              lineEnd: 10,
              signatureText: "export default async function AdminPage(...)",
            },
          ],
          imports: [
            {
              targetPath: "lib/dashboard.ts",
              specifier: "../../../lib/dashboard",
              importKind: "relative",
              isTypeOnly: false,
              line: 1,
            },
            {
              targetPath: "lib/auth.ts",
              specifier: "../../../lib/auth",
              importKind: "relative",
              isTypeOnly: false,
              line: 2,
            },
            {
              targetPath: "lib/audit.ts",
              specifier: "../../../lib/audit",
              importKind: "relative",
              isTypeOnly: false,
              line: 3,
            },
          ],
          routes: [],
        },
        {
          path: "app/api/events/route.ts",
          sha256: "events-route",
          language: "typescript",
          sizeBytes: fixtureSizeBytes(eventsRouteContent),
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
          symbols: [
            {
              name: "GET",
              kind: "function",
              exportName: "GET",
              lineStart: 3,
              lineEnd: 5,
              signatureText: "export async function GET()",
            },
          ],
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
    const indexRun = projectStore.beginIndexRun("smoke");
    projectStore.finishIndexRun(indexRun.runId, "succeeded");
  } finally {
    projectStore.close();
  }
}

function diagnosticCodes(result: { diagnostics?: Array<{ code: string }> | undefined }): string[] {
  return result.diagnostics?.map((item) => item.code).sort((left, right) => left.localeCompare(right)) ?? [];
}

function assertVolatileFreshnessDoesNotAffectIssueIdentity(): void {
  const first = buildSurfaceIssue({
    category: "rpc_helper_reuse",
    code: "reuse.helper_bypass",
    message: "same finding",
    severity: "high",
    confidence: "confirmed",
    path: "app/api/events/route.ts",
    line: 4,
    evidenceRefs: ["app/api/events/route.ts:L4"],
    matchKey: {
      producerPath: "lib/dashboard.ts",
      consumerPath: "app/api/events/route.ts",
      freshness: {
        state: "fresh",
        checkedAt: "2026-04-30T01:00:00.000Z",
      },
    },
    codeFingerprint: {
      directQuery: "events",
      checkedAt: "2026-04-30T01:00:00.000Z",
    },
  });
  const second = buildSurfaceIssue({
    category: "rpc_helper_reuse",
    code: "reuse.helper_bypass",
    message: "same finding",
    severity: "high",
    confidence: "confirmed",
    path: "app/api/events/route.ts",
    line: 4,
    evidenceRefs: ["app/api/events/route.ts:L4"],
    matchKey: {
      producerPath: "lib/dashboard.ts",
      consumerPath: "app/api/events/route.ts",
      freshness: {
        state: "fresh",
        checkedAt: "2026-04-30T02:00:00.000Z",
      },
    },
    codeFingerprint: {
      directQuery: "events",
      checkedAt: "2026-04-30T02:00:00.000Z",
    },
  });

  assert.equal(first.identity.matchBasedId, second.identity.matchBasedId);
  assert.equal(first.identity.codeHash, second.identity.codeHash);
}

function findDiagnosticIdentity(
  output: CrossSearchToolOutput,
  code: string,
): string {
  const diagnostic = output.result.diagnostics?.find((issue) => issue.code === code);
  assert.ok(diagnostic, `expected ${code} diagnostic`);
  return diagnostic.identity.matchBasedId;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-alignment-diagnostics-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    assertVolatileFreshnessDoesNotAffectIssueIdentity();

    const dashboardOutput = (await invokeTool("trace_file", {
      projectId,
      file: "lib/dashboard.ts",
    })) as TraceFileToolOutput;
    const dashboardCodes = diagnosticCodes(dashboardOutput.result);
    assert.ok(dashboardOutput.result.trust, "expected trust metadata on trace_file output");
    assert.ok(dashboardOutput.result.ranking, "expected ranking metadata on trace_file output");
    assert.ok(dashboardCodes.includes("producer.field_shape_drift"));
    assert.ok(dashboardCodes.includes("sql.relation_alias_drift"));
    assert.equal(dashboardCodes.filter((code) => code === "sql.relation_alias_drift").length, 1);
    assert.ok(dashboardOutput.result.ranking?.reasons.some((reason) => reason.code === "rank.diagnostic_penalty"));
    assert.equal(dashboardOutput.result.ranking?.deEmphasized, false);

    const adminPageOutput = (await invokeTool("trace_file", {
      projectId,
      file: "app/dashboard/admin/page.tsx",
    })) as TraceFileToolOutput;
    const adminCodes = diagnosticCodes(adminPageOutput.result);
    assert.ok(adminCodes.includes("identity.boundary_mismatch"));
    assert.equal(adminCodes.filter((code) => code === "identity.boundary_mismatch").length, 1);
    assert.ok(adminCodes.includes("auth.role_source_drift"));

    const routeOutput = (await invokeTool("trace_file", {
      projectId,
      file: "app/api/events/route.ts",
    })) as TraceFileToolOutput;
    const routeCodes = diagnosticCodes(routeOutput.result);
    assert.ok(routeCodes.includes("reuse.helper_bypass"));

    const eventSearchOutput = (await invokeTool("cross_search", {
      projectId,
      term: "events",
      verbosity: "full",
    })) as CrossSearchToolOutput;
    const eventSearchCodes = diagnosticCodes(eventSearchOutput.result);
    assert.ok(
      eventSearchCodes.includes("reuse.helper_bypass"),
      "cross_search should surface helper reuse diagnostics for returned evidence",
    );

    const routeFindings = (await invokeTool("file_findings", {
      projectId,
      filePath: "app/api/events/route.ts",
      freshnessPolicy: "allow_stale_labeled",
    })) as FileFindingsToolOutput;
    assert.ok(
      routeFindings.findings.some((finding) =>
        finding.source === "cross_search" &&
        finding.ruleId === "reuse.helper_bypass"
      ),
      "file_findings should include persisted cross_search helper reuse diagnostics",
    );

    const crossSearchOutput = (await invokeTool("cross_search", {
      projectId,
      term: "loadAdminDashboard",
      verbosity: "full",
    })) as CrossSearchToolOutput;
    const crossSearchCodes = diagnosticCodes(crossSearchOutput.result);
    assert.ok(
      crossSearchCodes.includes("identity.boundary_mismatch"),
      "cross_search should surface alignment diagnostics for returned evidence",
    );
    const repeatedCrossSearchOutput = (await invokeTool("cross_search", {
      projectId,
      term: "loadAdminDashboard",
      verbosity: "full",
    })) as CrossSearchToolOutput;
    assert.equal(
      findDiagnosticIdentity(crossSearchOutput, "identity.boundary_mismatch"),
      findDiagnosticIdentity(repeatedCrossSearchOutput, "identity.boundary_mismatch"),
      "cross_search alignment diagnostic identity should be stable across reruns",
    );

    const adminFindings = (await invokeTool("file_findings", {
      projectId,
      filePath: "app/dashboard/admin/page.tsx",
      freshnessPolicy: "allow_stale_labeled",
    })) as FileFindingsToolOutput;
    assert.ok(
      adminFindings.findings.some((finding) =>
        finding.source === "cross_search" &&
        finding.ruleId === "identity.boundary_mismatch"
      ),
      "file_findings should include persisted cross_search diagnostics",
    );

    const ruleFilteredFindings = (await invokeTool("project_findings", {
      projectId,
      source: "identity.boundary_mismatch",
      freshnessPolicy: "allow_stale_labeled",
    })) as ProjectFindingsToolOutput;
    assert.ok(
      ruleFilteredFindings.findings.some((finding) =>
        finding.ruleId === "identity.boundary_mismatch"
      ),
      "project_findings source filter should match rule IDs as well as producer sources",
    );

    console.log("alignment-diagnostics: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
