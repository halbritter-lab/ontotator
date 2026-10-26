/**
 * Consolidation with finding modifiers (modifiers plan M5b; spec acceptance "consolidator clicks", DN-6 A): the
 * acceptance round S1 (agreed automatically), S4 (✓ ✓ Keep), S9 twice (✓ Keep), S13 ("Keep Ana Weber's finding"),
 * "Submit consolidation" and the dialog's "Submit" takes exactly 10 clicks; axe on a group card with a Modifiers row.
 * Scenario: ``POST /__test_consolidation__?scenario=modifiers&started=true`` (tests/browser_consolidation_scenarios.py).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

interface ModifierScenario { users: { lead: string }; assignment_id: number }

async function modifierScenario(page: Page): Promise<ModifierScenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { scenario: "modifiers", started: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as ModifierScenario;
}

async function evidence(page: Page, name: string): Promise<void> {
  const dir = resolve(test.info().config.rootDir, "../../build/modifiers/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), fullPage: true });
}

const expanded = (page: Page) => page.locator(".cons-group-expanded");
const expandedTitle = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");
/** A ✓ toggle of the Modifiers row: "Take {modifier} from {person} for Modifiers". */
const take = (page: Page, modifier: string, person: string) =>
  expanded(page).getByRole("button", { name: `Take ${modifier} from ${person} for Modifiers`, exact: true });
const wholeFinding = (page: Page) => expanded(page).getByRole("rowheader", { name: "Whole finding" });

test("the modifier acceptance round takes 10 clicks; axe is clean on a card with a Modifiers row", async ({ page }) => {
  const s = await modifierScenario(page);
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidate case-0107\W+en v1$/ })).toBeVisible({ timeout: 30_000 });
  // Every consolidator action goes through this counter (DN-6 A).
  let clicks = 0;
  const click = async (target: Locator) => { await target.click(); clicks += 1; };

  // S1: agreed automatically, 0 clicks.
  await expect(page.locator(".cons-group-agreed")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^hearing loss agreed/ })).toBeVisible();

  // S4 (Modifiers is the only conflicting row): no "Whole finding" row; ✓ Recurrent, ✓ Severe, Keep.
  await expect(expandedTitle(page)).toHaveText("focal seizures");
  await expect(expanded(page).getByRole("rowheader", { name: /Modifiers/ })).toBeVisible();
  await expect(wholeFinding(page)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include(".cons-group-expanded").analyze();
  expect(axe.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`))).toEqual([]);
  await click(take(page, "Recurrent", "Ana Weber"));
  await click(take(page, "Severe", "Ben Roth"));
  await expect(expanded(page).locator(".cons-result")).toContainText("modifiers: Recurrent, Severe");
  await evidence(page, "consolidation-modifiers.png");
  await click(expanded(page).getByRole("button", { name: "Keep", exact: true }));

  // S9 Seizure: ✓ Ana's Severe, Keep.
  await expect(expandedTitle(page)).toHaveText("seizures");
  await expect(wholeFinding(page)).toHaveCount(0);
  await click(take(page, "Severe", "Ana Weber"));
  await click(expanded(page).getByRole("button", { name: "Keep", exact: true }));

  // S9 Hypotonia: the cross-link hint names Ana's Severe on Seizure and links to that group; ✓ Ben's Severe, Keep.
  await expect(expandedTitle(page)).toHaveText("hypotonia");
  await expect(wholeFinding(page)).toHaveCount(0);
  await expect(expanded(page).getByRole("link", { name: "Ana Weber linked “Severe” (Severe) to Seizure.", exact: true })).toBeVisible();
  await click(take(page, "Severe", "Ben Roth"));
  await click(expanded(page).getByRole("button", { name: "Keep", exact: true }));

  // S13 (partial): Ana's finding with its spanless Bilateral.
  await expect(expandedTitle(page)).toHaveText("Reduced reflexes");
  await click(expanded(page).getByRole("button", { name: "Keep Ana Weber's finding", exact: true }));
  await expect(expandedTitle(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^focal seizures decided: .*modifiers: Recurrent, Severe/ })).toBeVisible();

  await click(page.getByRole("button", { name: "Submit consolidation", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("5 groups, 5 findings, 0 left out", { exact: true })).toBeVisible();
  await click(dialog.getByRole("button", { name: "Submit", exact: true }));
  await expect(page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true })).toBeVisible();
  expect(clicks).toBe(10);
});
