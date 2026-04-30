import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type {
  AnswerSurfaceIssueSeverity,
  ReefRuleDescriptor,
  RulePackValidateToolInput,
  RulePackValidateToolOutput,
  RulePackValidationPack,
  RulePackValidationRule,
} from "@mako-ai/contracts";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { compileRulePacks, loadRulePackFromFile } from "./loader.js";
import { RulePackLoadError, type CompiledRule } from "./types.js";

const RULE_PACK_EXTENSIONS = new Set([".yaml", ".yml"]);

export async function rulePackValidateTool(
  input: RulePackValidateToolInput,
  options: ToolServiceOptions,
): Promise<RulePackValidateToolOutput> {
  return await withProjectContext(input, options, ({ project }) => {
    const warnings: string[] = [];
    const files = discoverRulePackFiles(project.canonicalPath);
    if (files.length === 0) {
      warnings.push("no .mako/rules YAML rule packs found");
    }

    const includeDescriptors = input.includeDescriptors ?? true;
    const packs: RulePackValidationPack[] = [];
    const rules: RulePackValidationRule[] = [];

    for (const filePath of files) {
      const relativePath = toProjectRelativePath(project.canonicalPath, filePath);
      try {
        const loaded = loadRulePackFromFile(filePath);
        const compiled = compileRulePacks([loaded]);
        packs.push({
          path: relativePath,
          ...(loaded.pack.name ? { name: loaded.pack.name } : {}),
          valid: true,
          ruleCount: compiled.length,
        });
        for (const rule of compiled) {
          rules.push(ruleValidationRecord({
            rule,
            relativePath,
            includeDescriptor: includeDescriptors,
          }));
        }
      } catch (error) {
        packs.push({
          path: relativePath,
          valid: false,
          ruleCount: 0,
          errorText: error instanceof RulePackLoadError || error instanceof Error
            ? error.message
            : String(error),
        });
      }
    }

    const invalidPackCount = packs.filter((pack) => !pack.valid).length;
    return {
      toolName: "rule_pack_validate",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      packs,
      rules,
      summary: {
        packCount: packs.length,
        validPackCount: packs.length - invalidPackCount,
        invalidPackCount,
        ruleCount: rules.length,
      },
      warnings,
    };
  });
}

function ruleValidationRecord(args: {
  rule: CompiledRule;
  relativePath: string;
  includeDescriptor: boolean;
}): RulePackValidationRule {
  return {
    id: args.rule.id,
    sourcePath: args.relativePath,
    category: args.rule.category,
    severity: args.rule.severity,
    confidence: args.rule.confidence,
    ...(args.rule.languages ? { languages: args.rule.languages } : {}),
    patternCount: args.rule.patterns.length,
    message: args.rule.message,
    ...(args.rule.canonicalHelper
      ? {
          crossFile: {
            kind: "canonical_helper",
            symbol: args.rule.canonicalHelper.symbol,
            ...(args.rule.canonicalHelper.path ? { path: args.rule.canonicalHelper.path } : {}),
            mode: args.rule.canonicalHelper.mode ?? "absent_in_consumer",
          } as const,
        }
      : {}),
    ...(args.includeDescriptor ? { descriptor: descriptorForRule(args.rule) } : {}),
  };
}

function descriptorForRule(rule: CompiledRule): ReefRuleDescriptor {
  return {
    id: rule.id,
    version: "1.0.0",
    source: `rule_pack:${rule.id}`,
    sourceNamespace: "rule_pack",
    type: "problem",
    severity: reefSeverity(rule.severity),
    title: rule.id,
    description: rule.message,
    factKinds: ["rule_pack_match"],
    dependsOnFactKinds: [
      "file_snapshot",
      ...(rule.canonicalHelper ? ["symbol_reference"] : []),
    ],
    tags: [
      rule.category,
      ...(rule.languages ?? []),
      ...(rule.canonicalHelper ? ["cross_file", "canonical_helper"] : []),
    ],
    enabledByDefault: true,
  };
}

function reefSeverity(severity: AnswerSurfaceIssueSeverity): ReefRuleDescriptor["severity"] {
  switch (severity) {
    case "critical":
      return "error";
    case "high":
    case "medium":
      return "warning";
    case "low":
      return "info";
  }
}

function discoverRulePackFiles(projectRoot: string): string[] {
  const rulesDir = path.join(projectRoot, ".mako", "rules");
  if (!existsSync(rulesDir)) return [];
  return walkYamlFiles(rulesDir).filter((filePath) => isWithinRoot(projectRoot, filePath));
}

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      out.push(...walkYamlFiles(full));
      continue;
    }
    if (!stats.isFile()) continue;
    const extension = path.extname(entry).toLowerCase();
    if (RULE_PACK_EXTENSIONS.has(extension)) {
      out.push(full);
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function isWithinRoot(projectRoot: string, filePath: string): boolean {
  const relativePath = path.relative(projectRoot, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toProjectRelativePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}
