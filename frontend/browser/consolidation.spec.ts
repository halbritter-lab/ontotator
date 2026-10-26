/**
 * Consolidation view end to end (acceptance fixes spec "WP-E Acceptance"): the 8-group example (4 match, 1 value,
 * 1 span, 1 partial, 1 term) takes 6 consolidator clicks from opening to submitted on the comparison table (U6); a
 * lead without the Consolidator role starts it as "You" from the text card, consolidates, submits, sees the read-only
 * view and accepts the result; the same run works keyboard-only. Scenario: tests/browser_consolidation_scenarios.py.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, openDecisionBlock, openTextCard } from "./documentsHelpers";
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

const heading = (page: Page) => page.getByRole("heading", { level: 1, name: /^Consolidate case-0107\W+en v1$/ });
const expandedGroup = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");
const expanded = (page: Page) => page.locator(".cons-group-expanded");
/** A ✓ button of the comparison table: "Take {value} from {person} for {field}". */
const take = (page: Page, value: string, field: string) =>
  expanded(page).getByRole("button", { name: new RegExp(`^Take ${value} from .+ for ${field}$`, "i") });

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
  // The 4 matching groups are agreed (kept automatically) in the same list; the first open group is expanded.
  await expect(page.locator(".cons-group-agreed")).toHaveCount(4);
  await expect(expandedGroup(page)).toHaveText("muscular hypotonia");
}

test("a lead without the Consolidator role consolidates the 8-group example in 6 clicks and accepts the result", async ({ page }) => {
  const s = await consolidationScenario(page, false);
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const area = await openTextCard(page, s.case_id, "en");
  const block = await openDecisionBlock(page, s.case_id, "en");
  await block.getByRole("button", { name: "Consolidate…", exact: true }).click();
  const launcher = area.getByRole("region", { name: "Consolidate submitted results", exact: true });
  await launcher.getByLabel("Consolidation reviewer", { exact: true }).selectOption(s.users.lead);
  const started = page.waitForResponse(r => r.request().method() === "POST" && /\/projects\/[^/]+\/consolidations$/.test(r.url()));
  await launcher.getByRole("button", { name: "Start consolidation", exact: true }).click();
  const response = await started;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { round } = await response.json() as { round: { round_id: string; assignment_id: number } };
  // The toast names the new role and opens the lead's own consolidation task.
  await expect(page.locator(".ui-toast-message")).toHaveText(new RegExp(`^Consolidation started for ${s.case_id}\\W+en\\. You now have the Consolidator role for this project\\.$`));
  await page.locator(".ui-toast").getByRole("button", { name: "Open consolidation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${round.assignment_id}$`));
  await expectOpened(page);
  // The task's guidelines and problem report stay at hand; the path names the open groups.
  await expect(page.getByRole("group", { name: "Task", exact: true }).getByRole("button", { name: /^Report a text problem/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Text path", exact: true })).toContainText("consolidating, 4 of 8 groups open");
  // A person label on every member: the comparison names both people; no internal ids anywhere.
  await expect(expanded(page).locator("thead th")).toHaveCount(2);
  const body = await page.locator(".cons-screen").innerText();
  for (const id of [...s.submissions, round.round_id, "cons-"]) expect(body).not.toContain(id);
  expect(body).toContain("HP:0001252");
  await evidence(page, "e2a-consolidation-open-1280");

  // 1: value (✓ stages, Keep saves, M-7d). 2: span. 3: partial. 4: term and assertion. 5: Submit. 6: confirm.
  await take(page, "absent", "Assertion").click();
  await expect(expanded(page).locator(".cons-result")).toContainText("Not saved yet.");
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveText("Absent reflexes");
  await expect(page.getByRole("button", { name: /^muscular hypotonia decided: Hypotonia \(HP:0001252\), Absent/ })).toBeVisible();
  // The reflex spans overlap: no text decision, the text comes with the kept finding; "Keep" takes it.
  await expect(expanded(page).getByText("(overlapping, comes with the chosen finding)", { exact: false })).toBeVisible();
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveText("Reduced hearing");
  await page.getByRole("button", { name: /^Keep .+'s finding$/ }).click();
  await expect(expandedGroup(page)).toHaveText("Prolonged seizure activity");
  // The term group also differs in the assertion: one ✓ per row, then Keep (no whole-finding shortcut, M-7d).
  const table = expanded(page).getByRole("table");
  await expect(table.getByRole("rowheader", { name: /Assertion$/ })).toBeVisible();
  await evidence(page, "consolidation-term-and-assertion-1280");
  const terms = await table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /Term$/ }) }).getByRole("cell").allTextContents();
  const epilepticus = terms.findIndex(text => text.includes("Status epilepticus"));
  expect(epilepticus, terms.join(" | ")).toBeGreaterThanOrEqual(0);
  await expect(table.getByRole("rowheader", { name: "Whole finding" })).toHaveCount(0);
  await take(page, "Status epilepticus", "Term").click();
  await take(page, "present", "Assertion").click();
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Prolonged seizure activity decided: Status epilepticus \(HP:0002133\), Present/ })).toBeVisible();
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("8 groups, 8 findings, 0 not in result", { exact: true })).toBeVisible();
  await evidence(page, "e2a-consolidation-summary-1280");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true })).toBeVisible();

  // Read-only view for the lead after submission (U9).
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/consolidations/${encodeURIComponent(round.round_id)}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidation of case-0107\W+en v1$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Back to documents", exact: true })).toBeVisible();
  await expect(page.getByText("This consolidation was submitted. You see its final state.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Submit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Reopen/ })).toHaveCount(0);

  // The lead accepts the consolidation as the result.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const decision = await openDecisionBlock(page, s.case_id, "en");
  await expect(decision.getByText(/^Consolidated by .+$/)).toBeVisible();
  const selecting = page.waitForResponse(r => r.request().method() === "PUT" && /\/final-selections$/.test(new URL(r.url()).pathname));
  // "Accept result" saves at once ("Change final…" changes it later).
  await decision.getByRole("button", { name: "Accept result", exact: true }).click();
  expect((await selecting).ok()).toBeTruthy();
  await expect(decision.locator(".final-panel-success")).toContainText(new RegExp(`Final result saved for ${s.case_id}\\W+en\\.`));
});

test("keyboard only: J/K, the ✓ choices, Submit and the summary", async ({ page }) => {
  const s = await consolidationScenario(page, true);
  await loginExisting(page, s.users.lead);
  await openTask(page, s.assignment_id!);
  await page.keyboard.press("j");
  await expect(expandedGroup(page)).toHaveText("Absent reflexes");
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: /muscular hypotonia/, expanded: true })).toBeFocused();
  await tabTo(page, take(page, "absent", "Assertion"));
  await page.keyboard.press("Enter");
  await tabTo(page, expanded(page).getByRole("button", { name: "Keep", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Absent reflexes/, expanded: true })).toBeFocused();
  await tabTo(page, expanded(page).getByRole("button", { name: "Keep", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Reduced hearing/, expanded: true })).toBeFocused();
  await tabTo(page, expanded(page).getByRole("button", { name: "Not in result", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Prolonged seizure activity/, expanded: true })).toBeFocused();
  // No "Keep both" (D1): one ✓ per conflicting field, then Keep saves (M-7d).
  await tabTo(page, take(page, "Status epilepticus", "Term"));
  await page.keyboard.press("Enter");
  await tabTo(page, take(page, "present", "Assertion"));
  await page.keyboard.press("Enter");
  await tabTo(page, expanded(page).getByRole("button", { name: "Keep", exact: true }));
  await page.keyboard.press("Enter");
  const submit = page.getByRole("button", { name: "Submit consolidation", exact: true });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("8 groups, 7 findings, 1 not in result", { exact: true })).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "Submit", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true })).toBeVisible();
});
