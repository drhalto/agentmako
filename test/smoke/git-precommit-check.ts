import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GitPrecommitCheckToolOutput } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

function runGit(projectRoot: string, args: string[]): void {
  execFileSync("git", args, {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true,
  });
}

function fileRecord(relPath: string, content: string) {
  return {
    path: relPath,
    sha256: relPath,
    language: relPath.endsWith(".tsx") ? "tsx" as const : "typescript" as const,
    sizeBytes: content.length,
    lineCount: content.split("\n").length,
    chunks: [{
      chunkKind: "file" as const,
      name: relPath,
      lineStart: 1,
      lineEnd: content.split("\n").length,
      content,
    }],
    symbols: [],
    imports: [],
    routes: [],
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "app", "api", "private"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "public"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "guarded"), { recursive: true });
  mkdirSync(path.join(projectRoot, "components"), { recursive: true });
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako"), { recursive: true });

  const files = {
    "package.json": JSON.stringify({ name: "git-precommit-check-smoke", version: "0.0.0" }),
    "app/api/private/route.ts": [
      "export async function GET() {",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n"),
    "app/api/public/route.ts": [
      "export async function GET() {",
      "  return Response.json({ public: true });",
      "}",
    ].join("\n"),
    "app/api/guarded/route.ts": [
      "import { requireAuth } from '../../../lib/auth';",
      "export async function GET() {",
      "  await requireAuth();",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n"),
    "components/Client.tsx": [
      "\"use client\";",
      "import { loadSecret } from '../lib/server';",
      "export function Client() {",
      "  return <button>{loadSecret()}</button>;",
      "}",
    ].join("\n"),
    "components/Server.tsx": [
      "export function Server() {",
      "  useEffect(() => {}, []);",
      "  return null;",
      "}",
    ].join("\n"),
    "lib/auth.ts": [
      "export async function requireAuth() {",
      "  return { id: 'user_1' };",
      "}",
    ].join("\n"),
    "lib/server.ts": [
      "import { cookies } from 'next/headers';",
      "export function loadSecret() {",
      "  return cookies().get('secret')?.value;",
      "}",
    ].join("\n"),
    ".mako/git-guard.json": JSON.stringify({
      publicRouteGlobs: ["app/api/public/route.ts"],
    }, null, 2),
  };

  for (const [relPath, content] of Object.entries(files)) {
    writeFileSync(path.join(projectRoot, relPath), `${content}\n`);
  }

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "git-precommit-check-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "native",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "git-precommit-check-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: ["lib/server.ts"],
      authGuardSymbols: ["requireAuth"],
      supportLevel: "native",
      detectedAt: new Date().toISOString(),
    });
    store.replaceIndexSnapshot({
      files: [
        fileRecord("lib/auth.ts", files["lib/auth.ts"]),
        fileRecord("lib/server.ts", files["lib/server.ts"]),
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-git-precommit-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  try {
    const projectId = randomUUID();
    seedProject(projectRoot, projectId);
    runGit(projectRoot, ["init"]);
    runGit(projectRoot, ["add", "."]);
    writeFileSync(path.join(projectRoot, "components", "Server.tsx"), [
      "\"use client\";",
      "export function Server() {",
      "  useEffect(() => {}, []);",
      "  return null;",
      "}",
      "",
    ].join("\n"));

    const result = await invokeTool("git_precommit_check", {
      projectId,
    }) as GitPrecommitCheckToolOutput;

    assert.equal(result.toolName, "git_precommit_check");
    assert.equal(result.continue, false);
    assert.ok(result.stagedChanges.some((change) =>
      change.status === "added" &&
      change.path === "components/Server.tsx"
    ));
    assert.ok(result.checkedFiles.includes("app/api/private/route.ts"));
    assert.ok(result.findings.some((finding) =>
      finding.code === "git.unprotected_route" &&
      finding.path === "app/api/private/route.ts"
    ));
    assert.ok(!result.findings.some((finding) => finding.path === "app/api/public/route.ts"));
    assert.ok(!result.findings.some((finding) => finding.path === "app/api/guarded/route.ts"));
    assert.ok(result.findings.some((finding) =>
      finding.code === "git.client_uses_server_only" &&
      finding.path === "components/Client.tsx"
    ));
    assert.ok(result.findings.some((finding) =>
      finding.code === "git.server_uses_client_hook" &&
      finding.path === "components/Server.tsx"
    ), "git_precommit_check must read the staged blob, not the fixed working-tree copy");
    assert.ok(result.stopReason?.includes("Pre-commit check failed"));

    const projectStore = openProjectStore({ projectRoot });
    try {
      const reefFindings = projectStore.queryReefFindings({
        projectId,
        overlay: "staged",
        source: "git_precommit_check",
      });
      assert.equal(
        reefFindings.length,
        result.findings.length,
        "git_precommit_check should persist staged findings into Reef",
      );
      assert.ok(
        reefFindings.every((finding) => finding.status === "active"),
        "persisted git_precommit_check findings start active",
      );
      assert.ok(
        projectStore.listReefRuleDescriptors().some((rule) => rule.id === "git.unprotected_route"),
        "git_precommit_check should register Reef rule descriptors",
      );
    } finally {
      projectStore.close();
    }

    runGit(projectRoot, ["config", "user.email", "mako@example.com"]);
    runGit(projectRoot, ["config", "user.name", "Mako Smoke"]);
    runGit(projectRoot, ["commit", "-m", "baseline", "--no-gpg-sign"]);
    runGit(projectRoot, ["rm", "components/Client.tsx"]);

    const deleteResult = await invokeTool("git_precommit_check", {
      projectId,
    }) as GitPrecommitCheckToolOutput;
    assert.equal(deleteResult.continue, true);
    assert.ok(deleteResult.stagedChanges.some((change) =>
      change.status === "deleted" &&
      change.path === "components/Client.tsx"
    ));
    assert.ok(!deleteResult.checkedFiles.includes("components/Client.tsx"));

    const storeAfterDelete = openProjectStore({ projectRoot });
    try {
      const activeAfterDelete = storeAfterDelete.queryReefFindings({
        projectId,
        overlay: "staged",
        source: "git_precommit_check",
      });
      assert.ok(
        !activeAfterDelete.some((finding) => finding.filePath === "components/Client.tsx"),
        "staged deletion should resolve prior findings for the deleted file",
      );
      const allAfterDelete = storeAfterDelete.queryReefFindings({
        projectId,
        overlay: "staged",
        source: "git_precommit_check",
        includeResolved: true,
        limit: 100,
      });
      assert.ok(allAfterDelete.some((finding) =>
        finding.filePath === "components/Client.tsx" &&
        finding.status === "resolved"
      ));
    } finally {
      storeAfterDelete.close();
    }

    runGit(projectRoot, ["commit", "-m", "delete client", "--no-gpg-sign"]);
    runGit(projectRoot, ["mv", "components/Server.tsx", "components/RenamedServer.tsx"]);
    writeFileSync(path.join(projectRoot, "components", "RenamedServer.tsx"), [
      "export function Server() {",
      "  useEffect(() => {}, []);",
      "  return null;",
      "}",
      "",
    ].join("\n"));
    runGit(projectRoot, ["add", "components/RenamedServer.tsx"]);

    const renameResult = await invokeTool("git_precommit_check", {
      projectId,
    }) as GitPrecommitCheckToolOutput;
    assert.equal(renameResult.continue, false);
    assert.ok(renameResult.stagedChanges.some((change) =>
      change.status === "renamed" &&
      change.oldPath === "components/Server.tsx" &&
      change.path === "components/RenamedServer.tsx"
    ));
    assert.ok(renameResult.findings.some((finding) =>
      finding.code === "git.server_uses_client_hook" &&
      finding.path === "components/RenamedServer.tsx"
    ));

    const storeAfterRename = openProjectStore({ projectRoot });
    try {
      const activeAfterRename = storeAfterRename.queryReefFindings({
        projectId,
        overlay: "staged",
        source: "git_precommit_check",
        limit: 100,
      });
      assert.ok(
        !activeAfterRename.some((finding) => finding.filePath === "components/Server.tsx"),
        "staged rename should resolve prior findings for the old path",
      );
      assert.ok(activeAfterRename.some((finding) =>
        finding.filePath === "components/RenamedServer.tsx" &&
        finding.status === "active"
      ));
    } finally {
      storeAfterRename.close();
    }

    console.log("git-precommit-check: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
