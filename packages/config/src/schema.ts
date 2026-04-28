import { z } from "zod";
import {
  DEFAULT_ANSWER_BUDGETS,
  DEFAULT_APP_NAME,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_GLOBAL_DB_FILENAME,
  DEFAULT_PROJECT_DB_FILENAME,
  DEFAULT_STATE_DIRNAME,
} from "./defaults.js";

const ExtensionsSchema = z.object({
  filesystem: z.boolean().default(true),
  github: z.boolean().default(false),
  postgres: z.boolean().default(true),
  supabase: z.boolean().default(true),
  openai: z.boolean().default(false),
  anthropic: z.boolean().default(false),
});

const AnswerBudgetsSchema = z.object({
  fast: z.number().int().positive().default(DEFAULT_ANSWER_BUDGETS.fast),
  standard: z.number().int().positive().default(DEFAULT_ANSWER_BUDGETS.standard),
  deep: z.number().int().positive().default(DEFAULT_ANSWER_BUDGETS.deep),
});

const DatabaseToolsSchema = z.object({
  enabled: z.boolean().default(true),
});

const HarnessTierSchema = z.enum(["no-agent", "local-agent", "cloud-agent"]);

/**
 * One configured slot — a (provider, model) pair the user has pinned for
 * a specific axis (cloud agent, local embedding, etc.). Both keys must
 * be non-empty; we accept `null` at the schema level to make "no slot
 * configured" round-trip cleanly through JSON.
 */
const SlotSchema = z
  .object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  })
  .nullable();

const PreferSchema = z.enum(["cloud", "local"]);

/**
 * Per-axis defaults: two slots (cloud, local) plus a `prefer` toggle the
 * user flips explicitly. Resolution at consumption time is:
 *   1. Try the `prefer` slot — if usable, use it.
 *   2. Otherwise try the other slot — if usable, use it (fallback).
 *   3. Otherwise no model is active for this axis.
 */
const AxisDefaultsSchema = z.object({
  cloud: SlotSchema.default(null),
  local: SlotSchema.default(null),
  prefer: PreferSchema.default("cloud"),
});

const DefaultsSchema = z.object({
  tier: HarnessTierSchema.optional(),
  agent: AxisDefaultsSchema.optional(),
  embedding: AxisDefaultsSchema.optional(),
});

export type AxisDefaults = z.infer<typeof AxisDefaultsSchema>;
export type ModelSlot = z.infer<typeof SlotSchema>;
export type AxisPrefer = z.infer<typeof PreferSchema>;
export const AxisDefaultsSchemaValidator = AxisDefaultsSchema;

const HarnessConfigSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

const ReefConfigSchema = z.object({
  mode: z.enum(["auto", "required", "legacy"]).default("auto"),
});

export const MakoConfigSchema = z.object({
  appName: z.string().min(1).default(DEFAULT_APP_NAME),
  stateHome: z.string().min(1).optional(),
  stateDirName: z.string().min(1).default(DEFAULT_STATE_DIRNAME),
  globalDbFilename: z.string().min(1).default(DEFAULT_GLOBAL_DB_FILENAME),
  projectDbFilename: z.string().min(1).default(DEFAULT_PROJECT_DB_FILENAME),
  apiHost: z.string().min(1).default(DEFAULT_API_HOST),
  apiPort: z.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
  supportTarget: z.string().min(1).default("js-ts-web-postgres"),
  answerBudgets: AnswerBudgetsSchema.default(DEFAULT_ANSWER_BUDGETS),
  defaults: DefaultsSchema.optional(),
  extensions: ExtensionsSchema.default({
    filesystem: true,
    github: false,
    postgres: true,
    supabase: true,
    openai: false,
    anthropic: false,
  }),
  databaseTools: DatabaseToolsSchema.default({ enabled: true }),
  harness: HarnessConfigSchema.optional(),
  reef: ReefConfigSchema.default({ mode: "auto" }),
});

export type MakoConfig = z.infer<typeof MakoConfigSchema>;
