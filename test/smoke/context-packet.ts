import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { ContextPacketToolOutput, ProjectFinding } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

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

  writeFixtureFile(projectRoot, "app/api/auth/callback/route.ts", routeContent);
  writeFixtureFile(projectRoot, "lib/auth/session.ts", sessionContent);
  writeFixtureFile(projectRoot, "types/auth.ts", typeContent);
  writeFixtureFile(projectRoot, "components/LoginButton.tsx", loginContent);
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

    assert.equal(packet.toolName, "context_packet");
    assert.equal(packet.projectId, projectId);
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
    assert.ok(packet.limits.providersRun.includes("hot_hint_index"));
    assert.equal(hotIndexCache.size(), 1, "first call should build one hot index");

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
    assert.ok(
      fallbackPacket.warnings.some((warning) => warning.includes("no working-tree overlay facts")),
      "changed files without overlay facts should be called out",
    );
    assert.ok(
      fallbackPacket.expandableTools.some((tool) => tool.toolName === "working_tree_overlay" && tool.readOnly === false),
      "context_packet should recommend the overlay mutation without running it",
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
