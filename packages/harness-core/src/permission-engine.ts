/**
 * Permission engine — declarative rule loading + evaluator + persistent
 * decision cache.
 *
 * Rule precedence (most specific wins, deny beats allow):
 *
 *   1. Built-in default-deny (`.env*`, `~/.ssh/*`, paths outside project).
 *      These cannot be overridden via rule files — they're enforced inside
 *      `path-guard.ts`. The evaluator surfaces them as `deny`.
 *   2. Project-scope rules (`<projectRoot>/.mako/permissions.json`).
 *   3. Global-scope rules (`~/.mako/permissions.json`).
 *   4. Persisted decisions in `harness_permission_decisions` (a user
 *      "always allow" carries between turns within the chosen scope).
 *   5. Implicit `allow` for read-only existing tools (the 16 from
 *      Roadmap 1) — they declare their own minimum tier and never mutate.
 *   6. Implicit `ask` for action tools without an explicit rule.
 *
 * Pattern matching:
 *   - Path patterns use a tiny glob syntax: `*` matches non-`/` chars,
 *     `**` matches any chars including `/`, `?` matches one non-`/` char.
 *   - Command patterns use the same glob syntax against `<command> <args...>`.
 *   - `deny` always wins over `allow` regardless of specificity.
 *   - When two rules of the same action match, the longer pattern wins.
 *     Project-scope rules outrank global-scope rules.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore } from "@mako-ai/store";
import { resolveGlobalConfigDir, resolveProjectConfigDir } from "./local-config.js";

const permissionLogger = createLogger("mako-harness-permission-engine");

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const PermissionActionSchema = z.enum(["allow", "deny", "ask"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

export const PermissionScopeSchema = z.enum(["turn", "session", "project", "global"]);
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

export const PermissionRuleSchema = z.object({
  permission: z.string().min(1),
  pattern: z.string().min(1),
  action: PermissionActionSchema,
});
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

const PermissionFileSchema = z.object({
  rules: z.array(PermissionRuleSchema).default([]),
});

// -----------------------------------------------------------------------------
// Glob matcher
// -----------------------------------------------------------------------------

function matchesPattern(pattern: string, candidate: string): boolean {
  return picomatch(pattern.replace(/\\/g, "/"), {
    dot: true,
    nobrace: true,
    noextglob: true,
    nonegate: true,
  })(candidate.replace(/\\/g, "/"));
}

// -----------------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------------

export interface LoadedRule {
  rule: PermissionRule;
  source: "project" | "global";
}

function readRulesFile(path: string, source: LoadedRule["source"]): LoadedRule[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = PermissionFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.rules.map((rule: PermissionRule) => ({ rule, source }));
  } catch (error) {
    permissionLogger.warn("permission.rule-file.invalid", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function readRulesFileStrict(path: string): PermissionRule[] {
  if (!existsSync(path)) return [];
  const parsed = PermissionFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return parsed.rules;
}

function writeRulesFile(path: string, rules: PermissionRule[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ rules }, null, 2)}\n`, "utf8");
}

export function loadPermissionRules(options: {
  projectRoot?: string;
  globalConfigDir?: string;
}): LoadedRule[] {
  const out: LoadedRule[] = [];
  const globalDir = resolveGlobalConfigDir(options.globalConfigDir);
  out.push(...readRulesFile(join(globalDir, "permissions.json"), "global"));
  const projectDir = resolveProjectConfigDir(options.projectRoot);
  if (projectDir) {
    out.push(...readRulesFile(join(projectDir, "permissions.json"), "project"));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Evaluator
// -----------------------------------------------------------------------------

export interface EvaluationInput {
  /** Permission key (`file_write`, `shell_run`, ...). */
  permission: string;
  /**
   * Pattern target — usually the project-relative path being touched, or
   * for `shell_run` the `<command> <args...>` string.
   */
  target: string;
  /** Session id used to look up persisted decisions. */
  sessionId: string;
  /** Optional preview shown in the resulting `permission.request` event. */
  preview?: unknown;
  /** Argument blob shown in the resulting `permission.request` event. */
  args?: unknown;
}

export interface EvaluationResult {
  action: PermissionAction;
  matchedRule?: LoadedRule;
  fromPersistedDecision?: boolean;
  reason: string;
}

export class PermissionEngine {
  private rules: LoadedRule[];

  constructor(
    private readonly options: {
      store: ProjectStore;
      projectRoot?: string;
      globalConfigDir?: string;
    },
  ) {
    this.rules = loadPermissionRules({
      projectRoot: options.projectRoot,
      globalConfigDir: options.globalConfigDir,
    });
  }

  /** Reload rule files — used by HTTP `POST /permissions/rules` after user edit. */
  reload(): void {
    this.rules = loadPermissionRules({
      projectRoot: this.options.projectRoot,
      globalConfigDir: this.options.globalConfigDir,
    });
  }

  listRules(): LoadedRule[] {
    return [...this.rules];
  }

  /** Append a rule to the in-memory ruleset (HTTP POST mutates this; persistence is the caller's job). */
  upsert(rule: PermissionRule, source: LoadedRule["source"] = "project"): void {
    this.rules = this.rules.filter(
      (r) => !(r.rule.permission === rule.permission && r.rule.pattern === rule.pattern),
    );
    this.rules.push({ rule, source });
  }

  upsertPersistent(rule: PermissionRule, source: LoadedRule["source"] = "project"): void {
    const path = this.rulesPathForSource(source);
    if (!path) {
      throw new Error(`permission config path unavailable for source: ${source}`);
    }
    const rules = readRulesFileStrict(path).filter(
      (entry) => !(entry.permission === rule.permission && entry.pattern === rule.pattern),
    );
    rules.push(rule);
    writeRulesFile(path, rules);
    this.upsert(rule, source);
  }

  remove(permission: string, pattern: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(
      (r) => !(r.rule.permission === permission && r.rule.pattern === pattern),
    );
    return this.rules.length < before;
  }

  removePersistent(permission: string, pattern: string): boolean {
    let removed = false;
    for (const source of ["project", "global"] as const) {
      const path = this.rulesPathForSource(source);
      if (!path || !existsSync(path)) continue;
      const before = readRulesFileStrict(path);
      const after = before.filter(
        (entry) => !(entry.permission === permission && entry.pattern === pattern),
      );
      if (after.length < before.length) {
        writeRulesFile(path, after);
        removed = true;
      }
    }
    if (removed) {
      this.remove(permission, pattern);
    }
    return removed;
  }

  /** Persist a user decision into `harness_permission_decisions`. */
  rememberDecision(input: {
    sessionId: string;
    permission: string;
    pattern: string;
    action: PermissionAction;
    scope: PermissionScope;
  }): void {
    if (input.scope === "turn") return; // turn-scoped decisions don't outlive the turn
    this.options.store.insertHarnessPermissionDecision({
      sessionId: input.sessionId,
      toolName: input.permission,
      pattern: input.pattern,
      action: input.action,
      scope: input.scope,
    });
    if (input.scope === "project" || input.scope === "global") {
      this.upsertPersistent(
        { permission: input.permission, pattern: input.pattern, action: input.action },
        input.scope === "project" ? "project" : "global",
      );
    }
  }

  evaluate(input: EvaluationInput): EvaluationResult {
    const matches = this.rules
      .filter(
        (r) =>
          r.rule.permission === input.permission &&
          matchesPattern(r.rule.pattern, input.target),
      )
      .sort(compareLoadedRules);

    // deny beats allow
    const deny = matches.find((m) => m.rule.action === "deny");
    if (deny) {
      return {
        action: "deny",
        matchedRule: deny,
        reason: `matched ${deny.source}-scope deny rule \`${deny.rule.pattern}\``,
      };
    }

    // session-scope persisted decisions for this exact tool/target
    const sessionDecisions = this.options.store
      .listHarnessPermissionDecisions(input.sessionId)
      .filter(
        (d) =>
          d.toolName === input.permission && matchesPattern(d.pattern, input.target),
      )
      .sort((a, b) => b.pattern.length - a.pattern.length);
    const sessionDeny = sessionDecisions.find((d) => d.action === "deny");
    if (sessionDeny) {
      return {
        action: "deny",
        fromPersistedDecision: true,
        reason: `session-scope deny remembered for \`${sessionDeny.pattern}\``,
      };
    }
    const sessionAllow = sessionDecisions.find((d) => d.action === "allow");
    if (sessionAllow) {
      return {
        action: "allow",
        fromPersistedDecision: true,
        reason: `session-scope allow remembered for \`${sessionAllow.pattern}\``,
      };
    }

    // project-scope rule allows (specifically — longer pattern wins among allows)
    const allows = matches
      .filter((m) => m.rule.action === "allow")
      .sort(compareLoadedRules);
    if (allows.length > 0) {
      const winner = allows[0]!;
      return {
        action: "allow",
        matchedRule: winner,
        reason: `matched ${winner.source}-scope allow rule \`${winner.rule.pattern}\``,
      };
    }

    // explicit ask rule
    const ask = matches.find((m) => m.rule.action === "ask");
    if (ask) {
      return {
        action: "ask",
        matchedRule: ask,
        reason: `matched ${ask.source}-scope ask rule \`${ask.rule.pattern}\``,
      };
    }

    return { action: "ask", reason: "no rule matched; defaulting to ask" };
  }

  private rulesPathForSource(source: LoadedRule["source"]): string | null {
    if (source === "global") {
      return join(resolveGlobalConfigDir(this.options.globalConfigDir), "permissions.json");
    }
    const projectDir = resolveProjectConfigDir(this.options.projectRoot);
    return projectDir ? join(projectDir, "permissions.json") : null;
  }
}

function compareLoadedRules(a: LoadedRule, b: LoadedRule): number {
  if (a.source !== b.source) return a.source === "project" ? -1 : 1;
  return b.rule.pattern.length - a.rule.pattern.length;
}
