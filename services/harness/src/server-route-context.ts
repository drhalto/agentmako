import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import type { CatalogSourceResolver, Harness } from "@mako-ai/harness-core";
import type { ProjectStore } from "@mako-ai/store";
import type { ToolServiceOptions } from "@mako-ai/tools";
import type { ProviderSpec } from "@mako-ai/harness-contracts";

export interface HarnessServerRuntimeOptions {
  projectRoot: string;
  toolOptions?: ToolServiceOptions;
}

export interface HarnessRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  requestId: string;
  url: URL;
  method: string;
  pathname: string;
  harness: Harness;
  store: ProjectStore;
  options: HarnessServerRuntimeOptions;
  port: number;
  host: string;
  catalogSource: CatalogSourceResolver;
  syncCatalogIntoRegistry(forceRefresh?: boolean): Promise<Awaited<ReturnType<CatalogSourceResolver["resolve"]>>>;
  syncLocalProviderIntoRegistry(
    providerId: string,
  ): Promise<{
    spec: ProviderSpec;
    localProbe: { ok: boolean; models: number; error?: string } | null;
  }>;
}
