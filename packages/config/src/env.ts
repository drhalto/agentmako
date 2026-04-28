import { MakoConfigSchema, type MakoConfig } from "./schema.js";

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function loadConfig(overrides: Partial<MakoConfig> = {}): MakoConfig {
  return MakoConfigSchema.parse({
    appName: process.env.MAKO_APP_NAME,
    stateHome: process.env.MAKO_STATE_HOME,
    stateDirName: process.env.MAKO_STATE_DIRNAME,
    globalDbFilename: process.env.MAKO_GLOBAL_DB_FILENAME,
    projectDbFilename: process.env.MAKO_PROJECT_DB_FILENAME,
    apiHost: process.env.MAKO_API_HOST,
    apiPort: parseOptionalInteger(process.env.MAKO_API_PORT),
    supportTarget: process.env.MAKO_SUPPORT_TARGET,
    extensions: {
      filesystem: parseOptionalBoolean(process.env.MAKO_ENABLE_FILESYSTEM),
      github: parseOptionalBoolean(process.env.MAKO_ENABLE_GITHUB),
      postgres: parseOptionalBoolean(process.env.MAKO_ENABLE_POSTGRES),
      supabase: parseOptionalBoolean(process.env.MAKO_ENABLE_SUPABASE),
      openai: parseOptionalBoolean(process.env.MAKO_ENABLE_OPENAI),
      anthropic: parseOptionalBoolean(process.env.MAKO_ENABLE_ANTHROPIC),
    },
    databaseTools: {
      enabled: parseOptionalBoolean(process.env.MAKO_DB_TOOLS_ENABLED) ?? true,
    },
    reef: process.env.MAKO_REEF_MODE
      ? { mode: process.env.MAKO_REEF_MODE }
      : undefined,
    ...overrides,
  });
}
