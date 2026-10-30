/**
 * Finding texts on Documents (#216, #215): the search over IDs in any case and from any position, its hint on an
 * empty tab, and "Assigned to" in the Filter popover with chip, reload and selection. Scenario S17, a project of its
 * own. EVIDENCE_DIR saves a screenshot per state.
 */
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsScenario, documentsTab, documentsTable, filterChip, openFilters, rowBox, rowCell, textRow } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1280, height: 800 } });

const shot = async (page: Page, name: string) => {
  if (process.env.EVIDENCE_DIR) await page.screenshot({ path: resolve(process.env.EVIDENCE_DIR, `${name}.png`) });
};
const search = (page: Page) => page.getByRole("searchbox", { name: "Search by case ID" });
const rows = (page: Page) => documentsTable(page).locator("th[scope=row]");

async function open(page: Page) {
  const s = await documentsScenario(page, "S17");
  await loginExisting(page, s.users.lead);
  const documents = `/#/projects/${encodeURIComponent(s.project)}/documents`;
  await page.goto(documents);
  await documentsReady(page);
  // A person's display name is what the picker and the chip show.
  const members = await (await page.request.get(`/api/v1/projects/${encodeURIComponent(s.project)}/members`)).json() as { username: string; display_name: string; pseudonym: string }[];
  return { documents, annotator: members.find(member => member.username === s.users["ann-0001"])! };
}

test("the search finds IDs in any case and from any position, and says where a miss still has hits", async ({ page }) => {
  const { documents } = await open(page);
  await expect(search(page)).toHaveAttribute("placeholder", "Case ID…");
  await documentsTab(page, "All").click();
  await search(page).fill("fr100994");
  await expect(textRow(page, "FR100994", "en")).toBeVisible();
  await expect(textRow(page, "FR200100", "en")).toHaveCount(0);
  await shot(page, "01-lowercase-search");
  await search(page).fill("0994 fr");
  await expect(textRow(page, "FR100994", "en")).toHaveCount(0);
  await expect(textRow(page, "FR100994", "fr")).toBeVisible();

  await page.goto(`${documents}?segment=progress&q=100994`);
  await expect(page.getByRole("heading", { name: "No texts in this tab match this search." })).toBeVisible();
  const offer = page.getByRole("link", { name: /^Show \d+ texts? under All$/ });
  await shot(page, "02-no-hits-in-tab");
  await offer.click();
  await expect(page).toHaveURL(/documents\?q=100994$/);
  await expect(textRow(page, "FR100994", "en")).toBeVisible();
  await expect(search(page)).toHaveValue("100994");

  await search(page).fill("exophtalmie");
  await expect(page.getByRole("heading", { name: "No texts match this search." })).toBeVisible();
  await expect(page.getByRole("link", { name: /under All$/ })).toHaveCount(0);
  await shot(page, "03-no-hits-anywhere");
});

test("Assigned to shows a person's open and submitted work, survives a reload and drives the selection", async ({ page }) => {
  const { annotator } = await open(page);
  await documentsTab(page, "All").click();
  const popover = await openFilters(page);
  const picker = popover.getByRole("combobox", { name: "Assigned to" });
  await expect(picker.locator("option").first()).toHaveText("Anyone");
  await expect(picker.locator("option", { hasText: annotator.display_name })).toHaveCount(1);
  if (process.env.EVIDENCE_DIR) {
    // A native list does not appear in screenshots; expand it in place for the picture.
    await picker.evaluate((element: HTMLSelectElement) => { element.size = element.options.length; });
    await shot(page, "04-filter-popover-1280");
    await page.setViewportSize({ width: 800, height: 800 });
    await shot(page, "04-filter-popover-800");
    await page.setViewportSize({ width: 1280, height: 800 });
    await popover.locator("select").evaluate((element: HTMLSelectElement) => { element.size = 0; });
  }
  await picker.selectOption({ label: annotator.display_name });
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");

  const chip = filterChip(page, `Assigned to: ${annotator.display_name}`);
  await expect(chip).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`assignee=${annotator.pseudonym}`));
  await expect(rows(page)).toHaveCount(3);
  await expect(textRow(page, "FR300200", "en")).toHaveCount(0); // revoked
  await expect(rowCell(textRow(page, "FR100994", "en"), "annotation")).toContainText("1 of 1 submitted");
  await expect(rowCell(textRow(page, "FR100994", "fr"), "translation")).toContainText("accepted");
  await expect(rowCell(textRow(page, "FR200100", "en"), "annotation")).toContainText("0 of 1 submitted");
  await shot(page, "05-chip-and-rows");

  await page.reload();
  await documentsReady(page);
  await expect(chip).toBeVisible();
  await expect(rows(page)).toHaveCount(3);

  await page.getByRole("checkbox", { name: "Select all 3 filtered texts" }).click();
  await expect(rowBox(page, "FR100994", "en")).toBeChecked();
  await expect(rowBox(page, "FR100994", "fr")).toBeChecked();
  await expect(rowBox(page, "FR200100", "en")).toBeChecked();
  await expect(page.getByRole("region", { name: "Selection" })).toContainText("3 texts in 2 cases selected");
  await shot(page, "06-selection");

  await search(page).fill("fr200");
  await expect(rows(page)).toHaveCount(1);
  await chip.click();
  await expect(page).not.toHaveURL(/assignee=/);
});
