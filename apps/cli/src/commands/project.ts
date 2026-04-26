import type { MakoApiService } from "@mako-ai/api";
import {
  COLORS,
  color,
  computeNextStepHints,
  formatProjectList,
  parseDetachArgs,
  printJson,
  printNextStepHints,
  printNotAttachedMessage,
  printProjectStatusBlock,
  promptYesNo,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

export async function runProjectListCommand(api: MakoApiService, cliOptions: CliOptions): Promise<void> {
  const projects = api.listProjects();
  if (shouldUseInteractive(cliOptions)) {
    console.log(formatProjectList(projects));
  } else {
    printJson(projects);
  }
}

export async function runProjectAttachCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectRoot = rawArgs[0] ?? process.cwd();

  if (shouldUseInteractive(cliOptions)) {
    console.log(color(`Attaching project at ${projectRoot}…`, COLORS.bright));
  }
  const result = api.attachProject(projectRoot);
  if (shouldUseInteractive(cliOptions)) {
    console.log();
    console.log(`${color("✓", COLORS.green)} ${color("Project attached successfully", COLORS.green)}`);
    console.log(`  ${color("Name:", COLORS.gray)} ${result.project.displayName}`);
    console.log(`  ${color("ID:", COLORS.gray)} ${result.project.projectId}`);
    console.log(`  ${color("Path:", COLORS.gray)} ${result.project.canonicalPath}`);
    console.log(`  ${color("Manifest:", COLORS.gray)} ${result.manifestPath}`);
    console.log(`  ${color("Support Level:", COLORS.gray)} ${color(result.profile.supportLevel, COLORS.yellow)}`);
    console.log(`  ${color("Framework:", COLORS.gray)} ${result.profile.framework}`);
    console.log(`  ${color("ORM:", COLORS.gray)} ${result.profile.orm}`);
  } else {
    printJson(result);
  }
}

export async function runProjectDetachCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const detachArgs = parseDetachArgs(rawArgs);
  const projectReference = detachArgs.projectReference ?? process.cwd();
  const interactive = shouldUseInteractive(cliOptions);

  let secretDeleted = false;
  if (detachArgs.purge) {
    const preStatus = api.getProjectStatus(projectReference);
    const binding = preStatus?.dbBinding;
    const hasKeychainSecret =
      binding?.strategy === "keychain_ref" &&
      binding.configured &&
      typeof binding.ref === "string" &&
      binding.ref.trim() !== "";

    if (hasKeychainSecret) {
      let shouldDeleteSecret = detachArgs.deleteSecrets;
      if (!shouldDeleteSecret && interactive && !detachArgs.yes) {
        shouldDeleteSecret = await promptYesNo(
          "Also remove the stored database secret from the OS keychain?",
          true,
        );
      }
      if (shouldDeleteSecret) {
        try {
          api.unbindProjectDb(projectReference, { deleteSecret: true });
          secretDeleted = true;
        } catch {
          // Best-effort — the detach proceeds even if secret deletion fails.
        }
      }
    }
  }

  if (interactive) {
    console.log(color(`Detaching project at ${projectReference}…`, COLORS.bright));
  }

  const result = api.detachProject(projectReference, detachArgs.purge);
  if (interactive) {
    console.log();
    console.log(`${color("✓", COLORS.green)} ${color("Project detached successfully", COLORS.green)}`);
    console.log(`  ${color("Name:", COLORS.gray)} ${result.project.displayName}`);
    console.log(`  ${color("ID:", COLORS.gray)} ${result.project.projectId}`);
    console.log(`  ${color("Path:", COLORS.gray)} ${result.project.canonicalPath}`);
    console.log(`  ${color("Purged:", COLORS.gray)} ${result.purged ? "yes" : "no"}`);
    if (secretDeleted) {
      console.log(`  ${color("Secret:", COLORS.gray)} removed from keychain`);
    }
    if (result.removedPaths.length > 0) {
      console.log(`  ${color("Removed:", COLORS.gray)} ${result.removedPaths.join(", ")}`);
    }
  } else {
    printJson({ ...result, secretDeleted });
  }
}

export async function runProjectIndexCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectRoot = rawArgs[0] ?? process.cwd();

  if (shouldUseInteractive(cliOptions)) {
    console.log(color(`Indexing project at ${projectRoot}…`, COLORS.bright));
    console.log(color("This may take a moment for larger codebases.", COLORS.gray));
  }
  const result = await api.indexProject(projectRoot);
  if (shouldUseInteractive(cliOptions)) {
    console.log();
    const statusColor = result.run.status === "succeeded" ? COLORS.green : COLORS.red;
    console.log(`${color("✓", statusColor)} ${color(`Indexing ${result.run.status}`, statusColor)}`);
    console.log(`  ${color("Run ID:", COLORS.gray)} ${result.run.runId}`);
    console.log(`  ${color("Manifest:", COLORS.gray)} ${result.manifestPath}`);
    console.log(`  ${color("Schema Snapshot:", COLORS.gray)} ${result.schemaSnapshot.state}`);
    console.log(`  ${color("Files:", COLORS.gray)} ${result.stats.files}`);
    console.log(`  ${color("Routes:", COLORS.gray)} ${result.stats.routes}`);
    console.log(`  ${color("Symbols:", COLORS.gray)} ${result.stats.symbols}`);
    if (result.schemaSnapshotWarnings.length > 0) {
      console.log(`  ${color("Warnings:", COLORS.yellow)} ${result.schemaSnapshotWarnings.length}`);
      for (const warning of result.schemaSnapshotWarnings) {
        const source = warning.sourcePath ? `${warning.sourcePath}: ` : "";
        console.log(`    ${color("-", COLORS.yellow)} ${source}${warning.message}`);
      }
    }
    if (result.run.errorText) {
      console.log();
      console.log(color(`Error: ${result.run.errorText}`, COLORS.red));
    }
  } else {
    printJson(result);
  }
}

export async function runProjectStatusCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectReference = rawArgs[0] ?? process.cwd();
  const interactive = shouldUseInteractive(cliOptions);

  const status = api.getProjectStatus(projectReference);
  if (!status) {
    printNotAttachedMessage(projectReference, interactive);
    return;
  }

  if (interactive) {
    if (!status.project) {
      throw new Error(`No project data available for: ${projectReference}`);
    }
    printProjectStatusBlock(status);
    printNextStepHints(computeNextStepHints(status));
  } else {
    printJson(status);
  }
}
