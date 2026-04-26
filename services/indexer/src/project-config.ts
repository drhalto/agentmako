import { loadConfig } from "@mako-ai/config";
import type { ProjectManifest } from "@mako-ai/contracts";
import { openGlobalStore } from "@mako-ai/store";
import { ProjectCommandError } from "./errors.js";
import { updateProjectManifestDefaultSchemaScope } from "./project-manifest.js";
import { resolveProjectReference } from "./project-reference.js";
import type { IndexerOptions } from "./types.js";

export interface SetDefaultSchemaScopeResult {
  project: { projectId: string; canonicalPath: string };
  manifest: ProjectManifest;
  manifestPath: string;
  defaultSchemaScope: string[];
}

export function setProjectDefaultSchemaScope(
  projectReference: string,
  scope: string[] | undefined,
  options: IndexerOptions = {},
): SetDefaultSchemaScopeResult {
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

    const { manifest, manifestPath } = updateProjectManifestDefaultSchemaScope(
      resolved.project.canonicalPath,
      scope,
    );

    return {
      project: {
        projectId: resolved.project.projectId,
        canonicalPath: resolved.project.canonicalPath,
      },
      manifest,
      manifestPath,
      defaultSchemaScope: manifest.database.defaultSchemaScope ?? [],
    };
  } finally {
    globalStore.close();
  }
}
