/**
 * Resolves the current harness tier.
 *
 * Phase 3.0 shipped the no-agent tier only. Phase 3.1 promotes a session to
 * `local-agent` or `cloud-agent` automatically when the substrate supports it.
 * The layered precedence (explicit session override → project config →
 * user global config → auto) is shared by every future resolver call path.
 */

import type {
  HarnessTier,
  TierResolution,
} from "@mako-ai/harness-contracts";
import { loadHarnessConfig } from "./local-config.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface ResolveTierInput {
  explicitTier?: HarnessTier;
  projectRoot?: string;
  globalConfigDir?: string;
  /** When provided, used to detect available providers for the auto path. */
  providerRegistry?: ProviderRegistry;
}

export async function resolveTier(input: ResolveTierInput = {}): Promise<TierResolution> {
  return resolveTierFromConfig(input);
}

export async function resolveTierFromConfig(options: ResolveTierInput = {}): Promise<TierResolution> {
  const config = loadHarnessConfig({
    projectRoot: options.projectRoot,
    globalConfigDir: options.globalConfigDir,
  });

  const input = {
    explicitTier: options.explicitTier,
    projectConfigTier: config.projectDefaultsTier,
    globalConfigTier: config.globalDefaultsTier,
    providerRegistry: options.providerRegistry,
  };

  if (input.explicitTier) {
    return {
      current: input.explicitTier,
      reason: "explicit session override",
      upgradePath: upgradePathFor(input.explicitTier),
    };
  }
  if (input.projectConfigTier) {
    return {
      current: input.projectConfigTier,
      reason: ".mako/config.json defaults.tier",
      upgradePath: upgradePathFor(input.projectConfigTier),
    };
  }
  if (input.globalConfigTier) {
    return {
      current: input.globalConfigTier,
      reason: "~/.mako/config.json defaults.tier",
      upgradePath: upgradePathFor(input.globalConfigTier),
    };
  }
  if (input.providerRegistry) {
    return resolveAutoFromRegistry(input.providerRegistry);
  }
  return {
    current: "no-agent",
    reason: "no provider configured",
    upgradePath: defaultUpgradePath(),
  };
}

async function resolveAutoFromRegistry(registry: ProviderRegistry): Promise<TierResolution> {
  const cloudWithKey: string[] = [];
  const localReachable: string[] = [];

  for (const { spec } of registry.list()) {
    if (spec.tier === "cloud" && spec.auth === "api-key") {
      const { key } = await registry.resolveApiKey(spec.id);
      if (key) {
        cloudWithKey.push(spec.id);
      }
      continue;
    }
    if (spec.tier === "local" && spec.auth === "none") {
      const probe = await registry.probeLocalProvider(spec.id);
      if (probe.ok) {
        localReachable.push(spec.id);
      }
    }
  }

  if (cloudWithKey.length > 0) {
    return {
      current: "cloud-agent",
      reason: `cloud provider key detected: ${cloudWithKey.join(", ")}`,
      upgradePath: [],
    };
  }
  if (localReachable.length > 0) {
    return {
      current: "local-agent",
      reason: `local provider reachable: ${localReachable.join(", ")}`,
      upgradePath: ["set a BYOK API key (e.g. `MAKO_ANTHROPIC_API_KEY`) → unlocks cloud-agent"],
    };
  }
  return {
    current: "no-agent",
    reason: "no provider key in env and no local provider declared",
    upgradePath: defaultUpgradePath(),
  };
}

function defaultUpgradePath(): string[] {
  return [
    "install and run Ollama, or set `OLLAMA_BASE_URL` → unlocks local-agent",
    "set a BYOK API key (e.g. `MAKO_ANTHROPIC_API_KEY`, `MAKO_MOONSHOT_API_KEY`) → unlocks cloud-agent",
  ];
}

function upgradePathFor(tier: HarnessTier): string[] {
  if (tier === "no-agent") return defaultUpgradePath();
  if (tier === "local-agent") {
    return ["set a BYOK API key (e.g. `MAKO_ANTHROPIC_API_KEY`) → unlocks cloud-agent"];
  }
  return [];
}
