import { startHttpApiServer, type MakoApiService } from "@mako-ai/api";
import { COLORS, color } from "../shared.js";

function parseServeArgs(args: string[]): { port?: number; host?: string } {
  const positional: string[] = [];
  let port: number | undefined;
  let host: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--port") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for `--port`.");
      }

      port = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (arg === "--host") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for `--host`.");
      }

      host = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown serve option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional[0] && port == null) {
    port = Number.parseInt(positional[0], 10);
  }

  if (positional[1] && host == null) {
    host = positional[1];
  }

  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error(`Invalid port: ${port}`);
  }

  return { port, host };
}

export async function runDoctorCommand(api: MakoApiService): Promise<void> {
  console.log(color("Running system health checks…", COLORS.bright));
  console.log();

  const checks: Array<{ name: string; status: "ok" | "warn" | "error"; message: string }> = [];

  try {
    const health = api.health();
    checks.push({
      name: "Configuration",
      status: "ok",
      message: `App: ${health.appName}, Target: ${health.supportTarget}`,
    });
    checks.push({
      name: "API Service",
      status: "ok",
      message: `Healthy (${health.status})`,
    });
  } catch (error) {
    checks.push({
      name: "API Service",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  try {
    const projects = api.listProjects();
    if (projects.length === 0) {
      checks.push({
        name: "Attached Projects",
        status: "warn",
        message: "No projects attached",
      });
    } else {
      checks.push({
        name: "Attached Projects",
        status: "ok",
        message: `${projects.length} project(s) attached`,
      });
    }
  } catch (error) {
    checks.push({
      name: "Attached Projects",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  for (const check of checks) {
    const icon =
      check.status === "ok"
        ? color("✓", COLORS.green)
        : check.status === "warn"
          ? color("⚠", COLORS.yellow)
          : color("✗", COLORS.red);
    const coloredName =
      check.status === "ok"
        ? color(check.name, COLORS.green)
        : check.status === "warn"
          ? color(check.name, COLORS.yellow)
          : color(check.name, COLORS.red);
    console.log(`${icon} ${coloredName}: ${check.message}`);
  }

  console.log();

  const errors = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warn").length;

  if (errors > 0) {
    console.log(color(`Found ${errors} error(s). Please fix before using mako-ai.`, COLORS.red));
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(color(`Found ${warnings} warning(s). System is usable but may need attention.`, COLORS.yellow));
  } else {
    console.log(color("All checks passed! System is healthy.", COLORS.green));
  }
}

export async function runServeCommand(rawArgs: string[]): Promise<void> {
  const { port, host } = parseServeArgs(rawArgs);
  console.log(color("Starting mako-ai API server…", COLORS.bright));
  const started = await startHttpApiServer({ port, host });
  console.log();
  console.log(`${color("✓", COLORS.green)} ${color("Server started successfully", COLORS.green)}`);
  console.log(`  ${color("URL:", COLORS.gray)} http://${started.host}:${started.port}`);
  console.log(`  ${color("Health:", COLORS.gray)} http://${started.host}:${started.port}/health`);
  console.log();
  console.log(color("Press Ctrl+C to stop", COLORS.gray));
  return await new Promise<void>(() => undefined);
}
