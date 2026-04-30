/**
 * Evaluate compiled rule-pack rules against a set of focus files.
 *
 * For each (rule, file) pair whose language matches:
 *   1. Run every pattern on the file via `findAstMatches`.
 *   2. Convert every match to an `AnswerSurfaceIssue` via `buildSurfaceIssue`,
 *      with the rule's declared severity/category/confidence + metadata.
 *   3. Interpolate `{{capture.X}}` tokens in the rule message using the
 *      ast-grep capture map.
 *
 * The returned issues pass through the same dedup + rendering pipeline as
 * built-in diagnostics because they use the identical `buildSurfaceIssue`
 * factory (same `matchBasedId` / `codeHash` / `patternHash` shape).
 */

import type { AnswerSurfaceIssue, JsonObject } from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import * as ts from "typescript";
import { findAstMatches, langFromPath } from "../code-intel/ast-patterns.js";
import {
  buildSurfaceIssue,
  type DiagnosticAstFile,
  readDiagnosticFiles,
} from "../diagnostics/common.js";
import type { CompiledRule, RuleCanonicalHelper } from "./types.js";

export interface RunRulePacksInput {
  rules: CompiledRule[];
  projectStore: ProjectStore;
  focusFiles: string[];
}

export function runRulePacks(input: RunRulePacksInput): AnswerSurfaceIssue[] {
  if (input.rules.length === 0 || input.focusFiles.length === 0) return [];

  const files = readDiagnosticFiles(input.projectStore, input.focusFiles);
  if (files.length === 0) return [];

  const issues: AnswerSurfaceIssue[] = [];

  for (const rule of input.rules) {
    for (const file of files) {
      const lang = langFromPath(file.path);
      if (lang == null) continue;
      if (rule.languages && !rule.languages.includes(lang)) continue;
      const canonicalHelper = resolveCanonicalHelper(rule.canonicalHelper);
      if (canonicalHelper && fileSatisfiesCanonicalHelper(file, canonicalHelper)) continue;

      const queries = rule.patterns.map((pattern) => ({
        pattern,
        captures: extractCaptureNames(pattern),
      }));
      const matches = findAstMatches(file.path, file.content, queries);

      for (const match of matches) {
        issues.push(
          buildSurfaceIssue({
            category: rule.category,
            code: rule.id,
            message: interpolateMessage(rule.message, match.captures),
            severity: rule.severity,
            confidence: rule.confidence,
            path: file.path,
            line: match.lineStart,
            producerPath: canonicalHelper?.path,
            consumerPath: canonicalHelper ? file.path : undefined,
            evidenceRefs: evidenceRefsForMatch(file.path, match.lineStart, canonicalHelper),
            matchKey: {
              ruleId: rule.id,
              path: file.path,
              line: match.lineStart,
              captures: match.captures,
              ...(canonicalHelper ? { canonicalHelper: canonicalHelperMetadata(canonicalHelper) } : {}),
            },
            codeFingerprint: {
              matchText: match.matchText,
              captures: match.captures,
            },
            metadata: buildMetadata(rule.metadata, rule.sourcePath, match.captures, canonicalHelper),
          }),
        );
      }
    }
  }

  return issues;
}

/**
 * Pull `$NAME` metavariables out of a pattern so the evaluator asks
 * ast-grep for those captures. `$$$NAME` (variadic) is skipped — those
 * capture concatenations we don't surface in interpolation today.
 */
function extractCaptureNames(pattern: string): string[] {
  const names = new Set<string>();
  const re = /(?<!\$)\$([A-Z][A-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) != null) {
    names.add(match[1]);
  }
  return [...names];
}

interface ResolvedCanonicalHelper {
  symbol: string;
  path?: string;
  mode: "absent_in_consumer";
}

function resolveCanonicalHelper(helper: RuleCanonicalHelper | undefined): ResolvedCanonicalHelper | null {
  if (!helper) return null;
  return {
    symbol: helper.symbol,
    ...(helper.path ? { path: helper.path.replace(/\\/g, "/") } : {}),
    mode: helper.mode ?? "absent_in_consumer",
  };
}

function fileSatisfiesCanonicalHelper(
  file: DiagnosticAstFile,
  helper: ResolvedCanonicalHelper,
): boolean {
  if (helper.path && normalizeProjectPath(file.path) === normalizeProjectPath(helper.path)) {
    return true;
  }
  return referencesSymbol(file, helper.symbol);
}

function evidenceRefsForMatch(
  filePath: string,
  line: number,
  helper: ResolvedCanonicalHelper | null,
): string[] {
  return [
    `${filePath}:L${line}`,
    ...(helper?.path ? [helper.path] : []),
  ];
}

function referencesSymbol(file: DiagnosticAstFile, symbol: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === symbol) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file.sourceFile);
  return found;
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Replace `{{capture.NAME}}` placeholders in a rule message with the matched
 * text of the `$NAME` metavariable. Missing captures interpolate to an
 * empty string rather than throw, so misauthored templates degrade loudly
 * in the rendered message without crashing the evaluator.
 */
function interpolateMessage(template: string, captures: Record<string, string>): string {
  return template.replace(/\{\{\s*capture\.([A-Z][A-Z0-9_]*)\s*\}\}/g, (_, name: string) => {
    return captures[name] ?? "";
  });
}

function buildMetadata(
  ruleMetadata: JsonObject | undefined,
  sourcePath: string,
  captures: Record<string, string>,
  canonicalHelper: ResolvedCanonicalHelper | null,
): JsonObject {
  return {
    ...(ruleMetadata ?? {}),
    ruleSource: sourcePath,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
    ...(canonicalHelper ? { canonicalHelper: canonicalHelperMetadata(canonicalHelper) } : {}),
  };
}

function canonicalHelperMetadata(helper: ResolvedCanonicalHelper): JsonObject {
  return {
    symbol: helper.symbol,
    mode: helper.mode,
    ...(helper.path ? { path: helper.path } : {}),
  };
}
