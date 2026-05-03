import path from "node:path";
import type {
  ProjectConvention,
  ProjectFinding,
  ReefLearningReviewToolInput,
  ReefLearningReviewToolOutput,
  ReefLearningSuggestion,
  RuntimeUsefulnessEvent,
} from "@mako-ai/contracts";
import type { ToolRunRecord } from "@mako-ai/store";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { collectProjectConventions } from "./conventions.js";
import { buildReefToolExecution } from "./tool-execution.js";

const DEFAULT_LIMIT = 20;
const REVIEW_FINDING_LIMIT = 1000;
const REVIEW_TOOL_RUN_LIMIT = 200;
const REVIEW_FEEDBACK_LIMIT = 100;
const LOW_CONFIDENCE_FLOOR = 0.5;

const LEARNING_GUARDRAILS = [
  "reef_learning_review is suggestion-only and never writes rule packs, instructions, conventions, or memories.",
  "Accept durable learning only after a human or agent explicitly reviews the draft and chooses a write path.",
  "Treat drafts from resolved findings as regression candidates, not proof that the proposed pattern is generally correct.",
  "Keep session notes and conjectures separate from durable project facts unless they are verified later.",
];

export async function reefLearningReviewTool(
  input: ReefLearningReviewToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefLearningReviewToolOutput> {
  const startedAtMs = Date.now();
  const mode = input.mode ?? "suggest";

  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const warnings: string[] = [];
    const changedFiles = unique((input.changedFiles ?? []).map((filePath) =>
      normalizeProjectPath(project.canonicalPath, filePath)
    ));
    const allFindings = projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: true,
      limit: REVIEW_FINDING_LIMIT,
    });
    const resolvedFindings = selectResolvedFindings(allFindings, {
      changedFiles,
      resolvedFindingIds: input.resolvedFindingIds,
    });
    if ((input.resolvedFindingIds?.length ?? 0) > 0) {
      const found = new Set(resolvedFindings.map((finding) => finding.fingerprint));
      const missing = input.resolvedFindingIds?.filter((fingerprint) => !found.has(fingerprint)) ?? [];
      if (missing.length > 0) {
        warnings.push(`no resolved Reef finding matched ${missing.length} requested resolvedFindingIds value(s).`);
      }
    }

    const repeatedRules = repeatedRuleGroups(allFindings);
    const feedbackSignals = projectStore.queryUsefulnessEvents({
      projectId: project.projectId,
      decisionKind: "agent_feedback",
      since: input.since,
      limit: REVIEW_FEEDBACK_LIMIT,
    }).filter((event) => event.grade !== "full");
    const requestedToolRunIds = input.recentToolRunIds ?? [];
    const toolRunCandidates = requestedToolRunIds.length > 0
      ? projectStore.queryToolRuns({ runIds: [...requestedToolRunIds], limit: requestedToolRunIds.length })
      : projectStore.queryToolRuns({ limit: REVIEW_TOOL_RUN_LIMIT });
    const recentToolRuns = selectRecentToolRuns(toolRunCandidates, {
      projectId: project.projectId,
      recentToolRunIds: input.recentToolRunIds,
      since: input.since,
    });
    if (requestedToolRunIds.length > 0) {
      const found = new Set(recentToolRuns.map((run) => run.runId));
      const missing = requestedToolRunIds.filter((runId) => !found.has(runId));
      if (missing.length > 0) {
        warnings.push(`no recent tool run matched ${missing.length} requested recentToolRunIds value(s) after project and since filters.`);
      }
    }

    const existingConventions = collectProjectConventions(projectStore, project.projectId, { limit: 200 });
    const existingConventionKeys = new Set(existingConventions.flatMap(conventionDedupeKeys));

    const suggestions = dedupeSuggestions([
      ...resolvedFindings.flatMap((finding) => suggestionsFromResolvedFinding(finding)),
      ...repeatedRules.flatMap((group) => suggestionsFromRepeatedRule(group, existingConventionKeys)),
      ...suggestionsFromRecentToolRuns(recentToolRuns, resolvedFindings, changedFiles),
      ...suggestionsFromFeedback(feedbackSignals),
    ])
      .filter((suggestion) => input.includeLowConfidence || suggestion.confidence >= LOW_CONFIDENCE_FLOOR)
      .sort((left, right) =>
        right.confidence - left.confidence ||
        kindRank(left.kind) - kindRank(right.kind) ||
        left.id.localeCompare(right.id)
      )
      .slice(0, input.limit ?? DEFAULT_LIMIT);

    if (suggestions.length === 0) {
      warnings.push(
        "no learning suggestions met the confidence floor; pass resolvedFindingIds, changedFiles, recentToolRunIds, or includeLowConfidence=true for a broader review.",
      );
    }

    const reefExecution = await buildReefToolExecution({
      toolName: "reef_learning_review",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      queryPath: "reef_materialized_view",
      returnedCount: suggestions.length,
    });

    return {
      toolName: "reef_learning_review",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      mode,
      suggestions,
      summary: {
        changedFileCount: changedFiles.length,
        resolvedFindingCount: resolvedFindings.length,
        repeatedRuleCount: repeatedRules.length,
        recentToolRunCount: recentToolRuns.length,
        feedbackSignalCount: feedbackSignals.length,
        suggestionCount: suggestions.length,
      },
      guardrails: LEARNING_GUARDRAILS,
      reefExecution,
      warnings,
    };
  });
}

interface SelectResolvedFindingsInput {
  changedFiles: readonly string[];
  resolvedFindingIds?: readonly string[];
}

function selectResolvedFindings(
  findings: readonly ProjectFinding[],
  input: SelectResolvedFindingsInput,
): ProjectFinding[] {
  const requested = new Set(input.resolvedFindingIds ?? []);
  const changed = new Set(input.changedFiles);
  return findings.filter((finding) => {
    if (finding.status !== "resolved") return false;
    if (requested.size > 0) return requested.has(finding.fingerprint);
    if (changed.size > 0) return Boolean(finding.filePath && changed.has(finding.filePath));
    return true;
  });
}

function conventionDedupeKeys(convention: ProjectConvention): string[] {
  return unique([
    convention.id.toLowerCase(),
    `${convention.kind}:${convention.filePath ?? ""}:${convention.title.toLowerCase()}`,
    ...convention.evidence.map((evidence) => `rule:${evidence.toLowerCase()}`),
    ...convention.evidence.map((evidence) => `${convention.source}:${evidence.toLowerCase()}`),
  ]);
}

interface RepeatedRuleGroup {
  key: string;
  ruleId: string;
  source: string;
  findings: ProjectFinding[];
  resolvedCount: number;
  activeCount: number;
  files: string[];
}

function repeatedRuleGroups(findings: readonly ProjectFinding[]): RepeatedRuleGroup[] {
  const groups = new Map<string, ProjectFinding[]>();
  for (const finding of findings) {
    const ruleId = finding.ruleId ?? finding.source;
    const key = `${finding.source}\0${ruleId}`;
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => repeatedRuleGroup(key, group))
    .filter((group): group is RepeatedRuleGroup => Boolean(group &&
      group.findings.length >= 2 &&
      group.resolvedCount > 0 &&
      group.files.length > 0
    ))
    .sort((left, right) =>
      right.resolvedCount - left.resolvedCount ||
      right.findings.length - left.findings.length ||
      left.ruleId.localeCompare(right.ruleId)
    );
}

function repeatedRuleGroup(key: string, findings: readonly ProjectFinding[]): RepeatedRuleGroup | undefined {
  const [source, ruleId] = key.split("\0");
  if (!source || !ruleId) return undefined;
  const files = unique(findings.map((finding) => finding.filePath).filter((filePath): filePath is string => Boolean(filePath)));
  return {
    key,
    ruleId,
    source,
    findings: [...findings],
    resolvedCount: findings.filter((finding) => finding.status === "resolved").length,
    activeCount: findings.filter((finding) => finding.status === "active").length,
    files,
  };
}

function suggestionsFromResolvedFinding(finding: ProjectFinding): ReefLearningSuggestion[] {
  const ruleId = finding.ruleId ?? finding.source;
  const filePath = finding.filePath;
  const evidenceRefs = findingEvidenceRefs(finding);
  const suggestions: ReefLearningSuggestion[] = [
    {
      id: `learning:sentinel:${finding.fingerprint}`,
      kind: "sentinel_rule",
      status: "proposed",
      title: `Draft a sentinel for ${ruleId}`,
      confidence: filePath ? 0.82 : 0.62,
      rationale: `Resolved finding ${ruleId} can become a targeted regression guard if the fixed invariant should remain durable.`,
      evidenceRefs,
      sourceSignals: ["resolved_finding", finding.source],
      suggestedAction: "Review the draft sentinel and explicitly add a rule pack only if this invariant should be enforced in future runs.",
      target: {
        ...(filePath ? { filePath } : {}),
        ruleId,
        findingFingerprint: finding.fingerprint,
      },
      draft: {
        path: `.mako/rules/${slug(ruleId)}-sentinel.yaml`,
        content: draftSentinelRuleYaml(finding),
      },
      metadata: {
        source: finding.source,
        severity: finding.severity,
        message: finding.message,
      },
    },
  ];

  if (filePath) {
    suggestions.push({
      id: `learning:instruction:${finding.fingerprint}`,
      kind: "instruction_patch",
      status: "proposed",
      title: `Consider an instruction for ${path.dirname(filePath).replace(/\\/g, "/")}`,
      confidence: 0.58,
      rationale: "A resolved finding tied to a concrete file may represent project-specific guidance worth documenting near the codebase instructions.",
      evidenceRefs,
      sourceSignals: ["resolved_finding", "file_scoped_instruction_candidate"],
      suggestedAction: "Review the instruction text and explicitly patch .mako/instructions.md or AGENTS.md only if it is broadly useful.",
      target: {
        filePath,
        ruleId,
        findingFingerprint: finding.fingerprint,
      },
      draft: {
        path: ".mako/instructions.md",
        patch: draftInstructionPatch(finding),
      },
    });
  }

  return suggestions;
}

function suggestionsFromRepeatedRule(
  group: RepeatedRuleGroup,
  existingConventionKeys: Set<string>,
): ReefLearningSuggestion[] {
  const sampleFindings = group.findings.slice(0, 5);
  const evidenceRefs = sampleFindings.flatMap(findingEvidenceRefs);
  const suggestions: ReefLearningSuggestion[] = [{
    id: `learning:rule-pack:${slug(group.source)}:${slug(group.ruleId)}`,
    kind: "rule_pack_template",
    status: "proposed",
    title: `Generalize repeated ${group.ruleId} fixes`,
    confidence: Math.min(0.86, 0.62 + group.resolvedCount * 0.06 + group.files.length * 0.03),
    rationale: `${group.resolvedCount} resolved finding(s) and ${group.findings.length} total finding(s) share rule ${group.ruleId}; this may justify a reusable rule instead of one-off fixes.`,
    evidenceRefs,
    sourceSignals: ["repeated_rule_history", group.source],
    suggestedAction: "Use extract_rule_template on the relevant fix commit or author a reviewed .mako/rules entry; do not auto-write this draft.",
    target: {
      filePath: group.files[0],
      ruleId: group.ruleId,
    },
    draft: {
      path: `.mako/rules/${slug(group.ruleId)}-review.yaml`,
      content: draftRepeatedRuleYaml(group),
    },
    metadata: {
      source: group.source,
      resolvedCount: group.resolvedCount,
      activeCount: group.activeCount,
      files: group.files.slice(0, 10),
    },
  }];

  const conventionKeys = [
    `rule:${group.source}:${group.ruleId}`.toLowerCase(),
    `rule:${group.ruleId}`.toLowerCase(),
    `${group.source}:${group.ruleId}`.toLowerCase(),
  ];
  if (!conventionKeys.some((key) => existingConventionKeys.has(key))) {
    suggestions.push({
      id: `learning:convention:${slug(group.source)}:${slug(group.ruleId)}`,
      kind: "project_convention_candidate",
      status: "proposed",
      title: `Promote ${group.ruleId} as a project convention`,
      confidence: Math.min(0.8, 0.56 + group.resolvedCount * 0.05),
      rationale: "Repeated findings under the same rule can indicate a convention that should be visible before edits, even when no new rule is accepted yet.",
      evidenceRefs,
      sourceSignals: ["repeated_rule_history", "convention_candidate"],
      suggestedAction: "Review whether this belongs as a convention fact or scoped instruction; keep it as a candidate until explicitly accepted.",
      target: {
        filePath: group.files[0],
        ruleId: group.ruleId,
      },
      metadata: {
        conventionKind: inferConventionKind(group.ruleId),
        files: group.files.slice(0, 10),
      },
    });
  }

  return suggestions;
}

function suggestionsFromRecentToolRuns(
  toolRuns: readonly ToolRunRecord[],
  resolvedFindings: readonly ProjectFinding[],
  changedFiles: readonly string[],
): ReefLearningSuggestion[] {
  if (toolRuns.length === 0) return [];
  const successfulRuns = toolRuns.filter((run) => run.outcome === "success");
  if (successfulRuns.length === 0) return [];
  const evidenceRefs = successfulRuns.slice(0, 8).map((run) => `tool_run:${run.runId}`);
  const requestId = successfulRuns.find((run) => run.requestId)?.requestId;
  return [{
    id: `learning:session:${slug(requestId ?? successfulRuns[0]?.runId ?? "recent")}`,
    kind: "session_recall_note",
    status: "proposed",
    title: "Capture a reviewed session recall note",
    confidence: resolvedFindings.length > 0 || changedFiles.length > 0 ? 0.57 : 0.42,
    rationale: "Recent successful tool runs plus changed or resolved project state may be useful history, but should stay in session recall rather than durable facts.",
    evidenceRefs,
    sourceSignals: ["recent_tool_runs", ...(resolvedFindings.length > 0 ? ["resolved_finding"] : [])],
    suggestedAction: "Summarize the session only after review; do not promote transient task history into Reef facts.",
    target: {
      toolRunId: successfulRuns[0]?.runId,
      ...(requestId ? { requestId } : {}),
    },
    draft: {
      content: draftSessionRecallNote(successfulRuns, resolvedFindings, changedFiles),
    },
    metadata: {
      toolNames: unique(successfulRuns.map((run) => run.toolName)).slice(0, 12),
      changedFiles: changedFiles.slice(0, 12),
      resolvedFindingCount: resolvedFindings.length,
    },
  }];
}

function suggestionsFromFeedback(feedbackSignals: readonly RuntimeUsefulnessEvent[]): ReefLearningSuggestion[] {
  const byTool = new Map<string, RuntimeUsefulnessEvent[]>();
  for (const event of feedbackSignals) {
    const toolName = event.family || event.toolName || "unknown";
    const group = byTool.get(toolName) ?? [];
    group.push(event);
    byTool.set(toolName, group);
  }

  return [...byTool.entries()].map(([toolName, events]) => ({
    id: `learning:feedback:${slug(toolName)}`,
    kind: "conjecture" as const,
    status: "proposed" as const,
    title: `Review feedback pattern for ${toolName}`,
    confidence: Math.min(0.72, 0.48 + events.length * 0.08),
    rationale: `${events.length} recent agent feedback signal(s) marked ${toolName} partial or no; this is a hypothesis for tool or instruction improvement, not durable project truth.`,
    evidenceRefs: events.slice(0, 8).map((event) => `feedback:${event.eventId}`),
    sourceSignals: ["agent_feedback", ...unique(events.flatMap((event) => event.reasonCodes)).slice(0, 6)],
    suggestedAction: "Inspect the referenced feedback and update tool docs, planner routing, or validation behavior only after confirming the pattern.",
    target: {
      requestId: events.find((event) => event.requestId)?.requestId,
    },
    metadata: {
      toolName,
      grades: events.map((event) => event.grade),
      ttl: "review_before_next_release",
    },
  }));
}

interface SelectRecentToolRunsInput {
  projectId: string;
  recentToolRunIds?: readonly string[];
  since?: string;
}

function selectRecentToolRuns(
  runs: readonly ToolRunRecord[],
  input: SelectRecentToolRunsInput,
): ToolRunRecord[] {
  const requested = new Set(input.recentToolRunIds ?? []);
  const sinceMs = input.since ? Date.parse(input.since) : undefined;
  return runs.filter((run) => {
    if (run.projectId && run.projectId !== input.projectId) return false;
    if (requested.size > 0 && !requested.has(run.runId)) return false;
    if (sinceMs !== undefined && Number.isFinite(sinceMs) && Date.parse(run.finishedAt) < sinceMs) return false;
    return true;
  });
}

function findingEvidenceRefs(finding: ProjectFinding): string[] {
  return unique([
    `finding:${finding.fingerprint}`,
    ...(finding.filePath ? [`${finding.filePath}${finding.line ? `:${finding.line}` : ""}`] : []),
    ...(finding.evidenceRefs ?? []),
    ...finding.factFingerprints.map((fingerprint) => `fact:${fingerprint}`),
  ]);
}

function draftSentinelRuleYaml(finding: ProjectFinding): string {
  const ruleId = finding.ruleId ?? finding.source;
  return [
    "# Draft only. Review and replace the pattern with the fixed anti-pattern before accepting.",
    "name: learning review sentinels",
    "rules:",
    `  - id: learning.${slug(ruleId)}.${slug(finding.filePath ?? "project")}`,
    "    type: problem",
    `    severity: ${finding.severity}`,
    `    message: ${yamlString(`Do not reintroduce resolved finding: ${finding.message}`)}`,
    "    languages: [ts, tsx, js, jsx]",
    "    patterns:",
    "      - TODO_REPLACE_WITH_REVIEWED_STRUCTURAL_PATTERN",
    "    metadata:",
    `      sourceFinding: ${yamlString(finding.fingerprint)}`,
    `      sourceRule: ${yamlString(ruleId)}`,
    ...(finding.filePath ? [`      targetFile: ${yamlString(finding.filePath)}`] : []),
    "",
  ].join("\n");
}

function draftRepeatedRuleYaml(group: RepeatedRuleGroup): string {
  return [
    "# Draft only. Prefer extract_rule_template on the fix commit before accepting.",
    "name: learning review repeated rules",
    "rules:",
    `  - id: learning.${slug(group.ruleId)}`,
    "    type: problem",
    "    severity: warning",
    `    message: ${yamlString(`Repeated ${group.ruleId} finding pattern should not regress.`)}`,
    "    languages: [ts, tsx, js, jsx]",
    "    patterns:",
    "      - TODO_REPLACE_WITH_REVIEWED_STRUCTURAL_PATTERN",
    "    metadata:",
    `      source: ${yamlString(group.source)}`,
    `      resolvedCount: ${group.resolvedCount}`,
    `      activeCount: ${group.activeCount}`,
    "      sampleFiles:",
    ...group.files.slice(0, 5).map((filePath) => `        - ${yamlString(filePath)}`),
    "",
  ].join("\n");
}

function draftInstructionPatch(finding: ProjectFinding): string {
  const filePath = finding.filePath ?? "the affected files";
  const ruleId = finding.ruleId ?? finding.source;
  return [
    "### Learning Review Candidate",
    "",
    `- When editing ${filePath}, preserve the invariant behind ${ruleId}: ${finding.message}`,
    "",
  ].join("\n");
}

function draftSessionRecallNote(
  runs: readonly ToolRunRecord[],
  resolvedFindings: readonly ProjectFinding[],
  changedFiles: readonly string[],
): string {
  const toolNames = unique(runs.map((run) => run.toolName)).slice(0, 8);
  return [
    "Learning review session note draft:",
    `- Tools used: ${toolNames.join(", ") || "none"}.`,
    `- Changed files: ${changedFiles.slice(0, 8).join(", ") || "none supplied"}.`,
    `- Resolved findings: ${resolvedFindings.map((finding) => finding.ruleId ?? finding.source).slice(0, 8).join(", ") || "none selected"}.`,
    "- Review before storing as session recall; do not persist as project fact.",
  ].join("\n");
}

function inferConventionKind(ruleId: string): string {
  const lower = ruleId.toLowerCase();
  if (/\b(auth|role|permission|session|tenant|rls)\b/.test(lower)) return "auth_guard";
  if (/\b(client|server|runtime|boundary)\b/.test(lower)) return "runtime_boundary";
  if (/\b(schema|table|rpc|database|db)\b/.test(lower)) return "schema_pattern";
  return "project_pattern";
}

function dedupeSuggestions(suggestions: readonly ReefLearningSuggestion[]): ReefLearningSuggestion[] {
  const byId = new Map<string, ReefLearningSuggestion>();
  for (const suggestion of suggestions) {
    const existing = byId.get(suggestion.id);
    if (!existing || suggestion.confidence > existing.confidence) {
      byId.set(suggestion.id, suggestion);
    }
  }
  return [...byId.values()];
}

function kindRank(kind: ReefLearningSuggestion["kind"]): number {
  switch (kind) {
    case "sentinel_rule":
      return 0;
    case "rule_pack_template":
      return 1;
    case "project_convention_candidate":
      return 2;
    case "instruction_patch":
      return 3;
    case "session_recall_note":
      return 4;
    case "conjecture":
      return 5;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function normalizeProjectPath(projectRoot: string, value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path.isAbsolute(value)) return normalized;
  const relative = path.relative(projectRoot, value).replace(/\\/g, "/");
  return relative.startsWith("../") ? normalized : relative;
}

function slug(value: string): string {
  const slugged = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slugged || "project";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
