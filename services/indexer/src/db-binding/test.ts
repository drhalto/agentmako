import type { DbConnectionTestResult } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import {
  PgConnectionError,
  withReadOnlyConnection,
} from "@mako-ai/extension-postgres";
import { ProjectCommandError } from "../errors.js";
import { readProjectManifest } from "../project-manifest.js";
import type { IndexerOptions } from "../types.js";
import { durationMs, withResolvedProjectContext } from "../utils.js";
import { resolveLiveDbUrl } from "./resolve.js";

const testLogger = createLogger("mako-indexer", { component: "db-test" });

interface PingRow {
  server_version: string;
  current_user: string;
}

export async function testProjectDbConnection(
  projectReference: string,
  options: IndexerOptions = {},
): Promise<DbConnectionTestResult> {
  return withResolvedProjectContext(projectReference, options, async ({ project, projectStore }) => {
    const manifest = readProjectManifest(project.canonicalPath);
    if (!manifest) {
      throw new ProjectCommandError(
        422,
        "project_manifest_invalid",
        `Project manifest is missing for: ${project.canonicalPath}`,
      );
    }

    const resolvedUrl = resolveLiveDbUrl(manifest.database.liveBinding);
    const testedAt = new Date().toISOString();

    const testStartedAt = new Date().toISOString();
    let testResult: DbConnectionTestResult | undefined;
    let testError: unknown;

    try {
      const { serverVersion, currentUser } = await withReadOnlyConnection(
        { databaseUrl: resolvedUrl.url, statementTimeoutMs: 10_000 },
        async (context) => {
          const result = await context.query<PingRow>(
            "SELECT version() AS server_version, current_user AS current_user",
          );
          const row = result.rows[0];
          return {
            serverVersion: row?.server_version ?? "unknown",
            currentUser: row?.current_user ?? "unknown",
          };
        },
      );

      projectStore.saveDbBindingTestResult({
        status: "success",
        testedAt,
        serverVersion,
        currentUser,
      });

      testResult = {
        success: true,
        testedAt,
        strategy: resolvedUrl.strategy,
        ref: resolvedUrl.ref,
        serverVersion,
        currentUser,
      };
      return testResult;
    } catch (error) {
      testError = error;
      const message = error instanceof Error ? error.message : String(error);
      projectStore.saveDbBindingTestResult({
        status: "failure",
        testedAt,
        error: message,
      });

      if (error instanceof PgConnectionError) {
        throw new ProjectCommandError(
          502,
          "db_connection_test_failed",
          `Connection test failed: ${error.message}`,
          { strategy: resolvedUrl.strategy, ref: resolvedUrl.ref, code: error.code },
        );
      }
      if (error instanceof ProjectCommandError) {
        throw error;
      }
      throw new ProjectCommandError(
        502,
        "db_connection_test_failed",
        `Connection test failed: ${message}`,
        { strategy: resolvedUrl.strategy, ref: resolvedUrl.ref },
      );
    } finally {
      const finishedAt = new Date().toISOString();
      try {
        projectStore.insertLifecycleEvent({
          projectId: project.projectId,
          eventType: "db_test",
          outcome: testError ? "failed" : "success",
          startedAt: testStartedAt,
          finishedAt,
          durationMs: durationMs(testStartedAt, finishedAt),
          metadata: {
            strategy: resolvedUrl.strategy,
            ref: resolvedUrl.ref,
            success: testResult?.success ?? false,
            serverVersion: testResult?.serverVersion ?? null,
            currentUser: testResult?.currentUser ?? null,
          },
          errorText: testError instanceof Error ? testError.message : testError ? String(testError) : undefined,
        });
      } catch (error) {
        testLogger.warn("log-write-failed", {
          eventType: "db_test",
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
