import type {
  DbBindingStatus,
  ProjectBindingStrategy,
  ProjectManifest,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { ProjectCommandError } from "../errors.js";
import { readProjectManifest, writeProjectManifest } from "../project-manifest.js";
import type { IndexerOptions } from "../types.js";
import { durationMs, withResolvedProjectContext } from "../utils.js";
import { deleteKeychainSecret, storeKeychainSecret } from "./resolve.js";

const bindLogger = createLogger("mako-indexer", { component: "db-bind" });

export interface BindProjectDbInput {
  strategy: ProjectBindingStrategy;
  ref: string;
  secret?: string;
}

export interface BindProjectDbResult {
  project: { projectId: string; canonicalPath: string };
  binding: DbBindingStatus;
  manifestPath: string;
  secretStored: boolean;
}

export interface UnbindProjectDbInput {
  deleteSecret?: boolean;
}

export interface UnbindProjectDbResult {
  project: { projectId: string; canonicalPath: string };
  binding: DbBindingStatus;
  manifestPath: string;
  secretDeleted: boolean;
}

function buildStatus(
  manifest: ProjectManifest,
  extras: Partial<DbBindingStatus> = {},
): DbBindingStatus {
  return {
    strategy: manifest.database.liveBinding.strategy,
    ref: manifest.database.liveBinding.ref,
    enabled: manifest.database.liveBinding.enabled,
    configured: manifest.database.liveBinding.enabled,
    ...extras,
  };
}

export function bindProjectDb(
  projectReference: string,
  input: BindProjectDbInput,
  options: IndexerOptions = {},
): BindProjectDbResult {
  return withResolvedProjectContext(projectReference, options, ({ project, projectStore }) => {
    const bindStartedAt = new Date().toISOString();
    let bindError: unknown;
    let secretStored = false;
    let manifestPath: string | undefined;

    try {
      const trimmedRef = input.ref.trim();
      if (trimmedRef === "") {
        throw new ProjectCommandError(
          422,
          "db_binding_invalid",
          "`--ref` must not be empty.",
        );
      }

      const manifest = readProjectManifest(project.canonicalPath);
      if (!manifest) {
        throw new ProjectCommandError(
          422,
          "project_manifest_invalid",
          `Project manifest is missing for: ${project.canonicalPath}`,
        );
      }

      if (input.strategy === "keychain_ref") {
        if (!input.secret || input.secret.trim() === "") {
          throw new ProjectCommandError(
            422,
            "db_binding_invalid",
            "Binding with `keychain_ref` requires a secret. Provide `--url-from-env <ENV_VAR>` or `--url-stdin`.",
          );
        }
        storeKeychainSecret(trimmedRef, input.secret);
        secretStored = true;
      } else if (input.strategy === "env_var_ref") {
        if (input.secret !== undefined) {
          throw new ProjectCommandError(
            422,
            "db_binding_invalid",
            "Binding with `env_var_ref` cannot accept a secret. The ref must name an env var that the caller already populates.",
          );
        }
      }

      const updatedManifest: ProjectManifest = {
        ...manifest,
        database: {
          ...manifest.database,
          liveBinding: {
            strategy: input.strategy,
            ref: trimmedRef,
            enabled: true,
          },
        },
      };
      manifestPath = writeProjectManifest(project.canonicalPath, updatedManifest);

      const bindingState = projectStore.loadDbBindingState();
      return {
        project: {
          projectId: project.projectId,
          canonicalPath: project.canonicalPath,
        },
        binding: buildStatus(updatedManifest, {
          lastTestedAt: bindingState.lastTestedAt,
          lastTestStatus: bindingState.lastTestStatus,
          lastTestError: bindingState.lastTestError,
          lastVerifiedAt: bindingState.lastVerifiedAt,
          lastRefreshedAt: bindingState.lastRefreshedAt,
        }),
        manifestPath,
        secretStored,
      };
    } catch (error) {
      bindError = error;
      throw error;
    } finally {
      const finishedAt = new Date().toISOString();
      try {
        projectStore.insertLifecycleEvent({
          projectId: project.projectId,
          eventType: "db_bind",
          outcome: bindError ? "failed" : "success",
          startedAt: bindStartedAt,
          finishedAt,
          durationMs: durationMs(bindStartedAt, finishedAt),
          metadata: {
            strategy: input.strategy,
            ref: input.ref.trim(),
            secretStored,
            manifestPath: manifestPath ?? null,
          },
          errorText: bindError instanceof Error ? bindError.message : bindError ? String(bindError) : undefined,
        });
      } catch (error) {
        bindLogger.warn("log-write-failed", {
          eventType: "db_bind",
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

export function unbindProjectDb(
  projectReference: string,
  input: UnbindProjectDbInput = {},
  options: IndexerOptions = {},
): UnbindProjectDbResult {
  return withResolvedProjectContext(projectReference, options, ({ project, projectStore }) => {
    const unbindStartedAt = new Date().toISOString();
    let unbindError: unknown;
    let secretDeleted = false;
    let manifestPath: string | undefined;

    try {
      const manifest = readProjectManifest(project.canonicalPath);
      if (!manifest) {
        throw new ProjectCommandError(
          422,
          "project_manifest_invalid",
          `Project manifest is missing for: ${project.canonicalPath}`,
        );
      }

      if (
        input.deleteSecret &&
        manifest.database.liveBinding.strategy === "keychain_ref" &&
        manifest.database.liveBinding.ref.trim() !== ""
      ) {
        secretDeleted = deleteKeychainSecret(manifest.database.liveBinding.ref);
      }

      const updatedManifest: ProjectManifest = {
        ...manifest,
        database: {
          ...manifest.database,
          liveBinding: {
            ...manifest.database.liveBinding,
            enabled: false,
          },
        },
      };
      manifestPath = writeProjectManifest(project.canonicalPath, updatedManifest);

      const bindingState = projectStore.loadDbBindingState();
      return {
        project: {
          projectId: project.projectId,
          canonicalPath: project.canonicalPath,
        },
        binding: buildStatus(updatedManifest, {
          lastTestedAt: bindingState.lastTestedAt,
          lastTestStatus: bindingState.lastTestStatus,
          lastTestError: bindingState.lastTestError,
          lastVerifiedAt: bindingState.lastVerifiedAt,
          lastRefreshedAt: bindingState.lastRefreshedAt,
        }),
        manifestPath,
        secretDeleted,
      };
    } catch (error) {
      unbindError = error;
      throw error;
    } finally {
      const finishedAt = new Date().toISOString();
      try {
        projectStore.insertLifecycleEvent({
          projectId: project.projectId,
          eventType: "db_unbind",
          outcome: unbindError ? "failed" : "success",
          startedAt: unbindStartedAt,
          finishedAt,
          durationMs: durationMs(unbindStartedAt, finishedAt),
          metadata: {
            deleteSecret: input.deleteSecret ?? false,
            secretDeleted,
            manifestPath: manifestPath ?? null,
          },
          errorText: unbindError instanceof Error ? unbindError.message : unbindError ? String(unbindError) : undefined,
        });
      } catch (error) {
        bindLogger.warn("log-write-failed", {
          eventType: "db_unbind",
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
