import type { MakoApiService } from "@mako-ai/api";
import {
  computeNextStepHints,
  loadSchemaScopeFromStatus,
  parseDbVerifyRefreshArgs,
  printJson,
  printNextStepHints,
  printNotAttachedMessage,
  printProjectStatusBlock,
  printRefreshResult,
  printVerifyResult,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

export async function runTopLevelStatus(
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

export async function runTopLevelVerify(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const verifyArgs = parseDbVerifyRefreshArgs("verify", rawArgs);
  const projectReference = verifyArgs.projectReference ?? process.cwd();
  const interactive = shouldUseInteractive(cliOptions);

  const preStatus = api.getProjectStatus(projectReference);
  if (!preStatus) {
    printNotAttachedMessage(projectReference, interactive);
    return;
  }

  let includedSchemas = verifyArgs.includedSchemas;
  let scopeFromDefaults = false;
  if (!includedSchemas || includedSchemas.length === 0) {
    const saved = loadSchemaScopeFromStatus(preStatus);
    if (saved) {
      includedSchemas = saved;
      scopeFromDefaults = true;
    }
  }

  const result = await api.verifyProjectDb(projectReference, { includedSchemas });

  if (interactive) {
    printVerifyResult(result);
  } else {
    printJson({ ...result, scopeFromDefaults });
  }
}

export async function runTopLevelRefresh(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const refreshArgs = parseDbVerifyRefreshArgs("refresh", rawArgs);
  const projectReference = refreshArgs.projectReference ?? process.cwd();
  const interactive = shouldUseInteractive(cliOptions);

  const preStatus = api.getProjectStatus(projectReference);
  if (!preStatus) {
    printNotAttachedMessage(projectReference, interactive);
    return;
  }

  let includedSchemas = refreshArgs.includedSchemas;
  let scopeFromDefaults = false;
  if (!includedSchemas || includedSchemas.length === 0) {
    const saved = loadSchemaScopeFromStatus(preStatus);
    if (saved) {
      includedSchemas = saved;
      scopeFromDefaults = true;
    }
  }

  const result = await api.refreshProjectDb(projectReference, { includedSchemas });

  if (interactive) {
    printRefreshResult(result);
  } else {
    printJson({ ...result, scopeFromDefaults });
  }
}
