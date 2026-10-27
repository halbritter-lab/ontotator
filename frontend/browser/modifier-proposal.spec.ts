/**
 * Modifiers on tool proposals (M2 M-5, F25) and the "Modifiers only" term search (M-3).
 *
 * ``POST /__test_modifiers__?proposal=1`` (tests/browser_modifier_scenarios.py): German text, a tool proposal
 * Seizure on "Krampfanfälle", the round is a proposal check. Attaching a modifier to the proposal runs
 * Edit & Replace implicitly; a fresh Edit & Replace copy is an attach target too (F25).
 */
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";
const textPane = (page: Page) => page.locator(".text-container");
const banner = (page: Page) => page.locator(".attach-mention-banner");
const proposalRow = (page: Page) => page.locator('.sidebar [data-list-key^="target:"]');
const ownRows = (page: Page) => page.locator('.sidebar [data-list-key^="annotation:"]');
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
  await expect(textPane(page)).toHaveText(s.texts[CASE]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  return s;
}

async function markWord(page: Page, s: ReviewFlowScenario, word: string) {
  const start = s.texts[CASE].indexOf(word);
  await selectText(page, start, start + word.length);
}

/** Marks "schwere" and chooses the modifier hit Severe: the attach mode starts. */
async function attachSevere(page: Page, s: ReviewFlowScenario) {
  await markWord(page, s, "schwere");
  const search = page.locator("#search-input");
  await expect(search).toBeFocused();
  const hit = page.getByRole("listbox", { name: "Terms", exact: true }).locator('[role="option"][aria-selected="true"]');
  await expect(hit).toBeVisible();
  for (let step = 0; step < 10 && !(await hit.textContent())?.includes("Severe"); step += 1) await page.keyboard.press("ArrowDown");
  await expect(hit).toContainText("Modifier");
  await page.keyboard.press("Enter");
  await expect(banner(page)).toContainText("Attach Severe: click its finding in the list or in the text");
}

test("a proposal is an attach target: attaching replaces it with the annotator's copy (M-5)", async ({ page }) => {
  const s = await open(page, { proposal: "1" });
  await expect(proposalRow(page)).toHaveCount(1);
  await expect(ownRows(page)).toHaveCount(0);
  await attachSevere(page, s);
  // Named before: the panel says that attaching replaces the proposal.
  await expect(page.getByText("Seizure is a tool proposal: attaching replaces it with your copy (Edit & Replace).", { exact: true })).toBeVisible();
  const target = page.getByRole("button", { name: "Attach Severe to Seizure" });
  await expect(target).toHaveCount(1);
  await expect(target).toBeFocused();
  const created = commandResponse(page, "create_annotation");
  const attached = commandResponse(page, "add_modifier");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  expect((await attached).ok()).toBeTruthy();
  // Named after: the status strip; the proposal reads Replaced, the copy carries Severe.
  await expect(page.locator("[data-advance-status]")).toHaveText("Seizure replaced by your copy with Severe “schwere”.");
  await expect(proposalRow(page)).toContainText("Replaced");
  await expect(ownRows(page)).toHaveCount(1);
  await expect(ownRows(page).locator(".mod-lines")).toContainText("Severe");
  await expect(banner(page)).toHaveCount(0);
});

test("a fresh Edit & Replace copy is an attach target in the list and in the text (F25)", async ({ page }) => {
  const s = await open(page, { proposal: "1" });
  await page.locator("body").press("j");
  await expect(proposalRow(page)).toHaveClass(/\bselected\b/);
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("3");
  expect((await created).ok()).toBeTruthy();
  await expect(ownRows(page)).toHaveCount(1);
  // The copy equals the proposal: no decision yet, the proposal stays open.
  await expect(proposalRow(page)).toContainText("Pending");
  await attachSevere(page, s);
  // Only the copy is the target (the proposal with a copy is not offered twice), in the list and in the text.
  const target = page.getByRole("button", { name: "Attach Severe to Seizure" });
  await expect(target).toHaveCount(1);
  await expect(target).toHaveAttribute("data-list-key", /^annotation:/);
  await expect(textPane(page).locator(".run").filter({ hasText: "Krampfanfälle" }).first()).toHaveAttribute("title", "Attach Severe to Seizure");
  const attached = commandResponse(page, "add_modifier");
  const decided = page.waitForResponse(r => /\/decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await target.click();
  expect((await attached).ok()).toBeTruthy();
  // The copy now differs from the proposal: the "changed" decision is recorded.
  expect((await decided).ok()).toBeTruthy();
  await expect(proposalRow(page)).toContainText("Replaced");
});

test("Modifiers only: mod: switches the chip on and the hits are modifiers (M-3)", async ({ page }) => {
  const s = await open(page, { with_finding: "1" });
  await markWord(page, s, "Wochen");
  const search = page.locator("#search-input");
  await expect(search).toBeFocused();
  await search.fill("mod:schwer");
  await expect(search).toHaveValue("schwer");
  await expect(page.getByRole("button", { name: "Remove filter Modifiers only", exact: true })).toBeVisible();
  const options = page.getByRole("listbox", { name: "Terms", exact: true }).getByRole("option");
  await expect(options.first()).toBeVisible();
  for (const text of await options.allTextContents()) expect(text).toMatch(/Modifier|Cohort term/);
  await page.getByRole("button", { name: "Remove filter Modifiers only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Modifiers only", exact: true })).toHaveAttribute("aria-pressed", "false");
});
