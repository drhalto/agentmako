import type {
  ProjectFact,
  ReefOverlayDiffEntry,
  ReefOverlayDiffStatus,
  ReefOverlayDiffToolInput,
  ReefOverlayDiffToolOutput,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { filePathFromFact } from "./shared.js";

const FACT_QUERY_LIMIT = 5_000;

export async function reefOverlayDiffTool(
  input: ReefOverlayDiffToolInput,
  options: ToolServiceOptions,
): Promise<ReefOverlayDiffToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const leftOverlay = input.leftOverlay ?? "indexed";
    const rightOverlay = input.rightOverlay ?? "working_tree";
    const outputLimit = input.limit ?? 100;
    const filePath = input.filePath
      ? normalizeFileQuery(project.canonicalPath, input.filePath)
      : undefined;
    const warnings: string[] = [];

    const leftFacts = projectStore.queryReefFacts({
      projectId: project.projectId,
      overlay: leftOverlay,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.source ? { source: input.source } : {}),
      limit: FACT_QUERY_LIMIT,
    }).filter((fact) => !filePath || filePathFromFact(fact) === filePath);
    const rightFacts = projectStore.queryReefFacts({
      projectId: project.projectId,
      overlay: rightOverlay,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.source ? { source: input.source } : {}),
      limit: FACT_QUERY_LIMIT,
    }).filter((fact) => !filePath || filePathFromFact(fact) === filePath);

    if (leftFacts.length >= FACT_QUERY_LIMIT || rightFacts.length >= FACT_QUERY_LIMIT) {
      warnings.push(`overlay diff compared the first ${FACT_QUERY_LIMIT} facts per side; narrow by filePath, kind, or source for exhaustive results`);
    }

    const leftByKey = latestFactByKey(leftFacts);
    const rightByKey = latestFactByKey(rightFacts);
    const keys = new Set([...leftByKey.keys(), ...rightByKey.keys()]);
    const allEntries = [...keys].map((key) => {
      const leftFact = leftByKey.get(key);
      const rightFact = rightByKey.get(key);
      return diffEntry({
        key,
        leftOverlay,
        rightOverlay,
        leftFact,
        rightFact,
        includeFacts: input.includeFacts ?? false,
      });
    }).sort(compareDiffEntries);
    const filteredEntries = input.includeEqual
      ? allEntries
      : allEntries.filter((entry) => entry.status !== "same");
    const entries = filteredEntries.slice(0, outputLimit);
    const counts = countStatuses(allEntries);

    return {
      toolName: "reef_overlay_diff",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      leftOverlay,
      rightOverlay,
      entries,
      summary: {
        comparedKeys: allEntries.length,
        same: counts.same,
        changed: counts.changed,
        onlyLeft: counts.only_left,
        onlyRight: counts.only_right,
        returnedEntries: entries.length,
        truncated: filteredEntries.length > entries.length,
      },
      warnings,
    };
  });
}

function latestFactByKey(facts: readonly ProjectFact[]): Map<string, ProjectFact> {
  const byKey = new Map<string, ProjectFact>();
  for (const fact of facts) {
    const key = factKey(fact);
    const existing = byKey.get(key);
    if (!existing || Date.parse(fact.provenance.capturedAt) > Date.parse(existing.provenance.capturedAt)) {
      byKey.set(key, fact);
    }
  }
  return byKey;
}

function factKey(fact: ProjectFact): string {
  return `${fact.kind}\u0000${fact.subjectFingerprint}`;
}

function diffEntry(args: {
  key: string;
  leftOverlay: ProjectFact["overlay"];
  rightOverlay: ProjectFact["overlay"];
  leftFact?: ProjectFact;
  rightFact?: ProjectFact;
  includeFacts: boolean;
}): ReefOverlayDiffEntry {
  const leftFact = args.leftFact;
  const rightFact = args.rightFact;
  const representative = leftFact ?? rightFact;
  if (!representative) {
    throw new Error("overlay diff entry requires at least one fact");
  }

  const status = diffStatus(leftFact, rightFact);
  return {
    key: args.key,
    kind: representative.kind,
    subjectFingerprint: representative.subjectFingerprint,
    ...(filePathFromFact(representative) ? { filePath: filePathFromFact(representative) } : {}),
    leftOverlay: args.leftOverlay,
    rightOverlay: args.rightOverlay,
    status,
    ...(leftFact ? { leftSource: leftFact.source } : {}),
    ...(rightFact ? { rightSource: rightFact.source } : {}),
    ...(args.includeFacts && leftFact ? { leftFact } : {}),
    ...(args.includeFacts && rightFact ? { rightFact } : {}),
    changedDataKeys: status === "changed" && leftFact && rightFact
      ? changedKeys(leftFact, rightFact)
      : [],
  };
}

function diffStatus(leftFact: ProjectFact | undefined, rightFact: ProjectFact | undefined): ReefOverlayDiffStatus {
  if (!leftFact) return "only_right";
  if (!rightFact) return "only_left";
  return stableJson(comparableFact(leftFact)) === stableJson(comparableFact(rightFact))
    ? "same"
    : "changed";
}

function comparableFact(fact: ProjectFact): unknown {
  return {
    confidence: fact.confidence,
    data: fact.data ?? {},
    freshness: fact.freshness,
  };
}

function changedKeys(leftFact: ProjectFact, rightFact: ProjectFact): string[] {
  const keys = new Set<string>();
  if (leftFact.confidence !== rightFact.confidence) keys.add("confidence");
  if (stableJson(leftFact.freshness) !== stableJson(rightFact.freshness)) keys.add("freshness");
  const leftData = leftFact.data ?? {};
  const rightData = rightFact.data ?? {};
  for (const key of new Set([...Object.keys(leftData), ...Object.keys(rightData)])) {
    if (stableJson(leftData[key]) !== stableJson(rightData[key])) {
      keys.add(`data.${key}`);
    }
  }
  return [...keys].sort();
}

function countStatuses(entries: readonly ReefOverlayDiffEntry[]): Record<ReefOverlayDiffStatus, number> {
  const counts: Record<ReefOverlayDiffStatus, number> = {
    same: 0,
    changed: 0,
    only_left: 0,
    only_right: 0,
  };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

function compareDiffEntries(a: ReefOverlayDiffEntry, b: ReefOverlayDiffEntry): number {
  const statusWeight: Record<ReefOverlayDiffStatus, number> = {
    changed: 0,
    only_right: 1,
    only_left: 2,
    same: 3,
  };
  return statusWeight[a.status] - statusWeight[b.status]
    || a.kind.localeCompare(b.kind)
    || (a.filePath ?? "").localeCompare(b.filePath ?? "")
    || a.subjectFingerprint.localeCompare(b.subjectFingerprint);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
