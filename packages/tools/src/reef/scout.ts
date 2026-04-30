import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type { DbReviewComment, ReefCandidate, ReefScoutToolInput, ReefScoutToolOutput } from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  addCandidate,
  confidenceFromFinding,
  confidenceLabelForFact,
  confidenceLabelForFinding,
  diagnosticRunCache,
  diagnosticRunSearchText,
  factSearchText,
  filePathFromFact,
  findingSearchText,
  ruleSearchText,
  scoreText,
  severityWeight,
  tokenizeQuery,
} from "./shared.js";
import { buildReefToolExecution } from "./tool-execution.js";

type ScoutIntent = "app_flow" | "schema" | "mixed";
type ScoutCandidateDomain = "app" | "schema" | "unknown";

const APP_FLOW_TOKENS = new Set([
  "api",
  "auth",
  "button",
  "client",
  "component",
  "controller",
  "dashboard",
  "flow",
  "handler",
  "hook",
  "layout",
  "login",
  "middleware",
  "onboarding",
  "page",
  "route",
  "routes",
  "screen",
  "server",
  "service",
  "session",
  "ui",
]);

const SCHEMA_TOKENS = new Set([
  "column",
  "columns",
  "constraint",
  "database",
  "db",
  "foreign",
  "function",
  "index",
  "indexes",
  "migration",
  "migrations",
  "policy",
  "policies",
  "postgres",
  "rls",
  "rpc",
  "schema",
  "sql",
  "storage",
  "supabase",
  "table",
  "tables",
  "trigger",
]);

function classifyScoutIntent(query: string, tokens: readonly string[]): ScoutIntent {
  const lower = query.toLowerCase();
  let appScore = 0;
  let schemaScore = 0;

  for (const token of tokens) {
    if (APP_FLOW_TOKENS.has(token)) appScore += 1;
    if (SCHEMA_TOKENS.has(token)) schemaScore += 1;
  }

  if (/\brow[-\s]+level\b|\brls\b|\bpolicy\b|\bpolicies\b|\bforeign[-\s]+key\b|\bpublic\.[a-z0-9_]+\b/.test(lower)) {
    schemaScore += 3;
  }
  if (/\b(route|page|layout|component|handler|middleware|dashboard|onboarding|flow)\b/.test(lower)) {
    appScore += 2;
  }

  if (schemaScore >= appScore + 2) return "schema";
  if (appScore >= schemaScore + 1) return "app_flow";
  return "mixed";
}

function textDomain(text: string): ScoutCandidateDomain {
  const lower = text.toLowerCase();
  if (/(^|[^a-z0-9])(db|database|schema|table|column|rls|policy|rpc|sql|trigger|migration|constraint)([^a-z0-9]|$)/.test(lower)) {
    return "schema";
  }
  if (/(^|[^a-z0-9])(route|page|layout|component|handler|middleware|auth|session|dashboard|flow|client|server)([^a-z0-9]|$)/.test(lower)) {
    return "app";
  }
  return "unknown";
}

function factDomain(fact: Parameters<typeof factSearchText>[0]): ScoutCandidateDomain {
  if (fact.subject.kind === "schema_object") return "schema";
  const lowerKind = fact.kind.toLowerCase();
  if (/(^|[^a-z0-9])(db|schema|table|column|rls|policy|rpc|sql|trigger|migration|constraint)([^a-z0-9]|$)/.test(lowerKind)) {
    return "schema";
  }
  if (filePathFromFact(fact) || fact.subject.kind === "route" || fact.subject.kind === "import_edge" || fact.subject.kind === "symbol") {
    return "app";
  }
  return textDomain(factSearchText(fact));
}

function findingDomain(finding: Parameters<typeof findingSearchText>[0]): ScoutCandidateDomain {
  if (finding.filePath) return "app";
  return textDomain(findingSearchText(finding));
}

function ruleDomain(rule: Parameters<typeof ruleSearchText>[0]): ScoutCandidateDomain {
  return textDomain(ruleSearchText(rule));
}

function adjustScoutScore(score: number, intent: ScoutIntent, domain: ScoutCandidateDomain): number {
  if (intent === "app_flow") {
    if (domain === "app") return score + 5;
    if (domain === "schema") return score - 8;
  }
  if (intent === "schema") {
    if (domain === "schema") return score + 6;
    if (domain === "app") return score - 3;
  }
  if (intent === "mixed" && domain !== "unknown") {
    return score + 1;
  }
  return score;
}

export async function reefScoutTool(
  input: ReefScoutToolInput,
  options: ToolServiceOptions,
): Promise<ReefScoutToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const limit = input.limit ?? 20;
    const focusFiles = new Set((input.focusFiles ?? []).map((filePath) => normalizeFileQuery(project.canonicalPath, filePath)));
    const queryTokens = tokenizeQuery(input.query);
    const intent = classifyScoutIntent(input.query, queryTokens);
    const facts = projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 });
    const findings = projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: false,
      limit: 500,
    }).filter((finding) => finding.status === "active");
    const rules = projectStore.listReefRuleDescriptors();
    const runs = projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 50 }).map((run) => ({
      ...run,
      cache: diagnosticRunCache(run, {
        checkedAt: new Date().toISOString(),
        checkedAtMs: Date.now(),
        staleAfterMs: REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS,
      }),
    }));
    const dbReviewComments = projectStore.queryDbReviewComments({
      projectId: project.projectId,
      limit: 200,
    });
    const candidates = new Map<string, ReefCandidate>();

    for (const finding of findings) {
      const text = findingSearchText(finding);
      const filePath = finding.filePath;
      const score = adjustScoutScore(
        scoreText(text, queryTokens) + (filePath && focusFiles.has(filePath) ? 10 : 0) + severityWeight(finding.severity),
        intent,
        findingDomain(finding),
      );
      if (score <= 0) continue;
      addCandidate(candidates, {
        id: `finding:${finding.fingerprint}`,
        kind: "finding",
        title: finding.message,
        ...(filePath ? { filePath } : {}),
        subjectFingerprint: finding.subjectFingerprint,
        source: finding.source,
        overlay: finding.overlay,
        score,
        confidence: confidenceFromFinding(finding),
        confidenceLabel: confidenceLabelForFinding(finding),
        freshness: finding.freshness,
        whyIncluded: `matched query against Reef finding ${finding.ruleId ?? finding.source}`,
        suggestedActions: ["Call reef_inspect for this subject before editing.", "Read the file with the normal harness tools before changing it."],
      });
    }

    for (const fact of facts) {
      const filePath = filePathFromFact(fact);
      const score = adjustScoutScore(
        scoreText(factSearchText(fact), queryTokens) + (filePath && focusFiles.has(filePath) ? 8 : 0),
        intent,
        factDomain(fact),
      );
      if (score <= 0) continue;
      addCandidate(candidates, {
        id: `fact:${fact.fingerprint}`,
        kind: fact.kind === "file_snapshot" ? "file" : "fact",
        title: `${fact.kind}${filePath ? `: ${filePath}` : ""}`,
        ...(filePath ? { filePath } : {}),
        subjectFingerprint: fact.subjectFingerprint,
        source: fact.source,
        overlay: fact.overlay,
        score,
        confidence: fact.confidence,
        confidenceLabel: confidenceLabelForFact(fact),
        freshness: fact.freshness,
        whyIncluded: `matched query against Reef fact ${fact.kind}`,
        suggestedActions: ["Call reef_inspect for complete fact and finding context."],
      });
    }

    for (const rule of rules) {
      const score = adjustScoutScore(
        scoreText(ruleSearchText(rule), queryTokens) + (rule.enabledByDefault ? 1 : 0),
        intent,
        ruleDomain(rule),
      );
      if (score <= 0) continue;
      addCandidate(candidates, {
        id: `rule:${rule.source}:${rule.id}`,
        kind: "rule",
        title: rule.title,
        source: rule.source,
        score,
        confidence: rule.enabledByDefault ? 0.8 : 0.55,
        confidenceLabel: "historical",
        whyIncluded: `matched query against Reef rule descriptor ${rule.id}`,
        suggestedActions: ["Call rule_memory to see active and acknowledged history for this rule."],
        metadata: {
          ruleId: rule.id,
          sourceNamespace: rule.sourceNamespace,
          severity: rule.severity,
          enabledByDefault: rule.enabledByDefault,
        },
      });
    }

    for (const run of runs) {
      const score = adjustScoutScore(
        scoreText(diagnosticRunSearchText(run), queryTokens) + (run.status !== "succeeded" ? 2 : 0),
        intent,
        textDomain(diagnosticRunSearchText(run)),
      );
      if (score <= 0) continue;
      addCandidate(candidates, {
        id: `diagnostic_run:${run.runId}`,
        kind: "diagnostic_run",
        title: `${run.source} ${run.status}`,
        source: run.source,
        overlay: run.overlay,
        score,
        confidence: run.cache?.state === "fresh" ? 0.8 : 0.5,
        confidenceLabel: run.cache?.state === "stale" ? "stale_indexed" : "historical",
        whyIncluded: `matched query against diagnostic run ${run.source}`,
        suggestedActions: ["Call verification_state before trusting diagnostic freshness."],
        metadata: {
          runId: run.runId,
          status: run.status,
          findingCount: run.findingCount,
          cacheState: run.cache?.state ?? "unknown",
        },
      });
    }

    for (const comment of dbReviewComments) {
      const score = adjustScoutScore(
        scoreText(dbReviewCommentSearchText(comment), queryTokens) + severityWeight(comment.severity ?? "info"),
        intent,
        "schema",
      );
      if (score <= 0) continue;
      addCandidate(candidates, {
        id: `db_review_comment:${comment.commentId}`,
        kind: "fact",
        title: `DB review: ${formatDbReviewTarget(comment.target)}`,
        subjectFingerprint: comment.targetFingerprint,
        source: comment.sourceToolName,
        score,
        confidence: 0.9,
        confidenceLabel: "historical",
        whyIncluded: `matched query against DB review comment ${comment.commentId}`,
        suggestedActions: ["Call db_review_comments for the full database review comment history on this target."],
        metadata: {
          commentId: comment.commentId,
          target: {
            objectType: comment.target.objectType,
            ...(comment.target.schemaName ? { schemaName: comment.target.schemaName } : {}),
            ...(comment.target.parentObjectName ? { parentObjectName: comment.target.parentObjectName } : {}),
            objectName: comment.target.objectName,
          },
          category: comment.category,
          severity: comment.severity ?? null,
          comment: comment.comment,
          tags: comment.tags,
          createdBy: comment.createdBy ?? null,
          createdAt: comment.createdAt,
        },
      });
    }

    if (candidates.size === 0 && focusFiles.size > 0) {
      for (const filePath of focusFiles) {
        addCandidate(candidates, {
          id: `file:${filePath}`,
          kind: "file",
          title: filePath,
          filePath,
          source: "reef_scout",
          score: 1,
          confidence: 0.35,
          confidenceLabel: "unknown",
          whyIncluded: "included because the caller supplied this focus file",
          suggestedActions: ["Call reef_inspect or file_findings for known Reef context."],
        });
      }
    }

    const sorted = [...candidates.values()]
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(0, limit);
    const hasStaleCandidate = sorted.some((candidate) => candidate.freshness?.state !== undefined && candidate.freshness.state !== "fresh");
    const staleEvidenceLabeled = sorted.filter((candidate) =>
      candidate.freshness?.state !== undefined && candidate.freshness.state !== "fresh"
    ).length;
    const suggestedActions = [
      "Read the top candidate files with the normal harness tools before editing.",
      "Use reef_inspect on a top file or subject when you need the evidence trail.",
      ...(hasStaleCandidate ? ["Run working_tree_overlay or project_index_status when stale evidence appears in the scout results."] : []),
    ];
    const reefExecution = await buildReefToolExecution({
      toolName: "reef_scout",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled,
      returnedCount: sorted.length,
    });

    return {
      toolName: "reef_scout",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      query: input.query,
      candidates: sorted,
      ...(input.includeRawEvidence ? { facts: facts.slice(0, limit), findings: findings.slice(0, limit) } : {}),
      reefExecution,
      suggestedActions,
      warnings: candidates.size === 0 ? ["no Reef candidates matched the query"] : [],
    };
  });
}

function dbReviewCommentSearchText(comment: DbReviewComment): string {
  return [
    comment.category,
    comment.severity ?? "",
    comment.comment,
    comment.target.objectType,
    comment.target.schemaName ?? "",
    comment.target.parentObjectName ?? "",
    comment.target.objectName,
    ...comment.tags,
  ].join(" ");
}

function formatDbReviewTarget(target: DbReviewComment["target"]): string {
  const parent = target.parentObjectName ? `${target.parentObjectName}.` : "";
  const schema = target.schemaName ? `${target.schemaName}.` : "";
  return `${target.objectType}:${schema}${parent}${target.objectName}`;
}
