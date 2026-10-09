import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { importPackage, LAUNCH_URL, openCase } from "./helpers";

const GERMAN = fileURLToPath(new URL("../../tests/fixtures/hp-de.babelon.tsv", import.meta.url));
const ANNOTATOR = "lang-tester";

const startSearch = async (page: Page, query: string) => {
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.getByLabel(/Search ontology term/i).fill(query);
};
const seizure = (page: Page) => page.locator(".candidate-card").filter({ hasText: "HP:0001250" });

// Use a package not captured by earlier specs. Upload before its first case
// opens; previously captured packages retain their own search resources.
test("translations: upload, search in German, switch the language off, selection survives a reload", async ({ page }) => {
  await importPackage(page, "?scenario=translations", "translation-fixture", ANNOTATOR);

  await page.locator('input[type="file"][accept=".json,.tsv"]').setInputFiles(GERMAN);
  await expect(page.getByRole("status", { name: "Import result" })).toContainText(
    "hp-de.babelon.tsv was added. HP 2026-06-23: de 4 terms.",
  );
  await expect(page.locator(".app-header")).toContainText("HP 2026-06-23 · de 4 terms");

  await openCase(page, { identity: ANNOTATOR });
  await startSearch(page, "Krampfanfall");
  await expect(page.locator(".candidate-card").first()).toContainText("Seizure");
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");

  // The flag button sits in the row of the search box.
  const button = page.getByRole("button", { name: "Search languages: EN, DE" });
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

  // A fresh page: the selection comes back from the workspace preferences.
  await page.goto("about:blank");
  await page.goto(LAUNCH_URL);
  await expect(page.locator("#package-select")).toHaveValue("translation-fixture");
  await openCase(page, { identity: ANNOTATOR });
  await startSearch(page, "Krampfanfall");
  await expect(page.getByRole("button", { name: "Search languages: EN", exact: true })).toBeVisible();
  await expect(seizure(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Search languages: EN", exact: true }).click();
  await page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" }).check();
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");
});
