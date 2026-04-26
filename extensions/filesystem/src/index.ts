import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "filesystem",
  displayName: "Filesystem",
  version: "0.1.0",
  kind: "project-source",
  capabilities: [
    {
      kind: "project-read",
      description: "Reads local project files and metadata for indexing.",
    },
  ],
};
