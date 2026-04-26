import { randomUUID } from "node:crypto";
import type { ProjectFact, ProjectFinding, ProjectOverlay, ReefRuleDescriptor } from "../../../packages/contracts/src/index.ts";
import { openProjectStore, type ProjectStore } from "../../../packages/store/src/index.ts";

export interface SeedReefProjectInput {
  projectRoot: string;
  facts?: ProjectFact[];
  findings?: ProjectFinding[];
  rules?: ReefRuleDescriptor[];
  overlay?: ProjectOverlay;
  stateDirName?: string;
}

export interface SeededReefProject {
  projectId: string;
  store: ProjectStore;
  cleanup(): Promise<void>;
}

export async function seedReefProject(
  input: SeedReefProjectInput,
): Promise<SeededReefProject> {
  const projectId = `reef_fixture_${randomUUID()}`;
  const overlay = input.overlay ?? "working_tree";
  const store = openProjectStore({
    projectRoot: input.projectRoot,
    stateDirName: input.stateDirName,
  });

  const facts = (input.facts ?? []).map((fact) => ({ ...fact, projectId, overlay }));
  if (facts.length > 0) {
    store.upsertReefFacts(facts);
  }

  const findings = (input.findings ?? []).map((finding) => ({ ...finding, projectId, overlay }));
  if (findings.length > 0) {
    for (const [source, group] of groupBy(findings, (finding) => finding.source)) {
      store.replaceReefFindingsForSource({
        projectId,
        source,
        overlay,
        findings: group,
      });
    }
  }

  if (input.rules && input.rules.length > 0) {
    store.saveReefRuleDescriptors(input.rules);
  }

  return {
    projectId,
    store,
    cleanup: async () => {
      store.close();
    },
  };
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}
