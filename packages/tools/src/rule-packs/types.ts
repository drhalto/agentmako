/**
 * Contracts for user-authored YAML rule packs.
 *
 * A rule pack is a `.yaml` file under a project's `.mako/rules/` directory.
 * Each rule defines one or more ast-grep patterns that, when matched, emit
 * a mako `AnswerSurfaceIssue` in the same shape produced by our built-in
 * diagnostics. The schema is intentionally narrow — we support the 80% case
 * (find a shape, report it) rather than porting the full Semgrep pattern DSL.
 *
 * Compared to the built-in TS-aware / structural diagnostic rules, rule
 * packs trade expressive power (no cross-file joins, no type-aware checks,
 * no metavariable-* constraints) for authoring ergonomics (no TypeScript,
 * no package release). They complement the built-ins, not replace them.
 */

import type {
  AnswerSurfaceIssueCategory,
  AnswerSurfaceIssueConfidence,
  AnswerSurfaceIssueSeverity,
  JsonObject,
} from "@mako-ai/contracts";
import type { SupportedLang } from "../code-intel/ast-patterns.js";

/**
 * A single author-facing rule. Materializes into zero or more
 * `AnswerSurfaceIssue` values per scanned file, one per structural match.
 */
export interface RuleDefinition {
  /**
   * Stable rule identifier. Used as the `code` on every emitted issue and
   * as part of the `matchBasedId` / `patternHash`. Conventionally dotted
   * (`my-team.identity.tenant_id_passed_to_user_scope`), but any non-empty
   * string is accepted.
   */
  id: string;

  /** Maps 1:1 onto `AnswerSurfaceIssue.category`. */
  category: AnswerSurfaceIssueCategory;

  /** Maps 1:1 onto `AnswerSurfaceIssue.severity`. */
  severity: AnswerSurfaceIssueSeverity;

  /** Maps 1:1 onto `AnswerSurfaceIssue.confidence`. Defaults to `"probable"`. */
  confidence?: AnswerSurfaceIssueConfidence;

  /**
   * Languages the rule applies to. Must overlap with the focus file's
   * detected language (`langFromPath`) or the rule is skipped for that file.
   * If omitted, the rule applies to every supported language.
   */
  languages?: SupportedLang[];

  /**
   * Human-facing message attached to every emitted issue. Supports
   * `{{capture.NAME}}` interpolation where `NAME` is the capture key of an
   * ast-grep metavariable (e.g., `{{capture.FN}}` substitutes the matched
   * identifier text for the `$FN` metavariable).
   */
  message: string;

  /** Exactly one ast-grep pattern to match. Mutually exclusive with `patterns`. */
  pattern?: string;

  /**
   * Zero or more ast-grep patterns to match. OR semantics — each pattern is
   * evaluated independently and every match emits an issue. Use `pattern`
   * when the rule has a single shape, `patterns` when the rule covers
   * multiple equivalent forms (e.g., single vs double quote variants).
   * Mutually exclusive with `pattern`.
   */
  patterns?: string[];

  /**
   * Free-form metadata attached to every emitted issue's `metadata` field.
   * Not inspected by the engine; passes through verbatim. Good home for
   * `cwe`, `owasp`, `references`, or custom taxonomy fields.
   */
  metadata?: JsonObject;
}

/** The top-level shape of a `.yaml` rule-pack file after parsing. */
export interface RulePack {
  /** Human-readable pack name. Optional; defaults to the file basename. */
  name?: string;
  /** Rules declared in the pack. */
  rules: RuleDefinition[];
}

/** A pack plus the file it was loaded from — useful for error messages. */
export interface LoadedRulePack {
  pack: RulePack;
  sourcePath: string;
}

/**
 * Materialized-and-validated rule with every default resolved. The evaluator
 * works off this shape, not the raw `RuleDefinition`, so default resolution
 * happens once at load time.
 */
export interface CompiledRule {
  id: string;
  category: AnswerSurfaceIssueCategory;
  severity: AnswerSurfaceIssueSeverity;
  confidence: AnswerSurfaceIssueConfidence;
  languages: SupportedLang[] | null;
  message: string;
  patterns: string[];
  metadata?: JsonObject;
  sourcePath: string;
}

export class RulePackLoadError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RulePackLoadError";
  }
}
