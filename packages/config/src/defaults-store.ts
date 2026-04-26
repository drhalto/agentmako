/**
 * Defaults store — read/write `~/.mako-ai/config.json` (and project-level
 * `<projectRoot>/.mako/config.json` once project overrides land) for the
 * persistent agent and embedding axis preferences.
 *
 * `loadConfig()` in `env.ts` only reads env vars + caller overrides, so
 * the on-disk file is the single source of truth for the new
 * `defaults.agent` / `defaults.embedding` blocks. We touch only those
 * keys when writing, preserving any other keys the file may carry.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStateDir, resolveProjectStateDir } from "./paths.js";
import {
  AxisDefaultsSchemaValidator,
  type AxisDefaults,
  type AxisPrefer,
  type ModelSlot,
} from "./schema.js";

const CONFIG_FILENAME = "config.json";

/**
 * Defaults block we own — what we read out of the file and write back.
 * The file may contain unrelated keys; we never touch them.
 */
export interface PersistedDefaults {
  agent: AxisDefaults;
  embedding: AxisDefaults;
}

interface AxisOverride {
  cloud?: ModelSlot;
  local?: ModelSlot;
  prefer?: AxisPrefer;
}

interface PersistedDefaultsOverride {
  agent: AxisOverride;
  embedding: AxisOverride;
}

const EMPTY_AXIS: AxisDefaults = {
  cloud: null,
  local: null,
  prefer: "cloud",
};

export function emptyDefaults(): PersistedDefaults {
  return { agent: { ...EMPTY_AXIS }, embedding: { ...EMPTY_AXIS } };
}

/** Path to the global config file. Honors `MAKO_STATE_HOME` like the rest of the system. */
export function globalConfigPath(): string {
  return join(resolveStateDir(), CONFIG_FILENAME);
}

/** Path to the project config file under `<projectRoot>/.mako-ai/config.json`. */
export function projectConfigPath(projectRoot: string): string {
  return join(resolveProjectStateDir(projectRoot), CONFIG_FILENAME);
}

/**
 * Read the on-disk JSON config. Returns the parsed JSON object, or an
 * empty object when the file is missing or unreadable. Never throws —
 * every consumer needs a sensible default.
 */
function readJsonObject(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    if (raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Parse the `defaults` block out of a raw JSON config. Missing or
 * malformed entries return the empty axis. Each axis is parsed
 * independently so a corrupt agent block doesn't poison the embedding
 * block.
 */
function parseDefaultsBlock(raw: Record<string, unknown>): PersistedDefaults {
  const defaults = isPlainObject(raw.defaults) ? raw.defaults : {};
  return {
    agent: parseAxis(defaults.agent),
    embedding: parseAxis(defaults.embedding),
  };
}

function parseDefaultsOverrideBlock(raw: Record<string, unknown>): PersistedDefaultsOverride {
  const defaults = isPlainObject(raw.defaults) ? raw.defaults : {};
  return {
    agent: parseAxisOverride(defaults.agent),
    embedding: parseAxisOverride(defaults.embedding),
  };
}

function parseAxis(value: unknown): AxisDefaults {
  if (!isPlainObject(value)) return { ...EMPTY_AXIS };
  const result = AxisDefaultsSchemaValidator.safeParse(value);
  if (!result.success) return { ...EMPTY_AXIS };
  return result.data;
}

function parseAxisOverride(value: unknown): AxisOverride {
  if (!isPlainObject(value)) return {};

  const out: AxisOverride = {};
  if ("cloud" in value) {
    const cloud = parseSlot(value.cloud);
    if (cloud !== undefined) out.cloud = cloud;
  }
  if ("local" in value) {
    const local = parseSlot(value.local);
    if (local !== undefined) out.local = local;
  }
  if (value.prefer === "cloud" || value.prefer === "local") {
    out.prefer = value.prefer;
  }
  return out;
}

function parseSlot(value: unknown): ModelSlot | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (typeof value.providerId !== "string" || value.providerId.length === 0) return undefined;
  if (typeof value.modelId !== "string" || value.modelId.length === 0) return undefined;
  return {
    providerId: value.providerId,
    modelId: value.modelId,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read merged defaults: project overrides global per axis-key. */
export function readResolvedDefaults(projectRoot?: string): PersistedDefaults {
  const global = parseDefaultsBlock(readJsonObject(globalConfigPath()));
  if (!projectRoot) return global;

  const project = parseDefaultsOverrideBlock(readJsonObject(projectConfigPath(projectRoot)));
  return {
    agent: mergeAxis(global.agent, project.agent),
    embedding: mergeAxis(global.embedding, project.embedding),
  };
}

/**
 * Per-key axis merge. Project values take precedence over global, but
 * only where the project actually set something — leaving a field at
 * `null` does NOT clear a global setting (that would make project
 * overrides destructive by accident). Set `prefer` explicitly on the
 * project to override the global toggle.
 */
function mergeAxis(base: AxisDefaults, override: AxisOverride): AxisDefaults {
  return {
    cloud: override.cloud ?? base.cloud,
    local: override.local ?? base.local,
    prefer: override.prefer ?? base.prefer,
  };
}

export function readGlobalDefaults(): PersistedDefaults {
  return parseDefaultsBlock(readJsonObject(globalConfigPath()));
}

export interface DefaultsPatch {
  agent?: Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }>;
  embedding?: Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }>;
}

/**
 * Apply a partial patch to the global config file. Preserves any
 * non-`defaults` keys (so this stays safe to use even if the file ends
 * up with future fields we don't know about). Atomic write via temp
 * file + rename so a crash mid-write can't corrupt the config.
 */
export function writeGlobalDefaults(patch: DefaultsPatch): PersistedDefaults {
  const path = globalConfigPath();
  const current = readJsonObject(path);
  const currentDefaults = parseDefaultsBlock(current);

  const nextDefaults: PersistedDefaults = {
    agent: applyAxisPatch(currentDefaults.agent, patch.agent),
    embedding: applyAxisPatch(currentDefaults.embedding, patch.embedding),
  };

  const merged: Record<string, unknown> = {
    ...current,
    defaults: {
      ...(isPlainObject(current.defaults) ? current.defaults : {}),
      agent: nextDefaults.agent,
      embedding: nextDefaults.embedding,
    },
  };

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(merged, null, 2), "utf8");
  renameSync(tempPath, path);

  return nextDefaults;
}

function applyAxisPatch(
  current: AxisDefaults,
  patch: DefaultsPatch["agent"] | DefaultsPatch["embedding"],
): AxisDefaults {
  if (!patch) return current;
  return {
    cloud: "cloud" in patch ? (patch.cloud ?? null) : current.cloud,
    local: "local" in patch ? (patch.local ?? null) : current.local,
    prefer: patch.prefer ?? current.prefer,
  };
}

// =============================================================================
// Active-slot resolution
// =============================================================================

export type AxisSource = "primary" | "fallback" | "none";

export interface ResolvedAxis {
  active: ModelSlot;            // null when no usable slot exists
  source: AxisSource;
  /** When `source === "fallback" | "none"`, why we didn't use `prefer`. */
  reason?: string;
}

/**
 * Caller-provided availability check. Given a (providerId, modelId)
 * pair, return `null` if the slot is usable right now; otherwise return
 * a short human-readable reason ("no api key", "unreachable", etc.).
 *
 * Kept as a callback so this module stays free of HTTP / harness deps.
 */
export type SlotAvailability = (slot: { providerId: string; modelId: string }) => string | null;

/**
 * Pick the active slot for an axis with the user's preferred slot first
 * and the other slot as fallback when the preferred one is unusable.
 *
 * Resolution:
 *   1. If `prefer` slot is configured AND usable → primary.
 *   2. Else if the other slot is configured AND usable → fallback.
 *   3. Else none.
 *
 * `reason` is populated when we fall back or fail to resolve so the UI
 * can explain to the operator why their cloud agent is "off" today.
 */
export function resolveAxis(axis: AxisDefaults, isUsable: SlotAvailability): ResolvedAxis {
  const preferred = axis.prefer === "cloud" ? axis.cloud : axis.local;
  const other = axis.prefer === "cloud" ? axis.local : axis.cloud;
  const preferredLabel = axis.prefer;
  const otherLabel = axis.prefer === "cloud" ? "local" : "cloud";

  if (preferred) {
    const reason = isUsable(preferred);
    if (reason === null) {
      return { active: preferred, source: "primary" };
    }
    if (other) {
      const otherReason = isUsable(other);
      if (otherReason === null) {
        return {
          active: other,
          source: "fallback",
          reason: `${preferredLabel} unavailable: ${reason}`,
        };
      }
      return {
        active: null,
        source: "none",
        reason: `${preferredLabel} unavailable: ${reason}; ${otherLabel} unavailable: ${otherReason}`,
      };
    }
    return {
      active: null,
      source: "none",
      reason: `${preferredLabel} unavailable: ${reason}; no ${otherLabel} configured`,
    };
  }

  if (other) {
    const otherReason = isUsable(other);
    if (otherReason === null) {
      return {
        active: other,
        source: "fallback",
        reason: `no ${preferredLabel} configured`,
      };
    }
    return {
      active: null,
      source: "none",
      reason: `no ${preferredLabel} configured; ${otherLabel} unavailable: ${otherReason}`,
    };
  }

  return {
    active: null,
    source: "none",
    reason: "no slots configured",
  };
}
