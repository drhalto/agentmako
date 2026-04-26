import type { MakoApiService } from "@mako-ai/api";
import {
  COLORS,
  color,
  computeNextStepHints,
  defaultKeychainRefFor,
  loadSchemaScopeFromStatus,
  parseConnectArgs,
  printDbConnectionGuide,
  printJson,
  printNextStepHints,
  printProjectStatusBlock,
  promptSecret,
  promptYesNo,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

interface ConnectOutcomeDetails {
  indexResult: Awaited<ReturnType<MakoApiService["indexProject"]>> | null;
  bindResult: ReturnType<MakoApiService["bindProjectDb"]> | null;
  testResult: Awaited<ReturnType<MakoApiService["testProjectDb"]>> | null;
  scopeResult: ReturnType<MakoApiService["setProjectDefaultSchemaScope"]> | null;
  refreshResult: Awaited<ReturnType<MakoApiService["refreshProjectDb"]>> | null;
  scopeSource: "user" | "inherited" | "default" | "none";
}

async function printFinalConnectStatus(
  api: MakoApiService,
  projectReference: string,
  cliOptions: CliOptions,
  details: ConnectOutcomeDetails,
): Promise<void> {
  const interactive = shouldUseInteractive(cliOptions);
  const status = api.getProjectStatus(projectReference);
  if (!status) {
    throw new Error(`Project status unavailable after connect: ${projectReference}`);
  }
  const nextSteps = computeNextStepHints(status);

  if (interactive) {
    printProjectStatusBlock(status);
    printNextStepHints(nextSteps);
    return;
  }

  const savedScope = details.scopeResult?.defaultSchemaScope ?? status.manifest?.database.defaultSchemaScope ?? [];
  printJson({
    project: status.project,
    profile: status.profile,
    manifest: status.manifest,
    manifestPath: status.manifestPath,
    indexRun: details.indexResult?.run ?? null,
    indexStats: details.indexResult?.stats ?? null,
    schemaSnapshot: status.schemaSnapshot,
    dbBinding: status.dbBinding,
    bind: details.bindResult,
    test: details.testResult,
    defaultSchemaScope: savedScope,
    scopeSource: details.scopeSource,
    refresh: details.refreshResult,
    nextSteps,
  });
}

export async function runConnectCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const args = parseConnectArgs(rawArgs);
  const projectRoot = args.projectReference ?? process.cwd();
  const interactive = shouldUseInteractive(cliOptions);

  const attached = api.attachProject(projectRoot);
  const projectId = attached.project.projectId;

  if (interactive) {
    const stackSummary = [attached.profile.framework, attached.profile.orm]
      .filter((entry) => entry && entry !== "unknown")
      .join(" + ") || "unknown stack";
    console.log(`${color("✓", COLORS.green)} ${color("Attached", COLORS.green)} ${attached.project.displayName}`);
    console.log(`  ${color(stackSummary, COLORS.gray)} · ${color(`support ${attached.profile.supportLevel}`, COLORS.gray)}`);
    console.log();
  }

  let indexResult: Awaited<ReturnType<MakoApiService["indexProject"]>> | null = null;
  if (!args.skipIndex) {
    indexResult = await api.indexProject(projectRoot);
    if (interactive) {
      const ok = indexResult.run.status === "succeeded";
      if (ok) {
        console.log(
          `${color("✓", COLORS.green)} ${color("Indexed", COLORS.green)} ${indexResult.stats.files} files, ${indexResult.stats.routes} routes · snapshot ${indexResult.schemaSnapshot.state}`,
        );
      } else {
        console.log(`${color("✗", COLORS.red)} ${color(`Index ${indexResult.run.status}`, COLORS.red)}`);
      }
      console.log();
    }
  }

  const details: ConnectOutcomeDetails = {
    indexResult,
    bindResult: null,
    testResult: null,
    scopeResult: null,
    refreshResult: null,
    scopeSource: "none",
  };

  let scope: string[] | undefined;
  if (args.schemas && args.schemas.length > 0) {
    scope = args.schemas;
    details.scopeResult = api.setProjectDefaultSchemaScope(projectRoot, scope);
    details.scopeSource = "user";
    if (interactive) {
      console.log(`${color("✓", COLORS.green)} ${color("Scope saved", COLORS.green)} · ${color(scope.join(","), COLORS.gray)}`);
      console.log();
    }
  }

  let wantBind = args.bindDbExplicit;
  if (wantBind === null) {
    if (!interactive || args.yes) {
      wantBind = false;
    } else {
      wantBind = await promptYesNo("Connect a live database now?", true);
      console.log();
    }
  }

  if (!wantBind) {
    if (!scope) {
      const preStatus = api.getProjectStatus(projectRoot);
      const savedScope = loadSchemaScopeFromStatus(preStatus);
      if (savedScope) {
        scope = savedScope;
        details.scopeSource = "inherited";
      }
    }
    await printFinalConnectStatus(api, projectRoot, cliOptions, details);
    return;
  }

  let strategy: "env_var_ref" | "keychain_ref";
  let ref: string;
  let secret: string | undefined;

  if (args.dbEnv) {
    strategy = "env_var_ref";
    ref = args.dbEnv;
    const envValue = process.env[ref];
    if (envValue === undefined || envValue.trim() === "") {
      throw new Error(
        `Environment variable \`${ref}\` is not set or empty. Set it before re-running, or pass a different \`--db-env <VAR>\`.`,
      );
    }
  } else if (args.keychainFromEnv) {
    strategy = "keychain_ref";
    ref = args.ref ?? defaultKeychainRefFor(projectId);
    const envValue = process.env[args.keychainFromEnv];
    if (envValue === undefined || envValue.trim() === "") {
      throw new Error(`Environment variable \`${args.keychainFromEnv}\` is not set or empty.`);
    }
    secret = envValue;
  } else {
    if (!interactive || !process.stdin.isTTY) {
      throw new Error(
        "Interactive DB capture requires a TTY. Pass `--db-env <VAR>` or `--keychain-from-env <VAR>` to supply the URL from an env var, or `--no-db` to skip the live DB step.",
      );
    }
    strategy = "keychain_ref";
    ref = args.ref ?? defaultKeychainRefFor(projectId);

    printDbConnectionGuide(attached.profile.orm);

    secret = await promptSecret("Database URL: ");
    if (secret === "") {
      throw new Error("Database URL must not be empty. Re-run with `--no-db` to skip the live DB step.");
    }
  }

  details.bindResult = api.bindProjectDb(projectRoot, { strategy, ref, secret });
  if (interactive) {
    const storageLabel = details.bindResult.secretStored
      ? "stored in OS keychain"
      : `env var ${details.bindResult.binding.ref}`;
    console.log(`${color("✓", COLORS.green)} ${color("Bound", COLORS.green)} · ${color(storageLabel, COLORS.gray)}`);
  }

  try {
    details.testResult = await api.testProjectDb(projectRoot);
    if (interactive) {
      if (details.testResult.success) {
        const server = details.testResult.serverVersion?.split(" ").slice(0, 2).join(" ") ?? "unknown";
        console.log(
          `${color("✓", COLORS.green)} ${color("Connection OK", COLORS.green)} · ${color(`${server} · user ${details.testResult.currentUser}`, COLORS.gray)}`,
        );
        console.log();
      } else {
        console.log(
          `${color("✗", COLORS.red)} ${color("Connection test failed", COLORS.red)} · ${color(details.testResult.error ?? "unknown", COLORS.gray)}`,
        );
        console.log(color("Stopping before refresh. Fix credentials and re-run `agentmako connect`.", COLORS.yellow));
        console.log();
        await printFinalConnectStatus(api, projectRoot, cliOptions, details);
        return;
      }
    }
  } catch (error) {
    if (interactive) {
      console.log(
        `${color("✗", COLORS.red)} ${color("Connection test failed", COLORS.red)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.log();
      await printFinalConnectStatus(api, projectRoot, cliOptions, details);
      return;
    }
    throw error;
  }

  if (!scope) {
    const statusBefore = api.getProjectStatus(projectRoot);
    const savedScope = loadSchemaScopeFromStatus(statusBefore);

    if (savedScope) {
      scope = savedScope;
      details.scopeSource = "inherited";
    } else {
      const discoveredSchemas = await api.discoverProjectDbSchemas(projectRoot);
      scope = [...discoveredSchemas.visibleSchemas];
      details.scopeSource = "default";

      if (!scope || scope.length === 0) {
        throw new Error(
          "No non-system schemas were detected from the live database. Pass `--schemas a,b` to choose an explicit scope.",
        );
      }

      details.scopeResult = api.setProjectDefaultSchemaScope(projectRoot, scope);
    }

    if (interactive) {
      if (details.scopeSource === "inherited") {
        console.log(`${color("·", COLORS.gray)} ${color(`Using saved scope: ${scope.join(", ")}`, COLORS.gray)}`);
      } else {
        console.log(
          `${color("✓", COLORS.green)} ${color("Tracking", COLORS.green)} ${color(`${scope.length} schemas`, COLORS.gray)} ${color(`(${scope.join(", ")})`, COLORS.gray)}`,
        );
      }
    }
  }

  try {
    details.refreshResult = await api.refreshProjectDb(projectRoot, {
      includedSchemas: scope && scope.length > 0 ? scope : undefined,
    });
    if (interactive) {
      const warnSuffix =
        details.refreshResult.warningCount > 0
          ? color(` · ${details.refreshResult.warningCount} warning(s)`, COLORS.yellow)
          : "";
      console.log(
        `${color("✓", COLORS.green)} ${color("Snapshot refreshed", COLORS.green)} · ${color(`${details.refreshResult.sourceMode} · ${details.refreshResult.tableCount} tables`, COLORS.gray)}${warnSuffix}`,
      );
      console.log();
    }
  } catch (error) {
    if (interactive) {
      console.log(`${color("✗", COLORS.red)} ${color("Refresh failed", COLORS.red)}: ${error instanceof Error ? error.message : String(error)}`);
      console.log();
    } else {
      throw error;
    }
  }

  await printFinalConnectStatus(api, projectRoot, cliOptions, details);
}
