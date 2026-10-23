/**
 * Consolidation view accessibility (acceptance fixes U13, X13): axe finds nothing at 1280, 900 and 360 px, the
 * layout switches (text beside, above, none) and 360 px needs no horizontal scrolling.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";

/** The started scenario of tests/browser_consolidation_scenarios.py (the lead consolidates). */
async function consolidationScenario(page: Page): Promise<{ users: { lead: string }; assignment_id: number }> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as { users: { lead: string }; assignment_id: number };
}

async function evidence(page: Page, name: string): Promise<void> {
  const dir = resolve(test.info().config.rootDir, "../../build/acceptance-fixes/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

test.setTimeout(240_000);

for (const [width, layout] of [[1280, "wide"], [900, "medium"], [360, "narrow"]] as const) {
  test(`axe is clean at ${width} px (${layout} layout)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await consolidationScenario(page);
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.getByRole("heading", { level: 1, name: /^Consolidate case-0107\W+en v1$/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`.cons-layout-${layout}`)).toBeVisible();
    await expect(page.getByRole("region", { name: "Clinical text" })).toHaveCount(layout === "narrow" ? 0 : 1);
    if (layout === "narrow") await expect(page.locator(".cons-group-expanded .cons-snippet")).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".cons-screen").analyze();
    expect(results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await evidence(page, `e2a-consolidation-${width}`);
  });
}
