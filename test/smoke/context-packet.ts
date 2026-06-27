import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  ContextPacketToolOutputSchema,
  type AuthPathToolOutput,
  type ContextPacketToolOutput,
  type ProjectFinding,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { TOOL_DEFINITIONS, invokeTool } from "../../packages/tools/src/registry.ts";

const TOOL_INPUT_SCHEMAS = new Map(TOOL_DEFINITIONS.map((definition) => [
  definition.name,
  definition.inputSchema,
]));

function assertExpandableToolsHaveValidArgs(packet: ContextPacketToolOutput, label: string): void {
  for (const tool of packet.expandableTools) {
    const schema = TOOL_INPUT_SCHEMAS.get(tool.toolName);
    assert.ok(schema, `${label}: expandable tool ${tool.toolName} should be registered`);
    const result = schema.safeParse(tool.suggestedArgs);
    assert.equal(
      result.success,
      true,
      `${label}: ${tool.toolName} suggestedArgs should satisfy its input schema${
        result.success ? "" : `: ${result.error.message}`
      }`,
    );
  }
}

function writeFixtureFile(projectRoot: string, relPath: string, content: string): string {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content}\n`);
  return fullPath;
}

function fileRecord(
  projectRoot: string,
  relPath: string,
  content: string,
  language: "typescript" | "tsx",
  symbols: Array<{ name: string; kind: string; exportName?: string; lineStart?: number; lineEnd?: number }>,
  imports: Array<{ targetPath: string; specifier: string }>,
  routes: Array<{ routeKey: string; pattern: string; method?: string; handlerName?: string; isApi?: boolean }> = [],
) {
  const fullPath = path.join(projectRoot, ...relPath.split("/"));
  const stat = statSync(fullPath);
  return {
    path: relPath,
    sha256: relPath,
    language,
    sizeBytes: Buffer.byteLength(`${content}\n`),
    lineCount: `${content}\n`.split("\n").length,
    lastModifiedAt: stat.mtime.toISOString(),
    chunks: [{
      chunkKind: "file" as const,
      name: relPath,
      lineStart: 1,
      lineEnd: content.split("\n").length,
      content,
    }],
    symbols,
    imports: imports.map((edge) => ({
      targetPath: edge.targetPath,
      specifier: edge.specifier,
      importKind: "static",
      isTypeOnly: false,
    })),
    routes: routes.map((route) => ({
      framework: "nextjs",
      ...route,
    })),
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "context-packet-smoke" }));

  const routeContent = [
    "import { getSession } from '../../../../lib/auth/session';",
    "export async function GET() {",
    "  const session = await getSession();",
    "  return Response.json({ user: session.user });",
    "}",
  ].join("\n");
  const sessionContent = [
    "import type { UserSession } from '../../types/auth';",
    "export async function getSession(): Promise<UserSession> {",
    "  return { user: { id: 'u1', role: 'admin' } };",
    "}",
  ].join("\n");
  const typeContent = [
    "export interface UserSession {",
    "  user: { id: string; role: string };",
    "}",
  ].join("\n");
  const loginContent = [
    "export function LoginButton() {",
    "  return <button>Login</button>;",
    "}",
  ].join("\n");
  const dashboardLayoutContent = [
    "export default async function DashboardLayout({ profile, children }: { profile: { role: string }; children: unknown }) {",
    "  if (profile.role !== 'admin') {",
    "    return null;",
    "  }",
    "  return children;",
    "}",
  ].join("\n");
  const adminEndorsementCreateContent = [
    "export function AdminEndorsementCreatePage() {",
    "  const roleCheck = 'admin endorsement create duplicate role check';",
    "  return <section>{roleCheck}</section>;",
    "}",
  ].join("\n");
  const instructorEndorsementCreateContent = [
    "export function InstructorEndorsementCreatePage() {",
    "  const roleCheck = 'instructor endorsement create duplicate role check';",
    "  return <section>{roleCheck}</section>;",
    "}",
  ].join("\n");
  const centralButtonContent = [
    "export function Button({ children }: { children: unknown }) {",
    "  return <button>{children}</button>;",
    "}",
  ].join("\n");
  const generatedButtonConsumers = Array.from({ length: 40 }, (_, index) => ({
    relPath: `app/generated/page-${index}.tsx`,
    symbolName: `GeneratedPage${index}`,
    content: [
      "import { Button } from '../../components/ui/button';",
      `export function GeneratedPage${index}() {`,
      `  return <Button>Generated ${index}</Button>;`,
      "}",
    ].join("\n"),
  }));

  writeFixtureFile(projectRoot, "app/api/auth/callback/route.ts", routeContent);
  writeFixtureFile(projectRoot, "app/dashboard/layout.tsx", dashboardLayoutContent);
  writeFixtureFile(projectRoot, "app/dashboard/admin/endorsements/create/client-page.tsx", adminEndorsementCreateContent);
  writeFixtureFile(projectRoot, "app/dashboard/instructor/endorsements/create/client-page.tsx", instructorEndorsementCreateContent);
  writeFixtureFile(projectRoot, "lib/auth/session.ts", sessionContent);
  writeFixtureFile(projectRoot, "types/auth.ts", typeContent);
  writeFixtureFile(projectRoot, "components/LoginButton.tsx", loginContent);
  writeFixtureFile(projectRoot, "components/ui/button.tsx", centralButtonContent);
  for (const consumer of generatedButtonConsumers) {
    writeFixtureFile(projectRoot, consumer.relPath, consumer.content);
  }
  writeFixtureFile(projectRoot, "AGENTS.md", "Auth changes must preserve session and user type contracts.");

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "context-packet-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "context-packet-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: ["app/api/auth/callback/route.ts"],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: ["getSession"],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
    const run = store.beginIndexRun("smoke_seed");
    store.replaceIndexSnapshot({
      files: [
        fileRecord(
          projectRoot,
          "app/api/auth/callback/route.ts",
          routeContent,
          "typescript",
          [{ name: "GET", kind: "function", exportName: "GET", lineStart: 2, lineEnd: 5 }],
          [{ targetPath: "lib/auth/session.ts", specifier: "../../../../lib/auth/session" }],
          [{
            routeKey: "GET /api/auth/callback",
            pattern: "/api/auth/callback",
            method: "GET",
            handlerName: "GET",
            isApi: true,
          }],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/layout.tsx",
          dashboardLayoutContent,
          "tsx",
          [{ name: "DashboardLayout", kind: "function", exportName: "default", lineStart: 1, lineEnd: 6 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/admin/endorsements/create/client-page.tsx",
          adminEndorsementCreateContent,
          "tsx",
          [{ name: "AdminEndorsementCreatePage", kind: "function", exportName: "AdminEndorsementCreatePage", lineStart: 1, lineEnd: 4 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "app/dashboard/instructor/endorsements/create/client-page.tsx",
          instructorEndorsementCreateContent,
          "tsx",
          [{ name: "InstructorEndorsementCreatePage", kind: "function", exportName: "InstructorEndorsementCreatePage", lineStart: 1, lineEnd: 4 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "lib/auth/session.ts",
          sessionContent,
          "typescript",
          [{ name: "getSession", kind: "function", exportName: "getSession", lineStart: 2, lineEnd: 4 }],
          [{ targetPath: "types/auth.ts", specifier: "../../types/auth" }],
        ),
        fileRecord(
          projectRoot,
          "types/auth.ts",
          typeContent,
          "typescript",
          [{ name: "UserSession", kind: "interface", exportName: "UserSession", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "components/LoginButton.tsx",
          loginContent,
          "tsx",
          [{ name: "LoginButton", kind: "function", exportName: "LoginButton", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        fileRecord(
          projectRoot,
          "components/ui/button.tsx",
          centralButtonContent,
          "tsx",
          [{ name: "Button", kind: "function", exportName: "Button", lineStart: 1, lineEnd: 3 }],
          [],
        ),
        ...generatedButtonConsumers.map((consumer) => fileRecord(
          projectRoot,
          consumer.relPath,
          consumer.content,
          "tsx",
          [{ name: consumer.symbolName, kind: "function", exportName: consumer.symbolName, lineStart: 2, lineEnd: 4 }],
          [{ targetPath: "components/ui/button.tsx", specifier: "../../components/ui/button" }],
        )),
      ],
      schemaObjects: [{
        objectKey: "table:public.user_profiles",
        objectType: "table",
        schemaName: "public",
        objectName: "user_profiles",
      }],
      schemaUsages: [{
        objectKey: "table:public.user_profiles",
        filePath: "lib/auth/session.ts",
        usageKind: "read",
        line: 3,
        excerpt: "return { user: { id: 'u1', role: 'admin' } };",
      }],
    });
    const findingSubject = {
      kind: "diagnostic" as const,
      path: "lib/auth/session.ts",
      code: "typescript:TS2322",
    };
    const findingSubjectFingerprint = store.computeReefSubjectFingerprint(findingSubject);
    const capturedAt = new Date().toISOString();
    const activeFinding: ProjectFinding = {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "typescript",
        ruleId: "TS2322",
        subjectFingerprint: findingSubjectFingerprint,
        message: "UserSession user.role type no longer matches route expectations.",
      }),
      source: "typescript",
      subjectFingerprint: findingSubjectFingerprint,
      overlay: "working_tree",
      severity: "warning",
      status: "active",
      filePath: "lib/auth/session.ts",
      line: 3,
      ruleId: "TS2322",
      freshness: {
        state: "fresh",
        checkedAt: capturedAt,
        reason: "fixture active finding",
      },
      capturedAt,
      message: "UserSession user.role type no longer matches route expectations.",
      factFingerprints: [],
    };
    const dashboardSubject = {
      kind: "diagnostic" as const,
      path: "app/dashboard/layout.tsx",
      code: "identity.boundary_mismatch",
    };
    const dashboardSubjectFingerprint = store.computeReefSubjectFingerprint(dashboardSubject);
    const dashboardFinding: ProjectFinding = {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "cross_search",
        ruleId: "identity.boundary_mismatch",
        subjectFingerprint: dashboardSubjectFingerprint,
        message: "Dashboard layout role guard does not match page access checks.",
      }),
      source: "cross_search",
      subjectFingerprint: dashboardSubjectFingerprint,
      overlay: "indexed",
      severity: "warning",
      status: "active",
      filePath: "app/dashboard/layout.tsx",
      line: 2,
      ruleId: "identity.boundary_mismatch",
      freshness: {
        state: "fresh",
        checkedAt: capturedAt,
        reason: "fixture dashboard finding",
      },
      capturedAt,
      message: "Dashboard layout role guard does not match page access checks.",
      factFingerprints: [],
    };
    const noiseFindings: ProjectFinding[] = Array.from({ length: 250 }, (_, index) => {
      const path = `noise/noise-${index}.ts`;
      const subjectFingerprint = store.computeReefSubjectFingerprint({
        kind: "diagnostic",
        path,
        code: `typescript:TS9${index}`,
      });
      return {
        projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "typescript",
          ruleId: `TS9${index}`,
          subjectFingerprint,
          message: `Unrelated noisy diagnostic ${index}.`,
        }),
        source: "typescript",
        subjectFingerprint,
        overlay: "working_tree",
        severity: "error",
        status: "active",
        filePath: path,
        line: 1,
        ruleId: `TS9${index}`,
        freshness: {
          state: "fresh",
          checkedAt: capturedAt,
          reason: "fixture noise finding",
        },
        capturedAt,
        message: `Unrelated noisy diagnostic ${index}.`,
        factFingerprints: [],
      };
    });
    store.replaceReefFindingsForSource({
      projectId,
      source: "typescript",
      overlay: "working_tree",
      findings: [activeFinding, ...noiseFindings],
    });
    store.replaceReefFindingsForSource({
      projectId,
      source: "cross_search",
      overlay: "indexed",
      findings: [dashboardFinding],
    });
    store.finishIndexRun(run.runId, "succeeded");
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-context-packet-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  const originalReefBacked = process.env.MAKO_REEF_BACKED;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  mkdirSync(projectRoot, { recursive: true });

  const projectId = randomUUID();
  const hotIndexCache = createHotIndexCache();

  try {
    seedProject(projectRoot, projectId);

    const packet = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "my auth route is broken after changing the user type",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache, requestContext: { requestId: "req_context_packet_smoke" } },
    ) as ContextPacketToolOutput;

    ContextPacketToolOutputSchema.parse(packet);
    assertExpandableToolsHaveValidArgs(packet, "primary packet");
    assert.equal(packet.toolName, "context_packet");
    assert.equal(packet.projectId, projectId);
    assert.equal(packet.mode, "explore");
    assert.equal(packet.modePolicy.includeRisks, true);
    assert.deepEqual(packet.limits.providersSkipped, []);
    assert.equal(packet.intent.primaryFamily, "debug_auth_state");
    assert.ok(packet.intent.families.some((entry) => entry.family === "debug_route"));
    assert.ok(packet.intent.families.some((entry) => entry.family === "debug_type_contract"));
    assert.ok(packet.primaryContext.length > 0, "packet should return primary context");
    assert.equal(packet.primaryContext.every((candidate) => ["file", "symbol", "route", "database_object"].includes(candidate.kind)), true);

    const contextPaths = new Set([...packet.primaryContext, ...packet.relatedContext].flatMap((candidate) => candidate.path ?? []));
    assert.ok(contextPaths.has("app/api/auth/callback/route.ts"), "route handler should be in context");
    assert.ok(
      contextPaths.has("lib/auth/session.ts") || contextPaths.has("types/auth.ts"),
      "auth session or type file should be in context",
    );
    assert.ok(
      packet.graphSummary.anchorFiles.includes("app/api/auth/callback/route.ts"),
      "graph summary should preserve explicit focus files as graph anchors",
    );
    assert.ok(
      packet.graphSummary.files.some((file) =>
        file.filePath === "app/api/auth/callback/route.ts" &&
        file.relation === "anchor" &&
        file.distance === 0
      ),
      "graph summary should label the focused route file as an anchor",
    );
    assert.ok(
      packet.graphSummary.files.some((file) =>
        file.filePath === "lib/auth/session.ts" &&
        (file.relation === "dependency" || file.relation === "bidirectional")
      ),
      "graph summary should label imported auth/session code as dependency context",
    );
    assert.ok(
      packet.graphSummary.edges.some((edge) =>
        edge.from === "app/api/auth/callback/route.ts" &&
        edge.to === "lib/auth/session.ts" &&
        edge.relation === "anchor_dependency"
      ),
      "graph summary should expose import edges from anchors to returned dependencies",
    );
    assert.ok(
      packet.graphSummary.dependencyFileCount + packet.graphSummary.bidirectionalFileCount > 0,
      "graph summary should count dependency-related files",
    );
    assert.equal(packet.requestCoverage.status, "complete");
    assert.equal(packet.requestCoverage.uncoveredCount, 0);
    assert.ok(
      packet.requestCoverage.items.some((item) =>
        item.kind === "file" &&
        item.value === "app/api/auth/callback/route.ts" &&
        item.status === "covered" &&
        item.matchedBy.length > 0
      ),
      "request coverage should prove the explicit focus file is represented",
    );
    assert.ok(packet.routes.some((route) => route.routeKey === "GET /api/auth/callback"));
    assert.ok(packet.symbols.some((symbol) => symbol.name === "getSession" || symbol.name === "UserSession"));
    assert.ok(packet.databaseObjects.some((object) => object.objectName === "user_profiles"));
    assert.ok(packet.activeFindings.some((finding) =>
      finding.source === "typescript" &&
      finding.ruleId === "TS2322" &&
      finding.filePath === "lib/auth/session.ts"
    ));
    assert.ok(packet.risks.some((risk) => risk.code === "auth_state_flow"));
    assert.ok(packet.risks.some((risk) => risk.code === "type_contract_mismatch"));
    assert.ok(packet.scopedInstructions.some((instruction) => instruction.path === "AGENTS.md"));
    assert.ok(packet.recommendedHarnessPattern.some((step) => step.includes("auth/session")));
    assert.equal(packet.indexFreshness?.state, "fresh");
    assert.equal(packet.freshnessGate.status, "skipped");
    assert.equal(packet.freshnessGate.source, "metadata");
    assert.equal(packet.freshnessGate.indexFreshness.state, "fresh");
    assert.ok(
      packet.evidenceQuality.label === "strong" || packet.evidenceQuality.label === "usable",
      `primary packet should be strong or usable evidence; got ${packet.evidenceQuality.label}`,
    );
    assert.ok(packet.evidenceQuality.score > 0.5, "primary packet should have a useful evidence score");
    assert.equal(
      packet.evidenceQuality.totalContextCount,
      packet.primaryContext.length + packet.relatedContext.length,
      "evidence quality should count returned context",
    );
    assert.equal(packet.evidenceQuality.freshness.indexState, "fresh");
    assert.equal(packet.evidenceQuality.freshness.gateStatus, "skipped");
    assert.equal(packet.evidenceQuality.requestCoverage.status, "complete");
    assert.equal(packet.evidenceQuality.requestCoverage.unresolvedCount, 0);
    assert.equal(packet.evidenceQuality.graph.status, "not_requested");
    assert.ok(
      packet.evidenceQuality.reasons.some((reason) => reason.includes("primary")),
      "evidence quality should explain context coverage",
    );
    assert.ok(packet.retrievalDiagnostics.providerRunCount > 0, "retrieval diagnostics should count provider runs");
    assert.ok(
      packet.retrievalDiagnostics.providerCandidateCount >= packet.limits.candidatesConsidered,
      "retrieval diagnostics should summarize provider candidate volume",
    );
    assert.ok(
      packet.retrievalDiagnostics.recommendations.length > 0,
      "retrieval diagnostics should include at least one recommendation",
    );
    assert.ok(packet.limits.providersRun.includes("hot_hint_index"));
    const hotHintRunDetail = packet.limits.providersRunDetail.find((detail) => detail.provider === "hot_hint_index");
    assert.ok(hotHintRunDetail, "provider run details should include hot_hint_index");
    assert.equal(hotHintRunDetail.status, "success");
    assert.equal(typeof hotHintRunDetail.candidateCount, "number");
    assert.equal(typeof hotHintRunDetail.durationMs, "number");
    assert.equal(hotIndexCache.size(), 1, "first call should build one hot index");
    const exploreToolNames = packet.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      exploreToolNames.includes("repo_map"),
      "explore mode should recommend repo_map",
    );
    assert.equal(
      exploreToolNames.includes("imports_deps"),
      false,
      "generic explore expansions should not recommend imports_deps without a graph-gap file anchor",
    );
    assert.equal(
      exploreToolNames.includes("imports_impact"),
      false,
      "generic explore expansions should not recommend imports_impact without a graph-gap file anchor",
    );
    const exploreRepoMap = packet.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.ok(exploreRepoMap, "explore mode should attach a repo_map expansion entry");
    assert.deepEqual(
      (exploreRepoMap.suggestedArgs as { focusFiles?: unknown }).focusFiles,
      ["app/api/auth/callback/route.ts"],
      "repo_map suggestedArgs should preserve focusFiles as graph personalization anchors",
    );
    assert.ok(
      exploreToolNames.includes("project_open_loops"),
      "explore mode should recommend project_open_loops",
    );
    assert.equal(
      exploreToolNames.includes("verification_state"),
      false,
      "explore mode should not surface verification_state",
    );

    const noHintsCache = createHotIndexCache();
    try {
      const noHintsPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find auth session type context",
          focusFiles: ["app/api/auth/callback/route.ts"],
          includeLiveHints: false,
        },
        { hotIndexCache: noHintsCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(noHintsPacket, "no-hints packet");
      assert.equal(noHintsCache.size(), 0, "includeLiveHints=false should not build the hot index");
      assert.equal(
        noHintsPacket.limits.providersSkipped.includes("hot_hint_index"),
        true,
        "includeLiveHints=false should skip the hot hint provider",
      );
      assert.equal(
        noHintsPacket.limits.providersRun.includes("hot_hint_index"),
        false,
        "includeLiveHints=false should not report hot_hint_index as run",
      );
    } finally {
      noHintsCache.flush();
    }

    const quotedLiteralPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is \"Login\" rendered?",
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(quotedLiteralPacket, "quoted literal packet");
    const literalLiveTextSearch = quotedLiteralPacket.expandableTools.find((tool) => tool.toolName === "live_text_search");
    assert.ok(literalLiveTextSearch, "context_packet should recommend live_text_search for exact follow-up checks");
    assert.ok(
      quotedLiteralPacket.limits.providersSkipped.includes("live_text_provider"),
      "includeLiveHints=false should skip the live text provider for quoted literals",
    );
    assert.ok(
      quotedLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "Login" &&
        item.status === "not_checked"
      ),
      "request coverage should mark quoted literals as not checked when live text is disabled",
    );
    assert.deepEqual(
      literalLiveTextSearch.suggestedArgs,
      {
        projectId,
        query: "Login",
        fixedStrings: true,
        maxMatches: 50,
      },
      "live_text_search suggestedArgs should search the quoted literal, not the whole prose request",
    );

    const liveLiteralPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is \"Login\" rendered?",
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(liveLiteralPacket, "live literal packet");
    assert.ok(
      liveLiteralPacket.limits.providersRun.includes("live_text_provider"),
      "quoted literals should run the bounded live text provider when live hints are enabled",
    );
    const liveLiteralCandidate = liveLiteralPacket.primaryContext.find((candidate) =>
      candidate.source === "live_text_provider" &&
      candidate.path === "components/LoginButton.tsx"
    );
    assert.ok(
      liveLiteralCandidate,
      "live text provider should return the current-disk file containing the quoted literal",
    );
    assert.equal(liveLiteralCandidate.strategy, "exact_match");
    assert.equal(liveLiteralCandidate.metadata?.query, "Login");
    assert.equal(liveLiteralCandidate.metadata?.overlay, "live_filesystem");
    assert.equal(liveLiteralCandidate.metadata?.evidenceConfidenceLabel, "verified_live");
    assert.equal(typeof liveLiteralCandidate.lineStart, "number");
    assert.ok(
      typeof liveLiteralCandidate.metadata?.text === "string" &&
        liveLiteralCandidate.metadata.text.includes("Login"),
      "live text candidate should include the matched current-disk line",
    );
    assert.ok(
      liveLiteralPacket.evidenceQuality.liveOverlayContextCount > 0,
      "live text matches should count as live evidence quality",
    );
    assert.ok(
      liveLiteralPacket.requestCoverage.items.some((item) =>
        item.kind === "quoted_text" &&
        item.value === "Login" &&
        item.status === "covered" &&
        item.matchedBy.some((ref) => ref.includes("live_text_provider"))
      ),
      "request coverage should mark live text literals as covered by current filesystem evidence",
    );

    const scopedLiteralCache = createHotIndexCache();
    try {
      const scopedLiveLiteralPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check\"",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedLiveLiteralPacket, "scoped live literal packet");
      assert.equal(
        scopedLiteralCache.size(),
        0,
        "scoped quoted literal routing should not build a hot index",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRun.includes("hot_hint_index"),
        false,
        "scoped quoted literal routing should skip broad hot hints",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRun.includes("repo_map_provider"),
        false,
        "scoped quoted literal routing should skip centrality-ranked repo map context",
      );
      for (const provider of [
        "file_provider",
        "route_provider",
        "schema_provider",
        "symbol_provider",
        "import_graph_provider",
      ]) {
        assert.equal(
          scopedLiveLiteralPacket.limits.providersRun.includes(provider),
          false,
          `scoped live literal hit should not run ${provider}`,
        );
        assert.equal(
          scopedLiveLiteralPacket.limits.providersSkipped.includes(provider),
          true,
          `scoped live literal hit should report ${provider} as skipped`,
        );
      }
      assert.equal(
        scopedLiveLiteralPacket.limits.providersSkipped.includes("hot_hint_index"),
        true,
        "scoped quoted literal routing should report the hot hint skip",
      );
      assert.equal(
        scopedLiveLiteralPacket.limits.providersSkipped.includes("repo_map_provider"),
        true,
        "scoped quoted literal routing should report the repo map skip",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "hot_hint_index" && detail.adaptive &&
          detail.reason.includes("Scoped live quoted-literal matches")
        ),
        "provider skip details should explain adaptive hot hint routing",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "repo_map_provider" && detail.adaptive &&
          detail.reason.includes("Scoped live quoted-literal matches")
        ),
        "provider skip details should explain adaptive repo map routing",
      );
      assert.ok(
        scopedLiveLiteralPacket.limits.providersSkippedDetail.some((detail) =>
          detail.provider === "file_provider" && detail.adaptive &&
          detail.reason.includes("Scoped live quoted-literal matches")
        ),
        "provider skip details should explain data-driven semantic provider pruning",
      );
      assert.ok(
        scopedLiveLiteralPacket.retrievalDiagnostics.adaptiveSkippedProviders.includes("file_provider") &&
          scopedLiveLiteralPacket.retrievalDiagnostics.adaptiveSkippedProviders.includes("hot_hint_index"),
        "retrieval diagnostics should summarize adaptive skips",
      );
      assert.ok(
        scopedLiveLiteralPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
          recommendation.includes("Adaptive routing")
        ),
        "retrieval diagnostics should recommend expanding when adaptive routing narrowed retrieval",
      );
      const scopedLiveRunDetail = scopedLiveLiteralPacket.limits.providersRunDetail.find((detail) =>
        detail.provider === "live_text_provider"
      );
      assert.ok(scopedLiveRunDetail, "scoped literal packets should include live_text_provider run detail");
      assert.equal(scopedLiveRunDetail.status, "success");
      assert.ok(scopedLiveRunDetail.candidateCount > 0, "live text run detail should count exact matches");
      assert.equal(
        scopedLiveLiteralPacket.limits.providersRunDetail.some((detail) =>
          detail.provider === "file_provider"
        ),
        false,
        "pruned semantic providers should not appear in provider run details",
      );
      const scopedLiveCandidates = scopedLiveLiteralPacket.primaryContext.filter((candidate) =>
        candidate.source === "live_text_provider"
      );
      assert.ok(scopedLiveCandidates.length > 0, "scoped quoted literal should return live text candidates");
      assert.equal(
        scopedLiveCandidates.every((candidate) =>
          candidate.path === "app/dashboard/admin/endorsements/create/client-page.tsx" &&
          candidate.metadata?.scopePath === "app/dashboard/admin/endorsements/create/client-page.tsx"
        ),
        true,
        "live text provider should scope quoted literal searches to explicit focus files",
      );
      assert.equal(
        scopedLiveCandidates.some((candidate) =>
          candidate.path === "app/dashboard/instructor/endorsements/create/client-page.tsx"
        ),
        false,
        "scoped live literal search should not return matches from unanchored files",
      );

      const scopedLiveLiteralMissPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "find \"duplicate role check typo\"",
          focusFiles: ["app/dashboard/admin/endorsements/create/client-page.tsx"],
        },
        { hotIndexCache: scopedLiteralCache },
      ) as ContextPacketToolOutput;
      assertExpandableToolsHaveValidArgs(scopedLiveLiteralMissPacket, "scoped live literal miss packet");
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("file_provider"),
        "scoped literal misses should still run indexed fallback providers",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("hot_hint_index"),
        "scoped literal misses should keep broad hot hint fallback enabled",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.limits.providersRun.includes("repo_map_provider"),
        "scoped literal misses should keep repo-map fallback enabled",
      );
      assert.equal(
        scopedLiteralCache.size(),
        1,
        "scoped literal misses should build a hot index for broad fallback",
      );
      const scopedLiveMissRunDetail = scopedLiveLiteralMissPacket.limits.providersRunDetail.find((detail) =>
        detail.provider === "live_text_provider"
      );
      assert.ok(scopedLiveMissRunDetail, "scoped literal misses should include live_text_provider run detail");
      assert.equal(scopedLiveMissRunDetail.candidateCount, 0);
      assert.ok(
        scopedLiveLiteralMissPacket.retrievalDiagnostics.liveTextMisses.some((miss) =>
          miss.query === "duplicate role check typo" &&
          miss.scope === "file" &&
          miss.scopePath === "app/dashboard/admin/endorsements/create/client-page.tsx"
        ),
        "retrieval diagnostics should report scoped live literal misses",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
          recommendation.includes("Quoted literal was not found in scoped current files")
        ),
        "scoped live literal misses should recommend spelling/case verification or broader live search",
      );
      assert.equal(scopedLiveLiteralMissPacket.requestCoverage.status, "partial");
      assert.ok(
        scopedLiveLiteralMissPacket.requestCoverage.items.some((item) =>
          item.kind === "quoted_text" &&
          item.value === "duplicate role check typo" &&
          item.status === "uncovered"
        ),
        "request coverage should mark scoped literal misses as uncovered",
      );
      assert.ok(
        scopedLiveLiteralMissPacket.requestCoverage.recommendations.some((recommendation) =>
          recommendation.includes("Broaden live_text_search")
        ),
        "request coverage should recommend broader live search for uncovered literals",
      );
      const scopedMissLiveTextSearch = scopedLiveLiteralMissPacket.expandableTools.find((tool) =>
        tool.toolName === "live_text_search"
      );
      assert.ok(scopedMissLiveTextSearch, "scoped live literal misses should recommend broad live_text_search");
      assert.deepEqual(
        scopedMissLiveTextSearch.suggestedArgs,
        {
          projectId,
          query: "duplicate role check typo",
          fixedStrings: true,
          maxMatches: 50,
        },
        "scoped miss live_text_search should broaden the missed literal to the project filesystem",
      );
      assert.ok(
        scopedMissLiveTextSearch.reason.includes("did not find") &&
          scopedMissLiveTextSearch.reason.includes("app/dashboard/admin/endorsements/create/client-page.tsx"),
        "scoped miss live_text_search should explain the scoped current-file miss",
      );
    } finally {
      scopedLiteralCache.flush();
    }

    const weakPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "implement",
        request: "zzzz_no_context_match_987654",
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.equal(weakPacket.evidenceQuality.label, "weak");
    assert.equal(weakPacket.evidenceQuality.totalContextCount, 0);
    assert.equal(weakPacket.retrievalDiagnostics.providerCandidateCount, 0);
    assert.ok(
      weakPacket.retrievalDiagnostics.zeroCandidateProviders.length > 0,
      "weak packets should report providers that returned zero candidates",
    );
    assert.ok(
      weakPacket.retrievalDiagnostics.recommendations.some((recommendation) =>
        recommendation.includes("All executed providers returned zero candidates")
      ),
      "weak packets should recommend better anchors when all providers miss",
    );
    assert.ok(
      weakPacket.evidenceQuality.reasons.some((reason) => reason.includes("No deterministic context")),
      "weak evidence quality should explain that no deterministic context matched",
    );

    const duplicatePacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "find duplicate endorsement create role checks",
        includeLiveHints: false,
        maxPrimaryContext: 2,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const duplicatePaths = new Set(duplicatePacket.primaryContext.flatMap((candidate) => candidate.path ?? []));
    assert.equal(
      duplicatePacket.primaryContext.some((candidate) => candidate.strategy === "centrality_rank"),
      false,
      "duplicate discovery should not rank centrality candidates as primary context",
    );
    assert.ok(
      duplicatePaths.has("app/dashboard/admin/endorsements/create/client-page.tsx") ||
        duplicatePaths.has("app/dashboard/instructor/endorsements/create/client-page.tsx"),
      "duplicate discovery should prioritize directly matching peripheral files",
    );
    assert.ok(
      [...duplicatePacket.primaryContext, ...duplicatePacket.relatedContext].some((candidate) =>
        candidate.strategy === "centrality_rank" &&
        candidate.path === "components/ui/button.tsx"
      ),
      "the centrality candidate should still be available as supporting context",
    );

    const graphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect callback dependency graph",
        focusFiles: ["app/api/auth/callback/route.ts"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const graphContext = [...graphPacket.primaryContext, ...graphPacket.relatedContext];
    const transitiveTypeCandidate = graphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.ok(
      transitiveTypeCandidate,
      `focused graph expansion should surface transitive dependencies of the route; got ${JSON.stringify(
        graphContext.map((candidate) => ({
          path: candidate.path,
          source: candidate.source,
          strategy: candidate.strategy,
          score: candidate.score,
          metadata: candidate.metadata,
        })).slice(0, 12),
      )}`,
    );
    assert.equal(
      transitiveTypeCandidate?.strategy,
      "deterministic_graph",
      "context graph should explain transitive dependencies through the import graph provider",
    );
    assert.equal(
      transitiveTypeCandidate?.metadata?.graphDepth,
      2,
      "transitive dependency should report its import-graph depth",
    );
    assert.deepEqual(
      transitiveTypeCandidate?.metadata?.graphPath,
      ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
      "transitive dependency should retain the focused graph path",
    );
    assert.equal(
      typeof transitiveTypeCandidate?.metadata?.corroborationBonus,
      "number",
      "merged candidates should expose the bounded corroboration boost",
    );
    assert.ok(
      Number(transitiveTypeCandidate?.metadata?.corroborationBonus ?? 0) > 0,
      "independent supporting evidence should increase the merged candidate score",
    );
    assert.ok(
      Number(transitiveTypeCandidate?.metadata?.corroboratedSignalCount ?? 0) >= 2,
      "merged candidates should report how many signals contributed",
    );
    const transitiveSupportingSignals = transitiveTypeCandidate?.metadata?.supportingSignals;
    assert.equal(
      Array.isArray(transitiveSupportingSignals),
      true,
      "merged candidates should retain compact supporting provider signals",
    );
    assert.equal(
      Array.isArray(transitiveSupportingSignals) &&
        transitiveSupportingSignals.some((signal) =>
          typeof signal === "object" &&
          signal != null &&
          !Array.isArray(signal) &&
          signal.source === "repo_map_provider" &&
          typeof signal.metadata === "object" &&
          signal.metadata != null &&
          !Array.isArray(signal.metadata) &&
          signal.metadata.graphRankMode === "personalized" &&
          signal.metadata.graphRankDirection === "bidirectional" &&
          signal.metadata.focusRelation === "dependency" &&
          signal.metadata.dependencyDistance === 2
        ),
      true,
      "transitive dependency should retain PageRank support after provider merge",
    );
    assert.equal(
      graphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.metadata?.graphRankMode === "personalized"
      ) ||
        (Array.isArray(transitiveSupportingSignals) &&
          transitiveSupportingSignals.some((signal) =>
            typeof signal === "object" &&
            signal != null &&
            !Array.isArray(signal) &&
            signal.source === "repo_map_provider" &&
            typeof signal.metadata === "object" &&
            signal.metadata != null &&
            !Array.isArray(signal.metadata) &&
            signal.metadata.graphRankMode === "personalized" &&
            signal.metadata.graphRankDirection === "bidirectional" &&
            signal.metadata.focusRelation === "dependency" &&
            signal.metadata.dependencyDistance === 2
          )),
      true,
      "repo_map_provider should still report personalized graph ranking when focus files seed the graph",
    );
    assert.equal(
      graphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.path === "components/ui/button.tsx"
      ),
      false,
      "personalized graph ranking should avoid unrelated global hubs",
    );
    assert.equal(graphPacket.evidenceQuality.graph.status, "connected");
    assert.ok(
      graphPacket.evidenceQuality.graph.edgeCount > 0 ||
        graphPacket.evidenceQuality.graph.connectedFileCount > 0,
      "connected graph quality should prove edge or relation evidence was returned",
    );

    const isolatedGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect isolated dashboard layout dependency graph",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(isolatedGraphPacket, "isolated graph packet");
    const isolatedGraphContext = [...isolatedGraphPacket.primaryContext, ...isolatedGraphPacket.relatedContext];
    const isolatedRepoMapSignals: Array<Record<string, unknown>> = [];
    for (const candidate of isolatedGraphContext) {
      if (candidate.source === "repo_map_provider") {
        isolatedRepoMapSignals.push(candidate as unknown as Record<string, unknown>);
      }
      const supportingSignals = candidate.metadata?.supportingSignals;
      if (Array.isArray(supportingSignals)) {
        for (const signal of supportingSignals) {
          if (typeof signal !== "object" || signal == null || Array.isArray(signal)) continue;
          const signalRecord = signal as Record<string, unknown>;
          if (signalRecord.source === "repo_map_provider") {
            isolatedRepoMapSignals.push(signalRecord);
          }
        }
      }
    }
    assert.ok(
      isolatedRepoMapSignals.length > 0,
      "isolated focus file should still receive personalized repo_map support for the seed file",
    );
    assert.equal(
      isolatedRepoMapSignals.every((signal) => {
        const signalMetadata = signal.metadata;
        if (typeof signalMetadata !== "object" || signalMetadata == null || Array.isArray(signalMetadata)) {
          return false;
        }
        const metadataRecord = signalMetadata as Record<string, unknown>;
        return metadataRecord.graphRankMode === "personalized" &&
          metadataRecord.graphRankDirection === "bidirectional" &&
          metadataRecord.focusRelation === "self" &&
          metadataRecord.focusDistance === 0 &&
          Number(metadataRecord.graphRankScore ?? 0) > 0.1;
      }),
      true,
      "personalized repo_map signals should omit unrelated zero-rank files for isolated focus anchors",
    );
    assert.equal(isolatedGraphPacket.evidenceQuality.graph.status, "isolated");
    assert.equal(isolatedGraphPacket.evidenceQuality.label, "partial");
    assert.ok(
      isolatedGraphPacket.evidenceQuality.reasons.some((reason) =>
        reason.includes("isolated graph evidence")
      ),
      "evidence quality should explain isolated graph evidence for dependency-graph requests",
    );
    assert.ok(
      isolatedGraphPacket.evidenceQuality.recommendedAction.includes("file-local context"),
      "isolated graph evidence should steer agents away from broad dependency claims",
    );
    const isolatedGraphExpansionTools = isolatedGraphPacket.expandableTools.slice(0, 4);
    assert.deepEqual(
      isolatedGraphExpansionTools.slice(0, 2).map((tool) => tool.toolName),
      ["imports_deps", "imports_impact"],
      "isolated graph evidence should prioritize direct dependency and impact follow-up tools",
    );
    assert.equal(
      (isolatedGraphExpansionTools[0]?.suggestedArgs as { file?: unknown }).file,
      "app/dashboard/layout.tsx",
      "imports_deps graph-gap follow-up should target the isolated anchor file",
    );
    assert.equal(
      (isolatedGraphExpansionTools[1]?.suggestedArgs as { file?: unknown; depth?: unknown }).file,
      "app/dashboard/layout.tsx",
      "imports_impact graph-gap follow-up should target the isolated anchor file",
    );
    assert.equal(
      (isolatedGraphExpansionTools[1]?.suggestedArgs as { depth?: unknown }).depth,
      3,
      "imports_impact graph-gap follow-up should use a bounded transitive depth",
    );
    assert.ok(
      isolatedGraphExpansionTools.some((tool) => tool.toolName === "reef_where_used"),
      "isolated graph evidence should also suggest maintained usage evidence",
    );

    const routeOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect callback dependency graph",
        focusRoutes: ["/api/auth/callback"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const routeOnlyRepoMap = routeOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (routeOnlyRepoMap?.suggestedArgs as { focusRoutes?: unknown } | undefined)?.focusRoutes,
      ["/api/auth/callback"],
      "repo_map suggestedArgs should preserve focusRoutes anchors",
    );
    const routeOnlyGraphContext = [...routeOnlyGraphPacket.primaryContext, ...routeOnlyGraphPacket.relatedContext];
    const routeOnlyTypeCandidate = routeOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.equal(
      routeOnlyTypeCandidate?.metadata?.graphDepth,
      2,
      "focusRoutes alone should seed transitive import graph expansion",
    );
    assert.deepEqual(
      routeOnlyTypeCandidate?.metadata?.graphPath,
      ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
      "route-focused graph expansion should preserve the route handler path",
    );
    const routeOnlySeedSources = routeOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(routeOnlySeedSources),
      true,
      "route-focused graph expansion should explain which focus target seeded the graph",
    );
    assert.equal(
      Array.isArray(routeOnlySeedSources) &&
        routeOnlySeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_route" &&
          source.term === "/api/auth/callback"
        ),
      true,
      "route-focused graph expansion should retain focusRoutes provenance",
    );
    assert.equal(
      routeOnlyGraphContext.some((candidate) =>
        candidate.source === "repo_map_provider" &&
        candidate.metadata?.graphRankMode === "personalized"
      ) ||
        (Array.isArray(routeOnlyTypeCandidate?.metadata?.supportingSignals) &&
          routeOnlyTypeCandidate.metadata.supportingSignals.some((signal) =>
            typeof signal === "object" &&
            signal != null &&
            !Array.isArray(signal) &&
            signal.source === "repo_map_provider" &&
            typeof signal.metadata === "object" &&
            signal.metadata != null &&
            !Array.isArray(signal.metadata) &&
            signal.metadata.graphRankMode === "personalized" &&
            signal.metadata.graphRankDirection === "bidirectional" &&
            signal.metadata.focusRelation === "dependency" &&
            signal.metadata.dependencyDistance === 2
          )),
      true,
      "focusRoutes alone should personalize PageRank around the route handler file",
    );

    const symbolOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect session type dependency graph",
        focusSymbols: ["getSession"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const symbolOnlyRepoMap = symbolOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (symbolOnlyRepoMap?.suggestedArgs as { focusSymbols?: unknown } | undefined)?.focusSymbols,
      ["getSession"],
      "repo_map suggestedArgs should preserve focusSymbols anchors",
    );
    const symbolOnlyGraphContext = [...symbolOnlyGraphPacket.primaryContext, ...symbolOnlyGraphPacket.relatedContext];
    const symbolOnlyTypeCandidate = symbolOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.ok(
      symbolOnlyTypeCandidate,
      `focusSymbols alone should seed import graph expansion from the symbol file; got ${JSON.stringify(
        symbolOnlyGraphContext.map((candidate) => ({
          path: candidate.path,
          source: candidate.source,
          strategy: candidate.strategy,
          metadata: candidate.metadata,
        })).slice(0, 12),
      )}`,
    );
    assert.equal(
      symbolOnlyTypeCandidate?.metadata?.graphDepth,
      1,
      "focusSymbols alone should report the import graph depth from the symbol file",
    );
    assert.deepEqual(
      symbolOnlyTypeCandidate?.metadata?.graphPath,
      ["lib/auth/session.ts", "types/auth.ts"],
      "symbol-focused graph expansion should preserve the symbol owner path",
    );
    const symbolSeedSources = symbolOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(symbolSeedSources) &&
        symbolSeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_symbol" &&
          source.term === "getSession" &&
          source.symbolName === "getSession"
        ),
      true,
      "symbol-focused graph expansion should retain focusSymbols provenance",
    );

    const schemaOnlyGraphPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect user profile type dependency graph",
        focusDatabaseObjects: ["public.user_profiles"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    const schemaOnlyRepoMap = schemaOnlyGraphPacket.expandableTools.find((tool) => tool.toolName === "repo_map");
    assert.deepEqual(
      (schemaOnlyRepoMap?.suggestedArgs as { focusDatabaseObjects?: unknown } | undefined)?.focusDatabaseObjects,
      ["public.user_profiles"],
      "repo_map suggestedArgs should preserve focusDatabaseObjects anchors",
    );
    const schemaOnlyGraphContext = [...schemaOnlyGraphPacket.primaryContext, ...schemaOnlyGraphPacket.relatedContext];
    const schemaOnlyTypeCandidate = schemaOnlyGraphContext.find((candidate) =>
      candidate.source === "import_graph_provider" &&
      candidate.strategy === "deterministic_graph" &&
      candidate.path === "types/auth.ts"
    );
    assert.equal(
      schemaOnlyTypeCandidate?.metadata?.graphDepth,
      1,
      "focusDatabaseObjects alone should seed import graph expansion from schema usage files",
    );
    const schemaSeedSources = schemaOnlyTypeCandidate?.metadata?.graphSeedSources;
    assert.equal(
      Array.isArray(schemaSeedSources) &&
        schemaSeedSources.some((source) =>
          typeof source === "object" &&
          source != null &&
          !Array.isArray(source) &&
          source.source === "focus_database_object" &&
          source.term === "public.user_profiles" &&
          source.databaseObjectName === "public.user_profiles" &&
          source.usageKind === "read"
        ),
      true,
      "schema-focused graph expansion should retain focusDatabaseObjects provenance",
    );

    const unresolvedFocusPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "inspect missing graph anchors",
        focusFiles: ["missing/file.ts"],
        focusRoutes: ["/api/not-real"],
        focusSymbols: ["missingSymbolForGraphSeed"],
        focusDatabaseObjects: ["public.missing_table"],
        includeLiveHints: false,
        maxPrimaryContext: 8,
        maxRelatedContext: 8,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(unresolvedFocusPacket, "unresolved focus packet");
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus file is not indexed") && warning.includes("missing/file.ts")
      ),
      "missing focusFiles should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus route did not resolve") && warning.includes("/api/not-real")
      ),
      "missing focusRoutes should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus symbol did not resolve") && warning.includes("missingSymbolForGraphSeed")
      ),
      "missing focusSymbols should produce an unresolved graph seed warning",
    );
    assert.ok(
      unresolvedFocusPacket.warnings.some((warning) =>
        warning.includes("focus database object did not resolve") && warning.includes("public.missing_table")
      ),
      "missing focusDatabaseObjects should produce an unresolved graph seed warning",
    );
    assert.equal(unresolvedFocusPacket.requestCoverage.status, "missing");
    assert.equal(unresolvedFocusPacket.requestCoverage.coveredCount, 0);
    assert.equal(unresolvedFocusPacket.evidenceQuality.label, "weak");
    assert.equal(unresolvedFocusPacket.evidenceQuality.requestCoverage.status, "missing");
    assert.equal(unresolvedFocusPacket.evidenceQuality.requestCoverage.unresolvedCount, 4);
    assert.ok(
      unresolvedFocusPacket.evidenceQuality.reasons.some((reason) =>
        reason.includes("4/4 requested anchor(s) are uncovered or unchecked")
      ),
      "evidence quality should explain unresolved requested anchors",
    );
    assert.ok(
      unresolvedFocusPacket.evidenceQuality.recommendedAction.includes("Do not rely"),
      "evidence quality should steer agents away from broad fallback context when anchors miss",
    );
    for (const [kind, value] of [
      ["file", "missing/file.ts"],
      ["route", "/api/not-real"],
      ["symbol", "missingSymbolForGraphSeed"],
      ["database_object", "public.missing_table"],
    ] as const) {
      assert.ok(
        unresolvedFocusPacket.requestCoverage.items.some((item) =>
          item.kind === kind &&
          item.value === value &&
          item.status === "uncovered"
        ),
        `request coverage should report unresolved ${kind} anchor ${value}`,
      );
    }
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { term?: unknown };
        return tool.toolName === "cross_search" &&
          args.term === "missing/file.ts" &&
          tool.reason.includes("not covered");
      }),
      "uncovered file anchors should suggest cross_search with the missing path",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { route?: unknown };
        return tool.toolName === "route_context" &&
          args.route === "/api/not-real" &&
          tool.reason.includes("not covered");
      }),
      "uncovered route anchors should suggest route_context with the missing route",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { query?: unknown; targetKind?: unknown };
        return tool.toolName === "reef_where_used" &&
          args.query === "missingSymbolForGraphSeed" &&
          args.targetKind === "symbol";
      }),
      "uncovered symbol anchors should suggest reef_where_used with targetKind=symbol",
    );
    assert.ok(
      unresolvedFocusPacket.expandableTools.some((tool) => {
        const args = tool.suggestedArgs as { schemaName?: unknown; tableName?: unknown };
        return tool.toolName === "table_neighborhood" &&
          args.schemaName === "public" &&
          args.tableName === "missing_table" &&
          tool.reason.includes("not covered");
      }),
      "uncovered database anchors should suggest table_neighborhood with parsed schema/table args",
    );
    const unresolvedRepoMapCandidates = [
      ...unresolvedFocusPacket.primaryContext,
      ...unresolvedFocusPacket.relatedContext,
    ].filter((candidate) => candidate.source === "repo_map_provider");
    assert.ok(
      unresolvedRepoMapCandidates.length > 0,
      "unresolved graph anchors should still allow broad repo map fallback context",
    );
    assert.equal(
      unresolvedRepoMapCandidates.every((candidate) =>
        candidate.metadata?.graphRankMode === "global" &&
        candidate.metadata?.graphPersonalizationSeedCount === 0
      ),
      true,
      "unresolved graph anchors should not be reported as personalized repo map seeds",
    );

    const dashboardPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "review dashboard auth role checks",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeRisks: true,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.ok(
      dashboardPacket.risks.some((risk) =>
        risk.source === "open_loop" &&
        risk.code === "identity.boundary_mismatch" &&
        risk.reason.includes("app/dashboard/layout.tsx")
      ),
      "context_packet risks should include relevant active Reef findings",
    );
    const confidenceFilteredRiskPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "review dashboard auth role checks",
        focusFiles: ["app/dashboard/layout.tsx"],
        includeRisks: true,
        risksMinConfidence: 0.93,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assert.ok(
      confidenceFilteredRiskPacket.risks.length > 0,
      "high-confidence risks should still be returned",
    );
    assert.ok(
      confidenceFilteredRiskPacket.risks.every((risk) => risk.confidence >= 0.93),
      "risksMinConfidence should filter lower-confidence risk noise",
    );
    assert.ok(
      confidenceFilteredRiskPacket.risks.some((risk) => risk.source === "open_loop"),
      "high-confidence open-loop risks should survive the confidence floor",
    );

    const implementPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "implement",
        request: "implement the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(implementPacket, "implement packet");
    assert.equal(implementPacket.mode, "implement");
    assert.ok(implementPacket.limits.providersSkipped.includes("repo_map_provider"));
    assert.equal(implementPacket.limits.providersRun.includes("repo_map_provider"), false);
    const implementToolNames = implementPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      implementToolNames.includes("lint_files"),
      "implement mode should recommend lint_files",
    );
    assert.ok(
      implementToolNames.includes("ast_find_pattern"),
      "implement mode should recommend ast_find_pattern",
    );
    assert.equal(
      implementToolNames.includes("route_context"),
      false,
      "implement mode should not recommend route_context without a route anchor",
    );
    assert.equal(
      implementToolNames.includes("table_neighborhood"),
      false,
      "implement mode should not recommend table_neighborhood without a table anchor",
    );
    assert.equal(
      implementToolNames.includes("repo_map"),
      false,
      "implement mode should not recommend repo_map",
    );
    const implementAstFindPattern = implementPacket.expandableTools.find((tool) => tool.toolName === "ast_find_pattern");
    assert.deepEqual(
      implementAstFindPattern?.suggestedArgs,
      {
        projectId,
        pattern: "implement the auth callback user type fix",
        maxMatches: 50,
      },
      "ast_find_pattern suggestedArgs should match the strict schema",
    );
    const implementLintFiles = implementPacket.expandableTools.find((tool) => tool.toolName === "lint_files");
    assert.deepEqual(
      implementLintFiles?.suggestedArgs,
      {
        projectId,
        files: ["app/api/auth/callback/route.ts"],
      },
      "lint_files suggestedArgs should include required files",
    );

    const planPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "plan",
        request: "plan the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
        focusRoutes: ["/api/auth/callback"],
        focusDatabaseObjects: ["public.user_profiles"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(planPacket, "plan packet");
    const planToolNames = planPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(planToolNames.includes("change_plan"), "plan mode should recommend change_plan");
    assert.ok(planToolNames.includes("route_context"), "plan mode should recommend route_context");
    assert.ok(
      planToolNames.includes("table_neighborhood"),
      "plan mode should recommend table_neighborhood",
    );
    const planChangePlan = planPacket.expandableTools.find((tool) => tool.toolName === "change_plan");
    assert.deepEqual(
      planChangePlan?.suggestedArgs,
      {
        projectId,
        startEntity: { kind: "file", key: "app/api/auth/callback/route.ts" },
        targetEntity: { kind: "route", key: "/api/auth/callback" },
        direction: "both",
        traversalDepth: 3,
        includeHeuristicEdges: true,
      },
      "change_plan suggestedArgs should provide strict graph node locators",
    );
    const planRouteContext = planPacket.expandableTools.find((tool) => tool.toolName === "route_context");
    assert.ok(planRouteContext, "plan mode should attach a route_context entry");
    assert.equal(
      (planRouteContext?.suggestedArgs as { route?: unknown } | undefined)?.route,
      "/api/auth/callback",
      "route_context suggestedArgs should reflect focusRoutes",
    );
    const planTableNeighborhood = planPacket.expandableTools.find((tool) => tool.toolName === "table_neighborhood");
    assert.deepEqual(
      planTableNeighborhood?.suggestedArgs,
      {
        projectId,
        schemaName: "public",
        tableName: "user_profiles",
      },
      "table_neighborhood suggestedArgs should include required schema/table inputs",
    );

    const reviewPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        mode: "review",
        request: "review the auth callback user type fix",
        focusFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(reviewPacket, "review packet");
    const reviewToolNames = reviewPacket.expandableTools.map((tool) => tool.toolName);
    assert.ok(
      reviewToolNames.includes("verification_state"),
      "review mode should recommend verification_state",
    );
    assert.ok(reviewToolNames.includes("lint_files"), "review mode should recommend lint_files");
    assert.equal(
      reviewToolNames.includes("ast_find_pattern"),
      false,
      "review mode should not recommend ast_find_pattern",
    );

    const coercedAuthPath = await invokeTool(
      "auth_path",
      JSON.stringify({
        projectId,
        route: "/api/auth/callback",
      }),
      { hotIndexCache, requestContext: { requestId: "req_auth_path_coerced_smoke" } },
    ) as AuthPathToolOutput;
    assert.equal(coercedAuthPath.toolName, "auth_path");
    assert.equal(coercedAuthPath.projectId, projectId);
    assert.equal(coercedAuthPath.matched, true);

    const missingAuthPath = await invokeTool(
      "auth_path",
      {
        projectId,
        route: "/api/does-not-exist",
      },
      { hotIndexCache, requestContext: { requestId: "req_auth_path_fallback_smoke" } },
    ) as AuthPathToolOutput;
    assert.equal(missingAuthPath.toolName, "auth_path");
    assert.equal(missingAuthPath.matched, false);
    assert.match(missingAuthPath.reason ?? "", /No indexed match found/);
    assert.equal(missingAuthPath.fallbackReason, missingAuthPath.reason);
    assert.equal(missingAuthPath.suggestedNext?.tool, "cross_search");
    assert.equal(missingAuthPath.suggestedNext?.args.term, "/api/does-not-exist");

    const coercedTransportPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "where is getSession used by the auth callback?",
        focusSymbols: JSON.stringify(["getSession"]),
        focusRoutes: JSON.stringify(["/api/auth/callback"]),
        focusDatabaseObjects: JSON.stringify(["public.user_profiles"]),
        maxPrimaryContext: "5",
        maxRelatedContext: "3",
        budgetTokens: "1024",
        includeRisks: "false",
      },
      { hotIndexCache, requestContext: { requestId: "req_context_packet_coerced_smoke" } },
    ) as ContextPacketToolOutput;
    assert.equal(coercedTransportPacket.toolName, "context_packet");
    assert.equal(coercedTransportPacket.modePolicy.includeRisks, false);
    assert.ok(coercedTransportPacket.limits.budgetTokens <= 1024);
    assert.ok(coercedTransportPacket.primaryContext.length <= 5);

    await invokeTool(
      "context_packet",
      { projectId, request: "where is the login button?" },
      { hotIndexCache },
    );
    assert.equal(hotIndexCache.size(), 1, "second call should reuse the hot index for same run");

    process.env.MAKO_REEF_BACKED = "legacy";
    try {
      const legacyPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "my auth route is broken after changing the user type",
          focusFiles: ["app/api/auth/callback/route.ts"],
        },
        { hotIndexCache },
      ) as ContextPacketToolOutput;
      assert.equal(legacyPacket.activeFindings.length, 0);
      assert.ok(legacyPacket.warnings.some((warning) => warning.includes("MAKO_REEF_BACKED")));
    } finally {
      restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    }

    const restartedHotIndexCache = createHotIndexCache();
    try {
      const restartedPacket = await invokeTool(
        "context_packet",
        {
          projectId,
          request: "my auth route is broken after restart",
          focusFiles: ["app/api/auth/callback/route.ts"],
        },
        { hotIndexCache: restartedHotIndexCache },
      ) as ContextPacketToolOutput;
      assert.ok(restartedPacket.limits.providersRun.includes("hot_hint_index"));
      assert.equal(
        restartedHotIndexCache.size(),
        1,
        "fresh hot-index cache should rebuild from durable indexed facts",
      );
    } finally {
      restartedHotIndexCache.flush();
    }

    await invokeTool(
      "working_tree_overlay",
      { projectId, files: ["components/LoginButton.tsx"] },
      { hotIndexCache },
    );
    const overlayPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "the login button changed",
        changedFiles: ["components/LoginButton.tsx"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(overlayPacket, "overlay packet");
    const overlayCandidate = [...overlayPacket.primaryContext, ...overlayPacket.relatedContext]
      .find((candidate) => candidate.path === "components/LoginButton.tsx");
    assert.equal(overlayCandidate?.metadata?.overlay, "working_tree");
    assert.equal(overlayCandidate?.metadata?.overlaySource, "working_tree_overlay");
    assert.ok(overlayPacket.limits.providersRun.includes("working_tree_overlay"));

    const fallbackPacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "auth route changed",
        changedFiles: ["app/api/auth/callback/route.ts"],
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(fallbackPacket, "overlay fallback packet");
    assert.ok(
      fallbackPacket.warnings.some((warning) => warning.includes("no working-tree overlay facts")),
      "changed files without overlay facts should be called out",
    );
    assert.notEqual(
      fallbackPacket.evidenceQuality.label,
      "strong",
      "changed files without overlay facts should not be marked strong evidence",
    );
    assert.ok(
      fallbackPacket.evidenceQuality.reasons.some((reason) => reason.includes("lack working-tree overlay facts")),
      "evidence quality should explain missing overlay facts",
    );
    assert.ok(
      fallbackPacket.expandableTools.some((tool) => tool.toolName === "working_tree_overlay" && tool.readOnly === false),
      "context_packet should recommend the overlay mutation without running it",
    );

    writeFixtureFile(
      projectRoot,
      "lib/auth/session.ts",
      [
        "import type { UserSession } from '../../types/auth';",
        "export async function getSession(): Promise<UserSession> {",
        "  return { user: { id: 'u2', role: 'manager', stale: true } };",
        "}",
      ].join("\n"),
    );
    const stalePacket = await invokeTool(
      "context_packet",
      {
        projectId,
        request: "auth session stale index check",
        focusFiles: ["lib/auth/session.ts"],
        includeLiveHints: false,
      },
      { hotIndexCache },
    ) as ContextPacketToolOutput;
    assertExpandableToolsHaveValidArgs(stalePacket, "stale packet");
    assert.equal(stalePacket.indexFreshness?.state, "dirty");
    assert.equal(stalePacket.evidenceQuality.freshness.indexState, "dirty");
    assert.ok(
      stalePacket.evidenceQuality.staleContextCount > 0,
      "stale context should be counted in evidence quality",
    );
    assert.notEqual(
      stalePacket.evidenceQuality.label,
      "strong",
      "stale indexed context should not be marked strong evidence",
    );
    assert.ok(
      stalePacket.evidenceQuality.reasons.some((reason) => reason.includes("Indexed evidence freshness is dirty")),
      "evidence quality should explain stale indexed freshness",
    );
    assert.ok(
      stalePacket.warnings.some((warning) => warning.includes("stale, deleted, unindexed, or unknown")),
      "stale indexed files should still produce the existing warning",
    );

    const store = openProjectStore({ projectRoot });
    try {
      const events = store.queryUsefulnessEvents({
        decisionKind: "packet_usefulness",
        family: "context_packet",
      });
      assert.ok(events.length >= 1, "context_packet should emit packet usefulness telemetry");
      assert.equal(events.some((event) => event.requestId === "req_context_packet_smoke"), true);
    } finally {
      store.close();
    }

    console.log("context-packet: PASS");
  } finally {
    hotIndexCache.flush();
    if (originalStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = originalStateHome;
    }
    if (originalStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = originalStateDirName;
    }
    restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
