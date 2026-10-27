/**
 * One-line Documents rows (plan T2, spec §2b, V6, V7): about 16 rows on a 1280×900 screen, D2 words only, no page
 * scroll, no horizontal scroll at 768 px, the "Tool proposals" filter and page titles on one left edge.
 * Scenarios: tests/browser_lead_workflow_scenarios.py (ROWS, 30 cases) and tests/browser_proposal_check_scenarios.py.
 */
import { expect, test, type Page } from "@playwright/test";
import { cardRow, documentsReady, documentsTable, openFilters } from "./documentsHelpers";
import { loginExisting, TASKS_HOME } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";
import { loginScenarioUser, proposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

async function rowsPage(page: Page): Promise<LeadScenario> {
  const s = await leadScenario(page, "ROWS");
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  return s;
}

test("one line per text, at least 13 rows at 1280×900", async ({ page }) => {
  await rowsPage(page);
  const rows = await documentsTable(page).locator("tbody tr").evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height, view: window.innerHeight };
  }));
  const visible = rows.filter(row => row.top >= 0 && row.bottom <= row.view);
  // M1 flat list: only 40 px text rows (no 28 px case lines any more), below the tabs, toolbar and selection tools.
  expect(visible.length).toBeGreaterThanOrEqual(13);
  for (const row of rows) expect(row.height).toBeLessThanOrEqual(44);
});

test("no D2-removed words on the page", async ({ page }) => {
  await rowsPage(page);
  const text = await page.locator("body").innerText();
  for (const word of [/Annotation review/, /Keep both/, /Adjudicator/, /\bblind\b/i]) expect(text).not.toMatch(word);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
});

test("the page itself does not scroll", async ({ page }) => {
  await rowsPage(page);
  const { scrollHeight, innerHeight } = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight + 1);
});

test("narrow windows keep Last activity: the table scrolls sideways, not the page (#8)", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await rowsPage(page);
  await expect(documentsTable(page).getByRole("columnheader", { name: "Last activity" })).toBeVisible();
  const widths = await documentsTable(page).evaluate(table => {
    const wrapper = table.parentElement!;
    return { overflow: getComputedStyle(wrapper).overflowX, page: document.documentElement.scrollWidth, view: window.innerWidth };
  });
  expect(widths.overflow).toBe("auto");
  expect(widths.page).toBeLessThanOrEqual(widths.view);
});

test("filter With tool proposals", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  await expect(cardRow(page, "EN100017", "en")).toBeVisible();
  const filters = await openFilters(page);
  await expect(filters.getByRole("group", { name: "Tool proposals" })).toBeVisible();
  await filters.getByRole("checkbox", { name: /^With tool proposals, / }).check();
  await expect(page).toHaveURL(/proposals=/);
  await page.keyboard.press("Escape");
  await expect(cardRow(page, "EN100017", "en")).toHaveCount(0);
  await expect(cardRow(page, "EN100024", "en")).toBeVisible();
  await expect(cardRow(page, "EN100031", "en")).toBeVisible();
});

test("page titles share the left padding", async ({ page }) => {
  const s = await rowsPage(page);
  const left = async () => (await page.getByRole("heading", { level: 1 }).first().boundingBox())!.x;
  const documents = await left();
  await page.goto(TASKS_HOME);
  await expect(page.getByRole("heading", { level: 1, name: "My tasks", exact: true })).toBeVisible();
  const tasks = await left();
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/settings`);
  await expect(page.getByRole("heading", { level: 1, name: "Project settings", exact: true })).toBeVisible();
  const settings = await left();
  expect(Math.abs(tasks - documents)).toBeLessThanOrEqual(1);
  expect(Math.abs(settings - documents)).toBeLessThanOrEqual(1);
});
