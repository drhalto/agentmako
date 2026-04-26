export const DEFAULT_APP_NAME = "mako-ai";
export const DEFAULT_STATE_DIRNAME = ".mako-ai";
export const DEFAULT_GLOBAL_DB_FILENAME = "global.db";
export const DEFAULT_PROJECT_DB_FILENAME = "project.db";
export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 3017;

export const DEFAULT_ANSWER_BUDGETS = {
  fast: 4_000,
  standard: 16_000,
  deep: 64_000,
} as const;
