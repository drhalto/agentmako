import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "github",
  displayName: "GitHub",
  version: "0.1.0",
  kind: "project-source",
  capabilities: [
    {
      kind: "pull-request-context",
      description: "Provides optional PR and repository metadata for later phases.",
    },
  ],
};
