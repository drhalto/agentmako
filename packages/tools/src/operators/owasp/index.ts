import type {
  OwaspAuditResult,
  OwaspAuditToolInput,
  OwaspAuditToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../../runtime.js";
import { buildOwaspAuditResult } from "./result.js";

const DEFAULT_RESULT_SECTION_LIMIT = 100;

export async function owaspAuditTool(
  input: OwaspAuditToolInput,
  options: ToolServiceOptions = {},
): Promise<OwaspAuditToolOutput> {
  return withProjectContext(input, options, async ({ project, profile, projectStore }) => {
    const result = truncateOwaspAuditResult(
      await buildOwaspAuditResult({
        projectRoot: project.canonicalPath,
        profile,
        projectStore,
        categories: input.categories,
        maxFiles: input.maxFiles,
        freshen: input.freshen,
        progressReporter: options.progressReporter,
      }),
      input,
    );
    return {
      toolName: "owasp_audit",
      projectId: project.projectId,
      result,
    };
  });
}

function truncateOwaspAuditResult(
  result: OwaspAuditResult,
  input: OwaspAuditToolInput,
): OwaspAuditResult {
  if (input.includeFullResults) {
    return result;
  }

  const limit = input.maxPerSection ?? DEFAULT_RESULT_SECTION_LIMIT;
  if (result.findings.length <= limit) {
    return result;
  }

  const findings = result.findings.slice(0, limit);
  const warnings = [
    ...result.warnings,
    `findings truncated to ${limit} of ${result.findings.length}; set includeFullResults for the full payload.`,
  ];
  return { ...result, findings, warnings };
}
