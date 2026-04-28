const DEFAULT_REEF_BACKED_TOOLS = new Set([
  "ast_find_pattern",
  "context_packet",
  "git_precommit_check",
  "project_index_status",
]);

function parseList(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function getReefModeOverride(): "auto" | "required" | "legacy" | undefined {
  const raw = process.env.MAKO_REEF_MODE?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "legacy") return "legacy";
  if (raw === "required") return "required";
  if (raw === "auto") return "auto";
  return undefined;
}

export function isReefLegacyModeEnabled(): boolean {
  return getReefModeOverride() === "legacy";
}

export function isReefBackedToolViewEnabled(toolName: string): boolean {
  if (isReefLegacyModeEnabled()) {
    return false;
  }

  const raw = process.env.MAKO_REEF_BACKED?.trim();
  if (!raw) {
    return DEFAULT_REEF_BACKED_TOOLS.has(toolName);
  }

  const lowered = raw.toLowerCase();
  if (["0", "false", "off", "legacy", "none"].includes(lowered)) {
    return false;
  }
  if (["1", "true", "on", "all"].includes(lowered)) {
    return true;
  }

  return parseList(raw).has(toolName);
}
