/**
 * Submit check with finding modifiers (modifiers plan M7): "Two severities" and the cohort term are listed as
 * acknowledgeable modifier warnings and never block; so is a modifier term as a finding's own term (R3: some name a
 * finding, e.g. Stillbirth), with "Turn into modifier…" as the way to fix it.
 *
 * Every test builds a fresh project through ``POST /__test_modifiers__`` (tests/browser_modifier_scenarios.py):
 * German text, Seizure on "Krampfanfälle" (``with_finding=1``), a standalone Severe on "schwere" (``standalone=1``).
 */
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { expectSubmitted } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";
const submitDialog = (page: Page) => page.getByRole("dialog", { name: "Submit text", exact: true });
const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

async function open(page: Page, params: Record<string, string>): Promise<ReviewFlowScenario> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.post("/__test_modifiers__", { params, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(page.locator(".text-container")).toHaveText(s.texts[CASE]);
  await page.waitForLoadState("networkidle");
  return s;
}

/** "+ Add modifier…" on Seizure for each term. */
async function addModifiers(page: Page, terms: string[]) {
  await page.locator('[data-list-key="annotation:seizure"]').click();
  const section = page.locator("[data-modifiers-section]");
  for (const term of terms) {
    await section.getByRole("button", { name: "+ Add modifier…" }).click();
    await page.getByRole("combobox", { name: "Search modifier" }).fill(term);
    await expect(page.getByRole("option").filter({ hasText: term }).first()).toBeVisible();
    const added = commandResponse(page, "add_modifier");
    await page.keyboard.press("Enter");
    expect((await added).ok()).toBeTruthy();
    await expect(section.getByRole("status")).toContainText(`Added ${term} to Seizure.`);
  }
}

test("Mild and Severe: Two severities is listed, the ticked box submits", async ({ page }) => {
  await open(page, { with_finding: "1" });
  await addModifiers(page, ["Mild", "Severe"]);
  await page.getByRole("button", { name: /^Finish & submit/ }).click();
  const dialog = submitDialog(page);
  const warnings = dialog.getByRole("region", { name: "Modifier warnings (1)" });
  await expect(warnings).toContainText("Seizure: Two severities: Mild, Severe.");
  await expect(warnings.getByRole("button", { name: "Go to Seizure" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: /^Submit with \d+ unconfirmed values? and 1 modifier warning$/ }).check();
  await dialog.getByRole("button", { name: "Submit text", exact: true }).click();
  await expectSubmitted(page);
});

test("Frequent: the cohort term is listed as a modifier warning", async ({ page }) => {
  await open(page, { with_finding: "1" });
  await addModifiers(page, ["Frequent"]);
  await page.getByRole("button", { name: /^Finish & submit/ }).click();
  const warnings = submitDialog(page).getByRole("region", { name: "Modifier warnings (1)" });
  await expect(warnings).toContainText("Seizure: Frequent is a cohort term.");
});

test("a standalone modifier only warns; Go to Severe focuses Turn into modifier…; the ticked box submits", async ({ page }) => {
  await open(page, { with_finding: "1", standalone: "1" });
  await page.getByRole("button", { name: /^Finish & submit/ }).click();
  const dialog = submitDialog(page);
  const item = dialog.getByRole("region", { name: "Modifier warnings (1)" }).locator('[data-open-item="modifier-as-finding"]');
  await expect(item).toContainText("Severe: Severe is a modifier term. Keep it only if it names the finding itself.");
  await item.getByRole("button", { name: "Go to Severe" }).click();
  await expect(page.getByRole("button", { name: "Turn into modifier…" })).toBeFocused();
  await page.getByRole("button", { name: /^Finish & Submit/ }).click();
  await dialog.getByRole("checkbox", { name: /^Submit with .*1 modifier warning$/ }).check();
  await dialog.getByRole("button", { name: "Submit case", exact: true }).click();
  await expectSubmitted(page);
});
