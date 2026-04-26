/**
 * SARIF 2.1.0 output for `AnswerResult` trust + diagnostic surfaces.
 *
 * SARIF (Static Analysis Results Interchange Format) is the OASIS standard
 * static-analysis result format. Emitting SARIF lets mako integrate with
 * GitHub Code Scanning, VS Code's Problems panel, GitLab Code Quality,
 * Sourcegraph, and every other consumer that speaks this format — no
 * bespoke ingest code per downstream.
 *
 * Design:
 *   - Minimal typed subset of the spec; no runtime dependency on any SARIF
 *     library. Only the fields we actually populate are typed.
 *   - Drives off the existing `AnswerSurfaceIssue` identity triple
 *     (`matchBasedId` / `codeHash` / `patternHash`) as SARIF
 *     `partialFingerprints` so downstream tools dedupe findings across runs
 *     exactly the way our own dedup layer does.
 *   - Maps our `severity` (low / medium / high / critical) onto SARIF `level`
 *     (note / warning / error) with a deterministic table.
 *   - Handles both single-location issues (`path` + `line`) and
 *     producer/consumer findings (renders as related locations).
 *
 * Output is a plain JavaScript object — callers serialize with JSON.stringify.
 */

import type {
  AnswerResult,
  AnswerSurfaceIssue,
  AnswerSurfaceIssueSeverity,
  JsonObject,
} from "@mako-ai/contracts";

/** SARIF report severity level. We only emit three of the four (skip `none`). */
export type SarifLevel = "note" | "warning" | "error";

export interface SarifArtifactLocation {
  uri: string;
}

export interface SarifRegion {
  startLine: number;
  endLine?: number;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
  message?: { text: string };
}

export interface SarifReportingDescriptor {
  id: string;
  name?: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration?: { level: SarifLevel };
  properties?: JsonObject;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations?: SarifLocation[];
  relatedLocations?: SarifLocation[];
  partialFingerprints: JsonObject;
  properties?: JsonObject;
}

export interface SarifDriver {
  name: string;
  informationUri?: string;
  version?: string;
  rules: SarifReportingDescriptor[];
}

export interface SarifTool {
  driver: SarifDriver;
}

export interface SarifRun {
  tool: SarifTool;
  invocations?: Array<{
    executionSuccessful: boolean;
    properties?: JsonObject;
  }>;
  results: SarifResult[];
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: SarifRun[];
}

export interface FormatSurfaceSarifOptions {
  toolName?: string;
  toolVersion?: string;
  informationUri?: string;
  /**
   * When set, embed additional `properties` on every result (e.g. trust
   * state, query kind) so downstream consumers that honor custom properties
   * get the trust context without needing to parse the message text.
   */
  resultProperties?: JsonObject;
}

const SEVERITY_TO_LEVEL: Record<AnswerSurfaceIssueSeverity, SarifLevel> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
};

const SARIF_SCHEMA_URI =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";
const DEFAULT_TOOL_NAME = "mako-ai";
const DEFAULT_INFORMATION_URI = "https://github.com/makoai/mako-ai";

function severityToLevel(severity: AnswerSurfaceIssueSeverity): SarifLevel {
  return SEVERITY_TO_LEVEL[severity] ?? "warning";
}

function dedupeIssuesByMatchBasedId(issues: AnswerSurfaceIssue[]): AnswerSurfaceIssue[] {
  const seen = new Set<string>();
  const deduped: AnswerSurfaceIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.identity.matchBasedId)) {
      continue;
    }
    seen.add(issue.identity.matchBasedId);
    deduped.push(issue);
  }
  return deduped;
}

function buildRuleDescriptor(issue: AnswerSurfaceIssue): SarifReportingDescriptor {
  return {
    id: issue.code,
    name: issue.code,
    shortDescription: { text: issue.code },
    fullDescription: { text: issue.message },
    defaultConfiguration: { level: severityToLevel(issue.severity) },
    properties: {
      category: issue.category,
      patternHash: issue.identity.patternHash,
    },
  };
}

function toLocation(
  uri: string | undefined,
  line: number | undefined,
  message?: string,
): SarifLocation | null {
  if (!uri) return null;
  const physicalLocation: SarifPhysicalLocation = {
    artifactLocation: { uri },
    ...(typeof line === "number" && line > 0 ? { region: { startLine: line } } : {}),
  };
  return {
    physicalLocation,
    ...(message ? { message: { text: message } } : {}),
  };
}

function buildLocations(issue: AnswerSurfaceIssue): {
  locations: SarifLocation[];
  relatedLocations: SarifLocation[];
} {
  const locations: SarifLocation[] = [];
  const relatedLocations: SarifLocation[] = [];

  const primary = toLocation(issue.path, issue.line);
  if (primary) locations.push(primary);

  // Surface the producer/consumer pair as related locations when the primary
  // path doesn't already cover both sides. Avoids duplicate rendering.
  if (issue.producerPath && issue.producerPath !== issue.path) {
    const producer = toLocation(issue.producerPath, undefined, "producer");
    if (producer) relatedLocations.push(producer);
  }
  if (issue.consumerPath && issue.consumerPath !== issue.path) {
    const consumer = toLocation(issue.consumerPath, undefined, "consumer");
    if (consumer) relatedLocations.push(consumer);
  }

  // Promote evidence refs as related locations too so SARIF consumers can
  // jump straight to the supporting code. Refs use our `path:Lnn` format.
  for (const ref of issue.evidenceRefs) {
    const match = /^(.+?):L(\d+)$/.exec(ref);
    if (match) {
      const [, refPath, lineText] = match;
      const line = Number.parseInt(lineText, 10);
      const loc = toLocation(refPath, Number.isFinite(line) ? line : undefined, "evidence");
      if (loc) relatedLocations.push(loc);
    } else if (ref.trim().length > 0) {
      const loc = toLocation(ref, undefined, "evidence");
      if (loc) relatedLocations.push(loc);
    }
  }

  return { locations, relatedLocations };
}

function buildResult(
  issue: AnswerSurfaceIssue,
  ruleIndex: number,
  extraProperties: JsonObject | undefined,
): SarifResult {
  const { locations, relatedLocations } = buildLocations(issue);
  const result: SarifResult = {
    ruleId: issue.code,
    ruleIndex,
    level: severityToLevel(issue.severity),
    message: { text: issue.message },
    partialFingerprints: {
      matchBasedId: issue.identity.matchBasedId,
      codeHash: issue.identity.codeHash,
      patternHash: issue.identity.patternHash,
    },
    properties: {
      category: issue.category,
      confidence: issue.confidence,
      severity: issue.severity,
      evidenceRefs: issue.evidenceRefs,
      ...(issue.metadata ?? {}),
      ...(extraProperties ?? {}),
    },
  };
  if (locations.length > 0) result.locations = locations;
  if (relatedLocations.length > 0) result.relatedLocations = relatedLocations;
  return result;
}

/**
 * Render a flat list of `AnswerSurfaceIssue` values as a SARIF log. Used
 * when the caller has already materialized issues from any source (trust
 * reasons, alignment diagnostics, ranking, or a mix).
 */
export function formatSurfaceIssuesAsSarif(
  issues: AnswerSurfaceIssue[],
  options: FormatSurfaceSarifOptions = {},
): SarifLog {
  const dedupedIssues = dedupeIssuesByMatchBasedId(issues);

  // Dedupe rules by `code`; SARIF expects one descriptor per rule.
  const ruleIndexById = new Map<string, number>();
  const rules: SarifReportingDescriptor[] = [];
  for (const issue of dedupedIssues) {
    if (ruleIndexById.has(issue.code)) continue;
    ruleIndexById.set(issue.code, rules.length);
    rules.push(buildRuleDescriptor(issue));
  }

  const results: SarifResult[] = dedupedIssues.map((issue) => {
    const index = ruleIndexById.get(issue.code) ?? 0;
    return buildResult(issue, index, options.resultProperties);
  });

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA_URI,
    runs: [
      {
        tool: {
          driver: {
            name: options.toolName ?? DEFAULT_TOOL_NAME,
            informationUri: options.informationUri ?? DEFAULT_INFORMATION_URI,
            ...(options.toolVersion ? { version: options.toolVersion } : {}),
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
          },
        ],
        results,
      },
    ],
  };
}

/**
 * Render a mako `AnswerResult` as SARIF. Walks the canonical surfaces —
 * `trust.issues`, `diagnostics`, `ranking.reasons` — deduping by identity
 * so an issue that appears on multiple surfaces shows up once.
 *
 * Attaches trust state + query kind as result-level properties so SARIF
 * consumers that honor custom properties can filter on them.
 */
export function formatAnswerResultAsSarif(
  result: AnswerResult,
  options: FormatSurfaceSarifOptions = {},
): SarifLog {
  const issues: AnswerSurfaceIssue[] = [];
  const seenMatchIds = new Set<string>();
  const pushUnique = (issue: AnswerSurfaceIssue) => {
    if (seenMatchIds.has(issue.identity.matchBasedId)) return;
    seenMatchIds.add(issue.identity.matchBasedId);
    issues.push(issue);
  };

  for (const issue of result.trust?.issues ?? []) pushUnique(issue);
  for (const issue of result.diagnostics ?? []) pushUnique(issue);
  for (const issue of result.ranking?.reasons ?? []) pushUnique(issue);

  const resultProperties: JsonObject = {
    queryKind: result.queryKind,
    queryId: result.queryId,
    projectId: result.projectId,
    ...(result.trust
      ? {
          trustState: result.trust.state,
          trustScopeRelation: result.trust.scopeRelation,
        }
      : {}),
    ...(result.ranking
      ? {
          rankingOrderKey: result.ranking.orderKey,
          rankingDeEmphasized: result.ranking.deEmphasized,
        }
      : {}),
    ...(options.resultProperties ?? {}),
  };

  return formatSurfaceIssuesAsSarif(issues, {
    ...options,
    resultProperties,
  });
}
