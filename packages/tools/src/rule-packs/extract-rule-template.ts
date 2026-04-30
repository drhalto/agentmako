import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ExtractedRuleTemplate,
  ExtractRuleTemplateToolInput,
  ExtractRuleTemplateToolOutput,
  ProjectFinding,
} from "@mako-ai/contracts";
import { stringify as stringifyYaml } from "yaml";
import { langFromPath, type SupportedLang } from "../code-intel/ast-patterns.js";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";
import type { ToolServiceOptions } from "../runtime.js";
import { rulePackSchema } from "./schema.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_TEMPLATES = 5;
const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_SNIPPET_CHARS = 1200;

interface GitDiffHunk {
  sourceFile: string;
  oldStart: number;
  newStart: number;
  removed: string[];
  added: string[];
}

interface TemplateCandidate {
  score: number;
  ruleSuffix: string;
  sourceFile: string;
  language: SupportedLang;
  patterns: string[];
  category: ExtractedRuleTemplate["category"];
  severity: ExtractedRuleTemplate["severity"];
  confidence: ExtractedRuleTemplate["confidence"];
  message: string;
  beforeSnippet: string;
  afterSnippet?: string;
  rationale: string;
  caveats: string[];
}

export async function extractRuleTemplateTool(
  input: ExtractRuleTemplateToolInput,
  options: ToolServiceOptions,
): Promise<ExtractRuleTemplateToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const warnings: string[] = [];
    const fixCommitInput = input.fixCommit.trim();
    const baseCommitInput = input.baseCommit?.trim() || `${fixCommitInput}^`;
    const maxTemplates = input.maxTemplates ?? DEFAULT_MAX_TEMPLATES;
    const includeRelatedFindings = input.includeRelatedFindings ?? true;
    const filePath = input.filePath ? normalizeFileQuery(project.canonicalPath, input.filePath) : undefined;

    const fixCommit = await resolveCommit(project.canonicalPath, fixCommitInput);
    const baseCommit = await resolveCommit(project.canonicalPath, baseCommitInput);
    const diffText = await gitDiff(project.canonicalPath, baseCommit, fixCommit, filePath);
    if (diffText.trim().length === 0) {
      warnings.push("git diff returned no changed lines for the requested commit range.");
    }

    const hunks = parseUnifiedDiff(diffText);
    const changedFiles = new Set(hunks.map((hunk) => hunk.sourceFile));
    const relatedFindingsByFile = includeRelatedFindings
      ? loadRelatedFindings(projectStore, project.projectId, [...changedFiles])
      : new Map<string, ProjectFinding[]>();
    const candidates = dedupeCandidates(
      hunks.flatMap((hunk) => mineHunk(hunk)),
    ).sort((left, right) => right.score - left.score || left.sourceFile.localeCompare(right.sourceFile));

    if (hunks.length > 0 && candidates.length === 0) {
      warnings.push(
        "diff parsed successfully, but no high-signal TS/JS anti-pattern shapes were found. Narrow to a file with removed bad code or add the first rule manually.",
      );
    }

    const prefix = normalizeRuleIdPrefix(input.ruleIdPrefix ?? `${path.basename(project.canonicalPath)}.mined`);
    const templates = candidates.slice(0, maxTemplates).map((candidate, index) => {
      const relatedFindings = relatedFindingsByFile.get(candidate.sourceFile) ?? [];
      return {
        ruleId: uniqueRuleId(prefix, candidate.ruleSuffix, index),
        sourceFile: candidate.sourceFile,
        language: candidate.language,
        patterns: candidate.patterns,
        category: candidate.category,
        severity: candidate.severity,
        confidence: relatedFindings.some((finding) => finding.status === "active" || finding.status === "resolved")
          ? "probable"
          : candidate.confidence,
        message: candidate.message,
        beforeSnippet: candidate.beforeSnippet,
        ...(candidate.afterSnippet ? { afterSnippet: candidate.afterSnippet } : {}),
        rationale: candidate.rationale,
        caveats: candidate.caveats,
        relatedFindings,
      } satisfies ExtractedRuleTemplate;
    });

    const shortFix = fixCommit.slice(0, 12);
    const suggestedPath = `.mako/rules/${pathSlug(prefix)}-${shortFix}.yaml`;
    const draftYaml = buildDraftYaml({
      name: `${prefix} mined rules from ${shortFix}`,
      templates,
      baseCommit,
      fixCommit,
      warnings,
    });

    const reefExecution = await buildReefToolExecution({
      toolName: "extract_rule_template",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      queryPath: "direct_live",
      returnedCount: templates.length,
    });

    return {
      toolName: "extract_rule_template",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      fixCommit,
      baseCommit,
      templates,
      draftYaml,
      suggestedPath,
      summary: {
        changedFileCount: changedFiles.size,
        hunkCount: hunks.length,
        templateCount: templates.length,
      },
      reefExecution,
      warnings,
    };
  });
}

async function resolveCommit(projectRoot: string, ref: string): Promise<string> {
  const stdout = await runGit(projectRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return stdout.trim();
}

async function gitDiff(
  projectRoot: string,
  baseCommit: string,
  fixCommit: string,
  filePath: string | undefined,
): Promise<string> {
  return await runGit(projectRoot, [
    "diff",
    "--unified=0",
    "--find-renames",
    "--diff-filter=AMRD",
    baseCommit,
    fixCommit,
    "--",
    ...(filePath ? [filePath] : []),
  ]);
}

async function runGit(projectRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return String(result.stdout ?? "");
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
    throw new Error(`git ${args.join(" ")} failed: ${stderr || details}`);
  }
}

function parseUnifiedDiff(diffText: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  let oldFile = "";
  let newFile = "";
  let current: GitDiffHunk | null = null;

  const finishHunk = () => {
    if (!current) return;
    if (current.removed.some((line) => line.trim().length > 0)) {
      hunks.push(current);
    }
    current = null;
  };

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      finishHunk();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      oldFile = match ? unquoteGitPath(match[1]) : "";
      newFile = match ? unquoteGitPath(match[2]) : "";
      continue;
    }
    if (line.startsWith("--- ")) {
      oldFile = parseDiffPath(line.slice(4), oldFile);
      continue;
    }
    if (line.startsWith("+++ ")) {
      newFile = parseDiffPath(line.slice(4), newFile);
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      finishHunk();
      const sourceFile = newFile && newFile !== "/dev/null" ? newFile : oldFile;
      current = {
        sourceFile,
        oldStart: Number(hunkMatch[1]),
        newStart: Number(hunkMatch[2]),
        removed: [],
        added: [],
      };
      continue;
    }

    if (!current) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    }
  }
  finishHunk();
  return hunks.filter((hunk) => hunk.sourceFile.length > 0);
}

function parseDiffPath(rawPath: string, fallback: string): string {
  if (rawPath === "/dev/null") return rawPath;
  if (rawPath.startsWith("a/") || rawPath.startsWith("b/")) {
    return unquoteGitPath(rawPath.slice(2));
  }
  return fallback;
}

function unquoteGitPath(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/\\/g, "/");
}

function mineHunk(hunk: GitDiffHunk): TemplateCandidate[] {
  const language = langFromPath(hunk.sourceFile);
  if (language == null) return [];

  const beforeLines = hunk.removed.map((line) => line.trim()).filter((line) => line.length > 0);
  if (beforeLines.length === 0) return [];
  const afterLines = hunk.added.map((line) => line.trim()).filter((line) => line.length > 0);
  const beforeSnippet = trimSnippet(beforeLines.join("\n"));
  const afterSnippet = trimSnippet(afterLines.join("\n"));
  const beforeText = beforeLines.join("\n");
  const candidates: TemplateCandidate[] = [];

  const dynamicCandidate = mineDynamicSsrFalse({
    hunk,
    language,
    beforeText,
    beforeSnippet,
    afterSnippet,
  });
  if (dynamicCandidate) candidates.push(dynamicCandidate);

  const directTableCandidate = mineDirectTableQuery({
    hunk,
    language,
    beforeText,
    beforeSnippet,
    afterSnippet,
  });
  if (directTableCandidate) candidates.push(directTableCandidate);

  const authBoundaryCandidate = mineAuthBoundary({
    hunk,
    language,
    beforeText,
    beforeSnippet,
    afterSnippet,
  });
  if (authBoundaryCandidate) candidates.push(authBoundaryCandidate);

  if (candidates.length === 0) {
    const genericCandidate = mineGenericCall({
      hunk,
      language,
      beforeLines,
      beforeSnippet,
      afterSnippet,
    });
    if (genericCandidate) candidates.push(genericCandidate);
  }

  return candidates;
}

function mineDynamicSsrFalse(args: {
  hunk: GitDiffHunk;
  language: SupportedLang;
  beforeText: string;
  beforeSnippet: string;
  afterSnippet: string;
}): TemplateCandidate | null {
  if (!/\bdynamic\s*\(/.test(args.beforeText) || !/\bssr\s*:\s*false\b/.test(args.beforeText)) {
    return null;
  }
  return {
    score: 100,
    ruleSuffix: "hydration.dynamic_ssr_false",
    sourceFile: args.hunk.sourceFile,
    language: args.language,
    patterns: ["dynamic($IMPORT, { ssr: false })"],
    category: "producer_consumer_drift",
    severity: "high",
    confidence: "probable",
    message: "Review dynamic import with `ssr: false`; confirm the client-only boundary does not own hydration-sensitive markup.",
    beforeSnippet: args.beforeSnippet,
    ...(args.afterSnippet ? { afterSnippet: args.afterSnippet } : {}),
    rationale: "The fix removed a `dynamic(..., { ssr: false })` shape, which often points to a reusable hydration-boundary rule.",
    caveats: [
      "This draft detects the exact two-argument `dynamic` options shape; add extra patterns if the project uses additional dynamic options.",
      "Confirm whether `ssr: false` is always wrong in this project or only wrong around trigger/markup ownership.",
    ],
  };
}

function mineDirectTableQuery(args: {
  hunk: GitDiffHunk;
  language: SupportedLang;
  beforeText: string;
  beforeSnippet: string;
  afterSnippet: string;
}): TemplateCandidate | null {
  if (!/\.from\s*\(/.test(args.beforeText)) {
    return null;
  }
  return {
    score: 90,
    ruleSuffix: "data.direct_table_query",
    sourceFile: args.hunk.sourceFile,
    language: args.language,
    patterns: ["$CLIENT.from($TABLE)"],
    category: "rpc_helper_reuse",
    severity: "high",
    confidence: "possible",
    message: "Review direct table query `{{capture.TABLE}}`; prefer the canonical helper/RPC path when one owns this domain access.",
    beforeSnippet: args.beforeSnippet,
    ...(args.afterSnippet ? { afterSnippet: args.afterSnippet } : {}),
    rationale: "The fix removed a direct table query shape, which may indicate a helper-bypass rule should be captured.",
    caveats: [
      "This is intentionally broad; narrow the path, table name, or message before enabling if direct table queries are valid elsewhere.",
      "Use existing helper-bypass findings to decide whether this should remain `rpc_helper_reuse` or become a project-specific category.",
    ],
  };
}

function mineAuthBoundary(args: {
  hunk: GitDiffHunk;
  language: SupportedLang;
  beforeText: string;
  beforeSnippet: string;
  afterSnippet: string;
}): TemplateCandidate | null {
  if (!/\benforceAccountStatus\s*\(/.test(args.beforeText)) {
    return null;
  }
  return {
    score: 85,
    ruleSuffix: "identity.enforce_account_status_boundary",
    sourceFile: args.hunk.sourceFile,
    language: args.language,
    patterns: ["enforceAccountStatus($IDENTITY)"],
    category: "identity_key_mismatch",
    severity: "high",
    confidence: "possible",
    message: "Review `enforceAccountStatus({{capture.IDENTITY}})` identity scope; confirm the argument uses the user-scoped boundary expected by the helper.",
    beforeSnippet: args.beforeSnippet,
    ...(args.afterSnippet ? { afterSnippet: args.afterSnippet } : {}),
    rationale: "The fix touched the canonical auth-account helper call shape, which is a good candidate for project-specific identity-boundary memory.",
    caveats: [
      "This pattern catches every helper call until narrowed; add a more specific argument shape if only profile-scoped calls are wrong.",
      "Validate against current auth conventions before enabling.",
    ],
  };
}

function mineGenericCall(args: {
  hunk: GitDiffHunk;
  language: SupportedLang;
  beforeLines: string[];
  beforeSnippet: string;
  afterSnippet: string;
}): TemplateCandidate | null {
  const call = args.beforeLines
    .map((line) => extractCallCallee(line))
    .find((callee): callee is string => callee != null);
  if (!call) return null;
  const suffix = `fix.${pathSlug(call.replace(/\./g, "_"))}`;
  return {
    score: 40,
    ruleSuffix: suffix,
    sourceFile: args.hunk.sourceFile,
    language: args.language,
    patterns: [`${call}($$$ARGS)`],
    category: "producer_consumer_drift",
    severity: "medium",
    confidence: "possible",
    message: `Review \`${call}\` call shape removed by a prior fix; confirm this is not reintroducing the fixed issue.`,
    beforeSnippet: args.beforeSnippet,
    ...(args.afterSnippet ? { afterSnippet: args.afterSnippet } : {}),
    rationale: "The fix removed a reusable call expression shape, but Mako could not infer a stronger project-specific rule class.",
    caveats: [
      "This is a low-confidence draft. Rename the rule, narrow the pattern, and run rule_pack_validate before enabling.",
    ],
  };
}

function extractCallCallee(line: string): string | null {
  const trimmed = line.trim();
  if (/^(?:if|for|while|switch|catch|function|return|import|export|const|let|var)\b/.test(trimmed)) {
    return null;
  }
  const match = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(trimmed);
  if (!match) return null;
  const callee = match[1];
  if (["dynamic", "enforceAccountStatus"].includes(callee) || callee.endsWith(".from")) {
    return null;
  }
  return callee;
}

function dedupeCandidates(candidates: TemplateCandidate[]): TemplateCandidate[] {
  const seen = new Set<string>();
  const out: TemplateCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.sourceFile}:${candidate.patterns.join("\u0000")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function loadRelatedFindings(
  projectStore: import("@mako-ai/store").ProjectStore,
  projectId: string,
  filePaths: string[],
): Map<string, ProjectFinding[]> {
  const byFile = new Map<string, ProjectFinding[]>();
  for (const filePath of filePaths) {
    byFile.set(
      filePath,
      projectStore.queryReefFindings({
        projectId,
        filePath,
        includeResolved: true,
        limit: 10,
      }),
    );
  }
  return byFile;
}

function buildDraftYaml(args: {
  name: string;
  templates: ExtractedRuleTemplate[];
  baseCommit: string;
  fixCommit: string;
  warnings: string[];
}): string {
  if (args.templates.length === 0) return "";
  const pack = {
    name: args.name,
    rules: args.templates.map((template) => ({
      id: template.ruleId,
      category: template.category,
      severity: template.severity,
      confidence: template.confidence,
      languages: [template.language],
      message: template.message,
      ...(template.patterns.length === 1
        ? { pattern: template.patterns[0] }
        : { patterns: template.patterns }),
      metadata: {
        minedFrom: {
          baseCommit: args.baseCommit,
          fixCommit: args.fixCommit,
          sourceFile: template.sourceFile,
        },
      },
    })),
  };
  const validation = rulePackSchema.safeParse(pack);
  if (!validation.success) {
    args.warnings.push(`generated draft failed rule-pack schema validation: ${validation.error.message}`);
  }
  return stringifyYaml(pack);
}

function uniqueRuleId(prefix: string, suffix: string, index: number): string {
  const normalizedSuffix = normalizeRuleIdPrefix(suffix);
  return index === 0 ? `${prefix}.${normalizedSuffix}` : `${prefix}.${normalizedSuffix}_${index + 1}`;
}

function normalizeRuleIdPrefix(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/[_.-]{2,}/g, ".")
    .replace(/^[_.-]+|[_.-]+$/g, "");
  return normalized || "mako.mined";
}

function pathSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "mined-rule";
}

function trimSnippet(value: string): string {
  if (value.length <= MAX_SNIPPET_CHARS) return value;
  return `${value.slice(0, MAX_SNIPPET_CHARS - 15)}\n...truncated...`;
}
