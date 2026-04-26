/**
 * Provider registry — single source of truth for which providers exist,
 * which models live under each, and where their API keys come from.
 *
 * Layered key resolution (first match wins):
 *   1. Explicit arg passed to `resolveApiKey({ override })`
 *   2. Session-level override (handled by callers reading from session row)
 *   3. Project config — `.mako/providers.json` at project root
 *   4. Global config — `~/.mako/providers.json`
 *   5. Env vars — canonical `MAKO_<PROVIDER>_API_KEY` first, then vendor-standard hints
 *   6. System keychain via `@napi-rs/keyring` (service `mako-ai`, account `<provider-id>`)
 *   7. Reserved seam: OAuth (Phase 4+) — not implemented in 3.1
 *
 * `{env:VAR_NAME}` indirection is resolved at read time. Config files never
 * embed secrets directly when this form is used.
 *
 * Phase 3.1 ships this registry hot-loaded with the bundled catalog and any
 * custom providers discovered in config. Refresh from upstream is exposed
 * via `applyUpstreamCatalog()` — only the HTTP route uses it today.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BUNDLED_CATALOG,
  ProviderSpecSchema,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import { createLogger } from "@mako-ai/logger";
import { resolveGlobalConfigDir, resolveProjectConfigDir } from "./local-config.js";
import { openKeyring, type KeyringHandle } from "./keyring.js";

const registryLogger = createLogger("mako-harness-provider-registry");

const ENV_INDIRECTION_RE = /^\{env:([A-Z_][A-Z0-9_]*)\}$/i;

export interface ProviderRegistryOptions {
  projectRoot?: string;
  globalConfigDir?: string;
  /** When true, skip reading config files. Used by tests. */
  noConfig?: boolean;
  /** When true, skip OS keyring resolution. Used by deterministic tests. */
  noKeyring?: boolean;
}

export interface ResolvedProvider {
  spec: ProviderSpec;
  source: "bundled" | "project-config" | "global-config" | "upstream-refresh";
}

interface CustomProviderFile {
  providers: unknown[];
}

function readProvidersFile(path: string): ProviderSpec[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CustomProviderFile;
    return (raw.providers ?? []).map((entry) => ProviderSpecSchema.parse(entry));
  } catch (error) {
    registryLogger.warn("providers-file.failed", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function readProvidersFileStrict(path: string): ProviderSpec[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as CustomProviderFile;
  return (raw.providers ?? []).map((entry) => ProviderSpecSchema.parse(entry));
}

function writeProvidersFile(path: string, providers: ProviderSpec[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ providers }, null, 2)}\n`, "utf8");
}

function resolveEnvIndirection(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const match = ENV_INDIRECTION_RE.exec(value.trim());
  if (!match) return value;
  return process.env[match[1]!];
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ResolvedProvider>();
  private keyring: KeyringHandle | null = null;
  private keyringPromise: Promise<KeyringHandle> | null = null;

  constructor(private readonly options: ProviderRegistryOptions = {}) {
    for (const spec of BUNDLED_CATALOG.providers) {
      this.providers.set(spec.id, { spec, source: "bundled" });
    }
    if (!options.noConfig) {
      this.loadConfigOverlays();
    }
  }

  private loadConfigOverlays(): void {
    const globalDir = resolveGlobalConfigDir(this.options.globalConfigDir);
    for (const spec of readProvidersFile(join(globalDir, "providers.json"))) {
      this.providers.set(spec.id, { spec, source: "global-config" });
    }
    const projectDir = resolveProjectConfigDir(this.options.projectRoot);
    if (projectDir) {
      for (const spec of readProvidersFile(join(projectDir, "providers.json"))) {
        this.providers.set(spec.id, { spec, source: "project-config" });
      }
    }
  }

  list(): ResolvedProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): ResolvedProvider | null {
    return this.providers.get(id) ?? null;
  }

  /** Add or replace a custom provider in-memory only (for HTTP `POST /providers`). */
  upsert(spec: ProviderSpec): void {
    this.providers.set(spec.id, { spec, source: "project-config" });
  }

  /**
   * Replace a provider spec in-memory while preserving its current source.
   *
   * Used by runtime catalog refreshes and local-daemon model discovery so the
   * registry the harness executes against stays aligned with the `/providers`
   * response surface. When the provider does not exist yet, treat it as an
   * upstream/runtime entry.
   */
  applyRuntimeSpec(spec: ProviderSpec): void {
    const existing = this.providers.get(spec.id);
    this.providers.set(spec.id, {
      spec,
      source: existing?.source ?? "upstream-refresh",
    });
  }

  async upsertPersistent(
    spec: ProviderSpec,
    source: Extract<ResolvedProvider["source"], "project-config" | "global-config"> = "project-config",
  ): Promise<void> {
    const path = this.providersPathForSource(source);
    if (!path) {
      throw new Error(`provider config path unavailable for source: ${source}`);
    }
    const providers = readProvidersFileStrict(path).filter((entry) => entry.id !== spec.id);
    providers.push(spec);
    writeProvidersFile(path, providers);
    this.providers.set(spec.id, { spec, source });
  }

  /** Remove a custom provider from the in-memory registry. Bundled providers cannot be removed. */
  remove(id: string): boolean {
    const entry = this.providers.get(id);
    if (!entry || entry.source === "bundled") return false;
    this.providers.delete(id);
    return true;
  }

  async removePersistent(id: string): Promise<boolean> {
    const entry = this.providers.get(id);
    if (!entry || entry.source === "bundled" || entry.source === "upstream-refresh") {
      return false;
    }
    const path = this.providersPathForSource(entry.source);
    if (!path) {
      return false;
    }
    const before = readProvidersFileStrict(path);
    const after = before.filter((spec) => spec.id !== id);
    if (after.length === before.length) {
      return false;
    }
    writeProvidersFile(path, after);
    this.providers.delete(id);
    return true;
  }

  /** Replace catalog entries with an upstream-refreshed snapshot. Custom providers are preserved. */
  applyUpstreamCatalog(snapshot: ProviderSpec[]): void {
    for (const spec of snapshot) {
      const existing = this.providers.get(spec.id);
      if (existing && existing.source !== "bundled" && existing.source !== "upstream-refresh") {
        continue;
      }
      this.providers.set(spec.id, { spec, source: "upstream-refresh" });
    }
  }

  private async getKeyring(): Promise<KeyringHandle> {
    if (this.options.noKeyring) {
      return {
        status: "unavailable",
        async get() {
          return null;
        },
        async set() {
          return false;
        },
        async delete() {
          return false;
        },
      };
    }
    if (this.keyring) return this.keyring;
    if (!this.keyringPromise) {
      this.keyringPromise = openKeyring().then((handle) => {
        this.keyring = handle;
        return handle;
      });
    }
    return this.keyringPromise;
  }

  /**
   * Resolve an API key for a provider through the layered chain.
   *
   * `override` is the explicit caller arg (e.g. test injection or per-message
   * override) and short-circuits everything else.
   *
   * Returns `null` when no layer produces a key. For `auth: "none"` providers
   * (e.g. local Ollama), callers should not invoke this — the model factory
   * detects auth mode separately.
   */
  async resolveApiKey(
    providerId: string,
    options: { override?: string; sessionOverride?: string } = {},
  ): Promise<{ key: string | null; source: string }> {
    if (options.override) return { key: options.override, source: "explicit" };
    if (options.sessionOverride) {
      const resolved = resolveEnvIndirection(options.sessionOverride);
      if (resolved) return { key: resolved, source: "session-override" };
    }

    const entry = this.providers.get(providerId);
    if (!entry) return { key: null, source: "not-found" };

    if (entry.source === "project-config" || entry.source === "global-config") {
      const configKey = resolveEnvIndirection(
        (entry.spec as ProviderSpec & { apiKey?: string }).apiKey,
      );
      if (configKey) {
        return {
          key: configKey,
          source: entry.source === "project-config" ? "project-config" : "global-config",
        };
      }
    }

    for (const envName of [
      `MAKO_${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`,
      ...entry.spec.envVarHints,
    ]) {
      const value = process.env[envName];
      if (value && value.trim() !== "") {
        return { key: value.trim(), source: `env:${envName}` };
      }
    }

    const keyring = await this.getKeyring();
    if (keyring.status === "ready") {
      const stored = await keyring.get(providerId);
      if (stored) return { key: stored, source: "keychain" };
    }

    return { key: null, source: "unresolved" };
  }

  resolveBaseURL(providerId: string): string | null {
    const entry = this.providers.get(providerId);
    if (!entry) return null;
    if (entry.spec.auth === "none") {
      for (const envName of entry.spec.envVarHints) {
        const value = process.env[envName];
        if (value && /^https?:\/\//i.test(value.trim())) {
          return value.trim();
        }
      }
    }
    return entry.spec.baseURL ?? null;
  }

  async probeLocalProvider(providerId: string): Promise<{ ok: boolean; url: string | null }> {
    const entry = this.providers.get(providerId);
    if (!entry || entry.spec.tier !== "local") {
      return { ok: false, url: null };
    }
    const baseURL = this.resolveBaseURL(providerId);
    if (!baseURL) {
      return { ok: false, url: null };
    }
    const url = new URL("models", baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(2_000),
      });
      return { ok: response.ok, url };
    } catch {
      return { ok: false, url };
    }
  }

  async setApiKeyInKeyring(providerId: string, value: string): Promise<boolean> {
    const keyring = await this.getKeyring();
    if (keyring.status !== "ready") return false;
    return keyring.set(providerId, value);
  }

  async deleteApiKeyFromKeyring(providerId: string): Promise<boolean> {
    const keyring = await this.getKeyring();
    if (keyring.status !== "ready") return false;
    return keyring.delete(providerId);
  }

  private providersPathForSource(
    source: Extract<ResolvedProvider["source"], "project-config" | "global-config">,
  ): string | null {
    if (source === "global-config") {
      return join(resolveGlobalConfigDir(this.options.globalConfigDir), "providers.json");
    }
    const projectDir = resolveProjectConfigDir(this.options.projectRoot);
    return projectDir ? join(projectDir, "providers.json") : null;
  }
}
