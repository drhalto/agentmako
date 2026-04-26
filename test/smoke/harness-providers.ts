/**
 * Phase 3.1 acceptance smoke (substrate side).
 *
 * Exercises the provider registry, catalog, and tier resolver without
 * making any actual model calls. Catches regressions in the layered
 * key-resolution chain and the bundled catalog.
 *
 * Sister test `harness-cloud-agent.ts` covers the full streamText path
 * against a mock OpenAI-compatible HTTP server.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUNDLED_CATALOG,
  ProviderSpecSchema,
} from "../../packages/harness-contracts/src/index.ts";
import {
  ProviderRegistry,
  createHarness,
  resolveTier,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function startMockLocalProvider(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "local-model" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("mock local provider failed to bind");
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function main(): Promise<void> {
  assert.ok(BUNDLED_CATALOG.providers.length >= 7, "catalog should have >=7 providers");
  for (const spec of BUNDLED_CATALOG.providers) {
    assert.ok(ProviderSpecSchema.safeParse(spec).success, `${spec.id} must round-trip schema`);
  }
  const ids = BUNDLED_CATALOG.providers.map((p) => p.id);
  for (const required of ["anthropic", "openai", "moonshot", "ollama", "ollama-cloud", "lmstudio"]) {
    assert.ok(ids.includes(required), `catalog must include ${required}`);
  }

  const cleanEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$/i.test(k)) delete process.env[k];
  }
  process.env.MAKO_OLLAMA_BASE_URL = "http://127.0.0.1:1/v1";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1/v1";
  process.env.MAKO_LMSTUDIO_BASE_URL = "http://127.0.0.1:2/v1";
  process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:2/v1";

  const registry = new ProviderRegistry({ noConfig: true, noKeyring: true });
  const all = registry.list();
  assert.ok(all.length === BUNDLED_CATALOG.providers.length, "registry mirrors catalog");
  for (const id of ids) assert.ok(registry.get(id), `registry should resolve ${id}`);

  const t1 = await resolveTier({ providerRegistry: registry });
  assert.equal(
    t1.current,
    "no-agent",
    `with no keys and unreachable local endpoints, tier should be no-agent (got ${t1.current})`,
  );

  const mockLocal = await startMockLocalProvider();
  let store: ReturnType<typeof openProjectStore> | undefined;

  try {
    registry.upsert({
      id: "reachable-local",
      name: "Reachable Local",
      kind: "chat",
      transport: "openai-compatible",
      baseURL: mockLocal.baseURL,
      auth: "none",
      envVarHints: [],
      models: [
        {
          id: "local-model",
          displayName: "Local Model",
          contextWindow: 8192,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: false,
          tier: "local",
        },
      ],
      tier: "local",
    });
    const tLocal = await resolveTier({ providerRegistry: registry });
    assert.equal(tLocal.current, "local-agent", "reachable local provider should promote to local-agent");

    process.env.MAKO_ANTHROPIC_API_KEY = "sk-test-fake-key-only";
    const t2 = await resolveTier({ providerRegistry: registry });
    assert.equal(t2.current, "cloud-agent", "MAKO_ANTHROPIC_API_KEY should promote to cloud-agent");
    delete process.env.MAKO_ANTHROPIC_API_KEY;

    process.env.MAKO_OPENAI_API_KEY = "sk-mako-canonical";
    const k1 = await registry.resolveApiKey("openai");
    assert.equal(k1.key, "sk-mako-canonical", "MAKO_<PROV>_API_KEY wins over vendor-standard");
    delete process.env.MAKO_OPENAI_API_KEY;

    process.env.OPENAI_API_KEY = "sk-vendor-standard";
    const k2 = await registry.resolveApiKey("openai");
    assert.equal(k2.key, "sk-vendor-standard", "vendor-standard env var resolves when MAKO_ is unset");
    delete process.env.OPENAI_API_KEY;

    const k3 = await registry.resolveApiKey("openai", { override: "sk-explicit" });
    assert.equal(k3.key, "sk-explicit", "explicit override beats env");

    process.env.MAKO_TEST_SECRET = "secret-from-env-indirection";
    const k4 = await registry.resolveApiKey("openai", {
      sessionOverride: "{env:MAKO_TEST_SECRET}",
    });
    assert.equal(k4.key, "secret-from-env-indirection", "{env:VAR} indirection is resolved");
    delete process.env.MAKO_TEST_SECRET;

    const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-providers-"));
    try {
      const projectDir = path.join(tmp, "project");
      const makoDir = path.join(projectDir, ".mako");
      mkdirSync(makoDir, { recursive: true });
      writeFileSync(
        path.join(makoDir, "providers.json"),
        JSON.stringify({
          providers: [
            {
              id: "my-lmstudio",
              name: "My LM Studio",
              kind: "chat",
              transport: "openai-compatible",
              baseURL: "http://localhost:1234/v1",
              auth: "none",
              tier: "local",
              models: [
                {
                  id: "qwen3-coder",
                  displayName: "Qwen3 Coder",
                  contextWindow: 32768,
                  supportsTools: true,
                  supportsVision: false,
                  supportsReasoning: false,
                  tier: "local",
                },
              ],
            },
          ],
        }),
      );
      const projReg = new ProviderRegistry({ projectRoot: projectDir });
      const custom = projReg.get("my-lmstudio");
      assert.ok(custom, "custom provider from .mako/providers.json should load");
      assert.equal(custom.source, "project-config", "custom provider source should be project-config");
      assert.equal(custom.spec.baseURL, "http://localhost:1234/v1");

      process.env.MAKO_PROJECT_PROVIDER_KEY = "sk-project-provider";
      await projReg.upsertPersistent({
        id: "persisted-openai-compatible",
        name: "Persisted OpenAI-Compatible",
        kind: "chat",
        transport: "openai-compatible",
        baseURL: "https://example.invalid/v1",
        apiKey: "{env:MAKO_PROJECT_PROVIDER_KEY}",
        auth: "api-key",
        envVarHints: [],
        models: [
          {
            id: "persisted-model",
            displayName: "Persisted Model",
            contextWindow: 8192,
            supportsTools: true,
            supportsVision: false,
            supportsReasoning: false,
            tier: "cloud",
          },
        ],
        tier: "cloud",
      });
      const reloaded = new ProviderRegistry({ projectRoot: projectDir });
      const persisted = reloaded.get("persisted-openai-compatible");
      assert.ok(persisted, "persisted provider should survive reload");
      assert.equal(persisted?.source, "project-config");
      const persistedKey = await reloaded.resolveApiKey("persisted-openai-compatible");
      assert.equal(persistedKey.key, "sk-project-provider");
      assert.equal(persistedKey.source, "project-config");
      const removed = await reloaded.removePersistent("persisted-openai-compatible");
      assert.equal(removed, true, "removePersistent should delete custom provider");
      assert.equal(
        new ProviderRegistry({ projectRoot: projectDir }).get("persisted-openai-compatible"),
        null,
      );

      writeFileSync(
        path.join(makoDir, "config.json"),
        JSON.stringify({ defaults: { tier: "cloud-agent" } }),
      );
      store = openProjectStore({ projectRoot: projectDir, stateDirName: ".mako-ai-provider-config-tier" });
      const harness = createHarness({ store, projectRoot: projectDir });
      const session = await harness.createSession({ title: "config-tier" });
      assert.equal(session.tier, "cloud-agent", "createSession should honor .mako/config.json defaults.tier");
    } finally {
      store?.close();
      rmSync(tmp, { recursive: true, force: true });
      delete process.env.MAKO_PROJECT_PROVIDER_KEY;
    }
  } finally {
    await new Promise<void>((resolve) => mockLocal.server.close(() => resolve()));
    process.env = cleanEnv;
  }

  console.log("harness-providers: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
