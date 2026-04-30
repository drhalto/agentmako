import type {
  ContextPacketIntent,
  ContextPacketIntentFamily,
  ContextPacketReadableCandidate,
  ContextPacketRisk,
  IndexFreshnessSummary,
  ProjectFinding,
} from "@mako-ai/contracts";
import { matchesPathGlob } from "../code-intel/path-globs.js";

export interface ContextRiskRule {
  id: string;
  triggers: string[];
  intentFamilies?: ContextPacketIntentFamily[];
  fileGlobs?: string[];
  riskCode: string;
  reason: string;
  severity: ContextPacketRisk["severity"];
  recommendedHarnessStep?: string;
}

const RISK_RULES: ContextRiskRule[] = [
  {
    id: "type_contract_mismatch",
    triggers: ["type", "interface", "contract", "props", "user type", "session type"],
    intentFamilies: ["debug_type_contract"],
    fileGlobs: ["**/*.ts", "**/*.tsx"],
    riskCode: "type_contract_mismatch",
    reason: "The request or selected context points at a type or interface boundary that may have drifted.",
    severity: "medium",
    recommendedHarnessStep: "Search references for the changed exported type before editing dependents.",
  },
  {
    id: "auth_state_flow",
    triggers: ["auth", "session", "login", "logout", "token", "user"],
    intentFamilies: ["debug_auth_state"],
    riskCode: "auth_state_flow",
    reason: "Auth and session issues often span route handlers, state helpers, and user/session type contracts.",
    severity: "high",
    recommendedHarnessStep: "Trace auth/session creation and consumption from primary files through imports.",
  },
  {
    id: "hydration_boundary",
    triggers: ["hydration", "hydration mismatch", "flash", "useeffect", "date", "math.random", "window"],
    intentFamilies: ["debug_ui_behavior"],
    fileGlobs: ["**/*.tsx", "**/*.jsx"],
    riskCode: "hydration_boundary",
    reason: "The request smells like client render state diverging from server-rendered markup.",
    severity: "medium",
    recommendedHarnessStep: "Check whether nondeterministic values run during render in client-facing components.",
  },
  {
    id: "server_client_boundary",
    triggers: ["use client", "use server", "server action", "client component", "server component"],
    intentFamilies: ["debug_route", "debug_ui_behavior"],
    fileGlobs: ["**/*.ts", "**/*.tsx"],
    riskCode: "server_client_boundary",
    reason: "Server/client boundaries can change what APIs, imports, and state are legal in a file.",
    severity: "medium",
    recommendedHarnessStep: "Classify primary files as client, server, server-action, or shared before editing.",
  },
  {
    id: "rls_policy_gap",
    triggers: ["rls", "policy", "tenant", "supabase", "public role", "service role"],
    intentFamilies: ["debug_database_usage"],
    riskCode: "rls_policy_gap",
    reason: "Database access may depend on row-level security or role-specific policy behavior.",
    severity: "high",
    recommendedHarnessStep: "Inspect table policies and the exact role used by the calling route or function.",
  },
  {
    id: "schema_migration_drift",
    triggers: ["migration", "schema", "database type", "generated type", "db type", "sql"],
    intentFamilies: ["debug_database_usage", "debug_type_contract"],
    riskCode: "schema_migration_drift",
    reason: "Generated types, schema snapshots, and migrations can drift independently.",
    severity: "medium",
    recommendedHarnessStep: "Compare the migration/source schema with generated types before trusting either one.",
  },
  {
    id: "duplicate_pattern_possible",
    triggers: ["precedent", "similar", "pattern", "copy", "duplicate", "another route", "another component"],
    intentFamilies: ["find_precedent", "implement_feature"],
    riskCode: "duplicate_pattern_possible",
    reason: "The request may already have a local precedent worth copying instead of inventing a new shape.",
    severity: "low",
    recommendedHarnessStep: "Use relatedContext and repo_map to find the closest existing implementation.",
  },
];

function lower(value: string): string {
  return value.toLowerCase();
}

function familySet(intent: ContextPacketIntent): Set<ContextPacketIntentFamily> {
  return new Set(intent.families.map((entry) => entry.family));
}

function candidateText(candidate: ContextPacketReadableCandidate): string {
  return [
    candidate.path ?? "",
    candidate.symbolName ?? "",
    candidate.routeKey ?? "",
    candidate.databaseObjectName ?? "",
    candidate.whyIncluded,
    String(candidate.metadata?.query ?? ""),
    String(candidate.metadata?.schemaObject ?? ""),
    String(candidate.metadata?.snippet ?? ""),
    String(candidate.metadata?.hintKind ?? ""),
  ].join(" ");
}

function ruleMatchesFiles(rule: ContextRiskRule, candidates: readonly ContextPacketReadableCandidate[]): boolean {
  if (!rule.fileGlobs || rule.fileGlobs.length === 0) return true;
  return candidates.some((candidate) =>
    candidate.path != null && rule.fileGlobs?.some((glob) => matchesPathGlob(candidate.path ?? "", glob)),
  );
}

function detectRuleMatch(args: {
  rule: ContextRiskRule;
  haystack: string;
  intentFamilies: Set<ContextPacketIntentFamily>;
  candidates: readonly ContextPacketReadableCandidate[];
}): ContextPacketRisk | null {
  const triggerMatches = args.rule.triggers.filter((trigger) => args.haystack.includes(lower(trigger)));
  const intentMatch =
    args.rule.intentFamilies == null ||
    args.rule.intentFamilies.some((family) => args.intentFamilies.has(family));
  const fileMatch = ruleMatchesFiles(args.rule, args.candidates);

  if (!fileMatch || (!intentMatch && triggerMatches.length === 0)) {
    return null;
  }

  const confidence = Math.min(
    0.92,
    0.44 + (intentMatch ? 0.18 : 0) + Math.min(triggerMatches.length, 3) * 0.1,
  );

  return {
    code: args.rule.riskCode,
    reason: args.rule.reason,
    source: "risk_detector",
    severity: args.rule.severity,
    ...(args.rule.recommendedHarnessStep ? { recommendedHarnessStep: args.rule.recommendedHarnessStep } : {}),
    confidence,
  };
}

export function detectContextPacketRisks(args: {
  request: string;
  intent: ContextPacketIntent;
  candidates: readonly ContextPacketReadableCandidate[];
  indexFreshness?: IndexFreshnessSummary;
  activeFindings?: readonly ProjectFinding[];
}): ContextPacketRisk[] {
  const haystack = lower([
    args.request,
    args.intent.entities.keywords.join(" "),
    args.intent.entities.files.join(" "),
    args.intent.entities.symbols.join(" "),
    args.intent.entities.routes.join(" "),
    args.intent.entities.databaseObjects.join(" "),
    ...args.candidates.map(candidateText),
  ].join(" "));
  const families = familySet(args.intent);
  const risks: ContextPacketRisk[] = [];

  for (const rule of RISK_RULES) {
    const risk = detectRuleMatch({ rule, haystack, intentFamilies: families, candidates: args.candidates });
    if (risk) {
      risks.push(risk);
    }
  }

  if (args.indexFreshness && args.indexFreshness.state !== "fresh") {
    risks.push({
      code: "stale_index_evidence",
      reason: `Indexed evidence freshness is ${args.indexFreshness.state}; verify suspicious rows before editing.`,
      source: "freshness",
      severity: args.indexFreshness.state === "unknown" ? "medium" : "low",
      recommendedHarnessStep: "Use live_text_search for exact line checks or project_index_refresh before relying on indexed AST evidence.",
      confidence: 0.9,
    });
  }

  for (const finding of args.activeFindings ?? []) {
    risks.push({
      code: finding.ruleId ?? finding.source,
      reason: `${finding.message}${finding.filePath ? ` (${finding.filePath})` : ""}`,
      source: "open_loop",
      severity: finding.severity === "error" ? "high" : finding.severity === "warning" ? "medium" : "low",
      recommendedHarnessStep: finding.filePath
        ? `Inspect ${finding.filePath} before editing; this active Reef finding is already open.`
        : "Inspect the active Reef finding before editing this surface.",
      confidence: 0.94,
    });
  }

  return risks.sort((left, right) => {
    const severityOrder: Record<ContextPacketRisk["severity"], number> = {
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    };
    return severityOrder[right.severity] - severityOrder[left.severity] || right.confidence - left.confidence;
  });
}
