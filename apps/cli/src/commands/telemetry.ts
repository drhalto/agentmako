import type { MakoApiService } from "@mako-ai/api";
import {
  RUNTIME_USEFULNESS_DECISION_KINDS,
  type RuntimeTelemetryReportToolOutput,
  type RuntimeUsefulnessDecisionKind,
} from "@mako-ai/contracts";
import {
  COLORS,
  color,
  printJson,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

const TELEMETRY_SHOW_LIMIT_MAX = 500;

interface ParsedArgs {
  projectReference: string;
  decisionKind?: RuntimeUsefulnessDecisionKind;
  family?: string;
  requestId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

function parseArgs(rawArgs: string[]): ParsedArgs {
  if (rawArgs.length === 0) {
    throw new Error(
      "Usage: agentmako telemetry show <path-or-project-id> [--kind K] [--family F] [--request-id R] [--since ISO] [--until ISO] [--limit N]",
    );
  }
  const projectReference = rawArgs[0]!;
  const parsed: ParsedArgs = { projectReference };

  for (let i = 1; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    const next = rawArgs[i + 1];
    switch (arg) {
      case "--kind": {
        if (!next) throw new Error("--kind requires a value");
        if (!(RUNTIME_USEFULNESS_DECISION_KINDS as readonly string[]).includes(next)) {
          throw new Error(
            `--kind must be one of: ${RUNTIME_USEFULNESS_DECISION_KINDS.join(", ")}`,
          );
        }
        parsed.decisionKind = next as RuntimeUsefulnessDecisionKind;
        i++;
        break;
      }
      case "--family": {
        if (!next) throw new Error("--family requires a value");
        parsed.family = next;
        i++;
        break;
      }
      case "--request-id": {
        if (!next) throw new Error("--request-id requires a value");
        parsed.requestId = next;
        i++;
        break;
      }
      case "--since": {
        if (!next) throw new Error("--since requires an ISO-8601 timestamp");
        parsed.since = next;
        i++;
        break;
      }
      case "--until": {
        if (!next) throw new Error("--until requires an ISO-8601 timestamp");
        parsed.until = next;
        i++;
        break;
      }
      case "--limit": {
        if (!next) throw new Error("--limit requires a positive integer");
        const n = Number.parseInt(next, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error("--limit must be a positive integer");
        }
        // Match the tool schema cap (packages/contracts/src/tool-runtime-telemetry-schemas.ts).
        // Fail locally with a clear message instead of letting the request
        // hit the schema boundary.
        if (n > TELEMETRY_SHOW_LIMIT_MAX) {
          throw new Error(
            `--limit may not exceed ${TELEMETRY_SHOW_LIMIT_MAX} (tool schema cap). Narrow with --since / --until / --family / --request-id to see older history.`,
          );
        }
        parsed.limit = n;
        i++;
        break;
      }
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return parsed;
}

export async function runTelemetryShowCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const parsed = parseArgs(rawArgs);

  const result = (await api.callTool("runtime_telemetry_report", {
    projectRef: parsed.projectReference,
    ...(parsed.decisionKind ? { decisionKind: parsed.decisionKind } : {}),
    ...(parsed.family ? { family: parsed.family } : {}),
    ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
    ...(parsed.since ? { since: parsed.since } : {}),
    ...(parsed.until ? { until: parsed.until } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  })) as RuntimeTelemetryReportToolOutput;

  if (!shouldUseInteractive(cliOptions)) {
    printJson(result);
    return;
  }

  console.log(color("Runtime Telemetry Report", COLORS.bright + COLORS.cyan));
  console.log(
    color(
      `Project: ${result.projectId}  Events: ${result.eventsInWindow}${result.truncated ? " (truncated)" : ""}`,
      COLORS.gray,
    ),
  );
  console.log();

  console.log(color("By decisionKind:", COLORS.bright));
  for (const row of result.byDecisionKind) {
    console.log(`  ${row.decisionKind.padEnd(28)} ${row.count}`);
  }
  console.log();

  if (result.byFamily.length > 0) {
    console.log(color("By family:", COLORS.bright));
    for (const row of result.byFamily) {
      console.log(
        `  ${row.decisionKind.padEnd(28)} ${row.family.padEnd(24)} ${row.count}`,
      );
    }
    console.log();
  }

  console.log(color("By grade:", COLORS.bright));
  for (const row of result.byGrade) {
    console.log(`  ${row.grade.padEnd(10)} ${row.count}`);
  }
  console.log();

  if (result.warnings.length > 0) {
    console.log(color("Warnings:", COLORS.yellow));
    for (const warning of result.warnings) {
      console.log(color(`  ${warning}`, COLORS.yellow));
    }
    console.log();
  }

  if (result.events.length === 0) {
    console.log(color("No events in window.", COLORS.gray));
    return;
  }

  console.log(color(`Events (${result.events.length}):`, COLORS.bright));
  for (const event of result.events) {
    const bits = [
      event.capturedAt,
      event.decisionKind,
      event.family,
      event.grade,
      event.toolName ?? "-",
      event.requestId,
    ];
    console.log(`  ${bits.join("  ")}`);
  }
}

export async function runTelemetryCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const sub = rawArgs[0];
  if (sub === "show") {
    await runTelemetryShowCommand(api, rawArgs.slice(1), cliOptions);
    return;
  }
  throw new Error(
    `Unknown telemetry subcommand: ${sub ?? "<missing>"}. Supported: show`,
  );
}
