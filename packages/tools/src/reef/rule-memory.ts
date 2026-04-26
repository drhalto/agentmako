import type { ReefRuleDescriptor, RuleMemoryEntry, RuleMemoryToolInput, RuleMemoryToolOutput } from "@mako-ai/contracts";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  emptyRuleMemoryEntry,
  namespaceFromSource,
  newerTimestamp,
  ruleMemoryKey,
  ruleMemorySuggestedActions,
} from "./shared.js";

export async function ruleMemoryTool(
  input: RuleMemoryToolInput,
  options: ToolServiceOptions,
): Promise<RuleMemoryToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const rules = projectStore.listReefRuleDescriptors()
      .filter((rule) => !input.sourceNamespace || rule.sourceNamespace === input.sourceNamespace);
    const rulesByKey = new Map(rules.map((rule) => [ruleMemoryKey(rule.source, rule.id), rule]));
    const entries = new Map<string, RuleMemoryEntry>();
    for (const rule of rules) {
      entries.set(ruleMemoryKey(rule.source, rule.id), emptyRuleMemoryEntry(rule));
    }

    for (const finding of projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: true,
      limit: 1000,
    })) {
      const ruleId = finding.ruleId ?? finding.source;
      const key = ruleMemoryKey(finding.source, ruleId);
      const rule = rulesByKey.get(key);
      if (input.sourceNamespace && rule?.sourceNamespace !== input.sourceNamespace) continue;
      const entry = entries.get(key) ?? emptyRuleMemoryEntry({
        id: ruleId,
        version: "unknown",
        source: finding.source,
        sourceNamespace: namespaceFromSource(finding.source),
        type: "problem",
        severity: finding.severity,
        title: ruleId,
        description: finding.message,
        factKinds: [],
        enabledByDefault: true,
      });
      entry.counts.total += 1;
      entry.counts[finding.status] += 1;
      entry.lastSeenAt = newerTimestamp(entry.lastSeenAt, finding.capturedAt);
      entries.set(key, entry);
    }

    const sorted = [...entries.values()]
      .map((entry) => ({
        ...entry,
        suggestedActions: ruleMemorySuggestedActions(entry),
      }))
      .sort((a, b) => b.counts.active - a.counts.active || b.counts.total - a.counts.total || a.ruleId.localeCompare(b.ruleId))
      .slice(0, input.limit ?? 100);

    return {
      toolName: "rule_memory",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      entries: sorted,
      totalReturned: sorted.length,
      warnings: [],
    };
  });
}
