import type { MakoApiService } from "@mako-ai/api";
import {
  COLORS,
  color,
  parseDbBindArgs,
  parseDbUnbindArgs,
  parseDbVerifyRefreshArgs,
  printJson,
  printRefreshResult,
  printVerifyResult,
  readStdinText,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

export async function runProjectDbBindCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const bindArgs = parseDbBindArgs(rawArgs);
  if (!bindArgs.strategy) {
    throw new Error("`--strategy env_var_ref` or `--strategy keychain_ref` is required.");
  }
  if (!bindArgs.ref) {
    throw new Error("`--ref` is required.");
  }

  let secret: string | undefined;
  if (bindArgs.strategy === "keychain_ref") {
    if (bindArgs.urlFromEnv) {
      const envValue = process.env[bindArgs.urlFromEnv];
      if (envValue === undefined || envValue.trim() === "") {
        throw new Error(`Environment variable \`${bindArgs.urlFromEnv}\` is not set or empty.`);
      }
      secret = envValue;
    } else if (bindArgs.urlStdin) {
      secret = await readStdinText();
      if (secret === "") {
        throw new Error("`--url-stdin` received empty input.");
      }
    } else {
      throw new Error(
        "`--strategy keychain_ref` requires `--url-from-env <VAR>` or `--url-stdin` to supply the secret.",
      );
    }
  }

  const projectReference = bindArgs.projectReference ?? process.cwd();
  const result = api.bindProjectDb(projectReference, {
    strategy: bindArgs.strategy,
    ref: bindArgs.ref,
    secret,
  });

  if (shouldUseInteractive(cliOptions)) {
    console.log();
    console.log(`${color("✓", COLORS.green)} ${color("Database binding updated", COLORS.green)}`);
    console.log(`  ${color("Project:", COLORS.gray)} ${result.project.canonicalPath}`);
    console.log(`  ${color("Strategy:", COLORS.gray)} ${result.binding.strategy}`);
    console.log(`  ${color("Ref:", COLORS.gray)} ${result.binding.ref}`);
    console.log(`  ${color("Enabled:", COLORS.gray)} ${result.binding.enabled ? "yes" : "no"}`);
    if (result.secretStored) {
      console.log(`  ${color("Secret:", COLORS.gray)} stored in keychain`);
    }
  } else {
    printJson(result);
  }
}

export async function runProjectDbUnbindCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const unbindArgs = parseDbUnbindArgs(rawArgs);
  const projectReference = unbindArgs.projectReference ?? process.cwd();
  const result = api.unbindProjectDb(projectReference, { deleteSecret: unbindArgs.deleteSecret });

  if (shouldUseInteractive(cliOptions)) {
    console.log();
    console.log(`${color("✓", COLORS.green)} ${color("Database binding disabled", COLORS.green)}`);
    console.log(`  ${color("Project:", COLORS.gray)} ${result.project.canonicalPath}`);
    if (result.secretDeleted) {
      console.log(`  ${color("Secret:", COLORS.gray)} removed from keychain`);
    }
  } else {
    printJson(result);
  }
}

export async function runProjectDbTestCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectReference = rawArgs[0] ?? process.cwd();
  const result = await api.testProjectDb(projectReference);

  if (shouldUseInteractive(cliOptions)) {
    console.log();
    if (result.success) {
      console.log(`${color("✓", COLORS.green)} ${color("Database connection OK", COLORS.green)}`);
      console.log(`  ${color("Strategy:", COLORS.gray)} ${result.strategy}`);
      console.log(`  ${color("Ref:", COLORS.gray)} ${result.ref}`);
      console.log(`  ${color("Server:", COLORS.gray)} ${result.serverVersion}`);
      console.log(`  ${color("User:", COLORS.gray)} ${result.currentUser}`);
    } else {
      console.log(`${color("✗", COLORS.red)} ${color("Database connection failed", COLORS.red)}`);
      console.log(`  ${color("Error:", COLORS.gray)} ${result.error ?? "unknown"}`);
    }
  } else {
    printJson(result);
  }
}

export async function runProjectDbVerifyCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const verifyArgs = parseDbVerifyRefreshArgs("verify", rawArgs);
  const projectReference = verifyArgs.projectReference ?? process.cwd();
  const result = await api.verifyProjectDb(projectReference, {
    includedSchemas: verifyArgs.includedSchemas,
  });

  if (shouldUseInteractive(cliOptions)) {
    printVerifyResult(result);
  } else {
    printJson(result);
  }
}

export async function runProjectDbRefreshCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const refreshArgs = parseDbVerifyRefreshArgs("refresh", rawArgs);
  const projectReference = refreshArgs.projectReference ?? process.cwd();
  const result = await api.refreshProjectDb(projectReference, {
    includedSchemas: refreshArgs.includedSchemas,
  });

  if (shouldUseInteractive(cliOptions)) {
    printRefreshResult(result);
  } else {
    printJson(result);
  }
}
