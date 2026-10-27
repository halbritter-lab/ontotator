/**
 * Finding modifiers in the editor (modifiers plan M4): attach mode from the text (E-a), the Modifiers section,
 * findings-list modifier lines (E-b), modifier marks and hover framing, axe.
 *
 * Every test builds a fresh project through ``POST /__test_modifiers__?with_finding=1``
 * (tests/browser_modifier_scenarios.py): German text, Seizure on "Krampfanfälle".
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";
const textPane = (page: Page) => page.locator(".text-container");
const seizureRow = (page: Page) => page.locator('[data-list-key="annotation:seizure"]');
const banner = (page: Page) => page.locator(".attach-mention-banner");
const runsOf = (page: Page, id: string) => page.locator(`.text-container .run[data-mentions~="${id}"]`);
const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

async function evidence(page: Page, name: string) {
  const dir = resolve(test.info().config.rootDir, "../../build/modifiers/evidence");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), fullPage: false });
}

async function open(page: Page, size = { width: 1440, height: 900 }): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const response = await page.request.post("/__test_modifiers__", { params: { with_finding: "1" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(textPane(page)).toHaveText(s.texts[CASE]);
  await page.evaluate(() => document.fonts.ready);
  // The German search language loads with the page: marking before it would search in English only.
  await page.waitForLoadState("networkidle");
  return s;
}

async function markWord(page: Page, s: ReviewFlowScenario, word: string) {
  const start = s.texts[CASE].indexOf(word);
  await selectText(page, start, start + word.length);
}

/**
 * The term search shows its hits in a shuffled order (unbiased display): move the active hit to `term`.
 * With Severe first this costs no key; the acceptance's "two keys after marking" holds then.
 */
async function activate(page: Page, term: string) {
  const hit = page.getByRole("listbox", { name: "Terms", exact: true }).locator('[role="option"][aria-selected="true"]');
  await expect(hit).toBeVisible();
  for (let step = 0; step < 10 && !(await hit.textContent())?.includes(term); step += 1) await page.keyboard.press("ArrowDown");
  await expect(hit).toContainText(term);
  return hit;
}

/** Marks `word`, finds `query` (default: the prefill) and chooses the modifier hit `term`: the attach mode starts. */
async function startAttach(page: Page, s: ReviewFlowScenario, word: string, term: string, query?: string) {
  await markWord(page, s, word);
  const search = page.locator("#search-input");
  await expect(search).toBeFocused();
  if (query) await search.fill(query);
  const hit = await activate(page, term);
  await expect(hit).toContainText("Modifier");
  await page.keyboard.press("Enter");
  await expect(banner(page)).toContainText(`Attach ${term}: click its finding in the list or in the text`);
}

test("two keys after marking attach Severe; a click on the mark attaches the next one; hover frames without a shift", async ({ page }) => {
  const s = await open(page);
  await startAttach(page, s, "schwere", "Severe");
  const target = page.getByRole("button", { name: "Attach Severe to Seizure" });
  await expect(target).toBeFocused();
  await expect(page.getByRole("region", { name: "Attach Severe" })).toContainText("Nearest in this sentence: Seizure · “Krampfanfälle”");
  await expect(runsOf(page, "ev-seizure").first()).toHaveClass(/run--framed/);
  // The findings rows are `li role="button"` in a `ul` since before modifiers (list, aria-allowed-role): known, not checked here.
  const axe = await new AxeBuilder({ page }).include(".attach-mention-banner").include(".inspector-pane").include(".doc-list")
    .disableRules(["list", "aria-allowed-role"]).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  await evidence(page, "modifiers-attach.png");

  const added = commandResponse(page, "add_modifier");
  await page.keyboard.press("Enter");
  expect((await added).ok()).toBeTruthy();
  const chip = page.locator('[data-modifier-chip="HP:0012828"]');
  await expect(chip).toContainText("Severe “schwere”");
  await expect(chip.getByRole("button", { name: "Actions, Severe" })).toBeFocused();
  await expect(seizureRow(page).locator(".mod-lines")).toHaveText("Modifiers: Severe");
  await expect(banner(page)).toHaveCount(0);

  // A second modifier, attached by clicking the Seizure mark in the text.
  await startAttach(page, s, "wiederholt", "Recurrent", "Recurrent");
  const second = commandResponse(page, "add_modifier");
  await runsOf(page, "ev-seizure").first().click();
  expect((await second).ok()).toBeTruthy();
  await expect(page.getByRole("list", { name: "Modifiers of Seizure" })).toContainText("Recurrent “wiederholt”");

  // Hover the Seizure mark: the modifier runs are framed, the text block does not move.
  await page.getByRole("button", { name: "Clear selection" }).first().click();
  const box = await textPane(page).boundingBox();
  await runsOf(page, "ev-seizure").first().hover();
  await expect(runsOf(page, "mod:seizure:HP:0012828").first()).toHaveClass(/run--framed/);
  expect(await textPane(page).boundingBox()).toEqual(box);
});

test("+ Add modifier… shows Cohort term; Mild and Severe show Two severities; axe on the section", async ({ page }) => {
  await open(page);
  await seizureRow(page).click();
  const section = page.locator("[data-modifiers-section]");
  for (const [query, term] of [["Frequent", "Frequent"], ["Mild", "Mild"], ["Severe", "Severe"]]) {
    await section.getByRole("button", { name: "+ Add modifier…" }).click();
    const search = page.getByRole("combobox", { name: "Search modifier" });
    await expect(search).toBeFocused();
    await search.fill(query);
    const hit = page.getByRole("option").filter({ hasText: term }).first();
    await expect(hit).toBeVisible();
    if (term === "Frequent") await expect(hit).toContainText("Cohort term");
    const added = commandResponse(page, "add_modifier");
    await page.keyboard.press("Enter");
    expect((await added).ok()).toBeTruthy();
    await expect(section.getByRole("status")).toContainText(`Added ${term} to Seizure. Link a text span?`);
  }
  await expect(section.locator('[data-modifier-chip="HP:0040282"]')).toContainText("Cohort term");
  await expect(section.getByText("Two severities")).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("[data-modifiers-section]").analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
});

test("a modifier hit can become the finding itself (some name a finding, e.g. Stillbirth)", async ({ page }) => {
  const s = await open(page);
  await startAttach(page, s, "schwere", "Severe");
  const created = commandResponse(page, "create_annotation");
  await page.getByRole("button", { name: "Use Severe as the finding" }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn into modifier…" })).toBeVisible();
});

test("Esc in the attach mode discards the mark and leaves focus in the text after it", async ({ page }) => {
  const s = await open(page);
  await startAttach(page, s, "schwere", "Severe");
  await page.keyboard.press("Escape");
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Attach Severe" })).toHaveCount(0);
  const end = s.texts[CASE].indexOf("schwere") + "schwere".length;
  const caret = await page.evaluate(() => {
    const selection = window.getSelection()!;
    const container = document.querySelector(".text-container")!;
    if (!selection.focusNode || !container.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length;
  });
  expect(caret).toBe(end);
});

test("at 600 px the attach mode works through the list", async ({ page }) => {
  const s = await open(page, { width: 600, height: 900 });
  await markWord(page, s, "schwere");
  await page.getByRole("button", { name: "Choose term" }).click();
  await activate(page, "Severe");
  await page.keyboard.press("Enter");
  const target = page.getByRole("button", { name: "Attach Severe to Seizure" });
  await expect(target).toBeFocused();
  const added = commandResponse(page, "add_modifier");
  await page.keyboard.press("Enter");
  expect((await added).ok()).toBeTruthy();
  await expect(page.locator('[data-modifier-chip="HP:0012828"]')).toContainText("Severe “schwere”");
});
