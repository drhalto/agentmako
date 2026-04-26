import type { ProjectBindingStrategy, ProjectLiveBindingRef } from "@mako-ai/contracts";
import { Entry } from "@napi-rs/keyring";
import { ProjectCommandError } from "../errors.js";

const KEYCHAIN_SERVICE_NAME = "mako-ai";

export interface ResolvedLiveDbUrl {
  url: string;
  strategy: ProjectBindingStrategy;
  ref: string;
}

function getKeychainEntry(ref: string): Entry {
  return new Entry(KEYCHAIN_SERVICE_NAME, ref);
}

export function resolveLiveDbUrl(binding: ProjectLiveBindingRef): ResolvedLiveDbUrl {
  if (!binding.enabled) {
    throw new ProjectCommandError(
      412,
      "db_binding_not_configured",
      "Live DB binding is not enabled for this project. Run `mako project db bind` first.",
      { strategy: binding.strategy, ref: binding.ref },
    );
  }

  const trimmedRef = binding.ref.trim();
  if (trimmedRef === "") {
    throw new ProjectCommandError(
      422,
      "db_binding_invalid",
      "Live DB binding has an empty `ref` value.",
      { strategy: binding.strategy },
    );
  }

  if (binding.strategy === "env_var_ref") {
    const value = process.env[trimmedRef];
    if (value === undefined || value.trim() === "") {
      throw new ProjectCommandError(
        422,
        "db_binding_invalid",
        `Environment variable \`${trimmedRef}\` is not set or is empty.`,
        { strategy: binding.strategy, ref: trimmedRef },
      );
    }
    return { url: value.trim(), strategy: binding.strategy, ref: trimmedRef };
  }

  if (binding.strategy === "keychain_ref") {
    let value: string | null;
    try {
      value = getKeychainEntry(trimmedRef).getPassword();
    } catch (error) {
      throw new ProjectCommandError(
        422,
        "db_binding_invalid",
        `Failed to read keychain entry \`${trimmedRef}\`: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { strategy: binding.strategy, ref: trimmedRef },
      );
    }

    if (value === null || value.trim() === "") {
      throw new ProjectCommandError(
        422,
        "db_binding_invalid",
        `Keychain entry \`${trimmedRef}\` has no stored credential. Run \`mako project db bind\` with \`--url-from-env\` or \`--url-stdin\` first.`,
        { strategy: binding.strategy, ref: trimmedRef },
      );
    }

    return { url: value.trim(), strategy: binding.strategy, ref: trimmedRef };
  }

  throw new ProjectCommandError(
    422,
    "db_binding_invalid",
    `Unknown binding strategy: ${String((binding as { strategy: unknown }).strategy)}`,
    { binding },
  );
}

export function storeKeychainSecret(ref: string, value: string): void {
  const trimmedRef = ref.trim();
  if (trimmedRef === "") {
    throw new ProjectCommandError(
      422,
      "db_binding_invalid",
      "Cannot store a keychain secret for an empty `ref`.",
    );
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new ProjectCommandError(
      422,
      "db_binding_invalid",
      `Cannot store an empty value in keychain entry \`${trimmedRef}\`.`,
      { ref: trimmedRef },
    );
  }

  try {
    getKeychainEntry(trimmedRef).setPassword(trimmedValue);
  } catch (error) {
    throw new ProjectCommandError(
      422,
      "db_binding_invalid",
      `Failed to write keychain entry \`${trimmedRef}\`: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { ref: trimmedRef },
    );
  }
}

export function deleteKeychainSecret(ref: string): boolean {
  const trimmedRef = ref.trim();
  if (trimmedRef === "") {
    return false;
  }

  try {
    return getKeychainEntry(trimmedRef).deleteCredential();
  } catch {
    return false;
  }
}
