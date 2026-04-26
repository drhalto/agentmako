import type { ProjectProfile } from "@mako-ai/contracts";

export type ExtensionKind =
  | "project-source"
  | "schema-source"
  | "model-provider"
  | "tool-provider"
  | "transport";

export interface ExtensionCapability {
  kind: string;
  description: string;
}

export interface ExtensionManifest {
  id: string;
  displayName: string;
  version: string;
  kind: ExtensionKind;
  capabilities: ExtensionCapability[];
}

export interface ExtensionContext {
  projectId?: string;
  projectRoot?: string;
}

export interface ProjectProfileExtension {
  manifest: ExtensionManifest;
  detectProjectProfile(projectRoot: string): Promise<ProjectProfile | null>;
}

export interface MakoExtension {
  manifest: ExtensionManifest;
}
