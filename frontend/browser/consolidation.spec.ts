/**
 * Consolidation view end to end (acceptance fixes spec "WP-E Acceptance"): the 8-group example (4 match, 1 value,
 * 1 span, 1 partial, 1 term) takes 6 consolidator clicks from opening to submitted; a lead without the Adjudicator
 * role starts it as "You", consolidates, submits, sees the read-only view and accepts the final result; the same
 * run works keyboard-only. Scenario: tests/browser_consolidation_scenarios.py.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { decisionBlock, documentsReady, openRowPanel } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

interface ConsolidationScenario {
  project: string;
  users: { lead: string; "ann-0001": string; "ann-0002": string };
  case_id: string;
  document_id: string;
  submissions: string[];
  round_id?: string;
  assignment_id?: number;
}

async function consolidationScenario(page: Page, started: boolean): Promise<ConsolidationScenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: String(started) }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as ConsolidationScenario;
}

const evidenceDir = (): string => resolve(test.info().config.rootDir, "../../build/acceptance-fixes/evidence");
async function evidence(page: Page, name: string): Promise<void> {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `${name}.png`), fullPage: true });
}

const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Consolidate case-0107 · en v1", exact: true });
const expandedGroup = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");

/** Press Tab until ``target`` has focus (at most ``limit`` presses). */
async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function openTask(page: Page, assignmentId: number): Promise<void> {
  await page.goto(`/#/tasks/${assignmentId}`);
  await expectOpened(page);
}

async function expectOpened(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("4 findings matched and were kept automatically. Check them in the text.", { exact: true })).toBeVisible();
  await expect(expandedGroup(page)).toHaveText("Hypotonia");
}

test("a lead without the Adjudicator role consolidates the 8-group example in 6 clicks and accepts it as final", async ({ page }) => {
  const s = await consolidationScenario(page, false);
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const area = await openRowPanel(page, s.case_id, "en");
  await decisionBlock(page, s.case_id, "en").getByRole("button", { name: "Consolidate…", exact: true }).click();
  const launcher = area.getByRole("region", { name: "Consolidate submitted results", exact: true });
  await launcher.getByLabel("Consolidation reviewer", { exact: true }).selectOption(s.users.lead);
  const started = page.waitForResponse(r => r.request().method() === "POST" && /\/projects\/[^/]+\/consolidations$/.test(r.url()));
  await launcher.getByRole("button", { name: "Start consolidation", exact: true }).click();
  const response = await started;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { round } = await response.json() as { round: { round_id: string; assignment_id: number } };
  // The toast names the new role and opens the lead's own consolidation task.
  await expect(page.locator(".ui-toast-message")).toHaveText(`Consolidation started for ${s.case_id} · en. You now have the Adjudicator role for this project.`);
  await page.locator(".ui-toast").getByRole("button", { name: "Open consolidation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${round.assignment_id}$`));
  await expectOpened(page);
  // The task's guidelines and problem report stay at hand.
  await expect(page.locator(".cons-header").getByRole("button", { name: /^Report problem/ })).toBeVisible();
  await expect(page.locator(".cons-detail")).toHaveText(/· 4 open$/);
  // A person label on every member: the comparison names both people; no internal ids anywhere.
  await expect(page.locator(".cons-group-expanded thead th")).toHaveCount(2);
  const body = await page.locator(".cons-screen").innerText();
  for (const id of [...s.submissions, round.round_id, "cons-"]) expect(body).not.toContain(id);
  expect(body).toContain("HP:0001252");
  await evidence(page, "e2a-consolidation-open-1280");

  // 1: value. 2: span. 3: partial. 4: term. 5: Submit. 6: confirm.
  await page.getByRole("button", { name: /^absent · / }).click();
  await expect(expandedGroup(page)).toHaveText("Areflexia");
  await expect(page.getByRole("button", { name: /^Hypotonia ✓ absent \(/ })).toBeVisible();
  await page.getByRole("button", { name: /^“Absent reflexes in both legs” · / }).click();
  await expect(expandedGroup(page)).toHaveText("Hearing impairment");
  await page.getByRole("button", { name: /^Keep .+'s finding$/ }).click();
  await expect(expandedGroup(page)).toHaveText("Status epilepticus / Seizure");
  // The term group also differs in the assertion: one click takes a whole finding, naming everything it adopts.
  await expect(page.locator(".cons-group-expanded").getByRole("rowheader", { name: "Assertion · differs" })).toBeVisible();
  await evidence(page, "consolidation-term-and-assertion-1280");
  await page.getByRole("button", { name: /^Take .+'s finding: Status epilepticus \(HP:0002133\) · present · patient · current$/ }).click();
  await expect(expandedGroup(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Status epilepticus \/ Seizure ✓ Status epilepticus \(HP:0002133\) \(.+\), present \(/ })).toBeVisible();
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText(/^8 decisions → 8 findings: 4 kept automatically \(all matched\) · 3 decided · 1 kept from .+$/)).toBeVisible();
  await evidence(page, "e2a-consolidation-summary-1280");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Consolidation submitted. Accept it as final in Documents.", { exact: true })).toBeVisible();

  // Read-only view for the lead after submission (U9).
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/consolidations/${encodeURIComponent(round.round_id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Consolidation of case-0107 · en v1", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Back to documents", exact: true })).toBeVisible();
  await expect(page.getByText("This consolidation was submitted. You see its final state.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Submit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Change/ })).toHaveCount(0);

  // The lead accepts the consolidation as the final result.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  await openRowPanel(page, s.case_id, "en");
  const block = decisionBlock(page, s.case_id, "en");
  await expect(block.getByText(/^Consolidated by .+$/)).toBeVisible();
  const selecting = page.waitForResponse(r => r.request().method() === "PUT" && /\/final-selections$/.test(new URL(r.url()).pathname));
  await block.getByRole("button", { name: "Accept as final", exact: true }).click();
  expect((await selecting).ok()).toBeTruthy();
  await expect(block.locator(".final-panel-success")).toContainText(`Final result saved for ${s.case_id} · en.`);
});

test("keyboard only: J/K, choice chips, Submit and the summary", async ({ page }) => {
  const s = await consolidationScenario(page, true);
  await loginExisting(page, s.users.lead);
  await openTask(page, s.assignment_id!);
  await page.keyboard.press("j");
  await expect(expandedGroup(page)).toHaveText("Areflexia");
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: /^Hypotonia/, expanded: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: /^absent · / }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Areflexia/, expanded: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: /^“Absent reflexes” · / }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Hearing impairment/, expanded: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: /^Leave out$/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Status epilepticus \/ Seizure/, expanded: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Keep both", exact: true }));
  await page.keyboard.press("Enter");
  const submit = page.getByRole("button", { name: "Submit consolidation", exact: true });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText(/^8 decisions → 8 findings: 4 kept automatically \(all matched\) · 3 decided · 1 left out$/)).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "Submit", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Consolidation submitted. Accept it as final in Documents.", { exact: true })).toBeVisible();
});
