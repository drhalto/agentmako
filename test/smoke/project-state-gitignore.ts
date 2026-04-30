import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachProject } from "../../services/indexer/src/attach.ts";
import { rmSyncRetry } from "./state-cleanup.ts";

const EXPECTED_GITIGNORE =
  "# agentmako project state — local indexes, snapshots, scratch DB.\n" +
  "# Safe to delete; regenerated on next `agentmako connect`.\n" +
  "*\n" +
  "!.gitignore\n";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-project-state-gitignore-"));
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "home");
  const projectStateDir = path.join(projectRoot, ".mako-ai");
  const gitignorePath = path.join(projectStateDir, ".gitignore");
  const previousStateHome = process.env.MAKO_STATE_HOME;
  const previousStateDirName = process.env.MAKO_STATE_DIRNAME;

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(stateHome, { recursive: true });
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "project-state-gitignore-smoke", version: "0.0.0" }),
      "utf8",
    );

    process.env.MAKO_STATE_HOME = stateHome;
    delete process.env.MAKO_STATE_DIRNAME;

    const options = { configOverrides: { stateDirName: ".mako-ai" } };

    attachProject(projectRoot, options, { logLifecycleEvent: false });
    assert.ok(existsSync(gitignorePath), "attachProject should create .mako-ai/.gitignore");
    assert.equal(readFileSync(gitignorePath, "utf8"), EXPECTED_GITIGNORE);

    const customGitignore = "# downstream customization\n*\n!important-local-state\n";
    writeFileSync(gitignorePath, customGitignore, "utf8");

    attachProject(projectRoot, options, { logLifecycleEvent: false });
    assert.equal(
      readFileSync(gitignorePath, "utf8"),
      customGitignore,
      "attachProject should not overwrite an existing .mako-ai/.gitignore",
    );

    console.log("project-state-gitignore: PASS");
  } finally {
    if (previousStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = previousStateHome;
    }
    if (previousStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = previousStateDirName;
    }
    rmSyncRetry(tmp);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
