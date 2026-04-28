// NOTE: the shebang for the bundled CLI is injected by tsup's `banner.js`
// (see `apps/cli/tsup.config.ts`). It is intentionally not present here so
// the banner can also inject a `createRequire` shim for bundled CJS deps
// (yaml, etc.) that call `require(...)` at runtime.

// Default the mako logger to `warn` before any service module is imported, so the
// interactive connect flow stays clean. Callers who want info/debug can still set
// MAKO_LOG_LEVEL explicitly — `??=` means we only fill the default if it's unset.
process.env.MAKO_LOG_LEVEL ??= "warn";

// Node and some dependencies (pg, node:sqlite) print warnings that race with
// interactive prompts and corrupt the terminal state. Intercept the process-level
// `warning` event and drop the noisy ones here; everything else still propagates to
// Node's default handler.
{
  const originalEmit = process.emit.bind(process) as typeof process.emit;
  process.emit = function (event: string | symbol, ...args: unknown[]): boolean {
    if (event === "warning") {
      const warning = args[0] as { name?: string; message?: string } | undefined;
      if (warning) {
        if (
          warning.name === "ExperimentalWarning" &&
          typeof warning.message === "string" &&
          /sqlite/i.test(warning.message)
        ) {
          return false;
        }
        if (warning.name === "DeprecationWarning") {
          return false;
        }
      }
    }
    return originalEmit(event as never, ...(args as never[]));
  } as typeof process.emit;
}

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createApiService } from "@mako-ai/api";
import { runConnectCommand } from "./commands/connect.js";
import { runDefaultCommand } from "./commands/default.js";
import {
  runProjectDbBindCommand,
  runProjectDbRefreshCommand,
  runProjectDbTestCommand,
  runProjectDbUnbindCommand,
  runProjectDbVerifyCommand,
} from "./commands/project-db.js";
import {
  runProjectAttachCommand,
  runProjectDetachCommand,
  runProjectIndexCommand,
  runProjectListCommand,
  runProjectStatusCommand,
} from "./commands/project.js";
import { runTopLevelRefresh, runTopLevelStatus, runTopLevelVerify } from "./commands/status.js";
import { runDashboardCommand } from "./commands/dashboard.js";
import { runDoctorCommand, runServeCommand } from "./commands/system.js";
import { runReefCommand } from "./commands/reef.js";
import { runAnswerAskCommand, runToolCallCommand, runToolListCommand } from "./commands/tools.js";
import { runWorkflowPacketCommand } from "./commands/workflow.js";
import {
  runChatCommand,
  runKeysCommand,
  runPermissionsCommand,
  runProvidersCommand,
  runSessionCommand,
  runTierCommand,
  runUndoCommand,
} from "./commands/harness.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runSemanticCommand } from "./commands/semantic.js";
import { runEmbeddingsCommand } from "./commands/embeddings.js";
import { runCatalogCommand } from "./commands/catalog.js";
import { runUsageCommand } from "./commands/usage.js";
import { runTelemetryCommand } from "./commands/telemetry.js";
import { runGitCommand } from "./commands/git.js";
import { runMcpCommand } from "./commands/mcp.js";
import { CLI_COMMANDS, COLORS, color, computeNextStepHints, parseGlobalArgs, printUsage, shouldUseInteractive } from "./shared.js";

export { CLI_COMMANDS, computeNextStepHints };
export type { ProjectStatusResultFromApi } from "./shared.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseGlobalArgs(argv);
  const api = createApiService();

  try {
    if (options.commandArgs[0] === "help" || options.commandArgs[0] === "--help" || options.commandArgs[0] === "-h") {
      printUsage();
      return;
    }

    if (options.commandArgs.length === 0) {
      await runDefaultCommand(api, options);
      return;
    }

    const cmd = options.commandArgs;

    if (cmd[0] === "doctor") {
      await runDoctorCommand(api);
      return;
    }

    if (cmd[0] === "serve") {
      await runServeCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "dashboard") {
      await runDashboardCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "connect") {
      await runConnectCommand(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "status" && cmd[1] !== "db") {
      await runTopLevelStatus(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "verify") {
      await runTopLevelVerify(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "refresh") {
      await runTopLevelRefresh(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "list") {
      await runProjectListCommand(api, options);
      return;
    }

    if (cmd[0] === "project" && (cmd[1] === "attach" || cmd[1] === "add")) {
      await runProjectAttachCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "project" && (cmd[1] === "detach" || cmd[1] === "remove")) {
      await runProjectDetachCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "index") {
      await runProjectIndexCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "status") {
      await runProjectStatusCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "reef") {
      await runReefCommand(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "db" && cmd[2] === "bind") {
      await runProjectDbBindCommand(api, cmd.slice(3), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "db" && cmd[2] === "unbind") {
      await runProjectDbUnbindCommand(api, cmd.slice(3), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "db" && cmd[2] === "test") {
      await runProjectDbTestCommand(api, cmd.slice(3), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "db" && cmd[2] === "verify") {
      await runProjectDbVerifyCommand(api, cmd.slice(3), options);
      return;
    }

    if (cmd[0] === "project" && cmd[1] === "db" && cmd[2] === "refresh") {
      await runProjectDbRefreshCommand(api, cmd.slice(3), options);
      return;
    }

    if (cmd[0] === "answer" && cmd[1] === "ask") {
      await runAnswerAskCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "tool" && cmd[1] === "list") {
      await runToolListCommand(api, options);
      return;
    }

    if (cmd[0] === "tool" && cmd[1] === "call") {
      await runToolCallCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "workflow" && cmd[1] === "packet") {
      await runWorkflowPacketCommand(api, cmd.slice(2), options);
      return;
    }

    if (cmd[0] === "chat") {
      await runChatCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "session") {
      await runSessionCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "providers") {
      await runProvidersCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "keys") {
      await runKeysCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "permissions") {
      await runPermissionsCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "undo") {
      await runUndoCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "tier") {
      await runTierCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "memory") {
      await runMemoryCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "semantic") {
      await runSemanticCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "embeddings") {
      await runEmbeddingsCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "catalog") {
      await runCatalogCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "usage") {
      await runUsageCommand(cmd.slice(1));
      return;
    }

    if (cmd[0] === "telemetry") {
      await runTelemetryCommand(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "git") {
      await runGitCommand(api, cmd.slice(1), options);
      return;
    }

    if (cmd[0] === "mcp") {
      await runMcpCommand(cmd.slice(1));
      return;
    }

    throw new Error(`Unknown command: ${cmd.join(" ")}. Supported commands: ${CLI_COMMANDS.join(", ")}`);
  } finally {
    api.close();
  }
}

function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isDirectInvocation()) {
  void main().catch((error: unknown) => {
    const options = parseGlobalArgs(process.argv.slice(2));
    if (shouldUseInteractive({ ...options, json: false, interactive: false })) {
      console.error();
      console.error(`${color("✗", COLORS.red)} ${color("Error:", COLORS.bright + COLORS.red)} ${error instanceof Error ? error.message : String(error)}`);
      console.error();
      console.error(color("Run `agentmako --help` for usage information.", COLORS.gray));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
