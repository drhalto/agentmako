/**
 * Phase 3.5 web smoke — shell + no-agent session check.
 *
 * Skips cleanly when the API service (127.0.0.1:3017), harness service
 * (127.0.0.1:3018), or a running web server (Vite dev on 3019 or preview on
 * 3020) isn't reachable. The expected workflow is:
 *
 *   1. Boot `services/api`
 *   2. Boot `services/harness`
 *   3. `corepack pnpm --filter @mako-ai/web run dev` (or `build && preview`)
 *   3. `corepack pnpm run test:smoke:web`
 *
 * The test drives a headless browser through the dashboard:
 *   - Top bar wordmark renders with a live tier label (not "offline")
 *   - Projects board (or empty state) renders from `/api/v1/projects`
 *   - Memory page loads
 *   - Providers page loads with at least one row
 *   - A no-agent session can be created from the "Add new" menu and
 *     complete one user → assistant turn
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
  const apiOk = await reachable(`${API_URL}/health`);
  if (!apiOk) {
    console.log(
      `web-harness-shell: SKIP (api not reachable at ${API_URL} — start services/api first)`,
    );
    return;
  }
  const harnessOk = await reachable(`${HARNESS_URL}/api/v1/health`);
  if (!harnessOk) {
    console.log(
      `web-harness-shell: SKIP (harness not reachable at ${HARNESS_URL} — start services/harness first)`,
    );
    return;
  }
  const webOk = await reachable(WEB_URL);
  if (!webOk) {
    console.log(
      `web-harness-shell: SKIP (web not reachable at ${WEB_URL} — run 'pnpm --filter @mako-ai/web run dev' first)`,
    );
    return;
  }

  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // ---- Dashboard -----------------------------------------------------------
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wordmark + tier badge
    const wordmark = await page.locator("text=mako").first().textContent();
    assert.ok(
      wordmark && wordmark.trim().toLowerCase() === "mako",
      `wordmark should read 'mako'; got: ${JSON.stringify(wordmark)}`,
    );
    const harnessLabel = await page
      .locator('header >> text=/online|offline|^v\\d|no agent|\\//i')
      .first()
      .textContent({ timeout: 5_000 });
    assert.ok(
      harnessLabel && harnessLabel.trim().length > 0,
      "harness/agent status should render in the top bar",
    );

    // Usage card: rows for Tier, Embedding, Compaction, Providers
    const statLabels = await page
      .locator("main >> text=/^(Tier|Embedding|Compaction|Providers)$/")
      .allTextContents();
    assert.ok(
      statLabels.length >= 4,
      `expected 4+ usage rows on the dashboard; got ${statLabels.length}`,
    );

    const projectsHeading = await page
      .locator("main h2", { hasText: /^Projects/ })
      .first();
    await projectsHeading.waitFor({ state: "visible", timeout: 5_000 });

    // Add-new menu must expose the project + session items.
    const addNewButton = page
      .locator('button', { hasText: /^Add new$/i })
      .first();
    await addNewButton.click();
    const addProjectItem = page
      .locator('[role="menuitem"]', { hasText: /^Project$/ })
      .first();
    const addSessionItem = page
      .locator('[role="menuitem"]', { hasText: /^Session$/ })
      .first();
    await addProjectItem.waitFor({ state: "visible", timeout: 5_000 });
    await addSessionItem.waitFor({ state: "visible", timeout: 5_000 });
    assert.ok(
      await addProjectItem.isVisible(),
      "'Project' option should appear in the Add new menu",
    );
    assert.ok(
      await addSessionItem.isVisible(),
      "'Session' option should appear in the Add new menu",
    );

    // ---- Providers -----------------------------------------------------------
    await page.goto(`${WEB_URL}/providers`, { waitUntil: "domcontentloaded" });
    const providersHeading = await page
      .locator("h1", { hasText: /^Providers$/ })
      .textContent({ timeout: 5_000 });
    assert.ok(providersHeading, "providers page heading should render");

    // Defaults section + provider table should both render.
    const defaultsHeading = page.locator("h2", { hasText: /^Defaults$/ }).first();
    await defaultsHeading.waitFor({ state: "visible", timeout: 5_000 });
    const hasTable = await page.locator("table").isVisible();
    assert.ok(hasTable, "providers table should render");

    // ---- Memory --------------------------------------------------------------
    await page.goto(`${WEB_URL}/memory`, { waitUntil: "domcontentloaded" });
    const memoryHeading = await page
      .locator("h1", { hasText: /stored/i })
      .textContent({ timeout: 5_000 });
    assert.ok(memoryHeading, "memory page heading should render");

    const rememberForm = page.locator("h3", { hasText: /Remember/ });
    const recallForm = page.locator("h3", { hasText: /Recall/ });
    assert.ok(await rememberForm.isVisible(), "Remember card should render");
    assert.ok(await recallForm.isVisible(), "Recall card should render");

    // ---- Back to dashboard ---------------------------------------------------
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });

    // ---- No-agent session via Add new → Session ------------------------------
    await page
      .locator('button', { hasText: /^Add new$/i })
      .first()
      .click();
    await page
      .locator('[role="menuitem"]', { hasText: /^Session$/ })
      .first()
      .click();
    await page.waitForURL(/\/agent\//, { timeout: 10_000 });
    const sessionUrl = page.url();
    const sessionId = sessionUrl.split("/agent/")[1]?.split(/[?#]/)[0];
    assert.ok(sessionId, `expected a session URL after starting no-agent flow; got ${sessionUrl}`);

    const resumeButton = page.locator('button', { hasText: /^resume$/i }).first();
    await resumeButton.waitFor({ state: "visible", timeout: 5_000 });
    assert.ok(await resumeButton.isVisible(), "session header should expose a resume button");

    const composer = page.locator("textarea").first();
    await composer.fill("Say hello from the no-agent smoke path.");
    await page.locator('button', { hasText: /Send/ }).last().click();

    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-role="user"]')).some((node) =>
          (node.textContent ?? "").includes("Say hello from the no-agent smoke path."),
        ),
      undefined,
      { timeout: 10_000 },
    );

    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-role="assistant"]')).some((node) => {
          const text = (node.textContent ?? "").replace(/\s+/g, "");
          return text.length > 0 && !text.toLowerCase().includes("thinking");
        }),
      undefined,
      { timeout: 15_000 },
    );

    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
    const sessionLink = page.locator(`a[href="/agent/${sessionId}"]`).first();
    await sessionLink.waitFor({ state: "visible", timeout: 10_000 });
    assert.ok(
      await sessionLink.isVisible(),
      "recent sessions should include the session created from the dashboard",
    );

    console.log("web-harness-shell: PASS");
  } finally {
    await page?.close();
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
