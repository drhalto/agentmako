import type {
  EvidenceConfidenceItem,
  EvidenceConfidenceToolInput,
  EvidenceConfidenceToolOutput,
  EvidenceConflict,
  EvidenceConflictsToolInput,
  EvidenceConflictsToolOutput,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  confidenceFromFinding,
  confidenceLabelForFact,
  confidenceLabelForFinding,
  confidenceLabelWeight,
  confidenceReason,
  filePathFromFact,
  findingSignalsConflict,
  matchesFactScope,
  matchesFindingScope,
  severityWeight,
  stringDataValue,
  summarizeConfidenceLabels,
} from "./shared.js";
import { buildReefToolExecution } from "./tool-execution.js";

export async function evidenceConfidenceTool(
  input: EvidenceConfidenceToolInput,
  options: ToolServiceOptions,
): Promise<EvidenceConfidenceToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const limit = input.limit ?? 100;
    const filePath = input.filePath ? normalizeFileQuery(project.canonicalPath, input.filePath) : undefined;
    const subjectFingerprint = input.subjectFingerprint;
    const items: EvidenceConfidenceItem[] = [];
    for (const fact of projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })) {
      if (!matchesFactScope(fact, { filePath, subjectFingerprint })) continue;
      const label = confidenceLabelForFact(fact);
      items.push({
        id: `fact:${fact.fingerprint}`,
        kind: "fact",
        ...(filePathFromFact(fact) ? { filePath: filePathFromFact(fact) } : {}),
        subjectFingerprint: fact.subjectFingerprint,
        source: fact.source,
        overlay: fact.overlay,
        confidence: fact.confidence,
        confidenceLabel: label,
        freshness: fact.freshness,
        reason: confidenceReason(label, fact.freshness.reason),
        fact,
      });
    }
    for (const finding of projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: true,
      limit: 500,
    })) {
      if (!matchesFindingScope(finding, { filePath, subjectFingerprint })) continue;
      const label = confidenceLabelForFinding(finding);
      items.push({
        id: `finding:${finding.fingerprint}`,
        kind: "finding",
        ...(finding.filePath ? { filePath: finding.filePath } : {}),
        subjectFingerprint: finding.subjectFingerprint,
        source: finding.source,
        overlay: finding.overlay,
        confidence: confidenceFromFinding(finding),
        confidenceLabel: label,
        freshness: finding.freshness,
        reason: confidenceReason(label, finding.freshness.reason),
        finding,
      });
    }
    const sorted = items
      .sort((a, b) => confidenceLabelWeight(b.confidenceLabel) - confidenceLabelWeight(a.confidenceLabel) || b.confidence - a.confidence)
      .slice(0, limit);
    const reefExecution = await buildReefToolExecution({
      toolName: "evidence_confidence",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled: sorted.filter((item) => item.freshness.state !== "fresh").length,
      returnedCount: sorted.length,
    });

    return {
      toolName: "evidence_confidence",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      items: sorted,
      summary: summarizeConfidenceLabels(sorted),
      reefExecution,
      warnings: sorted.length === 0 ? ["no Reef evidence matched the requested scope"] : [],
    };
  });
}

export async function evidenceConflictsTool(
  input: EvidenceConflictsToolInput,
  options: ToolServiceOptions,
): Promise<EvidenceConflictsToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const limit = input.limit ?? 100;
    const filePath = input.filePath ? normalizeFileQuery(project.canonicalPath, input.filePath) : undefined;
    const subjectFingerprint = input.subjectFingerprint;
    const conflicts = new Map<string, EvidenceConflict>();
    const facts = projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })
      .filter((fact) => matchesFactScope(fact, { filePath, subjectFingerprint }));
    const findings = projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: true,
      limit: 500,
    }).filter((finding) => matchesFindingScope(finding, { filePath, subjectFingerprint }));

    for (const fact of facts) {
      const explicitKind = stringDataValue(fact.data, "conflictKind") ?? (fact.kind.includes("conflict") ? fact.kind : undefined);
      const staleIndexed = fact.overlay === "indexed" && fact.freshness.state === "stale";
      if (!explicitKind && !staleIndexed) continue;
      const status = stringDataValue(fact.data, "status") === "resolved" ? "resolved" : "open";
      if (status === "resolved" && !input.includeResolved) continue;
      const conflictKind = explicitKind ?? "stale_indexed_evidence";
      conflicts.set(`fact:${fact.fingerprint}`, {
        conflictId: `fact:${fact.fingerprint}`,
        conflictKind,
        status,
        severity: staleIndexed ? "warning" : "error",
        title: staleIndexed ? `${fact.kind} is stale indexed evidence` : `${conflictKind} conflict`,
        ...(filePathFromFact(fact) ? { filePath: filePathFromFact(fact) } : {}),
        subjectFingerprint: fact.subjectFingerprint,
        sources: [fact.source],
        facts: [fact],
        findings: [],
        reason: staleIndexed ? fact.freshness.reason : (stringDataValue(fact.data, "reason") ?? "Reef fact declares an evidence conflict"),
        suggestedActions: ["Cross-check with live_text_search or working_tree_overlay, then refresh the stale source."],
      });
    }

    for (const finding of findings) {
      if (!findingSignalsConflict(finding)) continue;
      const status = finding.status === "resolved" || finding.status === "suppressed" ? "resolved" : "open";
      if (status === "resolved" && !input.includeResolved) continue;
      conflicts.set(`finding:${finding.fingerprint}`, {
        conflictId: `finding:${finding.fingerprint}`,
        conflictKind: finding.ruleId ?? "finding_conflict",
        status,
        severity: finding.severity,
        title: finding.message,
        ...(finding.filePath ? { filePath: finding.filePath } : {}),
        subjectFingerprint: finding.subjectFingerprint,
        sources: [finding.source],
        facts: facts.filter((fact) => finding.factFingerprints.includes(fact.fingerprint)),
        findings: [finding],
        reason: "Reef finding source/message signals incorrect or contradictory evidence",
        suggestedActions: ["Inspect the linked facts and rerun the producing source before acting on this evidence."],
      });
    }

    const sorted = [...conflicts.values()]
      .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.conflictId.localeCompare(b.conflictId))
      .slice(0, limit);
    const reefExecution = await buildReefToolExecution({
      toolName: "evidence_conflicts",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled: sorted.filter((conflict) =>
        conflict.facts.some((fact) => fact.freshness.state !== "fresh")
        || conflict.findings.some((finding) => finding.freshness.state !== "fresh")
      ).length,
      returnedCount: sorted.length,
    });

    return {
      toolName: "evidence_conflicts",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      conflicts: sorted,
      totalReturned: sorted.length,
      reefExecution,
      warnings: sorted.length === 0 ? ["no Reef evidence conflicts matched the requested scope"] : [],
    };
  });
}
