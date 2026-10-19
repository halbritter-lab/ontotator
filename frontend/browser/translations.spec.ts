import { expect, test, type Page } from "@playwright/test";
import { importPackage, LAUNCH_URL, openCase } from "./helpers";

const ANNOTATOR = "lang-tester";

const startSearch = async (page: Page, query: string) => {
  await page.getByRole("button", { name: /Add finding without a text span/i }).click();
  await page.getByLabel("Reason for no text span").fill("Finding documented outside the selected excerpt");
  await page.getByLabel(/Search ontology term/i).fill(query);
};
const seizure = (page: Page) => page.locator(".candidate-card").filter({ hasText: "HP:0001250" });

// Use a package not captured by earlier specs. Add the translation before its
// first case opens; captured packages retain their own search resources.
test("translations: German search overrides reset on reload while saved personal defaults persist", async ({ page }) => {
  // The administrator adds the file on the server (D5); the page shows it after a reload.
  const added = await page.request.post("/__test_translation__?name=hp-de.babelon.tsv");
  expect(added.ok()).toBeTruthy();
  await importPackage(page, "?scenario=translations", "translation-fixture", ANNOTATOR);
  await expect(page.getByRole("heading", { name: "My tasks", exact: true })).toBeVisible();

  await openCase(page);
  await startSearch(page, "Krampfanfall");
  await page.getByRole("button", { name: "Search languages: EN", exact: true }).click();
  await page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".candidate-card").first()).toContainText("Seizure");
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");

  // The flag button sits in the row of the search box.
  const button = page.getByRole("button", { name: "Search languages: EN, DE" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const input = await page.getByLabel(/Search ontology term/i).boundingBox();
  expect(box && input && box.x > input.x + input.width && Math.abs(box.y - input.y) < 4).toBeTruthy();

  await button.click();
  const list = page.getByRole("group", { name: "Search languages" });
  await expect(list.getByRole("checkbox", { name: "EN" })).toBeDisabled();
  await list.getByRole("checkbox", { name: "DE" }).uncheck();
  // The pending query is asked again at once, now without German names.
  await expect(seizure(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search languages: EN", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);

  // An editor switch is temporary: re-enable German before testing its reset.
  await page.getByRole("button", { name: "Search languages: EN", exact: true }).click();
  await page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" }).check();
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");
  await page.keyboard.press("Escape");
  // A fresh page restores English plus the English document's language.
  await page.goto("about:blank");
  await page.goto(`${LAUNCH_URL}#/?project=translation-fixture`);
  await expect(page.locator("#project-select")).toHaveValue("translation-fixture");
  await openCase(page);
  await startSearch(page, "Krampfanfall");
  await expect(page.getByRole("button", { name: "Search languages: EN", exact: true })).toBeVisible();
  await expect(seizure(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Search languages: EN", exact: true }).click();
  await page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" }).check();
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");
  await expect(page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" })).toBeChecked();
  await page.keyboard.press("Escape");

  // Explicit personal defaults persist across reloads and exact task openings.
  await page.goto(`${LAUNCH_URL}#/me`);
  const preferences = page.getByRole("form", { name: "Search preferences", exact: true });
  await preferences.getByLabel("Preferred search languages", { exact: true }).fill("de");
  await preferences.getByLabel("Preferred search languages", { exact: true }).press("Enter");
  await preferences.getByRole("button", { name: "Save search preferences", exact: true }).click();
  await expect(preferences).toContainText("Search preferences saved.");
  await page.goto("about:blank"); await page.goto(`${LAUNCH_URL}#/?project=translation-fixture`);
  await openCase(page); await startSearch(page, "Krampfanfall");
  await expect(page.getByRole("button", { name: "Search languages: EN, DE", exact: true })).toBeVisible();
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");
});
