import type { ProjectConvention, ProjectConventionsToolInput, ProjectConventionsToolOutput } from "@mako-ai/contracts";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  addConvention,
  conventionStatus,
  filePathFromFact,
  inferConventionKind,
  ruleSearchText,
  stringDataValue,
} from "./shared.js";

export async function projectConventionsTool(
  input: ProjectConventionsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectConventionsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const conventions = new Map<string, ProjectConvention>();
    for (const fact of projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })) {
      const kind = stringDataValue(fact.data, "conventionKind") ?? (fact.kind.startsWith("convention:") ? fact.kind.slice("convention:".length) : undefined);
      if (!kind) continue;
      addConvention(conventions, {
        id: `fact:${fact.fingerprint}`,
        kind,
        title: stringDataValue(fact.data, "title") ?? `${kind} convention`,
        status: conventionStatus(fact.data),
        source: fact.source,
        confidence: fact.confidence,
        whyIncluded: stringDataValue(fact.data, "reason") ?? `Reef fact ${fact.kind} declares a convention`,
        ...(filePathFromFact(fact) ? { filePath: filePathFromFact(fact) } : {}),
        evidence: [fact.fingerprint],
        metadata: { subjectFingerprint: fact.subjectFingerprint },
      });
    }

    for (const rule of projectStore.listReefRuleDescriptors()) {
      const kind = inferConventionKind(ruleSearchText(rule));
      if (!kind) continue;
      addConvention(conventions, {
        id: `rule:${rule.source}:${rule.id}`,
        kind,
        title: `${rule.title} rule convention`,
        status: "candidate",
        source: rule.source,
        confidence: rule.enabledByDefault ? 0.65 : 0.45,
        whyIncluded: `rule descriptor tags/title imply ${kind}`,
        evidence: [rule.id],
        metadata: { sourceNamespace: rule.sourceNamespace, severity: rule.severity },
      });
    }

    const filtered = [...conventions.values()]
      .filter((convention) => !input.kind || convention.kind === input.kind)
      .filter((convention) => !input.status || convention.status === input.status)
      .sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind))
      .slice(0, input.limit ?? 100);

    return {
      toolName: "project_conventions",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      conventions: filtered,
      totalReturned: filtered.length,
      warnings: filtered.length === 0 ? ["no Reef convention facts or rule-derived convention candidates matched"] : [],
    };
  });
}
