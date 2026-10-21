/**
 * Submit dialog with unconfirmed values in a real browser (annotator acceptance UI, spec F2, D1):
 * confirm in place with the focus moving on, "Confirm all", and the one-click acknowledgement that
 * resends once with the server's acknowledgement.
 *
 * Every test builds a fresh ``ANNOTATION_LOOP`` project: rule off, creation defaults Present /
 * Patient / Current for hpo phenotype, so every new finding has three defaulted values.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "loop-en";

/** Screenshots for human review only (never baselines). */
async function evidence(page: Page, name: string) {
  const dir = resolve(test.info().config.rootDir, "../../build/annotator-ui/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), fullPage: false });
}

async function openLoop(page: Page): Promise<ReviewFlowScenario> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(page.locator(".text-container")).toHaveText(s.texts[CASE]);
  return s;
}

/** Mark ``word``, search ``query`` and take the top hit: a finding whose defaults stay unconfirmed. */
async function addFinding(page: Page, s: ReviewFlowScenario, word: string, query: string, term: string) {
  const start = s.texts[CASE].indexOf(word);
  expect(start).toBeGreaterThanOrEqual(0);
  await selectText(page, start, start + word.length);
  const search = page.locator("#search-input");
  await expect(search).toBeFocused();
  if (query !== word) await search.fill(query);
  const hit = page.getByRole("listbox", { name: "Terms", exact: true }).locator('[role="option"][aria-selected="true"]');
  await expect(hit).toContainText(term);
  const created = page.waitForResponse(response => response.url().endsWith("/commands")
    && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(page.locator("[data-confirm-defaults]")).toBeVisible();
}

/** Count the submit requests the page sends. */
function countSubmits(page: Page) {
  const submits: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/workspaces\/[^/]+\/submit$/.test(request.url())) submits.push(request.url());
  });
  return submits;
}

const submitDialog = (page: Page) => page.getByRole("dialog", { name: "Submit case", exact: true });

test("confirm one row, then the rest with Confirm all, and submit without a warning round", async ({ page }) => {
  const s = await openLoop(page);
  await addFinding(page, s, "patient", "areflexia", "Areflexia");
  await addFinding(page, s, "seizure", "seizure", "Seizure");
  await addFinding(page, s, "hypotonia", "hypotonia", "Hypotonia");
  const submits = countSubmits(page);

  await page.getByRole("button", { name: /^Finish & Submit/ }).click();
  const dialog = submitDialog(page);
  const section = dialog.locator("[data-unconfirmed-values]");
  await expect(section.getByRole("heading", { name: "Unconfirmed values · 3 findings", exact: true })).toBeVisible();
  await expect(section.getByRole("listitem")).toHaveCount(3);
  await expect(section.getByText(/^Assertion: Present · .+: Patient · Temporality: Current$/).first()).toBeVisible();
  await evidence(page, "submit-unconfirmed.png");

  const confirms = section.getByRole("button", { name: /^Confirm values of / });
  await confirms.first().click();
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await expect(section.getByRole("heading", { name: "Unconfirmed values · 2 findings", exact: true })).toBeVisible();
  // The focus moves to the next row's "Confirm", never to the page body.
  await expect(confirms.first()).toBeFocused();

  await section.getByRole("button", { name: "Confirm all (2)", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "All values are confirmed." })).toBeVisible();
  await expect(section).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: /^Submit with \d+ unconfirmed values$/ })).toHaveCount(0);

  await dialog.getByRole("checkbox", { name: "Entire text checked for further findings" }).check();
  await dialog.getByRole("button", { name: "Submit case", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Case submitted" })).toContainText(/Case successfully submitted/i);
  expect(submits).toHaveLength(1);
});

test("one click submits with the ticked unconfirmed values", async ({ page }) => {
  const s = await openLoop(page);
  await addFinding(page, s, "seizure", "seizure", "Seizure");
  await addFinding(page, s, "hypotonia", "hypotonia", "Hypotonia");
  const submits = countSubmits(page);

  await page.getByRole("button", { name: /^Finish & Submit/ }).click();
  const dialog = submitDialog(page);
  await expect(dialog.getByRole("heading", { name: "Unconfirmed values · 2 findings", exact: true })).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Submit case", exact: true });
  await dialog.getByRole("checkbox", { name: "Entire text checked for further findings" }).check();
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("checkbox", { name: "Submit with 6 unconfirmed values", exact: true }).check();
  await expect(dialog.getByText("Acknowledging does not confirm the values; they stay marked as defaults.")).toBeVisible();
  await submit.click();
  await expect(page.getByRole("dialog", { name: "Case submitted" })).toContainText(/Case successfully submitted/i);
  // One user action: the advisory warning is answered by one resend with the server's acknowledgement.
  expect(submits).toHaveLength(2);
});
