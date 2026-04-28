import type {
  ReefDaemonStatus,
  ReefOperationKind,
  ReefOperationLogEntry,
  ReefProjectStatus,
} from "@mako-ai/contracts";
import { ReefOperationKindSchema } from "@mako-ai/contracts";
import type { MakoApiService } from "@mako-ai/api";
import {
  COLORS,
  color,
  printJson,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

export async function runReefCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const subcommand = rawArgs[0] ?? "status";
  switch (subcommand) {
    case "start":
      return runReefStartCommand(api, rawArgs.slice(1), cliOptions);
    case "stop":
      return runReefStopCommand(api, cliOptions);
    case "status":
      return runReefStatusCommand(api, rawArgs.slice(1), cliOptions);
    case "operations":
      return runReefOperationsCommand(api, rawArgs.slice(1), cliOptions);
    default:
      throw new Error(`Unknown reef command: ${subcommand}`);
  }
}

export async function runReefStartCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const foreground = rawArgs.includes("--foreground");
  const force = rawArgs.includes("--force");
  const result = await api.startReefDaemon({ foreground, force });
  if (!shouldUseInteractive(cliOptions)) {
    printJson(result);
    return;
  }
  console.log(color(result.message, result.started ? COLORS.green : COLORS.yellow));
  if (result.process) {
    printDaemonProcess(result.process);
  }
}

export async function runReefStopCommand(
  api: MakoApiService,
  cliOptions: CliOptions,
): Promise<void> {
  const result = await api.stopReefDaemon();
  if (!shouldUseInteractive(cliOptions)) {
    printJson(result);
    return;
  }
  console.log(color(result.message, result.stopped ? COLORS.green : COLORS.yellow));
}

export async function runReefStatusCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectReference = rawArgs[0];
  const interactive = shouldUseInteractive(cliOptions);

  if (projectReference) {
    const status = await api.getReefProjectStatus(projectReference);
    if (interactive) {
      printReefProjectStatus(status);
    } else {
      printJson(status);
    }
    return;
  }

  const daemon = await api.getReefDaemonStatus();
  const statuses = await api.listReefProjectStatuses();
  if (!interactive) {
    printJson({ daemon, projects: statuses });
    return;
  }

  printDaemonStatus(daemon);

  if (statuses.length === 0) {
    console.log(color("No projects attached. Use `agentmako project attach [path]` first.", COLORS.yellow));
    return;
  }

  statuses.forEach((status, index) => {
    if (index > 0) {
      console.log();
    }
    printReefProjectStatus(status);
  });
}

export async function runReefOperationsCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const { projectReference, kind, severity, since, limit } = parseOperationsArgs(rawArgs);
  const projectId = projectReference
    ? (await api.getReefProjectStatus(projectReference)).projectId
    : undefined;
  const operations = await api.listReefOperations({
    ...(projectId ? { projectId } : {}),
    ...(kind ? { kind } : {}),
    ...(severity ? { severity } : {}),
    ...(since ? { since } : {}),
    ...(limit ? { limit } : {}),
  });
  if (!shouldUseInteractive(cliOptions)) {
    printJson(operations);
    return;
  }
  printOperations(operations);
}

function printReefProjectStatus(status: ReefProjectStatus): void {
  console.log(color(`Reef: ${status.root}`, COLORS.bright + COLORS.cyan));
  console.log(`  ${color("Project:", COLORS.gray)} ${status.projectId}`);
  console.log(`  ${color("Mode:", COLORS.gray)} ${status.serviceMode}`);
  console.log(`  ${color("State:", COLORS.gray)} ${color(status.state, stateColor(status.state))}`);

  console.log();
  console.log(color("Analysis:", COLORS.bright));
  console.log(`  ${color("Host:", COLORS.gray)} ${status.analysis.hostId ?? "unavailable"}`);
  console.log(`  ${color("Revision:", COLORS.gray)} ${status.analysis.revisionState}`);
  console.log(`  ${color("Running queries:", COLORS.gray)} ${status.analysis.runningQueryCount}`);

  console.log();
  console.log(color("Watcher:", COLORS.bright));
  console.log(`  ${color("Backend:", COLORS.gray)} ${status.watcher.backend ?? "unknown"}`);
  console.log(`  ${color("Active:", COLORS.gray)} ${status.watcher.active ? "yes" : "no"}`);
  console.log(`  ${color("Degraded:", COLORS.gray)} ${status.watcher.degraded ? "yes" : "no"}`);
  console.log(`  ${color("Dirty paths:", COLORS.gray)} ${status.watcher.dirtyPathCount}`);
  console.log(`  ${color("Recrawls:", COLORS.gray)} ${status.watcher.recrawlCount}`);
  if (status.watcher.lastEventAt) {
    console.log(`  ${color("Last event:", COLORS.gray)} ${status.watcher.lastEventAt}`);
  }
  if (status.watcher.lastError) {
    console.log(`  ${color("Last error:", COLORS.gray)} ${status.watcher.lastError}`);
  }

  console.log();
  console.log(color("Writer Queue:", COLORS.bright));
  console.log(`  ${color("Running:", COLORS.gray)} ${status.writerQueue.running ? "yes" : "no"}`);
  console.log(`  ${color("Queued:", COLORS.gray)} ${status.writerQueue.queued}`);
  if (status.writerQueue.lastRunAt) {
    console.log(`  ${color("Last run:", COLORS.gray)} ${status.writerQueue.lastRunAt}`);
  }
  if (status.writerQueue.lastRunTrigger) {
    console.log(`  ${color("Trigger:", COLORS.gray)} ${status.writerQueue.lastRunTrigger}`);
  }

  console.log();
  console.log(color("Freshness:", COLORS.bright));
  console.log(`  ${color("Checked:", COLORS.gray)} ${status.freshness.checkedAt}`);
  console.log(`  ${color("Indexed:", COLORS.gray)} ${status.freshness.indexedFiles}`);
  console.log(`  ${color("Stale:", COLORS.gray)} ${status.freshness.staleFiles}`);
  console.log(`  ${color("Deleted:", COLORS.gray)} ${status.freshness.deletedFiles}`);
  console.log(`  ${color("Unknown:", COLORS.gray)} ${status.freshness.unknownFiles}`);
  console.log(`  ${color("Unindexed:", COLORS.gray)} ${status.freshness.unindexedFiles}`);
}

function printDaemonStatus(status: ReefDaemonStatus): void {
  console.log(color("Reef Daemon:", COLORS.bright + COLORS.cyan));
  console.log(`  ${color("Mode:", COLORS.gray)} ${status.serviceMode}`);
  console.log(`  ${color("Available:", COLORS.gray)} ${status.available ? "yes" : "no"}`);
  console.log(`  ${color("Compatible:", COLORS.gray)} ${status.compatible ? "yes" : "no"}`);
  if (status.process) {
    printDaemonProcess(status.process);
  }
  if (status.error) {
    console.log(`  ${color("Error:", COLORS.gray)} ${status.error}`);
  }
  console.log();
}

function printDaemonProcess(processInfo: NonNullable<ReefDaemonStatus["process"]>): void {
  console.log(`  ${color("PID:", COLORS.gray)} ${processInfo.pid}`);
  console.log(`  ${color("Endpoint:", COLORS.gray)} ${processInfo.endpoint}`);
  console.log(`  ${color("Transport:", COLORS.gray)} ${processInfo.transport}`);
  console.log(`  ${color("Protocol:", COLORS.gray)} ${processInfo.protocolVersion}`);
  console.log(`  ${color("Started:", COLORS.gray)} ${processInfo.startedAt}`);
  console.log(`  ${color("Token:", COLORS.gray)} ${processInfo.tokenFingerprint}`);
}

function printOperations(operations: ReefOperationLogEntry[]): void {
  if (operations.length === 0) {
    console.log(color("No Reef operations recorded.", COLORS.yellow));
    return;
  }
  for (const operation of operations) {
    const project = operation.projectId ? ` ${operation.projectId}` : "";
    console.log(`${operation.createdAt} ${operation.severity} ${operation.kind}${project}`);
    console.log(`  ${operation.message}`);
  }
}

function parseOperationsArgs(args: string[]): {
  projectReference?: string;
  kind?: ReefOperationKind;
  severity?: ReefOperationLogEntry["severity"];
  since?: string;
  limit?: number;
} {
  const positional: string[] = [];
  let kind: ReefOperationKind | undefined;
  let severity: ReefOperationLogEntry["severity"] | undefined;
  let since: string | undefined;
  let limit: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--kind") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--kind` requires a value.");
      }
      const parsed = ReefOperationKindSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`\`--kind\` must be one of: ${ReefOperationKindSchema.options.join(", ")}.`);
      }
      kind = parsed.data;
      index += 1;
      continue;
    }
    if (arg === "--severity") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--severity` requires a value.");
      }
      if (!["debug", "info", "warning", "error"].includes(value)) {
        throw new Error("`--severity` must be one of: debug, info, warning, error.");
      }
      severity = value as ReefOperationLogEntry["severity"];
      index += 1;
      continue;
    }
    if (arg === "--since") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--since` requires an ISO timestamp or duration like 30m.");
      }
      since = parseOperationsSince(value);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--limit` requires a value.");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("`--limit` must be a positive integer.");
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown reef operations option: ${arg}`);
    }
    positional.push(arg);
  }
  return {
    projectReference: positional[0],
    kind,
    severity,
    since,
    limit,
  };
}

function parseOperationsSince(value: string): string {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
  if (!match) {
    throw new Error("`--since` must be an ISO timestamp or duration like 30m, 2h, or 7d.");
  }
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multiplier = unit === "ms"
    ? 1
    : unit === "s"
      ? 1000
      : unit === "m"
        ? 60 * 1000
        : unit === "h"
          ? 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
  return new Date(Date.now() - amount * multiplier).toISOString();
}

function stateColor(state: ReefProjectStatus["state"]): string {
  switch (state) {
    case "fresh":
      return COLORS.green;
    case "refreshing":
    case "dirty":
    case "stale":
      return COLORS.yellow;
    case "unknown":
    case "disabled":
    case "error":
      return COLORS.red;
  }
}
