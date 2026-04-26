/**
 * Phase 3.8 web smoke — projects-first dashboard.
 *
 * Skips cleanly when the API service (127.0.0.1:3017), harness service
 * (127.0.0.1:3018), or the web dev server (default 127.0.0.1:3019) isn't
 * reachable. Expected workflow:
 *
 *   1. Boot `services/api`
 *   2. Boot `services/harness`
 *   3. `corepack pnpm --filter @mako-ai/web run dev`
 *   4. `corepack pnpm run test:smoke:web-project-dashboard`
 *
 * Asserts:
 *   - Every attached project from `/api/v1/projects` renders as a card
 *     (or as a row in list view), not just the first one.
 *   - Selecting a project lifts the selection into the top bar.
 *   - The view toggle flips between grid and list.
 *   - The Add new menu surfaces both Project and Session options, and
 *     the Project option opens the attach modal.
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
  const res = await fetch(`${API_URL}/api/v1/projects`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`projects list returned ${res.status}`);
  const body = (await res.json()) as ApiEnvelope<AttachedProject[]>;
  const list = body.data ?? (body as unknown as AttachedProject[]);
  return Array.isArray(list) ? list : [];
}

async function main(): Promise<void> {
  if (!(await reachable(`${API_URL}/health`))) {
    console.log(`web-project-dashboard: SKIP (api not reachable at ${API_URL})`);
    return;
  }
  if (!(await reachable(`${HARNESS_URL}/api/v1/health`))) {
    console.log(`web-project-dashboard: SKIP (harness not reachable at ${HARNESS_URL})`);
    return;
  }
  if (!(await reachable(WEB_URL))) {
    console.log(`web-project-dashboard: SKIP (web not reachable at ${WEB_URL})`);
    return;
  }

  const projects = await fetchProjects();

  let browser: Browser | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(WEB_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    // ---- Header + Add new menu ---------------------------------------------
    const projectsHeading = page
      .locator("main h2", { hasText: /^Projects/ })
      .first();
    await projectsHeading.waitFor({ state: "visible", timeout: 5_000 });

    const addNew = page.locator('button', { hasText: /^Add new$/i }).first();
    await addNew.click();
    await page
      .locator('[role="menuitem"]', { hasText: /^Project$/ })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    await page
      .locator('[role="menuitem"]', { hasText: /^Session$/ })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });

    // Open the attach modal and close it without submitting.
    await page
      .locator('[role="menuitem"]', { hasText: /^Project$/ })
      .first()
      .click();
    await page
      .locator('[role="dialog"]', { hasText: /Attach project/i })
      .waitFor({ state: "visible", timeout: 5_000 });
    await page.locator('button', { hasText: /^Cancel$/ }).first().click();
    await page
      .locator('[role="dialog"]', { hasText: /Attach project/i })
      .waitFor({ state: "hidden", timeout: 5_000 });

    if (projects.length === 0) {
      console.log(
        "web-project-dashboard: PARTIAL (no projects attached — empty state was rendered, attach modal verified)",
      );
      const empty = page.locator("text=/Attach a project/").first();
      assert.ok(await empty.isVisible(), "empty state should expose 'Attach a project' CTA");
      console.log("web-project-dashboard: PASS");
      return;
    }

    // ---- Every attached project renders ------------------------------------
    for (const project of projects) {
      const card = page.locator(`[data-project-id="${project.projectId}"]`).first();
      await card.waitFor({ state: "visible", timeout: 5_000 });
      assert.ok(
        await card.isVisible(),
        `project ${project.projectId} should render on the dashboard`,
      );
    }

    // ---- Select a project -> top bar reflects the selection ----------------
    const firstProject = projects[0]!;
    await page
      .locator(`[data-project-id="${firstProject.projectId}"]`)
      .first()
      .click();
    await page
      .locator(`[data-project-id="${firstProject.projectId}"][data-selected="true"]`)
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    const topbarProject = await page
      .locator('[data-testid="topbar-project"]')
      .first()
      .textContent({ timeout: 3_000 });
    assert.ok(
      topbarProject && topbarProject.toLowerCase().includes(firstProject.displayName.toLowerCase().slice(0, 3)),
      `top bar should reflect selected project; got ${JSON.stringify(topbarProject)}`,
    );

    // ---- View toggle -------------------------------------------------------
    await page.locator('button[aria-label="List view"]').first().click();
    await page
      .locator(`[data-project-id="${firstProject.projectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 3_000 });
    await page.locator('button[aria-label="Grid view"]').first().click();
    await page
      .locator(`[data-project-id="${firstProject.projectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 3_000 });

    console.log("web-project-dashboard: PASS");
  } finally {
    await page?.close();
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
