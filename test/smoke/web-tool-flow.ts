/**
 * Web smoke — the Flow tool↔file graph page.
 *
 * Skips cleanly when the API (127.0.0.1:3017), harness (127.0.0.1:3018), or
 * web dev server (127.0.0.1:3019) isn't reachable. Expected workflow:
 *
 *   1. Boot `services/api`
 *   2. Boot `services/harness`
 *   3. `corepack pnpm --filter @mako-ai/web run dev`
 *   4. `corepack pnpm run test:smoke:web-tool-flow`
 *
 * Asserts:
 *   - The Flow nav link routes to `/:slug/flow`.
 *   - With a project attached, the graph canvas renders and the header meta
 *     reports tool/file/touch counts.
 *   - The time-window control switches without errors.
 *   - With no project attached, the empty state is shown instead.
 */

import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "@playwright/test";

const API_URL = process.env.MAKO_API_URL ?? "http://127.0.0.1:3017";
const HARNESS_URL = process.env.MAKO_HARNESS_URL ?? "http://127.0.0.1:3018";
const WEB_URL = process.env.MAKO_WEB_URL ?? "http://127.0.0.1:3019";

interface ApiEnvelope<T> {
  ok?: boolean;
  data?: T;
}

interface AttachedProject {
  projectId: string;
  displayName: string;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

async function fetchProjects(): Promise<AttachedProject[]> {
  const res = await fetch(`${API_URL}/api/v1/projects`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`projects list returned ${res.status}`);
  const body = (await res.json()) as ApiEnvelope<AttachedProject[]>;
  const list = body.data ?? (body as unknown as AttachedProject[]);
  return Array.isArray(list) ? list : [];
}

async function main(): Promise<void> {
  if (!(await reachable(`${API_URL}/health`))) {
    console.log(`web-tool-flow: SKIP (api not reachable at ${API_URL})`);
    return;
  }
  if (!(await reachable(`${HARNESS_URL}/api/v1/health`))) {
    console.log(`web-tool-flow: SKIP (harness not reachable at ${HARNESS_URL})`);
    return;
  }
  if (!(await reachable(WEB_URL))) {
    console.log(`web-tool-flow: SKIP (web not reachable at ${WEB_URL})`);
    return;
  }

  const projects = await fetchProjects();

  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1480, height: 900 } });

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(WEB_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    // Navigate via the nav rail so the slug is resolved by the app itself.
    const flowLink = page.locator("nav a", { hasText: /^Flow$/ }).first();
    await flowLink.waitFor({ state: "visible", timeout: 5_000 });
    await flowLink.click();

    await page.locator("h1", { hasText: /^Flow$/ }).first().waitFor({ state: "visible", timeout: 5_000 });
    assert.match(page.url(), /\/flow$/, "Flow nav should route to /:slug/flow");

    if (projects.length === 0) {
      const empty = page.locator("text=/Select a project/").first();
      await empty.waitFor({ state: "visible", timeout: 5_000 });
      console.log("web-tool-flow: PARTIAL (no projects attached — empty state verified)");
      console.log("web-tool-flow: PASS");
      return;
    }

    // The graph canvas renders.
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 8_000 });
    assert.ok(await canvas.isVisible(), "graph canvas should render with a project attached");

    // Header meta reports counts (tools · files · touches).
    const main = page.locator("main");
    await page.waitForFunction(
      () => /\d+\s*tools/i.test(document.querySelector("main")?.textContent ?? ""),
      undefined,
      { timeout: 8_000 },
    ).catch(() => undefined);
    const metaText = (await main.innerText()).toLowerCase();
    assert.ok(/\d+\s*tools/.test(metaText), `header should show a tool count; got: ${metaText.slice(0, 120)}`);
    assert.ok(/\d+\s*files/.test(metaText), "header should show a file count");

    // Time-window control switches without throwing; the graph stays mounted.
    await page.locator("button", { hasText: /^All$/ }).first().click();
    await page.waitForTimeout(800);
    await canvas.waitFor({ state: "visible", timeout: 8_000 });
    assert.ok(await canvas.isVisible(), "canvas should survive a window switch");

    assert.equal(pageErrors.length, 0, `no page errors expected; got: ${JSON.stringify(pageErrors.slice(0, 5))}`);

    console.log("web-tool-flow: PASS");
  } finally {
    await page?.close();
    await browser?.close();
  }
}

main().catch((error) => {
  console.error("web-tool-flow: FAIL");
  console.error(error);
  process.exit(1);
});
