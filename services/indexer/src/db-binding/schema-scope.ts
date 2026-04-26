import { loadConfig } from "@mako-ai/config";
import { openGlobalStore } from "@mako-ai/store";
import {
  fetchPingInfo,
  PgConnectionError,
  withReadOnlyConnection,
  type PgPlatform,
} from "@mako-ai/extension-postgres";
import { ProjectCommandError } from "../errors.js";
import { readProjectManifest } from "../project-manifest.js";
import { resolveProjectReference } from "../project-reference.js";
import type { IndexerOptions } from "../types.js";
import { resolveLiveDbUrl } from "./resolve.js";

const SYSTEM_EXCLUDED_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

export interface DiscoverProjectDbSchemasResult {
  platform: PgPlatform;
  allSchemas: string[];
  visibleSchemas: string[];
  hiddenSchemas: string[];
}

function isTemporarySchema(schemaName: string): boolean {
  return /^pg_(toast_)?temp_/.test(schemaName);
}

function isSystemSchema(schemaName: string): boolean {
  return SYSTEM_EXCLUDED_SCHEMAS.has(schemaName) || isTemporarySchema(schemaName);
}

export async function discoverProjectDbSchemas(
  projectReference: string,
  options: IndexerOptions = {},
): Promise<DiscoverProjectDbSchemasResult> {
  const config = loadConfig(options.configOverrides);
  const globalStore = openGlobalStore({
    stateDirName: config.stateDirName,
    globalDbFilename: config.globalDbFilename,
  });

  try {
    const resolved = resolveProjectReference(globalStore, projectReference);
    if (!resolved.project) {
      throw new ProjectCommandError(
        404,
        "project_not_attached",
        `No attached project found for: ${projectReference}`,
        { projectReference },
      );
    }

    const manifest = readProjectManifest(resolved.project.canonicalPath);
    if (!manifest) {
      throw new ProjectCommandError(
        422,
        "project_manifest_invalid",
        `Project manifest is missing for: ${resolved.project.canonicalPath}`,
      );
    }

    const resolvedUrl = resolveLiveDbUrl(manifest.database.liveBinding);

    try {
      return await withReadOnlyConnection(
        { databaseUrl: resolvedUrl.url, statementTimeoutMs: 10_000 },
        async (context) => {
          const ping = await fetchPingInfo(context);
          const schemaResult = await context.query<{ schema_name: string }>(`
            SELECT nspname AS schema_name
            FROM pg_catalog.pg_namespace
            ORDER BY nspname
          `);

          const allSchemas = schemaResult.rows.map((row) => row.schema_name);
          const visibleSchemas = allSchemas.filter((name) => !isSystemSchema(name));

          return {
            platform: ping.platform,
            allSchemas,
            visibleSchemas,
            hiddenSchemas: [],
          };
        },
      );
    } catch (error) {
      if (error instanceof PgConnectionError) {
        throw new ProjectCommandError(
          502,
          "db_connection_test_failed",
          `Schema discovery failed: ${error.message}`,
          { strategy: resolvedUrl.strategy, ref: resolvedUrl.ref, code: error.code },
        );
      }
      if (error instanceof ProjectCommandError) {
        throw error;
      }
      throw new ProjectCommandError(
        502,
        "db_connection_test_failed",
        `Schema discovery failed: ${error instanceof Error ? error.message : String(error)}`,
        { strategy: resolvedUrl.strategy, ref: resolvedUrl.ref },
      );
    }
  } finally {
    globalStore.close();
  }
}
