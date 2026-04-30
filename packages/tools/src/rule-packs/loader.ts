/**
 * Load + compile YAML rule packs from disk.
 *
 * Two entry points:
 *   - `loadRulePackFromFile(path)` — parse one `.yaml` / `.yml` file.
 *   - `discoverRulePacks(projectRoot)` — walk `<projectRoot>/.mako/rules/`
 *     for rule-pack files and load each one.
 *
 * Both return `LoadedRulePack[]` so callers can thread pack/source info into
 * error messages. Parse failures and schema violations throw
 * `RulePackLoadError` so a malformed pack fails loudly instead of silently
 * producing zero rules.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { rulePackSchema, type RulePackInput } from "./schema.js";
import {
  RulePackLoadError,
  type CompiledRule,
  type LoadedRulePack,
  type RulePack,
} from "./types.js";

const RULE_PACK_EXTENSIONS = new Set([".yaml", ".yml"]);

/**
 * Parse + validate a single rule-pack file. Throws `RulePackLoadError`
 * with the source path attached when the file is unreadable, the YAML is
 * malformed, or the structure doesn't satisfy the rule-pack schema.
 */
export function loadRulePackFromFile(sourcePath: string): LoadedRulePack {
  let contents: string;
  try {
    contents = readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new RulePackLoadError(
      `Unable to read rule pack at ${sourcePath}: ${(error as Error).message}`,
      sourcePath,
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(contents);
  } catch (error) {
    throw new RulePackLoadError(
      `Rule pack at ${sourcePath} contains invalid YAML: ${(error as Error).message}`,
      sourcePath,
      error,
    );
  }

  const result = rulePackSchema.safeParse(parsed);
  if (!result.success) {
    throw new RulePackLoadError(
      `Rule pack at ${sourcePath} failed schema validation: ${formatZodIssues(result.error.issues)}`,
      sourcePath,
      result.error,
    );
  }

  return {
    sourcePath,
    pack: toRulePack(result.data),
  };
}

/**
 * Walk `<projectRoot>/.mako/rules/**\/*.yaml` and load every valid pack.
 * Missing directory → empty array (no rule packs is a valid state).
 * Malformed packs throw — we don't silently drop broken authoring.
 */
export function discoverRulePacks(projectRoot: string): LoadedRulePack[] {
  const rulesDir = join(projectRoot, ".mako", "rules");
  if (!existsSync(rulesDir)) return [];

  const packs: LoadedRulePack[] = [];
  for (const filePath of walkYamlFiles(rulesDir)) {
    packs.push(loadRulePackFromFile(filePath));
  }
  return packs;
}

/**
 * Flatten a set of loaded packs into the compiled-rule shape the evaluator
 * consumes. Defaults are resolved once here (no re-resolution per file).
 */
export function compileRulePacks(packs: LoadedRulePack[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const loaded of packs) {
    for (const rule of loaded.pack.rules) {
      compiled.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        confidence: rule.confidence ?? "probable",
        languages: rule.languages ?? null,
        message: rule.message,
        patterns: rule.patterns ?? (rule.pattern ? [rule.pattern] : []),
        canonicalHelper: normalizeCanonicalHelper(rule.canonicalHelper),
        metadata: rule.metadata,
        sourcePath: loaded.sourcePath,
      });
    }
  }
  return compiled;
}

function toRulePack(input: RulePackInput): RulePack {
  return {
    name: input.name,
    rules: input.rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      languages: rule.languages,
      message: rule.message,
      pattern: rule.pattern,
      patterns: rule.patterns,
      canonicalHelper: normalizeCanonicalHelper(rule.canonicalHelper),
      metadata: rule.metadata,
    })),
  };
}

function normalizeCanonicalHelper(
  helper: RulePack["rules"][number]["canonicalHelper"],
): RulePack["rules"][number]["canonicalHelper"] {
  if (!helper) return undefined;
  return {
    symbol: helper.symbol,
    ...(helper.path ? { path: helper.path.replace(/\\/g, "/") } : {}),
    mode: helper.mode ?? "absent_in_consumer",
  };
}

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      out.push(...walkYamlFiles(full));
      continue;
    }
    if (!stats.isFile()) continue;
    const dot = entry.lastIndexOf(".");
    if (dot < 0) continue;
    if (!RULE_PACK_EXTENSIONS.has(entry.slice(dot).toLowerCase())) continue;
    out.push(full);
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function formatZodIssues(issues: Array<{ path: (string | number)[]; message: string }>): string {
  return issues
    .map((issue) => {
      const pathText = issue.path.join(".");
      return pathText.length > 0 ? `${pathText}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
