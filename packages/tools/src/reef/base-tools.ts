import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type {
  FileFactsToolInput,
  FileFactsToolOutput,
  FileFindingsToolInput,
  FileFindingsToolOutput,
  ListReefRulesToolInput,
  ListReefRulesToolOutput,
  ProjectDiagnosticRunsToolInput,
  ProjectDiagnosticRunsToolOutput,
  ProjectFactsToolInput,
  ProjectFactsToolOutput,
  ProjectFindingsToolInput,
  ProjectFindingsToolOutput,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { factFilters, findingFilters } from "./filters.js";
import { diagnosticRunCache } from "./shared.js";

export async function projectFindingsTool(
  input: ProjectFindingsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectFindingsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const filters = findingFilters(input);
    const findings = projectStore.queryReefFindings({
      projectId: project.projectId,
      ...filters,
      limit: input.limit ?? 100,
    });

    return {
      toolName: "project_findings",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      findings,
      totalReturned: findings.length,
      filters,
      warnings: [],
    };
  });
}

export async function fileFindingsTool(
  input: FileFindingsToolInput,
  options: ToolServiceOptions,
): Promise<FileFindingsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const filters = findingFilters(input);
    const filePath = normalizeFileQuery(project.canonicalPath, input.filePath);
    const findings = projectStore.queryReefFindings({
      projectId: project.projectId,
      filePath,
      ...filters,
      limit: input.limit ?? 100,
    });

    return {
      toolName: "file_findings",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      filePath,
      findings,
      totalReturned: findings.length,
      filters,
      warnings: [],
    };
  });
}

export async function projectFactsTool(
  input: ProjectFactsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectFactsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const filters = factFilters(input);
    const facts = projectStore.queryReefFacts({
      projectId: project.projectId,
      ...filters,
      limit: input.limit ?? 100,
    });

    return {
      toolName: "project_facts",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      facts,
      totalReturned: facts.length,
      filters,
      warnings: [],
    };
  });
}

export async function fileFactsTool(
  input: FileFactsToolInput,
  options: ToolServiceOptions,
): Promise<FileFactsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const filePath = normalizeFileQuery(project.canonicalPath, input.filePath);
    const subjectFingerprint = projectStore.computeReefSubjectFingerprint({ kind: "file", path: filePath });
    const filters = factFilters(input);
    const facts = projectStore.queryReefFacts({
      projectId: project.projectId,
      ...filters,
      subjectFingerprint,
      limit: input.limit ?? 100,
    });

    return {
      toolName: "file_facts",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      filePath,
      facts,
      totalReturned: facts.length,
      filters,
      warnings: [],
    };
  });
}

export async function listReefRulesTool(
  input: ListReefRulesToolInput,
  options: ToolServiceOptions,
): Promise<ListReefRulesToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const enabledOnly = input.enabledOnly ?? false;
    const rules = projectStore
      .listReefRuleDescriptors()
      .filter((rule) => !input.sourceNamespace || rule.sourceNamespace === input.sourceNamespace)
      .filter((rule) => !enabledOnly || rule.enabledByDefault)
      .slice(0, input.limit ?? 100);

    return {
      toolName: "list_reef_rules",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      rules,
      totalReturned: rules.length,
      filters: {
        ...(input.sourceNamespace ? { sourceNamespace: input.sourceNamespace } : {}),
        enabledOnly,
      },
      warnings: [],
    };
  });
}

export async function projectDiagnosticRunsTool(
  input: ProjectDiagnosticRunsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectDiagnosticRunsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const cacheStalenessMs = input.cacheStalenessMs ?? REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS;
    const checkedAtMs = Date.now();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const runs = projectStore.queryReefDiagnosticRuns({
      projectId: project.projectId,
      ...(input.source ? { source: input.source } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit ?? 100,
    }).map((run) => ({
      ...run,
      cache: diagnosticRunCache(run, {
        checkedAt,
        checkedAtMs,
        staleAfterMs: cacheStalenessMs,
      }),
    }));

    return {
      toolName: "project_diagnostic_runs",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      runs,
      totalReturned: runs.length,
      filters: {
        ...(input.source ? { source: input.source } : {}),
        ...(input.status ? { status: input.status } : {}),
        cacheStalenessMs,
      },
      warnings: [],
    };
  });
}
