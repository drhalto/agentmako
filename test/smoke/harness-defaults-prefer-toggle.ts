import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  projectConfigPath,
  readResolvedDefaults,
  writeGlobalDefaults,
} from "../../packages/config/src/index.ts";

async function main(): Promise<void> {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "mako-defaults-toggle-"));
  const projectRoot = path.join(tempHome, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  process.env.MAKO_STATE_HOME = tempHome;

  try {
    mkdirSync(projectRoot, { recursive: true });

    writeGlobalDefaults({
      agent: {
        cloud: { providerId: "ollama-cloud", modelId: "kimi-k2.5:cloud" },
        local: { providerId: "ollama", modelId: "qwen3.6:35b-a3b" },
        prefer: "local",
      },
    });

    const noProjectOverride = readResolvedDefaults(projectRoot);
    assert.equal(
      noProjectOverride.agent.prefer,
      "local",
      "missing project config must not reset global prefer back to cloud",
    );

    mkdirSync(path.dirname(projectConfigPath(projectRoot)), { recursive: true });
    writeFileSync(
      projectConfigPath(projectRoot),
      JSON.stringify(
        {
          defaults: {
            agent: {
              local: { providerId: "ollama", modelId: "qwen3.6:35b-a3b" },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const slotOnlyProjectOverride = readResolvedDefaults(projectRoot);
    assert.equal(
      slotOnlyProjectOverride.agent.prefer,
      "local",
      "project slot overrides must not inject a default prefer value",
    );

    writeFileSync(
      projectConfigPath(projectRoot),
      JSON.stringify(
        {
          defaults: {
            agent: {
              prefer: "cloud",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const explicitProjectPrefer = readResolvedDefaults(projectRoot);
    assert.equal(
      explicitProjectPrefer.agent.prefer,
      "cloud",
      "explicit project prefer should still override the global setting",
    );

    console.log("harness-defaults-prefer-toggle: PASS");
  } finally {
    if (originalStateHome === undefined) delete process.env.MAKO_STATE_HOME;
    else process.env.MAKO_STATE_HOME = originalStateHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
