import type { MakoApiService } from "@mako-ai/api";
import type { GitPrecommitCheckToolOutput } from "@mako-ai/contracts";
import {
  COLORS,
  color,
  printJson,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

interface ParsedPrecommitArgs {
  projectReference: string;
  publicRouteGlobs: string[];
  authGuardSymbols: string[];
  serverOnlyModules: string[];
}

function requireOptionValue(rawArgs: string[], index: number, option: string): string {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parsePrecommitArgs(rawArgs: string[]): ParsedPrecommitArgs {
  const parsed: ParsedPrecommitArgs = {
    projectReference: process.cwd(),
    publicRouteGlobs: [],
    authGuardSymbols: [],
    serverOnlyModules: [],
  };
  let projectReferenceSet = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--public-route") {
      parsed.publicRouteGlobs.push(requireOptionValue(rawArgs, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--auth-guard") {
      parsed.authGuardSymbols.push(requireOptionValue(rawArgs, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--server-only") {
      parsed.serverOnlyModules.push(requireOptionValue(rawArgs, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown git precommit option: ${arg}`);
    }
    if (projectReferenceSet) {
      throw new Error("Usage: agentmako git precommit [project] [--public-route glob] [--auth-guard name] [--server-only path]");
    }
    parsed.projectReference = arg;
    projectReferenceSet = true;
  }

  return parsed;
}

export async function runGitCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const subcommand = rawArgs[0];
  if (subcommand !== "precommit" && subcommand !== "pre-commit") {
    throw new Error("Usage: agentmako git precommit [project] [--public-route glob] [--auth-guard name] [--server-only path]");
  }

  const parsed = parsePrecommitArgs(rawArgs.slice(1));
  const result = await api.callTool("git_precommit_check", {
    projectRef: parsed.projectReference,
    publicRouteGlobs: parsed.publicRouteGlobs,
    authGuardSymbols: parsed.authGuardSymbols,
    serverOnlyModules: parsed.serverOnlyModules,
  }) as GitPrecommitCheckToolOutput;

  if (shouldUseInteractive(cliOptions)) {
    const statusColor = result.continue ? COLORS.green : COLORS.red;
    const statusText = result.continue ? "Pre-commit check passed" : "Pre-commit check failed";
    console.log(`${color(result.continue ? "✓" : "✗", statusColor)} ${color(statusText, statusColor)}`);
    console.log(`  ${color("Staged:", COLORS.gray)} ${result.stagedFiles.length}`);
    console.log(`  ${color("Checked:", COLORS.gray)} ${result.checkedFiles.length}`);
    if (result.findings.length > 0) {
      console.log();
      console.log(result.stopReason);
    }
    if (result.warnings.length > 0) {
      console.log();
      for (const warning of result.warnings) {
        console.log(color(`Warning: ${warning}`, COLORS.yellow));
      }
    }
  } else {
    printJson(result);
  }

  if (!result.continue) {
    process.exitCode = 1;
  }
}
