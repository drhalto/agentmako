/**
 * Phase 3.9 web smoke — session-surface affordances.
 *
 * Skips cleanly when the API service (127.0.0.1:3017), harness service
 * (127.0.0.1:3018), or a running web server (Vite dev 3019 or preview 3020)
 * isn't reachable.
 *
 * Drives a headless browser through:
 *   - Composer draft persistence (type → reload → text restored)
 *   - Draft clears on successful send
 *   - Session list orders most-recent-first (we bump two sessions in the
 *     order B → A and expect A on top)
 *   - /usage page renders its header + table shell
 *   - Providers page renders the Catalog status line with a Refresh button
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

async function createNoAgentSession(page: Page): Promise<string> {
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("button", { hasText: /^Add new$/i }).first().click();
  await page.locator('[role="menuitem"]', { hasText: /^Session$/ }).first().click();
  await page.waitForURL(/\/agent\//, { timeout: 10_000 });
  const url = page.url();
  const id = url.split("/agent/")[1]?.split(/[?#]/)[0];
  if (!id) throw new Error(`expected a session URL; got ${url}`);
  return id;
}

async function main(): Promise<void> {
  const apiOk = await reachable(`${API_URL}/health`);
  const harnessOk = await reachable(`${HARNESS_URL}/api/v1/health`);
  const webOk = await reachable(WEB_URL);
  if (!apiOk || !harnessOk || !webOk) {
    console.log(
      `web-session-affordances: SKIP (api=${apiOk} harness=${harnessOk} web=${webOk} — bring them up first)`,
    );
    return;
  }

  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // ---------- Usage page renders ----------
    await page.goto(`${WEB_URL}/usage`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator("h1", { hasText: /^Usage$/ }).waitFor({ state: "visible", timeout: 5_000 });
    const windowButtons = await page
      .locator("button", { hasText: /^(24h|7 days|30 days|all time)$/ })
      .count();
    assert.ok(windowButtons >= 4, "/usage page should render the date-window chip group");

    // ---------- Providers page shows the catalog status line ----------
    await page.goto(`${WEB_URL}/providers`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator("h1", { hasText: /^Providers$/ }).waitFor({ state: "visible" });
    const catalogLine = page.locator("text=/Catalog:/i").first();
    await catalogLine.waitFor({ state: "visible", timeout: 5_000 });
    const refreshButton = page.locator("button", { hasText: /^Refresh$/ }).first();
    assert.ok(await refreshButton.isVisible(), "catalog refresh button should render");

    // ---------- Draft persistence ----------
    const sessionId = await createNoAgentSession(page);
    const composer = page.locator("textarea").first();
    await composer.waitFor({ state: "visible" });
    const draft = "unsent-draft-3.9";
    await composer.fill(draft);

    // Small pause to let the 250ms debounce write to localStorage.
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: "domcontentloaded" });
    const restored = await page.locator("textarea").first().inputValue();
    assert.equal(
      restored,
      draft,
      `draft should persist across reload; got ${JSON.stringify(restored)}`,
    );

    // Successful send clears the draft.
    await page.locator("textarea").first().fill(draft);
    await page.locator("button", { hasText: /Send/ }).last().click();
    await page.waitForFunction(
      (text) =>
        Array.from(document.querySelectorAll('[data-role="user"]')).some((node) =>
          (node.textContent ?? "").includes(text),
        ),
      draft,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: "domcontentloaded" });
    const afterSend = await page.locator("textarea").first().inputValue();
    assert.equal(afterSend, "", "draft should clear after successful send");

    // ---------- Latest-user-activity session sort ----------
    // Creating a second session bumps updatedAt ahead of the first —
    // the sidebar should reflect that ordering.
    const secondSessionId = await createNoAgentSession(page);
    assert.notEqual(secondSessionId, sessionId, "second session should have a different id");

    await page.goto(`${WEB_URL}/agent/${sessionId}`, { waitUntil: "domcontentloaded" });
    // Touch the first session by sending a turn — that updates its updatedAt.
    await page.locator("textarea").first().fill("bump first session");
    await page.locator("button", { hasText: /Send/ }).last().click();
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[data-role="user"]')).length > 0,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(500);

    await page.goto(`${WEB_URL}/agent`, { waitUntil: "domcontentloaded" });
    const topHref = await page
      .locator('ul[role="list"] a[href^="/agent/"]')
      .first()
      .getAttribute("href");
    assert.equal(
      topHref,
      `/agent/${sessionId}`,
      `most-recently-active session should sort to the top (got ${topHref})`,
    );

    console.log("web-session-affordances: PASS");
  } finally {
    await page?.close();
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
