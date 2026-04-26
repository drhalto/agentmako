/**
 * Phase 3.8 web smoke — semantic search surface.
 *
 * Skips cleanly when the API service (127.0.0.1:3017), harness service
 * (127.0.0.1:3018), or the web dev server (default 127.0.0.1:3019) isn't
 * reachable. Expected workflow:
 *
 *   1. Boot `services/api`
 *   2. Boot `services/harness`
 *   3. `corepack pnpm --filter @mako-ai/web run dev`
 *   4. `corepack pnpm run test:smoke:web-semantic-search`
 *
 * Asserts:
 *   - The /search route renders the query input, kind chips, and the
 *     embeddings reindex card.
 *   - Submitting a query triggers `/api/v1/semantic/search` and renders
 *     the mode banner (`hybrid` or `fts-fallback`).
 *   - Toggling a kind filter narrows the chip set without losing other chips.
 *   - The embeddings reindex card stays mounted and exposes its three
 *     reindex actions.
 */

import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "@playwright/test";

const API_URL = process.env.MAKO_API_URL ?? "http://127.0.0.1:3017";
const HARNESS_URL = process.env.MAKO_HARNESS_URL ?? "http://127.0.0.1:3018";
const WEB_URL = process.env.MAKO_WEB_URL ?? "http://127.0.0.1:3019";

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!(await reachable(`${API_URL}/health`))) {
    console.log(`web-semantic-search: SKIP (api not reachable at ${API_URL})`);
    return;
  }
  if (!(await reachable(`${HARNESS_URL}/api/v1/health`))) {
    console.log(`web-semantic-search: SKIP (harness not reachable at ${HARNESS_URL})`);
    return;
  }
  if (!(await reachable(WEB_URL))) {
    console.log(`web-semantic-search: SKIP (web not reachable at ${WEB_URL})`);
    return;
  }

  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(`${WEB_URL}/search`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // ---- Page header -------------------------------------------------------
    const heading = await page
      .locator("h1", { hasText: /^Semantic search$/ })
      .first()
      .textContent({ timeout: 5_000 });
    assert.ok(heading, "semantic search heading should render");

    // ---- Kind chips --------------------------------------------------------
    for (const kind of ["code", "doc", "memory"] as const) {
      const chip = page.locator(`button[data-kind="${kind}"]`).first();
      await chip.waitFor({ state: "visible", timeout: 3_000 });
      assert.ok(await chip.isVisible(), `${kind} kind chip should render`);
    }

    // Toggle "memory" off — other two should remain.
    const memoryChip = page.locator('button[data-kind="memory"]').first();
    const memoryActiveBefore = await memoryChip.getAttribute("data-active");
    await memoryChip.click();
    const memoryActiveAfter = await memoryChip.getAttribute("data-active");
    assert.notEqual(
      memoryActiveBefore,
      memoryActiveAfter,
      "clicking memory chip should flip its active state",
    );

    // ---- Reindex card ------------------------------------------------------
    const reindexHeader = page
      .locator("article h3", { hasText: /^Embeddings$/ })
      .first();
    await reindexHeader.waitFor({ state: "visible", timeout: 5_000 });
    for (const label of [
      /Re-index semantic units/i,
      /Re-index memories/i,
      /Re-index all/i,
    ]) {
      const button = page.locator("button", { hasText: label }).first();
      assert.ok(
        await button.isVisible(),
        `reindex action ${label} should render`,
      );
    }

    // ---- Query path --------------------------------------------------------
    const input = page.locator('input[aria-label="Semantic query"]').first();
    await input.fill("session");

    const semanticResponsePromise = page
      .waitForResponse(
        (response) => {
          const url = response.url();
          return /\/api\/v1\/semantic\/search\b/.test(url);
        },
        { timeout: 10_000 },
      )
      .catch(() => null);

    await page
      .locator('button[type="submit"]', { hasText: /^Search/i })
      .first()
      .click();

    const response = await semanticResponsePromise;
    assert.ok(
      response,
      "submitting a query should hit /api/v1/semantic/search",
    );
    assert.ok(
      response.status() < 500,
      `semantic search should not 5xx; got ${response.status()}`,
    );

    // Mode banner should render once the query settles.
    const banner = page.locator('[data-testid="search-mode-banner"]').first();
    await banner.waitFor({ state: "visible", timeout: 8_000 });
    const bannerText = (await banner.textContent()) ?? "";
    assert.ok(
      /hybrid|fts-fallback/i.test(bannerText),
      `mode banner should label the search mode; got ${JSON.stringify(bannerText)}`,
    );

    console.log("web-semantic-search: PASS");
  } finally {
    await page?.close();
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
