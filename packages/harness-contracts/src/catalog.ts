/**
 * Bundled model catalog snapshot.
 *
 * Imported as JSON via `resolveJsonModule`. The on-disk file
 * `packages/harness-contracts/models/catalog.json` is the canonical source —
 * editing it changes both the runtime catalog and the build output.
 *
 * `POST /api/v1/models/refresh` may overlay an upstream catalog at runtime
 * (e.g. `models.dev`). The bundled snapshot ships as the always-available
 * baseline so the harness never blocks on the network.
 */

import bundled from "../models/catalog.json" with { type: "json" };
import { ProviderSpecSchema, type ProviderSpec } from "./schemas.js";

export interface BundledCatalog {
  version: string;
  generatedAt: string;
  note: string;
  providers: ProviderSpec[];
}

const raw = bundled as unknown as { providers: unknown[] } & Record<string, unknown>;
const providers = (raw.providers ?? []).map((entry) =>
  ProviderSpecSchema.parse(entry),
) as ProviderSpec[];

export const BUNDLED_CATALOG: BundledCatalog = {
  version: String(raw.version ?? "1"),
  generatedAt: String(raw.generatedAt ?? ""),
  note: String(raw.note ?? ""),
  providers,
};
