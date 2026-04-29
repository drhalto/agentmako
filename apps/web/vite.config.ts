/**
 * Vite config for the mako dashboard.
 *
 * Local ports cluster on the mako 30xx range, not the standard Vite
 * defaults, so the dashboard can boot alongside an unrelated React/Vite
 * project without claiming `5173`/`4173`. Override with `MAKO_WEB_PORT`
 * for dev and `MAKO_WEB_PREVIEW_PORT` for `vite preview` when needed.
 *
 * Dev-server proxy for `/api/v1/*`:
 *
 *   /api/v1/projects/*    → services/api     (127.0.0.1:3017)
 *   /api/v1/dashboard/*   → services/api
 *   /api/v1/tools/*       → services/api
 *   /api/v1/answers/*     → services/api
 *   /api/v1/*             → services/harness  (127.0.0.1:3018)  [catch-all]
 *
 * The split mirrors the CLI's routing: project-scoped data comes from
 * services/api; session / memory / permissions / tier / provider / undo /
 * resume / semantic / embeddings state comes from services/harness.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const HARNESS_ORIGIN = process.env.MAKO_HARNESS_URL ?? "http://127.0.0.1:3018";
const API_ORIGIN = process.env.MAKO_API_URL ?? "http://127.0.0.1:3017";

const DEV_PORT = parseIntOr(process.env.MAKO_WEB_PORT, 3019);
const PREVIEW_PORT = parseIntOr(process.env.MAKO_WEB_PREVIEW_PORT, 3020);

const TO_API = { target: API_ORIGIN, changeOrigin: true };
const TO_HARNESS = { target: HARNESS_ORIGIN, changeOrigin: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    host: "127.0.0.1",
    proxy: {
      "/api/v1/dashboard": TO_API,
      "/api/v1/projects": TO_API,
      "/api/v1/tools": TO_API,
      "/api/v1/answers": TO_API,
      "/api/v1/workflow-packets": TO_API,
      "/api/v1": TO_HARNESS,
    },
  },
  preview: {
    port: PREVIEW_PORT,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    // The remaining large chunks are Shiki's lazy language/wasm assets. The
    // application entry is below the default threshold now, so raise the
    // warning limit to avoid noisy false positives on intentional on-demand
    // code-highlighting payloads.
    chunkSizeWarningLimit: 900,
  },
});

function parseIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
