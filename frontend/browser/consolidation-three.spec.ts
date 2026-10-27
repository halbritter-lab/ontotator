/**
 * Consolidation table with three people (plan T2, spec §3): the hypotonia group is a three-way term and assertion
 * conflict; ✓ choices and "Take …'s finding" spell out the result line; tool-proposal findings carry the robot icon.
 * Scenarios: tests/browser_consolidation_scenarios.py (people=3; ann-0003 marks "hypotonia" as HP:0000707, which the
 * fixture ontology names "Abnormality of the nervous system") and tests/browser_proposal_check_scenarios.py.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";
import { loginScenarioUser, proposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

interface ThreeScenario {
  project: string;
  users: { lead: string; "ann-0001": string; "ann-0002": string; "ann-0003": string };
  case_id: string;
  assignment_id: number;
}

async function threeScenario(page: Page): Promise<ThreeScenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true", people: "3" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as ThreeScenario;
}

const OTHER = "Abnormality of the nervous system (HP:0000707)";
const group = (page: Page, name: string) => page.locator(".cons-group").filter({ has: page.locator(".cons-group-title", { hasText: name }) });
const submitButton = (page: Page) => page.locator(".cons-progress").getByRole("button", { name: "Submit consolidation", exact: true });
const saved = (page: Page) => page.waitForResponse(r => r.request().method() !== "GET" && /consolidation/.test(r.url()));

/** Resolve every remaining open group: a ✓ in each conflicting row (first person), then Keep (M-7d). */
async function resolveRest(page: Page): Promise<void> {
  const groups = page.locator(".cons-group");
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    if (!(await group.locator(".cons-group-state").count())) continue;
    const toggle = group.locator(".cons-group-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const keep = group.getByRole("button", { name: /^Keep/ });
    await expect(keep.first()).toBeVisible();
    const conflicts = group.locator("tr.cons-row--conflict");
    for (let row = 0; row < await conflicts.count(); row += 1) await conflicts.nth(row).locator("button.cons-take").first().click();
    await keep.first().click();
    // Saved: the group's line reads "decided: …".
    await expect(group.locator(".cons-group-done")).toBeVisible();
  }
  await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
}

test("three people: choose by field, Keep saves, the result line names what is not taken", async ({ page }) => {
  const s = await threeScenario(page);
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Consolidate case-0107 en v1", exact: true })).toBeVisible({ timeout: 30_000 });

  // The path: Finalization is the stage that needs work now.
  const path = page.getByRole("navigation", { name: "Text path", exact: true });
  await expect(path.getByRole("listitem").nth(2)).toContainText(/^Finalization .*needs work now$/);

  const hypotonia = group(page, "muscular hypotonia");
  const toggle = hypotonia.locator(".cons-group-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toContainText("Conflict");
  await expect(toggle).toContainText("2 fields to decide");
  const table = hypotonia.locator("table.cons-compare");
  await expect(table.locator("thead th")).toHaveCount(3);
  // Every row is visible (M-7e): agreed rows muted after the rows to decide, the value under every person (B5-2).
  await expect(table.getByRole("row", { name: /^Agreed/ })).toHaveCount(0);
  await expect(table.locator("tr.cons-row--agreed").first()).toBeVisible();
  await expect(table.getByRole("row", { name: /^Experiencer/ }).getByRole("cell", { name: "Patient", exact: true })).toHaveCount(3);
  await expect(table.getByRole("row", { name: /^Temporality/ }).getByRole("cell", { name: "Current", exact: true })).toHaveCount(3);
  const result = hypotonia.locator(".cons-result");

  // ✓ on the other term (Term row): the result names it and lists what is not taken.
  await table.getByRole("button", { name: new RegExp(`^Take Abnormality of the nervous system from .*ann-0003.* for Term$`) }).click();
  await expect(result).toContainText(`Result: 1 finding, ${OTHER}, Assertion not chosen yet, Patient, Current`);
  await expect(result).toContainText(new RegExp(`Not taken: Hypotonia \\(.*ann-0001.*, .*ann-0002.*\\)`));
  // ✓ on ann-0002's Absent stages that value; Keep saves the group (M-7d).
  await table.getByRole("button", { name: new RegExp(`^Take Absent from .*ann-0002.* for Assertion$`) }).click();
  await expect(result).toContainText("Not saved yet.");
  let done = saved(page);
  await hypotonia.getByRole("button", { name: "Keep", exact: true }).click();
  expect((await done).ok()).toBeTruthy();
  await expect(toggle).toContainText(`decided: ${OTHER}, Absent, Patient, Current`);

  // The resolved row has no Reopen button (M-7b): the row expands, Reopen is inside. Then ann-0003's Present, Keep.
  await expect(hypotonia.locator(".cons-group-line").getByRole("button", { name: /^Reopen\b/ })).toHaveCount(0);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  done = saved(page);
  await hypotonia.getByRole("button", { name: "Reopen", exact: true }).click();
  expect((await done).ok()).toBeTruthy();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await table.getByRole("button", { name: new RegExp(`^Take Abnormality of the nervous system from .*ann-0003.* for Term$`) }).click();
  await table.getByRole("button", { name: new RegExp(`^Take Present from .*ann-0003.* for Assertion$`) }).click();
  done = saved(page);
  await hypotonia.getByRole("button", { name: "Keep", exact: true }).click();
  expect((await done).ok()).toBeTruthy();
  await expect(toggle).toContainText(`decided: ${OTHER}, Present, Patient, Current`);

  // Agreed groups stay in the same list; D2 words only, no separators.
  const list = page.getByRole("list", { name: "Groups", exact: true });
  await expect(list.locator(".cons-group-agreed").first()).toContainText("agreed");
  const text = await page.locator(".cons-screen").innerText();
  expect(text).not.toContain("Keep both");
  expect(text).not.toContain("differs");
  expect(text).not.toContain("·");

  await resolveRest(page);
  const axe = await new AxeBuilder({ page }).include(".cons-screen").analyze();
  expect(axe.violations).toEqual([]);
  await submitButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  const submitted = page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true });
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(submitted).toBeVisible();
});

test("findings from tool proposals carry the robot icon", async ({ page }) => {
  const s = await proposalCheckScenario(page, "CONSOLIDATING");
  await loginScenarioUser(page, s, "lead");
  await page.goto(`/#/tasks/${s.consolidation_assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Consolidate EN100024 en v1", exact: true })).toBeVisible({ timeout: 30_000 });
  const expanded = page.locator(".cons-group-expanded");
  await expect(expanded.locator("thead").getByRole("img", { name: "From a tool proposal", exact: true }).first()).toBeVisible();
  await expect(expanded.locator("thead").getByRole("img", { name: "From a tool proposal", exact: true }).first()).toHaveAttribute("title", "From a tool proposal");
  const axe = await new AxeBuilder({ page }).include(".cons-screen").analyze();
  expect(axe.violations).toEqual([]);
});
