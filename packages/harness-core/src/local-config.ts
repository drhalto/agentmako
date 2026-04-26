import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { HarnessTierSchema } from "@mako-ai/harness-contracts";
import { createLogger } from "@mako-ai/logger";

const configLogger = createLogger("mako-harness-local-config");

const EmbeddingDefaultsSchema = z
  .object({
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .optional();

const HarnessLocalConfigSchema = z
  .object({
    defaults: z
      .object({
        tier: HarnessTierSchema.optional(),
        embedding: EmbeddingDefaultsSchema,
      })
      .optional(),
    harness: z
      .object({
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
      })
      .optional(),
  })
  .passthrough();

type HarnessLocalConfig = z.infer<typeof HarnessLocalConfigSchema>;

export interface EmbeddingDefaults {
  provider?: string;
  model?: string;
}

export interface HarnessConfigLookup {
  projectDefaultsTier?: z.infer<typeof HarnessTierSchema>;
  globalDefaultsTier?: z.infer<typeof HarnessTierSchema>;
  projectEmbeddingDefaults?: EmbeddingDefaults;
  globalEmbeddingDefaults?: EmbeddingDefaults;
  projectHarnessHost?: string;
  globalHarnessHost?: string;
  projectHarnessPort?: number;
  globalHarnessPort?: number;
}

export function resolveGlobalConfigDir(globalConfigDir?: string): string {
  return globalConfigDir ?? join(homedir(), ".mako");
}

export function resolveProjectConfigDir(projectRoot?: string): string | null {
  return projectRoot ? join(projectRoot, ".mako") : null;
}

function readConfigFile(path: string): HarnessLocalConfig | null {
  if (!existsSync(path)) return null;
  try {
    return HarnessLocalConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    configLogger.warn("harness.local-config.invalid", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function loadHarnessConfig(options: {
  projectRoot?: string;
  globalConfigDir?: string;
}): HarnessConfigLookup {
  const globalConfig = readConfigFile(
    join(resolveGlobalConfigDir(options.globalConfigDir), "config.json"),
  );
  const projectConfigDir = resolveProjectConfigDir(options.projectRoot);
  const projectConfig = projectConfigDir
    ? readConfigFile(join(projectConfigDir, "config.json"))
    : null;
  return {
    projectDefaultsTier: projectConfig?.defaults?.tier,
    globalDefaultsTier: globalConfig?.defaults?.tier,
    projectEmbeddingDefaults: projectConfig?.defaults?.embedding ?? undefined,
    globalEmbeddingDefaults: globalConfig?.defaults?.embedding ?? undefined,
    projectHarnessHost: projectConfig?.harness?.host,
    globalHarnessHost: globalConfig?.harness?.host,
    projectHarnessPort: projectConfig?.harness?.port,
    globalHarnessPort: globalConfig?.harness?.port,
  };
}
