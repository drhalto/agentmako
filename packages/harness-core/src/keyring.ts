/**
 * System keychain wrapper around `@napi-rs/keyring`.
 *
 * Phase 3.1 BYOK doctrine: every key must be reachable via at least one of
 * env, config, or keychain. The keychain is the most secure of the three on
 * a workstation, but it can be unavailable in CI containers, on Linux
 * without `libsecret`, or in headless macOS sessions. This wrapper degrades
 * gracefully — `null` returns mean "use the next layer".
 *
 * Service name: `mako-ai`. Account: `<provider-id>`. Storage is per-OS:
 *   - Windows: Credential Manager (DPAPI)
 *   - macOS:   Keychain
 *   - Linux:   Secret Service via libsecret (gnome-keyring, kwallet, etc.)
 *
 * If `@napi-rs/keyring` itself can't load (missing native module on the
 * platform), every method becomes a no-op. The caller decides whether to
 * warn or hard-fail.
 */

import { createLogger } from "@mako-ai/logger";

const keyringLogger = createLogger("mako-harness-keyring");

const SERVICE_NAME = "mako-ai";

export type KeyringStatus = "ready" | "unavailable";

interface EntryConstructor {
  new (service: string, account: string): {
    getPassword(): string | null;
    setPassword(password: string): void;
    deletePassword(): boolean;
  };
}

interface KeyringModule {
  Entry: EntryConstructor;
}

let cachedKeyring: KeyringModule | null | undefined;
let cachedStatus: KeyringStatus | undefined;

async function loadKeyring(): Promise<KeyringModule | null> {
  if (cachedKeyring !== undefined) return cachedKeyring;
  try {
    cachedKeyring = (await import("@napi-rs/keyring")) as unknown as KeyringModule;
    cachedStatus = "ready";
    return cachedKeyring;
  } catch (error) {
    cachedKeyring = null;
    cachedStatus = "unavailable";
    keyringLogger.warn("keyring.unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface KeyringHandle {
  status: KeyringStatus;
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<boolean>;
  delete(account: string): Promise<boolean>;
}

export async function openKeyring(): Promise<KeyringHandle> {
  const mod = await loadKeyring();
  const status: KeyringStatus = mod ? "ready" : "unavailable";

  return {
    status,
    async get(account) {
      if (!mod) return null;
      try {
        return new mod.Entry(SERVICE_NAME, account).getPassword();
      } catch (error) {
        keyringLogger.warn("keyring.get.failed", {
          account,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async set(account, value) {
      if (!mod) return false;
      try {
        new mod.Entry(SERVICE_NAME, account).setPassword(value);
        return true;
      } catch (error) {
        keyringLogger.warn("keyring.set.failed", {
          account,
          reason: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    async delete(account) {
      if (!mod) return false;
      try {
        return new mod.Entry(SERVICE_NAME, account).deletePassword();
      } catch (error) {
        keyringLogger.warn("keyring.delete.failed", {
          account,
          reason: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
  };
}

export function keyringStatusSync(): KeyringStatus | "unknown" {
  return cachedStatus ?? "unknown";
}
