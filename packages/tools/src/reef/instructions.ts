import path from "node:path";
import type {
  ContextPacketReadableCandidate,
  ProjectFact,
  ReefInstructionsToolInput,
  ReefInstructionsToolOutput,
} from "@mako-ai/contracts";
import { hashText } from "@mako-ai/store";
import { loadScopedInstructions } from "../context-packet/scoped-instructions.js";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";

export async function reefInstructionsTool(
  input: ReefInstructionsToolInput,
  options: ToolServiceOptions,
): Promise<ReefInstructionsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const warnings: string[] = [];
    const files = normalizeInstructionFiles({
      projectRoot: project.canonicalPath,
      files: input.files,
      warnings,
    });
    const candidates = files.map((filePath): ContextPacketReadableCandidate => ({
      id: `reef_instruction:${filePath}`,
      kind: "file",
      path: filePath,
      source: "file_provider",
      strategy: "exact_match",
      whyIncluded: "Instruction scope lookup target.",
      confidence: 1,
      score: 1,
    }));
    const instructions = loadScopedInstructions({
      projectRoot: project.canonicalPath,
      candidates,
    });
    const checkedAt = new Date().toISOString();
    const includeDerivedFacts = input.includeDerivedFacts ?? true;
    const derivedFacts = includeDerivedFacts
      ? instructions.map((instruction): ProjectFact => {
          const subject = { kind: "file" as const, path: instruction.path };
          const subjectFingerprint = projectStore.computeReefSubjectFingerprint(subject);
          const source = "reef_instructions";
          const kind = "project_instruction";
          const data = {
            appliesTo: instruction.appliesTo,
            precedence: instruction.precedence,
            reason: instruction.reason,
            excerpt: instruction.excerpt,
            excerptSha256: hashText(instruction.excerpt),
          };
          return {
            projectId: project.projectId,
            kind,
            subject,
            subjectFingerprint,
            overlay: "working_tree",
            source,
            confidence: 1,
            fingerprint: projectStore.computeReefFactFingerprint({
              projectId: project.projectId,
              kind,
              subjectFingerprint,
              overlay: "working_tree",
              source,
              data,
            }),
            freshness: {
              state: "fresh",
              checkedAt,
              reason: "scoped instruction file read from working tree",
            },
            provenance: {
              source,
              capturedAt: checkedAt,
              dependencies: [{ kind: "file", path: instruction.path }],
              metadata: {
                derivedOnly: true,
              },
            },
            data,
          };
        })
      : [];

    return {
      toolName: "reef_instructions",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      files,
      instructions,
      derivedFacts,
      summary: {
        instructionCount: instructions.length,
        derivedFactCount: derivedFacts.length,
      },
      warnings,
    };
  });
}

function normalizeInstructionFiles(args: {
  projectRoot: string;
  files: readonly string[] | undefined;
  warnings: string[];
}): string[] {
  const requested = args.files && args.files.length > 0 ? args.files : ["AGENTS.md"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const filePath of requested) {
    const normalized = normalizeFileQuery(args.projectRoot, filePath).replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      normalized === ""
      || normalized === "."
      || normalized.startsWith("../")
      || path.isAbsolute(normalized)
    ) {
      args.warnings.push(`skipped instruction scope outside project root: ${filePath}`);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  if (out.length === 0) {
    out.push("AGENTS.md");
  }
  return out;
}
