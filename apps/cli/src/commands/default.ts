import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MakoApiService } from "@mako-ai/api";
import { COLORS, color, formatProjectList, printJson, shouldUseInteractive, type CliOptions } from "../shared.js";
import { runTopLevelStatus } from "./status.js";

export async function runDefaultCommand(api: MakoApiService, options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const cwdStatus = api.getProjectStatus(cwd);
  if (cwdStatus) {
    await runTopLevelStatus(api, [], options);
    return;
  }

  const interactive = shouldUseInteractive(options);
  if (existsSync(join(cwd, ".git"))) {
    if (interactive) {
      console.log(color("No project attached here.", COLORS.yellow));
      console.log(`Run ${color("agentmako connect", COLORS.bright)} to get started.`);
    } else {
      printJson({ attached: false, hint: "Run `agentmako connect` to get started." });
    }
    return;
  }

  const projects = api.listProjects();
  if (interactive) {
    if (projects.length === 0) {
      console.log(color("No projects attached.", COLORS.yellow));
      console.log(`Run ${color("agentmako connect <path>", COLORS.bright)} to attach a new project.`);
    } else {
      console.log(formatProjectList(projects));
      console.log();
      console.log(color("Run agentmako connect <path> to attach a new project.", COLORS.gray));
    }
  } else {
    printJson({ projects });
  }
}
